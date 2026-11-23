"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DrawingDetail } from "@/components/drawing/drawing-detail";
import { RuleStatusBadge } from "@/components/rooms/badges";
import {
  getRoomRuleStatusAndReason,
  isInsufficientDataStatus,
  mapContractRoomToRoom,
  pluralizeRooms,
} from "@/types/rooms";
import { isDrawingDemoEnabled } from "@/lib/drawing/demo-mode";
import {
  drawingApi as legacyDrawingApi,
  isDrawingResult,
} from "@/lib/drawing/drawing-api";
import { useDrawingDetail } from "@/lib/drawing/use-drawing-detail";
import { ApiHttpError } from "@/lib/api";

const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]";
const errorPanel =
  "rounded-xl border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-4 text-sm text-[var(--bim-color-semantic-error)]";
const panel =
  "space-y-4 rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-4 sm:p-6";

type ErrorState =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

function toErrorState(error: unknown): ErrorState {
  let status: number | undefined;
  if (error instanceof ApiHttpError) {
    status = error.statusCode;
  } else if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number") status = record.status;
    else if (typeof record.statusCode === "number") status = record.statusCode;
  }

  if (
    status === 401 ||
    (error instanceof Error && error.name === "ApiAuthenticationError")
  ) {
    return { kind: "unauthorized" };
  }
  if (status === 404) return { kind: "not-found" };
  if (status === 403) return { kind: "forbidden" };
  return {
    kind: "error",
    message: "Не вдалося завантажити креслення. Спробуйте ще раз.",
  };
}

const MISSING_REASON_FALLBACK = "Причина не вказана";

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
  const demo = isDrawingDemoEnabled();
  const liveDetail = useDrawingDetail(id, legacyDrawingApi, demo);

  const isPending = liveDetail.detail.isPending;
  const isError = liveDetail.detail.isError;
  const errorState = isError ? toErrorState(liveDetail.detail.error) : null;

  useEffect(() => {
    if (errorState?.kind === "unauthorized") {
      router.replace("/login");
    }
  }, [router, errorState?.kind]);

  const detailData = liveDetail.detail.data;
  const rawRooms: unknown[] =
    detailData && isDrawingResult(detailData)
      ? detailData.rooms
      : Array.isArray((detailData as unknown as Record<string, unknown>)?.rooms)
        ? ((detailData as unknown as Record<string, unknown>).rooms as unknown[])
        : [];

  const mappedRooms = rawRooms.map((r, i) =>
    mapContractRoomToRoom(r as Parameters<typeof mapContractRoomToRoom>[0], i)
  );

  const insufficientRooms = mappedRooms
    .map((room, index) => ({
      room,
      index,
      evaluation: getRoomRuleStatusAndReason(room),
    }))
    .filter(({ evaluation }) => isInsufficientDataStatus(evaluation.status));

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

      {errorState?.kind === "not-found" && (
        <section role="alert" className={panel}>
          <h1 className="text-2xl font-semibold">Креслення не знайдено</h1>
          <p>Креслення з таким ідентифікатором не існує або недоступне.</p>
          <Link href="/drawings" className={primaryButton}>
            До списку креслень
          </Link>
        </section>
      )}

      {errorState?.kind === "forbidden" && (
        <section role="alert" className={panel}>
          <h1 className="text-2xl font-semibold">Немає доступу до креслення</h1>
          <p>У вас немає прав на перегляд цього креслення.</p>
          <Link href="/drawings" className={primaryButton}>
            До списку креслень
          </Link>
        </section>
      )}

      {errorState?.kind === "unauthorized" && (
        <section role="status" className={panel}>
          <h1 className="text-2xl font-semibold">Потрібно увійти</h1>
          <p>Перенаправлення на сторінку входу…</p>
          <Link href="/login" className={primaryButton}>
            Увійти
          </Link>
        </section>
      )}

      {errorState?.kind === "error" && (
        <section role="alert" className={errorPanel}>
          <h1 className="text-xl font-semibold">Помилка завантаження</h1>
          <p>{errorState.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={() => void liveDetail.detail.refetch()}
            >
              Спробувати знову
            </button>
            <Link href="/drawings" className={secondaryButton}>
              До списку креслень
            </Link>
          </div>
        </section>
      )}

      {isPending && <LoadingSkeleton />}

      {!isPending && !errorState && (
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
                {pluralizeRooms(insufficientRooms.length)} без достатніх даних
              </p>
              <ul className="space-y-1.5">
                {insufficientRooms.map(({ room, index, evaluation }) => {
                  const key = room.id || `room-${index}`;
                  const displayName = room.number
                    ? `${room.number} · ${room.name}`
                    : room.name || `Приміщення ${index + 1}`;
                  const displayReason =
                    evaluation.reason ?? MISSING_REASON_FALLBACK;
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="min-w-0 break-words">{displayName}</span>
                      <RuleStatusBadge
                        status="insufficient_data"
                        reason={displayReason}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <DrawingDetail id={id} demo={demo} />
        </>
      )}
    </div>
  );
}
