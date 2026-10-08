// Atmosphere & polish passes: contact shadows, grass, terrain rim light,
// drifting ground fog, moonlight shafts and a final colour grade.

import type { Game } from '../game';
import { RGB, seeded } from '../core/math';
import type { Camera } from './camera';
import type { Terrain } from '../world/terrain';

interface View { x0: number; y0: number; x1: number; y1: number }

let fogSprite: HTMLCanvasElement | null = null;
function getFogSprite() {
  if (fogSprite) return fogSprite;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 48, 0, 128, 48, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.save(); x.scale(1, 96 / 256 * 2.6); x.fillRect(0, 0, 256, 256); x.restore();
  fogSprite = c;
  return c;
}

/** soft contact shadows under characters, props and the player */
export function drawContactShadows(ctx: CanvasRenderingContext2D, g: Game, view: View) {
  ctx.fillStyle = '#000';
  const shadow = (x: number, bottom: number, w: number, k = 1) => {
    if (x < view.x0 - 50 || x > view.x1 + 50) return;
    const gy = g.terrain.groundBelow(x, bottom - 6, 220);
    const d = gy - bottom;
    if (d > 200 || d < -12) return;
    const f = Math.max(0, 1 - d / 200) * k;
    ctx.globalAlpha = 0.38 * f;
    ctx.beginPath();
    ctx.ellipse(x, gy + 1, w * (0.6 + 0.4 * f), 4 + 2 * f, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const e of g.entities) {
    if (e.kind === 'lamp' || e.kind === 'pillar' || e.kind === 'iceslab' || e.kind === 'wall' || e.kind === 'door' || e.kind === 'generator' || e.kind === 'tree') continue;
    const b = e.bounds();
    if (b.x1 < view.x0 || b.x0 > view.x1) continue;
    const w = Math.min(60, (b.x1 - b.x0) * 0.55 + 6);
    shadow((b.x0 + b.x1) / 2, b.y1, w, e.kind === 'strawman' ? 0.6 : 1);
  }
  const pl = g.player;
  if (!pl.dead && !pl.phasing) shadow(pl.x, pl.feetY, 16, pl.visibility());
  ctx.globalAlpha = 1;
}

/** grass blades along the tops of ground solids (yard / ruins) */
export function drawGrass(ctx: CanvasRenderingContext2D, terrain: Terrain, view: View, t: number, color: RGB) {
  ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of terrain.solids) {
    if (s.style !== 'ground' || s.oneway) continue;
    if (s.x > view.x1 || s.x + s.w < view.x0 || s.y < view.y0 - 20 || s.y > view.y1 + 20) continue;
    const rng = seeded((s.x * 13 + s.y * 7) | 0);
    const x0 = Math.max(s.x, view.x0 - 20), x1 = Math.min(s.x + s.w, view.x1 + 20);
    // deterministic blade positions every ~7px
    const start = Math.floor((x0 - s.x) / 7);
    for (let i = 0; i < start; i++) { rng(); rng(); }
    for (let x = s.x + start * 7; x < x1; x += 7) {
      const r1 = rng(), r2 = rng();
      if (r1 < 0.25) continue;
      const h = 4 + r2 * 9;
      const sway = Math.sin(t * 1.6 + x * 0.05) * 2 + (r1 - 0.5) * 3;
      const bx = x + r1 * 5;
      ctx.moveTo(bx, s.y + 1);
      ctx.quadraticCurveTo(bx + sway * 0.4, s.y - h * 0.5, bx + sway, s.y - h);
    }
  }
  ctx.stroke();
}

/** additive moonlit rim along terrain tops (glow pass) */
export function drawRims(ctx: CanvasRenderingContext2D, terrain: Terrain, view: View, color: RGB) {
  ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const s of terrain.solids) {
    if (s.x > view.x1 || s.x + s.w < view.x0 || s.y < view.y0 - 10 || s.y > view.y1) continue;
    if (s.style === 'thick' || s.w < 20) continue;
    ctx.moveTo(Math.max(s.x, view.x0 - 10), s.y + 1);
    ctx.lineTo(Math.min(s.x + s.w, view.x1 + 10), s.y + 1);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const fogCache = new Map<number, number>();
/** slow drifting fog hugging the ground, drawn over the world before lighting */
export function drawGroundFog(ctx: CanvasRenderingContext2D, g: Game, view: View, t: number, color: RGB) {
  const sprite = getFogSprite();
  const step = 170;
  const drift = t * 14;
  const key0 = Math.floor((view.x0 - 300 + drift) / step);
  const key1 = Math.ceil((view.x1 + 300 + drift) / step);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let k = key0; k <= key1; k++) {
    const wx = k * step - drift;
    const bucket = Math.round(wx / 40);
    let gy = fogCache.get(bucket);
    if (gy === undefined) {
      gy = g.terrain.groundBelow(bucket * 40, 0, g.map.h);
      fogCache.set(bucket, gy);
    }
    if (gy < view.y0 - 60 || gy > view.y1 + 120) continue;
    const r = seeded(k * 31 + 7)();
    const w = 360 + r * 240, h = 70 + r * 50;
    ctx.globalAlpha = 0.06 + 0.05 * Math.sin(t * 0.5 + k);
    ctx.drawImage(sprite, wx - w / 2, gy - h * 0.55, w, h);
  }
  ctx.restore();
  // tint (sprite is white): cheap colour wash via a second pass is not needed, we keep it neutral
  void color;
}
export function resetFogCache() { fogCache.clear(); }

/** moonlight shafts in screen space (additive, very subtle) */
export function drawGodRays(ctx: CanvasRenderingContext2D, cam: Camera, t: number, moonX: number, color: RGB) {
  const W = cam.vw, H = cam.vh;
  const mx = moonX * W - cam.x * 0.015;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const ang = 0.35 + i * 0.16 + Math.sin(t * 0.07 + i) * 0.03;
    const len = H * 1.4;
    const w0 = 18 + i * 10, w1 = 120 + i * 50;
    const x0 = mx + (i - 1.5) * 30, y0 = -20;
    const dx = -Math.sin(ang - 0.6) * len, dy = Math.cos(ang - 0.6) * len;
    const gr = ctx.createLinearGradient(x0, y0, x0 + dx, y0 + dy);
    const a = 0.035 + 0.015 * Math.sin(t * 0.3 + i * 2);
    gr.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${a})`);
    gr.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x0 - w0, y0);
    ctx.lineTo(x0 + w0, y0);
    ctx.lineTo(x0 + dx + w1, y0 + dy);
    ctx.lineTo(x0 + dx - w1, y0 + dy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** final colour grade: cool highlights up top, warmer shadows at the bottom */
export function colorGrade(ctx: CanvasRenderingContext2D, W: number, H: number, top: RGB, bottom: RGB, amount: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = amount;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
  g.addColorStop(1, `rgb(${bottom[0]},${bottom[1]},${bottom[2]})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
