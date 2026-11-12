import type { Device, Room } from "@bim/contracts";
import { apiFetch, DRAWINGS_API_PATH } from "@/lib/api";

export type DrawingStatus = "uploaded" | "processing" | "processed" | "failed";

export interface DrawingListItem {
  id: string;
  filename: string;
  uploaded_at: string;
  status: DrawingStatus;
  error_message?: string | null;
  has_result: boolean;
}

export interface DrawingDetail extends DrawingListItem {
  rooms?: Room[];
  devices?: Device[];
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const DRAWING_STATUSES: readonly DrawingStatus[] = [
  "uploaded",
  "processing",
  "processed",
  "failed",
];

function normalizeStatus(value: unknown): DrawingStatus {
  if (typeof value === "string" && DRAWING_STATUSES.includes(value as DrawingStatus)) {
    return value as DrawingStatus;
  }
  if (value === "pending") {
    return "uploaded";
  }
  if (value === "done") {
    return "processed";
  }
  if (value === "error") {
    return "failed";
  }
  return "uploaded";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeDrawingListItem(value: unknown): DrawingListItem {
  const raw = asRecord(value);
  return {
    id: String(raw.id ?? ""),
    filename: String(raw.filename ?? raw.original_file_name ?? raw.originalFileName ?? ""),
    uploaded_at: String(raw.uploaded_at ?? raw.created_at ?? raw.createdAt ?? ""),
    status: normalizeStatus(raw.status),
    error_message:
      typeof raw.error_message === "string" || raw.error_message === null
        ? raw.error_message
        : typeof raw.errorMessage === "string" || raw.errorMessage === null
          ? raw.errorMessage
          : null,
    has_result: raw.has_result === true,
  };
}

function normalizeDrawingDetail(value: unknown): DrawingDetail {
  const raw = asRecord(value);
  return {
    ...normalizeDrawingListItem(raw),
    rooms: Array.isArray(raw.rooms) ? (raw.rooms as Room[]) : undefined,
    devices: Array.isArray(raw.devices) ? (raw.devices as Device[]) : undefined,
  };
}

async function parseErrorDetail(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as Record<string, unknown> | null;
    const rawDetail = body?.detail ?? body?.message;
    if (typeof rawDetail === "string") {
      detail = rawDetail;
    } else if (Array.isArray(rawDetail)) {
      detail = rawDetail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return JSON.stringify(item);
        })
        .join("; ");
    }
  } catch {
    return "";
  }
  return detail;
}

async function throwApiError(response: Response): Promise<never> {
  const detail = await parseErrorDetail(response);
  throw new ApiError(
    response.status,
    detail || `API request failed with status ${response.status}`,
  );
}

export async function listDrawings(signal?: AbortSignal): Promise<DrawingListItem[]> {
  const response = await apiFetch(DRAWINGS_API_PATH, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  const rawJson = (await response.json()) as unknown;
  if (!Array.isArray(rawJson)) {
    return [];
  }
  return rawJson.map((item) => normalizeDrawingListItem(item));
}

export async function getDrawing(
  id: string,
  signal?: AbortSignal,
): Promise<DrawingDetail> {
  const path = `${DRAWINGS_API_PATH}/${encodeURIComponent(id)}`;
  const response = await apiFetch(path, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  const rawJson = (await response.json()) as unknown;
  return normalizeDrawingDetail(rawJson);
}
