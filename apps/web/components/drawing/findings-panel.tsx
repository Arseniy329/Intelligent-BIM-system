"use client";

import { useEffect, useRef, useState } from "react";
import type { Device, Finding, Room } from "@bim/contracts";
import type { Rule } from "@/lib/api/rules";
import { Button } from "@/components/ui/button";
import { RuleStatusBadge } from "@/components/rooms/badges/rule-status-badge";
import { drawingErrorMessage } from "@/lib/drawing/drawing-api";
import { deviceRuleState } from "@/lib/drawing/device-rule-status";
import { conflictUnit, displayValue, FINDING_LABELS, findingTarget, object } from "@/lib/drawing/findings";
import styles from "./findings-panel.module.css";

const resultForms: Record<string, string> = { one: "результат", few: "результати", many: "результатів", other: "результатів" };
const plural = new Intl.PluralRules("uk");

function RuleState({ status }: { status: string | null | undefined }) {
  if (status === "verified" || status === "needs_review") return <RuleStatusBadge status={status} />;
  return <span className={styles.badge}>? Статус правила невідомий</span>;
}

export function FindingRuleDetails({ finding, rules, loading, error, retry }: {
  finding: Finding; rules: Rule[]; loading?: boolean; error?: boolean; retry?: () => void;
}) {
  const rule = rules.find(item => item.id === finding.ruleId);
  const catalogState = deviceRuleState(finding, rules);
  // A review flag from either source cannot be upgraded to verified by the other.
  const status = finding.ruleStatus === "needs_review" || catalogState === "needs_review" ? "needs_review" :
    rule ? catalogState : finding.ruleStatus;
  return <section aria-label="Картка правила" className={styles.rule}>
    <h4>{rule?.rule || "Дані нормативного правила"}</h4>
    <RuleState status={status} />
    {loading && <p role="status">Завантаження правила…</p>}
    {error && <p role="alert">Не вдалося завантажити правило. <button className={styles.link} onClick={retry}>Повторити завантаження правила</button></p>}
    {!loading && !error && !rule && <p className={styles.muted}>{finding.ruleId ? "Правило відсутнє в каталозі." : "Посилання на правило не надано."}</p>}
    <dl>
      <div><dt>Документ</dt><dd>{finding.document || rule?.document || "Не підтверджено"}</dd></div>
      <div><dt>Пункт</dt><dd>{finding.clause || "Не підтверджено"}</dd></div>
      <div><dt>Умова</dt><dd>{rule?.rule || "Не надано"}</dd></div>
      <div><dt>Значення</dt><dd>{rule?.value || "Не надано"}</dd></div>
      <div><dt>Одиниця</dt><dd>Одиницю не вказано</dd></div>
      {rule?.room_type && <div><dt>Тип приміщення</dt><dd>{rule.room_type}</dd></div>}
      {rule?.room_height_min != null && <div><dt>Висота від</dt><dd>{rule.room_height_min} м</dd></div>}
      {rule?.room_height_max != null && <div><dt>Висота до</dt><dd>{rule.room_height_max} м</dd></div>}
    </dl>
    {rule?.link && /^https?:\/\//i.test(rule.link) && <a className={styles.link} href={rule.link} target="_blank" rel="noreferrer">Відкрити джерело</a>}
  </section>;
}

export function FindingConflict({ finding }: { finding: Finding }) {
  const details = object(finding.conflictDetails);
  const sources = Array.isArray(details?.rules) ? details.rules.map(object).filter((item): item is Record<string, unknown> => item !== null) : [];
  const unit = conflictUnit(details?.valueKind);
  const incomplete = sources.length < 2 || sources.some(source => !displayValue(source.document) || !displayValue(source.clause) || displayValue(source.value) === null) || !unit;
  return <section aria-label="Конфлікт нормативних вимог" className={styles.rule}>
    <span className={styles.badge}>Потрібне рішення інженера</span>
    {sources.map((source, index) => <div className={styles.source} key={`${displayValue(source.id)}-${index}`}>
      <strong>{displayValue(source.document) || "Документ не надано"}</strong>
      <p className={styles.muted}>Пункт: {displayValue(source.clause) || "Не підтверджено"}</p>
      <strong>Значення: {displayValue(source.value) ?? "Не надано"}{unit && displayValue(source.value) !== null ? ` ${unit}` : ""}</strong>
      {displayValue(source.maxProtectedAreaM2) !== null && <p>Площа: {displayValue(source.maxProtectedAreaM2)} м²</p>}
      <RuleState status={displayValue(source.verificationStatus)} />
    </div>)}
    {incomplete && <p role="status">Недостатньо даних для повного порівняння вимог.</p>}
    <p className={styles.muted}>Перевірте обидва джерела й визначте застосовну вимогу. Рішення інженера ще потрібне.</p>
  </section>;
}

export type FindingsPanelProps = {
  findings: Finding[]; rooms: Room[]; devices: Device[]; selectedId: string | null;
  onSelect: (finding: Finding) => void; loading?: boolean; error?: unknown;
  checked: boolean; retry: () => void; blocked?: boolean;
  rules?: Rule[]; rulesLoading?: boolean; rulesError?: boolean; retryRules?: () => void;
};

export function FindingsPanel({ findings, rooms, devices, selectedId, onSelect, loading, error, checked, retry, blocked,
  rules = [], rulesLoading, rulesError, retryRules }: FindingsPanelProps) {
  const [filterState, setFilter] = useState<{ value: Finding["severity"] | "all"; selection: string | null }>({ value: "all", selection: selectedId });
  const [ruleId, setRuleId] = useState<string | null>(null);
  const selectedRow = useRef<HTMLLIElement | null>(null);
  const selected = findings.find(item => item.id === selectedId);
  // Always expose a marker-selected row, even if the previous filter hid it.
  const effectiveFilter = selected && filterState.selection !== selectedId ? "all" : filterState.value;
  useEffect(() => { selectedRow.current?.scrollIntoView?.({ block: "nearest" }); }, [selectedId, loading]);
  return <section className={styles.panel} aria-label="Порушення" aria-busy={loading}>
    <h3>Порушення</h3>
    {loading ? <p role="status">Завантаження результатів перевірки…</p> : error ? <div role="alert"><p>{drawingErrorMessage(error)}</p><Button variant="outline" onClick={retry}>Повторити перевірку</Button></div> : <>
      {!checked && <p role="status">Перевірку ще не завершено.</p>}
      {checked && findings.length === 0 && <p role="status">Порушень не знайдено</p>}
      {findings.length > 0 && <>
        <p className={styles.muted}>{findings.length} {resultForms[plural.select(findings.length)]} · критичність із перевірки</p>
        <div className={styles.filters} aria-label="Фільтр порушень">
          <button aria-pressed={effectiveFilter === "all"} onClick={() => setFilter({ value: "all", selection: selectedId })}>Усі результати</button>
          {(Object.keys(FINDING_LABELS) as Finding["severity"][]).filter(severity => findings.some(f => f.severity === severity)).map(severity =>
            <button key={severity} aria-pressed={effectiveFilter === severity} onClick={() => setFilter({ value: severity, selection: selectedId })}>{FINDING_LABELS[severity]} · {findings.filter(f => f.severity === severity).length}</button>)}
        </div>
        <ul className={styles.list} aria-label="Список порушень">
          {findings.filter(f => effectiveFilter === "all" || f.severity === effectiveFilter).map(finding => {
            const target = findingTarget(finding, rooms, devices);
            const room = rooms.find(item => item.id === finding.roomId);
            return <li key={finding.id} ref={finding.id === selectedId ? selectedRow : undefined} className={styles.card} data-severity={finding.severity} data-selected={finding.id === selectedId}>
              <button className={styles.select} aria-pressed={finding.id === selectedId} disabled={blocked} onClick={() => onSelect(finding)}>
                <span className={styles.muted}>{room?.name || "Без прив’язки до приміщення"}</span>
                <strong>{FINDING_LABELS[finding.severity]}</strong>
                <span className={styles.badge} data-severity={finding.severity}>{finding.severity === "insufficient_data" ? "? " : ""}{FINDING_LABELS[finding.severity]}</span>
                <span>{finding.message}</span>
              </button>
              {finding.severity === "rule_conflict" && <FindingConflict finding={finding} />}
              <button className={styles.link} onClick={() => setRuleId(ruleId === finding.id ? null : finding.id)} aria-expanded={ruleId === finding.id}>
                {finding.document || "Нормативне правило"}{finding.clause ? ` · ${finding.clause}` : " · пункт не підтверджено"}
              </button>
              {finding.ruleStatus && <RuleState status={finding.ruleStatus} />}
              {ruleId === finding.id && <FindingRuleDetails finding={finding} rules={rules} loading={rulesLoading} error={rulesError} retry={retryRules} />}
              {target ? <Button variant="outline" disabled={blocked} onClick={() => onSelect(finding)}>Показати на плані</Button> : <p className={styles.muted}>Місце на плані не визначено.</p>}
            </li>;
          })}
        </ul>
      </>}
    </>}
  </section>;
}
