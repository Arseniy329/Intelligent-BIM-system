"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRules, type Rule } from "@/lib/api/rules";
import type { DrawingStatus, DrawingDetailStatus, Finding } from "@bim/contracts";
import { DrawingViewer, type DrawingViewerProps } from "./drawing-viewer";
import { EmptyState } from "@/components/ui/empty-state";
import { drawingApi, drawingErrorMessage, drawingMetadata, downloadLink, fetchDrawingDownload, isDrawingResult, placementReport, processingErrorMessage,
  type DownloadKind, type DrawingApi, type DrawingResponse, type DrawingResultView } from "@/lib/drawing/drawing-api";
import { useDrawingDetail } from "@/lib/drawing/use-drawing-detail";
import { RoomsTable, RoomEditForm } from "@/components/rooms";
import { mapContractRoomToRoom, getRoomBlockingReasons, type Room } from "@/types/rooms";
import { useUpdateRoomMutation } from "@/lib/rooms/rooms-api";
import { useRoomTypes } from "@/lib/rooms/room-types-api";
import { usePlanEditor } from "@/lib/drawing/use-plan-editor";
import { PlanEditorPanel, PlanWorkPanel } from "./plan-editor-panel";
import { INITIAL_PLAN_LAYERS, PlanLayersPanel } from "./plan-layers";
import { PlanFeaturesPanel } from "./plan-features-panel";
import { planFeaturesApi } from "@/lib/drawing/plan-features-api";
import { cn } from "@/lib/utils";
import workspaceStyles from "./drawing-workspace.module.css";
import findingsStyles from "./findings-panel.module.css";
import reportStyles from "./engineering-report.module.css";
import { FindingsPanel } from "./findings-panel";
import { EngineeringReport } from "./engineering-report";
import { useFindings } from "@/lib/drawing/use-findings";
import { fetchFindings, findingTarget } from "@/lib/drawing/findings";
import { buildEngineeringReportData, downloadHtmlReport, isDemoDrawing, resolveFindingsAuditState, triggerBlobDownload, type ReportAuditStatus } from "@/lib/drawing/report";
import type { DrawingPoint, DrawingViewportController } from "@/lib/drawing/viewer-adapter";

