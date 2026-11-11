/**
 * Room State Triad Data Contracts & Helper Utilities (BIM-72 / BIM-129 / BIM-82)
 *
 * State Triad comprises three strictly independent axes:
 * 1. Source: auto vs manual
 * 2. Confirmation: confirmed vs unconfirmed
 * 3. Completeness: sufficient vs insufficient
 *
 * A manually drawn room MUST still require explicit confirmation.
 * Missing type and missing height are completeness issues, NOT confirmation states.
 */

import type { Room as ContractRoom } from "@bim/contracts";

export type RoomSource = "auto" | "manual" | "automatic";

export type RoomConfirmationStatus = "confirmed" | "unconfirmed";

export type RoomCompletenessStatus = "sufficient" | "insufficient";

export type RuleVerificationStatus = "verified" | "needs_review" | "review_needed";

export interface RoomPoint {
  x: number;
  y: number;
}

export interface Room {
  id?: string;
  drawingId?: string;
  number?: string;
  name: string;
  roomType: string | null;
  type?: string | null; // Compatibility with legacy @bim/contracts Room.type
  height: number | null;
  area: number;
  source: RoomSource;
  isConfirmed: boolean;
  status?: RoomConfirmationStatus;
  polygon?: RoomPoint[];
  hasUnsavedChanges?: boolean;
  isDirty?: boolean;
}

export const BLOCKING_REASONS = {
  UNSAVED_CHANGES: "Незбережені зміни",
  UNCONFIRMED_ROOMS: "! Не підтверджено",
  INCOMPLETE_DATA: "? Недостатньо даних",
} as const;

export type RoomBlockingReason =
  (typeof BLOCKING_REASONS)[keyof typeof BLOCKING_REASONS];

export interface RoomBlockingReasonsOptions {
  hasUnsavedChanges?: boolean;
}

/**
 * Returns true if and only if valid room type is assigned and room height > 0.
 * Missing type or missing height are never treated as valid defaults or 0.
 */
export function isRoomDataComplete(room: Room): boolean {
  const roomType =
    room.roomType !== undefined ? room.roomType : (room.type ?? null);

  if (roomType == null || roomType.trim() === "" || roomType === "unknown") {
    return false;
  }

  if (room.height == null || room.height <= 0 || !Number.isFinite(room.height)) {
    return false;
  }

  return true;
}

/**
 * Derives the completeness status of a room: 'sufficient' | 'insufficient'.
 */
export function getRoomCompletenessStatus(room: Room): RoomCompletenessStatus {
  return isRoomDataComplete(room) ? "sufficient" : "insufficient";
}

/**
 * Derives the confirmation status of a room: 'confirmed' | 'unconfirmed'.
 */
export function getRoomConfirmationStatus(room: Room): RoomConfirmationStatus {
  if (room.isConfirmed !== undefined) {
    return room.isConfirmed ? "confirmed" : "unconfirmed";
  }
  if (room.status !== undefined) {
    return room.status;
  }
  return "unconfirmed";
}

/**
 * Aggregates all blocking reasons across rooms with strict priority:
 * 1. Unsaved changes (if present)
 * 2. Unconfirmed rooms (! Не підтверджено)
 * 3. Rooms missing type or height (? Недостатньо даних)
 *
 * Returns ALL applicable reasons in priority order, never truncating to only the first one.
 */
export function getRoomBlockingReasons(
  rooms: Room[],
  options?: RoomBlockingReasonsOptions | boolean
): string[] {
  const reasons: string[] = [];

  const hasUnsavedOption =
    typeof options === "boolean"
      ? options
      : Boolean(options?.hasUnsavedChanges);

  const hasUnsaved =
    hasUnsavedOption ||
    rooms.some((room) => Boolean(room.hasUnsavedChanges || room.isDirty));

  // Priority 1: Unsaved changes (if present)
  if (hasUnsaved) {
    reasons.push(BLOCKING_REASONS.UNSAVED_CHANGES);
  }

  // Priority 2: Unconfirmed rooms (! Не підтверджено)
  const hasUnconfirmed = rooms.some((room) => {
    if (room.isConfirmed !== undefined) {
      return !room.isConfirmed;
    }
    if (room.status !== undefined) {
      return room.status === "unconfirmed";
    }
    return true;
  });

  if (hasUnconfirmed) {
    reasons.push(BLOCKING_REASONS.UNCONFIRMED_ROOMS);
  }

  // Priority 3: Rooms missing type or height (? Недостатньо даних)
  const hasIncomplete = rooms.some((room) => !isRoomDataComplete(room));
  if (hasIncomplete) {
    reasons.push(BLOCKING_REASONS.INCOMPLETE_DATA);
  }

  return reasons;
}

