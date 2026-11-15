import type { Device, DeviceCreateRequest, DeviceUpdateRequest, Room, RoomCreateRequest, RoomUpdateRequest } from "@bim/contracts";
import { apiFetch, ApiHttpError } from "@/lib/api";

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/api/v1${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiHttpError(response.status, typeof data?.detail === "string" ? data.detail : undefined);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const editApi = {
  createRoom: (id: string, body: RoomCreateRequest) => request<Room>(`/drawings/${id}/rooms`, "POST", body),
  updateRoom: (id: string, body: RoomUpdateRequest) => request<Room>(`/rooms/${id}`, "PATCH", body),
  deleteRoom: (id: string) => request<void>(`/rooms/${id}`, "DELETE"),
  confirmRooms: (id: string) => request<Room[]>(`/drawings/${id}/rooms/confirm`, "POST"),
  createDevice: (id: string, body: DeviceCreateRequest) => request<Device>(`/drawings/${id}/devices`, "POST", body),
  updateDevice: (id: string, body: DeviceUpdateRequest) => request<Device>(`/devices/${id}`, "PATCH", body),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, "DELETE"),
  regenerateDevices: (id: string) => request<void>(`/drawings/${id}/devices/regenerate`, "POST"),
};

export type PlanEditApi = typeof editApi;
