import type { DrawingDetailResponse, DrawingResult, DrawingStatus as ContractDrawingStatus, ProcessingJob, RequestedDrawingUnits } from "@bim/contracts";
import { apiFetch, ApiAuthenticationError, ApiConfigurationError, ApiHttpError, DRAWINGS_API_PATH } from "@/lib/api";
import { isDrawingDemoEnabled } from "./demo-mode";

// FastAPI preserves requested units until parsing; shared DrawingDetailResponse
// currently allows only resolved mm/m. Keep this wire adaptation local to the client.
export type DrawingDetail = Omit<DrawingDetailResponse, "units" | "status"> & { units: RequestedDrawingUnits; status: DrawingDetailResponse["status"] | ContractDrawingStatus };
export type DrawingResponse = DrawingDetail | DrawingResult;
// The synchronous POST endpoints return snake_case acknowledgements, not jobs.
export type DrawingOperation = { drawingId: string; status: "processing" | "processed" };
export type ProcessingResponse = DrawingOperation | DrawingResult | ProcessingJob;
export interface DrawingApi {
  getDrawing(id: string, signal?: AbortSignal): Promise<DrawingResponse>;
  processDrawing(id: string, signal?: AbortSignal): Promise<ProcessingResponse>;
  placeDrawing?(id: string, signal?: AbortSignal): Promise<DrawingOperation | DrawingResult>;
  // Only adapters with an actual job endpoint (currently the explicit demo) poll.
  getJob?(id: string, signal?: AbortSignal): Promise<ProcessingJob>;
}

export type DrawingStatus = "pending" | "processing" | "done" | "error";

export interface DrawingListItem {
  id: string;
  filename: string;
  createdAt: string;
  status: DrawingStatus;
}

const drawingListStatuses: readonly DrawingStatus[] = ["pending", "processing", "done", "error"];

function normalizeDrawingListStatus(value: unknown): DrawingStatus {
  return typeof value === "string" && drawingListStatuses.includes(value as DrawingStatus)
    ? value as DrawingStatus
    : "processing";
}

function normalizeDrawingListItem(value: unknown): DrawingListItem | null {
  if (!record(value) || typeof value.id !== "string" || !value.id ||
    typeof value.filename !== "string" || typeof value.created_at !== "string")
    return null;
  return {
    id: value.id,
    filename: value.filename,
    createdAt: value.created_at,
    status: normalizeDrawingListStatus(value.status),
  };
}

