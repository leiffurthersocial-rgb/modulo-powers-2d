// Ground fires, heat sources, steam clouds and fire spreading between
// flammable entities.

import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, rand } from '../core/math';
import { particles, PK } from '../render/particles';
import { Entity, FIRE_COLORS } from './entity';

interface Patch { x: number; y: number; w: number; life: number; maxLife: number }
interface Heat { x: number; y: number; r: number; power: number }
export interface SteamCloud { x: number; y: number; r: number; life: number; maxLife: number; vy: number }

export class FireSystem {
  patches: Patch[] = [];
  heats: Heat[] = [];
  steam: SteamCloud[] = [];
  private spreadT = 0;
  private loop: LoopHandle | null = null;

  clear() {
    this.patches = [];
    this.heats = [];
    this.steam = [];
    this.loop?.stop();
    this.loop = null;
  }

  /** a fire burning along the ground */
  addPatch(x: number, y: number, w: number, life: number) {
    // merge with an existing nearby patch
    for (const p of this.patches) {
      if (Math.abs(p.x - x) < (p.w + w) * 0.4 && Math.abs(p.y - y) < 20) {
        p.life = Math.min(p.maxLife + 2, Math.max(p.life, life));
        p.w = Math.min(160, Math.max(p.w, w) + 4);
        return;
      }
    }
    if (G.water.depthAt(x, y - 2) > 0) return;
    if (this.patches.length > 40) this.patches.shift();
    this.patches.push({ x, y, w, life, maxLife: life });
  }

  /** transient heat source for this step (melts ice, dries, boils water) */
  addHeat(x: number, y: number, r: number, power: number) {
    if (this.heats.length < 60) this.heats.push({ x, y, r, power });
  }