export type DrawingTab = "plan" | "rooms" | "rules" | "findings" | "report";

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
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [markerActivation, setMarkerActivation] = useState<Pick<Finding, "id" | "severity"> | null>(null);
  const [controller, setController] = useState<DrawingViewportController | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ point: DrawingPoint } | null>(null);
  useEffect(() => { if (focusRequest && controller) controller.focusPoint?.(focusRequest.point); }, [controller, focusRequest]);
  const [layers, setLayers] = useState(INITIAL_PLAN_LAYERS);
  const [mode, setMode] = useState<"rooms" | "devices">("rooms");
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isEditingRoomDirty, setIsEditingRoomDirty] = useState(false);
  const loadedResult = state.detail.data && isDrawingResult(state.detail.data) ? state.detail.data : null;
  const queryClient = useQueryClient();
  const featureOptions = (revision: number) => ({
    queryKey: ["drawing-features", id, revision],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const [zones, exits] = await Promise.all([planFeaturesApi.zones(id, signal), planFeaturesApi.exits(id, signal)]);
      return { zones, exits };
    },
    retry: false, refetchOnWindowFocus: false, staleTime: Infinity,
  });
  const features = useQuery({ ...featureOptions(state.detail.dataUpdatedAt), enabled: !demo && !!loadedResult });
  const rules = useQuery({
    queryKey: ["drawing-rules", id, state.detail.dataUpdatedAt],
    queryFn: ({ signal }) => fetchRules(signal),
    enabled: !demo && (!!loadedResult?.devices.some(device => device.ruleId) || (activeTab === "findings" || activeTab === "report") && !!loadedResult),
    retry: false, refetchOnWindowFocus: false,
  });
  const editor = usePlanEditor({ drawingId: id, rooms: loadedResult?.rooms ?? [], devices: loadedResult?.devices ?? [], selectRoom: setSelectedRoomId,
    refresh: async () => {
      const updated = await state.detail.refetch({ cancelRefetch: false });
      if (updated.isError) throw updated.error;
      if (!demo) await queryClient.fetchQuery(featureOptions(updated.dataUpdatedAt));
    },
  });
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const findingsSuspended = state.busy || state.detail.isFetching || state.detail.isError || editor.busy || editor.uncertain || updateRoomMutation.isPending;
  const findingsApplicable = loadedResult?.drawing.status === "processed";
  const findings = useFindings(id, state.detail.dataUpdatedAt, !demo && findingsApplicable && !findingsSuspended);
  const currentFindings = !demo && !findingsSuspended && !findings.isFetching && !findings.isError ? findings.data ?? [] : [];
  const effectiveFindingId = currentFindings.some(f => f.id === selectedFindingId) ? selectedFindingId : null;
  if (selectedFindingId && findings.isSuccess && !findings.isFetching && !findingsSuspended && !findings.data.some(f => f.id === selectedFindingId)) {
    setSelectedFindingId(null);
    setFocusRequest(null);
  }
  const selectFinding = (finding: Finding) => {
    if (editor.blocked) return;
    setSelectedFindingId(finding.id);
    setActiveTab("findings");
    setLayers(previous => ({ ...previous, findings: true }));
    const target = findingTarget(finding, loadedResult?.rooms ?? [], loadedResult?.devices ?? []);
    setFocusRequest(target ? { point: target.point } : null);
  };
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const navigateTab = (tab: DrawingTab) => {
    if (!editor.blocked) setActiveTab(tab);
  };
  const refreshFileLock = useRef(false);
  const refreshFile = async () => {
    if (refreshFileLock.current || editor.blocked || state.busy) return;
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
  type DownloadAction = DownloadKind | "report-bundle";
  const download = useMutation({
    mutationFn: async (kind: DownloadAction): Promise<"dxf" | "bundle" | "html-only"> => {
      fileOperation.current = new AbortController();
      const { signal } = fileOperation.current;
      if (kind === "report-bundle") {
        const snapshot = state.detail.data;
        if (!snapshot || !isDrawingResult(snapshot)) {
          throw new Error("Результат обробки ще недоступний.");
        }
        const canDownloadDxf = snapshot.drawing.status === "processed" && !!snapshot.downloadUrl;
        let dxfFile: { blob: Blob; fileName: string } | null = null;
        if (canDownloadDxf) {
          dxfFile = await fetchDrawingDownload(api, id, "result", signal);
          if (signal.aborted) return "bundle";
        }
        let reportFindings: Finding[] = [];
        let auditStatus: ReportAuditStatus = "pending";
        let auditError: string | null = null;
        if (isDemoDrawing(snapshot.drawing, demo)) {
          auditStatus = "demo";
        } else if (snapshot.drawing.status !== "processed") {
          auditStatus = "pending";
        } else if (findings.isError) {
          auditStatus = "unavailable";
          auditError = drawingErrorMessage(findings.error);
        } else if (findings.isSuccess && !findings.isFetching && !findingsSuspended) {
          reportFindings = findings.data;
          auditStatus = "completed";
        } else {
          try {
            reportFindings = await fetchFindings(id, signal);
            if (signal.aborted) return "bundle";
            auditStatus = "completed";
          } catch (err) {
            if (signal.aborted) return "bundle";
            auditStatus = "unavailable";
            auditError = drawingErrorMessage(err);
          }
        }
        let reportRules: Rule[] = rules.data ?? [];
        if (!demo && rules.data === undefined && !rules.isError &&
          (reportFindings.some(f => f.ruleId) || snapshot.devices.some(d => d.ruleId))) {
          reportRules = await fetchRules(signal).catch(() => []);
          if (signal.aborted) return "bundle";
        }
        const reportData = buildEngineeringReportData({
          drawing: snapshot.drawing,
          rooms: snapshot.rooms,
          devices: snapshot.devices,
          findings: reportFindings,
          rules: reportRules,
          placementWarnings: placementReport(snapshot)?.warnings ?? [],
          auditStatus,
          auditError,
        });
        if (dxfFile) {
          triggerBlobDownload(dxfFile.blob, dxfFile.fileName);
        }
        downloadHtmlReport(reportData);
        return dxfFile ? "bundle" : "html-only";
      }
      const file = await fetchDrawingDownload(api, id, kind, signal);
      if (signal.aborted) return "dxf";
      triggerBlobDownload(file.blob, file.fileName);
      return "dxf";
    },
    onSettled: () => { downloadLock.current = false; },
  });
  const startDownload = (kind: DownloadAction) => {
    if (downloadLock.current || (kind === "result" || kind === "report-bundle") && editor.blocked) return;
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
  // `processed` only means the placement step finished; skipped rooms/zones come with reasons.
  // The report of the POST that just ran wins; otherwise the one the API stored with the
  // result, so a reload or a shared link shows the same reasons and warnings next to it.
  const placement = placementReport(state.place.data) ?? placementReport(data);
  const stepWarnings = [...new Set([
    ...(placementReport(state.process.data)?.warnings ?? []),
    ...(placement?.warnings ?? []),
  ])];
  const units = isDrawingResult(data) ? data.drawing.resolvedUnits : data.units;
  const reprocessing = !!result?.rooms.length || metadata.status === "processed";
  const mappedRooms =
    result?.rooms?.map((r, i) => mapContractRoomToRoom(r, i)) ?? [];
  const roomBlockingReasons = getRoomBlockingReasons(mappedRooms, false, new Set(features.data?.zones.map(zone => zone.roomId)));
  const editBlockingReasons: string[] = [];
  if (editor.blocked) editBlockingReasons.push("Збережіть або скасуйте зміни плану перед розміщенням");
  if (updateRoomMutation.isPending) {
    editBlockingReasons.push("Триває збереження даних...");
  } else if (isEditingRoomDirty) {
    editBlockingReasons.push(
      "Збережіть або скасуйте зміни приміщення перед розміщенням"
    );
  }
  const blockingReasons = [...editBlockingReasons, ...roomBlockingReasons];
  const hasPlacementBlocking = blockingReasons.length > 0;

  return (
    <div className={workspaceStyles.workspace} data-drawing-workspace="">
      <nav aria-label="Шлях до креслення" className={workspaceStyles.breadcrumb} data-print-hide="true">
        {["Робочий простір", "Креслення"].map(label => <Fragment key={label}>
          <Link href="/drawings" aria-disabled={editor.blocked || undefined}
            onClick={event => { if (editor.blocked) event.preventDefault(); }}>{label}</Link><span>/</span>
        </Fragment>)}
        <span>{metadata.originalFileName}</span>
      </nav>
      {demo && <p role="status" data-print-hide="true" className="rounded-lg border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-3">Демонстраційний режим. Локальний тестовий DXF та ілюстративні дані; реальна обробка не виконується.</p>}
      <div className={workspaceStyles.heading} data-print-hide="true">
        <div className="min-w-0 space-y-2">
          <p className={workspaceStyles.eyebrow}>КРЕСЛЕННЯ</p>
          <h1 className="break-all text-2xl font-semibold">{metadata.originalFileName.replace(/\.dxf$/i, "")}</h1>
          <p className={workspaceStyles.fileName}>{metadata.originalFileName}</p>
        </div>
        <div className={workspaceStyles.headingActions}>
        <button
          type="button"
          className={primaryButton}
          disabled={
            download.isPending ||
            metadata.status !== "processed" ||
            !result ||
            state.busy ||
            editor.blocked
          }
          onClick={() => startDownload("report-bundle")}
        >
          {download.isPending && download.variables === "report-bundle"
            ? "Підготовка звіту…"
            : "Завантажити звіт"}
        </button>
        {!demo && metadata.status === "processed" && !!result && (
          <Link
            className={button}
            href={`/drawings/${id}/report`}
            aria-disabled={editor.blocked || undefined}
            onClick={event => { if (editor.blocked) event.preventDefault(); }}
          >
            Відкрити звіт
          </Link>
        )}
        <Link className={button} href="/upload" aria-disabled={editor.blocked || undefined}
          onClick={event => { if (editor.blocked) event.preventDefault(); }}>Замінити файл</Link>
        <details className={workspaceStyles.operations}><summary aria-label="Дії з кресленням">⋯</summary><div className="flex flex-wrap gap-2">
          <p role="status">Статус: {state.process.isPending ? "Пошук приміщень…" : state.place.isPending ? "Розміщення приладів…" : metadata.status === "processing" && result ? "Обробку приміщень завершено" : labels[metadata.status]}</p>
          <p className="text-sm text-[var(--bim-color-text-secondary)]">Одиниці: {!units || units === "from_file" ? "очікується визначення з файла" : units === "mm" ? "міліметри" : "метри"}</p>
          <button className={primaryButton} onClick={() => {
            if (state.busy || editor.blocked || state.detail.isFetching) return;
            if (reprocessing) setConfirmReprocess(true); else state.start();
          }} disabled={state.busy || editor.blocked || state.detail.isFetching || metadata.status === "pending"}>
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
          <button className={button} disabled={download.isPending || !resultDownloadAvailable || state.busy || editor.blocked}
            aria-describedby={!resultDownloadAvailable ? "result-download-help" : undefined}
            onClick={() => startDownload("result")}>
            {download.isPending && isDrawingResult(data) ? "Завантаження DXF…" : "Завантажити DXF результату"}
          </button>
          <button className={button} disabled={state.detail.isFetching || state.busy || editor.blocked} onClick={() => void state.refresh()}>Оновити стан</button>
          <button className={button} disabled={state.detail.isFetching || state.busy || editor.blocked} onClick={refreshFile}>Оновити файл</button>
          {!resultDownloadAvailable && <p id="result-download-help" className="text-sm text-[var(--bim-color-text-secondary)]">DXF результату недоступний: сервер ще не надав посилання на оброблений файл. Оригінальний DXF є окремим файлом.</p>}
        </div></details></div>
      </div>
      {result?.drawing.errorMessage === "Device changes saved; result DXF needs regeneration" && <div role="alert" className={errorMessage}>
        <p>Зміни приладів збережено, але DXF ще не оновлено. Відновіть експорт без повторного додавання приладів.</p>
        <button className={button} disabled={editor.blocked || state.busy} onClick={editor.regenerate}>Відновити DXF</button>
      </div>}
      {confirmReprocess && <div role="group" aria-label="Повторна обробка" className="space-y-3 rounded-lg border p-3">
        <p>Повторна обробка перезапише приміщення цього креслення. Продовжити?</p>
        <button className={button} disabled={state.busy || editor.blocked || state.detail.isFetching} onClick={() => {
          if (state.busy || editor.blocked || state.detail.isFetching) return;
          setConfirmReprocess(false); state.start();
        }}>Підтвердити повторну обробку</button>{" "}
        <button className={button} onClick={() => setConfirmReprocess(false)}>Скасувати</button>
      </div>}
      {error && <p role="alert" className={errorMessage}>{drawingErrorMessage(error)}</p>}
      {(metadata.status === "failed" || metadata.status === "error" || processingFailed) && <p role="alert" className={errorMessage}>{processingErrorMessage(result?.drawing.errorMessage ?? state.currentJob?.errorMessage)}</p>}
      {state.timedOut && <p role="status">Автоматичне оновлення зупинено через 2 хвилини. Обробка може тривати на сервері. Натисніть «Оновити стан», щоб перевірити результат.</p>}
      {download.isError && <p role="alert" data-print-hide="true" className={errorMessage}>{drawingErrorMessage(download.error)}</p>}
      {download.isSuccess && (
        <p role="status" data-print-hide="true">
          {download.data === "bundle"
            ? "Звіт та DXF результату передано браузеру для збереження."
            : download.data === "html-only"
              ? "HTML-звіт передано браузеру для збереження."
              : "DXF передано браузеру для збереження."}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Розділи креслення"
        data-print-hide="true"
        className="flex border-b border-[var(--bim-color-border-default)] gap-1 pt-2"
      >
        <button
          disabled={editor.blocked}
          role="tab"
          type="button"
          aria-selected={activeTab === "plan"}
          onClick={() => navigateTab("plan")}
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
          disabled={editor.blocked}
          role="tab"
          type="button"
          aria-selected={activeTab === "rooms"}
          onClick={() => navigateTab("rooms")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 cursor-pointer",
            activeTab === "rooms"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          <span>Приміщення</span>
        </button>
        <button
          disabled={editor.blocked}
          role="tab"
          type="button"
          aria-selected={activeTab === "rules"}
          onClick={() => navigateTab("rules")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            activeTab === "rules"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          Правила й норми
        </button>
        {!demo && <button disabled={editor.blocked} role="tab" type="button" aria-selected={activeTab === "findings"}
          onClick={() => navigateTab("findings")} className={cn("px-4 py-2 text-sm border-b-2 -mb-px", activeTab === "findings" ? "border-blue-600 text-blue-600 font-semibold" : "border-transparent text-slate-600")}>Порушення</button>}
        <button
          disabled={editor.blocked}
          role="tab"
          type="button"
          aria-selected={activeTab === "report"}
          onClick={() => navigateTab("report")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            activeTab === "report"
              ? "border-[var(--bim-color-brand-primary)] text-[var(--bim-color-brand-primary)] font-semibold"
              : "border-transparent text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          )}
        >
          Звіт
        </button>
        {result && <span className={workspaceStyles.tabSummary}>{mappedRooms.length} {new Intl.PluralRules("uk").select(mappedRooms.length) === "one" ? "кімната" : new Intl.PluralRules("uk").select(mappedRooms.length) === "few" ? "кімнати" : "кімнат"}</span>}
      </div>

      {(activeTab === "plan" || activeTab === "findings") && (
        <div className="space-y-5">
          <div className={workspaceStyles.sectionTitle}><h2>{activeTab === "findings" ? "Результати перевірки" : "План"}</h2><p>{activeTab === "findings" ? "Виберіть порушення у списку або на плані" : "Натисніть на кімнату, щоб побачити деталі"}</p></div>
          {result && <div className={workspaceStyles.summary}>
            <span><strong>{result.rooms.length}</strong> приміщень</span>
            <span><strong>{result.devices.filter(d => d.type === "smoke_detector" || d.type === "heat_detector").length}</strong> сповіщувачів</span>
            <span><strong>{result.rooms.reduce((area, room) => area + room.area, 0).toLocaleString("uk-UA", { maximumFractionDigits: 1 })}</strong> м² <span>площа кімнат</span></span>
          </div>}
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
                disabled={editor.blocked}
                onClick={() => navigateTab("rooms")}
                className="shrink-0 text-xs font-semibold text-amber-900 underline hover:text-amber-950 cursor-pointer"
              >
                Перейти до приміщень →
              </button>
            </div>
          )}
          {placement?.placementStatus && placement.placementStatus !== "complete" && (
            <div
              role="alert"
              data-slot="placement-incomplete-banner"
              className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 shadow-xs"
            >
              <p className="font-semibold">
                {placement.placementStatus === "insufficient_data"
                  ? "Прилади не розміщено: бракує даних."
                  : "Розміщення неповне: частину приміщень пропущено."}
              </p>
              {!!placement.placementIssues?.length && (
                <ul className="list-disc space-y-1 pl-5">
                  {placement.placementIssues.map((issue, index) => (
                    <li key={`${issue.title}-${index}`}>
                      <span className="font-medium">{issue.title}:</span> {issue.reason}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={editor.blocked}
                onClick={() => navigateTab("rooms")}
                className="cursor-pointer text-xs font-semibold text-amber-900 underline hover:text-amber-950"
              >
                Перейти до приміщень →
              </button>
            </div>
          )}
          {stepWarnings.length > 0 && (
            <div
              role="alert"
              data-slot="operation-warnings-banner"
              className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 shadow-xs"
            >
              <ul className="list-disc space-y-1 pl-5">
                {stepWarnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <section aria-label="План креслення" className="min-w-0 space-y-3">
            {rules.isFetching && <p role="status">Завантаження статусів правил…</p>}
            {rules.isError && <p role="alert">Не вдалося отримати статуси правил. Позначення «?» не означає, що правило перевірене. <button className={button} onClick={() => void rules.refetch()}>Повторити завантаження правил</button></p>}
            <div className={cn(workspaceStyles.planLayout, activeTab === "findings" ? findingsStyles.layout : mode === "rooms" && !demo && workspaceStyles.featureLayout)}>
            <StableViewer candidate={url} attempt={viewerAttempt} fileName={metadata.originalFileName} rooms={result?.rooms} devices={result?.devices}
              onReady={setController} findings={currentFindings} selectedFindingId={effectiveFindingId} onSelectFinding={finding => {
                if (editor.blocked) return;
                setMarkerActivation({ id: finding.id, severity: finding.severity });
                selectFinding(finding);
              }}
              layers={layers} mode={mode} onModeChange={setMode}
              workPanel={result && !demo && activeTab === "plan" ? <PlanWorkPanel mode={mode} editor={editor} rooms={result.rooms} devices={result.devices} selectedRoomId={selectedRoomId}
                selectRoom={setSelectedRoomId} devicesEditable={metadata.status === "processed"} disabled={state.busy || updateRoomMutation.isPending || state.detail.isFetching}
                onPlace={api.placeDrawing ? state.startPlacement : undefined} placementDisabled={!result.rooms.length || hasPlacementBlocking} onExit={() => setMode("rooms")} /> : undefined}
              zones={features.data?.zones} exits={features.data?.exits}
              rules={rules.isError ? undefined : rules.data}
              selectedRoomId={selectedRoomId} editor={demo ? undefined : editor} onSelectRoom={setSelectedRoomId} onSelectDevice={editor.selectDevice}
              onRetry={demo ? undefined : refreshFile} retryPending={state.detail.isFetching} />
            <aside className={workspaceStyles.inspector}>
              {activeTab === "findings" ? <FindingsPanel findings={currentFindings} rooms={result?.rooms ?? []} devices={result?.devices ?? []}
                selectedId={effectiveFindingId} markerActivation={markerActivation} onSelect={selectFinding} loading={findingsSuspended || findingsApplicable && (findings.isPending || findings.isFetching)}
                error={findings.error} checked={metadata.status === "processed" && !!result?.rooms.length} retry={() => void findings.refetch()}
                blocked={editor.blocked} rules={rules.isError || rules.isFetching ? undefined : rules.data} rulesLoading={rules.isFetching} rulesError={rules.isError} retryRules={() => void rules.refetch()} /> : <>
              {result && !demo ? <PlanEditorPanel rules={rules.isError ? undefined : rules.data} mode={mode} onTable={() => navigateTab("rooms")} editor={editor} rooms={result.rooms} devices={result.devices} selectedRoomId={selectedRoomId}
                selectRoom={setSelectedRoomId} devicesEditable={metadata.status === "processed"} disabled={state.busy || updateRoomMutation.isPending || state.detail.isFetching} />
                : <section className={workspaceStyles.detailsCard}><h3>Деталі приміщення</h3><div>
                  {selectedRoomId ? <><strong>{result?.rooms.find(room => room.id === selectedRoomId)?.name}</strong><p>{result?.rooms.find(room => room.id === selectedRoomId)?.area} м²</p></>
                    : <><span className={workspaceStyles.emptyIcon} aria-hidden="true">⌂</span><strong>Виберіть приміщення</strong><p>Натисніть на кімнату на плані або її назву у списку нижче.</p><button className={button} onClick={() => navigateTab("rooms")}>Вибрати приміщення →</button></>}
                </div></section>}
              <PlanLayersPanel rooms={result?.rooms ?? []} devices={result?.devices ?? []} value={layers} onChange={setLayers} />
              {result && !demo && mode === "rooms" && <PlanFeaturesPanel editor={editor} room={result.rooms.find(room => room.id === selectedRoomId)}
                zones={features.data?.zones ?? []} exits={features.data?.exits ?? []} loading={features.isPending || features.isFetching}
                error={features.isError} disabled={state.busy || updateRoomMutation.isPending || state.detail.isFetching}
                retry={() => void features.refetch()} />}
              </>}
              {activeTab === "findings" && <PlanLayersPanel rooms={result?.rooms ?? []} devices={result?.devices ?? []} value={layers} onChange={setLayers} />}
            </aside>
            </div>
          </section>
          {result ? <details aria-label="Результат обробки" className={workspaceStyles.processingDetails}>
            <summary>Результат обробки</summary>
            <p>Приміщень: {result.rooms.length} · Сповіщувачів: {result.devices.length}</p>
            {result.rooms.length ? <ul className="divide-y divide-[var(--bim-color-border-default)]">
              {result.rooms.map((room, index) => <li key={room.id} className="flex flex-wrap justify-between gap-2 py-3">
                <span className="min-w-0 break-words">{room.name ?? `Приміщення ${index + 1}`}</span>
                <span>{room.area.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} м²</span>
              </li>)}
            </ul> : <p>Приміщень не знайдено.</p>}
            {!result.devices.length && <p>Сповіщувачів не знайдено.</p>}
          </details> : <EmptyState title={metadata.status === "processed" ? "Результат ще недоступний" : "Результату обробки ще немає"}
            description={metadata.status === "processed" ? "Сервер повернув лише відомості про креслення. Приміщення, сповіщувачі та DXF результату поки недоступні." : "Після обробки тут з’являться приміщення, їхні площі та кількість сповіщувачів."} />}
        </div>
      )}

      {activeTab === "rooms" && (
        <div className="space-y-5">
          {editingRoom ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setIsEditingRoomDirty(false);
                  setEditingRoom(null);
                }}
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
                onDirtyChange={setIsEditingRoomDirty}
                onSave={async (updatedRoom) => {
                  if (!updatedRoom.id) return;
                  await updateRoomMutation.mutateAsync({
                    roomId: updatedRoom.id,
                    patch: {
                      type: updatedRoom.roomType,
                      height: updatedRoom.height,
                    },
                  });
                  setIsEditingRoomDirty(false);
                  setEditingRoom(null);
                }}
                onCancel={() => {
                  setIsEditingRoomDirty(false);
                  setEditingRoom(null);
                }}
              />
            </div>
          ) : (
            <RoomsTable
              zoneEditor={editor}
              onEditZone={zone => {
                const room = result?.rooms.find(item => item.id === zone.roomId);
                if (room) editor.beginZone(room, zone);
              }}
              zones={features.data?.zones}
              rooms={mappedRooms}
              selectedRoomId={selectedRoomId}
              onSelectRoom={(room) => setSelectedRoomId(room.id ?? null)}
              onNavigateToPlan={(room) => {
                if (editor.blocked) return;
                setSelectedRoomId(room.id ?? null);
                navigateTab("plan");
              }}
              onEditRoom={(room) => { if (!editor.blocked) setEditingRoom(room); }}
              onConfirmRoom={async (room) => {
                if (!room.id || editor.blocked) return;
                await updateRoomMutation.mutateAsync({
                  roomId: room.id,
                  patch: { confirmed: true },
                });
              }}
              onConfirmAllRooms={async () => {
                const unconfirmed = mappedRooms.filter(
                  (r): r is typeof r & { id: string } =>
                    Boolean((!r.isConfirmed || r.status === "unconfirmed") && r.id)
                );
                await Promise.all(
                  unconfirmed.map((r) =>
                    updateRoomMutation.mutateAsync({
                      roomId: r.id,
                      patch: { confirmed: true },
                    })
                  )
                );
              }}
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

      {activeTab === "report" && (() => {
        const auditState = resolveFindingsAuditState({
          drawingStatus: metadata.status,
          isDemo: isDemoDrawing(metadata, demo),
          suspended: findingsSuspended,
          isPending: findings.isPending,
          isFetching: findings.isFetching,
          isError: findings.isError,
          isSuccess: findings.isSuccess,
          errorMessage: findings.isError ? drawingErrorMessage(findings.error) : null,
        });
        return (
          <DrawingReportTab
            id={id}
            demo={demo}
            data={data}
            result={result}
            findings={currentFindings}
            auditStatus={auditState.auditStatus}
            auditError={auditState.auditError}
            findingsLoading={!demo && (findingsSuspended || findingsApplicable && (findings.isPending || findings.isFetching))}
            findingsError={findings.error}
            onRetryFindings={() => void findings.refetch()}
            rules={rules.isError ? [] : rules.data ?? []}
            placementWarnings={stepWarnings}
          />
        );
      })()}
      <footer className={workspaceStyles.footer} data-print-hide="true">Інтелектуальна BIM · Пожежна безпека</footer>
    </div>
  );
}

function DrawingReportTab({
  id,
  demo,
  data,
  result,
  findings,
  auditStatus,
  auditError,
  findingsLoading,
  findingsError,
  onRetryFindings,
  rules,
  placementWarnings,
}: {
  id: string;
  demo: boolean;
  data: DrawingResponse;
  result: DrawingResultView | null;
  findings: Finding[];
  auditStatus: ReportAuditStatus;
  auditError: string | null;
  findingsLoading: boolean;
  findingsError: unknown;
  onRetryFindings: () => void;
  rules: Rule[];
  placementWarnings: string[];
}) {
  const roomTypes = useRoomTypes();
  const [htmlSaved, setHtmlSaved] = useState(false);
  const metadata = drawingMetadata(data);

  const reportData = useMemo(
    () =>
      buildEngineeringReportData({
        drawing: metadata,
        rooms: result?.rooms ?? [],
        devices: result?.devices ?? [],
        findings,
        rules,
        roomTypes: roomTypes.data,
        placementWarnings,
        auditStatus,
        auditError,
      }),
    [metadata, result, findings, rules, roomTypes.data, placementWarnings, auditStatus, auditError],
  );

  if (!result) {
    return (
      <EmptyState
        title="Звіт ще недоступний"
        description="Спочатку виконайте обробку креслення та розміщення приладів, щоб сформувати інженерний звіт."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className={reportStyles.actionsBar} data-print-hide="true">
        <div className={reportStyles.actionsGroup}>
          <button
            type="button"
            className={primaryButton}
            onClick={() => window.print()}
          >
            Друк / Зберегти як PDF
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              downloadHtmlReport(reportData);
              setHtmlSaved(true);
            }}
          >
            Завантажити HTML-звіт
          </button>
          {!demo && (
            <Link className={button} href={`/drawings/${id}/report`}>
              Окрема сторінка звіту
            </Link>
          )}
        </div>
        {htmlSaved && (
          <p role="status" className="text-sm text-[var(--bim-color-text-secondary)]">
            HTML-звіт передано браузеру для збереження.
          </p>
        )}
      </div>

      <EngineeringReport
        data={reportData}
        findingsLoading={findingsLoading}
        findingsError={findingsError}
        onRetryFindings={onRetryFindings}
        headingLevel="h2"
      />
    </div>
  );
}
