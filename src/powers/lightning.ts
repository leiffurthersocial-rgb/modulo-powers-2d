import { G } from '../ctx';
import { audio, LoopHandle } from '../core/audio';
import { chance, clamp, rand, RGB, Vec } from '../core/math';
import { jagged } from '../render/fx';
import { particles, PK } from '../render/particles';
import { Block } from '../world/blocks';
import { Entity } from '../world/entity';
import { Generator, Lamp } from '../world/machines';
import { Body, setVel } from '../world/phys';
import { AbilityDef, Effect, Power } from './power';
import { entitiesNearSegment } from './util';

const PALE: RGB = [200, 225, 255];
const BLUE: RGB = [90, 150, 255];

/** draw a forking bolt from a to b, returns nothing; branches are cosmetic */
function forkBolt(x0: number, y0: number, x1: number, y1: number, width: number, life: number, rough = 18) {
  const pts = jagged(x0, y0, x1, y1, rough, 12);
  G.fx.bolt(pts, width, BLUE, life);
  const branches = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < branches; i++) {
    const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
    if (!p) continue;
    const a = Math.atan2(y1 - y0, x1 - x0) + rand(-0.9, 0.9);
    const len = rand(40, 130);
    G.fx.bolt(jagged(p.x, p.y, p.x + Math.cos(a) * len, p.y + Math.sin(a) * len, rough * 0.6, 10), width * 0.45, BLUE, life * 0.8);
  }
}

function zapEntity(e: Entity, dirX: number, dirY: number, dmg: number, shock: number) {
  e.electrocute(shock, dmg);
  const m = e.mass();
  e.applyImpulse(dirX * m * 260, (dirY - 0.4) * m * 260);
  const c = e.center();
  G.fx.sparks(c.x, c.y, 10, [200, 230, 255], 500);
  if (e instanceof Generator) e.power(14);
  if (e instanceof Lamp) e.electrocute(1, 0);
}

function electrifyNearbyWater(x: number, y: number, r: number, seconds: number) {
  for (const p of G.water.pools) {
    if (x + r < p.x || x - r > p.x + p.w) continue;
    if (y > p.y - r && y < p.y + p.h + 10) p.electrify(seconds);
  }
}

/** chain from a point to nearby conductive / wet targets */
function chain(x: number, y: number, hit: Set<Entity>, depth: number) {
  if (depth <= 0) return;
  let best: Entity | null = null, bd = 230;
  for (const e of G.entities) {
    if (hit.has(e) || e.dead) continue;
    if (!(e.conductive || e.wet > 0.3)) continue;
    const c = e.center();
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd && G.terrain.rayGrid(x, y, (c.x - x) / d, (c.y - y) / d, d - 8, 8) < 0) { bd = d; best = e; }
  }
  if (!best) return;
  hit.add(best);
  const c = best.center();
  forkBolt(x, y, c.x, c.y, 1.6, 0.18, 12);
  zapEntity(best, (c.x - x) / bd, (c.y - y) / bd, 12, 0.7);
  electrifyNearbyWater(c.x, c.y, 20, 1.5);
  chain(c.x, c.y, hit, depth - 1);
}

