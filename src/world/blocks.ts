// Static-but-dynamic blocks: earth pillars, ice walls, ice bridges on water,
// breakable stone walls and powered metal doors.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { clamp, easeOutBack, rand, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { Bounds, Entity } from './entity';
import { DmgType, MatId } from './materials';
import { addVel, Bodies, Body, CAT, MBody, plug } from './phys';

export type BlockStyle = 'pillar' | 'icewall' | 'iceslab' | 'wall' | 'door';

export class Block extends Entity {
  body: MBody;
  bodies: MBody[];
  x: number; y: number; w: number; h: number;
  style: BlockStyle;
  lifetime: number;
  age = 0;
  rise = 1; // 0..1 rising animation
  riseDur = 0;
  stamped = false;
  /** door: 0 closed .. 1 open */
  open = 0;
  powered = 0;
  private seed = Math.random() * 100;

  constructor(x: number, y: number, w: number, h: number, style: BlockStyle, opts: { lifetime?: number; rise?: number } = {}) {
    super();
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.style = style;
    this.kind = style;
    const mat: MatId = style === 'icewall' || style === 'iceslab' ? 'ice' : style === 'door' ? 'metal' : 'stone';
    this.mat = mat;
    this.conductive = mat === 'metal';
    this.lifetime = opts.lifetime ?? 0;
    this.maxHp = this.hp = style === 'pillar' ? 160 : style === 'wall' ? 260 : style === 'door' ? 1e9 : style === 'iceslab' ? 120 : 90;
    if (style === 'door') this.invulnerable = true;
    this.riseDur = opts.rise ?? 0;
    this.rise = this.riseDur > 0 ? 0 : 1;
    const startY = this.riseDur > 0 ? y + h : y;
    this.body = Bodies.rectangle(x + w / 2, startY + h / 2, w, h, {
      isStatic: true, friction: mat === 'ice' ? 0.03 : 0.8, frictionStatic: mat === 'ice' ? 0.05 : 1,
      collisionFilter: { category: CAT.TERRAIN, mask: 0xffff }, label: 'block',
    });
    plug(this.body).owner = this;
    plug(this.body).terrain = true;
    plug(this.body).mat = mat;
    this.bodies = [this.body];
    if (this.rise >= 1) this.doStamp(true);
  }

  private doStamp(on: boolean) {
    if (on === this.stamped) return;
    this.stamped = on;
    G.terrain.stamp(this.x, this.y, this.w, this.h, on ? 1 : -1);
  }

  center(): Vec { return { x: this.body.position.x, y: this.body.position.y }; }
  bounds(): Bounds {
    const b = this.body.bounds;
    return { x0: b.min.x, y0: b.min.y, x1: b.max.x, y1: b.max.y };
  }

  update(dt: number) {
    super.update(dt);
    this.age += dt;
    if (this.rise < 1) {
      const prev = this.rise;
      this.rise = Math.min(1, this.rise + dt / this.riseDur);
      const k = easeOutBack(this.rise);
      const k0 = easeOutBack(prev);
      const yNow = this.y + this.h * (1 - k);
      const dy = (this.y + this.h * (1 - k0)) - yNow; // upward movement this step
      Body.setPosition(this.body, { x: this.x + this.w / 2, y: yNow + this.h / 2 });
      // launch whatever stands on (or is inside) the rising top
      if (dy > 0) {
        const top = yNow;
        const launchV = clamp((dy / dt) * 1.1, 0, 1400);
        for (const b of G.dynamicBodies) {
          const bb = b.bounds;
          if (bb.max.x < this.x - 2 || bb.min.x > this.x + this.w + 2) continue;
          if (bb.max.y < top - 12 || bb.min.y > top + this.h) continue;
          if (b.velocity.y * 60 > -launchV) addVel(b, 0, -launchV - b.velocity.y * 60);
          Body.setPosition(b, { x: b.position.x, y: Math.min(b.position.y, top - (bb.max.y - b.position.y) - 1) });
        }
        const pl = G.player;
        if (!pl.phasing && pl.x > this.x - 14 && pl.x < this.x + this.w + 14 && pl.y + 38 > top - 12 && pl.y - 38 < top + this.h) {
          pl.launch(0, -launchV * 1.05);
          Body.setPosition(pl.body, { x: pl.body.position.x, y: Math.min(pl.body.position.y, top - 40) });
        }
      }
      if (this.rise >= 1) this.doStamp(true);
    }
    if (this.style === 'door') {
      const want = this.powered > 0 ? 1 : 0;
      if (this.powered > 0) this.powered -= dt;
      const prev = this.open;
      this.open = clamp(this.open + (want ? dt * 1.2 : -dt * 0.8), 0, 1);
      if (this.open !== prev) {
        if (this.stamped && this.open > 0.6) this.doStamp(false);
        if (!this.stamped && this.open < 0.6) this.doStamp(true);
        Body.setPosition(this.body, { x: this.x + this.w / 2, y: this.y + this.h / 2 - this.open * (this.h - 6) });
        if (Math.random() < dt * 10) audio.tone({ type: 'sawtooth', freq: 70, vol: 0.05, decay: 0.1, filter: 400, x: this.x, y: this.y });
      }
    }
    if (this.mat === 'ice') {
      const c = this.center();
      const heat = G.fire.heatAt(c.x, c.y);
      if (heat > 0) {
        this.damage(heat * dt * 40, 'fire');
        if (Math.random() < dt * 8) particles.emit({ kind: PK.Drop, x: c.x + rand(-this.w / 2, this.w / 2), y: this.y + this.h, vy: 60, life: 0.6, size: 1.6, color: [150, 210, 255], gravity: 900, collide: true });
      }
    }
    if (this.lifetime > 0 && this.age > this.lifetime) this.crumble();
  }

