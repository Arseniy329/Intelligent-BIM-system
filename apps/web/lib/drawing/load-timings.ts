import type { DxfViewerLoadParams } from "dxf-viewer";

type Phase = "read" | "parse" | "font" | "prepareAndRender";

export const LOAD_PHASE_LABELS: Record<Phase, string> = {
  read: "Читання та декодування DXF (до початку парсингу)",
  parse: "Парсинг DXF (до початку побудови сцени)",
  font: "Очікування fetch/ArrayBuffer шрифту",
  prepareAndRender: "Побудова сцени, обробка шрифту, об’єкти Three.js і перший render",
};

export type DrawingLoadTimings = {
  outcome: "ready" | "error" | "cancelled";
  rendererInitMs: number;
  loadMs: number;
  phases: Partial<Record<Phase, number>>;
  fontRequests: number;
};

/** Log only known numeric metrics and a fixed outcome; never spread input or errors. */
export function logDrawingLoadTimings(timings?: DrawingLoadTimings): void {
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const outcome = timings?.outcome === "ready" || timings?.outcome === "cancelled"
    ? timings.outcome : "error";
  const phases: DrawingLoadTimings["phases"] = {};
  for (const phase of Object.keys(LOAD_PHASE_LABELS) as Phase[]) {
    const ms = numeric(timings?.phases?.[phase]);
    if (ms !== undefined) phases[phase] = ms;
  }
  console.info("[DrawingViewer load]", {
    outcome,
    rendererInitMs: numeric(timings?.rendererInitMs),
    loadMs: numeric(timings?.loadMs),
    fontRequests: numeric(timings?.fontRequests),
    phases,
  });
}

/** Intervals at public progress callbacks, not independent CPU/GPU profiling.
 * In 1.0.50 `prepare` resumes BEFORE opentype.parse; repeated prepare callbacks
 * must not discard earlier scene-building intervals. `fetch` is a chunk event.
 */
export function measureDrawingLoad() {
  const started = performance.now();
  let boundary = started;
  let current: Phase = "read";
  let fontRequests = 0;
  const phases: DrawingLoadTimings["phases"] = {};
  const record = (now: number) => {
    phases[current] = (phases[current] ?? 0) + now - boundary;
    boundary = now;
  };

  const progress: NonNullable<DxfViewerLoadParams["progressCbk"]> = (phase) => {
    if (phase === "fetch") return;
    const next: Phase = phase === "prepare" ? "prepareAndRender" : phase;
    if (phase === "font") fontRequests++;
    if (next === current) return;
    record(performance.now());
    current = next;
  };

  return {
    progress,
    finish(rendererInitMs: number, outcome: DrawingLoadTimings["outcome"]): DrawingLoadTimings {
      const finished = performance.now();
      record(finished);
      return { outcome, rendererInitMs, loadMs: finished - started, phases: { ...phases }, fontRequests };
    },
  };
}
