// Matter.js helpers. Matter velocities are in px per 1/60 s step; game code
// thinks in px/s, so everything goes through these helpers.
import Matter from 'matter-js';
import type { Entity } from './entity';

export const { Body, Bodies, Composite, Constraint, Query, Events, Vector } = Matter;
export type MBody = Matter.Body;

export const CAT = {
  TERRAIN: 0x0001,
  PROP: 0x0002,
  CHAR: 0x0004, // ragdolls / strawmen
  PLAYER: 0x0008,
  DEBRIS: 0x0010,
  THICK: 0x0020, // thick walls (phase-able, otherwise terrain)
  ONEWAY: 0x0040,
  SENSOR: 0x0080,
};

export const MASK_ALL = 0xffff;

export interface BodyPlugin {
  owner?: Entity;
  oneway?: boolean;
  terrain?: boolean;
  mat?: string;
  // interpolation snapshot
  px?: number; py?: number; pa?: number;
}

export function plug(b: MBody): BodyPlugin {
  return b.plugin as BodyPlugin;
}

export function vel(b: MBody) {
  return { x: b.velocity.x * 60, y: b.velocity.y * 60 };
}

export function setVel(b: MBody, vx: number, vy: number) {
  Body.setVelocity(b, { x: vx / 60, y: vy / 60 });
}

const MAXV = 1500;
export function addVel(b: MBody, dvx: number, dvy: number) {
  if (b.isStatic) return;
  let vx = b.velocity.x * 60 + dvx, vy = b.velocity.y * 60 + dvy;
  const s = Math.hypot(vx, vy);
  if (s > MAXV) { vx *= MAXV / s; vy *= MAXV / s; }
  Body.setVelocity(b, { x: vx / 60, y: vy / 60 });
}

/** interpolated position/angle for rendering */
export function ipos(b: MBody, alpha: number) {
  const p = b.plugin as BodyPlugin;
  if (p.px === undefined || b.isStatic) return { x: b.position.x, y: b.position.y, a: b.angle };
  return {
    x: p.px + (b.position.x - p.px) * alpha,
    y: p.py! + (b.position.y - p.py!) * alpha,
    a: p.pa! + (b.angle - p.pa!) * alpha,
  };
}

export function snapshot(bodies: MBody[]) {
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.isStatic && !(b.plugin as BodyPlugin).terrain) continue;
    const p = b.plugin as BodyPlugin;
    p.px = b.position.x; p.py = b.position.y; p.pa = b.angle;
  }
}

/** Draw a body's (convex) polygon path at its interpolated transform. */
export function bodyPath(ctx: CanvasRenderingContext2D, b: MBody, alpha: number) {
  const ip = ipos(b, alpha);
  const dx = ip.x - b.position.x, dy = ip.y - b.position.y, da = ip.a - b.angle;
  const c = Math.cos(da), s = Math.sin(da);
  ctx.beginPath();
  const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
  for (const part of parts) {
    const vs = part.vertices;
    for (let i = 0; i < vs.length; i++) {
      // rotate around body position by da, then translate
      const rx = vs[i].x - b.position.x, ry = vs[i].y - b.position.y;
      const x = b.position.x + rx * c - ry * s + dx;
      const y = b.position.y + rx * s + ry * c + dy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}
