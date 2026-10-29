import type { DrawingDetailResponse, DrawingResult, ProcessingJob } from "@bim/contracts";
import { apiFetch, ApiAuthenticationError, ApiConfigurationError } from "@/lib/api";
import { isDrawingDemoEnabled } from "./demo-mode";

// Both GET shapes exist in BIM-61. BIM-47 must settle the final response envelope.
export type DrawingResponse = DrawingDetailResponse | DrawingResult;
export interface DrawingApi {
  getDrawing(id: string, signal?: AbortSignal): Promise<DrawingResponse>;
  processDrawing(id: string, signal?: AbortSignal): Promise<ProcessingJob>;
  getJob(id: string, signal?: AbortSignal): Promise<ProcessingJob>;
}

export class DrawingApiError extends Error {
  constructor(public readonly status: number) {
    super(`Drawing request failed (${status}).`);
  }
}

export function drawingErrorMessage(error: unknown): string {
  if (error instanceof ApiAuthenticationError || error instanceof DrawingApiError && error.status === 401)
    return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
  if (error instanceof DrawingApiError) {
    if (error.status === 403) return "У вас немає доступу до цього креслення.";
    if (error.status === 404) return "Креслення або задачу обробки не знайдено.";
    if (error.status === 409) return "Обробку вже запущено. Оновіть стан креслення.";
    if (error.status === 501) return "Обробка ще недоступна. Спробуйте пізніше.";
  }
  if (error instanceof ApiConfigurationError) return "З’єднання з API не налаштовано.";
  if (error instanceof DrawingFileError) return error.message;
  return "Не вдалося отримати дані. Перевірте з’єднання та спробуйте ще раз.";
}

export function isDrawingResult(data: DrawingResponse): data is DrawingResult {
  return "drawing" in data;
}

export function drawingMetadata(data: DrawingResponse) {
  return isDrawingResult(data) ? data.drawing : data;
}

async function request(path: string, signal?: AbortSignal, method = "GET"): Promise<unknown> {
  const response = await apiFetch(path, { method, signal, cache: "no-store" });
  if (!response.ok) throw new DrawingApiError(response.status);
  return response.json();
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const statuses = ["pending", "uploaded", "processing", "processed", "error"];

export function parseDrawing(value: unknown, id: string): DrawingResponse {
  if (!record(value)) throw new Error("Invalid drawing response.");
  const drawing = record(value.drawing) ? value.drawing : value;
  if (drawing.id !== id || typeof drawing.originalFileName !== "string" || !statuses.includes(String(drawing.status)))
    throw new Error("Invalid drawing metadata.");
  if ("drawing" in value) {
    if (!Array.isArray(value.rooms) || !Array.isArray(value.devices) ||
      !value.rooms.every(room => record(room) && room.drawingId === id && typeof room.id === "string" &&
        typeof room.area === "number" && Number.isFinite(room.area) && room.area >= 0 &&
        Array.isArray(room.polygon) && room.polygon.length >= 3 && room.polygon.every(validPoint)) ||
      !value.devices.every(device => record(device) && device.drawingId === id && typeof device.id === "string" &&
        ["smoke_detector", "heat_detector", "sounder", "manual_call_point"].includes(String(device.type)) && validPoint(device.position)))
      throw new Error("Invalid drawing result.");
  }
  return value as unknown as DrawingResponse;
}

function validPoint(point: unknown): boolean {
  return record(point) && typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y);
}

export function parseJob(value: unknown): ProcessingJob {
  if (!record(value) || typeof value.id !== "string" || typeof value.drawingId !== "string" ||
    !["queued", "processing", "completed", "failed"].includes(String(value.status)) ||
    !(value.errorMessage === null || typeof value.errorMessage === "string")) throw new Error("Invalid processing job.");
  return value as unknown as ProcessingJob;
}

export const drawingApi: DrawingApi = {
  async getDrawing(id, signal) {
    return parseDrawing(await request(`/drawings/${encodeURIComponent(id)}`, signal), id);
  },
  async processDrawing(id, signal) {
    const job = parseJob(await request(`/drawings/${encodeURIComponent(id)}/process`, signal, "POST"));
    if (job.drawingId !== id) throw new Error("Processing job belongs to another drawing.");
    return job;
  },
  async getJob(id, signal) {
    const job = parseJob(await request(`/processing-jobs/${encodeURIComponent(id)}`, signal));
    if (job.id !== id) throw new Error("Unexpected processing job.");
    return job;
  },
};

export class DrawingFileError extends Error {}
export type DownloadKind = "source" | "result";

export function downloadLink(data: DrawingResponse, kind: DownloadKind, now = Date.now()): string {
  const url = kind === "result"
    ? isDrawingResult(data) ? data.downloadUrl : null
    : !isDrawingResult(data) ? data.sourceDownloadUrl : null;
  const expires = kind === "result"
    ? isDrawingResult(data) ? data.downloadUrlExpiresAt : null
    : !isDrawingResult(data) ? data.sourceDownloadUrlExpiresAt : null;
  if (!url) throw new DrawingFileError("Посилання на цей DXF ще недоступне. Оновіть дані та спробуйте знову.");
  if (!expires || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= now + 5000)
    throw new DrawingFileError("Термін дії посилання завершився. Оновіть дані та спробуйте знову.");
  try {
    const protocol = new URL(url).protocol;
    if (!["https:", "http:"].includes(protocol) && !(protocol === "blob:" && isDrawingDemoEnabled())) throw new Error();
  } catch { throw new DrawingFileError("Посилання на файл некоректне."); }
  return url;
}

export async function fetchDrawingDownload(api: DrawingApi, id: string, kind: DownloadKind, signal?: AbortSignal) {
  // Always GET afresh; never use a cached signed link for a download.
  const data = await api.getDrawing(id, signal);
  const url = downloadLink(data, kind);
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new DrawingFileError(response.status === 401 || response.status === 403
    ? "Посилання відхилено або воно протерміноване. Спробуйте завантажити ще раз."
    : "Не вдалося завантажити DXF. Спробуйте ще раз.");
  const blob = await response.blob();
  if (!blob.size) throw new DrawingFileError("Отримано порожній DXF-файл.");
  const original = drawingMetadata(data).originalFileName.replace(/[\\/]/g, "_");
  return { blob, fileName: kind === "source" ? original : `${original.replace(/\.dxf$/i, "")}-processed.dxf` };
}
