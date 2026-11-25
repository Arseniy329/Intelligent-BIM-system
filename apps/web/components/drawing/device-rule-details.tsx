import Link from "next/link";
import type { Device } from "@bim/contracts";
import type { Rule } from "@/lib/api/rules";
import { deviceRuleState, RULE_STATE_LABELS } from "@/lib/drawing/device-rule-status";
import styles from "./drawing-workspace.module.css";

export function DeviceRuleDetails({ device, rules = [], blocked = false }: { device: Device; rules?: Rule[]; blocked?: boolean }) {
  const rule = rules.find(item => item.id === device.ruleId);
  const state = deviceRuleState(device, rules);
  return <div className={styles.ruleDetails} aria-label="Дані правила приладу">
    <h4>{device.ruleId ? `Правило ${device.ruleId}` : "Правило не визначено"}</h4>
    <p className={styles.ruleStatus} data-state={state}>{state === "verified" ? "✓" : "?"} {RULE_STATE_LABELS[state]}</p>
    <dl>
      <div><dt>Умова</dt><dd>{rule?.rule || "Не надано"}</dd></div>
      <div><dt>Значення</dt><dd>{rule?.value || "Не надано"}</dd></div>
      <div><dt>Документ</dt><dd>{rule?.document || "Не підтверджено"}</dd></div>
      <div><dt>Пункт</dt><dd>{rule?.clause || "Не підтверджено"}</dd></div>
      <div><dt>Посилання</dt><dd>{rule?.link || "Не надано"}</dd></div>
      <div><dt>Дата перевірки</dt><dd>{rule?.checked_at || "Не вказана"}</dd></div>
    </dl>
    {state !== "verified" && <div className={styles.ruleReason}><h5>Причина</h5><p>{state === "needs_review" ? "Джерело правила ще не перевірене інженером." : "Дані про перевірку правила недоступні."}</p><p>Позначка правила не є підтвердженим порушенням.</p></div>}
    <Link href="/rules" aria-disabled={blocked || undefined} onClick={event => { if (blocked) event.preventDefault(); }}>Перейти до правил</Link>
  </div>;
}
