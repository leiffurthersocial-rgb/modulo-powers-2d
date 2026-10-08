// Industrial machinery: generators that lightning can power, lamps (light
// sources that matter for Shadow) and links to doors.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { chance, rand, RGB, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Block } from './blocks';
import { Bounds, Entity } from './entity';
import { DmgType } from './materials';
import { Bodies, CAT, MBody, plug } from './phys';

export class Generator extends Entity {
  body: MBody;
  bodies: MBody[];
  x: number; y: number; w = 70; h = 80;
  powered = 0;
  links: (Lamp | Block)[] = [];
  private spin = 0;

  constructor(x: number, groundY: number) {
    super();
    this.kind = 'generator';
    this.mat = 'metal';
    this.conductive = true;
    this.invulnerable = true;
    this.x = x; this.y = groundY - this.h;
    this.body = Bodies.rectangle(x, groundY - this.h / 2, this.w, this.h, { isStatic: true, collisionFilter: { category: CAT.TERRAIN, mask: 0xffff } });
    plug(this.body).owner = this;
    plug(this.body).terrain = true;
    plug(this.body).mat = 'metal';
    this.bodies = [this.body];
  }

  center(): Vec { return { x: this.x, y: this.y + this.h / 2 }; }
  bounds(): Bounds { return { x0: this.x - this.w / 2, y0: this.y, x1: this.x + this.w / 2, y1: this.y + this.h }; }
  onDestroyed() {}

  electrocute(seconds: number, _dmg: number) {
    this.charge = 1;
    this.power(10 + seconds * 4);
  }

  power(seconds: number) {
    const was = this.powered > 0;
    this.powered = Math.max(this.powered, seconds);
    if (!was) {
      audio.powerOn(this.x, this.y);
      G.fx.sparks(this.x, this.y + 10, 20, [180, 220, 255]);
    }
    for (const l of this.links) {
      if (l instanceof Lamp) l.powered = Math.max(l.powered, this.powered);
      else l.powered = Math.max(l.powered, this.powered);
    }
  }

  update(dt: number) {
    super.update(dt);
    if (this.powered > 0) {
      this.powered -= dt;
      this.spin += dt * 12;
      for (const l of this.links) {
        if (l instanceof Lamp) l.powered = Math.max(l.powered, this.powered);
        else l.powered = Math.max(l.powered, this.powered);
      }
      G.lighting.add(this.x, this.y + 20, 140, [130, 200, 255], 0.4, 0.2);
      if (chance(dt * 6)) G.fx.arc(this.x - 25, this.y + rand(10, 40), this.x + 25, this.y + rand(10, 40), [160, 220, 255], 1.5, 0.08, 6);
      if (this.powered < 3 && chance(dt * 3)) audio.crackle(this.x, this.y, 0.1);
      // electrify anything touching it
      for (const e of G.entities) {
        if (e === this || e.dead || !e.conductive) continue;
        const b = e.bounds();
        if (b.x1 > this.x - this.w / 2 - 4 && b.x0 < this.x + this.w / 2 + 4 && b.y1 > this.y - 4 && b.y0 < this.y + this.h) e.electrocute(0.3, dt * 15);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y, w, h } = this;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#56606e'); g.addColorStop(1, '#2a3038');
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = '#1b1f26';
    ctx.fillRect(x - w / 2 + 8, y + 10, w - 16, 34);
    // coil
    ctx.strokeStyle = this.powered > 0 ? '#d8b060' : '#8a6a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const yy = y + 14 + i * 5;
      ctx.moveTo(x - 18, yy); ctx.lineTo(x + 18, yy + 2);
    }
    ctx.stroke();
    // fan
    ctx.save();
    ctx.translate(x, y + 60);
    ctx.rotate(this.spin);
    ctx.fillStyle = '#7a8796';
    for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.fillRect(-2, -12, 4, 12); }
    ctx.restore();
    ctx.fillStyle = this.powered > 0 ? '#7dff9a' : '#5a2a2a';
    ctx.fillRect(x + w / 2 - 12, y + 6, 6, 6);
    ctx.fillStyle = 'rgba(255,200,40,0.7)';
    ctx.fillRect(x - w / 2, y + h - 6, w, 6);
    // label
    ctx.fillStyle = 'rgba(255,220,120,0.6)';
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ GEN', x, y + 76 - 4);
    ctx.textAlign = 'left';
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    if (this.powered > 0) {
      ctx.globalAlpha = 0.5 + Math.random() * 0.2;
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(this.x - this.w / 2 + 8, this.y + 10, this.w - 16, 34);
      ctx.globalAlpha = 1;
    }
  }
}

