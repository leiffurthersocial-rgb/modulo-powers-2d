// Dynamic physical props: crates, planks, hay bales, stone blocks, boulders,
// metal boxes, barrels, ice blocks and debris chunks.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { rand, randi, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Bounds, Entity } from './entity';
import { DmgType, MATS, MatId } from './materials';
import { Bodies, Body, CAT, ipos, MBody, plug, vel, Vector } from './phys';

export type PropKind = 'crate' | 'plank' | 'hay' | 'stoneblock' | 'boulder' | 'metalbox' | 'barrel' | 'ice' | 'chunk' | 'log' | 'beam' | 'lamp' ;

export interface PropOpts {
  kind: PropKind;
  x: number; y: number;
  w?: number; h?: number; r?: number;
  mat?: MatId;
  angle?: number;
  isStatic?: boolean;
  lifetime?: number;
  sides?: number;
}

export class Prop extends Entity {
  body: MBody;
  bodies: MBody[];
  w: number; h: number; r: number;
  shape: 'rect' | 'poly';
  local: Vec[] = [];
  lifetime: number;
  age = 0;
  /** last time an impact sound played */
  private lastSound = 0;
  /** damage visual seed */
  private seed = Math.random() * 1000;
  /** thrown by Earth: deals crushing damage on contact */
  crushing = 0;
  owner: 'player' | null = null;

  constructor(o: PropOpts) {
    super();
    this.kind = o.kind;
    const defaultMat: Record<PropKind, MatId> = {
      crate: 'wood', plank: 'wood', hay: 'straw', stoneblock: 'stone', boulder: 'rock', metalbox: 'metal',
      barrel: 'wood', ice: 'ice', chunk: 'stone', log: 'wood', beam: 'metal', lamp: 'metal',
    };
    this.mat = o.mat ?? defaultMat[o.kind];
    const m = MATS[this.mat];
    this.flammable = m.flammable;
    this.conductive = m.conductive;
    this.lifetime = o.lifetime ?? 0;
    const filter = { category: o.kind === 'chunk' ? CAT.DEBRIS : CAT.PROP, mask: 0xffff };
    const common = {
      density: m.density, friction: m.friction, frictionStatic: 0.9, restitution: m.restitution,
      frictionAir: 0.004, collisionFilter: filter, isStatic: o.isStatic ?? false, angle: o.angle ?? 0,
      slop: 0.03,
    };
    if (o.kind === 'boulder' || (o.kind === 'chunk' && o.r)) {
      const r = o.r ?? 30;
      const n = o.sides ?? randi(7, 10);
      const verts: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * rand(0.8, 1.05);
        verts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
      this.body = Bodies.fromVertices(o.x, o.y, [convexHull(verts)], common as any);
      // fromVertices recentres; capture local verts relative to body position
      this.local = this.body.vertices.map((v) => ({ x: v.x - this.body.position.x, y: v.y - this.body.position.y }));
      this.shape = 'poly';
      this.w = this.h = r * 2;
      this.r = r;
    } else {
      const w = o.w ?? 44, h = o.h ?? 44;
      const chamfer = o.kind === 'hay' ? { radius: 8 } : o.kind === 'barrel' ? { radius: 6 } : o.kind === 'ice' ? { radius: 2 } : undefined;
      this.body = Bodies.rectangle(o.x, o.y, w, h, { ...common, chamfer } as any);
      this.shape = 'rect';
      this.w = w; this.h = h; this.r = Math.max(w, h) / 2;
      if (o.angle) Body.setAngle(this.body, o.angle);
    }
    plug(this.body).owner = this;
    plug(this.body).mat = this.mat;
    this.bodies = [this.body];
    const area = this.shape === 'poly' ? Math.PI * this.r * this.r : this.w * this.h;
    this.maxHp = this.hp = Math.max(10, (area / 1000) * m.hpPerArea);
    if (this.kind === 'chunk') this.maxHp = this.hp = 15;
  }

  center(): Vec { return this.body.position; }

  bounds(): Bounds {
    const b = this.body.bounds;
    return { x0: b.min.x, y0: b.min.y, x1: b.max.x, y1: b.max.y };
  }

