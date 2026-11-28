"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EngineeringReport } from "@/components/drawing/engineering-report";
import reportStyles from "@/components/drawing/engineering-report.module.css";
import {
  drawingApi,
  drawingErrorMessage,
  drawingMetadata,
  fetchDrawingDownload,
  isDrawingResult,
  placementReport,
  type DrawingApi,
} from "@/lib/drawing/drawing-api";
import { useDrawingDetail } from "@/lib/drawing/use-drawing-detail";
import { useFindings } from "@/lib/drawing/use-findings";
import { fetchRules } from "@/lib/api/rules";
import { useRoomTypes } from "@/lib/rooms/room-types-api";
import { ApiHttpError } from "@/lib/api";
import {
  buildEngineeringReportData,
  downloadHtmlReport,
  resolveFindingsAuditState,
  triggerBlobDownload,
} from "@/lib/drawing/report";

const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";
const errorPanel =
  "rounded-xl border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-4 text-sm text-[var(--bim-color-semantic-error)]";

export function DrawingReportRoute({
  id,
  api = drawingApi,
}: {
  id: string;
  api?: DrawingApi;
}) {
  const router = useRouter();
  const state = useDrawingDetail(id, api, false);
  const loadedResult =
    state.detail.data && isDrawingResult(state.detail.data)
      ? state.detail.data
      : null;
  const findingsApplicable = loadedResult?.drawing.status === "processed";
  const findings = useFindings(
    id,
    state.detail.dataUpdatedAt,
    findingsApplicable && !state.detail.isFetching && !state.detail.isError,
  );
  const rules = useQuery({
    queryKey: ["drawing-rules", id, state.detail.dataUpdatedAt],
    queryFn: ({ signal }) => fetchRules(signal),
    enabled: !!loadedResult,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const roomTypes = useRoomTypes();

  const [bundlePending, setBundlePending] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => downloadAbortRef.current?.abort(), []);

  useEffect(() => {
    const err = state.detail.error;
    if (
      (err instanceof ApiHttpError && err.statusCode === 401) ||
      (err instanceof Error && err.name === "ApiAuthenticationError")
    ) {
      router.replace("/login");
    }
  }, [router, state.detail.error]);

  const reportData = useMemo(() => {
    if (!state.detail.data) return null;
    const metadata = drawingMetadata(state.detail.data);
    const placement = placementReport(state.detail.data);
    const auditState = resolveFindingsAuditState({
      drawingStatus: metadata.status,
      suspended: state.detail.isFetching || state.detail.isError,
      isPending: findings.isPending,
      isFetching: findings.isFetching,
      isError: findings.isError,
      isSuccess: findings.isSuccess,
      errorMessage: findings.isError ? drawingErrorMessage(findings.error) : null,
    });
    return buildEngineeringReportData({
      drawing: metadata,
      rooms: loadedResult?.rooms ?? [],
      devices: loadedResult?.devices ?? [],
      findings: findings.data ?? [],
      rules: rules.data ?? [],
      roomTypes: roomTypes.data,
      placementWarnings: placement?.warnings ?? [],
      auditStatus: auditState.auditStatus,
      auditError: auditState.auditError,
    });
  }, [
    state.detail.data,
    state.detail.isFetching,
    state.detail.isError,
    loadedResult,
    findings.data,
    findings.isPending,
    findings.isFetching,
    findings.isError,
    findings.isSuccess,
    findings.error,
    rules.data,
    roomTypes.data,
  ]);

  if (state.detail.isPending || (!state.detail.data && !state.detail.isError)) {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <p>Завантаження звіту…</p>
      </div>
    );
  }

  if (state.detail.isError || !state.detail.data || !reportData) {
    return (
      <section role="alert" className={errorPanel}>
        <h1 className="text-xl font-semibold">Не вдалося завантажити звіт</h1>
        <p className="mt-1">{drawingErrorMessage(state.detail.error)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButton}
            onClick={() => void state.refresh()}
          >
            Спробувати знову
          </button>
          <Link href={`/drawings/${id}`} className={secondaryButton}>
            Повернутися до креслення
          </Link>
        </div>
      </section>
    );
  }

  const metadata = drawingMetadata(state.detail.data);
  const resultDownloadAvailable =
    metadata.status === "processed" && !!loadedResult?.downloadUrl;

  const handleDownloadHtml = () => {
    setDownloadError(null);
    downloadHtmlReport(reportData);
    setDownloadStatus("HTML-звіт передано браузеру для збереження.");
  };

  const handleDownloadWithDxf = async () => {
    if (bundlePending || metadata.status !== "processed" || !loadedResult) {
      return;
    }
    setBundlePending(true);
    setDownloadError(null);
    setDownloadStatus(null);
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = new AbortController();
    const { signal } = downloadAbortRef.current;

    try {
      if (resultDownloadAvailable) {
        const dxfFile = await fetchDrawingDownload(api, id, "result", signal);
        if (signal.aborted) return;
        triggerBlobDownload(dxfFile.blob, dxfFile.fileName);
        downloadHtmlReport(reportData);
        setDownloadStatus(
          "Звіт та DXF результату передано браузеру для збереження.",
        );
      } else {
        downloadHtmlReport(reportData);
        setDownloadStatus("HTML-звіт передано браузеру для збереження.");
      }
    } catch (error) {
      if (!signal.aborted) {
        setDownloadError(error);
      }
    } finally {
      setBundlePending(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className={reportStyles.actionsBar} data-print-hide="true">
        <nav aria-label="Навігація звіту">
          <Link
            href={`/drawings/${id}`}
            className="inline-flex items-center gap-1 text-sm text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)]"
          >
            ← Повернутися до креслення
          </Link>
        </nav>
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
            className={secondaryButton}
            onClick={handleDownloadHtml}
          >
            Завантажити HTML-звіт
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={
              bundlePending ||
              metadata.status !== "processed" ||
              !loadedResult
            }
            onClick={() => void handleDownloadWithDxf()}
          >
            {bundlePending ? "Підготовка файлів…" : "Завантажити звіт"}
          </button>
        </div>
      </div>

      {downloadError != null && (
        <p role="alert" className={errorPanel} data-print-hide="true">
          {drawingErrorMessage(downloadError)}
        </p>
      )}
      {downloadStatus && (
        <p
          role="status"
          className="text-sm text-[var(--bim-color-text-secondary)]"
          data-print-hide="true"
        >
          {downloadStatus}
        </p>
      )}

      <EngineeringReport
        data={reportData}
        findingsLoading={
          findingsApplicable && (findings.isPending || findings.isFetching)
        }
        findingsError={findings.error}
        onRetryFindings={() => void findings.refetch()}
        headingLevel="h1"
      />
    </div>
  );
}
