"use client";

import type { Device, Room } from "@bim/contracts";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import { observeOverlayViewport, projectDevice, projectRoom, roomLabelPlacement } from "@/lib/drawing/overlay-geometry";
import tokens from "../../../../tokens.json";
import { deviceLabel, DeviceSymbol } from "./device-symbol";
import type { Rule } from "@/lib/api/rules";
import { deviceRuleState, RULE_STATE_LABELS } from "@/lib/drawing/device-rule-status";
import styles from "./drawing-viewer.module.css";

const NO_ROOMS: Room[] = [];
const NO_DEVICES: Device[] = [];
const areaFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const overlayTheme = {
  "--room-fill": tokens.color.plan.roomFill,
  "--room-stroke": tokens.color.plan.roomStroke,
  "--room-opacity": tokens.opacity.plan.roomDefault,
  "--room-stroke-width": tokens.borderWidth.roomDefault,
  "--marker-size": tokens.size.iconMd,
  "--marker-hover-size": tokens.size.iconLg,
  "--marker-target": tokens.size.planMarkerHitTarget,
  "--overlay-font-size": tokens.typography.fontSize.xs,
  "--overlay-line-height": tokens.typography.lineHeight.xs,
  "--tooltip-bg": tokens.color.planPanel.tooltipBg,
  "--tooltip-text": tokens.color.planPanel.tooltipText,
  "--tooltip-border": tokens.color.planPanel.tooltipBorder,
  "--tooltip-radius": tokens.component.planTooltip.radius,
  "--tooltip-padding-x": tokens.component.planTooltip.paddingX,
  "--tooltip-padding-y": tokens.component.planTooltip.paddingY,
} as CSSProperties;

type Props = {
  rules?: Rule[];
  onSelectRoom?: (id: string) => void;
  onSelectDevice?: (id: string) => void;
  controller: DrawingViewportController;
  rooms?: Room[];
  devices?: Device[];
  showRooms: boolean;
  showDevices: boolean;
  showRoomLabels?: boolean;
  selectedRoomId?: string | null;
};

