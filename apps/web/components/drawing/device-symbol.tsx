import type { Device } from "@bim/contracts";
import Image from "next/image";

export const DEVICE_LABELS: Record<Device["type"], string> = {
  smoke_detector: "Димовий сповіщувач",
  heat_detector: "Тепловий сповіщувач",
  manual_call_point: "Ручний сповіщувач",
  sounder: "Оповіщувач",
};

export const DEVICE_ASSETS: Record<Device["type"], string> = {
  smoke_detector: "/design/bim-107/smoke.svg",
  heat_detector: "/design/bim-107/heat.svg",
  manual_call_point: "/design/bim-107/manual.svg",
  sounder: "/design/bim-107/sounder.svg",
};

export function deviceLabel(type: string) {
  return Object.hasOwn(DEVICE_LABELS, type) ? DEVICE_LABELS[type as Device["type"]] : "Невідомий тип приладу";
}

/** Original exported assets, using the variants in Desktop 6/10-19. */
export function DeviceSymbol({ type }: { type: string }) {
  if (!Object.hasOwn(DEVICE_ASSETS, type)) return <span data-device-symbol="unknown" aria-hidden="true">?</span>;
  return <Image src={DEVICE_ASSETS[type as Device["type"]]} width={20} height={20}
    data-device-symbol={type} alt="" aria-hidden="true" unoptimized draggable={false} />;
}