/** the actual dash: a 0.12 s high-speed run along a jagged path */
class DashRun implements Effect {
  t = 0;
  sx: number; sy: number;
  hit = new Set<Entity>();
  dist = 0;
  static RANGE = 300;
  static DUR = 0.12;
  constructor(public dx: number, public dy: number) {
    const pl = G.player;
    this.sx = pl.x; this.sy = pl.y;
    pl.setCast('dash', 0.3);
    pl.locked = DashRun.DUR + 0.04;
    pl.reveal = 1;
    pl.dashing = true;
    // intangible to props/characters while dashing (still blocked by terrain)
    pl.body.collisionFilter.mask = 0x0001 | 0x0020 | 0x0040;
    audio.zap(pl.x, pl.y, 1);
    audio.whoosh(pl.x, pl.y, 0.2, 0.35, 3000, 600);
    G.cam.punch(0.05);
    G.cam.shake(0.15);
    G.flash(0.08, [170, 200, 255]);
    G.slowPulse(0.12);
  }
  update(dt: number) {
    const pl = G.player;
    if (pl.dead) return false;
    this.t += dt;
    const step = (DashRun.RANGE / DashRun.DUR) * dt;
    const T = G.terrain;
    let moved = 0;
    // move in small increments, stop at terrain (feet stay above the floor)
    for (let s = 0; s < step; s += 4) {
      const nx = pl.x + this.dx * 4, ny = pl.y + this.dy * 4;
      if (T.coverage(nx - 10, ny - 34, nx + 10, ny + 30) > 0) { this.t = DashRun.DUR; break; }
      Body.setPosition(pl.body, { x: nx, y: ny });
      moved += 4;
    }
    this.dist += moved;
    setVel(pl.body, 0, 0);
    pl.addAfterimage(Math.random() < 0.5 ? PALE : BLUE);
    for (let k = 0; k < 3; k++) particles.emit({ kind: PK.Spark, x: pl.x + rand(-8, 8), y: pl.y + rand(-30, 30), vx: -this.dx * rand(100, 300), vy: rand(-80, 80), life: 0.25, size: 1.4, color: PALE });
    G.lighting.add(pl.x, pl.y - 10, 160, BLUE, 0.8, 0.4);
    for (const e of entitiesNearSegment(pl.x - this.dx * moved, pl.y - this.dy * moved, pl.x, pl.y, 32)) {
      if (this.hit.has(e)) continue;
      this.hit.add(e);
      zapEntity(e, this.dx, this.dy, 22, 0.8);
      G.hitstop(0.02);
    }
    if (this.t >= DashRun.DUR) { this.end(); return false; }
    return true;
  }
  end() {
    const pl = G.player;
    pl.dashing = false;
    pl.body.collisionFilter.mask = 0xffff;
    // keep some momentum, small hop if dashing upward
    setVel(pl.body, this.dx * 360, this.dy < -0.2 ? this.dy * 420 : Math.min(0, this.dy * 200));
    forkBolt(this.sx, this.sy - 10, pl.x, pl.y - 10, 2.2, 0.28, 22);
    electrifyNearbyWater(pl.x, pl.y + 30, 10, 1.5);
    audio.zap(pl.x, pl.y, 0.7);
  }
  stop() { if (G.player.dashing) this.end(); }
}

