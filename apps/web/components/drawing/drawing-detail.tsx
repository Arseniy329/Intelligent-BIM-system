"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DrawingStatus, DrawingDetailStatus } from "@bim/contracts";
import { DrawingViewer, type DrawingViewerProps } from "./drawing-viewer";
import { EmptyState } from "@/components/ui/empty-state";
import { drawingApi, drawingErrorMessage, drawingMetadata, downloadLink, fetchDrawingDownload, isDrawingResult,
  type DownloadKind, type DrawingApi, type DrawingResponse } from "@/lib/drawing/drawing-api";
import { useDrawingDetail } from "@/lib/drawing/use-drawing-detail";

const labels: Record<DrawingStatus | DrawingDetailStatus, string> = {
  pending: "Очікує завантаження", uploaded: "Готове до обробки", processing: "Обробляється",
  processed: "Оброблено", failed: "Помилка обробки", error: "Помилка обробки",
};
const button = "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--bim-color-button-disabled-bg)] disabled:text-[var(--bim-color-button-disabled-text)]";
const errorMessage = "rounded-lg border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-3 text-sm text-[var(--bim-color-semantic-error)]";

// Retain the loaded file while GET rotates signed URLs or layers/results change.
// An explicit refresh remounts this component with a fresh URL.
function StableViewer({ candidate, attempt, ...props }: Omit<DrawingViewerProps, "url"> & { candidate: string | null; attempt: number }) {
  const [file, setFile] = useState({ url: candidate, attempt });
  if (attempt !== file.attempt || !file.url && candidate) setFile({ url: candidate, attempt });
  return file.url ? <DrawingViewer {...props} url={file.url} />
    : <EmptyState title="Файл для перегляду недоступний" description="Оновіть посилання на файл. Результат обробки з’явиться після його підготовки." />;
}

function previewUrl(data: DrawingResponse): string | null {
  try { return downloadLink(data, isDrawingResult(data) ? "result" : "source"); }
  catch { return null; }
}

export function DrawingDetail({ id, api = drawingApi, demo = false }: { id: string; api?: DrawingApi; demo?: boolean }) {
  // Key the complete stateful subtree, including mutations and viewer, on navigation.
  return <DrawingDetailContent key={`${demo}:${id}`} id={id} api={api} demo={demo} />;
}