  heatAt(x: number, y: number) {
    let h = 0;
    for (const s of this.heats) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.r) h += s.power * (1 - d / s.r);
    }
    return h;
  }

  addSteam(x: number, y: number, r: number, life = 4) {
    for (const s of this.steam) {
      if (Math.hypot(s.x - x, s.y - y) < s.r * 0.6) { s.life = Math.max(s.life, life); s.r = Math.min(220, s.r + r * 0.2); return; }
    }
    if (this.steam.length > 16) this.steam.shift();
    this.steam.push({ x, y, r, life, maxLife: life, vy: -18 });
  }

  steamAt(x: number, y: number) {
    let s = 0;
    for (const c of this.steam) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < c.r) s += (1 - d / c.r) * Math.min(1, c.life / 1.5);
    }
    return Math.min(1, s);
  }

  /** put out fires in a radius (water) */
  extinguishAt(x: number, y: number, r: number) {
    let n = 0;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      if (Math.abs(p.x - x) < r + p.w / 2 && Math.abs(p.y - y) < r + 20) {
        this.patches.splice(i, 1);
        n++;
      }
    }
    if (n > 0) {
      this.addSteam(x, y - 20, 60, 2.5);
      audio.hiss(x, y, 0.4, 0.6);
    }
  }

  update(dt: number) {
    // heats are rebuilt every step: patch heat is submitted here, other systems add theirs during their updates
    let fireAmount = 0;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.life -= dt;
      if (p.life <= 0) {
        G.decals.add('scorch', p.x, p.y, p.w * 0.6, 40);
        this.patches.splice(i, 1);
        continue;
      }
      const k = Math.min(1, p.life / 1.5);
      fireAmount += k * p.w / 60;
      const n = particles.n(dt * p.w * 0.9 * k);
      for (let j = 0; j < n; j++) {
        const c = FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0];
        particles.emit({ kind: PK.Glow, x: p.x + rand(-p.w / 2, p.w / 2), y: p.y - rand(0, 6), vx: rand(-15, 15), vy: rand(-140, -50), life: rand(0.25, 0.55), size: rand(6, 13) * (0.5 + k * 0.5), sizeEnd: 1, color: c, alpha: 0.85, flicker: 0.5 });
      }
      if (chance(dt * 3 * k)) particles.emit({ kind: PK.Smoke, x: p.x + rand(-p.w / 2, p.w / 2), y: p.y - 20, vx: rand(-10, 10), vy: rand(-60, -30), life: rand(1.5, 2.5), size: 10, sizeEnd: 40, color: [30, 28, 30], alpha: 0.45 });
      if (chance(dt * 2 * k)) particles.emit({ kind: PK.Ember, x: p.x + rand(-p.w / 2, p.w / 2), y: p.y - 5, vx: rand(-40, 40), vy: rand(-180, -60), life: rand(0.8, 1.5), size: 2, color: [255, 160, 60], flicker: 0.8 });
      G.lighting.add(p.x, p.y - 20, 110 + p.w, [255, 130, 40], 0.5 * k + 0.2, 0.35);
      this.addHeat(p.x, p.y - 10, p.w / 2 + 40, 0.8 * k);
      // burn whatever stands in it
      for (const e of G.entities) {
        if (e.dead) continue;
        const b = e.bounds();
        if (b.x1 < p.x - p.w / 2 || b.x0 > p.x + p.w / 2 || b.y1 < p.y - 30 || b.y0 > p.y + 6) continue;
        e.ignite(dt * 1.6);
        if (!e.flammable) e.damage(dt * 6, 'fire');
      }
      const pl = G.player;
      if (Math.abs(pl.x - p.x) < p.w / 2 + 10 && Math.abs(pl.y + 38 - p.y) < 30) pl.hurt(dt * 8, 'fire');
    }

    // fire spreads between flammables
    this.spreadT -= dt;
    if (this.spreadT <= 0) {
      this.spreadT = 0.15;
      const burning: Entity[] = [];
      for (const e of G.entities) if (e.burning > 0.2 && !e.dead) { burning.push(e); fireAmount += e.burning * 0.5; }
      for (const src of burning) {
        const sb = src.bounds();
        const c = src.center();
        this.addHeat(c.x, c.y, Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0) * 0.6 + 50, 0.9);
        for (const e of G.entities) {
          if (e === src || e.dead || e.burning > 0 || !e.flammable) continue;
          const b = e.bounds();
          const m = 18;
          if (b.x1 < sb.x0 - m || b.x0 > sb.x1 + m || b.y1 < sb.y0 - m - 30 || b.y0 > sb.y1 + m) continue;
          e.ignite(0.15 * src.burning);
        }
        // drop burning bits on the ground sometimes
        if (src.flammable && chance(0.02)) {
          const gy = G.terrain.groundBelow(c.x, c.y);
          if (gy - c.y < 120) this.addPatch(c.x + rand(-10, 10), gy, 30, rand(2, 4));
        }
      }
    } else {
      for (const e of G.entities) if (e.burning > 0.2 && !e.dead) {
        const c = e.center();
        const sb = e.bounds();
        this.addHeat(c.x, c.y, Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0) * 0.6 + 50, 0.9);
        fireAmount += e.burning * 0.5;
      }
    }

    // boiling water / steam from heat sources over pools
    for (const h of this.heats) {
      if (h.power < 0.5) continue;
      const pool = G.water.poolNear(h.x, h.y, h.r * 0.5);
      if (pool && Math.abs(pool.surfaceAt(h.x) - h.y) < h.r) {
        pool.boil = Math.max(pool.boil, 0.4);
        if (chance(dt * 4)) this.addSteam(h.x, pool.y - 30, 70, 3);
      }
    }

    // steam clouds: drift up, obscure, scald
    for (let i = this.steam.length - 1; i >= 0; i--) {
      const s = this.steam[i];
      s.life -= dt;
      s.y += s.vy * dt;
      s.r += dt * 6;
      if (s.life <= 0) { this.steam.splice(i, 1); continue; }
      const k = Math.min(1, s.life / 1.5);
      if (chance(dt * 14 * k)) {
        const a = rand(0, 6.28), d = rand(0, s.r * 0.7);
        particles.emit({ kind: PK.Steam, x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d * 0.6, vx: rand(-15, 15), vy: rand(-30, -5), life: rand(1.5, 2.5), size: 18, sizeEnd: rand(50, 80), color: [205, 212, 222], alpha: 0.32, drag: 0.4 });
      }
      for (const e of G.entities) {
        if (e.dead) continue;
        const c = e.center();
        if (Math.hypot(c.x - s.x, c.y - s.y) < s.r * 0.8) {
          e.damage(dt * 6 * k, 'steam');
          e.wet = Math.max(e.wet, 0.4);
          if (e.burning > 0) e.extinguish(dt);
        }
      }
      const pl = G.player;
      if (Math.hypot(pl.x - s.x, pl.y - s.y) < s.r * 0.7) pl.hurt(dt * 5 * k, 'steam');
    }

    // ambient fire roar
    if (fireAmount > 0.1) {
      if (!this.loop) this.loop = audio.loop('fire');
      this.loop.set(Math.min(1, fireAmount * 0.15), 1);
    } else if (this.loop) {
      this.loop.stop();
      this.loop = null;
    }
  }

  beginStep() { this.heats.length = 0; }
}
