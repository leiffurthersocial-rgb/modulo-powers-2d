// Flammable tree with a static trunk. Burns down to a charred stump.
import { G } from '../ctx';
import { audio } from '../core/audio';
import { rand, seeded, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Bounds, Entity } from './entity';
import { DmgType } from './materials';
import { Bodies, CAT, MBody, plug } from './phys';

export class Tree extends Entity {
  body: MBody;
  bodies: MBody[];
  x: number; groundY: number; h: number;
  blobs: { x: number; y: number; r: number }[] = [];
  charred = false;

  constructor(x: number, groundY: number, h = 180, seed = 1) {
    super();
    this.kind = 'tree';
    this.mat = 'wood';
    this.flammable = true;
    this.x = x; this.groundY = groundY; this.h = h;
    this.maxHp = this.hp = 140;
    this.body = Bodies.rectangle(x, groundY - h * 0.35, 16, h * 0.7, { isStatic: true, collisionFilter: { category: CAT.PROP, mask: CAT.PROP | CAT.DEBRIS } });
    plug(this.body).owner = this;
    this.bodies = [this.body];
    const rng = seeded(seed * 97 + x);
    for (let i = 0; i < 7; i++) this.blobs.push({ x: (rng() - 0.5) * h * 0.4, y: -h * 0.6 - rng() * h * 0.35, r: h * (0.13 + rng() * 0.1) });
  }

  center(): Vec { return { x: this.x, y: this.groundY - this.h * 0.6 }; }
  bounds(): Bounds { return { x0: this.x - this.h * 0.3, y0: this.groundY - this.h, x1: this.x + this.h * 0.3, y1: this.groundY }; }
  randomPoint(): Vec {
    if (this.charred || Math.random() < 0.3) return { x: this.x + rand(-6, 6), y: this.groundY - rand(0, this.h * 0.6) };
    const b = this.blobs[(Math.random() * this.blobs.length) | 0];
    return { x: this.x + b.x + rand(-b.r, b.r) * 0.7, y: this.groundY + b.y + rand(-b.r, b.r) * 0.7 };
  }

  applyImpulse() { /* rooted */ }

  onDestroyed(_t: DmgType) {
    // burnt: becomes a stump, leaves embers
    const c = this.center();
    audio.crumble(c.x, c.y, 0.5);
    for (let i = 0; i < particles.n(30); i++) particles.emit({ kind: PK.Ember, x: c.x + rand(-40, 40), y: c.y + rand(-40, 40), vx: rand(-60, 60), vy: rand(-200, -40), life: rand(0.8, 1.8), size: 2, color: [255, 150, 60], flicker: 0.8 });
    G.fx.smoke(c.x, c.y, 8);
    G.decals.add('ash', this.x, this.groundY, 60);
    this.remove();
  }

  update(dt: number) {
    super.update(dt);
    if (this.scorch > 0.6) this.charred = true;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, groundY: gy, h } = this;
    const sway = Math.sin(G.time * 0.8 + x) * 2;
    ctx.fillStyle = this.scorch > 0.5 ? '#1c1612' : '#3a2a1c';
    ctx.beginPath();
    ctx.moveTo(x - 9, gy); ctx.lineTo(x - 5, gy - h * 0.7); ctx.lineTo(x + 5 + sway * 0.3, gy - h * 0.7); ctx.lineTo(x + 9, gy);
    ctx.closePath(); ctx.fill();
    if (this.charred) return;
    const k = 1 - this.scorch;
    for (const b of this.blobs) {
      ctx.fillStyle = `rgb(${18 + 30 * (1 - k)},${44 * k + 20},${32 * k + 16})`;
      ctx.beginPath(); ctx.arc(x + b.x + sway, gy + b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,200,150,0.07)';
    for (const b of this.blobs) { ctx.beginPath(); ctx.arc(x + b.x + sway - b.r * 0.3, gy + b.y - b.r * 0.3, b.r * 0.5, 0, Math.PI * 2); ctx.fill(); }
    if (this.wet > 0.2) {
      ctx.fillStyle = `rgba(30,60,110,${this.wet * 0.3})`;
      for (const b of this.blobs) { ctx.beginPath(); ctx.arc(x + b.x + sway, gy + b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}
