import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, rand, RGB, smooth, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Stickman } from '../world/stickman';
import { Body, CAT, setVel } from '../world/phys';
import { AbilityDef, Effect, Power } from './power';
import { freeSpotNear } from './util';

const VIOLET: RGB = [170, 110, 255];
const INK: RGB = [24, 10, 40];

function wisps(x: number, y: number, n: number, spread = 20) {
  for (let i = 0; i < particles.n(n); i++) {
    particles.emit({ kind: PK.Wisp, x: x + rand(-spread, spread), y: y + rand(-spread * 1.6, spread * 1.6), vx: rand(-60, 60), vy: rand(-120, -20), life: rand(0.6, 1.2), size: rand(6, 12), sizeEnd: rand(18, 30), color: INK, alpha: 0.85, drag: 1.5 });
    if (chance(0.4)) particles.emit({ kind: PK.Glow, x: x + rand(-spread, spread), y: y + rand(-spread, spread), vx: rand(-40, 40), vy: rand(-80, 0), life: rand(0.4, 0.8), size: rand(3, 6), color: VIOLET, alpha: 0.7 });
  }
}

/** spikes erupting one after another along the ground */
class ShadowStrike implements Effect {
  t = 0;
  spikes: { x: number; y: number; t: number; h: number; ang: number; done: boolean }[] = [];
  hit = new Set<number>();
  constructor(x: number, y: number, dx: number, dy: number) {
    // follow the ground when aiming roughly horizontally, otherwise lash toward the aim
    const along = Math.abs(dy) < 0.6;
    const n = 12;
    for (let i = 0; i < n; i++) {
      let sx = x + dx * (30 + i * 30), sy = y + dy * (30 + i * 30);
      if (along) sy = G.terrain.groundBelow(sx, y - 40);
      if (G.terrain.solidAt(sx, sy - 6)) break;
      this.spikes.push({ x: sx, y: sy, t: -i * 0.035, h: rand(46, 74) * (0.7 + (i / n) * 0.6), ang: along ? rand(-0.25, 0.25) + dx * 0.25 : Math.atan2(dy, dx) + Math.PI / 2, done: false });
    }
    G.lighting.dim = Math.max(G.lighting.dim, 0.75);
    audio.shadowWhoosh(x, y, 0.6, false);
  }
  update(dt: number) {
    this.t += dt;
    let alive = false;
    for (const s of this.spikes) {
      s.t += dt;
      if (s.t < 0.5) alive = true;
      if (s.t > 0 && !s.done) {
        s.done = true;
        wisps(s.x, s.y - 10, 4, 10);
        audio.burst({ type: 'bandpass', freq: 300 + rand(0, 200), q: 3, vol: 0.18, decay: 0.08, x: s.x, y: s.y, key: 'spike' });
        for (const e of G.entitiesInRadius(s.x, s.y - s.h * 0.5, 34)) {
          if (this.hit.has(e.id)) continue;
          this.hit.add(e.id);
          e.damage(15, 'shadow', s.x, s.y);
          const m = e.mass();
          e.applyImpulse(Math.sin(s.ang) * m * 200, -m * 620, s.x, s.y);
          if (e instanceof Stickman) e.knock(1.6);
          G.hitstop(0.02);
        }
      }
    }
    G.lighting.dim = Math.max(G.lighting.dim, 0.5);
    return alive;
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const s of this.spikes) {
      if (s.t <= 0) continue;
      const grow = Math.min(1, s.t / 0.07);
      const fade = s.t > 0.3 ? Math.max(0, 1 - (s.t - 0.3) / 0.2) : 1;
      const h = s.h * grow * (0.4 + 0.6 * fade);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#0a0412';
      ctx.beginPath();
      ctx.moveTo(-9, 2);
      ctx.quadraticCurveTo(-4, -h * 0.5, 0, -h);
      ctx.quadraticCurveTo(4, -h * 0.5, 9, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    for (const s of this.spikes) {
      if (s.t <= 0 || s.t > 0.5) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.globalAlpha = 0.6 * (1 - s.t / 0.5);
      ctx.strokeStyle = 'rgb(170,110,255)';
      ctx.lineWidth = 2;
      const h = s.h * Math.min(1, s.t / 0.07);
      ctx.beginPath();
      ctx.moveTo(-9, 2); ctx.quadraticCurveTo(-4, -h * 0.5, 0, -h); ctx.quadraticCurveTo(4, -h * 0.5, 9, 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

export class ShadowPower extends Power {
  id = 'shadow' as const;
  name = 'Shadow';
  color: RGB = VIOLET;
  color2: RGB = INK;
  eye = '#d9b8ff';
  abilities: AbilityDef[] = [
    { name: 'Shadow Strike', short: 'Strike', desc: 'Ink-black spikes lash out along the ground (or toward your aim), impaling and throwing targets while the light around dims.', cost: 14, cooldown: 0.5, kind: 'tap', offensive: true },
    { name: 'Invisibility', short: 'Invisible', desc: 'Toggle: fade to a faint heat-haze outline. NPCs lose track of you. Attacking or moving fast partially reveals you. Drains shadow energy.', cost: 6, cooldown: 0.4, kind: 'toggle' },
    { name: 'Shadow Step', short: 'Shadow Step', desc: 'Dissolve into wisps and re-form at the aim point (range and line of sight limited, needs room to stand). Leaves you briefly disoriented.', cost: 20, cooldown: 0.5, kind: 'tap' },
    { name: 'Phase', short: 'Phase', desc: 'Hold to become intangible and walk through walls and floors (W/S move vertically). Muffled, desaturated. If shadow energy runs out inside a wall you are violently ejected.', cost: 13, cooldown: 0.6, kind: 'hold' },
  ];
  private drone: LoopHandle | null = null;
  private phaseIntensity = 0;
  lightLevel = 0;

  energyPool(): 'main' | 'shadow' { return 'shadow'; }

  /** shadow energy regen / drain depends on how lit the player is */
  regen(dt: number) {
    const pl = G.player;
    const light = G.lighting.lightAt(pl.x, pl.y - 20);
    this.lightLevel = light;
    const equipped = G.power === this;
    let rate: number;
    if (light < 0.45) rate = 30;
    else if (light < 0.9) rate = 9 * (1 - (light - 0.45) / 0.45) + 2;
    else rate = equipped ? -Math.min(25, (light - 0.9) * 30) : 0;
    if (!equipped) rate = Math.max(rate, 6);
    if (this.toggled[1] || pl.phasing) rate = Math.min(rate, 0);
    G.shadowEnergy = Math.max(0, Math.min(G.maxShadowEnergy, G.shadowEnergy + rate * dt));
  }

  press(i: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.pay(0, this.abilities[0].cost)) return;
      this.startCooldown(0);
      const d = pl.aimDir();
      pl.setCast('push', 0.3);
      pl.reveal = 0.9;
      G.effects.push(new ShadowStrike(pl.x, pl.feetY, d.x, d.y));
      wisps(pl.x, pl.feetY - 10, 6, 14);
      G.cam.shake(0.18);
      G.makeNoise(pl.x, pl.y, 280);
    } else if (i === 1) {
      if (this.toggled[1]) { this.setInvisible(false); return; }
      if (!this.pay(1, 4)) return;
      this.setInvisible(true);
    } else if (i === 2) {
      if (!this.ready(2) || G.shadowEnergy < this.abilities[2].cost && !G.infinite) { this.deny(2); return; }
      const t = this.stepTarget();
      if (!t) { this.deny(2); G.showToast('No room to re-form there'); return; }
      this.pay(2, this.abilities[2].cost);
      this.startCooldown(2);
      this.step(t);
    } else if (i === 3) {
      if (!this.drain(2)) { this.deny(3); this.holding[3] = false; return; }
      this.setPhase(true);
    }
  }

  private setInvisible(on: boolean) {
    const pl = G.player;
    this.toggled[1] = on;
    pl.invisible = on;
    if (on) {
      audio.shadowWhoosh(pl.x, pl.y, 0.4, false);
      wisps(pl.x, pl.y, 10);
      for (const e of G.entities) if (e instanceof Stickman && e.role === 'npc' && !e.dead && (e.aiState === 'alert' || e.aiState === 'flee')) { e.aiState = 'lost'; e.aiTimer = 2.5; e.setMark('?'); }
    } else {
      audio.shadowWhoosh(pl.x, pl.y, 0.3, true);
      this.startCooldown(1);
    }
  }

  private stepTarget(): Vec | null {
    const pl = G.player;
    let t: Vec;
    if (pl.mouseAiming) {
      const w = G.cam.toWorld(G.input.pointerX, G.input.pointerY);
      const dx = w.x - pl.x, dy = w.y - pl.y, d = Math.hypot(dx, dy) || 1;
      const r = Math.min(400, d);
      const h = G.raycast(pl.x, pl.y - 14, dx / d, dy / d, r, { entities: false });
      t = { x: h.x - (dx / d) * 14, y: h.y - (dy / d) * 14 };
    } else t = G.aimPoint(400);
    return freeSpotNear(t.x, t.y - 20, 60);
  }

  private step(t: Vec) {
    const pl = G.player;
    const sx = pl.x, sy = pl.y;
    wisps(sx, sy, 22);
    audio.shadowWhoosh(sx, sy, 0.6, false);
    Body.setPosition(pl.body, t);
    const p = pl.body.plugin as any; p.px = t.x; p.py = t.y;
    setVel(pl.body, pl.vx * 0.3, Math.min(0, pl.vy) * 0.3);
    wisps(t.x, t.y, 22);
    audio.shadowWhoosh(t.x, t.y, 0.5, true);
    pl.setCast('phase', 0.35);
    pl.reveal = 0.5;
    G.aberration = 1;
    G.cam.punch(0.07);
    G.lighting.dim = Math.max(G.lighting.dim, 0.5);
    // ink trail
    for (let k = 0; k <= 10; k++) {
      const f = k / 10;
      particles.emit({ kind: PK.Wisp, x: sx + (t.x - sx) * f, y: sy + (t.y - sy) * f, vx: rand(-20, 20), vy: rand(-30, 0), life: 0.5, size: 6, sizeEnd: 16, color: INK, alpha: 0.6 });
    }
    // dummies near the arrival point flinch
    for (const e of G.entitiesInRadius(t.x, t.y, 120)) if (e instanceof Stickman) e.startle = 0.8;
  }

  private setPhase(on: boolean) {
    const pl = G.player;
    if (on === pl.phasing) return;
    pl.phasing = on;
    pl.body.collisionFilter.mask = on ? 0 : 0xffff;
    pl.body.collisionFilter.category = CAT.PLAYER;
    if (on) {
      this.drone?.stop();
      this.drone = audio.loop('drone');
      audio.shadowWhoosh(pl.x, pl.y, 0.5, false);
      wisps(pl.x, pl.y, 10);
    } else {
      this.drone?.stop();
      this.drone = null;
      audio.shadowWhoosh(pl.x, pl.y, 0.4, true);
      this.startCooldown(3);
    }
  }

  hold(i: number, dt: number) {
    if (i !== 3) return;
    const pl = G.player;
    const inside = pl.insideSolid();
    const cost = this.abilities[3].cost * (inside ? 1.7 : 1) * dt;
    if (!this.drain(cost) || (G.shadowEnergy <= 0 && !G.infinite)) {
      this.holding[3] = false;
      this.release(3, true);
      return;
    }
    pl.setCast('phase', 0.15);
    this.drone?.set(0.6 + (inside ? 0.4 : 0), inside ? 0.8 : 1);
    if (chance(dt * 20)) wisps(pl.x, pl.y, 1, 12);
  }

  release(i: number, forced = false) {
    if (i !== 3) return;
    const pl = G.player;
    if (!pl.phasing) return;
    if (pl.insideSolid()) {
      if (!forced && (G.shadowEnergy > 1 || G.infinite)) {
        // can't re-materialise inside a wall: keep phasing until clear
        this.holding[3] = true;
        if (G.toast.t < 0.3) G.showToast('Still inside! Get out before your shadow runs dry');
        return;
      }
      this.eject();
    }
    this.setPhase(false);
  }

  /** violent ejection when energy runs out inside geometry */
  private eject() {
    const pl = G.player;
    const spot = freeSpotNear(pl.x, pl.y, 900) ?? pl.spawn;
    const dx = spot.x - pl.x, dy = spot.y - pl.y, d = Math.hypot(dx, dy) || 1;
    wisps(pl.x, pl.y, 20);
    Body.setPosition(pl.body, spot);
    const p = pl.body.plugin as any; p.px = spot.x; p.py = spot.y;
    pl.phasing = false;
    pl.body.collisionFilter.mask = 0xffff;
    setVel(pl.body, (dx / d) * 260, -320);
    pl.hurt(30, 'blunt');
    G.cam.shake(0.8);
    G.flash(0.45, [255, 40, 80]);
    G.hitstop(0.12);
    G.aberration = 1;
    audio.explosion(spot.x, spot.y, 0.6);
    audio.shadowWhoosh(spot.x, spot.y, 0.8, true);
    G.fx.ring(spot.x, spot.y, 10, 120, [255, 60, 120], 0.4);
    G.showToast('EJECTED: your shadow ran dry inside the wall');
  }

  unequip() {
    // phasing must end safely when switching away
    const pl = G.player;
    if (pl.phasing) {
      if (pl.insideSolid()) this.eject();
      else this.setPhase(false);
    }
    this.holding[3] = false;
    super.unequip();
    if (this.toggled[1]) this.setInvisible(false);
    this.drone?.stop();
    this.drone = null;
  }

  update(dt: number) {
    const pl = G.player;
    if (pl.dead) return;
    // invisibility drain (more when moving fast)
    if (this.toggled[1]) {
      const moving = Math.abs(pl.vx) > 200 ? 6 : 0;
      if (!this.drain((this.abilities[1].cost + moving) * dt)) this.setInvisible(false);
      if (G.shadowEnergy <= 0 && !G.infinite) this.setInvisible(false);
    }
    if (pl.phasing && !G.input.isDown('KeyI')) this.hold(3, dt);
    // phase look
    this.phaseIntensity = smooth(this.phaseIntensity, pl.phasing ? (pl.insideSolid() ? 1 : 0.7) : 0, 6, dt);
    if (chance(dt * 4)) particles.emit({ kind: PK.Wisp, x: pl.x + rand(-8, 8), y: pl.feetY - rand(0, 10), vx: rand(-15, 15), vy: rand(-40, -10), life: 0.9, size: 5, sizeEnd: 14, color: INK, alpha: 0.5 });
  }

  background(dt: number) {
    this.phaseIntensity = smooth(this.phaseIntensity, 0, 6, dt);
  }

  get phaseLook() { return this.phaseIntensity; }

  drawGlow(ctx: CanvasRenderingContext2D) {
    const pl = G.player;
    if (pl.dead || pl.invisible) return;
    // eerie under-glow
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'rgb(140,80,255)';
    ctx.beginPath(); ctx.ellipse(pl.x, pl.feetY, 26, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  reticle(): Vec | null {
    return this.stepTarget();
  }

  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = 'rgb(170,110,255)';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(12,6,24)';
    ctx.beginPath();
    ctx.arc(x + s * 0.35, y - s * 0.15, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(220,190,255)';
    ctx.fillRect(x - s * 0.55, y - s * 0.1, s * 0.22, s * 0.16);
  }
}
