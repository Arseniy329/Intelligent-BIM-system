import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Vector2 } from "three";
import { DrawingViewerAdapter, type ViewerPort } from "@/lib/drawing/viewer-adapter";
import { DRAWING_FONT_URLS } from "@/lib/drawing/fonts";

function makeViewer(load: () => Promise<void> = async () => {}) {
  const camera = new OrthographicCamera(-100, 100, 50, -50, 0.1, 2);
  camera.position.set(20, 30, 1);
  camera.zoom = 2;
  const events = new Map<string, Set<(event: unknown) => void>>();
  const origin = new Vector2(1000, -2000);
  const viewer: ViewerPort = {
    Load: vi.fn(load),
    Destroy: vi.fn(),
    GetOrigin: () => origin,
    GetBounds: () => ({ minX: 900, maxX: 1100, minY: -2050, maxY: -1950 }),
    GetCamera: () => camera,
    SetView: vi.fn(),
    FitView: vi.fn(),
    Render: vi.fn(),
    SetSize: vi.fn(),
    // Representative invertible CSS-pixel mapping, including the Y-axis inversion.
    SceneToCanvasCoord: (x, y) => ({ x: 400 + x * 2, y: 300 - y * 2 }),
    CanvasToSceneCoord: (x, y) => ({ x: (x - 400) / 2, y: (300 - y) / 2 }),
    Subscribe: (name, listener) => {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name)!.add(listener);
    },
    Unsubscribe: (name, listener) => { events.get(name)?.delete(listener); },
  };
  const detach = vi.fn();
  const adapter = new DrawingViewerAdapter(viewer, detach);
  const emit = (name: string) => events.get(name)?.forEach((listener) => listener({}));
  return { viewer, adapter, camera, detach, emit };
}

describe("drawing viewport adapter", () => {
  it("supplies the self-hosted font again after closing and reopening a drawing", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { adapter, viewer } = makeViewer();
      await adapter.load("blob:text-drawing");
      expect(viewer.Load).toHaveBeenCalledWith({
        url: "blob:text-drawing", fonts: [...DRAWING_FONT_URLS], progressCbk: undefined,
      });
      adapter.dispose();
      expect(viewer.Destroy).toHaveBeenCalledOnce();
    }
  });

  it("keeps DXF WCS coordinates reversible with a nonzero scene origin", async () => {
    const { adapter } = makeViewer();
    await adapter.load("blob:test");
    const world = { x: 1025, y: -1990 };
    expect(adapter.worldToScreen(world)).toEqual({ x: 450, y: 280 });
    expect(adapter.screenToWorld(adapter.worldToScreen(world))).toEqual(world);
    adapter.dispose();
  });

  it("converts WCS bounds to scene bounds for fit", async () => {
    const { adapter, viewer } = makeViewer();
    await adapter.load("blob:test");
    adapter.fitToDrawing();
    expect(viewer.FitView).toHaveBeenCalledWith(-100, 100, -50, 50);
    expect(viewer.Render).toHaveBeenCalledOnce();
    adapter.dispose();
  });

  it("zooms from the effective camera width after mouse wheel zoom", async () => {
    const { adapter, viewer } = makeViewer();
    await adapter.load("blob:test");
    expect(adapter.getViewport()).toEqual({ center: { x: 1020, y: -1970 }, width: 100 });
    adapter.zoomBy(2);
    const [center, width] = vi.mocked(viewer.SetView).mock.calls[0];
    expect({ x: center.x, y: center.y, width }).toEqual({ x: 20, y: 30, width: 50 });
    expect(() => adapter.zoomBy(0)).toThrow(RangeError);
    adapter.dispose();
  });

  it("forwards camera and resize events and removes subscriptions on disposal", async () => {
    const { adapter, emit, detach, viewer } = makeViewer();
    await adapter.load("blob:test");
    const listener = vi.fn();
    const unsubscribe = adapter.subscribeViewportChange(listener);
    emit("viewChanged");
    emit("resized");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    emit("viewChanged");
    expect(listener).toHaveBeenCalledTimes(2);
    adapter.subscribeViewportChange(listener);
    adapter.dispose();
    adapter.dispose();
    emit("viewChanged");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(detach).toHaveBeenCalledOnce();
    expect(viewer.Destroy).toHaveBeenCalledOnce();
    expect(() => adapter.getViewport()).toThrow();
  });

  it("detaches immediately but does not destroy a renderer still used by Load", async () => {
    let finish!: () => void;
    const { adapter, viewer, detach } = makeViewer(() => new Promise<void>((resolve) => { finish = resolve; }));
    const loading = adapter.load("blob:test");
    adapter.dispose();
    expect(detach).toHaveBeenCalledOnce();
    expect(viewer.Destroy).not.toHaveBeenCalled();
    finish();
    await loading;
    expect(viewer.Destroy).toHaveBeenCalledOnce();
    expect(() => adapter.worldToScreen({ x: 0, y: 0 })).toThrow();
  });

  it("releases resources when a disposed pending load rejects", async () => {
    let fail!: (error: Error) => void;
    const { adapter, viewer } = makeViewer(() => new Promise<void>((_, reject) => { fail = reject; }));
    const loading = adapter.load("blob:test");
    adapter.dispose();
    fail(new Error("Invalid DXF"));
    await expect(loading).rejects.toThrow("Invalid DXF");
    expect(viewer.Destroy).toHaveBeenCalledOnce();
  });

  it("ignores hidden containers and resize after disposal", async () => {
    const { adapter, viewer } = makeViewer();
    await adapter.load("blob:test");
    adapter.resize(0, 0);
    expect(viewer.SetSize).not.toHaveBeenCalled();
    adapter.resize(800.8, 600.5);
    expect(viewer.SetSize).toHaveBeenCalledExactlyOnceWith(800, 600);
    adapter.dispose();
    adapter.resize(900, 700);
    expect(viewer.SetSize).toHaveBeenCalledTimes(1);
  });
});
