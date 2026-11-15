// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Device, Room } from "@bim/contracts";
import { usePlanEditor } from "@/lib/drawing/use-plan-editor";
import { PlanEditorPanel } from "@/components/drawing/plan-editor-panel";
import { PlanEditOverlay } from "@/components/drawing/plan-edit-overlay";
import { roomAtPoint, validOutline } from "@/lib/drawing/edit-geometry";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";

afterEach(cleanup);
const room: Room = { id: "room", drawingId: "drawing", name: "Office", type: "office", height: 3, area: 100, polygon: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], confirmed: false, source: "auto" };
const device: Device = { id: "device", drawingId: "drawing", roomId: "room", type: "smoke_detector", position: { x: 1, y: 1 }, layer: "SYS_FIRE_SENSORS" };
function setup(refresh = vi.fn().mockResolvedValue(undefined)) {
  const api = { regenerateDevices: vi.fn().mockResolvedValue(undefined), createRoom: vi.fn().mockResolvedValue(room), updateRoom: vi.fn().mockResolvedValue(room), deleteRoom: vi.fn().mockResolvedValue(undefined), confirmRooms: vi.fn().mockResolvedValue([room]), createDevice: vi.fn().mockResolvedValue(device), updateDevice: vi.fn().mockResolvedValue(device), deleteDevice: vi.fn().mockResolvedValue(undefined) };
  const selectRoom = vi.fn();
  const hook = renderHook(() => usePlanEditor({ drawingId: "drawing", rooms: [room], devices: [device], refresh, selectRoom, api }));
  return { ...hook, api, refresh, selectRoom };
}

it("validates outlines and assigns devices to concave rooms or no room", () => {
  expect(validOutline(room.polygon)).toBe(true);
  expect(validOutline([{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}])).toBe(false);
  expect(validOutline([...room.polygon, room.polygon[0]])).toBe(false);
  expect(validOutline([{x:0,y:0},{x:1,y:1},{x:2,y:2}])).toBe(false);
  expect(roomAtPoint([room], {x:5,y:5})).toBe("room");
  expect(roomAtPoint([room], {x:0,y:5})).toBe("room");
  expect(roomAtPoint([room], {x:15,y:5})).toBeNull();
});

it("cancels a moved vertex without making a request or mutating persisted rooms", () => {
  const { result, api } = setup();
  act(() => result.current.beginRoom(room));
  act(() => result.current.moveVertex(0, {x:2,y:2}));
  expect(room.polygon[0]).toEqual({x:0,y:0});
  act(() => result.current.cancel());
  expect(result.current.draft).toBeNull();
  expect(api.updateRoom).not.toHaveBeenCalled();
});

it("saves edited geometry, requires reconfirmation, refreshes and selects the room", async () => {
  const { result, api, refresh, selectRoom } = setup();
  act(() => result.current.beginRoom(room));
  act(() => result.current.moveVertex(0, {x:-1,y:0}));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.updateRoom).toHaveBeenCalledWith("room", {polygon:[{x:-1,y:0}, ...room.polygon.slice(1)], confirmed:false});
  expect(refresh).toHaveBeenCalledOnce();
  expect(selectRoom).toHaveBeenCalledWith("room");
});

it("creates a named room from clicked corners and rejects incomplete outlines", async () => {
  const { result, api } = setup();
  act(() => result.current.beginRoom());
  act(() => result.current.save());
  expect(api.createRoom).not.toHaveBeenCalled();
  act(() => { result.current.setName(" Нове "); room.polygon.forEach(p => result.current.addPoint(p)); });
  act(() => result.current.save());
  await waitFor(() => expect(result.current.draft).toBeNull());
  expect(api.createRoom).toHaveBeenCalledWith("drawing", {name:"Нове", polygon:room.polygon});
});

it("confirms one or all rooms through the dedicated endpoints", async () => {
  const { result, api } = setup();
  act(() => result.current.confirm("room"));
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.updateRoom).toHaveBeenCalledWith("room", {confirmed:true});
  act(() => result.current.confirmAll());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.confirmRooms).toHaveBeenCalledWith("drawing");
});

