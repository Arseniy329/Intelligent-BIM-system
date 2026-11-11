"use client";

import * as React from "react";
import type { RoomType } from "@bim/contracts";
import { cn } from "@/lib/utils";
import type { Room } from "@/types/rooms";
import { useRoomTypes } from "@/lib/rooms/room-types-api";
import { parseHeightInput, HEIGHT_ERROR_MESSAGE } from "@/lib/rooms/validation";

export interface RoomEditFormProps {
  room: Room;
  roomTypes?: RoomType[];
  onSave?: (updatedRoom: Room) => void | Promise<void>;
  onCancel?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  isSaving?: boolean;
  className?: string;
}

export function RoomEditForm({
  room,
  roomTypes: propRoomTypes,
  onSave,
  onCancel,
  onDirtyChange,
  isSaving = false,
  className,
}: RoomEditFormProps) {
  const { data: fetchedRoomTypes } = useRoomTypes(propRoomTypes);
  const catalog = propRoomTypes ?? fetchedRoomTypes;

  const initialType = room.roomType ?? room.type ?? "";
  const initialHeightStr =
    room.height != null && room.height > 0
      ? String(room.height).replace(".", ",")
      : "";

  const [selectedType, setSelectedType] = React.useState<string>(initialType);
  const [heightInput, setHeightInput] = React.useState<string>(initialHeightStr);
  const [heightError, setHeightError] = React.useState<string | null>(null);
  const heightInputRef = React.useRef<HTMLInputElement>(null);

  // Dirty state tracking
  const normInitialType =
    initialType === "unknown" || !initialType ? "" : initialType;
  const normSelectedType =
    selectedType === "unknown" || !selectedType ? "" : selectedType;
  const isDirty =
    normInitialType !== normSelectedType || heightInput !== initialHeightStr;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Dynamic validation state
  const isTypeAssigned =
    Boolean(selectedType) && selectedType !== "unknown" && selectedType.trim() !== "";
  const parsedHeight = parseHeightInput(heightInput);
  const isHeightValid = parsedHeight.isValid;

  // Header Title & Subtitle matching 03-data
  const title = `${room.number ? `${room.number} · ` : ""}${room.name} — заповнення даних`;

  const confirmationPrefix = room.isConfirmed
    ? "Контур підтверджено."
    : "Контур не підтверджено.";

  let subtitle = `${confirmationPrefix} Дані приміщення заповнено.`;
  if (!isTypeAssigned && !isHeightValid) {
    subtitle = `${confirmationPrefix} Тип і висота залишаються незаповненими.`;
  } else if (!isTypeAssigned) {
    subtitle = `${confirmationPrefix} Оберіть тип приміщення.`;
  } else if (!isHeightValid) {
    subtitle = `${confirmationPrefix} Вкажіть висоту приміщення.`;
  }

  const handleCancel = () => {
    onDirtyChange?.(false);
    onCancel?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = parseHeightInput(heightInput);
    if (!validation.isValid) {
      setHeightError(validation.error ?? HEIGHT_ERROR_MESSAGE);
      heightInputRef.current?.focus();
      return;
    }

    setHeightError(null);

    if (onSave) {
      const updated: Room = {
        ...room,
        roomType: isTypeAssigned ? selectedType : "unknown",
        type: isTypeAssigned ? selectedType : "unknown",
        height: validation.value,
      };
      try {
        await onSave(updated);
        onDirtyChange?.(false);
      } catch {
        // Keep form open, leave dirty, and preserve user input on save error
      }
    }
  };

  return (
    <div
      data-slot="room-edit-view"
      className={cn("space-y-6 min-w-0 w-full", className)}
    >
      {/* View Header matching 03-data */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--bim-color-text-primary)]">
          {title}
        </h2>
        <p
          data-slot="room-edit-subtitle"
          className="text-sm text-[var(--bim-color-text-secondary)]"
        >
          {subtitle}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* 2-Column Grid Layout matching 03-data */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          {/* Left Column: Card "Дані приміщення" */}
          <div className="rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 space-y-5 shadow-xs">
            <h3 className="font-semibold text-lg text-[var(--bim-color-text-primary)]">
              Дані приміщення
            </h3>

            <div className="space-y-4">
              {/* Field 1: Тип приміщення */}
              <div>
                <label
                  htmlFor="room-type-select"
                  className="block text-sm font-medium text-[var(--bim-color-text-primary)] mb-1"
                >
                  Тип приміщення
                </label>
                <select
                  id="room-type-select"
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full rounded-lg border border-[var(--bim-color-input-border)] bg-[var(--bim-color-surface-default)] px-3 py-2 text-sm text-[var(--bim-color-text-primary)] focus:border-[var(--bim-color-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--bim-color-border-focus)]/20 cursor-pointer"
                >
                  <option value="">Тип не визначено</option>
                  {catalog
                    .filter((t) => t.code !== "unknown")
                    .map((type) => (
                      <option key={type.code} value={type.code}>
                        {type.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Field 2: Висота, м */}
              <div>
                <label
                  htmlFor="room-height-input"
                  className="block text-sm font-medium text-[var(--bim-color-text-primary)] mb-1"
                >
                  Висота, м
                </label>
                <input
                  id="room-height-input"
                  ref={heightInputRef}
                  type="text"
                  value={heightInput}
                  onChange={(e) => {
                    setHeightInput(e.target.value);
                    if (heightError) setHeightError(null);
                  }}
                  placeholder="«Вкажіть висоту приміщення»"
                  aria-invalid={Boolean(heightError)}
                  aria-describedby={heightError ? "room-height-error" : undefined}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bim-color-surface-default)] text-[var(--bim-color-text-primary)] transition-colors focus:outline-none focus:ring-2",
                    heightError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                      : "border-[var(--bim-color-input-border)] focus:border-[var(--bim-color-border-focus)] focus:ring-[var(--bim-color-border-focus)]/20"
                  )}
                />
                {heightError && (
                  <p
                    id="room-height-error"
                    role="alert"
                    className="text-red-600 text-sm mt-1"
                  >
                    {heightError}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-5 py-2 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--bim-color-button-disabled-bg)] disabled:text-[var(--bim-color-button-disabled-text)] cursor-pointer"
                >
                  {isSaving ? "Збереження…" : "Зберегти дані"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  Скасувати
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Card "Що потрібно виправити" */}
          <div className="rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 space-y-4 shadow-xs">
            <h3 className="font-semibold text-lg text-[var(--bim-color-text-primary)]">
              Що потрібно виправити
            </h3>

            <ul className="space-y-3 text-sm">
              {!isTypeAssigned ? (
                <li className="flex items-center gap-2 text-amber-800 font-medium">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800"
                  >
                    ?
                  </span>
                  <span>Тип не визначено</span>
                </li>
              ) : (
                <li className="flex items-center gap-2 text-emerald-800 font-medium">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800"
                  >
                    ✓
                  </span>
                  <span>Тип вказано</span>
                </li>
              )}

              {!isHeightValid ? (
                <li className="flex items-center gap-2 text-amber-800 font-medium">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800"
                  >
                    ?
                  </span>
                  <span>Висоту не вказано</span>
                </li>
              ) : (
                <li className="flex items-center gap-2 text-emerald-800 font-medium">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800"
                  >
                    ✓
                  </span>
                  <span>Висоту вказано</span>
                </li>
              )}
            </ul>

            <div className="border-t border-[var(--bim-color-border-default)] pt-4 text-xs text-[var(--bim-color-text-secondary)] space-y-2">
              <p>• Виберіть тип зі списку системи.</p>
              <p>• Значення 3,0 та 3.0 приймаються як 3 м.</p>
              <p>• Помилку показуємо біля відповідного поля.</p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

