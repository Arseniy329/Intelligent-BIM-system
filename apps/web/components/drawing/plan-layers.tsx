"use client";

import type { Device, Room } from "@bim/contracts";
import { DeviceSymbol } from "./device-symbol";
import styles from "./drawing-workspace.module.css";

export type PlanLayers = { rooms: boolean; labels: boolean; hiddenDeviceTypes: string[]; findings?: boolean };
export const INITIAL_PLAN_LAYERS: PlanLayers = { rooms: true, labels: true, hiddenDeviceTypes: [] };
const types: [Device["type"], string][] = [
  ["smoke_detector", "Сповіщувачі"], ["heat_detector", "Тепловий"],
  ["manual_call_point", "Ручний"], ["sounder", "Оповіщувач"],
];

export function PlanLayersPanel({ rooms, devices, value, onChange }: {
  rooms: Room[]; devices: Device[]; value: PlanLayers; onChange: (value: PlanLayers) => void;
}) {
  const unknown = devices.some(device => !types.some(([type]) => type === device.type));
  const rows = unknown ? [...types, ["unknown", "Інші прилади"] as const] : types;
  const visible = Number(value.rooms) + Number(value.findings !== false) + rows.filter(([type]) => !value.hiddenDeviceTypes.includes(type)).length;
  return <section className={styles.layers} aria-label="Шари креслення">
    <h3>Шари креслення <span>{visible} / {rows.length + 2}</span></h3>
    <div>
      <label><span aria-hidden="true">!</span><span>Порушення</span><input type="checkbox" checked={value.findings !== false} onChange={event => onChange({ ...value, findings: event.target.checked })} /></label>
      <label><span className={styles.roomLayerSymbol} aria-hidden="true" /><span>Приміщення <small>{rooms.length}</small></span>
        <input type="checkbox" checked={value.rooms} onChange={event => onChange({ ...value, rooms: event.target.checked })} /></label>
      {rows.map(([type, label]) => <label key={type}><DeviceSymbol type={type as Device["type"]} />
        <span>{label} <small>{devices.filter(device => type === "unknown" ? !types.some(([known]) => known === device.type) : device.type === type).length}</small></span>
        <input type="checkbox" checked={!value.hiddenDeviceTypes.includes(type)} onChange={event => onChange({ ...value,
          hiddenDeviceTypes: event.target.checked ? value.hiddenDeviceTypes.filter(item => item !== type) : [...value.hiddenDeviceTypes, type],
        })} /></label>)}
    </div>
    <details><summary>Підписи на плані</summary><label><span>Назви та площі</span><input type="checkbox" checked={value.labels} onChange={event => onChange({ ...value, labels: event.target.checked })} /></label></details>
  </section>;
}
