// Pooled particle system. Additive (glow) particles are drawn into the glow
// buffer after lighting, normal particles (smoke, debris, dust) are drawn in
// the world pass so the lighting darkens them.

import { RGB } from '../core/math';

export const enum PK {
  Glow = 0,     // soft additive dot
  Spark = 1,    // additive streak along velocity
  Smoke = 2,    // soft normal-blend puff
  Debris = 3,   // rotating square chunk, normal blend
  Drop = 4,     // water droplet: normal blend circle + highlight
  Ember = 5,    // additive flickering dot that rises
  Ring = 6,     // additive expanding ring
  Wisp = 7,     // dark shadow wisp (normal blend, dark purple)
  Line = 8,     // additive line segment from (x,y) to (x2,y2)
  Steam = 9,    // light soft puff, normal blend
}

export class Particle {
  active = false;
  kind: PK = PK.Glow;
  x = 0; y = 0; vx = 0; vy = 0;
  x2 = 0; y2 = 0;
  life = 0; maxLife = 1;
  size = 4; sizeEnd = 0;
  r = 255; g = 255; b = 255;
  alpha = 1;
  gravity = 0;
  drag = 0;
  rot = 0; vrot = 0;
  collide = false;
  bounce = 0.3;
  flicker = 0;
  /** world-space "heat": particles with heat > 0 can ignite things (flamethrower) */
  tag = 0;
}

export interface EmitOpts {
  kind?: PK;
  x: number; y: number;
  vx?: number; vy?: number;
  life: number;
  size: number; sizeEnd?: number;
  color: RGB;
  alpha?: number;
  gravity?: number;
  drag?: number;
  rot?: number; vrot?: number;
  collide?: boolean;
  bounce?: number;
  flicker?: number;
  x2?: number; y2?: number;
  tag?: number;
}

export type SolidFn = (x: number, y: number) => boolean;

const MAX = 2600;

export class Particles {
  pool: Particle[] = [];
  private cursor = 0;
  count = 0;
  /** global scale on spawn counts (lowered automatically if frame time is high) */
  budget = 1;
  solid: SolidFn = () => false;
  private sprites = new Map<number, HTMLCanvasElement>();
  private smokeSprites = new Map<number, HTMLCanvasElement>();

  constructor() {
    for (let i = 0; i < MAX; i++) this.pool.push(new Particle());
  }

  clear() {
    for (const p of this.pool) p.active = false;
    this.count = 0;
  }

  /** helper for "spawn N scaled by budget" */
  n(count: number) {
    const c = count * this.budget;
    return Math.floor(c) + (Math.random() < c % 1 ? 1 : 0);
  }

  emit(o: EmitOpts): Particle | null {
    // find a free slot quickly; overwrite oldest-ish if full
    let p: Particle | null = null;
    for (let i = 0; i < 24; i++) {
      const c = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (!c.active) { p = c; break; }
    }
    if (!p) {
      if (Math.random() < 0.6) return null;
      p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
    }
    if (!p.active) this.count++;
    p.active = true;
    p.kind = o.kind ?? PK.Glow;
    p.x = o.x; p.y = o.y;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0;
    p.life = o.life; p.maxLife = o.life;
    p.size = o.size; p.sizeEnd = o.sizeEnd ?? o.size;
    p.r = o.color[0]; p.g = o.color[1]; p.b = o.color[2];
    p.alpha = o.alpha ?? 1;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.rot = o.rot ?? Math.random() * 6.28;
    p.vrot = o.vrot ?? 0;
    p.collide = o.collide ?? false;
    p.bounce = o.bounce ?? 0.3;
    p.flicker = o.flicker ?? 0;
    p.x2 = o.x2 ?? o.x; p.y2 = o.y2 ?? o.y;
    p.tag = o.tag ?? 0;
    return p;
  }

