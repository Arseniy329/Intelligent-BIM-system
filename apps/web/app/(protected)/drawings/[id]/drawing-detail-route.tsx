"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DrawingViewer } from "@/components/drawing/drawing-viewer";
import { ApiError, getDrawing, type DrawingDetail } from "@/lib/api/drawings";
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
  | { kind: "ready"; drawing: DrawingDetail; sourceUrl: string | null }
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

function legacyStatus(value: DrawingResponse): DrawingDetail["status"] | null {
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

function embeddedSourceUrl(value: DrawingDetail): string | null {
  const record = value as unknown as Record<string, unknown>;
  for (const key of ["sourceDownloadUrl", "source_download_url"]) {
    const url = record[key];
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function mergeDrawing(
  primary: DrawingDetail,
  legacy: DrawingResponse | null,
): DrawingDetail {
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

function SourcePlanNotice() {
  return (
    <p
      role="status"
      className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3 text-sm text-[var(--bim-color-text-secondary)]"
    >
      Результат розміщення для цього креслення ще не збережено. Показано
      вихідний план.
    </p>
  );
}

function UnavailablePlan() {
  return (
    <p
      role="status"
      className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3 text-sm text-[var(--bim-color-text-secondary)]"
    >
      Файл для перегляду недоступний. Оновіть сторінку, щоб отримати нове
      посилання на план.
    </p>
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
      let drawing: DrawingDetail;
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

      {state.kind === "ready" && (
        <DrawingContent
          drawing={state.drawing}
          sourceUrl={state.sourceUrl}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function DrawingContent({
  drawing,
  sourceUrl,
  refresh,
}: {
  drawing: DrawingDetail;
  sourceUrl: string | null;
  refresh: () => void;
}) {
  const filename = drawing.filename || "Креслення";
  const rooms = drawing.rooms ?? [];
  const devices = drawing.devices ?? [];

  if (drawing.status === "processing") {
    return (
      <section className={panel}>
        <h1 className="text-2xl font-semibold">Обробка триває</h1>
        <p className="break-all text-[var(--bim-color-text-secondary)]">
          {filename}
        </p>
        <p>
          Креслення ще обробляється. Оновіть сторінку, щоб перевірити
          результат.
        </p>
        <button type="button" className={primaryButton} onClick={refresh}>
          Оновити
        </button>
      </section>
    );
  }

  if (drawing.status === "failed") {
    return (
      <section role="alert" className={errorPanel}>
        <h1 className="text-2xl font-semibold">Помилка обробки креслення</h1>
        <p className="break-all font-medium">{filename}</p>
        <p>
          {drawing.error_message?.trim() ||
            "Сервер не повідомив причину помилки. Спробуйте обробити креслення повторно."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/drawings" className={primaryButton}>
            До списку креслень
          </Link>
          <button type="button" className={secondaryButton} onClick={refresh}>
            Оновити стан
          </button>
        </div>
      </section>
    );
  }

  if (drawing.status === "processed" && !drawing.has_result) {
    return (
      <section aria-label="План креслення" className="space-y-3">
        <h1 className="break-all text-2xl font-semibold">{filename}</h1>
        <SourcePlanNotice />
        {sourceUrl ? (
          <DrawingViewer url={sourceUrl} fileName={filename} />
        ) : (
          <UnavailablePlan />
        )}
      </section>
    );
  }

  if (drawing.has_result) {
    return (
      <section aria-label="План креслення" className="space-y-3">
        <div className="space-y-1">
          <h1 className="break-all text-2xl font-semibold">{filename}</h1>
          <p className="text-sm text-[var(--bim-color-text-secondary)]">
            Приміщень: {rooms.length} · Пристроїв: {devices.length}
          </p>
        </div>
        {!sourceUrl && <UnavailablePlan />}
        <DrawingViewer
          url={sourceUrl ?? ""}
          fileName={filename}
          rooms={rooms}
          devices={devices}
        />
      </section>
    );
  }

  return (
    <section aria-label="План креслення" className="space-y-3">
      <h1 className="break-all text-2xl font-semibold">{filename}</h1>
      <SourcePlanNotice />
      {sourceUrl ? (
        <DrawingViewer url={sourceUrl} fileName={filename} />
      ) : (
        <UnavailablePlan />
      )}
    </section>
  );
}
