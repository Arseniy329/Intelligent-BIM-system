"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DrawingStatus, DrawingDetailStatus } from "@bim/contracts";
import { DrawingViewer, type DrawingViewerProps } from "./drawing-viewer";
import { EmptyState } from "@/components/ui/empty-state";
import { drawingApi, drawingErrorMessage, drawingMetadata, downloadLink, fetchDrawingDownload, isDrawingResult, processingErrorMessage,
  type DownloadKind, type DrawingApi, type DrawingResponse } from "@/lib/drawing/drawing-api";
import { useDrawingDetail } from "@/lib/drawing/use-drawing-detail";
import { RoomsTable, RoomEditForm } from "@/components/rooms";
import { mapContractRoomToRoom, getRoomBlockingReasons, type Room } from "@/types/rooms";
import { useUpdateRoomMutation } from "@/lib/rooms/rooms-api";
import { cn } from "@/lib/utils";

export type DrawingTab = "plan" | "rooms" | "rules" | "report";

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
  return file.url ? <DrawingViewer key={file.attempt} {...props} url={file.url} />
    : <EmptyState title="Файл для перегляду недоступний" description="Оновіть посилання на файл. Результат обробки з’явиться після його підготовки." />;
}

function previewUrl(data: DrawingResponse): string | null {
  // Always render the source: generated DXF already contains device blocks,
  // which would duplicate the interactive BIM-60 device symbols.
  try { return downloadLink(data, "source"); }
  catch { return null; }
}

export function DrawingDetail({
  id,
  api = drawingApi,
  demo = false,
  initialTab = "plan",
}: {
  id: string;
  api?: DrawingApi;
  demo?: boolean;
  initialTab?: DrawingTab;
}) {
  // Key the complete stateful subtree, including mutations and viewer, on navigation.
  return <DrawingDetailContent key={`${demo}:${id}`} id={id} api={api} demo={demo} initialTab={initialTab} />;
}

