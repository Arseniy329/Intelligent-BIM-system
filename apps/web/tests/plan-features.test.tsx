// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Room } from "@bim/contracts";
import { usePlanEditor } from "@/lib/drawing/use-plan-editor";
import { PlanFeaturesPanel } from "@/components/drawing/plan-features-panel";
import { PlanEditorPanel } from "@/components/drawing/plan-editor-panel";
import { planFeaturesApi, type RoomZone, type PlanExit } from "@/lib/drawing/plan-features-api";
import { ApiHttpError } from "@/lib/api";
import { getRoomBlockingReasons, mapContractRoomToRoom } from "@/types/rooms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoomsTable } from "@/components/rooms/rooms-table";

afterEach(cleanup);
it("edits a zone height in its own table row without changing its polygon or parent room", async () => {
  const updateZone = vi.fn().mockResolvedValue({ ...zone, height: 4.5 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const editor = usePlanEditor({ drawingId: "drawing", rooms: [room], devices: [], selectRoom: vi.fn(), refresh: async () => {}, featuresApi: { ...planFeaturesApi, updateZone } });
    return <RoomsTable rooms={[mapContractRoomToRoom(room)]} roomTypes={[]} zones={[zone]} zoneEditor={editor} onEditZone={item => editor.beginZone(room, item)} />;
  }
  render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  expect(screen.getByText("За зонами")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Змінити" }));
  fireEvent.change(screen.getByLabelText("Висота Низька, м"), { target: { value: "4.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
  await waitFor(() => expect(updateZone).toHaveBeenCalledWith(zone.id, { name: zone.name, height: 4.5, polygon: zone.polygon }));
  await waitFor(() => expect(screen.queryByLabelText("Висота Низька, м")).toBeNull());
});
it("uses zone heights without inventing a parent height or bypassing confirmation/type checks", () => {
  const mapped = mapContractRoomToRoom({...room, height:null});
  expect(getRoomBlockingReasons([mapped])).not.toEqual([]);
  expect(getRoomBlockingReasons([mapped], false, new Set([room.id]))).toEqual([]);
  expect(getRoomBlockingReasons([{...mapped, isConfirmed:false}], false, new Set([room.id]))).not.toEqual([]);
  expect(getRoomBlockingReasons([{...mapped, roomType:"unknown"}], false, new Set([room.id]))).not.toEqual([]);
});
const room: Room = { id: "room", drawingId: "drawing", name: "Office", type: "office", height: 3, area: 100, polygon: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], confirmed: true, source: "auto" };
const zone: RoomZone = { id: "zone", roomId: room.id, drawingId: "drawing", name: "Низька", height: 2.5, area: 50, polygon: [{x:0,y:0},{x:5,y:0},{x:5,y:10},{x:0,y:10}] };
function setup() {
  const featuresApi = { ...planFeaturesApi, createZone: vi.fn().mockResolvedValue(zone), updateZone: vi.fn().mockResolvedValue(zone), deleteZone: vi.fn().mockResolvedValue(undefined), createExit: vi.fn().mockResolvedValue({ id: "exit" }), deleteExit: vi.fn().mockResolvedValue(undefined) };
  const refresh = vi.fn().mockResolvedValue(undefined);
  return { ...renderHook(() => usePlanEditor({ drawingId: "drawing", rooms: [room], devices: [], refresh, selectRoom: vi.fn(), featuresApi })), featuresApi, refresh };
}
it("keeps zone fields and cancel reachable in the redesigned details card", () => {
  const { result, featuresApi } = setup();
  act(() => result.current.beginZone(room, zone));
  const props = { rooms: [room], devices: [], selectedRoomId: room.id, selectRoom: vi.fn(), devicesEditable: false, disabled: false };
  render(<PlanEditorPanel {...props} editor={result.current} />);
  fireEvent.change(screen.getByLabelText("Висота зони, м"), { target: { value: "4.5" } });
  expect(result.current.draft).toMatchObject({ kind: "zone", height: "4.5" });
  fireEvent.click(screen.getByRole("button", { name: "Скасувати зміни" }));
  expect(result.current.draft).toBeNull();
  expect(featuresApi.updateZone).not.toHaveBeenCalled();
});
it("keeps exit deletion errors and reconciliation inside the active modal", async () => {
  const { result, featuresApi } = setup();
  featuresApi.deleteExit.mockRejectedValueOnce(new Error("network"));
  act(() => result.current.requestDelete("exit", "exit"));
  const props = { rooms: [room], devices: [], selectedRoomId: room.id, selectRoom: vi.fn(), devicesEditable: false, disabled: false };
  const view = render(<PlanEditorPanel {...props} editor={result.current} />);
  fireEvent.click(screen.getByRole("button", { name: "Підтвердити видалення" }));
  await waitFor(() => expect(result.current.uncertain).toBe(true));
  view.rerender(<PlanEditorPanel {...props} editor={result.current} />);
  expect(screen.getByRole("alertdialog")).toContainElement(screen.getByRole("alert"));
  expect(screen.getByRole("alertdialog")).toContainElement(screen.getByRole("button", { name: "Оновити дані після помилки" }));
  expect(screen.getByRole("button", { name: "Підтвердити видалення" })).toBeDisabled();
});
it("creates successive zones under the same room with independent heights and no room writes", async () => {
  const {result, featuresApi} = setup();
  for (const height of [2.5, 4]) {
    act(() => result.current.beginZone(room));
    act(() => { result.current.setHeight(String(height)); zone.polygon.forEach(p => result.current.addPoint(p)); });
    act(() => result.current.save());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(featuresApi.createZone).toHaveBeenLastCalledWith(room.id, { name: null, height, polygon: zone.polygon });
  }
  expect(featuresApi.createZone).toHaveBeenCalledTimes(2);
});
it("rejects invalid geometry/heights locally, and cancels without a write", () => {
  const {result, featuresApi} = setup();
  act(() => result.current.beginZone(room));
  act(() => result.current.save());
  expect(featuresApi.createZone).not.toHaveBeenCalled();
  act(() => zone.polygon.forEach(p => result.current.addPoint(p)));
  for (const height of ["0", "-1", "101", "NaN"]) {
    act(() => result.current.setHeight(height));
    act(() => result.current.save());
    expect(featuresApi.createZone).not.toHaveBeenCalled();
  }
  act(() => result.current.cancel());
  expect(result.current.draft).toBeNull();
});
it("preserves a zone draft when server rejects containment or overlap, allowing correction", async () => {
  const {result, featuresApi} = setup();
  featuresApi.updateZone.mockRejectedValueOnce(new ApiHttpError(422, "Зони не повинні перекриватися"));
  act(() => result.current.beginZone(room, zone));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft?.kind).toBe("zone");
  expect(result.current.uncertain).toBe(false);
  act(() => result.current.setHeight("4"));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.draft).toBeNull());
});
it("blocks duplicate writes and requires reconciliation after an ambiguous failure", async () => {
  const {result, featuresApi} = setup();
  featuresApi.createZone.mockRejectedValueOnce(new Error("network"));
  act(() => result.current.beginZone(room));
  act(() => zone.polygon.forEach(p => result.current.addPoint(p)));
  act(() => { result.current.save(); result.current.save(); });
  await waitFor(() => expect(result.current.uncertain).toBe(true));
  expect(featuresApi.createZone).toHaveBeenCalledOnce();
  expect(result.current.draft).not.toBeNull();
  act(() => result.current.save());
  expect(featuresApi.createZone).toHaveBeenCalledOnce();
});
it("marks a door in WCS, keeps the source room intact and supports removing exits", async () => {
  const {result, featuresApi} = setup();
  act(() => result.current.beginExit());
  act(() => result.current.save());
  expect(featuresApi.createExit).not.toHaveBeenCalled();
  act(() => { result.current.addPoint({x:1000,y:2000}); result.current.setName("Двері"); });
  act(() => result.current.save());
  await waitFor(() => expect(result.current.draft).toBeNull());
  expect(featuresApi.createExit).toHaveBeenCalledWith("drawing", { name: "Двері", position: {x:1000,y:2000} });
  act(() => result.current.requestDelete("exit", "exit"));
  act(() => result.current.deleteSelected());
  await waitFor(() => expect(featuresApi.deleteExit).toHaveBeenCalledWith("exit"));
});
it("distinguishes no exits from loading/error and displays restored automatic exits", () => {
  const {result} = setup();
  const props = { editor: result.current, room, zones: [zone], exits: [] as PlanExit[], loading: false, error: false, disabled: false, retry: vi.fn() };
  const view = render(<PlanFeaturesPanel {...props} />);
  expect(screen.getByText("Позначте евакуаційні виходи")).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name:"Редагувати зону"}));
  expect(result.current.draft?.kind).toBe("zone");
  view.rerender(<PlanFeaturesPanel {...props} loading />);
  expect(screen.queryByText("Позначте евакуаційні виходи")).toBeNull();
  view.rerender(<PlanFeaturesPanel {...props} exits={[{id:"exit", drawingId:"drawing", roomId:null, name:"Вихід", position:{x:0,y:0}, source:"dxf"}]} />);
  expect(screen.getByText(/Автоматично · EXITS/)).toBeVisible();
});
