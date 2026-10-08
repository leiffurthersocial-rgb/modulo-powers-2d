import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, clamp, rand, RGB, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Block } from '../world/blocks';
import { FIRE_COLORS } from '../world/entity';
import { setVel } from '../world/phys';
import { AbilityDef, Effect, Power } from './power';
import { inCone } from './util';

const ORANGE: RGB = [255, 130, 40];
const CORE: RGB = [255, 235, 170];

class Fireball implements Effect {
  life = 2.2;
  vx: number; vy: number;
  px: number; py: number;
  constructor(public x: number, public y: number, dx: number, dy: number) {
    this.vx = dx * 920; this.vy = dy * 920;
    this.px = x; this.py = y;
    audio.fireWhoosh(x, y, 0.6);
  }
  update(dt: number) {
    this.life -= dt;
    this.px = this.x; this.py = this.y;
    this.vy += 260 * dt;
    const sp = Math.hypot(this.vx, this.vy);
    const steps = Math.ceil((sp * dt) / 8);
    for (let s = 0; s < steps; s++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      // water: fizzle
      if (G.water.depthAt(this.x, this.y) > 2) {
        G.fire.addSteam(this.x, this.y - 20, 60, 2.5);
        audio.hiss(this.x, this.y, 0.6, 0.8);
        G.fx.splash(this.x, this.y, 0.4);
        const pool = G.water.poolAt(this.x, this.y);
        if (pool) { pool.boil = 1; pool.disturb(this.x, 120, 40); }
        return false;
      }
      if (G.terrain.solidAt(this.x, this.y)) { this.boom(); return false; }
      for (const e of G.entitiesInRadius(this.x, this.y, 10)) {
        if (e.dead && e.kind !== 'dummy' && e.kind !== 'npc') continue;
        this.boom();
        return false;
      }
    }
    // trail
    for (let i = 0; i < particles.n(4); i++) {
      const c = FIRE_COLORS[(Math.random() * 4) | 0];
      particles.emit({ kind: PK.Glow, x: this.x + rand(-4, 4), y: this.y + rand(-4, 4), vx: -this.vx * 0.1 + rand(-30, 30), vy: -this.vy * 0.1 + rand(-50, 10), life: rand(0.2, 0.45), size: rand(6, 11), sizeEnd: 1, color: c, flicker: 0.4 });
    }
    if (chance(dt * 20)) particles.emit({ kind: PK.Smoke, x: this.x, y: this.y, vx: rand(-10, 10), vy: rand(-40, -10), life: 1, size: 6, sizeEnd: 22, color: [40, 34, 34], alpha: 0.4 });
    G.lighting.add(this.x, this.y, 210, ORANGE, 0.9, 0.4);
    G.fire.addHeat(this.x, this.y, 60, 1);
    if (this.life <= 0) { this.boom(); return false; }
    return true;
  }
  boom() {
    const { x, y } = this;
    G.fx.explosion(x, y, 1);
    audio.explosion(x, y, 0.9);
    G.cam.shake(0.35);
    G.hitstop(0.04);
    G.flash(0.08, [255, 170, 80]);
    G.explode(x, y, 95, 700, 24, 'fire', { ignite: true, selfKnock: true });
    for (const b of G.entitiesInRadius(x, y, 95)) if (b instanceof Block && b.mat === 'ice') b.damage(80, 'fire');
    const gy = G.terrain.groundBelow(x, y - 4);
    if (gy - y < 70) {
      G.fire.addPatch(x, gy, 60, rand(3, 5));
      G.decals.add('scorch', x, gy, 50, 40);
    }
    for (let i = 0; i < 4; i++) G.fire.addHeat(x, y, 140, 2);
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgb(255,200,110)';
    ctx.beginPath(); ctx.arc(this.x, this.y, 9 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(255,255,230)';
    ctx.beginPath(); ctx.arc(this.x, this.y, 5, 0, Math.PI * 2); ctx.fill();
  }
}

class HeatWave implements Effect {
  t = 0;
  constructor(public x: number, public y: number, public r: number) {}
  update(dt: number) {
    this.t += dt;
    const k = this.t / 0.6;
    const rr = this.r * Math.min(1, k * 1.4);
    G.fire.addHeat(this.x, this.y, rr, 3 * (1 - k));
    G.lighting.add(this.x, this.y, rr + 60, ORANGE, 0.7 * (1 - k), 0.2);
    return this.t < 0.6;
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    const k = this.t / 0.6;
    const rr = this.r * Math.min(1, k * 1.4);
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.strokeStyle = 'rgb(255,140,50)';
    ctx.lineWidth = 14 * (1 - k) + 2;
    ctx.beginPath(); ctx.arc(this.x, this.y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export class FirePower extends Power {
  id = 'fire' as const;
  name = 'Fire';
  color: RGB = [255, 120, 40];
  color2: RGB = CORE;
  eye = '#ffd38a';
  tagline = 'Spreads, sticks, burns things down and lights the dark.';
  abilities: AbilityDef[] = [
    { name: 'Fireball', short: 'Fireball', desc: 'Hurl a flickering fireball. It explodes on impact with knockback (yours too: rocket-jump!), ignites flammables and leaves ground fire and scorch marks.', cost: 12, cooldown: 0.38, kind: 'tap', offensive: true , glyph: 'fireball' },
    { name: 'Flamethrower', short: 'Flamethrower', desc: 'Hold for a continuous stream of fire that sticks to the ground and spreads onto crates, straw and trees. Heat shimmer. Boils water.', cost: 22, cooldown: 0, kind: 'hold', offensive: true , glyph: 'flame' },
    { name: 'Rocket Boost', short: 'Rocket', desc: 'Hold to blast flames from hands and feet for thrust. Steer with A/D. Leaves a smoke trail and scorches what is below you.', cost: 22, cooldown: 0, kind: 'hold' , glyph: 'rocket' },
    { name: 'Heat Wave', short: 'Heat Wave', desc: 'Radiate a wave of heat: melts ice, boils pools into scalding steam, dries soaked things, singes and pushes. Grants a brief ember shield.', cost: 28, cooldown: 2.2, kind: 'tap' , glyph: 'heat' },
  ];
  private flame: LoopHandle | null = null;
  private rocketLoop: LoopHandle | null = null;
  emberShield = 0;
  private shimmerT = 0;

  press(i: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.pay(0, this.abilities[0].cost)) return;
      this.startCooldown(0);
      const d = pl.aimDir();
      const h = pl.hand(24);
      pl.setCast('push', 0.25);
      pl.reveal = 0.8;
      // recoil
      if (!pl.grounded) setVel(pl.body, pl.vx - d.x * 120, pl.vy - d.y * 120);
      G.effects.push(new Fireball(h.x, h.y, d.x, d.y));
      for (let k = 0; k < 10; k++) particles.emit({ kind: PK.Glow, x: h.x, y: h.y, vx: d.x * rand(100, 300) + rand(-80, 80), vy: d.y * rand(100, 300) + rand(-80, 80), life: 0.25, size: rand(6, 10), sizeEnd: 1, color: CORE });
      G.lighting.flash(h.x, h.y, 200, ORANGE, 1, 0.15);
      G.makeNoise(h.x, h.y, 300);
    } else if (i === 1) {
      if (!this.drain(1)) { this.deny(1); this.holding[1] = false; return; }
      this.flame?.stop();
      this.flame = audio.loop('flame');
      audio.fireWhoosh(pl.x, pl.y, 0.4);
    } else if (i === 2) {
      if (!this.drain(1)) { this.deny(2); this.holding[2] = false; return; }
      this.rocketLoop?.stop();
      this.rocketLoop = audio.loop('rocket');
      audio.explosion(pl.x, pl.feetY, 0.3);
      G.fx.dust(pl.x, pl.feetY, 6, [80, 70, 70]);
      if (pl.grounded) setVel(pl.body, pl.vx, -300);
    } else if (i === 3) {
      if (!this.pay(3, this.abilities[3].cost)) return;
      this.startCooldown(3);
      this.heatWave();
    }
  }

  private heatWave() {
    const pl = G.player;
    const x = pl.x, y = pl.y - 10, r = 270;
    pl.setCast('raise', 0.4);
    pl.reveal = 1;
    this.emberShield = 4;
    G.effects.push(new HeatWave(x, y, r));
    G.cam.shake(0.25);
    G.cam.punch(0.04);
    audio.fireWhoosh(x, y, 0.8);
    audio.burst({ type: 'lowpass', freq: 200, freqEnd: 1200, vol: 0.5, attack: 0.1, decay: 0.6, brown: true, x, y });
    for (const e of G.entitiesInRadius(x, y, r)) {
      const c = e.center();
      const d = Math.hypot(c.x - x, c.y - y) || 1;
      const k = 1 - d / (r + 30);
      if (e.wet > 0) { e.wet = Math.max(0, e.wet - 1); G.fx.smoke(c.x, c.y, 2, [200, 205, 215]); }
      if (e.frozen > 0) e.frozen = 0;
      if (e instanceof Block && e.mat === 'ice') { e.damage(400, 'fire'); continue; }
      if (e.flammable) e.ignite(0.7 * k + 0.2);
      e.damage(6 * k, 'fire');
      const m = e.mass();
      e.applyImpulse(((c.x - x) / d) * m * 220 * k, -m * 120 * k);
    }
    for (const p of G.water.pools) {
      if (x + r < p.x || x - r > p.x + p.w || Math.abs(p.y - y) > r) continue;
      p.boil = 4;
      p.elec = 0;
      for (let k = 0; k < 3; k++) G.fire.addSteam(Math.max(p.x + 40, Math.min(p.x + p.w - 40, x + rand(-r * 0.6, r * 0.6))), p.y - 40, 90, 6);
      audio.hiss(x, p.y, 0.6, 1.4);
    }
    for (let k = 0; k < particles.n(40); k++) {
      const a = rand(0, Math.PI * 2);
      particles.emit({ kind: PK.Ember, x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20, vx: Math.cos(a) * rand(200, 500), vy: Math.sin(a) * rand(200, 500), life: rand(0.4, 0.9), size: 2.2, color: [255, 170, 70], drag: 2, flicker: 0.6 });
    }
  }

  hold(i: number, dt: number) {
    const pl = G.player;
    if (i === 1) {
      if (!this.drain(this.abilities[1].cost * dt)) { this.holding[1] = false; this.release(1); return; }
      const d = pl.aimDir();
      const h = pl.hand(26);
      pl.setCast('spray', 0.15);
      pl.reveal = 0.6;
      this.flame?.set(0.9, 1 + Math.random() * 0.2);
      const range = 280;
      for (let k = 0; k < particles.n(9); k++) {
        const sp = rand(450, 700);
        const a = Math.atan2(d.y, d.x) + rand(-0.13, 0.13);
        const c = k % 3 === 0 ? CORE : FIRE_COLORS[(Math.random() * 4) | 0];
        particles.emit({ kind: PK.Glow, x: h.x, y: h.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.5), size: rand(4, 7), sizeEnd: rand(16, 26), color: c, drag: 2.2, gravity: -150, collide: true, bounce: 0.1, flicker: 0.3 });
      }
      if (chance(dt * 12)) particles.emit({ kind: PK.Smoke, x: h.x + d.x * 200, y: h.y + d.y * 200 - 20, vx: d.x * 60, vy: -50, life: 1.4, size: 10, sizeEnd: 36, color: [36, 30, 30], alpha: 0.35 });
      const hit = G.raycast(h.x, h.y, d.x, d.y, range, { entities: false });
      const len = hit.dist;
      G.lighting.add(h.x + d.x * len * 0.5, h.y + d.y * len * 0.5, 240, ORANGE, 0.9, 0.5);
      for (let s = 60; s < len; s += 70) G.fire.addHeat(h.x + d.x * s, h.y + d.y * s, 60, 1.4);
      if (hit.terrain) {
        if (chance(dt * 8)) G.fire.addPatch(hit.x, G.terrain.groundBelow(hit.x, hit.y - 6), 50, rand(3, 6));
        if (hit.entity) hit.entity.ignite(dt * 2);
      }
      // ground under the stream catches
      if (chance(dt * 6)) {
        const s = rand(80, len);
        const px = h.x + d.x * s, py = h.y + d.y * s;
        const gy = G.terrain.groundBelow(px, py);
        if (gy - py < 50) G.fire.addPatch(px, gy, 40, rand(2, 4));
      }
      for (const e of G.entities) {
        if (e.dead) continue;
        if (!inCone(e, h.x, h.y, d, len, 0.28)) continue;
        e.ignite(dt * 2.5);
        e.damage(dt * 12, 'fire');
        const m = e.mass();
        e.applyImpulse(d.x * m * 300 * dt, d.y * m * 300 * dt);
        if (e instanceof Block && e.mat === 'ice') e.damage(dt * 120, 'fire');
      }
      // water: boil
      const pool = G.water.poolNear(hit.x, hit.y, 30);
      if (pool && G.water.depthAt(hit.x, hit.y + 4) >= 0 && Math.abs(pool.surfaceAt(hit.x) - hit.y) < 40) {
        pool.boil = 1;
        if (chance(dt * 4)) G.fire.addSteam(hit.x, pool.y - 30, 60, 3);
        if (chance(dt * 4)) audio.hiss(hit.x, hit.y, 0.3, 0.4);
      }
      if (chance(dt * 5)) G.makeNoise(h.x, h.y, 260);
    } else if (i === 2) {
      if (!this.drain(this.abilities[2].cost * dt)) { this.holding[2] = false; this.release(2); return; }
      pl.rocket = true;
      pl.setCast('rocket', 0.15);
      pl.reveal = 0.7;
      const dir = (G.input.isDown('KeyD') ? 1 : 0) - (G.input.isDown('KeyA') ? 1 : 0);
      let vy = pl.vy - 3300 * dt;
      vy = Math.max(vy, -560);
      let vx = pl.vx + dir * 900 * dt;
      vx = clamp(vx, -480, 480);
      setVel(pl.body, vx, vy);
      this.rocketLoop?.set(0.9, 0.8 + Math.random() * 0.3);
      // jets from feet and hands
      const fy = pl.y + 38;
      for (let k = 0; k < particles.n(7); k++) {
        const c = k % 3 === 0 ? CORE : FIRE_COLORS[(Math.random() * 4) | 0];
        const sx = pl.x + rand(-6, 6);
        particles.emit({ kind: PK.Glow, x: sx, y: fy, vx: -vx * 0.3 + rand(-40, 40), vy: rand(350, 600), life: rand(0.15, 0.3), size: rand(5, 9), sizeEnd: 14, color: c, drag: 3, flicker: 0.3 });
      }
      if (chance(dt * 25)) particles.emit({ kind: PK.Smoke, x: pl.x, y: fy + 10, vx: rand(-20, 20), vy: rand(20, 60), life: rand(1.2, 2), size: 8, sizeEnd: 34, color: [40, 36, 36], alpha: 0.45 });
      G.lighting.add(pl.x, fy, 220, ORANGE, 0.9, 0.5);
      G.cam.shake(0.012);
      // scorch what's below
      const below = G.raycast(pl.x, fy, 0, 1, 110, { step: 6 });
      if (below.dist < 110) {
        if (below.entity) below.entity.ignite(dt * 1.5);
        if (below.terrain && chance(dt * 3)) G.fire.addPatch(pl.x, below.y, 30, 1.5);
        if (chance(dt * 6)) G.fx.dust(pl.x, below.y, 2, [80, 70, 70]);
        G.fire.addHeat(pl.x, below.y, 80, 1.5);
      }
    }
  }

