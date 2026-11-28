import type {
  Device,
  Drawing,
  DrawingDetailStatus,
  DrawingStatus,
  Finding,
  Room,
  RoomType,
} from "@bim/contracts";
import type { Rule } from "@/lib/api/rules";
import type { DrawingDetail } from "@/lib/drawing/drawing-api";
import { conflictUnit, displayValue, object } from "@/lib/drawing/findings";
import { DEMO_DRAWING_IDS } from "@/lib/drawing/demo-api";
import { DEFAULT_ROOM_TYPES, getRoomTypeName } from "@/lib/rooms/room-types-api";

export const DEVICE_TYPE_ORDER: readonly Device["type"][] = [
  "smoke_detector",
  "heat_detector",
  "sounder",
  "manual_call_point",
];

export const DEVICE_TYPE_REPORT_LABELS: Record<Device["type"], string> = {
  smoke_detector: "Димові сповіщувачі",
  heat_detector: "Теплові сповіщувачі",
  sounder: "Оповіщувачі",
  manual_call_point: "Ручні сповіщувачі",
};

const DRAWING_STATUS_LABELS: Record<DrawingStatus | DrawingDetailStatus, string> = {
  pending: "Очікує завантаження",
  uploaded: "Готове до обробки",
  processing: "Обробляється",
  processed: "Оброблено",
  failed: "Помилка обробки",
  error: "Помилка обробки",
};

export const REPORT_SEVERITY_LABELS: Record<string, string> = {
  critical: "Критичний",
  warning: "Попередження",
  insufficient_data: "Інформаційний",
  info: "Інформаційний",
  informational: "Інформаційний",
  rule_conflict: "Конфлікт норм",
};

export type ReportFindingStatus = "verified" | "needs_verification" | "unknown";

export type ReportAuditStatus = "pending" | "unavailable" | "demo" | "completed";

export interface ReportDeviceCounts {
  smoke_detector: number;
  heat_detector: number;
  sounder: number;
  manual_call_point: number;
  total: number;
}

export interface ReportRoomRow {
  id: string;
  name: string;
  typeCode: string | null;
  typeLabel: string;
  areaM2: number;
  heightM: number | null;
  deviceCounts: ReportDeviceCounts;
}

export interface ReportConflictSource {
  id: string;
  document: string | null;
  clause: string | null;
  value: string | null;
  unit: string | null;
  maxProtectedAreaM2: string | null;
  verificationStatus: ReportFindingStatus;
}

export interface ReportFindingItem {
  id: string;
  roomName: string;
  description: string;
  severity: string;
  severityLabel: string;
  document: string | null;
  clause: string | null;
  verificationStatus: ReportFindingStatus;
  isNeedsVerification: boolean;
  isConflict: boolean;
  conflictSources: ReportConflictSource[];
  conflictIncomplete: boolean;
}

export interface EngineeringReportData {
  drawingId: string;
  drawingName: string;
  originalFileName: string;
  status: string;
  statusLabel: string;
  unitsLabel: string;
  generatedAtIso: string;
  generatedAtLabel: string;
  auditStatus: ReportAuditStatus;
  auditError: string | null;
  totalAreaM2: number;
  rooms: ReportRoomRow[];
  unassignedDevices: ReportDeviceCounts;
  totalDevices: ReportDeviceCounts;
  findings: ReportFindingItem[];
  summary: {
    roomCount: number;
    deviceCount: number;
    findingCount: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    conflictCount: number;
    needsVerificationCount: number;
  };
  placementWarnings: string[];
}

export type ReportDrawingInput =
  | Drawing
  | DrawingDetail
  | {
      id: string;
      originalFileName: string;
      status: string;
      resolvedUnits?: string | null;
      units?: string | null;
      createdAt?: string;
    };

export interface BuildReportInput {
  drawing: ReportDrawingInput;
  rooms: readonly Room[];
  devices: readonly Device[];
  findings: readonly Finding[];
  rules?: readonly Rule[];
  roomTypes?: readonly RoomType[];
  placementWarnings?: readonly string[];
  generatedAt?: Date;
  auditStatus?: ReportAuditStatus;
  auditError?: string | null;
}

