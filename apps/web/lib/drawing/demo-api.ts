import type { DrawingDetailResponse, DrawingResult, ProcessingJob } from "@bim/contracts";
import { DEMO_RESULT } from "./demo-drawing";
import { isDrawingDemoEnabled } from "./demo-mode";
import { DrawingApiError, type DrawingApi, type DrawingResponse } from "./drawing-api";

export const DEMO_DRAWING_IDS = ["demo-uploaded", "demo-ready", "demo-empty", "demo-no-devices", "demo-error", "demo-expired", "demo-missing", "demo-401", "demo-403", "demo-404", "demo-network"] as const;

export function createDemoDrawingApi(sourceUrl: string): DrawingApi {
  if (!isDrawingDemoEnabled()) throw new Error("Drawing demo is disabled.");
  const jobs = new Map<string, { job: ProcessingJob; readyAt: number }>();
  let sequence = 0;
  const drawings = new Map<string, DrawingResponse>();
  const result = (id: string): DrawingResult => ({
    ...DEMO_RESULT,
    drawing: { ...DEMO_RESULT.drawing, id, originalFileName: `${id}.dxf` },
    rooms: id === "demo-empty" ? [] : DEMO_RESULT.rooms.map(room => ({ ...room, drawingId: id })),
    devices: id === "demo-empty" || id === "demo-no-devices" ? [] : DEMO_RESULT.devices.map(device => ({ ...device, drawingId: id })),
    // No generated DXF exists in this fixture. Do not label its original as a result.
    downloadUrl: null, downloadUrlExpiresAt: null,
  });
  const detail = (id: string): DrawingDetailResponse => ({
    id, ownerId: "local-demo", originalFileName: `${id}.dxf`, storagePath: "demo/01_simple_rooms_mm.dxf",
    units: "mm", status: "uploaded", createdAt: DEMO_RESULT.drawing.createdAt,
    sourceDownloadUrl: id === "demo-missing" ? null : sourceUrl,
    sourceDownloadUrlExpiresAt: new Date(Date.now() + (id === "demo-expired" ? -1000 : 3600000)).toISOString(),
  });
  return {
    async getDrawing(id, signal) {
      signal?.throwIfAborted();
      if (!isDrawingDemoEnabled()) throw new Error("Drawing demo is disabled.");
      if (["demo-401", "demo-403", "demo-404"].includes(id)) throw new DrawingApiError(Number(id.slice(-3)));
      if (id === "demo-network") throw new TypeError("Demo network failure");
      if (!(DEMO_DRAWING_IDS as readonly string[]).includes(id)) throw new DrawingApiError(404);
      if (!drawings.has(id)) drawings.set(id, detail(id));
      return structuredClone(drawings.get(id)!);
    },
    async processDrawing(id, signal) {
      signal?.throwIfAborted();
      const current = drawings.get(id);
      if (!current) throw new DrawingApiError(404);
      if ([...jobs.values()].some(({ job }) => job.drawingId === id && job.status === "queued")) throw new DrawingApiError(409);
      const job: ProcessingJob = { id: `demo-job-${++sequence}`, drawingId: id, status: "queued", errorMessage: null };
      drawings.set(id, { ...detail(id), status: "processing" });
      jobs.set(job.id, { job, readyAt: Date.now() + 1500 });
      return { ...job };
    },
    async getJob(id, signal) {
      signal?.throwIfAborted();
      const entry = jobs.get(id);
      if (!entry) throw new DrawingApiError(404);
      if (Date.now() >= entry.readyAt) {
        entry.job.status = entry.job.drawingId === "demo-error" ? "failed" : "completed";
        drawings.set(entry.job.drawingId, entry.job.status === "failed" ? { ...detail(entry.job.drawingId), status: "error" } : result(entry.job.drawingId));
      }
      return { ...entry.job };
    },
  };
}