  release(i: number) {
    const pl = G.player;
    if (i === 1) { this.flame?.stop(); this.flame = null; }
    if (i === 2) { this.rocketLoop?.stop(); this.rocketLoop = null; pl.rocket = false; }
  }

  unequip() {
    super.unequip();
    this.flame?.stop(); this.flame = null;
    this.rocketLoop?.stop(); this.rocketLoop = null;
    G.player.rocket = false;
  }

  update(dt: number) {
    const pl = G.player;
    this.background(dt);
    if (pl.dead) return;
    this.shimmerT += dt;
    // living flame on the hand
    const h = pl.hand(14);
    if (chance(dt * 18)) particles.emit({ kind: PK.Glow, x: h.x + rand(-2, 2), y: h.y, vy: rand(-80, -30), life: 0.3, size: 4, sizeEnd: 1, color: FIRE_COLORS[(Math.random() * 4) | 0], flicker: 0.5 });
    G.lighting.add(pl.x, pl.y - 14, 110, ORANGE, 0.35, 0.4);
    pl.wet = Math.max(0, pl.wet - dt * 0.3);
  }

  background(dt: number) {
    if (this.emberShield <= 0) return;
    this.emberShield -= dt;
    const pl = G.player;
    for (const e of G.entitiesInRadius(pl.x, pl.y, 40)) { e.ignite(dt * 3); e.damage(dt * 8, 'fire'); }
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    const pl = G.player;
    // heat shimmer along the flamethrower stream
    if (this.holding[1]) {
      const d = pl.aimDir();
      const h = pl.hand(26);
      ctx.strokeStyle = 'rgba(255,160,80,0.12)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        for (let s = 0; s < 260; s += 12) {
          const w = Math.sin(this.shimmerT * 18 + s * 0.08 + k * 2) * (4 + s * 0.06);
          const x = h.x + d.x * s - d.y * w, y = h.y + d.y * s + d.x * w - s * 0.1;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    if (this.emberShield > 0 && !pl.dead) {
      ctx.globalAlpha = Math.min(1, this.emberShield) * 0.35;
      ctx.strokeStyle = 'rgb(255,120,40)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(pl.x, pl.y - 6, 30 + Math.sin(this.shimmerT * 9) * 2, 50, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = 'rgb(255,120,40)';
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.9, y - s * 0.1, x + s * 0.55, y + s * 0.65);
    ctx.quadraticCurveTo(x, y + s * 1.05, x - s * 0.55, y + s * 0.65);
    ctx.quadraticCurveTo(x - s * 0.9, y - s * 0.1, x, y - s);
    ctx.fill();
    ctx.fillStyle = 'rgb(255,230,150)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.38, s * 0.28, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type { Vec };
