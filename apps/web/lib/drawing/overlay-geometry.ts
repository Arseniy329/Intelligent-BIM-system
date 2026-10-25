import type { Device, Room } from "@bim/contracts";
import type { DrawingPoint, DrawingViewportController } from "./viewer-adapter";

export type OverlaySize = { width: number; height: number };

export function isFinitePoint(point: DrawingPoint | null | undefined): point is DrawingPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Reject the whole broken contour rather than joining across missing vertices. */
export function projectRoom(room: Room, controller: DrawingViewportController): DrawingPoint[] | null {
  if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(isFinitePoint)) return null;
  const points = room.polygon.map((point) => controller.worldToScreen(point));
  return points.every(isFinitePoint) ? points : null;
}

export function projectDevice(device: Device, controller: DrawingViewportController): DrawingPoint | null {
  if (!isFinitePoint(device.position)) return null;
  const point = controller.worldToScreen(device.position);
  return isFinitePoint(point) ? point : null;
}

export const ROOM_LABEL_HEIGHT = 40;
type Interval = [number, number];

function interiorSpans(points: readonly DrawingPoint[], y: number): Interval[] {
  const crossings: number[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
  });
  crossings.sort((a, b) => a - b);
  const spans: Interval[] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) spans.push([crossings[i], crossings[i + 1]]);
  return spans;
}

/** Fit the entire label rectangle inside the polygon, not just its centre scanline.
 * Between vertex heights, edge intersections are linear: intersecting spans at both
 * ends and either side of each vertex covers the whole band, including concave notches.
 * Text stays at a readable CSS size; small rooms fall back to the full summary below.
 */
export function roomLabelPlacement(points: readonly DrawingPoint[], size: OverlaySize) {
  if (points.length < 3 || !points.every(isFinitePoint)) return null;
  const bounds = points.reduce((range, point) => ({ min: Math.min(range.min, point.y), max: Math.max(range.max, point.y) }), { min: Infinity, max: -Infinity });
  const halfHeight = ROOM_LABEL_HEIGHT / 2;
  const minY = bounds.min + 4 + halfHeight;
  const maxY = bounds.max - 4 - halfHeight;
  if (maxY <= minY || size.width <= 16 || size.height < ROOM_LABEL_HEIGHT + 16) return null;
  let best: { x: number; y: number; width: number; height: number } | null = null;
  for (const fraction of [0.5, 0.25, 0.75, 0, 1]) {
    // Prefer the room anchor; constrain it only when its text box would leave the viewport.
    const y = Math.max(8 + halfHeight, Math.min(size.height - 8 - halfHeight, minY + (maxY - minY) * fraction));
    if (y < minY || y > maxY) continue;
    const top = y - halfHeight - 4, bottom = y + halfHeight + 4;
    const levels = [top, bottom];
    for (const point of points) {
      if (point.y > top && point.y < bottom) levels.push(point.y - 1e-7, point.y + 1e-7);
    }
    let spans: Interval[] = [[-Infinity, Infinity]];
    for (const level of levels) {
      const interior = interiorSpans(points, level);
      spans = spans.flatMap(([left, right]) => interior.flatMap(([a, b]): Interval[] => {
        const start = Math.max(left, a + 4), end = Math.min(right, b - 4);
        return end > start ? [[start, end]] : [];
      }));
      if (!spans.length) break;
    }
    for (const [left, right] of spans) {
      const visibleLeft = Math.max(8, left), visibleRight = Math.min(size.width - 8, right);
      const width = Math.min(180, visibleRight - visibleLeft);
      const x = Math.max(visibleLeft + width / 2, Math.min(visibleRight - width / 2, (left + right) / 2));
      if (width >= 80 && (!best || width > best.width)) best = { x, y, width, height: ROOM_LABEL_HEIGHT };
    }
  }
  return best;
}

/** Coalesce camera events, including resize, and cancel pending work on teardown. */
export function observeOverlayViewport(controller: DrawingViewportController, update: () => void) {
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; update(); });
  };
  const unsubscribe = controller.subscribeViewportChange(schedule);
  schedule();
  return () => {
    unsubscribe();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
