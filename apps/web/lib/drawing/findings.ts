import type { Device, Finding, Room } from "@bim/contracts";
import { apiFetch, ApiHttpError } from "@/lib/api";
import { isFinitePoint } from "./overlay-geometry";

export const FINDING_LABELS: Record<Finding["severity"], string> = {
  critical: "Критичне", warning: "Попередження",
  insufficient_data: "Недостатньо даних", rule_conflict: "Конфлікт норм",
};

export async function fetchFindings(id: string, signal?: AbortSignal): Promise<Finding[]> {
  const response = await apiFetch(`/api/v1/drawings/${encodeURIComponent(id)}/findings`, { method: "GET", signal, cache: "no-store" });
  if (!response.ok) throw new ApiHttpError(response.status);
  const data: unknown = await response.json();
  // Reject a broken/cross-drawing response; never turn it into a clean audit.
  if (!Array.isArray(data) || !data.every(item => item && typeof item === "object" &&
    typeof item.id === "string" && item.drawingId === id && typeof item.message === "string" &&
    Object.hasOwn(FINDING_LABELS, item.severity) &&
    [item.roomId, item.deviceId, item.ruleId, item.document, item.clause].every(value => value === null || typeof value === "string") &&
    [null, "verified", "needs_review"].includes(item.ruleStatus))) throw new Error("Invalid findings response.");
  return data as Finding[];
}

/** Real device coordinates take priority; otherwise choose an interior room scanline. */
export function findingTarget(finding: Finding, rooms: readonly Room[], devices: readonly Device[]) {
  const device = devices.find(item => item.id === finding.deviceId);
  if (device && isFinitePoint(device.position)) return { point: device.position, device };
  const room = rooms.find(item => item.id === finding.roomId);
  const points = room?.polygon;
  if (!room || !points || points.length < 3 || !points.every(isFinitePoint)) return null;
  const y = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
  const xs: number[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
  });
  xs.sort((a, b) => a - b);
  let span: [number, number] | null = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] > xs[i] && (!span || xs[i + 1] - xs[i] > span[1] - span[0])) span = [xs[i], xs[i + 1]];
  }
  return span ? { point: { x: (span[0] + span[1]) / 2, y }, room } : null;
}

export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const displayValue = (value: unknown) => typeof value === "string" && value.trim() || typeof value === "number" && Number.isFinite(value) ? String(value) : null;

// Presentation of the backend's valueKind, not a regulatory calculation.
export function conflictUnit(kind: unknown): string | null {
  if (kind === "max_protected_area_m2") return "м²";
  if (kind === "min_sound_level_dba") return "дБА";
  if (["max_grid_spacing_m", "max_wall_distance_m", "min_wall_clearance_m"].includes(String(kind))) return "м";
  return null;
}
