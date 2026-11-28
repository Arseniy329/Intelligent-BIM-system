"use client";

import {
  formatMetricNumber,
  type EngineeringReportData,
} from "@/lib/drawing/report";
import { drawingErrorMessage } from "@/lib/drawing/drawing-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./engineering-report.module.css";

function severityTone(
  severity: string,
): "critical" | "warning" | "info" | "conflict" {
  if (severity === "critical") return "critical";
  if (severity === "rule_conflict") return "conflict";
  if (severity === "warning") return "warning";
  return "info";
}

export interface EngineeringReportProps {
  data: EngineeringReportData;
  findingsLoading?: boolean;
  findingsError?: unknown;
  onRetryFindings?: () => void;
  headingLevel?: "h1" | "h2";
}

export function EngineeringReport({
  data,
  findingsLoading = false,
  findingsError = null,
  onRetryFindings,
  headingLevel = "h1",
}: EngineeringReportProps) {
  const HeadingTag = headingLevel;

  return (
    <article className={styles.reportDocument} aria-label="Інженерний звіт">
      <header className={styles.reportHeader}>
        <p className={styles.eyebrow}>
          Інженерний звіт · Системи пожежної безпеки
        </p>
        <HeadingTag className={styles.reportTitle}>
          {data.drawingName}
        </HeadingTag>
        <div className={styles.headerMeta}>
          <span>
            <strong>Файл:</strong> {data.originalFileName}
          </span>
          <span>
            <strong>Статус:</strong> {data.statusLabel}
          </span>
          <span>
            <strong>Одиниці:</strong> {data.unitsLabel}
          </span>
          <span>
            <strong>Дата формування:</strong>{" "}
            <time dateTime={data.generatedAtIso}>{data.generatedAtLabel}</time>
          </span>
        </div>
      </header>

      {(data.auditStatus === "unavailable" || !!findingsError) && (
        <div
          role="alert"
          className={cn(styles.auditBanner, styles.auditBannerUnavailable)}
        >
          <strong>Неповний звіт: результати аудиту недоступні</strong>
          <p>
            Аудит нормативних вимог недоступний — перевірку не виконано.
            Відсутність записів нижче не підтверджує відповідність нормам.
          </p>
          {(data.auditError || findingsError != null) && (
            <p className={styles.auditBannerDetail}>
              {data.auditError ?? drawingErrorMessage(findingsError)}
            </p>
          )}
          {onRetryFindings && (
            <div data-print-hide="true" className="mt-3">
              <Button variant="outline" size="sm" onClick={onRetryFindings}>
                Повторити перевірку
              </Button>
            </div>
          )}
        </div>
      )}

      {data.auditStatus === "demo" && !findingsError && (
        <div
          role="status"
          className={cn(styles.auditBanner, styles.auditBannerDemo)}
        >
          <strong>Демонстраційний звіт: аудит не проводився</strong>
          <p>
            Локальний демонстраційний режим містить ілюстративні дані; перевірку
            відповідності нормативним вимогам не виконано.
          </p>
        </div>
      )}

      {data.auditStatus === "pending" && !findingsError && (
        <div
          role="status"
          className={cn(styles.auditBanner, styles.auditBannerPending)}
        >
          <strong>Очікується завершення аудиту</strong>
          <p>
            Перевірку відповідності нормативним вимогам ще не завершено. Дані
            про порушення можуть бути неповними.
          </p>
        </div>
      )}

      <section className={styles.summaryGrid} aria-label="Зведення проєкту">
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Приміщення</span>
          <span className={styles.summaryValue}>{data.summary.roomCount}</span>
          <span className={styles.summarySub}>
            Загальна площа: {formatMetricNumber(data.totalAreaM2)} м²
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Розміщені прилади</span>
          <span className={styles.summaryValue}>{data.summary.deviceCount}</span>
          <span className={styles.summarySub}>
            Димових: {data.totalDevices.smoke_detector} · Теплових:{" "}
            {data.totalDevices.heat_detector} · Оповіщ.:{" "}
            {data.totalDevices.sounder} · Ручних:{" "}
            {data.totalDevices.manual_call_point}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Виявлені порушення</span>
          <span className={styles.summaryValue}>
            {data.auditStatus === "unavailable" || !!findingsError
              ? "Недоступно"
              : data.auditStatus === "demo"
                ? "Деморежим"
                : data.auditStatus === "pending" || findingsLoading
                  ? "Очікується"
                  : data.summary.findingCount}
          </span>
          <span className={styles.summarySub}>
            {data.auditStatus === "unavailable" || !!findingsError
              ? "Аудит не виконано — звіт неповний"
              : data.auditStatus === "demo"
                ? "Аудит не проводився"
                : data.auditStatus === "pending" || findingsLoading
                  ? "Очікується завершення аудиту"
                  : `Критичних: ${data.summary.criticalCount} · Попереджень: ${data.summary.warningCount} · Конфліктів: ${data.summary.conflictCount}`}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Правила до перевірки</span>
          <span className={styles.summaryValue}>
            {data.summary.needsVerificationCount}
          </span>
          <span className={styles.summarySub}>
            Пункти зі статусом «Треба перевірити»
          </span>
        </div>
      </section>

      <section className={styles.section} aria-label="Приміщення та прилади">
        <h2 className={styles.sectionHeading}>
          Приміщення та кількість приладів
        </h2>
        {data.rooms.length === 0 && data.unassignedDevices.total === 0 ? (
          <p className={styles.emptyBox}>Приміщень у кресленні не знайдено.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Тип</th>
                  <th className={styles.num}>Площа</th>
                  <th className={styles.num}>Висота</th>
                  <th className={styles.num}>Димові сповіщувачі</th>
                  <th className={styles.num}>Теплові сповіщувачі</th>
                  <th className={styles.num}>Оповіщувачі</th>
                  <th className={styles.num}>Ручні сповіщувачі</th>
                  <th className={styles.num}>Усього</th>
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((room) => (
                  <tr key={room.id}>
                    <td>{room.name}</td>
                    <td>{room.typeLabel}</td>
                    <td className={styles.num}>
                      {formatMetricNumber(room.areaM2)} м²
                    </td>
                    <td className={styles.num}>
                      {room.heightM != null ? (
                        `${formatMetricNumber(room.heightM)} м`
                      ) : (
                        <span className={styles.muted}>Не вказано</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {room.deviceCounts.smoke_detector}
                    </td>
                    <td className={styles.num}>
                      {room.deviceCounts.heat_detector}
                    </td>
                    <td className={styles.num}>{room.deviceCounts.sounder}</td>
                    <td className={styles.num}>
                      {room.deviceCounts.manual_call_point}
                    </td>
                    <td className={styles.num}>
                      <strong>{room.deviceCounts.total}</strong>
                    </td>
                  </tr>
                ))}
                {data.unassignedDevices.total > 0 && (
                  <tr className={styles.unassignedRow}>
                    <td>Поза приміщеннями (коридори / загальні зони)</td>
                    <td>
                      <span className={styles.muted}>—</span>
                    </td>
                    <td className={styles.num}>
                      <span className={styles.muted}>—</span>
                    </td>
                    <td className={styles.num}>
                      <span className={styles.muted}>—</span>
                    </td>
                    <td className={styles.num}>
                      {data.unassignedDevices.smoke_detector}
                    </td>
                    <td className={styles.num}>
                      {data.unassignedDevices.heat_detector}
                    </td>
                    <td className={styles.num}>
                      {data.unassignedDevices.sounder}
                    </td>
                    <td className={styles.num}>
                      {data.unassignedDevices.manual_call_point}
                    </td>
                    <td className={styles.num}>
                      <strong>{data.unassignedDevices.total}</strong>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Разом</td>
                  <td>—</td>
                  <td className={styles.num}>
                    {formatMetricNumber(data.totalAreaM2)} м²
                  </td>
                  <td className={styles.num}>—</td>
                  <td className={styles.num}>
                    {data.totalDevices.smoke_detector}
                  </td>
                  <td className={styles.num}>
                    {data.totalDevices.heat_detector}
                  </td>
                  <td className={styles.num}>{data.totalDevices.sounder}</td>
                  <td className={styles.num}>
                    {data.totalDevices.manual_call_point}
                  </td>
                  <td className={styles.num}>{data.totalDevices.total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-label="Виявлені порушення">
        <h2 className={styles.sectionHeading}>
          Порушення та нормативні посилання
        </h2>
        {data.auditStatus === "unavailable" || !!findingsError ? (
          <div
            role="alert"
            className={cn(styles.auditBanner, styles.auditBannerUnavailable)}
          >
            <strong>
              Аудит нормативних вимог недоступний — перевірку не виконано.
            </strong>
            {(data.auditError || findingsError != null) && (
              <p className={styles.auditBannerDetail}>
                {data.auditError ?? drawingErrorMessage(findingsError)}
              </p>
            )}
            {onRetryFindings && (
              <div data-print-hide="true" className="mt-3">
                <Button variant="outline" size="sm" onClick={onRetryFindings}>
                  Повторити перевірку
                </Button>
              </div>
            )}
          </div>
        ) : data.auditStatus === "demo" ? (
          <div
            role="status"
            className={cn(styles.auditBanner, styles.auditBannerDemo)}
          >
            <strong>Демонстраційний звіт: аудит не проводився.</strong>
            <p>
              Для отримання реального аудиту завантажте власне креслення та
              виконайте перевірку.
            </p>
          </div>
        ) : data.auditStatus === "pending" || findingsLoading ? (
          <div
            role="status"
            className={cn(styles.auditBanner, styles.auditBannerPending)}
          >
            <strong>Очікується завершення аудиту.</strong>
            <p>Результати перевірки з’являться після завершення обробки.</p>
          </div>
        ) : data.findings.length === 0 ? (
          <p className={styles.emptyBox}>
            Порушень відповідності нормативним вимогам не виявлено.
          </p>
        ) : (
          <div className={styles.findingsList}>
            {data.findings.map((item) => {
              const clauseDisplay = item.isNeedsVerification
                ? "Пункт не підтверджено"
                : item.clause ?? "Пункт не підтверджено";

              return (
                <article
                  key={item.id}
                  className={styles.findingCard}
                  data-severity={item.severity}
                >
                  <div className={styles.findingHead}>
                    <span className={styles.findingRoom}>{item.roomName}</span>
                    <div className={styles.badges}>
                      <span
                        className={styles.badge}
                        data-tone={severityTone(item.severity)}
                      >
                        {item.severityLabel}
                      </span>
                      {item.isNeedsVerification && (
                        <span className={styles.badge} data-tone="review">
                          <span aria-hidden="true">?</span>
                          <span>Треба перевірити</span>
                        </span>
                      )}
                      {item.isConflict && (
                        <span className={styles.badge} data-tone="conflict">
                          Потрібне рішення інженера
                        </span>
                      )}
                    </div>
                  </div>
                  <p className={styles.findingDesc}>{item.description}</p>
                  <dl className={styles.findingMeta}>
                    <div>
                      <dt>Документ</dt>
                      <dd>{item.document ?? "Не вказано"}</dd>
                    </div>
                    <div>
                      <dt>Пункт норми</dt>
                      <dd>{clauseDisplay}</dd>
                    </div>
                  </dl>
                  {item.isConflict && (
                    <section
                      aria-label="Конфлікт нормативних вимог"
                      className={styles.conflictBox}
                    >
                      <div className={styles.conflictHeader}>
                        <span className={styles.badge} data-tone="conflict">
                          Потрібне рішення інженера
                        </span>
                      </div>
                      <div className={styles.conflictSources}>
                        {item.conflictSources.map((source, index) => {
                          const sourceClause =
                            source.verificationStatus === "needs_verification"
                              ? "Пункт не підтверджено"
                              : source.clause ?? "Пункт не підтверджено";

                          return (
                            <div
                              key={`${source.id}-${index}`}
                              className={styles.conflictSource}
                            >
                              <div className={styles.conflictSourceTop}>
                                <strong>
                                  {source.document ?? "Документ не вказано"}
                                </strong>
                                {source.verificationStatus ===
                                  "needs_verification" && (
                                  <span
                                    className={styles.badge}
                                    data-tone="review"
                                  >
                                    <span aria-hidden="true">?</span>
                                    <span>Треба перевірити</span>
                                  </span>
                                )}
                                {source.verificationStatus === "verified" && (
                                  <span
                                    className={styles.badge}
                                    data-tone="verified"
                                  >
                                    <span aria-hidden="true">✓</span>
                                    <span>Перевірено</span>
                                  </span>
                                )}
                              </div>
                              <p>
                                Пункт норми: <strong>{sourceClause}</strong>
                              </p>
                              {source.value !== null && (
                                <p>
                                  Значення:{" "}
                                  <strong>
                                    {source.value}
                                    {source.unit ? ` ${source.unit}` : ""}
                                  </strong>
                                </p>
                              )}
                              {source.maxProtectedAreaM2 !== null && (
                                <p className={styles.muted}>
                                  Макс. площа захисту:{" "}
                                  {source.maxProtectedAreaM2} м²
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {item.conflictIncomplete && (
                        <p className={styles.muted}>
                          Недостатньо даних для повного порівняння вимог.
                        </p>
                      )}
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {data.placementWarnings.length > 0 && (
        <section
          className={styles.section}
          aria-label="Зауваження до розміщення приладів"
        >
          <h2 className={styles.sectionHeading}>
            Зауваження до розміщення приладів
          </h2>
          <ul className={styles.warningsList}>
            {data.placementWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.reportFooter}>
        <span>Інтелектуальна BIM · Пожежна безпека</span>
        <span>Ідентифікатор креслення: {data.drawingId}</span>
      </footer>
    </article>
  );
}