export function isDemoDrawing(
  drawing: ReportDrawingInput | null | undefined,
  explicitDemo = false,
): boolean {
  if (explicitDemo) return true;
  if (!drawing) return false;
  if ("ownerId" in drawing && drawing.ownerId === "local-demo") {
    return true;
  }
  if (
    "storagePath" in drawing &&
    typeof drawing.storagePath === "string" &&
    drawing.storagePath.startsWith("demo/")
  ) {
    return true;
  }
  if (
    drawing.id === "bim60-simple-rooms-demo" ||
    (DEMO_DRAWING_IDS as readonly string[]).includes(drawing.id)
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves the report audit state from a drawing status and findings query flags
 * so pending, demo, or errored audits can never masquerade as a clean result.
 */
export function resolveFindingsAuditState(params: {
  drawingStatus: string;
  isDemo?: boolean;
  demo?: boolean;
  suspended?: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  errorMessage?: string | null;
}): { auditStatus: ReportAuditStatus; auditError: string | null } {
  if (params.isDemo || params.demo) {
    return {
      auditStatus: "demo",
      auditError: null,
    };
  }
  if (params.drawingStatus !== "processed") {
    return { auditStatus: "pending", auditError: null };
  }
  if (params.isError) {
    return {
      auditStatus: "unavailable",
      auditError: params.errorMessage?.trim() || null,
    };
  }
  if (
    params.suspended ||
    params.isPending ||
    params.isFetching ||
    !params.isSuccess
  ) {
    return { auditStatus: "pending", auditError: null };
  }
  return { auditStatus: "completed", auditError: null };
}

function emptyDeviceCounts(): ReportDeviceCounts {
  return {
    smoke_detector: 0,
    heat_detector: 0,
    sounder: 0,
    manual_call_point: 0,
    total: 0,
  };
}

function countDevices(devices: readonly Device[]): ReportDeviceCounts {
  const counts = emptyDeviceCounts();
  for (const device of devices) {
    if (device.type in counts) {
      counts[device.type] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

function sumDeviceCounts(
  groups: readonly ReportDeviceCounts[],
): ReportDeviceCounts {
  const total = emptyDeviceCounts();
  for (const group of groups) {
    for (const type of DEVICE_TYPE_ORDER) {
      total[type] += group[type];
    }
    total.total += group.total;
  }
  return total;
}

/**
 * Normalizes rule verification statuses across Finding (`needs_review`) and
 * Rule catalog (`needs_verification`) contracts.
 */
export function normalizeVerificationStatus(raw: unknown): ReportFindingStatus {
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim().toLowerCase();
  if (value === "verified") return "verified";
  if (
    value === "needs_verification" ||
    value === "needs_review" ||
    value === "review_needed"
  ) {
    return "needs_verification";
  }
  return "unknown";
}

function cleanClause(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed === "—" ||
    trimmed === "-" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "не підтверджено"
  ) {
    return null;
  }
  return trimmed;
}

function cleanDocument(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "не підтверджено") {
    return null;
  }
  return trimmed;
}

function resolveFindingRoomName(
  finding: Finding,
  roomNamesById: ReadonlyMap<string, string>,
  devicesById: ReadonlyMap<string, Device>,
): string {
  if (finding.roomId && roomNamesById.has(finding.roomId)) {
    return roomNamesById.get(finding.roomId)!;
  }
  if (finding.deviceId) {
    const device = devicesById.get(finding.deviceId);
    if (device?.roomId && roomNamesById.has(device.roomId)) {
      return roomNamesById.get(device.roomId)!;
    }
  }
  const details = object(finding.details);
  const fallbackRoom =
    displayValue(details?.roomName) ?? displayValue(details?.room_name);
  if (fallbackRoom) {
    return fallbackRoom;
  }
  return "Без прив’язки до приміщення";
}

function findMatchingRule(
  ruleId: string | null | undefined,
  rules: readonly Rule[],
): Rule | undefined {
  if (!ruleId) return undefined;
  return rules.find(
    (item) =>
      item.id === ruleId ||
      (item as unknown as { ruleId?: string }).ruleId === ruleId,
  );
}

function parseConflictSources(
  finding: Finding,
): { sources: ReportConflictSource[]; incomplete: boolean } {
  const record = finding as unknown as Record<string, unknown>;
  const details =
    object(finding.conflictDetails) ?? object(record.conflict_details);
  const rawList = Array.isArray(details?.rules)
    ? details.rules
    : Array.isArray(details?.sources)
      ? details.sources
      : Array.isArray(details?.conflictingRules)
        ? details.conflictingRules
        : [];
  const unit = conflictUnit(details?.valueKind ?? details?.value_kind);

  const sources: ReportConflictSource[] = [];
  rawList.forEach((raw, index) => {
    const item = object(raw);
    if (!item) return;
    const verificationStatus = normalizeVerificationStatus(
      item.verificationStatus ?? item.verification_status ?? item.status,
    );
    const document = cleanDocument(displayValue(item.document));
    // Never render a guessed/unverified clause when verification status is needs_verification.
    const clause =
      verificationStatus === "needs_verification"
        ? null
        : cleanClause(displayValue(item.clause));
    const value = displayValue(item.value);
    const maxProtectedAreaM2 = displayValue(
      item.maxProtectedAreaM2 ?? item.max_protected_area_m2,
    );
    sources.push({
      id:
        displayValue(item.id) ??
        displayValue(item.ruleId) ??
        `conflict-source-${index + 1}`,
      document,
      clause,
      value,
      unit,
      maxProtectedAreaM2,
      verificationStatus,
    });
  });

  const incomplete =
    sources.length < 2 ||
    sources.some(
      (source) =>
        !source.document ||
        (!source.clause && source.verificationStatus !== "needs_verification"),
    );

  return { sources, incomplete };
}

/**
 * Builds the normalized engineering report dataset shared by the live UI preview
 * and the self-contained downloadable HTML file.
 */
export function buildEngineeringReportData({
  drawing,
  rooms,
  devices,
  findings,
  rules = [],
  roomTypes = DEFAULT_ROOM_TYPES,
  placementWarnings = [],
  generatedAt = new Date(),
  auditStatus,
  auditError = null,
}: BuildReportInput): EngineeringReportData {
  const effectiveAuditStatus: ReportAuditStatus =
    auditStatus ??
    (isDemoDrawing(drawing)
      ? "demo"
      : String(drawing.status) === "processed"
        ? "completed"
        : "pending");
  const effectiveAuditError =
    effectiveAuditStatus === "unavailable" ? auditError?.trim() || null : null;
  const effectiveFindings =
    effectiveAuditStatus === "completed" ? findings : [];
  const roomNamesById = new Map<string, string>();
  const devicesByRoomId = new Map<string, Device[]>();
  const knownRoomIds = new Set<string>();

  rooms.forEach((room, index) => {
    knownRoomIds.add(room.id);
    const label = room.name?.trim() || `Приміщення ${index + 1}`;
    roomNamesById.set(room.id, label);
    devicesByRoomId.set(room.id, []);
  });

  const unassignedDeviceList: Device[] = [];
  const devicesById = new Map<string, Device>();
  for (const device of devices) {
    devicesById.set(device.id, device);
    if (device.roomId && knownRoomIds.has(device.roomId)) {
      devicesByRoomId.get(device.roomId)!.push(device);
    } else {
      unassignedDeviceList.push(device);
    }
  }

  const catalogRoomTypes = [...roomTypes];
  const roomRows: ReportRoomRow[] = rooms.map((room, index) => {
    const typeLabel =
      getRoomTypeName(room.type, catalogRoomTypes) ?? "Тип не визначено";
    return {
      id: room.id,
      name: roomNamesById.get(room.id) ?? `Приміщення ${index + 1}`,
      typeCode: room.type ?? null,
      typeLabel,
      areaM2: Number.isFinite(room.area) ? room.area : 0,
      heightM:
        room.height != null && Number.isFinite(room.height) && room.height > 0
          ? room.height
          : null,
      deviceCounts: countDevices(devicesByRoomId.get(room.id) ?? []),
    };
  });

  const unassignedDevices = countDevices(unassignedDeviceList);
  const totalDevices = sumDeviceCounts([
    ...roomRows.map((row) => row.deviceCounts),
    unassignedDevices,
  ]);
  const totalAreaM2 = roomRows.reduce((sum, row) => sum + row.areaM2, 0);

  const reportFindings: ReportFindingItem[] = effectiveFindings.map((finding) => {
    const rawRecord = finding as unknown as Record<string, unknown>;
    const catalogRule = findMatchingRule(finding.ruleId, rules);
    const findingStatus = normalizeVerificationStatus(
      finding.ruleStatus ?? rawRecord.verificationStatus,
    );
    const catalogStatus = catalogRule
      ? normalizeVerificationStatus(catalogRule.status)
      : "unknown";

    // A needs_verification flag from either finding or catalog rule cannot be upgraded.
    const verificationStatus: ReportFindingStatus =
      findingStatus === "needs_verification" ||
      catalogStatus === "needs_verification"
        ? "needs_verification"
        : findingStatus === "verified" || catalogStatus === "verified"
          ? "verified"
          : "unknown";
    const isNeedsVerification = verificationStatus === "needs_verification";

    const { sources: conflictSources, incomplete: conflictIncomplete } =
      parseConflictSources(finding);
    const isConflict =
      finding.severity === "rule_conflict" || conflictSources.length >= 2;

    const document =
      cleanDocument(finding.document) ??
      cleanDocument(catalogRule?.document) ??
      null;

    // Zero hallucinated clauses: never display a guessed/unverified clause when needs_verification.
    const clause = isNeedsVerification
      ? null
      : cleanClause(finding.clause) ??
        (verificationStatus === "verified"
          ? cleanClause(catalogRule?.clause)
          : null);

    const severityKey = String(finding.severity || "warning").toLowerCase();
    const severityLabel =
      REPORT_SEVERITY_LABELS[severityKey] ??
      REPORT_SEVERITY_LABELS.warning;

    return {
      id: finding.id,
      roomName: resolveFindingRoomName(finding, roomNamesById, devicesById),
      description:
        finding.message?.trim() || "Опис порушення не надано",
      severity: severityKey,
      severityLabel,
      document,
      clause,
      verificationStatus,
      isNeedsVerification,
      isConflict,
      conflictSources,
      conflictIncomplete,
    };
  });

  const rawUnits =
    "resolvedUnits" in drawing
      ? drawing.resolvedUnits
      : "units" in drawing
        ? drawing.units
        : null;
  const unitsLabel =
    rawUnits === "mm"
      ? "міліметри (мм)"
      : rawUnits === "m"
        ? "метри (м)"
        : "не визначено";

  const statusKey = String(drawing.status || "processed") as
    | DrawingStatus
    | DrawingDetailStatus;
  const statusLabel = DRAWING_STATUS_LABELS[statusKey] ?? String(drawing.status);

  const originalFileName = drawing.originalFileName || `${drawing.id}.dxf`;
  const drawingName = originalFileName.replace(/\.dxf$/i, "") || drawing.id;

  return {
    drawingId: drawing.id,
    drawingName,
    originalFileName,
    status: String(drawing.status),
    statusLabel,
    unitsLabel,
    generatedAtIso: generatedAt.toISOString(),
    generatedAtLabel: new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(generatedAt),
    auditStatus: effectiveAuditStatus,
    auditError: effectiveAuditError,
    totalAreaM2,
    rooms: roomRows,
    unassignedDevices,
    totalDevices,
    findings: reportFindings,
    summary: {
      roomCount: roomRows.length,
      deviceCount: totalDevices.total,
      findingCount: reportFindings.length,
      criticalCount: reportFindings.filter((f) => f.severity === "critical")
        .length,
      warningCount: reportFindings.filter((f) => f.severity === "warning")
        .length,
      infoCount: reportFindings.filter(
        (f) =>
          f.severity === "insufficient_data" ||
          f.severity === "info" ||
          f.severity === "informational",
      ).length,
      conflictCount: reportFindings.filter((f) => f.isConflict).length,
      needsVerificationCount: reportFindings.filter(
        (f) => f.isNeedsVerification,
      ).length,
    },
    placementWarnings: [...placementWarnings],
  };
}

export function formatMetricNumber(value: number, maxFractionDigits = 2): string {
  return value.toLocaleString("uk-UA", {
    maximumFractionDigits: maxFractionDigits,
  });
}

export function buildReportFileName(originalFileName: string): string {
  const safeBase = originalFileName
    .replace(/[\\/]/g, "_")
    .replace(/\.dxf$/i, "");
  return `${safeBase || "drawing"}-report.html`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function severityBadgeClass(severity: string): string {
  if (severity === "critical") return "badge-critical";
  if (severity === "rule_conflict") return "badge-conflict";
  if (severity === "warning") return "badge-warning";
  return "badge-info";
}

/**
 * Generates a completely self-contained UTF-8 HTML document with inline CSS
 * and print rules suitable for offline viewing and browser Print-to-PDF.
 */
export function generateReportHtml(data: EngineeringReportData): string {
  const roomRowsHtml = data.rooms
    .map(
      (room) => `<tr>
          <td>${escapeHtml(room.name)}</td>
          <td>${escapeHtml(room.typeLabel)}</td>
          <td class="num">${escapeHtml(formatMetricNumber(room.areaM2))} м²</td>
          <td class="num">${
            room.heightM != null
              ? `${escapeHtml(formatMetricNumber(room.heightM))} м`
              : '<span class="muted">Не вказано</span>'
          }</td>
          <td class="num">${room.deviceCounts.smoke_detector}</td>
          <td class="num">${room.deviceCounts.heat_detector}</td>
          <td class="num">${room.deviceCounts.sounder}</td>
          <td class="num">${room.deviceCounts.manual_call_point}</td>
          <td class="num"><strong>${room.deviceCounts.total}</strong></td>
        </tr>`,
    )
    .join("\n        ");

  const unassignedRowHtml =
    data.unassignedDevices.total > 0
      ? `<tr class="unassigned-row">
          <td>Поза приміщеннями (коридори / загальні зони)</td>
          <td><span class="muted">—</span></td>
          <td class="num"><span class="muted">—</span></td>
          <td class="num"><span class="muted">—</span></td>
          <td class="num">${data.unassignedDevices.smoke_detector}</td>
          <td class="num">${data.unassignedDevices.heat_detector}</td>
          <td class="num">${data.unassignedDevices.sounder}</td>
          <td class="num">${data.unassignedDevices.manual_call_point}</td>
          <td class="num"><strong>${data.unassignedDevices.total}</strong></td>
        </tr>`
      : "";

  const auditBannerHtml =
    data.auditStatus === "unavailable"
      ? `<div class="audit-banner audit-banner-unavailable" role="alert">
      <strong>Неповний звіт: результати аудиту недоступні</strong>
      <p>Аудит нормативних вимог недоступний — перевірку не виконано. Відсутність записів нижче не підтверджує відповідність нормам.</p>
      ${data.auditError ? `<p class="audit-banner-detail">${escapeHtml(data.auditError)}</p>` : ""}
    </div>`
      : data.auditStatus === "demo"
        ? `<div class="audit-banner audit-banner-demo" role="status">
      <strong>Демонстраційний звіт: аудит не проводився</strong>
      <p>Локальний демонстраційний режим містить ілюстративні дані; перевірку відповідності нормативним вимогам не виконано.</p>
    </div>`
        : data.auditStatus === "pending"
          ? `<div class="audit-banner audit-banner-pending" role="status">
      <strong>Очікується завершення аудиту</strong>
      <p>Перевірку відповідності нормативним вимогам ще не завершено. Дані про порушення можуть бути неповними.</p>
    </div>`
          : "";

  const findingsSummaryValueHtml =
    data.auditStatus === "unavailable"
      ? "Недоступно"
      : data.auditStatus === "demo"
        ? "Деморежим"
        : data.auditStatus === "pending"
          ? "Очікується"
          : String(data.summary.findingCount);

  const findingsSummarySubHtml =
    data.auditStatus === "unavailable"
      ? "Аудит не виконано — звіт неповний"
      : data.auditStatus === "demo"
        ? "Аудит не проводився"
        : data.auditStatus === "pending"
          ? "Очікується завершення аудиту"
          : `Критичних: ${data.summary.criticalCount} · Попереджень: ${data.summary.warningCount} · Конфліктів: ${data.summary.conflictCount}`;

  const findingsHtml =
    data.auditStatus === "unavailable"
      ? `<div class="audit-banner audit-banner-unavailable" role="alert">
          <strong>Аудит нормативних вимог недоступний — перевірку не виконано.</strong>
          ${data.auditError ? `<p class="audit-banner-detail">${escapeHtml(data.auditError)}</p>` : ""}
        </div>`
      : data.auditStatus === "demo"
        ? `<div class="audit-banner audit-banner-demo" role="status">
          <strong>Демонстраційний звіт: аудит не проводився.</strong>
          <p>Для отримання реального аудиту завантажте власне креслення та виконайте перевірку.</p>
        </div>`
        : data.auditStatus === "pending"
          ? `<div class="audit-banner audit-banner-pending" role="status">
          <strong>Очікується завершення аудиту.</strong>
          <p>Результати перевірки з’являться після завершення обробки.</p>
        </div>`
          : data.findings.length === 0
            ? `<p class="empty-box">Порушень відповідності нормативним вимогам не виявлено.</p>`
            : data.findings
          .map((item) => {
            const clauseText = item.isNeedsVerification
              ? "Пункт не підтверджено"
              : item.clause ?? "Пункт не підтверджено";
            const conflictHtml = item.isConflict
              ? `<div class="conflict-box" aria-label="Конфлікт нормативних вимог">
                  <div class="conflict-header">
                    <span class="badge badge-conflict-decision">Потрібне рішення інженера</span>
                  </div>
                  <div class="conflict-sources">
                    ${item.conflictSources
                      .map((source) => {
                        const sourceClause =
                          source.verificationStatus === "needs_verification"
                            ? "Пункт не підтверджено"
                            : source.clause ?? "Пункт не підтверджено";
                        const valueLine =
                          source.value !== null
                            ? `<p class="conflict-value">Значення: <strong>${escapeHtml(source.value)}${source.unit ? ` ${escapeHtml(source.unit)}` : ""}</strong></p>`
                            : "";
                        const areaLine =
                          source.maxProtectedAreaM2 !== null
                            ? `<p class="muted">Макс. площа захисту: ${escapeHtml(source.maxProtectedAreaM2)} м²</p>`
                            : "";
                        const statusBadge =
                          source.verificationStatus === "needs_verification"
                            ? `<span class="badge badge-review">? Треба перевірити</span>`
                            : source.verificationStatus === "verified"
                              ? `<span class="badge badge-verified">✓ Перевірено</span>`
                              : "";
                        return `<div class="conflict-source">
                          <div class="conflict-source-top">
                            <strong>${escapeHtml(source.document ?? "Документ не вказано")}</strong>
                            ${statusBadge}
                          </div>
                          <p>Пункт норми: <strong>${escapeHtml(sourceClause)}</strong></p>
                          ${valueLine}
                          ${areaLine}
                        </div>`;
                      })
                      .join("\n                    ")}
                  </div>
                  ${
                    item.conflictIncomplete
                      ? '<p class="muted">Недостатньо даних для повного порівняння вимог.</p>'
                      : ""
                  }
                </div>`
              : "";

            return `<article class="finding-card" data-severity="${escapeHtml(item.severity)}">
          <div class="finding-head">
            <span class="finding-room">${escapeHtml(item.roomName)}</span>
            <div class="finding-badges">
              <span class="badge ${severityBadgeClass(item.severity)}">${escapeHtml(item.severityLabel)}</span>
              ${
                item.isNeedsVerification
                  ? '<span class="badge badge-review">? Треба перевірити</span>'
                  : ""
              }
              ${
                item.isConflict
                  ? '<span class="badge badge-conflict-decision">Потрібне рішення інженера</span>'
                  : ""
              }
            </div>
          </div>
          <p class="finding-desc">${escapeHtml(item.description)}</p>
          <dl class="finding-meta">
            <div>
              <dt>Документ</dt>
              <dd>${escapeHtml(item.document ?? "Не вказано")}</dd>
            </div>
            <div>
              <dt>Пункт норми</dt>
              <dd>${escapeHtml(clauseText)}</dd>
            </div>
          </dl>
          ${conflictHtml}
        </article>`;
          })
          .join("\n        ");

  const warningsHtml =
    data.placementWarnings.length > 0
      ? `<section class="report-section">
      <h2>Зауваження до розміщення приладів</h2>
      <ul class="warnings-list">
        ${data.placementWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("\n        ")}
      </ul>
    </section>`
      : "";

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Інженерний звіт — ${escapeHtml(data.drawingName)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    .report-shell {
      max-width: 1040px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    .no-print {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }
    .print-btn {
      appearance: none;
      border: 1px solid #1d4ed8;
      background: #2563eb;
      color: #ffffff;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .report-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .eyebrow {
      margin: 0 0 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #475569;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.25;
      color: #0f172a;
    }
    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
      font-size: 12px;
      color: #334155;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .summary-card {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 12px 14px;
      background: #f8fafc;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .summary-card .label {
      display: block;
      font-size: 11px;
      color: #475569;
      margin-bottom: 4px;
    }
    .summary-card .value {
      display: block;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
    }
    .summary-card .sub {
      display: block;
      font-size: 11px;
      color: #475569;
      margin-top: 2px;
    }
    .report-section {
      margin-bottom: 26px;
    }
    .report-section h2 {
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      border-left: 4px solid #2563eb;
      padding-left: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      background: #ffffff;
    }
    thead { display: table-header-group; }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      font-weight: 600;
      color: #0f172a;
    }
    .num { text-align: right; white-space: nowrap; }
    tfoot td {
      background: #f8fafc;
      font-weight: 700;
    }
    .unassigned-row td {
      background: #fafafa;
    }
    .muted { color: #64748b; }
    .findings-list {
      display: grid;
      gap: 12px;
    }
    .finding-card {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 14px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .finding-card[data-severity="critical"] { border-left: 4px solid #dc2626; }
    .finding-card[data-severity="warning"] { border-left: 4px solid #d97706; }
    .finding-card[data-severity="rule_conflict"] { border-left: 4px solid #b45309; }
    .finding-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .finding-room {
      font-weight: 700;
      font-size: 14px;
      color: #0f172a;
    }
    .finding-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid transparent;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .badge-critical { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    .badge-warning { background: #fffbeb; color: #92400e; border-color: #fde68a; }
    .badge-info { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
    .badge-conflict { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
    .badge-review { background: #fffbeb; color: #92400e; border-color: #f59e0b; }
    .badge-verified { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    .badge-conflict-decision { background: #fef3c7; color: #78350f; border-color: #d97706; }
    .finding-desc {
      margin: 0 0 10px;
      color: #0f172a;
    }
    .finding-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 16px;
      margin: 0;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
    }
    .finding-meta dt {
      font-weight: 600;
      color: #475569;
    }
    .finding-meta dd {
      margin: 2px 0 0;
      color: #0f172a;
    }
    .conflict-box {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      background: #fffbeb;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .conflict-header {
      margin-bottom: 8px;
    }
    .conflict-sources {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .conflict-source {
      background: #ffffff;
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
    }
    .conflict-source p { margin: 4px 0 0; }
    .conflict-source-top {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px;
      align-items: center;
    }
    .empty-box {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 14px;
      background: #f8fafc;
      color: #334155;
    }
    .audit-banner {
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 13px;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .audit-banner strong {
      display: block;
      margin-bottom: 4px;
    }
    .audit-banner p {
      margin: 0;
    }
    .audit-banner-detail {
      margin-top: 6px !important;
      font-size: 12px;
    }
    .audit-banner-unavailable {
      border: 1px solid #fca5a5;
      background: #fef2f2;
      color: #991b1b;
    }
    .audit-banner-pending {
      border: 1px solid #fcd34d;
      background: #fffbeb;
      color: #92400e;
    }
    .audit-banner-demo {
      border: 1px solid #93c5fd;
      background: #eff6ff;
      color: #1e3a8a;
    }
    .warnings-list {
      margin: 0;
      padding-left: 20px;
      color: #78350f;
    }
    .report-footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      font-size: 11px;
      color: #475569;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    @media (max-width: 720px) {
      .summary-grid, .finding-meta, .conflict-sources {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media print {
      .no-print { display: none !important; }
      .report-shell { max-width: none; padding: 0; }
      html, body { background: #ffffff !important; color: #0f172a !important; }
    }
  </style>
</head>
<body>
  <main class="report-shell">
    <div class="no-print">
      <button type="button" class="print-btn" onclick="window.print()">Друк / Зберегти як PDF</button>
    </div>
    <header class="report-header">
      <p class="eyebrow">Інженерний звіт · Системи пожежної безпеки</p>
      <h1>${escapeHtml(data.drawingName)}</h1>
      <div class="header-meta">
        <span><strong>Файл:</strong> ${escapeHtml(data.originalFileName)}</span>
        <span><strong>Статус:</strong> ${escapeHtml(data.statusLabel)}</span>
        <span><strong>Одиниці:</strong> ${escapeHtml(data.unitsLabel)}</span>
        <span><strong>Дата формування:</strong> <time datetime="${escapeHtml(data.generatedAtIso)}">${escapeHtml(data.generatedAtLabel)}</time></span>
      </div>
    </header>

    ${auditBannerHtml}

    <section class="summary-grid" aria-label="Зведення проєкту">
      <div class="summary-card">
        <span class="label">Приміщення</span>
        <span class="value">${data.summary.roomCount}</span>
        <span class="sub">Загальна площа: ${escapeHtml(formatMetricNumber(data.totalAreaM2))} м²</span>
      </div>
      <div class="summary-card">
        <span class="label">Розміщені прилади</span>
        <span class="value">${data.summary.deviceCount}</span>
        <span class="sub">Димових: ${data.totalDevices.smoke_detector} · Теплових: ${data.totalDevices.heat_detector} · Оповіщ.: ${data.totalDevices.sounder} · Ручних: ${data.totalDevices.manual_call_point}</span>
      </div>
      <div class="summary-card">
        <span class="label">Виявлені порушення</span>
        <span class="value">${findingsSummaryValueHtml}</span>
        <span class="sub">${findingsSummarySubHtml}</span>
      </div>
      <div class="summary-card">
        <span class="label">Правила до перевірки</span>
        <span class="value">${data.summary.needsVerificationCount}</span>
        <span class="sub">Пункти зі статусом «Треба перевірити»</span>
      </div>
    </section>

    <section class="report-section" aria-label="Приміщення та прилади">
      <h2>Приміщення та кількість приладів</h2>
      ${
        data.rooms.length === 0 && data.unassignedDevices.total === 0
          ? '<p class="empty-box">Приміщень у кресленні не знайдено.</p>'
          : `<table>
        <thead>
          <tr>
            <th>Назва</th>
            <th>Тип</th>
            <th class="num">Площа</th>
            <th class="num">Висота</th>
            <th class="num">Димові сповіщувачі</th>
            <th class="num">Теплові сповіщувачі</th>
            <th class="num">Оповіщувачі</th>
            <th class="num">Ручні сповіщувачі</th>
            <th class="num">Усього</th>
          </tr>
        </thead>
        <tbody>
        ${roomRowsHtml}
        ${unassignedRowHtml}
        </tbody>
        <tfoot>
          <tr>
            <td>Разом</td>
            <td>—</td>
            <td class="num">${escapeHtml(formatMetricNumber(data.totalAreaM2))} м²</td>
            <td class="num">—</td>
            <td class="num">${data.totalDevices.smoke_detector}</td>
            <td class="num">${data.totalDevices.heat_detector}</td>
            <td class="num">${data.totalDevices.sounder}</td>
            <td class="num">${data.totalDevices.manual_call_point}</td>
            <td class="num">${data.totalDevices.total}</td>
          </tr>
        </tfoot>
      </table>`
      }
    </section>

    <section class="report-section" aria-label="Виявлені порушення">
      <h2>Порушення та нормативні посилання</h2>
      <div class="findings-list">
        ${findingsHtml}
      </div>
    </section>

    ${warningsHtml}

    <footer class="report-footer">
      <span>Інтелектуальна BIM · Пожежна безпека</span>
      <span>Ідентифікатор креслення: ${escapeHtml(data.drawingId)}</span>
    </footer>
  </main>
</body>
</html>
`;
}

/**
 * Triggers a browser file download from an arbitrary Blob and cleans up the
 * temporary object URL afterwards.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates and downloads the self-contained UTF-8 HTML report file.
 */
export function downloadHtmlReport(data: EngineeringReportData): void {
  const html = generateReportHtml(data);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  triggerBlobDownload(blob, buildReportFileName(data.originalFileName));
}
