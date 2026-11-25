import Image from "next/image";
import type { Device } from "@bim/contracts";
import { DeviceSymbol } from "./device-symbol";
import type { Rule } from "@/lib/api/rules";
import { deviceRuleState } from "@/lib/drawing/device-rule-status";
import styles from "./drawing-viewer.module.css";

const labels: Record<Device["type"], string> = { smoke_detector: "Димовий", heat_detector: "Тепловий", manual_call_point: "Ручний", sounder: "Оповіщувач" };
export function DeviceLegend({ devices = [], rules = [] }: { devices?: Device[]; rules?: Rule[] }) {
  const states = devices.map(device => deviceRuleState(device, rules));
  return <aside aria-label="Легенда приладів" className={styles.deviceLegend}>
    <ul>{Object.entries(labels).map(([type, label]) => <li key={type}>
      <span className={styles.legendSymbol}><DeviceSymbol type={type} /></span><span>{label} · {devices.filter(device => device.type === type).length}</span>
    </li>)}</ul>
    <ul aria-label="Стани приміщень">{[["room-default", "Без перевірки"], ["room-confirmed", "Підтверджено"], ["room-review", "Потребує перевірки"]].map(([asset, label]) => <li key={asset}>
      <Image src={`/design/bim-107/${asset}.svg`} width={20} height={20} alt="" unoptimized />{label}
    </li>)}</ul>
    {states.some(state => state !== "verified") && <p className={styles.ruleLegend}>
      {states.includes("needs_review") && <span><span className={styles.reviewKey}>!</span> Треба перевірити правило. </span>}
      {states.includes("unknown") && <span>? Статус правила невідомий. </span>}
      Позначка правила не означає підтверджене порушення.
    </p>}
  </aside>;
}
