"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Point } from "@bim/contracts";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import { observeOverlayViewport } from "@/lib/drawing/overlay-geometry";
import type { PlanEditor } from "@/lib/drawing/use-plan-editor";
import { DeviceSymbol } from "./device-symbol";
import styles from "./drawing-viewer.module.css";

export function PlanEditOverlay({ controller, editor }: { controller: DrawingViewportController; editor: PlanEditor }) {
  const root = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; pointer: number; start: Point } | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => observeOverlayViewport(controller, () => redraw(n => n + 1)), [controller]);
  const draft = editor.draft;
  if (!draft) return null;
  const world = (event: PointerEvent<SVGElement>) => {
    const box = root.current!.getBoundingClientRect();
    return controller.screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const beginDrag = (event: PointerEvent<SVGElement>, index: number, start: Point) => {
    if (editor.busy || editor.uncertain) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { index, pointer: event.pointerId, start };
    root.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointer) return;
    const point = world(event);
    if (draft.kind === "room") editor.moveVertex(drag.current.index, point);
    else editor.setPosition(point);
  };
  const points = draft.kind === "room" ? draft.points.map(p => controller.worldToScreen(p)) : [];
  const position = draft.kind === "device" && draft.position ? controller.worldToScreen(draft.position) : null;
  return <svg ref={root} className={styles.editOverlay} aria-label="Редактор плану"
    onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) editor.addPoint(world(event)); }}
    onPointerMove={move}
    onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { move(event); drag.current = null; root.current?.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => {
      if (drag.current) { if (draft.kind === "room") editor.moveVertex(drag.current.index, drag.current.start); else editor.setPosition(drag.current.start); }
      drag.current = null;
    }}>
    {points.length > 1 && <polygon className={styles.editPolygon} points={points.map(p => `${p.x},${p.y}`).join(" ")} />}
    {points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={8} className={styles.editVertex}
      role="button" tabIndex={editor.busy ? -1 : 0} aria-label={`Вершина ${index + 1}`}
      onPointerDown={event => beginDrag(event, index, draft.kind === "room" ? draft.points[index] : p)}
      onKeyDown={event => {
        const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
        if (delta) { event.preventDefault(); editor.moveVertex(index, controller.screenToWorld({ x: p.x + delta[0] * (event.shiftKey ? 10 : 1), y: p.y + delta[1] * (event.shiftKey ? 10 : 1) })); }
      }} />)}
    {position && draft.kind === "device" && <g transform={`translate(${position.x},${position.y})`} role="button" tabIndex={editor.busy ? -1 : 0}
      aria-label="Перемістити прилад" onPointerDown={event => beginDrag(event, 0, draft.position!)}
      onKeyDown={event => {
        const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
        if (delta) { event.preventDefault(); editor.setPosition(controller.screenToWorld({ x: position.x + delta[0] * (event.shiftKey ? 10 : 1), y: position.y + delta[1] * (event.shiftKey ? 10 : 1) })); }
      }}>
      <circle r={22} fill="white" stroke="var(--viewer-focus)" strokeWidth={2} />
      <svg x={-12} y={-12} width={24} height={24}><DeviceSymbol type={draft.type} /></svg>
    </g>}
  </svg>;
}
