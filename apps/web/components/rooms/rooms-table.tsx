"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RoomType } from "@bim/contracts";
import {
  planFeaturesApi,
  type RoomZone as PlanRoomZone,
  type ZoneInput,
} from "@/lib/drawing/plan-features-api";
import type { PlanEditor } from "@/lib/drawing/use-plan-editor";
import { cn } from "@/lib/utils";
import {
  type Room,
  type RoomZone,
  type RoomWithZones,
  MISSING_ZONE_HEIGHT_TEXT,
  isRoomDataComplete,
  isInsufficientDataStatus,
  getRoomRuleStatusAndReason,
  getRoomBlockingReasons,
  pluralizeRooms,
  formatBlockingActions,
} from "@/types/rooms";
import {
  SourceBadge,
  ConfirmationBadge,
  CompletenessBadge,
  RuleStatusBadge,
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
  zoneEditor?: PlanEditor;
  onEditZone?: (zone: PlanRoomZone) => void;
  zones?: PlanRoomZone[];
  rooms: RoomWithZones[];
  roomTypes?: RoomType[];
  selectedRoomId?: string | null;
  hasUnsavedChanges?: boolean;
  onSelectRoom?: (room: Room) => void;
  onNavigateToPlan?: (room: Room) => void;
  onEditRoom?: (room: Room) => void;
  onVerifyRoom?: (room: Room) => void;
  onConfirmRoom?: (room: Room) => void;
  onConfirmAllRooms?: () => void;
  onZoneSaved?: (zone: RoomZone, height: number) => void;
  className?: string;
}

function formatHeight(height: number | null | undefined): string | null {
  if (height == null || height <= 0 || !Number.isFinite(height)) {
    return null;
  }
  return `${height.toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} м`;
}

const MISSING_REASON_FALLBACK = "Причина не вказана";

function isValidZoneHeight(
  height: number | null | undefined
): height is number {
  return height != null && height > 0 && Number.isFinite(height);
}

const INVALID_ZONE_HEIGHT_MESSAGE = "Вкажіть висоту числом, більшим за 0.";

