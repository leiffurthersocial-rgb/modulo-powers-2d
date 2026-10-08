import { G } from '../ctx';
import { audio } from '../core/audio';
import { chance, rand, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { DmgType, MATS, MatId } from './materials';
import { addVel, MBody } from './phys';

let nextId = 1;

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export const FIRE_COLORS: [number, number, number][] = [
  [255, 220, 120], [255, 160, 50], [255, 110, 30], [240, 70, 20],
];

/**
 * Base class for everything that can be hit, burned, soaked, frozen or
 * electrocuted: props, ragdolls, strawmen and the player.
 */
export abstract class Entity {
  id = nextId++;
  dead = false;
  removed = false;
  kind = 'entity';
  mat: MatId = 'wood';
  hp = 100;
  maxHp = 100;
  wet = 0;
  heat = 0;
  burning = 0;
  fuel = 1;
  frozen = 0;
  shock = 0;
  charge = 0;
  scorch = 0;
  startle = 0;
  flammable = false;
  conductive = false;
  invulnerable = false;
  /** steam/elec damage throttling */
  protected dotAcc = 0;
  lastDamageType: DmgType | null = null;

  abstract bodies: MBody[];
  abstract center(): Vec;
  abstract bounds(): Bounds;
  abstract draw(ctx: CanvasRenderingContext2D, alpha: number): void;
  drawGlow(_ctx: CanvasRenderingContext2D, _alpha: number): void {}
  abstract onDestroyed(type: DmgType): void;

  update(dt: number) { this.updateStatus(dt); }

  /** random point on the entity for fire/spark emission */
  randomPoint(): Vec {
    const b = this.bounds();
    return { x: rand(b.x0, b.x1), y: rand(b.y0, b.y1) };
  }

  mass() {
    let m = 0;
    for (const b of this.bodies) if (!b.isStatic) m += b.mass;
    return m || 1;
  }

  /** impulse in (mass * px/s). Distributes as equal velocity change over all bodies. */
  applyImpulse(jx: number, jy: number, _px?: number, _py?: number) {
    const m = this.mass();
    const k = this.frozen > 0 ? 0.6 : 1;
    for (const b of this.bodies) addVel(b, (jx / m) * k, (jy / m) * k);
  }

  damage(amount: number, type: DmgType, sx?: number, sy?: number) {
    if (this.dead || this.invulnerable) return;
    if (type === 'fire' && this.wet > 0.3) amount *= 0.3;
    if (this.frozen > 0 && type === 'blunt' && amount > 18) {
      this.shatter();
      return;
    }
    this.hp -= amount;
    this.lastDamageType = type;
    this.onDamaged(amount, type, sx, sy);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.onDestroyed(type);
    }
  }

  protected onDamaged(_amount: number, _type: DmgType, _sx?: number, _sy?: number) {}

  ignite(amount = 0.5) {
    if (this.wet > 0.25) {
      this.wet = Math.max(0, this.wet - amount * 0.5);
      const c = this.center();
      if (chance(0.3)) steamPuff(c.x, c.y, 1);
      return;
    }
    if (this.frozen > 0) { this.frozen = Math.max(0, this.frozen - amount * 2); return; }
    this.heat += amount;
    if (this.flammable && this.heat >= 1 && this.burning <= 0 && this.fuel > 0) {
      this.burning = 0.4;
      const c = this.center();
      audio.fireWhoosh(c.x, c.y, 0.3);
    }
  }

  extinguish(amount = 1) {
    if (this.burning > 0) {
      const c = this.center();
      steamPuff(c.x, c.y, 3);
      audio.hiss(c.x, c.y, 0.3, 0.5);
    }
    this.burning = Math.max(0, this.burning - amount);
    this.heat = 0;
  }

  soak(amount = 0.5) {
    this.wet = Math.min(1, this.wet + amount);
    if (this.burning > 0) this.extinguish(amount * 2);
    this.heat = Math.max(0, this.heat - amount);
  }

  freeze(seconds: number) {
    if (this.burning > 0) { this.extinguish(1); return; }
    this.frozen = Math.max(this.frozen, seconds);
    this.shock = 0;
  }

  electrocute(seconds: number, dmg: number) {
    if (this.dead) return;
    const k = this.wet > 0.2 ? 1.8 : 1;
    this.shock = Math.max(this.shock, seconds * k);
    this.charge = 1;
    this.damage(dmg * k, 'elec');
    if (this.mat === 'straw' || (this.flammable && chance(0.35))) this.ignite(1.2);
    if (this.frozen > 0) this.frozen *= 0.7;
  }

  shatter() {
    this.frozen = 0;
    const c = this.center();
    audio.shatter(c.x, c.y, 0.7);
    for (let i = 0; i < particles.n(30); i++) {
      const a = rand(0, 6.28), s = rand(100, 600);
      particles.emit({ kind: PK.Debris, x: c.x + rand(-15, 15), y: c.y + rand(-25, 25), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 200, life: rand(0.6, 1.4), size: rand(3, 8), color: [190, 235, 255], gravity: 1400, collide: true, vrot: rand(-10, 10), bounce: 0.3 });
    }
    this.hp = 0;
    this.dead = true;
    this.onDestroyed('cold');
  }

  /** common status-effect simulation: burning, wetness, freezing, shock */
  protected updateStatus(dt: number) {
    if (this.startle > 0) this.startle -= dt;
    // wetness slowly dries, faster when hot
    if (this.wet > 0) {
      this.wet = Math.max(0, this.wet - dt * (0.03 + this.heat * 0.3));
      if (chance(this.wet * dt * 6)) {
        const p = this.randomPoint();
        particles.emit({ kind: PK.Drop, x: p.x, y: p.y, vy: 30, life: 0.6, size: 1.6, color: [120, 190, 255], alpha: 0.8, gravity: 900, collide: true });
      }
    }
    this.heat = Math.max(0, this.heat - dt * 0.25);
    if (this.charge > 0) this.charge = Math.max(0, this.charge - dt * 0.8);

    if (this.frozen > 0) {
      this.frozen -= dt * (1 + this.heat * 6);
      if (this.frozen <= 0) {
        this.frozen = 0;
        this.wet = 0.6;
        const c = this.center();
        audio.impact('ice', c.x, c.y, 0.3);
      }
    }

    if (this.shock > 0) {
      this.shock -= dt;
      if (chance(dt * 30)) {
        const p = this.randomPoint();
        const a = rand(0, 6.28);
        particles.emit({ kind: PK.Spark, x: p.x, y: p.y, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, life: 0.15, size: 1.5, color: [200, 230, 255], drag: 4 });
      }
      if (chance(dt * 4)) { const c = this.center(); audio.crackle(c.x, c.y, 0.12); }
    }

    if (this.burning > 0) {
      if (this.wet > 0.3) { this.extinguish(1); return; }
      const rate = MATS[this.mat].burnRate || 0.5;
      this.burning = Math.min(1, this.burning + dt * 0.5);
      if (this.flammable) {
        this.fuel -= dt * 0.055 * rate;
        this.scorch = Math.min(1, this.scorch + dt * 0.12);
        this.damage(dt * 9 * rate * this.burning, 'fire');
        if (this.fuel <= 0) {
          this.burning = 0;
          if (!this.dead) this.damage(1e6, 'fire');
        }
      } else {
        // non-flammables (flesh) burn briefly
        this.burning -= dt * 0.25;
        this.scorch = Math.min(1, this.scorch + dt * 0.08);
        this.damage(dt * 6, 'fire');
      }
      emitFire(this, dt);
    }
  }

  /** generic overlay for status effects (called by subclasses after drawing) */
  drawStatusOverlay(ctx: CanvasRenderingContext2D, path: () => void) {
    if (this.wet > 0.05) {
      ctx.globalAlpha = this.wet * 0.35;
      ctx.fillStyle = '#1b3e66';
      path(); ctx.fill();
    }
    if (this.scorch > 0.02) {
      ctx.globalAlpha = this.scorch * 0.7;
      ctx.fillStyle = '#120c08';
      path(); ctx.fill();
    }
    if (this.frozen > 0) {
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = '#9fdcff';
      path(); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#e8f8ff';
      ctx.lineWidth = 1.5;
      path(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  remove() { this.removed = true; }
}

export function emitFire(e: Entity, dt: number) {
  const intensity = e.burning;
  const b = e.bounds();
  const area = Math.max(400, (b.x1 - b.x0) * (b.y1 - b.y0));
  const count = particles.n(dt * (20 + Math.min(70, area / 50)) * intensity);
  for (let i = 0; i < count; i++) {
    const p = e.randomPoint();
    const c = FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0];
    particles.emit({ kind: PK.Glow, x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-120, -40), life: rand(0.25, 0.6), size: rand(6, 14) * (0.6 + intensity * 0.6), sizeEnd: 1, color: c, alpha: 0.85, flicker: 0.5 });
  }
  if (chance(dt * 6 * intensity)) {
    const p = e.randomPoint();
    particles.emit({ kind: PK.Smoke, x: p.x, y: p.y - 10, vx: rand(-15, 15), vy: rand(-70, -40), life: rand(1.5, 2.6), size: rand(8, 14), sizeEnd: rand(30, 50), color: [30, 28, 30], alpha: 0.5 });
  }
  if (chance(dt * 5 * intensity)) {
    const p = e.randomPoint();
    particles.emit({ kind: PK.Ember, x: p.x, y: p.y, vx: rand(-40, 40), vy: rand(-160, -60), life: rand(0.8, 1.6), size: rand(1.5, 2.5), color: [255, 170, 60], flicker: 0.8, drag: 0.5 });
  }
  const c = e.center();
  G.lighting.add(c.x, c.y, 120 + 120 * intensity, [255, 140, 50], 0.55 + 0.3 * intensity, 0.3);
}

export function steamPuff(x: number, y: number, n = 4) {
  for (let i = 0; i < particles.n(n); i++) {
    particles.emit({ kind: PK.Steam, x: x + rand(-10, 10), y: y + rand(-6, 6), vx: rand(-30, 30), vy: rand(-90, -40), life: rand(1, 2), size: rand(8, 14), sizeEnd: rand(30, 50), color: [200, 210, 220], alpha: 0.35, drag: 0.6 });
  }
}
