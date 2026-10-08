import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, rand, RGB, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Block } from '../world/blocks';
import { setVel } from '../world/phys';
import { AbilityDef, Effect, Power } from './power';
import { inCone } from './util';

const CYAN: RGB = [90, 210, 255];
const DEEP: RGB = [40, 110, 220];
const DROP: RGB = [130, 200, 255];

class TidalWave implements Effect {
  x: number;
  t = 0;
  hit = new Set<number>();
  dead = false;
  constructor(x: number, public y: number, public dir: number) {
    this.x = x;
    audio.burst({ type: 'lowpass', freq: 400, freqEnd: 1500, vol: 0.7, attack: 0.3, decay: 1.4, brown: true, x, y });
    audio.splash(x, y, 1);
  }
  update(dt: number) {
    this.t += dt;
    const speed = 560;
    const nx = this.x + this.dir * speed * dt;
    const gyNow = G.terrain.groundBelow(this.x, this.y - 80);
    const gyNext = G.terrain.groundBelow(nx, this.y - 80);
    // a wall stops the wave
    if (gyNow - gyNext > 90 || G.terrain.solidAt(nx + this.dir * 20, gyNext - 50)) { this.crash(); return false; }
    this.x = nx;
    this.y = gyNext;
    const surf = G.water.poolNear(this.x, this.y, 10);
    const top = surf ? Math.min(this.y, surf.y) : this.y;
    const h = 110 * Math.min(1, this.t * 4) * (this.t > 1.4 ? Math.max(0, (1.8 - this.t) / 0.4) : 1);
    if (surf) surf.disturb(this.x, 260 * dt * 10, 50);
    // crest particles
    for (let i = 0; i < particles.n(10); i++) {
      const yy = top - rand(0, h);
      particles.emit({ kind: PK.Drop, x: this.x - this.dir * rand(0, 70), y: yy, vx: this.dir * rand(300, 600), vy: rand(-250, 50), life: rand(0.35, 0.7), size: rand(2, 4.5), color: chance(0.3) ? [220, 245, 255] : DROP, gravity: 1300, collide: true, alpha: 0.9 });
    }
    if (chance(dt * 30)) particles.emit({ kind: PK.Steam, x: this.x, y: top - h, vx: this.dir * 300, vy: -60, life: 0.8, size: 12, sizeEnd: 30, color: [220, 235, 250], alpha: 0.4 });
    // carry everything in front
    for (const e of G.entities) {
      if (e.dead && e.kind !== 'dummy') continue;
      const b = e.bounds();
      if (b.x1 < this.x - 80 || b.x0 > this.x + 30 || b.y1 < top - h - 10 || b.y0 > this.y + 4) continue;
      const m = e.mass();
      const v = e.bodies[0] ? e.bodies[0].velocity.x * 60 : 0;
      if (this.dir * v < 520) e.applyImpulse(this.dir * m * 1600 * dt, -m * 700 * dt);
      e.soak(1);
      if (e.burning) e.extinguish(1);
      if (e.kind === 'dummy' || e.kind === 'npc') (e as any).knock?.(1.5);
      if (!this.hit.has(e.id)) { this.hit.add(e.id); e.damage(10, 'water'); }
    }
    G.fire.extinguishAt(this.x, this.y, 80);
    for (const p of G.water.pools) if (p.elec > 0 && this.x > p.x - 40 && this.x < p.x + p.w + 40) { /* water carries charge */ }
    if (this.t > 1.8) { this.crash(); return false; }
    return true;
  }
  crash() {
    if (this.dead) return;
    this.dead = true;
    G.fx.splash(this.x, this.y - 40, 1.4);
    G.decals.add('wet', this.x, this.y, 120, 20);
    G.cam.shake(0.2);
  }
  draw(ctx: CanvasRenderingContext2D) {
    const h = 110 * Math.min(1, this.t * 4) * (this.t > 1.4 ? Math.max(0, (1.8 - this.t) / 0.4) : 1);
    if (h < 2) return;
    const x = this.x, y = this.y, d = this.dir;
    const g = ctx.createLinearGradient(0, y - h, 0, y);
    g.addColorStop(0, 'rgba(160,225,255,0.85)');
    g.addColorStop(1, 'rgba(30,90,180,0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - d * 220, y);
    ctx.quadraticCurveTo(x - d * 120, y - h * 0.3, x - d * 30, y - h);
    ctx.quadraticCurveTo(x + d * 20, y - h * 1.05, x + d * 25, y - h * 0.7);
    ctx.quadraticCurveTo(x + d * 5, y - h * 0.65, x + d * 18, y);
    ctx.closePath();
    ctx.fill();
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    const h = 110 * Math.min(1, this.t * 4) * (this.t > 1.4 ? Math.max(0, (1.8 - this.t) / 0.4) : 1);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = 'rgb(180,235,255)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x - this.dir * 120, this.y - h * 0.3);
    ctx.quadraticCurveTo(this.x - this.dir * 30, this.y - h * 1.1, this.x + this.dir * 25, this.y - h * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export class WaterPower extends Power {
  id = 'water' as const;
  name = 'Water';
  color: RGB = CYAN;
  color2: RGB = DEEP;
  eye = '#c8f2ff';
  abilities: AbilityDef[] = [
    { name: 'Water Jet', short: 'Water Jet', desc: 'Hold for a high-pressure stream. Knocks dummies back, pins and pushes crates, soaks everything and puts out fires.', cost: 18, cooldown: 0, kind: 'hold', offensive: true },
    { name: 'Tidal Wave', short: 'Tidal Wave', desc: 'Summon a wave that rolls along the ground in the direction you face, carrying and flinging objects and characters.', cost: 38, cooldown: 2.6, kind: 'tap', offensive: true },
    { name: 'Freeze', short: 'Freeze', desc: 'Freeze water at the aim point into walkable ice bridges, freeze soaked targets solid (hit them hard to shatter), or raise an ice wall.', cost: 18, cooldown: 0.7, kind: 'tap' },
    { name: 'Geyser / Bubble', short: 'Geyser/Bubble', desc: 'Tap: a geyser launches you upward (in water: a swim boost toward your aim). Hold: a bubble shield that floats you, blocks fire and pushes things away.', cost: 14, cooldown: 0.6, kind: 'hold' },
  ];
  private jet: LoopHandle | null = null;
  private iHeld = 0;
  bubble = false;

  press(i: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.drain(1)) { this.deny(0); this.holding[0] = false; return; }
      this.jet?.stop();
      this.jet = audio.loop('jet');
      audio.splash(pl.x, pl.y, 0.3);
    } else if (i === 1) {
      if (!this.pay(1, this.abilities[1].cost)) return;
      this.startCooldown(1);
      const dir = Math.cos(pl.aim) >= 0 ? 1 : -1;
      pl.setCast('push', 0.5);
      pl.reveal = 1;
      const gy = G.terrain.groundBelow(pl.x, pl.y);
      G.effects.push(new TidalWave(pl.x + dir * 30, gy, dir));
      G.cam.shake(0.3);
      G.makeNoise(pl.x, pl.y, 500);
    } else if (i === 2) {
      if (!this.pay(2, this.abilities[2].cost)) return;
      this.startCooldown(2);
      this.freeze();
    } else if (i === 3) {
      this.iHeld = 0;
    }
  }

  private freeze() {
    const pl = G.player;
    const t = G.aimPoint(440);
    pl.setCast('point', 0.3);
    pl.reveal = 0.6;
    const h = pl.hand(20);
    // cold beam
    for (let k = 0; k < particles.n(24); k++) {
      const f = Math.random();
      particles.emit({ kind: PK.Glow, x: h.x + (t.x - h.x) * f, y: h.y + (t.y - h.y) * f, vx: rand(-30, 30), vy: rand(-30, 30), life: rand(0.2, 0.5), size: rand(3, 6), color: [200, 240, 255], alpha: 0.8 });
    }
    G.fx.bolt([{ x: h.x, y: h.y }, { x: t.x, y: t.y }], 1.5, [200, 240, 255], 0.15, false);
    audio.freeze(t.x, t.y);
    let did = false;
    // water surface -> ice bridge
    for (const p of G.water.pools) {
      if (t.x < p.x - 60 || t.x > p.x + p.w + 60) continue;
      if (Math.abs(p.surfaceAt(Math.max(p.x, Math.min(p.x + p.w, t.x))) - t.y) < 140) {
        if (p.freezeAt(t.x, 150)) did = true;
      }
    }
    // soaked / any targets near the point
    for (const e of G.entitiesInRadius(t.x, t.y, 90)) {
      if (e instanceof Block) { if (e.mat === 'ice') e.age = 0; continue; }
      if (e.wet > 0.3) { e.freeze(7); did = true; }
      else { e.freeze(1.2); e.wet = Math.min(1, e.wet + 0.3); }
      if (e.burning) e.extinguish(1);
    }
    G.fire.extinguishAt(t.x, t.y, 80);
    if (!did) {
      // ice wall rising from the ground
      const gy = G.terrain.groundBelow(t.x, t.y - 4);
      if (gy - t.y < 220 && !G.water.depthAt(t.x, gy - 4)) {
        G.addBlock(new Block(t.x - 17, gy - 130, 34, 130, 'icewall', { lifetime: 14, rise: 0.15 }));
        G.fx.dust(t.x, gy, 4, [200, 230, 255]);
      }
    }
    for (let k = 0; k < particles.n(30); k++) {
      const a = rand(0, Math.PI * 2);
      particles.emit({ kind: PK.Steam, x: t.x, y: t.y, vx: Math.cos(a) * rand(40, 140), vy: Math.sin(a) * rand(40, 140), life: rand(0.6, 1.2), size: 6, sizeEnd: 24, color: [220, 240, 255], alpha: 0.35, drag: 2 });
    }
    G.fx.ring(t.x, t.y, 8, 90, [200, 240, 255], 0.35);
    G.lighting.flash(t.x, t.y, 200, [180, 230, 255], 0.8, 0.3);
  }

  hold(i: number, dt: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.drain(this.abilities[0].cost * dt)) { this.holding[0] = false; this.release(0); return; }
      const d = pl.aimDir();
      const h = pl.hand(26);
      pl.setCast('spray', 0.15);
      pl.reveal = 0.5;
      this.jet?.set(0.9, 0.9 + Math.random() * 0.2);
      for (let k = 0; k < particles.n(8); k++) {
        const a = Math.atan2(d.y, d.x) + rand(-0.05, 0.05);
        const sp = rand(950, 1150);
        particles.emit({ kind: PK.Drop, x: h.x, y: h.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.5), size: rand(2, 3.4), color: chance(0.3) ? [220, 245, 255] : DROP, gravity: 600, collide: true, alpha: 0.95 });
      }
      const hit = G.raycast(h.x, h.y, d.x, d.y, 380, { step: 6 });
      // pressure on the target
      if (hit.entity) {
        const e = hit.entity;
        const m = e.mass();
        e.applyImpulse(d.x * Math.max(m, 1) * 2400 * dt, d.y * Math.max(m, 1) * 2400 * dt - m * 200 * dt, hit.x, hit.y);
        e.soak(dt * 3);
        if (e.kind === 'dummy' || e.kind === 'npc') { e.damage(dt * 4, 'water'); (e as any).startle = 0.4; }
        if (e instanceof Block && e.mat === 'ice') e.age = 0;
      }
      // splash at impact
      if (hit.dist < 380) {
        for (let k = 0; k < particles.n(3); k++) particles.emit({ kind: PK.Drop, x: hit.x - d.x * 4, y: hit.y - d.y * 4, vx: -d.x * rand(80, 250) + rand(-200, 200), vy: -rand(100, 300), life: 0.4, size: rand(1.5, 2.5), color: DROP, gravity: 1200, collide: true });
        if (chance(dt * 4)) G.decals.add('wet', hit.x, G.terrain.groundBelow(hit.x, hit.y - 4), 30, 10);
        G.fire.extinguishAt(hit.x, hit.y, 60);
        for (const e of G.entitiesInRadius(hit.x, hit.y, 30)) e.soak(dt * 2);
        const pool = G.water.poolNear(hit.x, hit.y, 10);
        if (pool) pool.disturb(hit.x, 300 * dt, 30);
      }
      // anything in the stream gets wet
      for (const e of G.entities) if (!e.dead && inCone(e, h.x, h.y, d, hit.dist, 0.12)) { e.soak(dt); if (e.burning) e.extinguish(dt * 3); }
      // recoil
      if (!pl.grounded) setVel(pl.body, pl.vx - d.x * 900 * dt, pl.vy - d.y * 900 * dt);
      G.lighting.add(h.x + d.x * 60, h.y + d.y * 60, 120, CYAN, 0.25, 0);
    } else if (i === 3) {
      this.iHeld += dt;
      if (this.iHeld > 0.18) {
        if (!this.bubble) {
          if (!this.pay(3, 5, false)) { this.holding[3] = false; return; }
          this.bubble = true;
          audio.splash(pl.x, pl.y, 0.4);
          audio.tone({ type: 'sine', freq: 300, freqEnd: 700, vol: 0.15, decay: 0.3, x: pl.x, y: pl.y });
        }
        if (!this.drain(this.abilities[3].cost * dt)) { this.holding[3] = false; this.release(3); return; }
        pl.setCast('guard', 0.15);
        // floaty
        if (!pl.grounded && pl.vy > 60) setVel(pl.body, pl.vx, pl.vy - 1300 * dt);
        pl.burning = 0;
        pl.wet = 1;
        G.fire.extinguishAt(pl.x, pl.y + 20, 60);
        for (const e of G.entitiesInRadius(pl.x, pl.y, 52)) {
          const c = e.center();
          const dx = c.x - pl.x, dy = c.y - pl.y, d = Math.hypot(dx, dy) || 1;
          const m = e.mass();
          e.applyImpulse((dx / d) * m * 1400 * dt, (dy / d) * m * 1400 * dt);
          if (e.burning) e.extinguish(1);
          e.soak(dt);
        }
      }
    }
  }

  release(i: number) {
    const pl = G.player;
    if (i === 0) { this.jet?.stop(); this.jet = null; }
    if (i === 3) {
      if (this.bubble) {
        this.bubble = false;
        this.startCooldown(3, 0.5);
        audio.splash(pl.x, pl.y, 0.5);
        G.fx.splash(pl.x, pl.y, 0.6);
      } else if (this.iHeld <= 0.18) this.geyser();
    }
  }

  private geyser() {
    const pl = G.player;
    if (!this.pay(3, this.abilities[3].cost)) return;
    this.startCooldown(3);
    pl.reveal = 0.8;
    if (pl.swimming) {
      const d = pl.aimDir();
      setVel(pl.body, d.x * 900, d.y * 900);
      pl.locked = 0.15;
      pl.setCast('dash', 0.3);
      G.fx.splash(pl.x, pl.y, 1);
      audio.whoosh(pl.x, pl.y, 0.3, 0.4, 300, 1500);
      const pool = G.water.poolAt(pl.x, pl.y);
      pool?.disturb(pl.x, -200, 60);
      return;
    }
    const gy = G.terrain.groundBelow(pl.x, pl.y);
    pl.launch(pl.vx, -980);
    pl.setCast('raise', 0.4);
    audio.splash(pl.x, gy, 0.9);
    audio.burst({ type: 'bandpass', freq: 600, freqEnd: 2000, q: 0.5, vol: 0.5, attack: 0.02, decay: 0.5, x: pl.x, y: gy });
    G.cam.shake(0.18);
    for (let k = 0; k < particles.n(60); k++) {
      particles.emit({ kind: PK.Drop, x: pl.x + rand(-14, 14), y: gy - rand(0, 30), vx: rand(-120, 120), vy: -rand(500, 1100), life: rand(0.5, 1.1), size: rand(2, 4.5), color: chance(0.3) ? [220, 245, 255] : DROP, gravity: 1500, collide: true });
    }
    for (const e of G.entitiesInRadius(pl.x, gy - 20, 60)) { e.soak(1); e.applyImpulse(0, -e.mass() * 500); }
    G.fire.extinguishAt(pl.x, gy, 70);
    G.decals.add('wet', pl.x, gy, 50, 15);
  }

  unequip() {
    super.unequip();
    this.jet?.stop(); this.jet = null;
    this.bubble = false;
  }

  update(dt: number) {
    const pl = G.player;
    if (pl.dead) return;
    if (chance(dt * 6)) particles.emit({ kind: PK.Drop, x: pl.x + rand(-10, 10), y: pl.y + rand(-30, 10), vx: rand(-20, 20), vy: 40, life: 0.5, size: 1.5, color: DROP, gravity: 600, alpha: 0.7 });
    G.lighting.add(pl.x, pl.y - 14, 90, CYAN, 0.22, 0);
    // swimming is faster with the water power
    if (pl.swimming && (G.input.isDown('KeyA') || G.input.isDown('KeyD'))) {
      const dir = (G.input.isDown('KeyD') ? 1 : 0) - (G.input.isDown('KeyA') ? 1 : 0);
      setVel(pl.body, pl.vx + dir * 400 * dt, pl.vy);
    }
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    if (!this.bubble) return;
    const pl = G.player;
    const t = G.time;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = 'rgb(40,120,200)';
    ctx.beginPath(); ctx.ellipse(pl.x, pl.y - 4, 44 + Math.sin(t * 6) * 2, 52 + Math.cos(t * 5) * 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = 'rgb(170,230,255)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(pl.x - 16, pl.y - 30, 7, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  reticle(): Vec | null {
    return G.aimPoint(440);
  }

  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = 'rgb(90,210,255)';
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.8, y + s * 0.05, x + s * 0.6, y + s * 0.5);
    ctx.arc(x, y + s * 0.4, s * 0.6, 0.15, Math.PI - 0.15);
    ctx.quadraticCurveTo(x - s * 0.8, y + s * 0.05, x, y - s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(x - s * 0.25, y + s * 0.35, s * 0.15, 0, Math.PI * 2); ctx.fill();
  }
}
