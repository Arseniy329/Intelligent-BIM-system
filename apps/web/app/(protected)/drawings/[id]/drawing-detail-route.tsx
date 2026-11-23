"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { RuleStatusBadge } from "@/components/rooms/badges";
import { isInsufficientDataStatus, pluralizeRooms } from "@/types/rooms";
import {
  ApiError,
  getDrawing,
  type DrawingDetail as DrawingDetailData,
} from "@/lib/api/drawings";
import {
  drawingApi as legacyDrawingApi,
  type DrawingResponse,
} from "@/lib/drawing/drawing-api";

const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]";
const errorPanel =
  "rounded-xl border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-4 text-sm text-[var(--bim-color-semantic-error)]";
const panel =
  "space-y-4 rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-4 sm:p-6";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; drawing: DrawingDetailData; sourceUrl: string | null }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number") return record.status;
    if (typeof record.statusCode === "number") return record.statusCode;
  }
  return undefined;
}

function toErrorState(error: unknown): LoadState {
  const status = errorStatus(error);
  if (status === 401 || (error instanceof Error && error.name === "ApiAuthenticationError")) {
    return { kind: "unauthorized" };
  }
  if (status === 404) return { kind: "not-found" };
  if (status === 403) return { kind: "forbidden" };
  return { kind: "error", message: "Не вдалося завантажити креслення. Спробуйте ще раз." };
}

function legacyMetadata(value: DrawingResponse) {
  return "drawing" in value ? value.drawing : value;
}

function legacyStatus(value: DrawingResponse): DrawingDetailData["status"] | null {
  const status = String(legacyMetadata(value).status);
  if (status === "pending") return "uploaded";
  if (status === "done") return "processed";
  if (status === "error" || status === "failed") return "failed";
  if (status === "uploaded" || status === "processing" || status === "processed") {
    return status;
  }
  return null;
}

function legacyRooms(value: DrawingResponse) {
  return "drawing" in value ? value.rooms : undefined;
}

function legacyDevices(value: DrawingResponse) {
  return "drawing" in value ? value.devices : undefined;
}

function legacySourceUrl(value: DrawingResponse): string | null {
  const url = value.sourceDownloadUrl;
  return typeof url === "string" && url ? url : null;
}

const RULE_STATUS_VALUES = new Set([
  "verified",
  "needs_review",
  "review_needed",
  "insufficient_data",
]);

