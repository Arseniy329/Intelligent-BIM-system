import type { Point } from "@bim/contracts";
import { apiFetch, ApiHttpError } from "@/lib/api";

// Mirrors the existing BIM-73/BIM-75 Pydantic models (not a new API).
export interface RoomZone {
  id: string; roomId: string; drawingId: string; name: string | null;
  height: number | null; area: number; polygon: Point[];
}
export interface PlanExit {
  id: string; drawingId: string; roomId: string | null; name: string | null;
  position: Point; source: "dxf" | "manual";
}
export type ZoneInput = Pick<RoomZone, "name" | "height"> & {
  polygon?: Point[];
};

async function list<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const data: unknown = await request(path, "GET", undefined, signal);
  if (!Array.isArray(data)) throw new Error("Сервер повернув некоректний список зон або виходів.");
  return data;
}

const messages: Record<string, string> = {
  "zone must lie inside its room": "Зона має бути всередині вибраного приміщення.",
  "zones of one room must not overlap": "Зони одного приміщення не повинні перекриватися.",
  "room has no valid outline to place a zone in": "Спочатку виправте контур приміщення.",
};
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(`/api/v1${path}`, { method, signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = typeof data?.detail === "string" ? messages[data.detail] ?? data.detail : undefined;
    throw new ApiHttpError(response.status, detail ?? (response.status === 422 ? "Перевірте контур і висоту зони (понад 0 і до 100 м)." : undefined));
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const planFeaturesApi = {
  zones: (id: string, signal?: AbortSignal) => list<RoomZone>(`/drawings/${id}/zones`, signal),
  exits: (id: string, signal?: AbortSignal) => list<PlanExit>(`/drawings/${id}/exits`, signal),
  createZone: (id: string, body: ZoneInput) => request<RoomZone>(`/rooms/${id}/zones`, "POST", body),
  updateZone: (id: string, body: ZoneInput) => request<RoomZone>(`/zones/${id}`, "PATCH", body),
  deleteZone: (id: string) => request<void>(`/zones/${id}`, "DELETE"),
  createExit: (id: string, body: Pick<PlanExit, "name" | "position">) => request<PlanExit>(`/drawings/${id}/exits`, "POST", body),
  deleteExit: (id: string) => request<void>(`/exits/${id}`, "DELETE"),
};