function DrawingDetailContent({
  id,
  api,
  demo,
  initialTab = "plan",
}: {
  id: string;
  api: DrawingApi;
  demo: boolean;
  initialTab?: DrawingTab;
}) {
  const state = useDrawingDetail(id, api, demo);
  const updateRoomMutation = useUpdateRoomMutation(id);
  const [activeTab, setActiveTab] = useState<DrawingTab>(initialTab);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const refreshFileLock = useRef(false);
  const refreshFile = async () => {
    if (refreshFileLock.current) return;
    refreshFileLock.current = true;
    try {
      const refreshed = await state.detail.refetch({ cancelRefetch: false });
      if (refreshed.isSuccess) setViewerAttempt(value => value + 1);
    } finally {
      refreshFileLock.current = false;
    }
  };
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
  const result = isDrawingResult(data) ? data : null;
  const url = previewUrl(data);
  const resultDownloadAvailable = metadata.status === "processed" && !!result?.downloadUrl;
  const error = state.detail.error || state.process.error || state.place.error || state.jobError;
  const processingFailed = state.currentJob?.status === "failed";
  const units = isDrawingResult(data) ? data.drawing.resolvedUnits : data.units;
  const reprocessing = !!result?.rooms.length || metadata.status === "processed";
  const mappedRooms =
    result?.rooms?.map((r, i) => mapContractRoomToRoom(r, i)) ?? [];
  const blockingReasons = getRoomBlockingReasons(mappedRooms);
  const hasPlacementBlocking = blockingReasons.length > 0;

  return (
    <div className="min-w-0 space-y-5">
      <Link className={button} href="/upload">Завантажити інше креслення</Link>
      {demo && <p role="status" className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3">Демонстраційний режим. Локальний тестовий DXF та ілюстративні дані; реальна обробка не виконується.</p>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="break-all text-2xl font-semibold">{metadata.originalFileName}</h1>
          <p role="status">Статус: {state.process.isPending ? "Пошук приміщень…" : state.place.isPending ? "Розміщення приладів…" : metadata.status === "processing" && result ? "Обробку приміщень завершено" : labels[metadata.status]}</p>
          <p className="text-sm text-[var(--bim-color-text-secondary)]">Одиниці: {!units || units === "from_file" ? "очікується визначення з файла" : units === "mm" ? "міліметри" : "метри"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} onClick={() => reprocessing ? setConfirmReprocess(true) : state.start()} disabled={state.busy || state.detail.isFetching || metadata.status === "pending"}>
            {state.process.isPending ? "Пошук приміщень…" : state.busy ? "Обробка…" : reprocessing ? "Обробити повторно" : "Обробити"}
          </button>
          {api.placeDrawing && (
            <button
              className={primaryButton}
              onClick={state.startPlacement}
              disabled={
                state.busy ||
                state.detail.isFetching ||
                !result?.rooms.length ||
                metadata.status === "pending" ||
                hasPlacementBlocking
              }
              title={
                hasPlacementBlocking
                  ? `Розміщення заблоковано:\n${blockingReasons.join("\n")}`
                  : undefined
              }
              aria-disabled={hasPlacementBlocking || undefined}
            >
              {state.place.isPending ? "Розміщення приладів…" : "Розмістити"}
            </button>
          )}
          {!!data.sourceDownloadUrl && <button className={button} disabled={download.isPending || state.busy}
            onClick={() => startDownload("source")}>
            {download.isPending ? "Завантаження DXF…" : "Завантажити оригінальний DXF"}
          </button>}
          <button className={button} disabled={download.isPending || !resultDownloadAvailable || state.busy}
            aria-describedby={!resultDownloadAvailable ? "result-download-help" : undefined}
            onClick={() => startDownload("result")}>
            {download.isPending && isDrawingResult(data) ? "Завантаження DXF…" : "Завантажити DXF результату"}
          </button>
          <button className={button} disabled={state.detail.isFetching || state.busy} onClick={() => void state.refresh()}>Оновити стан</button>
        </div>
      </div>
      {!resultDownloadAvailable && <p id="result-download-help" className="text-sm text-[var(--bim-color-text-secondary)]">DXF результату недоступний: сервер ще не надав посилання на оброблений файл. Оригінальний DXF є окремим файлом.</p>}
      {confirmReprocess && <div role="group" aria-label="Повторна обробка" className="space-y-3 rounded-lg border p-3">
        <p>Повторна обробка перезапише приміщення цього креслення. Продовжити?</p>
        <button className={button} disabled={state.busy} onClick={() => { setConfirmReprocess(false); state.start(); }}>Підтвердити повторну обробку</button>{" "}
        <button className={button} onClick={() => setConfirmReprocess(false)}>Скасувати</button>
      </div>}
      {error && <p role="alert" className={errorMessage}>{drawingErrorMessage(error)}</p>}
      {(metadata.status === "failed" || metadata.status === "error" || processingFailed) && <p role="alert" className={errorMessage}>{processingErrorMessage(result?.drawing.errorMessage ?? state.currentJob?.errorMessage)}</p>}
      {state.timedOut && <p role="status">Автоматичне оновлення зупинено через 2 хвилини. Обробка може тривати на сервері. Натисніть «Оновити стан», щоб перевірити результат.</p>}
      {download.isError && <p role="alert" className={errorMessage}>{drawingErrorMessage(download.error)}</p>}
      {download.isSuccess && <p role="status">DXF передано браузеру для збереження.</p>}

      {/* Top-level 4 Tabs: План, Приміщення, Правила й норми, Звіт */}
      <div
        role="tablist"
        aria-label="Розділи креслення"
        className="flex border-b border-[var(--bim-color-border-default)] gap-1 pt-2"
      >
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "plan"}
          onClick={() => setActiveTab("plan")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            activeTab === "plan"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          План
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "rooms"}
          onClick={() => setActiveTab("rooms")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 cursor-pointer",
            activeTab === "rooms"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          <span>Приміщення</span>
          {mappedRooms.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {mappedRooms.length}
            </span>
          )}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "rules"}
          onClick={() => setActiveTab("rules")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            activeTab === "rules"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          Правила й норми
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "report"}
          onClick={() => setActiveTab("report")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            activeTab === "report"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          Звіт
        </button>
      </div>

      {activeTab === "plan" && (
        <div className="space-y-5">
          {hasPlacementBlocking && (result?.rooms?.length ?? 0) > 0 && (
            <div
              role="alert"
              data-slot="placement-blocked-banner"
              className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-5 items-center justify-center rounded-full bg-amber-200 text-amber-900 text-xs font-bold shrink-0"
                >
                  !
                </span>
                <span>
                  Розміщення приладів заблоковано: {blockingReasons.join("; ")}.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("rooms")}
                className="shrink-0 text-xs font-semibold text-amber-900 underline hover:text-amber-950 cursor-pointer"
              >
                Перейти до приміщень →
              </button>
            </div>
          )}
          <section aria-label="План креслення" className="min-w-0 space-y-3">
            <StableViewer candidate={url} attempt={viewerAttempt} fileName={metadata.originalFileName} rooms={result?.rooms} devices={result?.devices}
              onRetry={demo ? undefined : refreshFile} retryPending={state.detail.isFetching} />
            <button className={button} disabled={state.detail.isFetching || state.busy} onClick={refreshFile}>Оновити файл</button>
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
      )}

      {activeTab === "rooms" && (
        <div className="space-y-5">
          {editingRoom ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setEditingRoom(null)}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)] cursor-pointer"
              >
                <span>←</span>
                <span>До таблиці приміщень</span>
              </button>
              <RoomEditForm
                room={
                  mappedRooms.find((r) => r.id === editingRoom.id) ?? editingRoom
                }
                isSaving={updateRoomMutation.isPending}
                onSave={async (updatedRoom) => {
                  if (!updatedRoom.id) return;
                  await updateRoomMutation.mutateAsync({
                    roomId: updatedRoom.id,
                    patch: {
                      type: updatedRoom.roomType,
                      height: updatedRoom.height,
                    },
                  });
                  setEditingRoom(null);
                }}
                onCancel={() => setEditingRoom(null)}
              />
            </div>
          ) : (
            <RoomsTable
              rooms={mappedRooms}
              selectedRoomId={selectedRoomId}
              onSelectRoom={(room) => setSelectedRoomId(room.id ?? null)}
              onNavigateToPlan={(room) => {
                setSelectedRoomId(room.id ?? null);
                setActiveTab("plan");
              }}
              onEditRoom={(room) => setEditingRoom(room)}
            />
          )}
        </div>
      )}

      {activeTab === "rules" && (
        <section aria-label="Правила й норми" className="rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 space-y-3">
          <h2 className="text-xl font-semibold">Правила й норми</h2>
          <p className="text-sm text-[var(--bim-color-text-secondary)]">
            Перевірка відповідності пожежних датчиків нормативним вимогам ДБН.
          </p>
        </section>
      )}

      {activeTab === "report" && (
        <section aria-label="Звіт" className="rounded-xl border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-6 space-y-3">
          <h2 className="text-xl font-semibold">Звіт</h2>
          <p className="text-sm text-[var(--bim-color-text-secondary)]">
            Зведений звіт про відповідність проекту вимогам безпеки.
          </p>
        </section>
      )}
    </div>
  );
}
