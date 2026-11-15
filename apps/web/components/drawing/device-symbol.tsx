import type { Device } from "@bim/contracts";
import tokens from "../../../../tokens.json";

export const DEVICE_LABELS: Record<Device["type"], string> = {
  smoke_detector: "Димовий сповіщувач",
  heat_detector: "Тепловий сповіщувач",
  manual_call_point: "Ручний сповіщувач",
  sounder: "Оповіщувач",
};

const colors: Record<Device["type"], string> = {
  smoke_detector: tokens.color.plan.deviceSmoke,
  heat_detector: tokens.color.plan.deviceHeat,
  manual_call_point: tokens.color.plan.deviceManualCallPoint,
  sounder: tokens.color.plan.deviceSounder,
};

/** Temporary design.md symbols; replace this component when BIM-107 ships. */
export function DeviceSymbol({ type }: { type: Device["type"] }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor"
      style={{ color: colors[type] }} stroke={tokens.color.plan.markerOutline} strokeWidth={tokens.borderWidth.deviceDefault}>
      {type === "smoke_detector" && <circle cx="8" cy="8" r="7" />}
      {type === "heat_detector" && <path d="M8 1 15 15H1Z" />}
      {type === "manual_call_point" && <rect x="1" y="1" width="14" height="14" />}
      {type === "sounder" && <path d="m8 1 7 7-7 7-7-7Z" />}
    </svg>
  );
}
