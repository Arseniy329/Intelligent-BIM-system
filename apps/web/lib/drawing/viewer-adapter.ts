import { DxfViewer, type DxfViewerLoadParams } from "dxf-viewer";
import { Color, Vector3 } from "three";
import tokens from "../../../../tokens.json";
import { DRAWING_FONT_URLS } from "./fonts";

export type DrawingPoint = Readonly<{ x: number; y: number }>;
export type DrawingViewport = Readonly<{
  /** Centre in original DXF WCS, without conversion between metres and millimetres. */
  center: DrawingPoint;
  width: number;
}>;

export interface DrawingViewportController {
  fitToDrawing(): void;
  zoomBy(factor: number): void;
  getViewport(): DrawingViewport;
  worldToScreen(point: DrawingPoint): DrawingPoint;
  screenToWorld(point: DrawingPoint): DrawingPoint;
  subscribeViewportChange(listener: () => void): () => void;
}

/** Narrow public library boundary also used by the camera/lifecycle tests. */
export type ViewerPort = Pick<
  DxfViewer,
  | "Load" | "Destroy" | "GetOrigin" | "GetBounds" | "GetCamera"
  | "SetView" | "FitView" | "Render" | "SetSize"
  | "SceneToCanvasCoord" | "CanvasToSceneCoord" | "Subscribe" | "Unsubscribe"
>;

export class DrawingViewerAdapter implements DrawingViewportController {
  private ready = false;
  private loading = false;
  private disposed = false;
  private released = false;
  private readonly listeners = new Set<() => void>();
  private readonly notify = () => {
    if (this.ready && !this.disposed) {
      this.listeners.forEach((listener) => listener());
    }
  };

  constructor(private readonly viewer: ViewerPort, private readonly detach: () => void = () => {}) {
    viewer.Subscribe("viewChanged", this.notify);
    viewer.Subscribe("resized", this.notify);
  }

  async load(url: string, progressCbk?: DxfViewerLoadParams["progressCbk"]): Promise<void> {
    if (this.disposed || this.loading || this.ready) {
      throw new Error("Для нового креслення створіть новий переглядач.");
    }
    this.loading = true;
    try {
      // dxf-viewer converts these font outlines into TEXT/MTEXT geometry in DXF space.
      // A fresh array is supplied for each load; the library consumes its font fetchers.
      await this.viewer.Load({ url, fonts: [...DRAWING_FONT_URLS], progressCbk });
      if (this.disposed) return;
      if (!this.viewer.GetBounds()) {
        throw new Error("DXF не містить геометрії для відображення.");
      }
      this.ready = true;
      this.notify();
    } finally {
      this.loading = false;
      if (this.disposed) this.release();
    }
  }

  fitToDrawing(): void {
    this.ensureReady();
    const bounds = this.viewer.GetBounds();
    if (!bounds) return;
    const origin = this.viewer.GetOrigin();
    // GetBounds is WCS; FitView expects coordinates relative to the scene origin.
    this.viewer.FitView(
      bounds.minX - origin.x, bounds.maxX - origin.x,
      bounds.minY - origin.y, bounds.maxY - origin.y,
    );
    this.viewer.Render();
  }

  zoomBy(factor: number): void {
    this.ensureReady();
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("Некоректний масштаб.");
    const camera = this.viewer.GetCamera();
    const width = (camera.right - camera.left) / camera.zoom / factor;
    if (!Number.isFinite(width) || width < 1e-6 || width > 1e15) return;
    this.viewer.SetView(new Vector3(camera.position.x, camera.position.y, 0), width);
    this.viewer.Render();
  }

  getViewport(): DrawingViewport {
    this.ensureReady();
    const camera = this.viewer.GetCamera();
    const origin = this.viewer.GetOrigin();
    return {
      center: { x: camera.position.x + origin.x, y: camera.position.y + origin.y },
      width: (camera.right - camera.left) / camera.zoom,
    };
  }

  /** Screen coordinates are CSS pixels relative to the canvas, not device pixels. */
  worldToScreen(point: DrawingPoint): DrawingPoint {
    this.ensureReady();
    const origin = this.viewer.GetOrigin();
    return this.viewer.SceneToCanvasCoord(point.x - origin.x, point.y - origin.y);
  }

  screenToWorld(point: DrawingPoint): DrawingPoint {
    this.ensureReady();
    const scene = this.viewer.CanvasToSceneCoord(point.x, point.y);
    const origin = this.viewer.GetOrigin();
    return { x: scene.x + origin.x, y: scene.y + origin.y };
  }

  subscribeViewportChange(listener: () => void): () => void {
    if (this.disposed) throw new Error("Переглядач уже закрито.");
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.viewer.SetSize(Math.floor(width), Math.floor(height));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.listeners.clear();
    this.viewer.Unsubscribe("viewChanged", this.notify);
    this.viewer.Unsubscribe("resized", this.notify);
    this.detach();
    // Load has no AbortSignal and can still touch the renderer after awaiting parsing.
    // Detach immediately, but release WebGL only after that pending load has settled.
    if (!this.loading) this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.viewer.Destroy();
  }

  private ensureReady(): void {
    if (!this.ready || this.disposed) throw new Error("Переглядач ще не готовий або вже закритий.");
  }
}

export function createDrawingViewerAdapter(container: HTMLElement): DrawingViewerAdapter {
  const viewer = new DxfViewer(container, {
    autoResize: false,
    canvasWidth: Math.max(container.clientWidth, 1),
    canvasHeight: Math.max(container.clientHeight, 1),
    clearColor: new Color(tokens.color.plan.background),
    antialias: true,
  });
  if (!viewer.HasRenderer()) {
    throw new Error("WebGL недоступний. Перевірте підтримку апаратного прискорення у браузері.");
  }

  const canvas = viewer.GetCanvas();
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) adapter.resize(entry.contentRect.width, entry.contentRect.height);
  });
  const adapter = new DrawingViewerAdapter(viewer, () => {
    observer.disconnect();
    canvas.remove();
  });
  observer.observe(container);
  return adapter;
}
