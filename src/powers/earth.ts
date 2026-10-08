import { G } from '../ctx';
import { audio } from '../core/audio';
import { chance, clamp, rand, RGB, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Block } from '../world/blocks';
import { Stickman } from '../world/stickman';
import { Body, setVel } from '../world/phys';
import { AbilityDef, Effect, Power } from './power';

const BROWN: RGB = [190, 150, 100];
const GREEN: RGB = [140, 200, 110];
const STONE: RGB = [120, 112, 104];

/** boulder ripped out of the ground, floats up to the hand, then is flung */
class RockHurl implements Effect {
  t = 0;
  x: number; y: number;
  sx: number; sy: number;
  r = 22;
  thrown = false;
  constructor(sx: number, sy: number) {
    this.sx = sx; this.sy = sy;
    this.x = sx; this.y = sy;
    audio.crumble(sx, sy, 0.7);
    audio.rumble(sx, sy, 0.4, 0.5);
    G.decals.add('crack', sx, sy, 50, 30);
    G.fx.dust(sx, sy, 8, [110, 95, 80]);
    for (let i = 0; i < particles.n(20); i++) particles.emit({ kind: PK.Debris, x: sx + rand(-20, 20), y: sy - 2, vx: rand(-180, 180), vy: rand(-400, -120), life: rand(0.5, 1.1), size: rand(2, 6), color: [96, 82, 68], gravity: 1500, collide: true, vrot: rand(-10, 10) });
    G.cam.shake(0.15);
  }
  update(dt: number) {
    this.t += dt;
    const pl = G.player;
    const h = pl.hand(42);
    const k = clamp(this.t / 0.22, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    // jitter while pulled out
    this.x = this.sx + (h.x - this.sx) * e + rand(-1, 1) * (1 - k) * 3;
    this.y = this.sy + (h.y - 10 - this.sy) * e + rand(-1, 1) * (1 - k) * 3;
    if (chance(dt * 30)) particles.emit({ kind: PK.Debris, x: this.x + rand(-this.r, this.r), y: this.y + this.r * 0.6, vy: rand(20, 120), vx: rand(-40, 40), life: 0.6, size: rand(2, 4), color: [96, 82, 68], gravity: 1200, collide: true });
    if (this.t >= 0.24) { this.throw(); return false; }
    return true;
  }
  throw() {
    const pl = G.player;
    const d = pl.aimDir();
    pl.setCast('hurl', 0.3);
    const rock = G.spawnProp({ kind: 'boulder', x: this.x + d.x * 8, y: this.y + d.y * 8, r: this.r, lifetime: 12, sides: 8 });
    rock.crushing = 2.5;
    rock.owner = 'player';
    // don't collide with the thrower for a moment
    rock.body.collisionFilter.mask = 0xffff & ~0x0008;
    setTimeout(() => { if (!rock.removed) rock.body.collisionFilter.mask = 0xffff; }, 220);
    setVel(rock.body, d.x * 980 + pl.vx * 0.3, d.y * 980 - 80);
    Body.setAngularVelocity(rock.body, pl.facing * 0.3);
    audio.whoosh(this.x, this.y, 0.35, 0.5, 200, 900);
    audio.thud(this.x, this.y, 0.5);
    G.cam.shake(0.18);
    G.cam.punch(0.03);
    if (!pl.grounded) setVel(pl.body, pl.vx - d.x * 160, pl.vy - d.y * 160);
    G.makeNoise(this.x, this.y, 350);
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgb(112,98,84)';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.t;
      const rr = this.r * (0.85 + 0.15 * Math.sin(i * 2.3));
      const px = this.x + Math.cos(a) * rr, py = this.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

/** delayed pillar: rumble first, then erupt */
class PillarRise implements Effect {
  t = 0;
  constructor(public x: number, public gy: number, public h: number) {
    audio.rumble(x, gy, 0.5, 0.6);
  }
  update(dt: number) {
    this.t += dt;
    if (chance(dt * 40)) particles.emit({ kind: PK.Debris, x: this.x + rand(-26, 26), y: this.gy - 2, vx: rand(-60, 60), vy: rand(-220, -60), life: 0.5, size: rand(2, 4), color: [96, 82, 68], gravity: 1400, collide: true });
    if (this.t < 0.14) return true;
    const w = 54;
    G.addBlock(new Block(this.x - w / 2, this.gy - this.h, w, this.h, 'pillar', { lifetime: 11, rise: 0.17 }));
    G.cam.shake(0.35);
    G.hitstop(0.03);
    audio.crumble(this.x, this.gy, 0.8);
    audio.thud(this.x, this.gy, 0.8);
    G.fx.dust(this.x, this.gy, 14, [110, 95, 80]);
    G.decals.add('crack', this.x, this.gy, 70, 30);
    for (let i = 0; i < particles.n(24); i++) particles.emit({ kind: PK.Debris, x: this.x + rand(-30, 30), y: this.gy - 2, vx: rand(-260, 260), vy: rand(-500, -150), life: rand(0.6, 1.2), size: rand(3, 7), color: [96, 82, 68], gravity: 1500, collide: true, vrot: rand(-10, 10) });
    // smash things standing next to it sideways
    for (const e of G.entitiesInRadius(this.x, this.gy - 40, 50)) { e.damage(10, 'blunt'); }
    G.makeNoise(this.x, this.gy, 400);
    return false;
  }
}

/** shockwave rolling outward along the ground */
class Quake implements Effect {
  t = 0;
  hit = new Set<number>();
  constructor(public x: number, public gy: number, public r: number) {}
  update(dt: number) {
    this.t += dt;
    const front = Math.min(this.r, this.t * 900);
    for (const side of [-1, 1]) {
      const fx = this.x + side * front;
      const gy = G.terrain.groundBelow(fx, this.gy - 60);
      if (chance(dt * 50)) {
        particles.emit({ kind: PK.Debris, x: fx, y: gy - 2, vx: side * rand(40, 160), vy: rand(-380, -120), life: 0.7, size: rand(2, 5), color: [96, 82, 68], gravity: 1500, collide: true });
        particles.emit({ kind: PK.Smoke, x: fx, y: gy - 6, vx: side * rand(60, 180), vy: rand(-40, -10), life: rand(0.8, 1.4), size: 10, sizeEnd: 34, color: [110, 98, 86], alpha: 0.35, drag: 2 });
      }
    }
    for (const e of G.entities) {
      if (this.hit.has(e.id)) continue;
      const c = e.center();
      const dx = c.x - this.x;
      if (Math.abs(dx) > front) continue;
      const b = e.bounds();
      const gy = G.terrain.groundBelow(c.x, b.y1 - 4);
      if (b.y1 < gy - 50 || Math.abs(gy - this.gy) > 140) continue; // airborne / other level
      this.hit.add(e.id);
      const k = 1 - Math.abs(dx) / (this.r + 40);
      const m = e.mass();
      if (e instanceof Block) { e.damage(70 * k, 'blunt'); continue; }
      e.applyImpulse(Math.sign(dx || 1) * m * 380 * k, -m * (520 + 300 * k));
      e.damage(14 * k + 4, 'blunt');
      if (e instanceof Stickman) e.knock(2.5);
    }
    return this.t < this.r / 900 + 0.2;
  }
  drawGlow(ctx: CanvasRenderingContext2D) {
    const front = Math.min(this.r, this.t * 900);
    ctx.globalAlpha = Math.max(0, 0.5 - this.t);
    ctx.strokeStyle = 'rgb(200,160,110)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(this.x, this.gy, Math.max(1, front), 14, 0, Math.PI, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export class EarthPower extends Power {
  id = 'earth' as const;
  name = 'Earth';
  color: RGB = BROWN;
  color2: RGB = GREEN;
  eye = '#b8f0a0';
  abilities: AbilityDef[] = [
    { name: 'Rock Hurl', short: 'Rock Hurl', desc: 'Rip a boulder out of the ground (tearing earth, debris), then fling it with heavy momentum. It crushes, knocks down and breaks wood and lamps.', cost: 14, cooldown: 0.55, kind: 'tap', offensive: true },
    { name: 'Raise Pillar', short: 'Pillar', desc: 'A stone pillar erupts at the aim point: a platform to climb, a launcher that flings whatever stands on it, cover or a battering ram.', cost: 18, cooldown: 0.6, kind: 'tap', offensive: true },
    { name: 'Earthquake Stomp', short: 'Quake', desc: 'Slam the ground (from the air you dive first). A shockwave cracks the terrain, topples stacks and knocks everything nearby off its feet.', cost: 30, cooldown: 1.8, kind: 'tap', offensive: true },
    { name: 'Stone Armor', short: 'Stone Armor', desc: 'Encase yourself in rock plates: heavier, slower, resistant, and you body-check things you run into. The armor cracks over time. Tap again to burst it.', cost: 28, cooldown: 3, kind: 'tap' },
  ];
  private diving = false;
  private armorDecay = 0;

  press(i: number) {
    const pl = G.player;
    if (i === 0) {
      if (!this.pay(0, this.abilities[0].cost)) return;
      this.startCooldown(0);
      const d = pl.aimDir();
      const sx = pl.x + pl.facing * 34;
      let sy = G.terrain.groundBelow(sx, pl.y);
      if (sy - pl.feetY > 120) sy = pl.feetY + 10; // in the air: pull rock from below
      pl.setCast('windup', 0.24);
      pl.reveal = 1;
      void d;
      G.effects.push(new RockHurl(sx, sy - 6));
    } else if (i === 1) {
      if (!this.pay(1, this.abilities[1].cost)) return;
      this.startCooldown(1);
      const t = G.aimPoint(440);
      let gy = G.terrain.groundBelow(t.x, t.y - 2);
      let h = 150;
      const pool = G.water.poolNear(t.x, gy, 4);
      if (pool && gy > pool.y) h = Math.min(320, gy - pool.y + 70);
      if (gy - t.y > 400) { this.deny(1); return; }
      pl.setCast('raise', 0.35);
      pl.reveal = 1;
      G.effects.push(new PillarRise(t.x, gy, h));
    } else if (i === 2) {
      if (!this.pay(2, this.abilities[2].cost)) return;
      this.startCooldown(2);
      pl.reveal = 1;
      if (!pl.grounded && !pl.swimming) {
        this.diving = true;
        pl.setCast('stomp', 2);
        setVel(pl.body, pl.vx * 0.3, 1500);
        audio.whoosh(pl.x, pl.y, 0.3, 0.4, 1200, 200);
      } else this.stomp(1);
    } else if (i === 3) {
      if (pl.armor > 0) { this.shatterArmor(true); return; }
      if (!this.pay(3, this.abilities[3].cost)) return;
      this.startCooldown(3);
      pl.armorMax = 120;
      pl.armor = 120;
      this.armorDecay = 0;
      Body.setDensity(pl.body, 0.0032); Body.setInertia(pl.body, Infinity);
      pl.setCast('guard', 0.5);
      audio.crumble(pl.x, pl.y, 0.8);
      audio.rumble(pl.x, pl.y, 0.4, 0.5);
      G.cam.shake(0.2);
      for (let k = 0; k < particles.n(30); k++) {
        const a = rand(0, Math.PI * 2), r = rand(60, 110);
        particles.emit({ kind: PK.Debris, x: pl.x + Math.cos(a) * r, y: pl.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 5, vy: -Math.sin(a) * r * 5, life: 0.2, size: rand(3, 6), color: [107, 94, 82], vrot: rand(-10, 10) });
      }
      G.fx.dust(pl.x, pl.feetY, 6, [110, 95, 80]);
    }
  }

  private stomp(power: number) {
    const pl = G.player;
    const gy = pl.feetY;
    const r = 300 * power + 60;
    pl.setCast('slam', 0.35);
    G.effects.push(new Quake(pl.x, gy, r));
    G.cam.shake(0.85);
    G.cam.punch(0.06);
    G.hitstop(0.08);
    G.flash(0.06, [200, 160, 110]);
    audio.rumble(pl.x, gy, 1, 1.6);
    audio.explosion(pl.x, gy, 0.6);
    audio.crumble(pl.x, gy, 0.8);
    G.decals.add('crack', pl.x, gy, 110, 50);
    G.decals.add('crack', pl.x - 70, gy, 60, 40);
    G.decals.add('crack', pl.x + 70, gy, 60, 40);
    G.fx.ring(pl.x, gy, 10, r * 0.6, [200, 160, 110], 0.4);
    for (let k = 0; k < particles.n(40); k++) particles.emit({ kind: PK.Debris, x: pl.x + rand(-40, 40), y: gy - 2, vx: rand(-350, 350), vy: rand(-650, -200), life: rand(0.6, 1.3), size: rand(2, 7), color: [96, 82, 68], gravity: 1500, collide: true, vrot: rand(-10, 10) });
    G.fx.dust(pl.x, gy, 20, [110, 98, 86]);
    for (const p of G.water.pools) if (Math.abs(p.x + p.w / 2 - pl.x) < r + p.w / 2) p.disturb(Math.max(p.x, Math.min(p.x + p.w, pl.x)), 250, 120);
    G.makeNoise(pl.x, gy, 700);
  }

  shatterArmor(voluntary = false) {
    const pl = G.player;
    pl.armor = 0;
    Body.setDensity(pl.body, 0.0012); Body.setInertia(pl.body, Infinity);
    audio.crumble(pl.x, pl.y, 0.9);
    G.cam.shake(voluntary ? 0.4 : 0.2);
    for (let k = 0; k < particles.n(36); k++) {
      const a = rand(0, Math.PI * 2);
      particles.emit({ kind: PK.Debris, x: pl.x + rand(-10, 10), y: pl.y + rand(-30, 30), vx: Math.cos(a) * rand(150, 500), vy: Math.sin(a) * rand(150, 500) - 150, life: rand(0.6, 1.3), size: rand(3, 7), color: [107, 94, 82], gravity: 1400, collide: true, vrot: rand(-10, 10) });
    }
    if (voluntary) G.explode(pl.x, pl.y, 110, 600, 16, 'blunt');
  }

  update(dt: number) {
    const pl = G.player;
    if (pl.dead) return;
    if (this.diving) {
      setVel(pl.body, pl.vx, Math.max(pl.vy, 1300));
      if (chance(dt * 30)) particles.emit({ kind: PK.Debris, x: pl.x + rand(-10, 10), y: pl.y - 30, vy: -200, life: 0.3, size: 3, color: [107, 94, 82] });
      if (pl.grounded || pl.swimming) { this.diving = false; this.stomp(1.25); }
    }
    if (chance(dt * 3)) particles.emit({ kind: PK.Debris, x: pl.x + rand(-8, 8), y: pl.y + rand(-20, 20), vy: 60, life: 0.5, size: 2, color: [120, 100, 80], gravity: 600 });
  }

  background(dt: number) {
    const pl = G.player;
    if (pl.armor > 0) {
      this.armorDecay += dt;
      pl.armor -= dt * 4.5;
      if (chance(dt * 1.2)) { audio.crumble(pl.x, pl.y, 0.15); particles.emit({ kind: PK.Debris, x: pl.x + rand(-10, 10), y: pl.y + rand(-20, 20), vx: rand(-80, 80), vy: -60, life: 0.8, size: rand(2, 4), color: [107, 94, 82], gravity: 1400, collide: true }); }
      if (pl.armor <= 0) this.shatterArmor();
    }
  }

  unequip() {
    super.unequip();
    this.diving = false;
  }

  reticle(): Vec | null {
    const t = G.aimPoint(440);
    return { x: t.x, y: G.terrain.groundBelow(t.x, t.y - 2) };
  }

  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = 'rgb(160,135,105)';
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.7);
    ctx.lineTo(x - s * 0.3, y - s * 0.6);
    ctx.lineTo(x + s * 0.05, y - s * 0.1);
    ctx.lineTo(x + s * 0.4, y - s * 0.9);
    ctx.lineTo(x + s, y + s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(140,200,110)';
    ctx.fillRect(x - s, y + s * 0.55, s * 2, s * 0.2);
  }
}

export { STONE };
