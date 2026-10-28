import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { DxfFetcher } from "dxf-viewer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Device, Room } from "@bim/contracts";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import { isFinitePoint, observeOverlayViewport, projectDevice, projectRoom, roomLabelPlacement } from "@/lib/drawing/overlay-geometry";
import { DEMO_DXF, DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import { DEVICE_LABELS, DeviceSymbol } from "@/components/drawing/device-symbol";
import { DrawingToolbar } from "@/components/drawing/drawing-toolbar";

function makeController() {
  const view = { x: 1000, y: -2000, scale: 0.1, width: 800, height: 600 };
  const listeners = new Set<() => void>();
  const controller: DrawingViewportController = {
    worldToScreen: vi.fn((point) => ({ x: (point.x - view.x) * view.scale + view.width / 2, y: view.height / 2 - (point.y - view.y) * view.scale })),
    screenToWorld: (point) => ({ x: (point.x - view.width / 2) / view.scale + view.x, y: (view.height / 2 - point.y) / view.scale + view.y }),
    getViewport: () => ({ center: { x: view.x, y: view.y }, width: view.width / view.scale }),
    subscribeViewportChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    zoomBy: (factor) => { view.scale *= factor; }, fitToDrawing: vi.fn(),
  };
  return { controller, view, listeners };
}

afterEach(() => vi.unstubAllGlobals());

describe("BIM-60 overlay", () => {
  it("ships the exact DXF fixture and rooms matching every closed polyline and its area", async () => {
    const original = await readFile(new URL("../../api/tests/fixtures/test_drawing_dxf/01_simple_rooms_mm.dxf", import.meta.url), "utf8");
    expect(DEMO_DXF.replaceAll("\r\n", "\n").trim()).toBe(original.replaceAll("\r\n", "\n").trim());
    const url = URL.createObjectURL(new Blob([DEMO_DXF]));
    try {
      const parsed = await new DxfFetcher(url).Fetch() as { entities: { type: string; shape?: boolean; vertices: { x: number; y: number }[] }[] };
      const contours = parsed.entities.filter((entity) => entity.type === "LWPOLYLINE");
      expect(contours).toHaveLength(DEMO_RESULT.rooms.length);
      DEMO_RESULT.rooms.forEach((room, index) => {
        expect(contours[index].shape).toBe(true);
        expect(contours[index].vertices.map(({ x, y }) => ({ x, y }))).toEqual(room.polygon);
        const twiceArea = room.polygon.reduce((sum, a, i, points) => {
          const b = points[(i + 1) % points.length];
          return sum + a.x * b.y - a.y * b.x;
        }, 0);
        expect(Math.abs(twiceArea) / 2e6).toBe(room.area);
      });
    } finally { URL.revokeObjectURL(url); }
  });

  it("projects WCS directly, preserving mm and the inverted screen Y axis", () => {
    const { controller } = makeController();
    expect(projectRoom(DEMO_RESULT.rooms[0], controller)).toEqual([
      { x: 300, y: 100 }, { x: 700, y: 100 }, { x: 700, y: -400 }, { x: 300, y: -400 },
    ]);
    expect(projectDevice(DEMO_RESULT.devices[0], controller)).toEqual({ x: 500, y: -250 });
    expect(controller.worldToScreen).toHaveBeenCalledWith({ x: 2000, y: 3500 });
  });

  it("reprojects vertices and device anchors after pan, zoom and resize with no drift", () => {
    const { controller, view } = makeController();
    for (const change of [() => { view.x += 500; view.y -= 300; }, () => controller.zoomBy(2), () => { view.width = 1200; view.height = 800; }]) {
      change();
      const point = projectDevice(DEMO_RESULT.devices[0], controller)!;
      expect(controller.screenToWorld(point)).toEqual(DEMO_RESULT.devices[0].position);
      projectRoom(DEMO_RESULT.rooms[0], controller)!.forEach((p, index) => {
        expect(controller.screenToWorld(p)).toEqual(DEMO_RESULT.rooms[0].polygon[index]);
      });
    }
  });

  it("skips malformed coordinates and accepts null names and room references", () => {
    const { controller } = makeController();
    for (const invalid of [null, undefined, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      expect(isFinitePoint(invalid)).toBe(false);
      expect(projectDevice({ ...DEMO_RESULT.devices[0], position: invalid } as Device, controller)).toBeNull();
    }
    for (const polygon of [[], [{ x: 0, y: 0 }], [null, {}, {}], [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 1 }]]) {
      expect(projectRoom({ ...DEMO_RESULT.rooms[0], polygon } as Room, controller)).toBeNull();
    }
    expect(projectRoom({ ...DEMO_RESULT.rooms[0], name: null }, controller)).not.toBeNull();
    for (const roomId of [null, "missing"]) expect(projectDevice({ ...DEMO_RESULT.devices[0], roomId }, controller)).not.toBeNull();
    controller.worldToScreen = () => ({ x: Infinity, y: 0 });
    expect(projectRoom(DEMO_RESULT.rooms[0], controller)).toBeNull();
    expect(projectDevice(DEMO_RESULT.devices[0], controller)).toBeNull();
  });

  it("places a label inside a concave U instead of its empty centre, bounded by the viewport", () => {
    const points = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 220, y: 300 }, { x: 220, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 300 }, { x: 0, y: 300 }];
    const label = roomLabelPlacement(points, { width: 300, height: 300 })!;
    expect(label.x < 80 || label.x > 220 || label.y < 80).toBe(true);
    expect(label.x - label.width / 2).toBeGreaterThanOrEqual(8);
    expect(label.x + label.width / 2).toBeLessThanOrEqual(292);
    expect(roomLabelPlacement(points.map((p) => ({ x: p.x + 1000, y: p.y })), { width: 300, height: 300 })).toBeNull();
    expect(roomLabelPlacement([{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], { width: 300, height: 300 })).toBeNull();
  });

  it("batches viewport events and cancels subscriptions/frames on unmount, retry or replacement", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const { controller, listeners } = makeController();
    const update = vi.fn();
    for (let mount = 0; mount < 3; mount++) {
      const cleanup = observeOverlayViewport(controller, update);
      listeners.forEach((listener) => { listener(); listener(); });
      expect(frames.size).toBe(1);
      const [id, callback] = [...frames][0]; frames.delete(id); callback(0);
      expect(update).toHaveBeenCalledTimes(mount + 1);
      listeners.forEach((listener) => listener());
      cleanup();
      expect(listeners.size).toBe(0);
      expect(frames.size).toBe(0);
    }
  });

  it("keeps the entire label box inside sloped walls at different zoom levels", () => {
    for (const scale of [0.5, 1, 2]) {
      const triangle = [{ x: 20, y: 20 }, { x: 20 + 400 * scale, y: 20 }, { x: 20, y: 20 + 400 * scale }];
      const label = roomLabelPlacement(triangle, { width: 1000, height: 1000 })!;
      expect(label).not.toBeNull();
      // For this triangle every corner must satisfy x + y <= 40 + 400 * scale.
      expect(label.x + label.width / 2 + label.y + label.height / 2).toBeLessThan(40 + 400 * scale);
      expect(label.x - label.width / 2).toBeGreaterThan(20);
      expect(label.y - label.height / 2).toBeGreaterThan(20);
    }
  });

  it("does not straddle a narrow concave notch between the top and bottom scanlines", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 60 }, { x: 40, y: 60 },
      { x: 40, y: 65 }, { x: 300, y: 65 }, { x: 300, y: 200 }, { x: 0, y: 200 }];
    const label = roomLabelPlacement(polygon, { width: 320, height: 220 })!;
    expect(label).not.toBeNull();
    expect(label.y + label.height / 2 < 60 || label.y - label.height / 2 > 65 || label.x + label.width / 2 < 40).toBe(true);
  });

  it("omits labels without readable room space and fits partially visible rooms", () => {
    expect(roomLabelPlacement([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 }], { width: 300, height: 300 })).toBeNull();
    const label = roomLabelPlacement([{ x: -100, y: -100 }, { x: 300, y: -100 }, { x: 300, y: 300 }, { x: -100, y: 300 }], { width: 160, height: 120 })!;
    expect(label.x - label.width / 2).toBeGreaterThanOrEqual(8);
    expect(label.x + label.width / 2).toBeLessThanOrEqual(152);
    expect(label.y - label.height / 2).toBeGreaterThanOrEqual(8);
    expect(label.y + label.height / 2).toBeLessThanOrEqual(112);
  });

  it("anchors the label to room geometry and follows pan without changing its size", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    const previous = roomLabelPlacement(polygon, { width: 800, height: 600 })!;
    const label = roomLabelPlacement(polygon.map((p) => ({ x: p.x + 100, y: p.y + 50 })), { width: 800, height: 600 })!;
    expect(label).toEqual({ ...previous, x: previous.x + 100, y: previous.y + 50 });
  });

  it("provides four distinct replaceable SVG symbols and human labels", () => {
    const symbols = DEMO_RESULT.devices.map((device) => renderToStaticMarkup(<DeviceSymbol type={device.type} />));
    expect(new Set(symbols).size).toBe(4);
    for (const device of DEMO_RESULT.devices) expect(DEVICE_LABELS[device.type]).toBeTruthy();
  });

  it("exposes independent pressed states and omits controls for absent layers", () => {
    const base = { disabled: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFit: vi.fn() };
    const markup = renderToStaticMarkup(<DrawingToolbar {...base} roomsLayer={{ visible: false, toggle: vi.fn() }} devicesLayer={{ visible: true, toggle: vi.fn() }} />);
    expect(markup).toContain('aria-pressed="false">Приміщення');
    expect(markup).toContain('aria-pressed="true">Сповіщувачі');
    expect(renderToStaticMarkup(<DrawingToolbar {...base} />)).not.toContain("aria-pressed");
    const labels = renderToStaticMarkup(<DrawingToolbar {...base} roomsLayer={{ visible: true, toggle: vi.fn() }} roomLabels={{ visible: false, toggle: vi.fn() }} />);
    expect(labels).toContain('aria-pressed="false"');
    expect(labels).toContain('Підписи</button>');
  });
});
