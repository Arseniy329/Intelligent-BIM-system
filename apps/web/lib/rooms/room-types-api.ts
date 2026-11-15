import type { RoomType } from "@bim/contracts";
import { apiFetch, ApiHttpError } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export const ROOM_TYPES_API_PATH = "/api/v1/room-types";

export const DEFAULT_ROOM_TYPES: RoomType[] = [
  {
    code: "office",
    name: "Офіс, кабінет",
    examples: ["Office", "Manager_Office", "Кабінет"],
  },
  {
    code: "service_room",
    name: "Службове приміщення",
    examples: ["Staff_Room", "Персонал"],
  },
  {
    code: "corridor",
    name: "Коридор, шлях евакуації",
    examples: ["Corridor", "Main_Corridor", "Коридор"],
  },
  {
    code: "staircase",
    name: "Сходова клітка",
    examples: ["Stairs", "Сходи"],
  },
  {
    code: "hall",
    name: "Зала, хол, кафе",
    examples: ["Hall", "Cafe_Hall", "Зал"],
  },
  {
    code: "sleeping_room",
    name: "Спальне приміщення",
    examples: ["Bedroom", "Номер", "Спальня"],
  },
  {
    code: "kitchen",
    name: "Кухня",
    examples: ["Kitchen", "Кухня"],
  },
  {
    code: "storage",
    name: "Склад, комора",
    examples: ["Storage", "Storage_Room", "Склад"],
  },
  {
    code: "restroom",
    name: "Санвузол, душова",
    examples: ["Restroom", "WC", "Санвузол"],
  },
  {
    code: "technical",
    name: "Технічне приміщення",
    examples: ["Electrical", "Server", "Електрощитова", "Серверна", "Венткамера"],
  },
  {
    code: "unknown",
    name: "Тип не визначено",
    examples: [],
  },
];

export async function fetchRoomTypes(signal?: AbortSignal): Promise<RoomType[]> {
  try {
    const response = await apiFetch(ROOM_TYPES_API_PATH, { signal });
    if (!response.ok) {
      throw new ApiHttpError(response.status, "Failed to fetch room types");
    }
    const data: RoomType[] = await response.json();
    return data;
  } catch {
    return DEFAULT_ROOM_TYPES;
  }
}

export function useRoomTypes(initialData?: RoomType[]) {
  return useQuery({
    queryKey: ["room-types"],
    queryFn: ({ signal }) => fetchRoomTypes(signal),
    staleTime: 1000 * 60 * 60,
    initialData: initialData ?? DEFAULT_ROOM_TYPES,
  });
}

export function getRoomTypeName(
  typeCode: string | null | undefined,
  catalog?: RoomType[]
): string | null {
  if (!typeCode || typeCode === "unknown" || typeCode.trim() === "") {
    return null;
  }
  const effectiveCatalog = catalog && catalog.length > 0 ? catalog : DEFAULT_ROOM_TYPES;
  const match = effectiveCatalog.find((item) => item.code === typeCode);
  return match?.name ?? typeCode;
}