/**
 * Ukrainian pluralization for rooms count.
 * 1 приміщення, 2 приміщення, 5 приміщень, 21 приміщення, etc.
 */
export function pluralizeRooms(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} приміщень`;
  }
  if (mod10 === 1) {
    return `${count} приміщення`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} приміщення`;
  }
  return `${count} приміщень`;
}

/**
 * Aggregates concrete actionable instructions for the blocking banner matching BIM-129 layout 02-rooms.
 */
export function formatBlockingActions(
  rooms: Room[],
  options?: { hasUnsavedChanges?: boolean }
): string {
  const parts: string[] = [];

  if (options?.hasUnsavedChanges || rooms.some((r) => r.hasUnsavedChanges || r.isDirty)) {
    parts.push("Збережіть внесені зміни.");
  }

  // 1. Unconfirmed rooms
  const unconfirmedRooms = rooms.filter(
    (room) => room.isConfirmed === false || room.status === "unconfirmed"
  );
  if (unconfirmedRooms.length > 0) {
    const labels = unconfirmedRooms.map((r) => r.number ?? r.name);
    if (labels.length === 1) {
      parts.push(`Перевірте ${labels[0]}.`);
    } else if (labels.length === 2) {
      parts.push(`Перевірте ${labels[0]} і ${labels[1]}.`);
    } else {
      const allExceptLast = labels.slice(0, -1).join(", ");
      const last = labels[labels.length - 1];
      parts.push(`Перевірте ${allExceptLast} і ${last}.`);
    }
  }

  // 2. Rooms missing type or height
  const incompleteRooms = rooms.filter((room) => !isRoomDataComplete(room));
  if (incompleteRooms.length > 0) {
    for (const room of incompleteRooms) {
      const label = room.number ?? room.name;
      const typeMissing =
        room.roomType == null ||
        room.roomType.trim() === "" ||
        room.roomType === "unknown";
      const heightMissing =
        room.height == null || room.height <= 0 || !Number.isFinite(room.height);

      if (typeMissing && heightMissing) {
        parts.push(`Для ${label} оберіть тип та вкажіть висоту.`);
      } else if (typeMissing) {
        parts.push(`Для ${label} оберіть тип.`);
      } else if (heightMissing) {
        parts.push(`Для ${label} вкажіть висоту.`);
      }
    }
  }

  // Suffix reminder
  parts.push("Підтвердження контуру не заповнює дані.");

  return parts.join(" ");
}

export type ContractRoomInput = ContractRoom & {
  source?: "auto" | "manual" | "fire_rooms";
  confirmed?: boolean;
  isConfirmed?: boolean;
  number?: string;
};

/**
 * Maps a contract Room to the State Triad Room model.
 */
export function mapContractRoomToRoom(
  contractRoom: ContractRoomInput,
  index?: number
): Room {
  const rawName = contractRoom.name?.trim() || `Приміщення ${(index ?? 0) + 1}`;
  
  // Extract number if format is e.g. "101" or "101 · Office" or "Room 101"
  let number: string | undefined = contractRoom.number;
  let name = rawName;

  if (!number) {
    const match = rawName.match(/^(?:Room\s*|Kімната\s*|Приміщення\s*)?(\d+[a-zA-Zа-яА-Я]?)(?:\s*[·\-–—]\s*(.*))?$/i);
    if (match && match[1]) {
      number = match[1];
      if (match[2]) {
        name = match[2].trim();
      }
    }
  }

  const source: RoomSource =
    contractRoom.source === "manual" ? "manual" : "auto";

  const isConfirmed =
    source === "manual"
      ? Boolean(contractRoom.confirmed ?? contractRoom.isConfirmed ?? false)
      : Boolean(contractRoom.confirmed ?? contractRoom.isConfirmed ?? true);

  return {
    id: contractRoom.id,
    drawingId: contractRoom.drawingId,
    number,
    name,
    roomType: contractRoom.type ?? null,
    type: contractRoom.type ?? null,
    height: contractRoom.height,
    area: contractRoom.area,
    source,
    isConfirmed,
    status: isConfirmed ? "confirmed" : "unconfirmed",
    polygon: contractRoom.polygon,
  };
}