it("creates the selected device type and saves a moved device in DXF world coordinates", async () => {
  const { result, api } = setup();
  act(() => result.current.beginDevice());
  act(() => { result.current.setType("sounder"); result.current.setPosition({x:5,y:6}); });
  act(() => result.current.save());
  await waitFor(() => expect(result.current.draft).toBeNull());
  expect(api.createDevice).toHaveBeenCalledWith("drawing", {type:"sounder", position:{x:5,y:6}, roomId:"room"});
  act(() => result.current.beginDevice(device));
  act(() => result.current.setPosition({x:25,y:20}));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.draft).toBeNull());
  expect(api.updateDevice).toHaveBeenCalledWith("device", {type:"smoke_detector",position:{x:25,y:20},roomId:null});
});

it("does not delete until confirmed and can cancel deletion", async () => {
  const { result, api } = setup();
  act(() => result.current.requestDelete("room", "room"));
  expect(api.deleteRoom).not.toHaveBeenCalled();
  act(() => result.current.cancelDelete());
  act(() => result.current.deleteSelected());
  expect(api.deleteRoom).not.toHaveBeenCalled();
  act(() => result.current.requestDelete("device", "device"));
  act(() => result.current.deleteSelected());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(api.deleteDevice).toHaveBeenCalledWith("device");
});

it("prevents double submission and reconciles ambiguous writes before allowing retry", async () => {
  const { result, api, refresh } = setup();
  api.createDevice.mockRejectedValue(new Error("Device change saved, but result DXF regeneration failed"));
  act(() => result.current.beginDevice());
  act(() => result.current.setPosition({x:2,y:3}));
  act(() => { result.current.save(); result.current.save(); });
  await waitFor(() => expect(result.current.uncertain).toBe(true));
  expect(api.createDevice).toHaveBeenCalledOnce();
  act(() => result.current.save());
  expect(api.createDevice).toHaveBeenCalledOnce();
  await act(() => result.current.reconcile());
  expect(result.current.uncertain).toBe(false);
  expect(result.current.draft).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("does not repeat a successful create when refreshing the plan fails", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  const { result, api } = setup(refresh);
  act(() => result.current.beginDevice());
  act(() => result.current.setPosition({x:2,y:3}));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.uncertain).toBe(true));
  expect(result.current.draft).toBeNull();
  expect(api.createDevice).toHaveBeenCalledOnce();
});

it("shows the room and device controls and a real deletion confirmation", () => {
  const { result } = setup();
  const { rerender } = render(<PlanEditorPanel editor={result.current} rooms={[room]} devices={[device]} selectedRoomId="room" selectRoom={vi.fn()} devicesEditable disabled={false} />);
  fireEvent.click(screen.getByRole("button", {name:"Видалити приміщення"}));
  rerender(<PlanEditorPanel editor={result.current} rooms={[room]} devices={[device]} selectedRoomId="room" selectRoom={vi.fn()} devicesEditable disabled={false} />);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Прилади залишаться");
});

it("uses inverse viewport projection when adding and moving corners with keyboard", () => {
  const { result } = setup();
  const controller: DrawingViewportController = {
    worldToScreen: p => ({x:p.x*2+100,y:200-p.y*2}), screenToWorld:p => ({x:(p.x-100)/2,y:(200-p.y)/2}),
    subscribeViewportChange: () => () => {}, fitToDrawing:vi.fn(),zoomBy:vi.fn(),getViewport:()=>({center:{x:0,y:0},width:100}),
  };
  act(() => result.current.beginRoom(room));
  render(<PlanEditOverlay controller={controller} editor={result.current} />);
  fireEvent.keyDown(screen.getByRole("button", {name:"Вершина 1"}), {key:"ArrowUp",shiftKey:true});
  expect(result.current.draft?.kind === "room" && result.current.draft.points[0]).toEqual({x:0,y:5});
});