export async function listDrawings(signal?: AbortSignal): Promise<DrawingListItem[]> {
  const response = await apiFetch(DRAWINGS_API_PATH, { method: "GET", signal, cache: "no-store" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = record(body)
      ? [body.detail, body.message, body.error].find(value => typeof value === "string" && value)
      : undefined;
    throw new ApiHttpError(response.status, typeof detail === "string" ? detail : undefined);
  }
  const payload: unknown = await response.json();
  const items = Array.isArray(payload) ? payload : record(payload) && Array.isArray(payload.items) ? payload.items : [];
  return items.flatMap(item => {
    const normalized = normalizeDrawingListItem(item);
    return normalized ? [normalized] : [];
  });
}

const publicErrors: Record<string, string> = {
  LayerNotFoundError: "У DXF немає шару FIRE_ROOMS. Перевірте шари креслення.",
  NoValidContoursError: "На шарі FIRE_ROOMS не знайдено замкнених контурів приміщень.",
  CADParsingError: "Не вдалося прочитати DXF. Перевірте формат і вміст файла.",
  "No rooms found for this drawing": "Приміщень не знайдено. Спочатку виконайте обробку креслення.",
  "No fire safety rules available": "Правила розміщення недоступні. Зверніться до адміністратора.",
};

// Persisted errorMessage may contain raw backend exceptions. Only known public
// messages cross this boundary; SQL, storage paths and tokens must never render.
export function processingErrorMessage(message: unknown): string {
  if (typeof message === "string") {
    if (Object.hasOwn(publicErrors, message)) return publicErrors[message];
    if (Object.values(publicErrors).includes(message)) return message;
  }
  return "Не вдалося обробити креслення. Спробуйте ще раз або зверніться до адміністратора.";
}

export function drawingErrorMessage(error: unknown): string {
  if (error instanceof ApiAuthenticationError || error instanceof ApiHttpError && error.statusCode === 401)
    return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
  if (error instanceof ApiHttpError) {
    if (error.detail && Object.hasOwn(publicErrors, error.detail)) return publicErrors[error.detail];
    if (error.statusCode === 403) return "У вас немає доступу до цього креслення.";
    if (error.statusCode === 404) return "Креслення або задачу обробки не знайдено.";
    if (error.statusCode === 409) return "Обробку вже запущено. Оновіть стан креслення.";
    if (error.statusCode === 400 || error.statusCode === 422) return "Сервер не дозволив обробку або розміщення. Перевірте контури, типи, висоти та підтвердження приміщень.";
    if (error.statusCode >= 500) return "Сервер не зміг виконати запит. Оновіть стан креслення або спробуйте пізніше.";
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
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = record(body) ? [body.error, body.detail, body.message].find(value => typeof value === "string" && Object.hasOwn(publicErrors, value)) : undefined;
    throw new ApiHttpError(response.status, typeof detail === "string" ? detail : undefined);
  }
  return response.json();
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const statuses = ["pending", "uploaded", "processing", "processed", "failed", "error"];

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

export function parseDrawingOperation(value: unknown, id: string, status: DrawingOperation["status"]): DrawingOperation | DrawingResult {
  if (record(value) && "drawing" in value) {
    const result = parseDrawing(value, id);
    if (isDrawingResult(result)) return result;
  }
  if (!record(value) || value.drawing_id !== id || value.status !== status)
    throw new Error("Invalid drawing operation response.");
  return { drawingId: id, status };
}

export function parseDrawing(value: unknown, id: string): DrawingResponse {
  if (!record(value)) throw new Error("Invalid drawing response.");
  const drawing = record(value.drawing) ? value.drawing : value;
  const allowedStatuses = "drawing" in value ? ["pending", "uploaded", "processing", "processed", "error"] : statuses;
  if (drawing.id !== id || typeof drawing.originalFileName !== "string" || !allowedStatuses.includes(String(drawing.status)))
    throw new Error("Invalid drawing metadata.");
  if ("drawing" in value) {
    if (typeof drawing.ownerId !== "string" || typeof drawing.storagePath !== "string" || typeof drawing.createdAt !== "string" ||
      ![null, "mm", "m"].includes(drawing.resolvedUnits as string | null) ||
      !optionalString(drawing.errorMessage) ||
      ![value.downloadUrl, value.downloadUrlExpiresAt, value.sourceDownloadUrl, value.sourceDownloadUrlExpiresAt].every(optionalString) ||
      !Array.isArray(value.rooms) || !Array.isArray(value.devices) ||
      new Set(value.rooms.map(room => record(room) ? room.id : null)).size !== value.rooms.length ||
      new Set(value.devices.map(device => record(device) ? device.id : null)).size !== value.devices.length ||
      !value.rooms.every(room => record(room) && room.drawingId === id && typeof room.id === "string" &&
        (room.name === null || typeof room.name === "string") && (room.type === null || typeof room.type === "string") &&
        (room.height === null || typeof room.height === "number" && Number.isFinite(room.height) && room.height > 0) &&
        typeof room.area === "number" && Number.isFinite(room.area) && room.area >= 0 &&
        Array.isArray(room.polygon) && room.polygon.length >= 3 && room.polygon.every(validPoint)) ||
      !value.devices.every(device => record(device) && device.drawingId === id && typeof device.id === "string" &&
        (device.roomId === null || typeof device.roomId === "string") && typeof device.layer === "string" &&
        ["smoke_detector", "heat_detector", "sounder", "manual_call_point"].includes(String(device.type)) && validPoint(device.position)))
      throw new Error("Invalid drawing result.");
  }
  return value as unknown as DrawingResponse;
}

function optionalString(value: unknown): boolean {
  return value == null || typeof value === "string";
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
    const value = await request(`${DRAWINGS_API_PATH}/${encodeURIComponent(id)}`, signal);
    return record(value) && "drawing" in value ? parseDrawing(value, id) : normalizeDrawingDetail(value, id);
  },
  async processDrawing(id, signal) {
    return parseDrawingOperation(await request(`${DRAWINGS_API_PATH}/${encodeURIComponent(id)}/process`, signal, "POST"), id, "processing");
  },
  async placeDrawing(id, signal) {
    return parseDrawingOperation(await request(`${DRAWINGS_API_PATH}/${encodeURIComponent(id)}/place`, signal, "POST"), id, "processed");
  },
};

export class DrawingFileError extends Error {}
export type DownloadKind = "source" | "result";

export function downloadLink(data: DrawingResponse, kind: DownloadKind, now = Date.now()): string {
  const url = kind === "result"
    ? isDrawingResult(data) ? data.downloadUrl : null
    : data.sourceDownloadUrl;
  const expires = kind === "result"
    ? isDrawingResult(data) ? data.downloadUrlExpiresAt : null
    : data.sourceDownloadUrlExpiresAt;
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