  randomPoint(): Vec {
    // random point inside the rotated rectangle / poly
    const c = Math.cos(this.body.angle), s = Math.sin(this.body.angle);
    const lx = rand(-this.w / 2, this.w / 2) * 0.85, ly = rand(-this.h / 2, this.h / 2) * 0.85;
    return { x: this.body.position.x + lx * c - ly * s, y: this.body.position.y + lx * s + ly * c };
  }

  update(dt: number) {
    super.update(dt);
    this.age += dt;
    if (this.crushing > 0) this.crushing -= dt;
    if (this.lifetime > 0 && this.age > this.lifetime) this.remove();
    // fell out of the world
    if (this.body.position.y > G.terrain.h + 400) this.remove();
    // ice melts near heat
    if (this.mat === 'ice') {
      const c = this.center();
      const heat = G.fire.heatAt(c.x, c.y);
      if (heat > 0) this.damage(heat * dt * 30, 'fire');
    }
  }

  /** impact with speed (px/s) */
  onImpact(speed: number, other: Entity | null, point: Vec) {
    const m = MATS[this.mat];
    const now = G.time;
    if (speed > 160 && now - this.lastSound > 0.08) {
      this.lastSound = now;
      audio.impact(this.mat, point.x, point.y, Math.min(1, speed / 900) * (this.kind === 'chunk' ? 0.4 : 1));
      if (speed > 350 && (this.mat === 'stone' || this.mat === 'rock' || this.mat === 'wood' || this.mat === 'straw')) {
        G.fx.dust(point.x, point.y, Math.min(10, speed / 120), this.mat === 'straw' ? [190, 160, 90] : [110, 100, 92]);
      }
      if (speed > 300 && this.mat === 'metal') {
        for (let i = 0; i < 4; i++) particles.emit({ kind: PK.Spark, x: point.x, y: point.y, vx: rand(-300, 300), vy: rand(-400, -50), life: 0.25, size: 1.5, color: [255, 220, 150], gravity: 900 });
      }
    }
    if (speed > m.impactThreshold) {
      this.damage((speed - m.impactThreshold) * 0.06 * (other && other.mat === 'rock' ? 1.6 : 1), 'blunt', point.x, point.y);
    }
  }

