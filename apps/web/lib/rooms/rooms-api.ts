import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiHttpError } from "@/lib/api";
import { mapContractRoomToRoom, type Room } from "@/types/rooms";
import { drawingKey } from "@/lib/drawing/use-drawing-detail";

export interface UpdateRoomPayload {
  room_type?: string | null;
  type?: string | null;
  height?: number | null;
  confirmed?: boolean;
  is_confirmed?: boolean;
}

/**
 * Updates a room via PATCH /api/v1/rooms/{id}.
 */
export async function updateRoom(
  roomId: string,
  patch: UpdateRoomPayload,
  signal?: AbortSignal
): Promise<Room> {
  const body: {
    type?: string;
    height?: number | null;
    confirmed?: boolean;
    is_confirmed?: boolean;
  } = {};
  const effectiveType = patch.room_type !== undefined ? patch.room_type : patch.type;
  if (effectiveType !== undefined) {
    if (effectiveType && effectiveType !== "unknown") {
      body.type = effectiveType;
    }
  }
  if (patch.height !== undefined) {
    body.height = patch.height;
  }
  if (patch.confirmed !== undefined) {
    body.confirmed = patch.confirmed;
  } else if (patch.is_confirmed !== undefined) {
    body.is_confirmed = patch.is_confirmed;
  }

  const response = await apiFetch(`/api/v1/rooms/${roomId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail =
      errorBody && typeof errorBody === "object" && "detail" in errorBody
        ? String(errorBody.detail)
        : undefined;
    throw new ApiHttpError(response.status, detail);
  }

  const data = await response.json();
  return mapContractRoomToRoom(data);
}

export async function confirmRoom(roomId: string, signal?: AbortSignal): Promise<Room> {
  return updateRoom(roomId, { confirmed: true }, signal);
}

export async function confirmAllRooms(roomIds: string[], signal?: AbortSignal): Promise<Room[]> {
  return Promise.all(roomIds.map((id) => confirmRoom(id, signal)));
}

/**
 * Mutation hook for updating room data and invalidating drawing caches.
 */
export function useUpdateRoomMutation(drawingId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      roomId,
      patch,
    }: {
      roomId: string;
      patch: UpdateRoomPayload;
    }) => updateRoom(roomId, patch),
    onSuccess: () => {
      if (drawingId) {
        void queryClient.invalidateQueries({
          queryKey: drawingKey(drawingId, false),
        });
        void queryClient.invalidateQueries({
          queryKey: drawingKey(drawingId, true),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["drawing-detail"],
      });
    },
  });
}

