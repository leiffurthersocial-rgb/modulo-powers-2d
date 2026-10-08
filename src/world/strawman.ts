// Straw-stuffed training dummy on a springy pole. Flammable.
import { G } from '../ctx';
import { audio } from '../core/audio';
import { rand, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Bounds, Entity } from './entity';
import { DmgType } from './materials';
import { Bodies, Body, CAT, Composite, Constraint, ipos, MBody, plug } from './phys';
import Matter from 'matter-js';

const POLE = 96;

export class Strawman extends Entity {
  body: MBody;
  bodies: MBody[];
  pin: Matter.Constraint;
  spring: Matter.Constraint;
  base: Vec;
  spawn: Vec;
  deadTime = 0;
  private seed = Math.random() * 10;

  constructor(x: number, groundY: number) {
    super();
    this.kind = 'strawman';
    this.mat = 'straw';
    this.flammable = true;
    this.maxHp = this.hp = 70;
    this.base = { x, y: groundY };
    this.spawn = { x, y: groundY };
    const filter = { category: CAT.CHAR, mask: 0xffff };
    const pole = Bodies.rectangle(x, groundY - POLE / 2, 6, POLE, { density: 0.002 });
    const sack = Bodies.rectangle(x, groundY - POLE + 8, 26, 44, { density: 0.0007, chamfer: { radius: 10 } } as any);
    const bar = Bodies.rectangle(x, groundY - POLE + 2, 62, 7, { density: 0.0006 });
    const head = Bodies.circle(x, groundY - POLE - 26, 11, { density: 0.0005 });
    this.body = Body.create({ parts: [pole, sack, bar, head], friction: 0.6, frictionAir: 0.03, collisionFilter: filter } as any);
    plug(this.body).owner = this;
    this.bodies = [this.body];
    const bottomLocal = { x: 0, y: groundY - this.body.position.y };
    this.pin = Constraint.create({ bodyA: this.body, pointA: bottomLocal, pointB: { x, y: groundY }, stiffness: 1, length: 0 });
    const topLocal = { x: 0, y: groundY - POLE - 20 - this.body.position.y };
    this.spring = Constraint.create({ bodyA: this.body, pointA: topLocal, pointB: { x, y: groundY - POLE - 20 }, stiffness: 0.012, damping: 0.05, length: 0 } as any);
  }

  addToWorld(world: Matter.World) { Composite.add(world, [this.body, this.pin, this.spring]); }
  removeFromWorld(world: Matter.World) { Composite.remove(world, [this.body, this.pin, this.spring] as any); }

  center(): Vec {
    // sack centre: rotate (0, -(POLE - 6)) around the base pin
    const L = POLE - 6, t = this.body.angle;
    return { x: this.base.x + L * Math.sin(t), y: this.base.y - L * Math.cos(t) };
  }

  bounds(): Bounds {
    const b = this.body.bounds;
    return { x0: b.min.x, y0: b.min.y, x1: b.max.x, y1: Math.min(b.max.y, this.base.y - 50) };
  }

  randomPoint(): Vec {
    const c = this.center();
    return { x: c.x + rand(-14, 14), y: c.y + rand(-40, 20) };
  }

  applyImpulse(jx: number, jy: number) {
    // only the sack really reacts; the pole resists
    Body.setAngularVelocity(this.body, this.body.angularVelocity + jx / 6000);
  }

  protected onDamaged(amount: number) {
    if (amount > 3) {
      const c = this.center();
      for (let i = 0; i < particles.n(Math.min(8, amount / 3)); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-10, 10), y: c.y + rand(-15, 15), vx: rand(-200, 200), vy: rand(-250, -30), life: rand(0.6, 1.4), size: rand(2, 4), color: [214, 178, 92], gravity: 600, collide: true, drag: 1.5, vrot: rand(-8, 8) });
      audio.impact('straw', c.x, c.y, Math.min(0.8, amount / 30));
    }
  }

  onDestroyed(type: DmgType) {
    const c = this.center();
    this.deadTime = 0;
    if (type === 'fire') {
      G.decals.add('ash', this.base.x, this.base.y, 40);
      for (let i = 0; i < particles.n(25); i++) particles.emit({ kind: PK.Ember, x: c.x + rand(-15, 15), y: c.y + rand(-30, 30), vx: rand(-60, 60), vy: rand(-200, -50), life: rand(0.6, 1.6), size: 2, color: [255, 150, 60], flicker: 0.8 });
      G.fx.smoke(c.x, c.y, 6);
    } else {
      for (let i = 0; i < particles.n(40); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-15, 15), y: c.y + rand(-25, 25), vx: rand(-350, 350), vy: rand(-400, -50), life: rand(1, 2), size: rand(2, 5), color: [214, 178, 92], gravity: 600, collide: true, drag: 1.2, vrot: rand(-10, 10) });
    }
    audio.crumble(c.x, c.y, 0.4);
    this.remove();
  }

  update(dt: number) {
    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number) {
    const p = ipos(this.body, alpha);
    ctx.save();
    // rotate around base pin
    ctx.translate(this.base.x, this.base.y);
    ctx.rotate(p.a);
    // pole
    ctx.fillStyle = '#4b3420';
    ctx.fillRect(-3, -POLE, 6, POLE);
    // crossbar arms
    ctx.fillStyle = '#5e4128';
    ctx.fillRect(-31, -POLE - 2, 62, 6);
    const path = () => {
      ctx.beginPath();
      ctx.ellipse(0, -POLE + 6, 15, 24, 0, 0, Math.PI * 2);
      ctx.moveTo(11, -POLE - 26);
      ctx.arc(0, -POLE - 26, 11, 0, Math.PI * 2);
    };
    const burnt = this.scorch;
    ctx.fillStyle = burnt > 0.6 ? '#3a2e22' : '#cfae62';
    path(); ctx.fill();
    // straw strands
    ctx.strokeStyle = 'rgba(120,85,30,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const yy = -POLE - 12 + i * 6;
      ctx.moveTo(-12, yy + Math.sin(i + this.seed) * 2); ctx.lineTo(12, yy + Math.cos(i * 1.7 + this.seed) * 2);
    }
    // straw tufts at arms
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) { ctx.moveTo(sx * 31, -POLE + 1); ctx.lineTo(sx * (36 + i * 1.5), -POLE + 1 + (i - 1.5) * 3); }
    }
    ctx.stroke();
    // sack rope + face
    ctx.fillStyle = '#7a5a2a';
    ctx.fillRect(-12, -POLE - 15, 24, 3);
    ctx.fillStyle = '#3a2a12';
    ctx.fillRect(-5, -POLE - 29, 2.5, 2.5); ctx.fillRect(3, -POLE - 29, 2.5, 2.5);
    ctx.fillRect(-4, -POLE - 22, 8, 1.5);
    // target ring
    ctx.strokeStyle = '#b13b2a'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(0, -POLE + 6, 7, 0, 6.3); ctx.stroke();
    this.drawStatusOverlay(ctx, path);
    if (!this.dead && this.hp < this.maxHp) {
      ctx.rotate(-p.a);
      const f = this.hp / this.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-16, -POLE - 50, 32, 5);
      ctx.fillStyle = f > 0.5 ? '#d8c060' : '#e07a40'; ctx.fillRect(-15, -POLE - 49, 30 * f, 3);
    }
    ctx.restore();
  }
}
