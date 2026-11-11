"use client";

import * as React from "react";
import type { RoomType } from "@bim/contracts";
import { cn } from "@/lib/utils";
import {
  type Room,
  isRoomDataComplete,
  getRoomBlockingReasons,
  pluralizeRooms,
  formatBlockingActions,
} from "@/types/rooms";
import {
  SourceBadge,
  ConfirmationBadge,
  CompletenessBadge,
} from "@/components/rooms/badges";
import { useRoomTypes, getRoomTypeName } from "@/lib/rooms/room-types-api";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export interface RoomsTableProps {
  rooms: Room[];
  roomTypes?: RoomType[];
  selectedRoomId?: string | null;
  hasUnsavedChanges?: boolean;
  onSelectRoom?: (room: Room) => void;
  onNavigateToPlan?: (room: Room) => void;
  onEditRoom?: (room: Room) => void;
  onVerifyRoom?: (room: Room) => void;
  className?: string;
}

function formatHeight(height: number | null | undefined): string | null {
  if (height == null || height <= 0 || !Number.isFinite(height)) {
    return null;
  }
  return `${height.toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} м`;
}

export function RoomsTable({
  rooms,
  roomTypes: propRoomTypes,
  selectedRoomId,
  hasUnsavedChanges = false,
  onSelectRoom,
  onNavigateToPlan,
  onEditRoom,
  onVerifyRoom,
  className,
}: RoomsTableProps) {
  const { data: fetchedRoomTypes } = useRoomTypes(propRoomTypes);
  const catalog = propRoomTypes ?? fetchedRoomTypes;

  // Dynamic counts for sub-header
  const total = rooms.length;
  const unconfirmedCount = rooms.filter(
    (r) => r.isConfirmed === false || r.status === "unconfirmed"
  ).length;
  const incompleteCount = rooms.filter((r) => !isRoomDataComplete(r)).length;

  // Check blocking reasons for the bottom warning banner
  const blockingReasons = getRoomBlockingReasons(rooms, hasUnsavedChanges);
  const hasBlocking = blockingReasons.length > 0;

  const handleRoomClick = (room: Room) => {
    onSelectRoom?.(room);
    onNavigateToPlan?.(room);
  };

  return (
    <div
      data-slot="rooms-view"
      className={cn("space-y-5 min-w-0 w-full", className)}
    >
      {/* 1. Sub-header Counters & Dynamic Summary matching 02-rooms */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--bim-color-text-primary)]">
          Приміщення
        </h2>
        <p
          data-slot="rooms-summary"
          className="text-sm text-[var(--bim-color-text-secondary)]"
        >
          {pluralizeRooms(total)} · {unconfirmedCount} не підтверджено ·{" "}
          {incompleteCount} з неповними даними
        </p>
      </div>

      {/* 2. Rooms Table matching Figma 02-rooms */}
      <div className="rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[var(--bim-color-surface-subtle)]">
              <TableHead className="w-[28%]">Приміщення</TableHead>
              <TableHead className="w-[18%]">Тип</TableHead>
              <TableHead className="w-[12%]">Висота</TableHead>
              <TableHead className="w-[12%]">Джерело</TableHead>
              <TableHead className="w-[14%]">Підтвердження</TableHead>
              <TableHead className="w-[10%]">Дані</TableHead>
              <TableHead className="w-[6%] text-right">Дія</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-28 text-center text-[var(--bim-color-text-secondary)]"
                >
                  Приміщень не знайдено.
                </TableCell>
              </TableRow>
            ) : (
              rooms.map((room) => {
                const isSelected = selectedRoomId === room.id;
                const isComplete = isRoomDataComplete(room);
                const isConfirmed = Boolean(room.isConfirmed);
                const typeName = getRoomTypeName(room.roomType, catalog);
                const heightStr = formatHeight(room.height);

                return (
                  <TableRow
                    key={room.id ?? room.name}
                    data-room-id={room.id}
                    data-selected={isSelected}
                    className={cn(
                      isSelected && "bg-blue-50/50 hover:bg-blue-50/70"
                    )}
                  >
                    {/* Column 1: Приміщення */}
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        onClick={() => handleRoomClick(room)}
                        className="group inline-flex items-center gap-1.5 text-left font-medium text-[var(--bim-color-text-primary)] hover:text-[var(--bim-color-brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] cursor-pointer"
                      >
                        <span data-slot="room-name">
                          {room.number ? `${room.number} · ` : ""}
                          {room.name}
                        </span>
                      </button>
                    </TableCell>

                    {/* Column 2: Тип */}
                    <TableCell>
                      {typeName ? (
                        <span className="text-slate-800">{typeName}</span>
                      ) : (
                        <span
                          data-slot="missing-type"
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
                        >
                          Тип не визначено
                        </span>
                      )}
                    </TableCell>

                    {/* Column 3: Висота */}
                    <TableCell>
                      {heightStr ? (
                        <span className="text-slate-800 font-mono text-xs">
                          {heightStr}
                        </span>
                      ) : (
                        <span
                          data-slot="missing-height"
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
                        >
                          Не вказано
                        </span>
                      )}
                    </TableCell>

                    {/* Column 4: Джерело */}
                    <TableCell>
                      <SourceBadge source={room.source} />
                    </TableCell>

                    {/* Column 5: Підтвердження */}
                    <TableCell>
                      <ConfirmationBadge isConfirmed={room.isConfirmed} />
                    </TableCell>

                    {/* Column 6: Дані */}
                    <TableCell>
                      <CompletenessBadge room={room} />
                    </TableCell>

                    {/* Column 7: Дія */}
                    <TableCell className="text-right">
                      {!isComplete ? (
                        <button
                          type="button"
                          onClick={() => onEditRoom?.(room)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          Заповнити
                        </button>
                      ) : !isConfirmed ? (
                        <button
                          type="button"
                          onClick={() =>
                            onVerifyRoom
                              ? onVerifyRoom(room)
                              : handleRoomClick(room)
                          }
                          className="text-xs font-semibold text-amber-700 hover:text-amber-900 hover:underline cursor-pointer"
                        >
                          Перевірити
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRoomClick(room)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
                        >
                          На плані
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Table footer hint */}
        <div className="px-4 py-2.5 border-t border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)]/50">
          <p className="text-xs text-[var(--bim-color-text-secondary)]">
            Клік по назві виділяє те саме приміщення на плані.
          </p>
        </div>
      </div>

      {/* 3. Bottom Blocking Banner matching 02-rooms */}
      {hasBlocking && (
        <div
          role="alert"
          data-slot="blocking-banner"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1.5 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex size-5 items-center justify-center rounded-full bg-amber-200 text-amber-900 text-xs font-bold"
            >
              !
            </span>
            <h3 className="font-semibold text-amber-900">
              Є причини, що блокують розміщення
            </h3>
          </div>
          <p
            data-slot="blocking-description"
            className="text-sm text-amber-900/90 pl-7"
          >
            {formatBlockingActions(rooms, { hasUnsavedChanges })}
          </p>
        </div>
      )}
    </div>
  );
}

