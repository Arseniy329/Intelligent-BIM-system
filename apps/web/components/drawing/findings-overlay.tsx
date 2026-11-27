"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Device, Finding, Room } from "@bim/contracts";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import { isFinitePoint, observeOverlayViewport, projectRoom } from "@/lib/drawing/overlay-geometry";
import { FINDING_LABELS, findingTarget } from "@/lib/drawing/findings";
import styles from "./findings-panel.module.css";

export function FindingsOverlay({ controller, findings, rooms, devices, selectedId, onSelect, blocked }: {
  controller: DrawingViewportController; findings: Finding[]; rooms: Room[]; devices: Device[];
  selectedId?: string | null; onSelect?: (finding: Finding) => void; blocked?: boolean;
}) {
  const [, redraw] = useState(0);
  useEffect(() => observeOverlayViewport(controller, () => redraw(value => value + 1)), [controller]);
  const targets = findings.flatMap((finding, index) => {
    const target = findingTarget(finding, rooms, devices);
    if (!target) return [];
    const screen = controller.worldToScreen(target.point);
    return isFinitePoint(screen) ? [{ finding, target, screen, index }] : [];
  });
  const groups = new Map<string, typeof targets>();
  for (const item of targets) {
    const key = `${item.target.point.x}:${item.target.point.y}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return <div className={styles.overlay} aria-label="Порушення на плані">
    <svg className={styles.geometry} aria-hidden="true">
      {targets.map(({ finding, target, screen }) => {
        const color = finding.severity === "critical" ? "#dc2626" : "#f59e0b";
        const selected = finding.id === selectedId;
        const points = target.room ? projectRoom(target.room, controller) : null;
        return points ? <polygon key={finding.id} points={points.map(p => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={selected ? .12 : .04} stroke={selected ? "#2563eb" : color} strokeWidth={selected ? 3 : 1} /> :
          <circle key={finding.id} cx={screen.x} cy={screen.y} r={selected ? 24 : 18} fill={color} fillOpacity=".12" stroke={selected ? "#2563eb" : color} strokeWidth={selected ? 3 : 1} />;
      })}
    </svg>
    {[...groups].map(([key, items]) => <div className={styles.group} key={key} style={{ left: items[0].screen.x, top: items[0].screen.y }}>
      {items.map(({ finding, index }) => <button key={finding.id} className={styles.marker} data-severity={finding.severity}
        disabled={blocked} aria-pressed={finding.id === selectedId} aria-label={`${FINDING_LABELS[finding.severity]} на плані: ${finding.message}`} title={finding.message} onClick={() => onSelect?.(finding)}>
        {finding.severity === "critical" ? <Image src="/design/bim-107/violation.svg" alt="" width={20} height={20} unoptimized /> : <span aria-hidden="true">{finding.severity === "insufficient_data" ? "?" : "!"}</span>}
        <span>{index + 1}</span>
      </button>)}
    </div>)}
  </div>;
}