function DrawingDetailContent({ id, api, demo }: { id: string; api: DrawingApi; demo: boolean }) {
  const state = useDrawingDetail(id, api, demo);
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const fileOperation = useRef<AbortController | null>(null);
  const downloadLock = useRef(false);
  useEffect(() => () => fileOperation.current?.abort(), []);
  const download = useMutation({
    mutationFn: async (kind: DownloadKind) => {
      fileOperation.current = new AbortController();
      const { signal } = fileOperation.current;
      const file = await fetchDrawingDownload(api, id, kind, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start consuming the blob, then release it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSettled: () => { downloadLock.current = false; },
  });
  const startDownload = (kind: DownloadKind) => {
    if (downloadLock.current) return;
    downloadLock.current = true;
    download.mutate(kind);
  };

  if (!state.detail.data || state.detail.isError) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Креслення</h1>
      {state.detail.isPending ? <p role="status">Завантаження креслення…</p> : <>
        <p role="alert" className={errorMessage}>{drawingErrorMessage(state.detail.error)}</p>
        <button className={button} disabled={state.detail.isFetching} onClick={() => void state.refresh()}>Спробувати знову</button>
        <Link className={button} href="/login">Увійти</Link>
      </>}
    </div>
  );

  const data = state.detail.data;
  const metadata = drawingMetadata(data);
  const result = isDrawingResult(data) && metadata.status === "processed" ? data : null;
  const url = previewUrl(data);
  const resultDownloadAvailable = !!result?.downloadUrl;
  const error = state.detail.error || state.process.error || state.jobError;
  const processingFailed = state.currentJob?.status === "failed";

  return (
    <div className="min-w-0 space-y-5">
      <Link className={button} href="/upload">Завантажити інше креслення</Link>
      {demo && <p role="status" className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3">Демонстраційний режим. Локальний тестовий DXF та ілюстративні дані; реальна обробка не виконується.</p>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="break-all text-2xl font-semibold">{metadata.originalFileName}</h1>
          <p role="status">Статус: {labels[metadata.status]}</p>
          {!isDrawingResult(data) && <p className="text-sm text-[var(--bim-color-text-secondary)]">Одиниці: {data.units === "from_file" ? "очікується визначення з файла" : data.units === "mm" ? "міліметри" : "метри"}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} onClick={state.start} disabled={state.busy || state.detail.isError || metadata.status === "pending"}>
            {state.process.isPending ? "Надсилання запиту…" : state.busy ? "Обробка…" : "Обробити"}
          </button>
          {!isDrawingResult(data) && <button className={button} disabled={download.isPending}
            onClick={() => startDownload("source")}>
            {download.isPending ? "Завантаження DXF…" : "Завантажити оригінальний DXF"}
          </button>}
          <button className={button} disabled={download.isPending || !resultDownloadAvailable}
            aria-describedby={!resultDownloadAvailable ? "result-download-help" : undefined}
            onClick={() => startDownload("result")}>
            {download.isPending && isDrawingResult(data) ? "Завантаження DXF…" : "Завантажити DXF результату"}
          </button>
          <button className={button} disabled={state.detail.isFetching} onClick={() => void state.refresh()}>Оновити стан</button>
        </div>
      </div>
      {!resultDownloadAvailable && <p id="result-download-help" className="text-sm text-[var(--bim-color-text-secondary)]">DXF результату недоступний: сервер ще не надав посилання на оброблений файл. Оригінальний DXF є окремим файлом.</p>}
      {state.accepted && <p role="status" className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3">Запит прийнято сервером, але повна обробка ще недоступна. Обробку не запущено, результат не створено.</p>}
      {error && <p role="alert" className={errorMessage}>{drawingErrorMessage(error)}</p>}
      {(metadata.status === "failed" || metadata.status === "error" || processingFailed) && <p role="alert" className={errorMessage}>Не вдалося обробити креслення. Спробуйте запустити обробку ще раз.</p>}
      {state.timedOut && <p role="status">Автоматичне оновлення зупинено через 2 хвилини. Обробка може тривати на сервері. Натисніть «Оновити стан», щоб перевірити результат.</p>}
      {download.isError && <p role="alert" className={errorMessage}>{drawingErrorMessage(download.error)}</p>}
      {download.isSuccess && <p role="status">DXF передано браузеру для збереження.</p>}
      <section aria-label="План креслення" className="min-w-0 space-y-3">
        <StableViewer candidate={url} attempt={viewerAttempt} fileName={metadata.originalFileName} rooms={result?.rooms} devices={result?.devices} />
        <button className={button} disabled={state.detail.isFetching} onClick={async () => {
          const refreshed = await state.detail.refetch();
          if (refreshed.isSuccess) setViewerAttempt(value => value + 1);
        }}>Оновити файл</button>
      </section>
      {result ? <section aria-label="Результат обробки" className="space-y-3 rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Результат обробки</h2>
        <p>Приміщень: {result.rooms.length} · Сповіщувачів: {result.devices.length}</p>
        {result.rooms.length ? <ul className="divide-y divide-[var(--bim-color-border-default)]">
          {result.rooms.map((room, index) => <li key={room.id} className="flex flex-wrap justify-between gap-2 py-3">
            <span className="min-w-0 break-words">{room.name ?? `Приміщення ${index + 1}`}</span>
            <span>{room.area.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} м²</span>
          </li>)}
        </ul> : <p>Приміщень не знайдено.</p>}
        {!result.devices.length && <p>Сповіщувачів не знайдено.</p>}
      </section> : <EmptyState title={metadata.status === "processed" ? "Результат ще недоступний" : "Результату обробки ще немає"}
        description={metadata.status === "processed" ? "Сервер повернув лише відомості про креслення. Приміщення, сповіщувачі та DXF результату поки недоступні." : "Після обробки тут з’являться приміщення, їхні площі та кількість сповіщувачів."} />}
    </div>
  );
}
