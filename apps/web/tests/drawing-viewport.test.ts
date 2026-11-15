import { describe, expect, it, vi } from "vitest";
import { Color, LineSegments, Mesh, OrthographicCamera, RawShaderMaterial, Scene, Vector2 } from "three";
import tokens from "../../../tokens.json";
import { DrawingViewerAdapter, type ViewerPort } from "@/lib/drawing/viewer-adapter";
import { DRAWING_FONT_URLS } from "@/lib/drawing/fonts";

function makeViewer(load: () => Promise<void> = async () => {}) {
  const camera = new OrthographicCamera(-100, 100, 50, -50, 0.1, 2);
  camera.position.set(20, 30, 1);
  camera.zoom = 2;
  const events = new Map<string, Set<(event: unknown) => void>>();
  const origin = new Vector2(1000, -2000);
  const scene = new Scene();
  let pixelRatio = 1;
  const renderer = { getPixelRatio: () => pixelRatio, setPixelRatio: vi.fn((value: number) => { pixelRatio = value; }) };
  const viewer: ViewerPort = {
    Load: vi.fn(load),
    Destroy: vi.fn(),
    GetOrigin: () => origin,
    GetBounds: () => ({ minX: 900, maxX: 1100, minY: -2050, maxY: -1950 }),
    GetCamera: () => camera,
    GetScene: () => scene,
    GetRenderer: () => renderer,
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
  return { viewer, adapter, camera, detach, emit, scene, renderer };
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
    expect(viewer.Render).toHaveBeenCalledTimes(2); // Palette after Load, then fit.
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

  it("mutes shared line and glyph materials without replacing geometry or shaders", async () => {
    const { adapter, scene } = makeViewer();
    const material = new RawShaderMaterial({ uniforms: { color: { value: new Color("red") } } });
    const line = new LineSegments(undefined, material);
    const glyph = new Mesh(undefined, material);
    const geometry = glyph.geometry;
    const shader = material.vertexShader;
    scene.add(line, glyph);
    await adapter.load("blob:coloured-text");
    expect(material.uniforms.color.value.getHexString()).toBe(tokens.color.plan.dxfPrimaryLine.slice(1).toLowerCase());
    expect(glyph.geometry).toBe(geometry);
    expect(glyph.material).toBe(material);
    expect(material.vertexShader).toBe(shader);
    adapter.dispose();
  });

  it("updates DPR 1 → 2 → 1 without loading or changing camera/CSS mappings", async () => {
    const { adapter, viewer, renderer } = makeViewer();
    await adapter.load("blob:test");
    const viewport = adapter.getViewport();
    const point = adapter.worldToScreen({ x: 1025, y: -1990 });
    adapter.setPixelRatio(2);
    adapter.setPixelRatio(2);
    adapter.setPixelRatio(1);
    adapter.setPixelRatio(0);
    adapter.setPixelRatio(NaN);
    expect(renderer.setPixelRatio.mock.calls).toEqual([[2], [1]]);
    expect(adapter.getViewport()).toEqual(viewport);
    expect(adapter.worldToScreen({ x: 1025, y: -1990 })).toEqual(point);
    expect(viewer.Load).toHaveBeenCalledOnce();
    expect(viewer.SetSize).not.toHaveBeenCalled();
    expect(viewer.SetView).not.toHaveBeenCalled();
    adapter.dispose();
    adapter.setPixelRatio(2);
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2);
  });
});
