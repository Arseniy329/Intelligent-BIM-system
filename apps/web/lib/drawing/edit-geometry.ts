import type { Point, Room } from "@bim/contracts";

export function polygonArea(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}

export function roomAtPoint(rooms: Room[], point: Point): string | null {
  for (const room of rooms) {
    let inside = false;
    for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++) {
      const a = room.polygon[i], b = room.polygon[j];
      const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
      if (Math.abs(cross) < 1e-8 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return room.id;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return room.id;
  }
  return null;
}

export function validOutline(points: readonly Point[]): boolean {
  if (points.length < 3 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) || polygonArea(points) <= 0) return false;
  if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) return false;
  const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on = (a: Point, b: Point, c: Point) => cross(a,b,c) === 0 && c.x >= Math.min(a.x,b.x) && c.x <= Math.max(a.x,b.x) && c.y >= Math.min(a.y,b.y) && c.y <= Math.max(a.y,b.y);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i+1 || i === 0 && j === points.length-1) continue;
    const a=points[i], b=points[(i+1)%points.length], c=points[j], d=points[(j+1)%points.length];
    if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0 || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)) return false;
  }
  return true;
}