class SkyStrike implements Effect {
  t = 0;
  fired = false;
  constructor(public x: number, public y: number) {
    audio.burst({ type: 'highpass', freq: 2000, freqEnd: 6000, vol: 0.25, attack: 0.6, decay: 0.1, x, y });
    audio.tone({ type: 'sawtooth', freq: 60, freqEnd: 240, vol: 0.12, attack: 0.65, decay: 0.05, x, y, filter: 1500 });
  }
  update(dt: number) {
    this.t += dt;
    const { x, y } = this;
    if (!this.fired) {
      G.lighting.dim = Math.max(G.lighting.dim, this.t);
      if (chance(dt * 40)) G.fx.arc(x + rand(-50, 50), y - rand(0, 10), x + rand(-60, 60), y - rand(10, 80), BLUE, 1.2, 0.08, 8);
      if (chance(dt * 30)) particles.emit({ kind: PK.Glow, x: x + rand(-40, 40), y: y - rand(0, 4), vy: rand(-200, -60), life: 0.4, size: 4, color: BLUE });
      G.lighting.add(x, y - 30, 120 + this.t * 100, BLUE, 0.4 + this.t, 0.6);
      if (this.t > 0.7) this.fire();
      return true;
    }
    return this.t < 1.2;
  }
  fire() {
    this.fired = true;
    const { x, y } = this;
    const top = G.cam.view().y0 - 200;
    const pts = jagged(x + rand(-80, 80), top, x, y, 34, 22);
    G.fx.bolt(pts, 7, BLUE, 0.45);
    G.fx.bolt(jagged(x + rand(-40, 40), top, x, y, 26, 20), 3, PALE, 0.3);
    for (let i = 0; i < 4; i++) {
      const p = pts[Math.floor(rand(2, pts.length - 2))];
      G.fx.bolt(jagged(p.x, p.y, p.x + rand(-160, 160), p.y + rand(30, 160), 18, 12), 2, BLUE, 0.35);
    }
    G.flash(0.85, [210, 230, 255]);
    G.lighting.flash(x, y - 80, 900, [180, 210, 255], 2.2, 0.9);
    G.cam.shake(0.85);
    G.cam.punch(0.08);
    G.hitstop(0.09);
    audio.thunder(x, y, 0.05, 1.6);
    audio.explosion(x, y, 1);
    G.explode(x, y, 160, 900, 45, 'elec', { elec: true, ignite: true, selfKnock: true });
    for (const e of G.entitiesInRadius(x, y, 160)) if (e instanceof Generator) e.power(18);
    electrifyNearbyWater(x, y, 160, 3);
    G.decals.add('crater', x, y, 90, 60);
    G.decals.add('scorch', x, y, 130, 60);
    G.fx.explosion(x, y, 1.1, [230, 240, 255], [140, 190, 255]);
    G.fx.ring(x, y, 20, 260, [180, 220, 255], 0.5);
    G.fx.dust(x, y, 16);
    for (let i = 0; i < particles.n(40); i++) {
      particles.emit({ kind: PK.Debris, x: x + rand(-30, 30), y: y - 4, vx: rand(-400, 400), vy: rand(-700, -200), life: rand(0.8, 1.6), size: rand(2, 6), color: [70, 66, 62], gravity: 1500, collide: true, vrot: rand(-10, 10) });
    }
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    if (this.fired) return;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 40);
    ctx.strokeStyle = 'rgb(140,200,255)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 60 * (1 - this.t * 0.6), 12 * (1 - this.t * 0.6), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export class LightningPower extends Power {
  id = 'lightning' as const;
  name = 'Lightning';
  color: RGB = [110, 170, 255];
  color2: RGB = BLUE;
  eye = '#d6e8ff';
  tagline = 'Fast, blinding, chains through anything that conducts.';
  abilities: AbilityDef[] = [
    { name: 'Lightning Bolt', short: 'Bolt', desc: 'Instant forking bolt toward your aim. Chains to metal, wet targets and conductors, ignites straw, electrifies water. Thunder follows.', cost: 10, cooldown: 0.3, kind: 'tap', offensive: true , glyph: 'bolt' },
    { name: 'Sky Strike', short: 'Sky Strike', desc: 'Mark a spot. The sky crackles, then a massive bolt falls with a shockwave, blinding flash and scorch crater.', cost: 32, cooldown: 2.8, kind: 'tap', offensive: true , glyph: 'skystrike' },
    { name: 'Lightning Dash', short: 'Dash', desc: 'Blink along a jagged path in the aim direction with afterimages and a perception slow-down. Shocks everything you pass through.', cost: 18, cooldown: 0.7, kind: 'tap' , glyph: 'dash' },
    { name: 'Overcharge', short: 'Overcharge', desc: 'Hold to build static, hair-raising arcs and a rising hum. Release to power generators, lamps and doors and fire an EMP pulse. Longer = bigger.', cost: 14, cooldown: 1.2, kind: 'hold' , glyph: 'charge' },
  ];
  private chargeT = 0;
  private hum: LoopHandle | null = null;