  update(dt: number, wind = 0) {
    const solid = this.solid;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      n++;
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      if (p.kind === PK.Smoke || p.kind === PK.Steam || p.kind === PK.Ember) p.vx += wind * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (p.collide && solid(nx, ny)) {
        if (p.kind === PK.Drop) {
          // droplets splat: shorten life, stop
          p.vy *= -0.15; p.vx *= 0.4;
          p.life = Math.min(p.life, 0.15);
        } else if (!solid(nx, p.y)) {
          p.x = nx; p.vy *= -p.bounce; p.vx *= 0.7;
        } else if (!solid(p.x, ny)) {
          p.y = ny; p.vx *= -p.bounce;
        } else {
          p.vx *= -p.bounce; p.vy *= -p.bounce;
        }
        p.vrot *= 0.5;
      } else {
        p.x = nx; p.y = ny;
      }
      p.rot += p.vrot * dt;
    }
    this.count = n;
  }

  private sprite(r: number, g: number, b: number): HTMLCanvasElement {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d')!;
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},1)`);
    grd.addColorStop(0.25, `rgba(${r},${g},${b},0.8)`);
    grd.addColorStop(0.6, `rgba(${r},${g},${b},0.22)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
    this.sprites.set(key, s);
    return s;
  }

  private smokeSprite(r: number, g: number, b: number): HTMLCanvasElement {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let s = this.smokeSprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d')!;
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},0.45)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
    this.smokeSprites.set(key, s);
    return s;
  }

  /** Normal-blend particles (world transform already applied). */
  drawNormal(ctx: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }) {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      const k = p.kind;
      if (k !== PK.Smoke && k !== PK.Debris && k !== PK.Drop && k !== PK.Wisp && k !== PK.Steam) continue;
      if (p.x < view.x0 - 80 || p.x > view.x1 + 80 || p.y < view.y0 - 80 || p.y > view.y1 + 80) continue;
      const t = 1 - p.life / p.maxLife;
      const size = p.size + (p.sizeEnd - p.size) * t;
      if (k === PK.Smoke || k === PK.Steam || k === PK.Wisp) {
        const a = p.alpha * (k === PK.Wisp ? (1 - t) : Math.sin(Math.min(1, t * 1.2) * Math.PI) * (1 - t * 0.3));
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(this.smokeSprite(p.r, p.g, p.b), p.x - size, p.y - size, size * 2, size * 2);
      } else if (k === PK.Debris) {
        ctx.globalAlpha = Math.min(1, p.alpha * Math.min(1, p.life / 0.4));
        ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        const hw = size * 0.5, hh = size * 0.35;
        ctx.beginPath();
        ctx.moveTo(p.x - hw * c + hh * s, p.y - hw * s - hh * c);
        ctx.lineTo(p.x + hw * c + hh * s, p.y + hw * s - hh * c);
        ctx.lineTo(p.x + hw * c - hh * s, p.y + hw * s + hh * c);
        ctx.lineTo(p.x - hw * c - hh * s, p.y - hw * s + hh * c);
        ctx.fill();
      } else if (k === PK.Drop) {
        ctx.globalAlpha = Math.min(1, p.alpha * Math.min(1, p.life / 0.15));
        ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.beginPath();
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 200) {
          const ang = Math.atan2(p.vy, p.vx);
          ctx.ellipse(p.x, p.y, size * (1 + sp / 600), size * 0.75, ang, 0, 6.283);
        } else ctx.arc(p.x, p.y, size, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Additive particles, drawn into the glow buffer. */
  drawGlow(ctx: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }, time: number) {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      const k = p.kind;
      if (k !== PK.Glow && k !== PK.Spark && k !== PK.Ember && k !== PK.Ring && k !== PK.Line && k !== PK.Drop) continue;
      if (k !== PK.Line && (p.x < view.x0 - 100 || p.x > view.x1 + 100 || p.y < view.y0 - 100 || p.y > view.y1 + 100)) continue;
      const t = 1 - p.life / p.maxLife;
      const size = p.size + (p.sizeEnd - p.size) * t;
      let a = p.alpha * (1 - t);
      if (p.flicker) a *= 1 - p.flicker * 0.5 * (1 + Math.sin(time * 40 + i * 1.7));
      if (a <= 0.01) continue;
      if (k === PK.Glow || k === PK.Ember) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(this.sprite(p.r, p.g, p.b), p.x - size, p.y - size, size * 2, size * 2);
      } else if (k === PK.Drop) {
        // faint highlight on droplets
        ctx.globalAlpha = Math.min(1, a * 0.25);
        ctx.drawImage(this.sprite(p.r, p.g, p.b), p.x - size * 2, p.y - size * 2, size * 4, size * 4);
      } else if (k === PK.Spark) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.strokeStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (k === PK.Ring) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.strokeStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.lineWidth = Math.max(1, 6 * (1 - t));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, size), 0, 6.283);
        ctx.stroke();
      } else if (k === PK.Line) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.strokeStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

export const particles = new Particles();
