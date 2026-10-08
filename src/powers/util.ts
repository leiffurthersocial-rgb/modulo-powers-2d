import { G } from '../ctx';
import { clamp, Vec } from '../core/math';
import type { Entity } from '../world/entity';

/** entities whose bounds come within `r` of segment a-b */
export function entitiesNearSegment(ax: number, ay: number, bx: number, by: number, r: number, exclude?: Set<Entity>): Entity[] {
  const out: Entity[] = [];
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy || 1;
  for (const e of G.entities) {
    if (e.dead && e.kind !== 'dummy' && e.kind !== 'npc') continue;
    if (exclude?.has(e)) continue;
    const c = e.center();
    const t = clamp(((c.x - ax) * dx + (c.y - ay) * dy) / L2, 0, 1);
    const px = ax + dx * t, py = ay + dy * t;
    const b = e.bounds();
    const qx = clamp(px, b.x0, b.x1), qy = clamp(py, b.y0, b.y1);
    if ((qx - px) ** 2 + (qy - py) ** 2 <= r * r) out.push(e);
  }
  return out;
}

/** find a free position for the player hull near (x,y); null if none */
export function freeSpotNear(x: number, y: number, maxR = 400): Vec | null {
  const T = G.terrain;
  const free = (px: number, py: number) => px > 30 && px < T.w - 30 && py > 50 && py < T.h - 50 && T.coverage(px - 12, py - 38, px + 12, py + 30) === 0;
  if (free(x, y)) return { x, y };
  for (let r = 8; r <= maxR; r += 8) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (free(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

export function inCone(e: Entity, ox: number, oy: number, dir: Vec, range: number, halfAngle: number) {
  const c = e.center();
  const dx = c.x - ox, dy = c.y - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + 30 || d < 1) return d < 20;
  const cos = (dx * dir.x + dy * dir.y) / d;
  return cos > Math.cos(halfAngle);
}