  protected onDamaged(amount: number, type: DmgType) {
    if (type === 'blunt' && amount > 4 && (this.mat === 'stone' || this.mat === 'rock')) {
      const c = this.center();
      for (let i = 0; i < particles.n(3); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-this.w / 3, this.w / 3), y: c.y, vx: rand(-150, 150), vy: rand(-250, -50), life: rand(0.5, 1), size: rand(2, 5), color: MATS[this.mat].color, gravity: 1400, collide: true });
    }
  }

  onDestroyed(type: DmgType) {
    const c = this.center();
    const v = vel(this.body);
    const m = MATS[this.mat];
    this.remove();
    if (type === 'fire' && this.flammable) {
      // burnt to ash
      for (let i = 0; i < particles.n(20); i++) {
        particles.emit({ kind: PK.Debris, x: c.x + rand(-this.w / 2, this.w / 2), y: c.y + rand(-this.h / 2, this.h / 2), vx: rand(-40, 40), vy: rand(-60, 10), life: rand(1, 2.5), size: rand(2, 4), color: [50, 48, 46], gravity: 300, collide: true, drag: 1 });
        particles.emit({ kind: PK.Ember, x: c.x + rand(-this.w / 2, this.w / 2), y: c.y + rand(-this.h / 2, this.h / 2), vx: rand(-50, 50), vy: rand(-200, -60), life: rand(0.6, 1.5), size: 2, color: [255, 150, 60], flicker: 0.8 });
      }
      G.fx.smoke(c.x, c.y, 6);
      G.decals.add('ash', c.x, G.terrain.groundBelow(c.x, c.y), this.w * 0.8);
      audio.crumble(c.x, c.y, 0.3);
      // big wooden things leave a charred plank behind
      if (this.kind === 'crate' && Math.random() < 0.5) {
        const p = new Prop({ kind: 'plank', x: c.x, y: c.y, w: this.w * 0.9, h: 8, angle: rand(-0.4, 0.4), lifetime: 14 });
        p.scorch = 1; p.fuel = 0.3; p.burning = 0.4;
        G.addEntity(p);
      }
      return;
    }
    if (this.mat === 'ice') {
      audio.shatter(c.x, c.y, 0.5);
      for (let i = 0; i < particles.n(18); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-this.w / 2, this.w / 2), y: c.y + rand(-this.h / 2, this.h / 2), vx: v.x * 0.3 + rand(-200, 200), vy: v.y * 0.3 + rand(-300, 0), life: rand(0.5, 1.2), size: rand(3, 7), color: [190, 235, 255], gravity: 1400, collide: true, vrot: rand(-8, 8) });
      return;
    }
    if (this.mat === 'straw') {
      for (let i = 0; i < particles.n(30); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-this.w / 2, this.w / 2), y: c.y + rand(-this.h / 2, this.h / 2), vx: rand(-250, 250), vy: rand(-350, -50), life: rand(1, 2), size: rand(2, 5), color: [214, 178, 92], gravity: 700, collide: true, drag: 1.5, vrot: rand(-10, 10) });
      audio.impact('straw', c.x, c.y, 0.8);
      return;
    }
    // break apart into smaller pieces
    audio.crumble(c.x, c.y, 0.5);
    const splinter: [number, number, number] = this.mat === 'wood' ? [130, 90, 50] : m.color;
    for (let i = 0; i < particles.n(16); i++) particles.emit({ kind: PK.Debris, x: c.x + rand(-this.w / 2, this.w / 2), y: c.y + rand(-this.h / 2, this.h / 2), vx: v.x * 0.4 + rand(-250, 250), vy: v.y * 0.4 + rand(-350, -50), life: rand(0.6, 1.4), size: rand(2, 6), color: splinter, gravity: 1400, collide: true, vrot: rand(-10, 10) });
    G.fx.dust(c.x, c.y, 8, this.mat === 'wood' ? [120, 95, 70] : [110, 105, 100]);
    if (this.kind === 'crate' || this.kind === 'barrel') {
      for (let i = 0; i < 3; i++) {
        const a = this.body.angle + rand(-0.5, 0.5);
        const p = new Prop({ kind: 'plank', x: c.x + rand(-10, 10), y: c.y + (i - 1) * 12, w: this.w * rand(0.6, 0.95), h: 7, angle: a, lifetime: 12 });
        p.burning = this.burning; p.wet = this.wet; p.scorch = this.scorch;
        G.addEntity(p);
        p.applyImpulse(v.x * p.mass() * 0.5 + rand(-150, 150) * p.mass(), v.y * p.mass() * 0.5 - rand(50, 250) * p.mass());
      }
    } else if ((this.mat === 'stone' || this.mat === 'rock') && this.kind !== 'chunk' && this.r > 14) {
      const n = Math.min(4, Math.max(2, Math.round(this.r / 12)));
      for (let i = 0; i < n; i++) {
        const p = new Prop({ kind: 'chunk', mat: this.mat, x: c.x + rand(-this.w / 4, this.w / 4), y: c.y + rand(-this.h / 4, this.h / 4), r: Math.max(7, this.r * rand(0.3, 0.45)), lifetime: rand(8, 12) });
        G.addEntity(p);
        p.applyImpulse((v.x * 0.5 + rand(-200, 200)) * p.mass(), (v.y * 0.5 - rand(80, 260)) * p.mass());
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number) {
    const p = ipos(this.body, alpha);
    const m = MATS[this.mat];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    let fade = 1;
    if (this.lifetime > 0) fade = Math.min(1, (this.lifetime - this.age) / 1);
    ctx.globalAlpha = fade;
    const path = () => {
      ctx.beginPath();
      if (this.shape === 'rect') {
        if (this.kind === 'hay' || this.kind === 'barrel') roundRect(ctx, -this.w / 2, -this.h / 2, this.w, this.h, this.kind === 'hay' ? 8 : 6);
        else ctx.rect(-this.w / 2, -this.h / 2, this.w, this.h);
      } else {
        const ca = Math.cos(-this.body.angle), sa = Math.sin(-this.body.angle);
        // local verts were captured at angle 0
        this.local.forEach((v, i) => {
          if (i === 0) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y);
        });
        ctx.closePath();
        void ca; void sa;
      }
    };
    const col = `rgb(${m.color[0]},${m.color[1]},${m.color[2]})`;
    const dark = `rgb(${m.dark[0]},${m.dark[1]},${m.dark[2]})`;
    const w = this.w, h = this.h;
    switch (this.kind) {
      case 'crate': {
        ctx.fillStyle = col; path(); ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 4;
        ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-w / 2 + 4, -h / 2 + 4); ctx.lineTo(w / 2 - 4, h / 2 - 4); ctx.moveTo(w / 2 - 4, -h / 2 + 4); ctx.lineTo(-w / 2 + 4, h / 2 - 4); ctx.stroke();
        ctx.fillStyle = 'rgba(255,230,190,0.15)'; ctx.fillRect(-w / 2, -h / 2, w, 2);
        break;
      }
      case 'plank': case 'log': {
        ctx.fillStyle = col; path(); ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h * 0.15); ctx.lineTo(w / 2 - 3, -h * 0.1); ctx.stroke();
        break;
      }
      case 'barrel': {
        ctx.fillStyle = col; path(); ctx.fill();
        ctx.fillStyle = '#4b5562';
        ctx.fillRect(-w / 2, -h / 2 + h * 0.18, w, 4); ctx.fillRect(-w / 2, h / 2 - h * 0.18 - 4, w, 4);
        break;
      }
      case 'hay': {
        ctx.fillStyle = col; path(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,85,30,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const yy = -h / 2 + 4 + ((i * 7.3 + this.seed) % (h - 8));
          ctx.moveTo(-w / 2 + 4, yy); ctx.lineTo(w / 2 - 4, yy + ((i % 3) - 1) * 2);
        }
        ctx.stroke();
        ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-w * 0.22, -h / 2, 3, h); ctx.fillRect(w * 0.18, -h / 2, 3, h);
        break;
      }
      case 'metalbox': case 'beam': case 'lamp': {
        const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
        g.addColorStop(0, '#8a98aa'); g.addColorStop(1, '#4a5564');
        ctx.fillStyle = g; path(); ctx.fill();
        ctx.strokeStyle = '#2c333d'; ctx.lineWidth = 2; ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
        ctx.fillStyle = '#c8d4e0';
        if (w > 20 && h > 20) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(sx * (w / 2 - 6) - 1.5, sy * (h / 2 - 6) - 1.5, 3, 3);
        if (this.kind === 'metalbox' && w > 30) {
          ctx.fillStyle = 'rgba(255,200,40,0.7)';
          ctx.fillRect(-w / 2 + 6, -3, w - 12, 6);
        }
        break;
      }
      case 'ice': {
        ctx.fillStyle = 'rgba(160,220,255,0.7)'; path(); ctx.fill();
        ctx.strokeStyle = 'rgba(230,250,255,0.9)'; ctx.lineWidth = 1.5; path(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-w / 2 + 5, -h / 2 + 8); ctx.lineTo(-w / 2 + 14, -h / 2 + 3); ctx.stroke();
        break;
      }
      default: {
        // stone, boulders, chunks
        const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
        g.addColorStop(0, col); g.addColorStop(1, dark);
        ctx.fillStyle = g; path(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; path(); ctx.stroke();
        if (this.kind === 'stoneblock') {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(-w / 4, -h / 2 + 3, w / 3, 2);
      }
    }
    // cracks from damage
    const dmg = 1 - this.hp / this.maxHp;
    if (dmg > 0.25 && this.kind !== 'chunk') {
      ctx.strokeStyle = this.mat === 'ice' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const n = Math.floor(dmg * 5);
      for (let i = 0; i < n; i++) {
        const a = this.seed + i * 2.1;
        let x = Math.cos(a) * w * 0.1, y = Math.sin(a) * h * 0.1;
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += Math.cos(a + k * 0.7) * w * 0.15;
          y += Math.sin(a + k * 0.9) * h * 0.15;
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    this.drawStatusOverlay(ctx, path);
    ctx.restore();
  }

  drawGlow(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.charge > 0.05 || (this.burning > 0 && this.mat !== 'metal') || this.crushing > 0) {
      const p = ipos(this.body, alpha);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      if (this.charge > 0.05) {
        ctx.globalAlpha = Math.min(1, this.charge);
        ctx.strokeStyle = '#9fd8ff';
        ctx.lineWidth = 3;
        ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
      }
      if (this.burning > 0) {
        ctx.globalAlpha = this.burning * 0.4;
        ctx.fillStyle = '#ff7a20';
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      }
      ctx.restore();
    }
  }
}

/** monotone-chain convex hull (Matter needs convex vertices without poly-decomp) */
function convexHull(pts: Vec[]): Vec[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [], upper: Vec[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export { Vector };