  press(i: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.pay(i, this.abilities[0].cost)) return;
      this.startCooldown(0);
      pl.setCast('point', 0.28);
      pl.reveal = 0.8;
      const d = pl.aimDir();
      const h = pl.hand(18);
      const hit = G.raycast(h.x, h.y, d.x, d.y, 680, { step: 6 });
      forkBolt(h.x, h.y, hit.x, hit.y, 2.6, 0.22);
      G.fx.bolt(jagged(h.x, h.y, hit.x, hit.y, 10, 16), 1.2, PALE, 0.12);
      G.flash(0.18, [200, 220, 255]);
      G.lighting.flash((h.x + hit.x) / 2, (h.y + hit.y) / 2, 520, BLUE, 1.6, 0.3);
      G.lighting.flash(hit.x, hit.y, 260, PALE, 1.6, 0.25);
      G.cam.shake(0.22);
      G.hitstop(0.035);
      audio.zap(hit.x, hit.y, 1.2);
      audio.thunder(hit.x, hit.y, 0.2 + hit.dist / 1800, 0.6);
      G.fx.sparks(hit.x, hit.y, 18, [220, 240, 255], 600);
      const hitSet = new Set<Entity>();
      if (hit.entity) {
        hitSet.add(hit.entity);
        zapEntity(hit.entity, d.x, d.y, 26, 1.0);
        if (hit.entity instanceof Block && hit.entity.style === 'door') hit.entity.powered = 6;
      } else if (hit.terrain) {
        G.decals.add('scorch', hit.x, hit.y, 16, 20);
      }
      electrifyNearbyWater(hit.x, hit.y, 30, 2.5);
      chain(hit.x, hit.y, hitSet, 3);
      G.makeNoise(hit.x, hit.y, 500);
      // straw near impact catches
      for (const e of G.entitiesInRadius(hit.x, hit.y, 30)) if (e.mat === 'straw') e.ignite(1.2);
    } else if (i === 1) {
      if (!this.pay(i, this.abilities[1].cost)) return;
      this.startCooldown(1);
      const t = G.aimPoint(560, { ground: true });
      pl.setCast('raise', 0.7);
      pl.reveal = 1;
      G.effects.push(new SkyStrike(t.x, t.y));
    } else if (i === 2) {
      if (!this.pay(i, this.abilities[2].cost)) return;
      this.startCooldown(2);
      this.dash();
    } else if (i === 3) {
      if (!this.ready(3) || !G.spend('main', 4)) { this.deny(3); this.holding[3] = false; return; }
      this.chargeT = 0;
      this.hum?.stop();
      this.hum = audio.loop('hum');
    }
  }

  private dash() {
    const pl = G.player;
    const inp = G.input;
    // direction: explicit aim (arrows / mouse) wins, otherwise the way you're moving / facing
    const arrows = inp.isDown('ArrowLeft') || inp.isDown('ArrowRight') || inp.isDown('ArrowUp') || inp.isDown('ArrowDown');
    let d: Vec;
    if (arrows || pl.mouseAiming) d = pl.aimDir();
    else {
      const mx = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
      const my = inp.isDown('KeyW') ? -0.6 : inp.isDown('KeyS') && !pl.grounded ? 0.6 : 0;
      d = { x: mx || pl.facing, y: my };
      const l = Math.hypot(d.x, d.y); d = { x: d.x / l, y: d.y / l };
    }
    // on the ground, never dash into the floor
    if (pl.grounded && d.y > 0) { d = { x: Math.sign(d.x) || pl.facing, y: 0 }; }
    G.effects.push(new DashRun(d.x, d.y));
  }

  hold(i: number, dt: number) {
    if (i !== 3) return;
    const pl = G.player;
    if (!this.drain(this.abilities[3].cost * dt)) { this.holding[3] = false; this.release(3); return; }
    this.chargeT = Math.min(2.5, this.chargeT + dt);
    const k = this.chargeT / 2.5;
    this.charge[3] = k;
    pl.setCast('charge', 0.2);
    pl.castCharge = k;
    pl.speedMul = 0.55;
    this.hum?.set(0.5 + k * 0.6, 1 + k * 2.5);
    if (chance(dt * (10 + k * 40))) {
      const a = rand(0, Math.PI * 2), r = 20 + k * 30;
      G.fx.arc(pl.x + rand(-6, 6), pl.y + rand(-30, 20), pl.x + Math.cos(a) * r, pl.y - 10 + Math.sin(a) * r, BLUE, 1 + k, 0.08, 6);
    }
    if (chance(dt * 20)) particles.emit({ kind: PK.Spark, x: pl.x + rand(-8, 8), y: pl.y - 44, vx: rand(-60, 60), vy: rand(-200, -80), life: 0.2, size: 1.2, color: PALE });
    G.lighting.add(pl.x, pl.y - 10, 80 + k * 160, BLUE, 0.4 + k * 0.6, 0.5);
    G.cam.shake(k * 0.02);
    // nearby metal starts humming
    for (const e of G.entitiesInRadius(pl.x, pl.y, 100 + k * 160)) if (e.conductive && !(e instanceof Generator)) e.charge = Math.max(e.charge, k * 0.6);
  }

  release(i: number) {
    if (i !== 3) return;
    const pl = G.player;
    pl.speedMul = 1;
    pl.castCharge = 0;
    this.hum?.stop();
    this.hum = null;
    const k = clamp(this.chargeT / 2.5, 0.1, 1);
    this.charge[3] = 0;
    this.chargeT = 0;
    this.startCooldown(3);
    const r = 120 + k * 220;
    const x = pl.x, y = pl.y - 10;
    pl.setCast('raise', 0.3);
    pl.reveal = 1;
    G.fx.ring(x, y, 10, r, BLUE, 0.45);
    G.fx.ring(x, y, 10, r * 0.7, PALE, 0.35);
    G.flash(0.15 + k * 0.3, [190, 220, 255]);
    G.lighting.flash(x, y, r * 1.6, BLUE, 1 + k, 0.4);
    G.cam.shake(0.2 + k * 0.4);
    G.hitstop(0.03 + k * 0.05);
    audio.zap(x, y, 1.5);
    audio.thunder(x, y, 0.15, 0.5 + k * 0.6);
    let powered = 0;
    for (const e of G.entitiesInRadius(x, y, r)) {
      const c = e.center();
      const dd = Math.hypot(c.x - x, c.y - y) || 1;
      if (e instanceof Generator) { e.power(10 + k * 15); powered++; forkBolt(x, y, c.x, c.y, 2, 0.3, 14); continue; }
      if (e instanceof Lamp) { e.powered = Math.max(e.powered, 8 + k * 10); e.charge = 1; powered++; forkBolt(x, y, c.x, c.y, 1.4, 0.25, 12); continue; }
      if (e instanceof Block && e.style === 'door') { e.powered = Math.max(e.powered, 6 + k * 8); powered++; forkBolt(x, y, c.x, c.y, 1.6, 0.3, 14); continue; }
      if (e.conductive || e.wet > 0.3 || dd < r * 0.5) {
        zapEntity(e, (c.x - x) / dd, (c.y - y) / dd, 8 + 20 * k, 0.4 + k);
        if (chance(0.6)) forkBolt(x, y, c.x, c.y, 1.3, 0.2, 12);
      }
    }
    electrifyNearbyWater(x, y + 40, r * 0.5, 1 + k * 2);
    G.explode(x, y, r * 0.6, 300 * k, 0, 'elec');
    if (powered) G.showToast(`⚡ Powered ${powered} device${powered > 1 ? 's' : ''}`);
  }

  unequip() {
    super.unequip();
    this.hum?.stop();
    this.hum = null;
    G.player.speedMul = 1;
  }

  update(dt: number) {
    const pl = G.player;
    // idle static crackle on the player
    if (!pl.dead && chance(dt * 2)) {
      G.fx.arc(pl.x + rand(-8, 8), pl.y + rand(-30, 10), pl.x + rand(-16, 16), pl.y + rand(-34, 20), BLUE, 0.8, 0.06, 4);
    }
    if (!pl.dead) G.lighting.add(pl.x, pl.y - 14, 90, PALE, 0.25, 0.3);
  }

  reticle(): Vec | null {
    return G.aimPoint(560, { ground: true });
  }

  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = 'rgb(130,185,255)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y - s);
    ctx.lineTo(x - s * 0.55, y + s * 0.12);
    ctx.lineTo(x - s * 0.02, y + s * 0.12);
    ctx.lineTo(x - s * 0.2, y + s);
    ctx.lineTo(x + s * 0.6, y - s * 0.2);
    ctx.lineTo(x + s * 0.05, y - s * 0.2);
    ctx.closePath();
    ctx.fill();
  }
}
