// Water pools/rivers with a spring-column surface, buoyancy, splashes,
// electrification (lightning) and freezing into walkable ice.

import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, clamp, rand } from '../core/math';
import { particles, PK } from '../render/particles';
import { Block } from './blocks';
import { Entity } from './entity';
import { addVel, MBody, plug, vel } from './phys';

const COL = 12;

export class Pool {
  x: number; y: number; w: number; h: number;
  n: number;
  hgt: Float32Array; // surface offsets (positive = down)
  v: Float32Array;
  elec = 0;
  boil = 0;
  ice: (Block | null)[];
  private buzz: LoopHandle | null = null;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.n = Math.max(2, Math.ceil(w / COL) + 1);
    this.hgt = new Float32Array(this.n);
    this.v = new Float32Array(this.n);
    this.ice = new Array(Math.ceil(w / 60)).fill(null);
  }

  surfaceAt(x: number) {
    const i = clamp((x - this.x) / COL, 0, this.n - 1);
    const i0 = Math.floor(i), i1 = Math.min(this.n - 1, i0 + 1);
    const t = i - i0;
    return this.y + this.hgt[i0] * (1 - t) + this.hgt[i1] * t;
  }

  contains(x: number, y: number) {
    return x >= this.x && x <= this.x + this.w && y >= this.surfaceAt(x) - 2 && y <= this.y + this.h;
  }

  disturb(x: number, amount: number, radius = 30) {
    for (let i = 0; i < this.n; i++) {
      const px = this.x + i * COL;
      const d = Math.abs(px - x);
      if (d < radius) this.v[i] += amount * (1 - d / radius);
    }
  }

  update(dt: number) {
    // spring columns
    const k = 60, damp = 2.2, spread = 0.22;
    for (let i = 0; i < this.n; i++) {
      const a = -k * this.hgt[i] - damp * this.v[i];
      this.v[i] += a * dt;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.n; i++) {
        if (i > 0) { const d = spread * (this.hgt[i] - this.hgt[i - 1]); this.v[i - 1] += d * 60 * dt; }
        if (i < this.n - 1) { const d = spread * (this.hgt[i] - this.hgt[i + 1]); this.v[i + 1] += d * 60 * dt; }
      }
    }
    for (let i = 0; i < this.n; i++) this.hgt[i] = clamp(this.hgt[i] + this.v[i] * dt, -40, 40);
    // ambient ripples
    if (chance(dt * 2)) this.disturb(this.x + rand(0, this.w), rand(-15, 15), 20);

    // ice under the surface stays flat
    for (let s = 0; s < this.ice.length; s++) {
      const b = this.ice[s];
      if (b && b.removed) this.ice[s] = null;
      if (this.ice[s]) {
        const i0 = Math.floor((s * 60) / COL), i1 = Math.min(this.n - 1, Math.ceil(((s + 1) * 60) / COL));
        for (let i = i0; i <= i1; i++) { this.hgt[i] *= 0.8; this.v[i] *= 0.5; }
      }
    }

    if (this.elec > 0) {
      this.elec -= dt;
      if (!this.buzz) this.buzz = audio.loop('buzz');
      this.buzz.set(Math.min(1, this.elec) * 0.8, 1 + Math.random() * 0.3);
      G.lighting.add(this.x + this.w / 2, this.y, Math.max(200, this.w * 0.6), [140, 200, 255], 0.5 * Math.min(1, this.elec), 0.5);
      // arcs along the surface
      if (chance(dt * 20)) {
        const x0 = this.x + rand(0, this.w);
        const x1 = clamp(x0 + rand(-120, 120), this.x, this.x + this.w);
        G.fx.arc(x0, this.surfaceAt(x0), x1, this.surfaceAt(x1), [170, 220, 255], 2, 0.12, 8);
      }
    } else if (this.buzz) { this.buzz.stop(); this.buzz = null; }
    if (this.boil > 0) {
      this.boil -= dt;
      if (chance(dt * 30 * Math.min(1, this.boil))) {
        const x = this.x + rand(0, this.w);
        particles.emit({ kind: PK.Steam, x, y: this.surfaceAt(x), vx: rand(-10, 10), vy: rand(-80, -40), life: rand(1.5, 2.5), size: 10, sizeEnd: 50, color: [210, 215, 225], alpha: 0.3 });
        this.disturb(x, rand(-30, 30), 15);
      }
    }
  }

  stopSounds() { this.buzz?.stop(); this.buzz = null; }

  electrify(seconds: number) {
    this.elec = Math.max(this.elec, seconds);
    audio.zap(this.x + this.w / 2, this.y, 1.2);
  }

  /** freeze the surface around x (radius in px). Returns true if any ice formed. */
  freezeAt(x: number, radius: number): boolean {
    let made = false;
    for (let s = 0; s < this.ice.length; s++) {
      const sx = this.x + s * 60;
      const sw = Math.min(60, this.x + this.w - sx);
      if (sw <= 4) continue;
      if (sx + sw < x - radius || sx > x + radius) continue;
      if (this.ice[s]) { this.ice[s]!.age = 0; continue; }
      const b = new Block(sx, this.y - 6, sw, 22, 'iceslab', { lifetime: 26 });
      G.addEntity(b);
      this.ice[s] = b;
      made = true;
      for (let i = 0; i < particles.n(10); i++) particles.emit({ kind: PK.Glow, x: sx + rand(0, sw), y: this.y + rand(-6, 10), vx: rand(-20, 20), vy: rand(-60, 0), life: rand(0.4, 0.8), size: rand(3, 6), color: [180, 230, 255], alpha: 0.7 });
    }
    if (made) this.elec = 0;
    return made;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const top = this.y - 10;
    const g = ctx.createLinearGradient(0, top, 0, this.y + this.h);
    g.addColorStop(0, 'rgba(40,120,190,0.55)');
    g.addColorStop(0.3, 'rgba(20,70,130,0.7)');
    g.addColorStop(1, 'rgba(8,24,52,0.88)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y + this.h);
    for (let i = 0; i < this.n; i++) ctx.lineTo(Math.min(this.x + this.w, this.x + i * COL), this.y + this.hgt[i]);
    ctx.lineTo(this.x + this.w, this.y + this.h);
    ctx.closePath();
    ctx.fill();
    // caustic streaks
    ctx.strokeStyle = 'rgba(140,210,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.w / 40; i++) {
      const xx = this.x + ((i * 53 + t * 20) % this.w);
      const yy = this.y + 14 + ((i * 29) % Math.max(10, this.h - 20));
      ctx.moveTo(xx, yy); ctx.lineTo(xx + 14 + Math.sin(t * 2 + i) * 6, yy + 2);
    }
    ctx.stroke();
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = this.elec > 0 ? 'rgba(190,230,255,0.9)' : 'rgba(110,200,255,0.55)';
    ctx.lineWidth = this.elec > 0 ? 3 : 2;
    ctx.beginPath();
    for (let i = 0; i < this.n; i++) {
      const x = Math.min(this.x + this.w, this.x + i * COL), y = this.y + this.hgt[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export class WaterSystem {
  pools: Pool[] = [];

  clear() {
    for (const p of this.pools) p.stopSounds();
    this.pools = [];
  }

  add(x: number, y: number, w: number, h: number) {
    const p = new Pool(x, y, w, h);
    this.pools.push(p);
    return p;
  }

  poolAt(x: number, y: number): Pool | null {
    for (const p of this.pools) if (p.contains(x, y)) return p;
    return null;
  }

  /** pool whose surface is near (x,y) horizontally overlapping */
  poolNear(x: number, y: number, r: number): Pool | null {
    for (const p of this.pools) {
      if (x + r < p.x || x - r > p.x + p.w) continue;
      if (y > p.y - r - 40 && y < p.y + p.h) return p;
    }
    return null;
  }

  /** depth of water at a point (0 if dry) */
  depthAt(x: number, y: number) {
    for (const p of this.pools) {
      if (x < p.x || x > p.x + p.w) continue;
      const s = p.surfaceAt(x);
      if (y > s && y < p.y + p.h) return y - s;
    }
    return 0;
  }

  update(dt: number) {
    for (const p of this.pools) p.update(dt);
    // buoyancy, drag, soaking, splash
    for (const b of G.dynamicBodies) {
      const x = b.position.x, y = b.position.y;
      for (const p of this.pools) {
        if (x < p.x || x > p.x + p.w || y < p.y - 40 || y > p.y + p.h + 20) continue;
        const s = p.surfaceAt(x);
        const half = (b.bounds.max.y - b.bounds.min.y) / 2;
        const sub = clamp((y + half - s) / (half * 2), 0, 1);
        const bp = b.plugin as any;
        if (sub > 0) {
          const v = vel(b);
          // entry splash
          if (!bp.inWater && v.y > 150) {
            const amt = Math.min(1, (v.y / 900) * Math.sqrt(b.mass));
            p.disturb(x, v.y * 0.25 * Math.min(2, Math.sqrt(b.mass)), 30 + half);
            G.fx.splash(x, s, amt);
          }
          bp.inWater = true;
          const owner = bp.owner as Entity | undefined;
          // density-based buoyancy: wood/straw/ice float, stone sinks slowly
          const dens = b.density;
          const lift = dens < 0.0013 ? 2400 : dens < 0.0025 ? 1650 : 1100;
          addVel(b, 0, -lift * sub * dt);
          const drag = Math.exp(-2.2 * sub * dt);
          addVel(b, v.x * (drag - 1), v.y * (drag - 1));
          if (owner) {
            if (owner.burning > 0) owner.extinguish(1);
            owner.wet = Math.max(owner.wet, sub > 0.3 ? 1 : owner.wet);
            if (p.elec > 0 && owner.conductive) owner.electrocute(0.4, 30 * dt);
            if (p.elec > 0 && !owner.conductive && owner.wet > 0.5) owner.electrocute(0.3, 14 * dt);
          }
        } else bp.inWater = false;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: { x0: number; x1: number }, t: number) {
    for (const p of this.pools) {
      if (p.x > view.x1 || p.x + p.w < view.x0) continue;
      p.draw(ctx, t);
    }
  }

  drawGlow(ctx: CanvasRenderingContext2D, view: { x0: number; x1: number }) {
    for (const p of this.pools) {
      if (p.x > view.x1 || p.x + p.w < view.x0) continue;
      p.drawGlow(ctx);
    }
  }
}

export function isTerrainBody(b: MBody) { return !!plug(b).terrain; }
