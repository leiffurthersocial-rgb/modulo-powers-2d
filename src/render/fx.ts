// High-level effect helpers (dust, smoke, splashes, shockwaves, jagged
// lightning bolts) and ground decals (scorch marks, ash, cracks, wet spots).

import { G } from '../ctx';
import { audio } from '../core/audio';
import { rand, RGB, Vec } from '../core/math';
import { particles, PK } from './particles';

export interface Bolt {
  pts: Vec[];
  width: number;
  color: RGB;
  life: number;
  maxLife: number;
  flicker: boolean;
}

export function jagged(x0: number, y0: number, x1: number, y1: number, rough: number, segLen = 14): Vec[] {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / segLen));
  const nx = -dy / (len || 1), ny = dx / (len || 1);
  const pts: Vec[] = [{ x: x0, y: y0 }];
  let off = 0;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    off = off * 0.6 + rand(-rough, rough);
    const taper = Math.sin(t * Math.PI);
    pts.push({ x: x0 + dx * t + nx * off * taper, y: y0 + dy * t + ny * off * taper });
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

export class FX {
  bolts: Bolt[] = [];

  clear() { this.bolts = []; }

  update(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.life <= 0) this.bolts.splice(i, 1);
      else if (b.flicker && Math.random() < 0.3) {
        // re-jitter interior points for a live crackle
        for (let k = 1; k < b.pts.length - 1; k++) { b.pts[k].x += rand(-2, 2); b.pts[k].y += rand(-2, 2); }
      }
    }
  }

  bolt(pts: Vec[], width: number, color: RGB, life: number, flicker = true) {
    if (this.bolts.length > 60) this.bolts.shift();
    this.bolts.push({ pts, width, color, life, maxLife: life, flicker });
  }

  /** small electric arc between two points */
  arc(x0: number, y0: number, x1: number, y1: number, color: RGB, width = 2, life = 0.1, rough = 10) {
    this.bolt(jagged(x0, y0, x1, y1, rough, 9), width, color, life, true);
  }

  dust(x: number, y: number, n: number, color: RGB = [110, 100, 90]) {
    for (let i = 0; i < particles.n(n); i++) {
      particles.emit({ kind: PK.Smoke, x: x + rand(-15, 15), y: y + rand(-6, 2), vx: rand(-90, 90), vy: rand(-60, -10), life: rand(0.8, 1.6), size: rand(6, 10), sizeEnd: rand(20, 34), color, alpha: 0.35, drag: 2 });
    }
  }

  smoke(x: number, y: number, n: number, color: RGB = [32, 30, 32]) {
    for (let i = 0; i < particles.n(n); i++) {
      particles.emit({ kind: PK.Smoke, x: x + rand(-12, 12), y: y + rand(-12, 12), vx: rand(-30, 30), vy: rand(-90, -30), life: rand(1.6, 3), size: rand(10, 16), sizeEnd: rand(40, 70), color, alpha: 0.5, drag: 0.5 });
    }
  }

  splash(x: number, y: number, amount: number) {
    const n = particles.n(8 + amount * 30);
    for (let i = 0; i < n; i++) {
      particles.emit({ kind: PK.Drop, x: x + rand(-10, 10), y: y - 2, vx: rand(-200, 200) * (0.5 + amount), vy: -rand(150, 450) * (0.4 + amount * 0.8), life: rand(0.5, 1.1), size: rand(1.5, 3.2), color: [130, 200, 255], gravity: 1300, collide: true, alpha: 0.9 });
    }
    audio.splash(x, y, Math.min(1, 0.25 + amount));
  }

  ring(x: number, y: number, r0: number, r1: number, color: RGB, life = 0.4, alpha = 1) {
    particles.emit({ kind: PK.Ring, x, y, life, size: r0, sizeEnd: r1, color, alpha });
  }

  sparks(x: number, y: number, n: number, color: RGB = [255, 230, 160], speed = 400) {
    for (let i = 0; i < particles.n(n); i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * speed;
      particles.emit({ kind: PK.Spark, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.15, 0.4), size: rand(1, 2.2), color, gravity: 700, drag: 1.5 });
    }
  }

  explosion(x: number, y: number, size: number, core: RGB = [255, 230, 160], outer: RGB = [255, 110, 30]) {
    const n = particles.n(26 * size);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(60, 420) * size;
      particles.emit({ kind: PK.Glow, x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: rand(0.25, 0.6), size: rand(10, 22) * size, sizeEnd: 2, color: Math.random() < 0.4 ? core : outer, drag: 3.5, alpha: 0.9 });
    }
    for (let i = 0; i < particles.n(14 * size); i++) {
      const a = rand(0, Math.PI * 2), s = rand(200, 700) * size;
      particles.emit({ kind: PK.Spark, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, life: rand(0.3, 0.7), size: rand(1.2, 2.4), color: core, gravity: 900, drag: 1.5, collide: true, bounce: 0.4 });
    }
    this.smoke(x, y, 8 * size);
    this.ring(x, y, 10, 90 * size, outer, 0.35);
    G.lighting.flash(x, y, 320 * size, outer, 1.4, 0.45);
  }

  drawBolts(ctx: CanvasRenderingContext2D) {
    for (const b of this.bolts) {
      const k = b.life / b.maxLife;
      const flick = b.flicker ? 0.75 + Math.random() * 0.25 : 1;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(b.pts[0].x, b.pts[0].y);
        for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i].x, b.pts[i].y);
      };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.35 * k * flick;
      ctx.strokeStyle = `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`;
      ctx.lineWidth = b.width * 4.5;
      path(); ctx.stroke();
      ctx.globalAlpha = 0.85 * k * flick;
      ctx.lineWidth = b.width * 1.6;
      path(); ctx.stroke();
      ctx.globalAlpha = Math.min(1, 1.2 * k);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, b.width * 0.6);
      path(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

export type DecalKind = 'scorch' | 'ash' | 'crack' | 'wet' | 'crater';

interface Decal { kind: DecalKind; x: number; y: number; size: number; life: number; seed: number }

export class Decals {
  list: Decal[] = [];
  clear() { this.list = []; }
  add(kind: DecalKind, x: number, y: number, size: number, life = 45) {
    if (this.list.length > 90) this.list.shift();
    this.list.push({ kind, x, y, size, life, seed: Math.random() * 100 });
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt * (d.kind === 'wet' ? 3 : 1);
      if (d.life <= 0) this.list.splice(i, 1);
    }
  }
  draw(ctx: CanvasRenderingContext2D, view: { x0: number; x1: number }) {
    for (const d of this.list) {
      if (d.x + d.size < view.x0 || d.x - d.size > view.x1) continue;
      const a = Math.min(1, d.life / 5);
      switch (d.kind) {
        case 'scorch':
        case 'crater': {
          ctx.globalAlpha = a * 0.75;
          ctx.fillStyle = '#0a0806';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y + 1, d.size, d.size * 0.18, 0, 0, Math.PI * 2);
          ctx.fill();
          if (d.kind === 'crater') {
            ctx.globalAlpha = a * 0.5;
            ctx.fillRect(d.x - d.size * 0.6, d.y, d.size * 1.2, 6);
          }
          break;
        }
        case 'ash': {
          ctx.globalAlpha = a * 0.9;
          ctx.fillStyle = '#3b3836';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.size * 0.5, d.size * 0.12, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = '#56504c';
          for (let i = 0; i < 5; i++) ctx.fillRect(d.x + Math.sin(d.seed + i * 2) * d.size * 0.4, d.y - 2 - (i % 3), 3, 2);
          break;
        }
        case 'crack': {
          ctx.globalAlpha = a * 0.8;
          ctx.strokeStyle = '#05050a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            let x = d.x, y = d.y + 1;
            ctx.moveTo(x, y);
            for (let k = 0; k < 4; k++) {
              x += Math.sin(d.seed + i * 1.9 + k) * d.size * 0.12 + (i - 2) * d.size * 0.05;
              y += 2 + Math.abs(Math.cos(d.seed + k + i)) * 2.5;
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
          break;
        }
        case 'wet': {
          ctx.globalAlpha = a * 0.35;
          ctx.fillStyle = '#123a66';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y + 1, d.size, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