function parseZoneHeight(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function ZoneHeightInput({
  room,
  zone,
  onSave,
}: {
  room: RoomWithZones;
  zone: RoomZone;
  onSave: (zone: RoomZone, height: number) => void | Promise<unknown>;
}) {
  const toInputValue = React.useCallback(
    (height: number | null | undefined) =>
      isValidZoneHeight(height) ? String(height) : "",
    []
  );
  const [value, setValue] = React.useState(() => toInputValue(zone.height));
  const [error, setError] = React.useState<string | null>(null);
  const saving = React.useRef(false);
  const committed = React.useRef<number | null>(
    isValidZoneHeight(zone.height) ? zone.height : null
  );

  const submit = async (height: number) => {
    if (saving.current) return;
    saving.current = true;
    try {
      await onSave(zone, height);
      committed.current = height;
      setError(null);
    } catch {
      setError("Не вдалося зберегти висоту. Спробуйте ще раз.");
    } finally {
      saving.current = false;
    }
  };

  const commit = () => {
    if (value.trim() === "") {
      setError(null);
      return;
    }

    const parsed = parseZoneHeight(value);
    if (parsed == null) {
      setError(INVALID_ZONE_HEIGHT_MESSAGE);
      return;
    }

    if (parsed === committed.current) {
      setError(null);
      return;
    }

    setError(null);
    void submit(parsed);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  const showFallback = value.trim() === "";

  return (
    <div className="flex flex-col gap-1">
      <input
        type="number"
        min="0.01"
        step="0.1"
        inputMode="decimal"
        aria-label={`Висота зони ${zone.name} у ${room.name}`}
        aria-invalid={Boolean(error)}
        value={value}
        placeholder="Введіть висоту"
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onWheel={(event) => event.currentTarget.blur()}
        className="w-28 rounded-lg border border-slate-300 bg-white p-2 text-sm"
      />
      {showFallback && (
        <span
          data-slot="zone-height-missing"
          data-testid="zone-height-missing"
          className="text-xs text-muted-foreground"
        >
          {MISSING_ZONE_HEIGHT_TEXT}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

export function RoomsTable({
  zoneEditor,
  onEditZone,
  zones = [],
  rooms,
  roomTypes: propRoomTypes,
  selectedRoomId,
  hasUnsavedChanges = false,
  onSelectRoom,
  onNavigateToPlan,
  onEditRoom,
  onVerifyRoom,
  onConfirmRoom,
  onConfirmAllRooms,
  onZoneSaved,
  className,
}: RoomsTableProps) {
  const queryClient = useQueryClient();
  const { data: fetchedRoomTypes } = useRoomTypes(propRoomTypes);
  const catalog = propRoomTypes ?? fetchedRoomTypes;
  const roomDataComplete = (room: RoomWithZones) => {
    const roomZones = zones.filter((zone) => zone.roomId === room.id);
    const allZones: { height?: number | null }[] = [
      ...roomZones,
      ...(room.zones ?? []),
    ];
    return allZones.length
      ? Boolean(
          room.roomType &&
            room.roomType !== "unknown" &&
            allZones.every((zone) => isValidZoneHeight(zone.height))
        )
      : isRoomDataComplete(room);
  };

  const handleZoneHeightSave = async (
    zone: RoomZone,
    height: number
  ) => {
    const geometry = zone.polygon;
    const payload: ZoneInput = {
      name: zone.name,
      height,
      ...(Array.isArray(geometry) && geometry.length >= 3
        ? { polygon: geometry }
        : {}),
    };

    await planFeaturesApi.updateZone(zone.id, payload);
    onZoneSaved?.(zone, height);
    void queryClient.invalidateQueries({ queryKey: ["drawing-features"] });
  };

  // Dynamic counts for sub-header
  const total = rooms.length;
  const unconfirmedCount = rooms.filter(
    (r) => r.isConfirmed === false || r.status === "unconfirmed"
  ).length;
  const incompleteCount = rooms.filter(
    (r) =>
      !roomDataComplete(r) ||
      isInsufficientDataStatus(getRoomRuleStatusAndReason(r).status)
  ).length;

  // Check blocking reasons for the bottom warning banner
  const blockingReasons = getRoomBlockingReasons(rooms, hasUnsavedChanges, new Set(zones.map(zone => zone.roomId)));
  const hasBlocking = blockingReasons.length > 0;

  const handleRoomClick = (room: Room) => {
    if (zoneEditor?.blocked) return;
    onSelectRoom?.(room);
    onNavigateToPlan?.(room);
  };

  return (
    <div
      data-slot="rooms-view"
      className={cn("space-y-5 min-w-0 w-full", className)}
    >
      {/* 1. Sub-header Counters & Dynamic Summary matching 02-rooms */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
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
        {unconfirmedCount > 0 && onConfirmAllRooms && (
          <button
            type="button"
            disabled={zoneEditor?.blocked}
            onClick={onConfirmAllRooms}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer self-start sm:self-auto shadow-none"
          >
            <span aria-hidden="true">✓</span>
            <span>Підтвердити всі ({unconfirmedCount})</span>
          </button>
        )}
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
                const isComplete = roomDataComplete(room);
                const isConfirmed = Boolean(room.isConfirmed);
                const typeName = getRoomTypeName(room.roomType, catalog);
                const heightStr = formatHeight(room.height);
                const { status: ruleStatus, reason: ruleReason } =
                  getRoomRuleStatusAndReason(room);
                const isInsufficient = isInsufficientDataStatus(ruleStatus);
                const rawRecord = room as unknown as Record<string, unknown>;
                const hasExplicitRuleData = Boolean(
                  room.ruleStatus ??
                    room.rule_status ??
                    rawRecord.review_status ??
                    rawRecord.reviewStatus
                );
                const showRuleBadge =
                  hasExplicitRuleData || isInsufficient || Boolean(ruleReason);
                const displayReason =
                  ruleReason ??
                  (isInsufficient ? MISSING_REASON_FALLBACK : null);

                return (
                  <React.Fragment key={room.id ?? room.name}><TableRow
                    key={room.id ?? room.name}
                    data-room-id={room.id}
                    data-selected={isSelected}
                    data-rule-status={ruleStatus}
                    className={cn(
                      isInsufficient &&
                        "bg-slate-50/60 text-slate-500 opacity-80",
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
                      {zones.some(zone => zone.roomId === room.id) ? <span>За зонами</span> : heightStr ? (
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
                      {showRuleBadge ? (
                        <RuleStatusBadge
                          status={ruleStatus}
                          reason={displayReason}
                        />
                      ) : zones.some(zone => zone.roomId === room.id) ? (
                        <span className={isComplete ? "text-xs text-emerald-700" : "text-xs text-amber-800"}>
                          {isComplete ? "Висоти зон задано" : "Недостатньо даних зон"}
                        </span>
                      ) : (
                        <CompletenessBadge room={room} />
                      )}
                    </TableCell>

                    {/* Column 7: Дія */}
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-2.5">
                        {!isConfirmed && onConfirmRoom && (
                          <button
                            type="button"
                            onClick={() => onConfirmRoom(room)}
                            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
                          >
                            Підтвердити
                          </button>
                        )}

                        {onVerifyRoom && (
                          <button
                            type="button"
                            onClick={() => onVerifyRoom(room)}
                            className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                          >
                            Перевірити
                          </button>
                        )}

                        {/* Direct action based on completeness & confirmation */}
                        {!isComplete ? (
                          <button
                            type="button"
                            onClick={() => onEditRoom?.(room)}
                            className="text-xs font-semibold text-amber-700 hover:text-amber-900 hover:underline cursor-pointer"
                          >
                            Заповнити
                          </button>
                        ) : !isConfirmed ? (
                          <>
                            {onEditRoom && (
                              <button
                                type="button"
                                onClick={() => onEditRoom(room)}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                              >
                                Редагувати
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRoomClick(room)}
                              className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                            >
                              Перевірити
                            </button>
                          </>
                        ) : (
                          <>
                            {onEditRoom && (
                              <button
                                type="button"
                                onClick={() => onEditRoom(room)}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                              >
                                Редагувати
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRoomClick(room)}
                              className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
                            >
                              На плані
                            </button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {zones.filter(zone => zone.roomId === room.id).map((zone, index) => {
                    const draft = zoneEditor?.draft?.kind === "zone" && zoneEditor.draft.id === zone.id ? zoneEditor.draft : null;
                    const zoneLabel = zone.name || `Зона ${index + 1}`;
                    return <TableRow key={`${room.id}:${zone.id}`} data-testid="room-zone-row" data-zone-id={zone.id} aria-label={`Зона ${zoneLabel} приміщення ${room.name}`} className="bg-slate-50/50">
                      <TableCell className="pl-8 text-sm font-medium text-muted-foreground">↳ {zoneLabel}</TableCell>
                      <TableCell><span className="text-xs text-slate-600">Частина {room.name} · {zone.area.toLocaleString("uk-UA")} м²</span></TableCell>
                      <TableCell>
                        {isValidZoneHeight(zone.height) ? (
                          <span data-slot="zone-height-value" className="font-mono text-xs text-slate-800">
                            {formatHeight(zone.height)}
                          </span>
                        ) : (
                          <span data-testid="zone-height-missing" className="text-xs text-muted-foreground">
                            {MISSING_ZONE_HEIGHT_TEXT}
                          </span>
                        )}
                        {draft && <input aria-label={`Висота ${zoneLabel}, м`} type="number" min="0.01" max="100" step="any" placeholder="Введіть висоту" className="mt-1 w-28 rounded-lg border border-slate-300 bg-white p-2 text-sm" onWheel={event => event.currentTarget.blur()} value={draft.height} disabled={zoneEditor?.busy || zoneEditor?.uncertain} onChange={event => zoneEditor?.setHeight(event.target.value)} />}
                      </TableCell>
                      <TableCell colSpan={3}><span className={!isValidZoneHeight(zone.height) ? "rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" : "text-xs text-slate-600"}>{!isValidZoneHeight(zone.height) ? "Висоту не задано" : "Висоту задано"}</span></TableCell>
                      <TableCell className="text-right">{draft ? <div className="flex gap-2"><button type="button" disabled={zoneEditor?.busy || zoneEditor?.uncertain} onClick={zoneEditor?.save} className="text-sm text-blue-600">Зберегти</button><button type="button" disabled={zoneEditor?.busy} onClick={zoneEditor?.cancel} className="text-sm text-slate-600">Скасувати</button></div> : <button type="button" disabled={zoneEditor?.blocked} onClick={() => onEditZone?.(zone)} className="text-sm text-blue-600">Змінити</button>}</TableCell>
                    </TableRow>;
                  })}
                  {(room.zones ?? [])
                    .filter(
                      (zone) =>
                        !zones.some((propZone) => propZone.id === zone.id)
                    )
                    .map((zone, index) => {
                      const zoneLabel = zone.name || `Зона ${index + 1}`;
                      return (
                      <TableRow
                        key={`${room.id}:${zone.id}`}
                        data-testid="room-zone-row"
                        data-zone-id={zone.id}
                        data-zone-source="room"
                        aria-label={`Зона ${zoneLabel} приміщення ${room.name}`}
                        className="bg-slate-50/50"
                      >
                        <TableCell className="pl-8 text-sm font-medium text-muted-foreground">
                          <span data-slot="zone-name">↳ {zoneLabel}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-600">
                            Частина {room.name}
                            {typeof zone.area === "number"
                              ? ` · ${zone.area.toLocaleString("uk-UA")} м²`
                              : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {isValidZoneHeight(zone.height) && (
                              <span
                                data-slot="zone-height-value"
                                className="font-mono text-xs text-slate-800"
                              >
                                {formatHeight(zone.height)}
                              </span>
                            )}
                            <ZoneHeightInput
                              key={`zone-height-${zone.id}-${zone.height ?? "missing"}`}
                              room={room}
                              zone={zone}
                              onSave={(targetZone, height) =>
                                handleZoneHeightSave(targetZone, height)
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell colSpan={3}>
                          <span
                            className={
                              isValidZoneHeight(zone.height)
                                ? "text-xs text-slate-600"
                                : "rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800"
                            }
                          >
                            {isValidZoneHeight(zone.height)
                              ? "Висоту задано"
                              : "Висоту не задано"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right" />
                      </TableRow>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Footer Hint matching Figma 02-rooms */}
        <div className="px-4 py-3 bg-[var(--bim-color-surface-subtle)] border-t border-[var(--bim-color-border-subtle)] text-xs text-[var(--bim-color-text-secondary)] flex items-center justify-between">
          <span>Клік по назві виділяє те саме приміщення на плані.</span>
          <span className="font-mono text-[11px] text-slate-600">
            Всього {total}
          </span>
        </div>
      </div>

      {/* 3. Bottom Blocking Banner matching 02-rooms */}
      {zones.length > 0 && <p className="text-sm text-slate-600">Зони створюються на плані; тут редагується висота. Зони належать одному приміщенню.</p>}
      {zoneEditor?.draft?.kind === "zone" && zoneEditor.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{zoneEditor.error}</p>}
      {zoneEditor?.uncertain && <button type="button" disabled={zoneEditor.busy} onClick={() => void zoneEditor.reconcile()}>Оновити дані після помилки</button>}
      {hasBlocking && (
        <section
          role="alert"
          aria-live="polite"
          data-slot="room-blocking-alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-2xs space-y-2"
        >
          <div className="flex items-center gap-2 font-semibold text-amber-950">
            <span aria-hidden="true" className="text-amber-600 font-bold">
              ⚠
            </span>
            <span>Є причини, що блокують розміщення</span>
          </div>

          <p
            data-slot="room-blocking-description"
            className="text-xs text-amber-800 leading-relaxed"
          >
            {formatBlockingActions(rooms.filter(room => !zones.some(zone => zone.roomId === room.id)), { hasUnsavedChanges })}
            {zones.some(zone => zone.height == null) && " Для зон без висоти введіть висоту в окремому рядку. Решта зон обробляються незалежно."}
          </p>

          <ul
            data-slot="room-blocking-reasons"
            className="list-disc list-inside text-xs text-amber-800 space-y-0.5"
          >
            {blockingReasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