export function DrawingOverlay({
  controller,
  rooms = NO_ROOMS,
  devices = NO_DEVICES,
  showRooms,
  showDevices,
  showRoomLabels = true,
  selectedRoomId, onSelectRoom, onSelectDevice,
  rules = [],
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [viewport, setViewport] = useState({ width: 0, height: 0, revision: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => observeOverlayViewport(controller, () => {
    const root = rootRef.current;
    if (root) setViewport((previous) => ({ width: root.clientWidth, height: root.clientHeight, revision: previous.revision + 1 }));
  }), [controller]);

  // Geometry depends only on data and the camera. Visibility only controls rendering.
  const projectedRooms = useMemo(() => {
    return rooms.flatMap((room) => {
      const points = projectRoom(room, controller);
      return points
        ? [
            {
              room,
              points,
              label:
                viewport.width && viewport.height
                  ? roomLabelPlacement(points, viewport)
                  : undefined,
            },
          ]
        : [];
    });
  }, [controller, rooms, viewport]);

  const projectedDevices = useMemo(() => {
    return devices.flatMap((device) => {
      const point = projectDevice(device, controller);
      // Offscreen markers must not leave invisible keyboard targets when viewport is known.
      const isVisible =
        point &&
        (!viewport.width ||
          !viewport.height ||
          (point.x >= 0 &&
            point.x <= viewport.width &&
            point.y >= 0 &&
            point.y <= viewport.height));
      return isVisible && point ? [{ device, point }] : [];
    });
  }, [controller, devices, viewport]);
  const projected = {
    rooms: showRooms ? projectedRooms : [],
    devices: showDevices ? projectedDevices : [],
  };

  const roomNames = useMemo(() => new Map(rooms.map((room) => [room.id, room.name?.trim() || "Приміщення без назви"])), [rooms]);
  const roomName = (device: Device) => (device.roomId && roomNames.get(device.roomId)) || "Приміщення не визначено";
  const activeId = hovered ?? focused;
  const active = activeId === dismissed ? undefined : projected.devices.find(({ device }) => device.id === activeId);
  const tooltipWidth = Math.min(parseFloat(tokens.component.planTooltip.maxWidth), Math.max(0, viewport.width - 16));
  const tooltipGap = parseFloat(tokens.size.planMarkerHitTarget) / 2 + parseFloat(tokens.component.planTooltip.offset);
  const below = active ? active.point.y < viewport.height / 2 : false;

  return (
    <div ref={rootRef} className={styles.overlay} style={overlayTheme} data-drawing-overlay="">
      <svg className={styles.roomPolygons} aria-label="Контури приміщень">
        {projected.rooms.map(({ room, points }) => {
          const isSelected = Boolean(selectedRoomId && selectedRoomId === room.id);
          return (
            <polygon
              key={room.id}
              data-confirmed={room.confirmed ? "true" : "false"}
              data-source={room.source}
              style={{ pointerEvents: onSelectRoom ? "all" : undefined, cursor: onSelectRoom ? "pointer" : undefined }}
              role={onSelectRoom ? "button" : undefined}
              tabIndex={onSelectRoom ? 0 : undefined}
              aria-label={onSelectRoom ? `Вибрати: ${room.name || "Без назви"}` : undefined}
              onClick={() => onSelectRoom?.(room.id)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRoom?.(room.id); } }}
              data-room-id={room.id}
              data-selected={isSelected ? "true" : undefined}
              className={isSelected ? styles.roomPolygonSelected : undefined}
              points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
            >
              <title>{room.name?.trim() || "Приміщення без назви"}</title>
            </polygon>
          );
        })}
      </svg>
      {showRoomLabels && projected.rooms.map(({ room, label }) => label && (
        <div key={room.id} data-room-label={room.id} className={styles.roomLabel}
          style={{ left: label.x, top: label.y, width: label.width, height: label.height }}>
          <span>{room.name?.trim() || "Приміщення без назви"}</span>
          <span>{Number.isFinite(room.area) && room.area >= 0 ? `${areaFormat.format(room.area)} м²` : "Площу не визначено"}</span>
        </div>
      ))}
      {projected.devices.map(({ device, point }) => (
        <button key={device.id} type="button" className={styles.deviceMarker} data-device-id={device.id}
          style={{ left: point.x, top: point.y }} aria-label={`${deviceLabel(device.type)} · ${roomName(device)} · ${RULE_STATE_LABELS[deviceRuleState(device, rules)]}`}
          data-rule-state={deviceRuleState(device, rules)}
          aria-describedby={active?.device.id === device.id ? tooltipId : undefined}
          onClick={() => onSelectDevice?.(device.id)}
          onPointerEnter={() => { setHovered(device.id); setDismissed(null); }}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => { setFocused(device.id); setDismissed(null); }}
          onBlur={() => setFocused(null)}
          onKeyDown={(event) => { if (event.key === "Escape") setDismissed(device.id); }}>
          <DeviceSymbol type={device.type} />
          {deviceRuleState(device, rules) !== "verified" && <span aria-hidden="true" className={styles.ruleIndicator} data-review={deviceRuleState(device, rules) === "needs_review"}>{deviceRuleState(device, rules) === "needs_review" ? "!" : "?"}</span>}
        </button>
      ))}
      {active && (
        <div id={tooltipId} role="tooltip" className={styles.deviceTooltip} style={{
          width: tooltipWidth,
          left: Math.max(8, Math.min(active.point.x - tooltipWidth / 2, viewport.width - tooltipWidth - 8)),
          top: active.point.y + (below ? tooltipGap : -tooltipGap),
          transform: below ? undefined : "translateY(-100%)",
          maxHeight: Math.max(0, (below ? viewport.height - active.point.y : active.point.y) - tooltipGap - 8),
        }}>
          <strong>{deviceLabel(active.device.type)}</strong>
          <span>{roomName(active.device)}</span>
          <span>{RULE_STATE_LABELS[deviceRuleState(active.device, rules)]}</span>
          {active.device.ruleId && <span>Правило: {active.device.ruleId}</span>}
        </div>
      )}
    </div>
  );
}