const MISSING_REASON_FALLBACK = "Причина не вказана";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readRoomField(
  room: unknown,
  keys: string[],
): string | null {
  const record = asRecord(room);
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function roomRuleStatus(room: unknown): string | null {
  const raw = readRoomField(room, [
    "rule_status",
    "ruleStatus",
    "review_status",
    "reviewStatus",
    "status",
  ]);
  return raw && RULE_STATUS_VALUES.has(raw) ? raw : null;
}

function roomRuleReason(room: unknown): string | null {
  return readRoomField(room, [
    "reason",
    "status_reason",
    "statusReason",
    "rule_reason",
    "ruleReason",
  ]);
}

function isInsufficientRoom(room: unknown): boolean {
  const status = roomRuleStatus(room);
  if (status) return isInsufficientDataStatus(status);

  // Status missing: fall back to completeness signals so a room without
  // height/type is still surfaced as insufficient on the drawing page.
  const record = asRecord(room);
  if (!record) return false;
  const type =
    typeof record.type === "string"
      ? record.type
      : typeof record.roomType === "string"
        ? record.roomType
        : null;
  const height = typeof record.height === "number" ? record.height : null;
  const typeMissing = !type || type.trim() === "" || type === "unknown";
  const heightMissing =
    height === null || height <= 0 || !Number.isFinite(height);
  return typeMissing || heightMissing || Boolean(roomRuleReason(room));
}

function roomDisplayName(room: unknown, index: number): string {
  const record = asRecord(room);
  const name =
    record && typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : null;
  const number =
    record && typeof record.number === "string" && record.number.trim()
      ? record.number.trim()
      : null;
  if (number && name) return `${number} · ${name}`;
  return name ?? number ?? `Приміщення ${index + 1}`;
}

function roomKey(room: unknown, index: number): string {
  const record = asRecord(room);
  if (record && typeof record.id === "string" && record.id) return record.id;
  return `room-${index}`;
}

function embeddedSourceUrl(value: DrawingDetailData): string | null {
  const record = value as unknown as Record<string, unknown>;
  for (const key of ["sourceDownloadUrl", "source_download_url"]) {
    const url = record[key];
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function mergeDrawing(
  primary: DrawingDetailData,
  legacy: DrawingResponse | null,
): DrawingDetailData {
  if (!legacy) return primary;

  const metadata = legacyMetadata(legacy);
  const status = legacyStatus(legacy);
  const rooms = primary.rooms?.length ? primary.rooms : legacyRooms(legacy);
  const devices = primary.devices?.length ? primary.devices : legacyDevices(legacy);
  const hasResult = primary.has_result || !!rooms?.length || !!devices?.length;
  const effectiveStatus =
    primary.status === "uploaded" && status && status !== "uploaded"
      ? status
      : primary.status;

  return {
    ...primary,
    filename: primary.filename || metadata.originalFileName,
    uploaded_at: primary.uploaded_at || metadata.createdAt,
    status: effectiveStatus,
    error_message:
      primary.error_message ??
      ("errorMessage" in metadata ? metadata.errorMessage ?? null : null),
    has_result: hasResult,
    rooms,
    devices,
  };
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Завантаження креслення…</span>
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-[var(--bim-color-surface-subtle)]" />
      <div className="h-5 w-1/3 animate-pulse rounded bg-[var(--bim-color-surface-subtle)]" />
      <div className="h-64 animate-pulse rounded-xl bg-[var(--bim-color-surface-subtle)] sm:h-96" />
    </div>
  );
}

export function DrawingDetailRoute({ id }: { id: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      let drawing: DrawingDetailData;
      try {
        drawing = await getDrawing(id, controller.signal);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState(toErrorState(error));
        return;
      }
      if (!active || controller.signal.aborted) return;

      const embeddedUrl = embeddedSourceUrl(drawing);
      let legacyDrawing: DrawingResponse | null = null;
      if (!embeddedUrl || drawing.status === "uploaded") {
        try {
          legacyDrawing = await legacyDrawingApi.getDrawing(id, controller.signal);
        } catch {
          legacyDrawing = null;
        }
      }
      if (!active || controller.signal.aborted) return;

      setState({
        kind: "ready",
        drawing: mergeDrawing(drawing, legacyDrawing),
        sourceUrl:
          embeddedUrl ||
          (legacyDrawing ? legacySourceUrl(legacyDrawing) : null),
      });
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, attempt]);

  useEffect(() => {
    if (state.kind === "unauthorized") router.replace("/login");
  }, [router, state.kind]);

  return (
    <div className="min-w-0 space-y-5">
      <nav aria-label="Навігація" className="text-sm">
        <Link
          href="/drawings"
          className="inline-flex items-center gap-1 text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
        >
          ← Мої креслення
        </Link>
      </nav>

      {state.kind === "loading" && <LoadingSkeleton />}

      {state.kind === "not-found" && (
        <section role="alert" className={panel}>
          <h1 className="text-2xl font-semibold">Креслення не знайдено</h1>
          <p>Креслення з таким ідентифікатором не існує або недоступне.</p>
          <Link href="/drawings" className={primaryButton}>
            До списку креслень
          </Link>
        </section>
      )}

      {state.kind === "forbidden" && (
        <section role="alert" className={panel}>
          <h1 className="text-2xl font-semibold">Немає доступу до креслення</h1>
          <p>У вас немає прав на перегляд цього креслення.</p>
          <Link href="/drawings" className={primaryButton}>
            До списку креслень
          </Link>
        </section>
      )}

      {state.kind === "unauthorized" && (
        <section role="status" className={panel}>
          <h1 className="text-2xl font-semibold">Потрібно увійти</h1>
          <p>Перенаправлення на сторінку входу…</p>
          <Link href="/login" className={primaryButton}>
            Увійти
          </Link>
        </section>
      )}

      {state.kind === "error" && (
        <section role="alert" className={errorPanel}>
          <h1 className="text-xl font-semibold">Помилка завантаження</h1>
          <p>{state.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryButton} onClick={refresh}>
              Спробувати знову
            </button>
            <Link href="/drawings" className={secondaryButton}>
              До списку креслень
            </Link>
          </div>
        </section>
      )}

      {state.kind === "ready" &&
        (() => {
          const rooms: unknown[] = Array.isArray(state.drawing.rooms)
            ? state.drawing.rooms
            : [];
          const insufficientRooms = rooms.filter(isInsufficientRoom);
          return (
            <>
              {insufficientRooms.length > 0 && (
                <section
                  data-slot="insufficient-data-summary"
                  aria-label="Приміщення без достатніх даних"
                  className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-700 shadow-xs"
                >
                  <p
                    data-slot="insufficient-data-summary-text"
                    className="font-medium"
                  >
                    {pluralizeRooms(insufficientRooms.length)} без достатніх
                    даних
                  </p>
                  <ul className="space-y-1.5">
                    {insufficientRooms.map((room, index) => (
                      <li
                        key={roomKey(room, index)}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="min-w-0 break-words">
                          {roomDisplayName(room, index)}
                        </span>
                        <RuleStatusBadge
                          status="insufficient_data"
                          reason={
                            roomRuleReason(room) ?? MISSING_REASON_FALLBACK
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <DrawingDetail id={id} />
            </>
          );
        })()}
    </div>
  );
}