/** Ceiling/wall lamp. `always` lamps are on unless broken; others need power. */
export class Lamp extends Entity {
  bodies: MBody[] = [];
  x: number; y: number;
  always: boolean;
  powered = 0;
  broken = false;
  radius: number;
  color: RGB;
  private flick = 0;
  private cone = -1;

  constructor(x: number, y: number, always: boolean, radius = 300, color: RGB = [255, 230, 170]) {
    super();
    this.kind = 'lamp';
    this.mat = 'metal';
    this.conductive = true;
    this.x = x; this.y = y;
    this.always = always;
    this.radius = radius;
    this.color = color;
    this.maxHp = this.hp = 12;
  }

  get on() { return !this.broken && (this.always || this.powered > 0); }

  center(): Vec { return { x: this.x, y: this.y }; }
  bounds(): Bounds { return { x0: this.x - 12, y0: this.y - 8, x1: this.x + 12, y1: this.y + 10 }; }

  electrocute(seconds: number, _dmg: number) {
    this.charge = 1;
    this.powered = Math.max(this.powered, 8 + seconds * 2);
    this.flick = 0.6;
  }

  protected onDamaged(_a: number, type: DmgType) {
    if (type === 'elec') this.flick = 0.5;
  }

  onDestroyed() {
    this.broken = true;
    this.dead = false; // keep the fixture, just broken
    this.hp = 0;
    audio.shatter(this.x, this.y, 0.4);
    G.fx.sparks(this.x, this.y, 16, [255, 240, 200]);
    for (let i = 0; i < particles.n(10); i++) particles.emit({ kind: PK.Debris, x: this.x, y: this.y + 6, vx: rand(-120, 120), vy: rand(-100, 50), life: 1, size: rand(2, 4), color: [220, 230, 240], gravity: 1200, collide: true });
  }

  damage(amount: number, type: DmgType, sx?: number, sy?: number) {
    if (this.broken) return;
    if (type === 'elec' || type === 'fire' || type === 'steam' || type === 'water') return;
    super.damage(amount, type, sx, sy);
  }

  update(dt: number) {
    if (this.powered > 0) this.powered -= dt;
    if (this.flick > 0) this.flick -= dt;
    if (this.charge > 0) this.charge -= dt;
    if (this.on) {
      const f = this.flick > 0 ? (Math.random() < 0.5 ? 0.2 : 1.3) : 1;
      G.lighting.add(this.x, this.y + this.radius * 0.35, this.radius, this.color, 0.95 * f, 0.03);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(this.x - 2, this.y - 30, 4, 22);
    ctx.fillStyle = '#3c4450';
    ctx.beginPath();
    ctx.moveTo(this.x - 16, this.y + 4); ctx.lineTo(this.x - 8, this.y - 8); ctx.lineTo(this.x + 8, this.y - 8); ctx.lineTo(this.x + 16, this.y + 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = this.broken ? '#22262c' : this.on ? '#fff3d0' : '#5a5f68';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 4, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    if (!this.on) return;
    if (this.cone < 0) this.cone = Math.min(this.radius * 0.9, G.terrain.groundBelow(this.x, this.y + 12) - this.y);
    const L = this.cone, wk = L / (this.radius * 0.9);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = `rgb(${this.color[0]},${this.color[1]},${this.color[2]})`;
    ctx.beginPath();
    ctx.moveTo(this.x - 10, this.y + 4);
    ctx.lineTo(this.x - this.radius * 0.45 * wk, this.y + L);
    ctx.lineTo(this.x + this.radius * 0.45 * wk, this.y + L);
    ctx.lineTo(this.x + 10, this.y + 4);
    ctx.closePath();
    ctx.globalAlpha = 0.06;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 5, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}
