import type { DrawingDetailResponse, DrawingResult, ProcessingJob, RequestedDrawingUnits } from "@bim/contracts";
import { apiFetch, ApiAuthenticationError, ApiConfigurationError, ApiHttpError, DRAWINGS_API_PATH } from "@/lib/api";
import { isDrawingDemoEnabled } from "./demo-mode";

// FastAPI preserves requested units until parsing; shared DrawingDetailResponse
// currently allows only resolved mm/m. Keep this wire adaptation local to the client.
export type DrawingDetail = Omit<DrawingDetailResponse, "units"> & { units: RequestedDrawingUnits };
export type DrawingResponse = DrawingDetail | DrawingResult;
export type ProcessingAccepted = { drawingId: string; status: "accepted"; message: string };
export type ProcessingResponse = ProcessingAccepted | ProcessingJob;
export interface DrawingApi {
  getDrawing(id: string, signal?: AbortSignal): Promise<DrawingResponse>;
  processDrawing(id: string, signal?: AbortSignal): Promise<ProcessingResponse>;
  // Only adapters with an actual job endpoint (currently the explicit demo) poll.
  getJob?(id: string, signal?: AbortSignal): Promise<ProcessingJob>;
}

export function drawingErrorMessage(error: unknown): string {
  if (error instanceof ApiAuthenticationError || error instanceof ApiHttpError && error.statusCode === 401)
    return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
  if (error instanceof ApiHttpError) {
    if (error.statusCode === 403) return "У вас немає доступу до цього креслення.";
    if (error.statusCode === 404) return "Креслення або задачу обробки не знайдено.";
    if (error.statusCode === 409) return "Обробку вже запущено. Оновіть стан креслення.";
    if (error.statusCode === 501) return "Обробка ще недоступна. Спробуйте пізніше.";
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
  if (!response.ok) throw new ApiHttpError(response.status);
  return response.json();
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const statuses = ["pending", "uploaded", "processing", "processed", "failed"];

export function normalizeDrawingDetail(value: unknown, id: string): DrawingDetail {
  if (!record(value) || value.id !== id || typeof value.owner_id !== "string" ||
    typeof value.original_file_name !== "string" || !value.original_file_name ||
    typeof value.storage_path !== "string" || typeof value.created_at !== "string" ||
    !["mm", "m", "from_file"].includes(String(value.units)) || !statuses.includes(String(value.status)) ||
    ![value.source_download_url, value.source_download_url_expires_at].every(field => field == null || typeof field === "string"))
    throw new Error("Invalid drawing detail response.");
  return {
    id, ownerId: value.owner_id, originalFileName: value.original_file_name,
    storagePath: value.storage_path, createdAt: value.created_at,
    units: value.units as RequestedDrawingUnits, status: value.status as DrawingDetail["status"],
    sourceDownloadUrl: value.source_download_url as string | null | undefined,
    sourceDownloadUrlExpiresAt: value.source_download_url_expires_at as string | null | undefined,
  };
}

export function parseProcessingAccepted(value: unknown, id: string): ProcessingAccepted {
  if (!record(value) || value.drawing_id !== id || value.status !== "accepted" || typeof value.message !== "string")
    throw new Error("Invalid processing acceptance response.");
  return { drawingId: id, status: "accepted", message: value.message };
}

export function parseDrawing(value: unknown, id: string): DrawingResponse {
  if (!record(value)) throw new Error("Invalid drawing response.");
  const drawing = record(value.drawing) ? value.drawing : value;
  const allowedStatuses = "drawing" in value ? ["pending", "uploaded", "processing", "processed", "error"] : statuses;
  if (drawing.id !== id || typeof drawing.originalFileName !== "string" || !allowedStatuses.includes(String(drawing.status)))
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
    return normalizeDrawingDetail(await request(`${DRAWINGS_API_PATH}/${encodeURIComponent(id)}`, signal), id);
  },
  async processDrawing(id, signal) {
    return parseProcessingAccepted(await request(`${DRAWINGS_API_PATH}/${encodeURIComponent(id)}/process`, signal, "POST"), id);
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