  crumble() {
    if (this.dead) return;
    this.dead = true;
    this.onDestroyed('blunt');
  }

  onDestroyed(_type: DmgType) {
    this.doStamp(false);
    this.remove();
    const c = this.center();
    const ice = this.mat === 'ice';
    if (ice) audio.shatter(c.x, c.y, 0.6); else audio.crumble(c.x, c.y, 0.7);
    const col: [number, number, number] = ice ? [190, 235, 255] : [110, 104, 96];
    const n = particles.n(Math.min(50, (this.w * this.h) / 120));
    for (let i = 0; i < n; i++) {
      particles.emit({ kind: PK.Debris, x: rand(this.x, this.x + this.w), y: rand(this.body.bounds.min.y, this.body.bounds.max.y), vx: rand(-150, 150), vy: rand(-250, 0), life: rand(0.6, 1.4), size: rand(3, 8), color: col, gravity: 1400, collide: true, vrot: rand(-8, 8) });
    }
    if (!ice) {
      G.fx.dust(c.x, this.y + this.h, 14, [110, 100, 90]);
      // leave some loose rubble bodies
      const chunks = Math.min(5, Math.floor((this.w * this.h) / 1600));
      for (let i = 0; i < chunks; i++) {
        G.spawnProp({ kind: 'chunk', mat: 'stone', x: rand(this.x + 8, this.x + this.w - 8), y: rand(this.body.bounds.min.y + 8, this.body.bounds.max.y - 8), r: rand(8, 13), lifetime: rand(7, 11) });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const b = this.body.bounds;
    const x = b.min.x, y = b.min.y, w = b.max.x - b.min.x, h = b.max.y - b.min.y;
    // clip below ground for the rising pillar
    ctx.save();
    if (this.rise < 1 || this.style === 'pillar') {
      ctx.beginPath();
      ctx.rect(x - 10, y - 10, w + 20, this.y + this.h - y + 10);
      ctx.clip();
    }
    const dmg = 1 - this.hp / this.maxHp;
    switch (this.style) {
      case 'pillar': {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#5d5148'); g.addColorStop(0.5, '#7a6c60'); g.addColorStop(1, '#4a4038');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let yy = y + 22; yy < y + h; yy += 26) { ctx.moveTo(x, yy + Math.sin(yy + this.seed) * 3); ctx.lineTo(x + w, yy + Math.cos(yy + this.seed) * 3); }
        ctx.stroke();
        ctx.fillStyle = '#8f8070'; ctx.fillRect(x - 2, y, w + 4, 6);
        break;
      }
      case 'wall': {
        ctx.fillStyle = '#3d3a40';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let yy = y + 20, r = 0; yy < y + h; yy += 20, r++) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
        for (let yy = y, r = 0; yy < y + h; yy += 20, r++) for (let xx = x + (r % 2) * 18; xx < x + w; xx += 36) { ctx.moveTo(xx, yy); ctx.lineTo(xx, Math.min(y + h, yy + 20)); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, 2);
        break;
      }
      case 'door': {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#3a4452'); g.addColorStop(0.5, '#56657a'); g.addColorStop(1, '#333c48');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,200,40,0.55)';
        for (let yy = y + 10; yy < y + h - 10; yy += 26) ctx.fillRect(x + 3, yy, w - 6, 8);
        ctx.fillStyle = this.open > 0.05 || this.powered > 0 ? '#7dff9a' : '#ff5a4a';
        ctx.fillRect(x + w / 2 - 3, y + h - 14, 6, 6);
        break;
      }
      case 'icewall':
      case 'iceslab': {
        ctx.fillStyle = 'rgba(150,215,255,0.72)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(235,250,255,0.95)'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const sx = x + ((this.seed * (i + 1) * 13) % w);
          ctx.moveTo(sx, y + 3); ctx.lineTo(sx + 8, y + Math.min(h - 3, 14 + i * 6));
        }
        ctx.stroke();
        break;
      }
    }
    if (dmg > 0.2 && this.style !== 'door') {
      ctx.strokeStyle = this.mat === 'ice' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const n = Math.ceil(dmg * 6);
      for (let i = 0; i < n; i++) {
        let px = x + ((this.seed * 7 + i * 37) % w), py = y + ((this.seed * 3 + i * 53) % h);
        ctx.moveTo(px, py);
        for (let k = 0; k < 4; k++) { px += Math.sin(i * 3 + k) * 9; py += 7 + Math.cos(i + k * 2) * 4; ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGlow(ctx: CanvasRenderingContext2D) {
    if (this.style === 'door' && (this.powered > 0 || this.charge > 0.1)) {
      const b = this.body.bounds;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
      ctx.globalAlpha = 1;
    }
  }
}
