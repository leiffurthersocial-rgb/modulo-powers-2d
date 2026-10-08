// Active-ragdoll stickman used for training dummies and wandering NPCs.
// Every limb is a Matter body; when conscious, PD "muscles" drive limbs toward
// an animated pose and a support force keeps the pelvis up. Hits knock them
// out (muscles off = full ragdoll), then they get back up.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { angleLerp, chance, clamp, rand, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { drawStick, StickJoints } from '../render/stickdraw';
import { Bounds, Entity } from './entity';
import { DmgType } from './materials';
import { addVel, Bodies, Body, CAT, Composite, Constraint, ipos, MBody, plug, vel } from './phys';
import Matter from 'matter-js';

const TORSO = 28, UA = 15, LA = 15, TH = 18, SH = 18, HEAD = 8;
export const STAND_H = TH + SH + 1; // pelvis height above feet

type PartName = 'torso' | 'head' | 'uaL' | 'laL' | 'uaR' | 'laR' | 'thL' | 'shL' | 'thR' | 'shR';

interface Pose { torso: number; uaL: number; laL: number; uaR: number; laR: number; thL: number; shL: number; thR: number; shR: number }

let groupCounter = -10;

export type StickRole = 'dummy' | 'npc' | 'corpse';

export class Stickman extends Entity {
  bodies: MBody[] = [];
  parts = {} as Record<PartName, MBody>;
  joints: Matter.Constraint[] = [];
  private jointOf: Record<string, Matter.Constraint[]> = {};
  detached = { armL: false, armR: false, legL: false, legR: false };
  role: StickRole;
  facing = 1;
  /** seconds remaining knocked out */
  ko = 0;
  strength = 1;
  walkPhase = 0;
  targetVx = 0;
  color: string;
  spawn: Vec;
  deadTime = 0;
  private frozenPose: Pose | null = null;
  // AI
  aiState: 'idle' | 'wander' | 'alert' | 'flee' | 'panic' | 'lost' = 'idle';
  aiTimer = rand(1, 3);
  aiTarget = 0;
  mark: '!' | '?' | '' = '';
  markT = 0;
  grounded = false;
  private lastHurtSound = 0;
  armorGlow = 0;

  constructor(x: number, y: number, role: StickRole, color?: string) {
    super();
    this.kind = role === 'npc' ? 'npc' : 'dummy';
    this.role = role;
    this.mat = 'flesh';
    this.conductive = true;
    this.flammable = false;
    this.maxHp = this.hp = role === 'npc' ? 90 : 130;
    this.spawn = { x, y };
    this.color = color ?? (role === 'npc' ? '#9fc8ff' : '#e7e2d6');
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.build(x, y);
  }

  private build(x: number, py: number) {
    // py = ground level under feet
    const y = py - STAND_H;
    const group = groupCounter--;
    const filter = { group, category: CAT.CHAR, mask: 0xffff };
    const opt = (density: number) => ({ density, friction: 0.6, frictionStatic: 0.8, restitution: 0.05, frictionAir: 0.02, collisionFilter: filter, slop: 0.02 });
    const cap = (cx: number, cy: number, len: number, th: number, d: number) => Bodies.rectangle(cx, cy, th, len + th * 0.6, { ...opt(d), chamfer: { radius: th / 2 - 0.5 } } as any);
    const P = this.parts;
    P.torso = cap(x, y - TORSO / 2, TORSO, 9, 0.0022);
    P.head = Bodies.circle(x, y - TORSO - HEAD - 2, HEAD, opt(0.0016) as any);
    P.uaL = cap(x, y - TORSO + 2 + UA / 2, UA, 5, 0.0016);
    P.laL = cap(x, y - TORSO + 2 + UA + LA / 2, LA, 5, 0.0016);
    P.uaR = cap(x, y - TORSO + 2 + UA / 2, UA, 5, 0.0016);
    P.laR = cap(x, y - TORSO + 2 + UA + LA / 2, LA, 5, 0.0016);
    P.thL = cap(x, y + TH / 2, TH, 6, 0.0018);
    P.shL = cap(x, y + TH + SH / 2, SH, 6, 0.0018);
    P.thR = cap(x, y + TH / 2, TH, 6, 0.0018);
    P.shR = cap(x, y + TH + SH / 2, SH, 6, 0.0018);
    P.shL.friction = P.shR.friction = 1.2;
    for (const k in P) {
      const b = P[k as PartName];
      plug(b).owner = this;
      (b as any).partName = k;
      this.bodies.push(b);
    }
    const j = (name: string, a: MBody, pa: Vec, b: MBody, pb: Vec, stiffness = 1, length = 0) => {
      const c = Constraint.create({ bodyA: a, pointA: pa, bodyB: b, pointB: pb, stiffness, length, damping: 0.05 } as any);
      this.joints.push(c);
      (this.jointOf[name] ||= []).push(c);
      return c;
    };
    j('neck', P.torso, { x: 0, y: -TORSO / 2 }, P.head, { x: 0, y: HEAD + 1 });
    j('neck', P.torso, { x: 0, y: 0 }, P.head, { x: 0, y: 0 }, 0.4, TORSO / 2 + HEAD + 1);
    j('armL', P.torso, { x: 0, y: -TORSO / 2 + 2 }, P.uaL, { x: 0, y: -UA / 2 });
    j('elbowL', P.uaL, { x: 0, y: UA / 2 }, P.laL, { x: 0, y: -LA / 2 });
    j('armR', P.torso, { x: 0, y: -TORSO / 2 + 2 }, P.uaR, { x: 0, y: -UA / 2 });
    j('elbowR', P.uaR, { x: 0, y: UA / 2 }, P.laR, { x: 0, y: -LA / 2 });
    j('legL', P.torso, { x: 0, y: TORSO / 2 }, P.thL, { x: 0, y: -TH / 2 });
    j('kneeL', P.thL, { x: 0, y: TH / 2 }, P.shL, { x: 0, y: -SH / 2 });
    j('legR', P.torso, { x: 0, y: TORSO / 2 }, P.thR, { x: 0, y: -TH / 2 });
    j('kneeR', P.thR, { x: 0, y: TH / 2 }, P.shR, { x: 0, y: -SH / 2 });
  }

  addToWorld(world: Matter.World) {
    Composite.add(world, this.bodies);
    Composite.add(world, this.joints);
  }

  removeFromWorld(world: Matter.World) {
    Composite.remove(world, this.bodies);
    Composite.remove(world, this.joints);
  }

  center(): Vec { return this.parts.torso.position; }

  bounds(): Bounds {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of this.bodies) {
      x0 = Math.min(x0, b.bounds.min.x); y0 = Math.min(y0, b.bounds.min.y);
      x1 = Math.max(x1, b.bounds.max.x); y1 = Math.max(y1, b.bounds.max.y);
    }
    return { x0, y0, x1, y1 };
  }

  randomPoint(): Vec {
    const b = this.bodies[(Math.random() * this.bodies.length) | 0];
    return { x: b.position.x + rand(-3, 3), y: b.position.y + rand(-5, 5) };
  }

  /** knock out for some seconds */
  knock(seconds: number) {
    if (seconds <= 0) return;
    this.ko = Math.max(this.ko, seconds);
  }

  applyImpulse(jx: number, jy: number, px?: number, py?: number) {
    const m = this.mass();
    const mag = Math.hypot(jx, jy) / m;
    // big hits knock out
    if (mag > 260) this.knock(clamp((mag - 200) / 300, 0.5, 4));
    if (px !== undefined && py !== undefined && mag > 100) {
      // concentrate part of the impulse on the parts nearest to the hit point
      for (const b of this.bodies) {
        const d = Math.hypot(b.position.x - px, b.position.y - py);
        const k = 0.6 + 0.8 * clamp(1 - d / 60, 0, 1);
        addVel(b, (jx / m) * k, (jy / m) * k);
      }
      return;
    }
    super.applyImpulse(jx, jy);
  }

  protected onDamaged(amount: number, type: DmgType) {
    this.startle = 0.8;
    if (amount > 8) this.knock(Math.min(3, amount / 15));
    if (amount > 2 && G.time - this.lastHurtSound > 0.25) {
      this.lastHurtSound = G.time;
      const c = this.center();
      audio.impact('straw', c.x, c.y, 0.3);
    }
    if (this.role === 'npc' && !this.dead) {
      this.aiState = this.burning > 0 ? 'panic' : 'flee';
      this.aiTimer = rand(3, 5);
      this.setMark('!');
    }
    // big hits can pop off a limb (stickman style: no gore)
    if (amount > 34 && (type === 'blunt' || type === 'elec' || type === 'pierce') && Math.random() < 0.55) this.detachRandom();
  }

  detachRandom() {
    const opts = (['armL', 'armR', 'legL', 'legR'] as const).filter((k) => !this.detached[k]);
    if (!opts.length) return;
    const k = opts[(Math.random() * opts.length) | 0];
    this.detached[k] = true;
    for (const c of this.jointOf[k] || []) Composite.remove(G.engine.world, c);
    const p = k === 'armL' ? this.parts.uaL : k === 'armR' ? this.parts.uaR : k === 'legL' ? this.parts.thL : this.parts.thR;
    for (let i = 0; i < 10; i++) particles.emit({ kind: PK.Spark, x: p.position.x, y: p.position.y, vx: rand(-300, 300), vy: rand(-300, 100), life: 0.3, size: 1.5, color: [255, 240, 200], gravity: 600 });
    addVel(p, rand(-200, 200), -rand(100, 300));
  }

  onDestroyed(type: DmgType) {
    this.ko = 999;
    this.deadTime = 0;
    const c = this.center();
    if (type === 'cold') {
      // shattered: break every joint
      for (const k of ['armL', 'armR', 'legL', 'legR', 'neck'] as const) {
        for (const cc of this.jointOf[k] || []) Composite.remove(G.engine.world, cc);
        if (k !== 'neck') this.detached[k] = true;
      }
      for (const b of this.bodies) addVel(b, rand(-300, 300), rand(-400, -50));
    } else if (type === 'blunt' || type === 'elec') {
      if (Math.random() < 0.6) this.detachRandom();
    }
    if (this.role === 'npc') this.mark = '';
    audio.thud(c.x, c.y, 0.4);
  }

  /** support probe: distance from pelvis down to something standable, or -1 */
  private groundDist(): number {
    const t = this.parts.torso;
    const px = t.position.x, py = t.position.y + TORSO / 2;
    const max = STAND_H + 28;
    let best = G.terrain.rayGrid(px, py, 0, 1, max, 3);
    // props & other stuff (bounds-based approximation)
    for (const b of G.dynamicBodies) {
      if ((b.plugin as any).owner === this) continue;
      const bb = b.bounds;
      if (px < bb.min.x || px > bb.max.x) continue;
      const d = bb.min.y - py;
      if (d >= -4 && d <= max && (best < 0 || d < best)) best = Math.max(0, d);
    }
    for (const s of G.terrain.solids) {
      if (!s.oneway) continue;
      if (px < s.x || px > s.x + s.w) continue;
      const d = s.y - py;
      if (d >= 0 && d <= max && (best < 0 || d < best)) best = d;
    }
    return best;
  }

  private pose(): Pose {
    const f = this.facing;
    const t = G.time;
    const breathe = Math.sin(t * 2 + this.id) * 0.03;
    if (this.role === 'npc' && (this.aiState === 'panic' || this.burning > 0.2)) {
      const w = Math.sin(t * 14 + this.id) * 0.5;
      const ph = this.walkPhase;
      return {
        torso: f * 0.15, uaL: Math.PI - 0.5 + w, laL: Math.PI - 0.3 - w, uaR: Math.PI + 0.5 - w, laR: Math.PI + 0.3 + w,
        thL: -f * 0.7 * Math.sin(ph), shL: -f * 0.7 * Math.sin(ph) + f * 0.6 * Math.max(0, Math.cos(ph)),
        thR: -f * 0.7 * Math.sin(ph + Math.PI), shR: -f * 0.7 * Math.sin(ph + Math.PI) + f * 0.6 * Math.max(0, Math.cos(ph + Math.PI)),
      };
    }
    if (this.startle > 0 || (this.role === 'npc' && this.aiState === 'alert')) {
      // guard / flinch
      return { torso: -f * 0.12, uaL: -f * 2.2, laL: -f * 2.9, uaR: -f * 1.9, laR: -f * 2.7, thL: -f * 0.25, shL: f * 0.1, thR: f * 0.3, shR: f * 0.35 };
    }
    const sp = Math.abs(this.targetVx);
    if (sp > 10) {
      const ph = this.walkPhase;
      const amp = Math.min(0.75, 0.35 + sp / 300);
      const s1 = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
      return {
        torso: -f * Math.min(0.25, sp / 900),
        uaL: f * amp * 0.8 * s1, laL: f * amp * 0.8 * s1 - f * 0.5,
        uaR: f * amp * 0.8 * s2, laR: f * amp * 0.8 * s2 - f * 0.5,
        thL: -f * amp * s1, shL: -f * amp * s1 + f * 0.7 * Math.max(0, -Math.cos(ph)),
        thR: -f * amp * s2, shR: -f * amp * s2 + f * 0.7 * Math.max(0, -Math.cos(ph + Math.PI)),
      };
    }
    if (this.role === 'dummy') {
      return { torso: breathe * 0.3, uaL: 0.55, laL: 0.25, uaR: -0.55, laR: -0.25, thL: 0.14, shL: 0.1, thR: -0.14, shR: -0.1 };
    }
    return { torso: breathe, uaL: 0.15 + breathe, laL: 0.08, uaR: -0.15 - breathe, laR: -0.08, thL: 0.1, shL: 0.05, thR: -0.1, shR: -0.05 };
  }

  private drive(part: MBody, target: number, kp: number, kd: number) {
    let err = target - part.angle;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const av = part.angularVelocity;
    Body.setAngularVelocity(part, av + (kp * err - kd * av));
  }

  update(dt: number) {
    super.update(dt);
    const P = this.parts;
    if (this.dead) {
      this.deadTime += dt;
      if (this.deadTime > 6) this.remove();
      return;
    }
    if (this.ko > 0) this.ko -= dt;
    if (P.torso.position.y > G.terrain.h + 300) { this.dead = true; this.deadTime = 5; return; }

    // frozen solid: lock the pose rigidly, no muscles
    if (this.frozen > 0) {
      if (!this.frozenPose) {
        this.frozenPose = { torso: P.torso.angle, uaL: P.uaL.angle, laL: P.laL.angle, uaR: P.uaR.angle, laR: P.laR.angle, thL: P.thL.angle, shL: P.shL.angle, thR: P.thR.angle, shR: P.shR.angle };
        this.strength = 0;
      }
      const base = P.torso.angle - this.frozenPose.torso;
      for (const k of ['uaL', 'laL', 'uaR', 'laR', 'thL', 'shL', 'thR', 'shR'] as const) this.drive(P[k], this.frozenPose[k] + base, 0.9, 0.9);
      return;
    }
    this.frozenPose = null;

    // electrocution spasms
    if (this.shock > 0) {
      for (const b of this.bodies) {
        if (chance(0.5)) Body.setAngularVelocity(b, b.angularVelocity + rand(-0.35, 0.35));
        if (chance(0.15)) addVel(b, rand(-60, 60), rand(-90, 20));
      }
      this.strength = Math.max(0, this.strength - dt * 4);
      return;
    }

    const wantStrength = this.ko > 0 || this.detached.legL && this.detached.legR ? 0 : 1;
    this.strength += (wantStrength - this.strength) * Math.min(1, dt * (wantStrength > this.strength ? 1.6 : 8));
    const s = this.strength;

    if (this.role === 'npc') this.think(dt);
    if (this.markT > 0) { this.markT -= dt; if (this.markT <= 0) this.mark = ''; }

    if (s < 0.05) { this.grounded = false; return; }

    const pose = this.pose();
    // upright torso + head
    const tkp = 0.12 * s, tkd = 0.35 * s;
    this.drive(P.torso, pose.torso, tkp, tkd);
    this.drive(P.head, pose.torso * 0.5, 0.05 * s, 0.2 * s);
    const lkp = 0.18 * s, lkd = 0.3 * s;
    if (!this.detached.armL) { this.drive(P.uaL, pose.uaL, lkp, lkd); this.drive(P.laL, pose.laL, lkp, lkd); }
    if (!this.detached.armR) { this.drive(P.uaR, pose.uaR, lkp, lkd); this.drive(P.laR, pose.laR, lkp, lkd); }
    if (!this.detached.legL) { this.drive(P.thL, pose.thL, lkp * 1.4, lkd); this.drive(P.shL, pose.shL, lkp * 1.4, lkd); }
    if (!this.detached.legR) { this.drive(P.thR, pose.thR, lkp * 1.4, lkd); this.drive(P.shR, pose.shR, lkp * 1.4, lkd); }

    // support force: hold pelvis at standing height above whatever is below
    const gd = this.groundDist();
    this.grounded = gd >= 0;
    if (gd >= 0) {
      const err = gd - STAND_H; // positive = too high (falling), negative = too low (crouched)
      const tv = vel(P.torso);
      const upright = Math.cos(P.torso.angle);
      if (upright > 0.2 || s > 0.6) {
        // lift (stronger when low), never pull down hard
        const ay = clamp(err * 30 - tv.y * 4, -1800, 400) * s;
        const dvy = ay * dt;
        // distribute to torso & head (legs are carried by joints)
        addVel(P.torso, 0, dvy);
        addVel(P.head, 0, dvy * 0.7);
        // counter gravity on upper body
        const g = G.engine.gravity.y * G.engine.gravity.scale * 3600 * 60; // px/s²
        void g;
        addVel(P.torso, 0, -1600 * dt * s * 0.85);
        addVel(P.head, 0, -1600 * dt * s * 0.8);
        addVel(P.uaL, 0, -1600 * dt * s * 0.4); addVel(P.uaR, 0, -1600 * dt * s * 0.4);
        // horizontal drive
        const dvx = (this.targetVx - tv.x) * Math.min(1, dt * 8) * s;
        addVel(P.torso, dvx, 0);
        addVel(P.head, dvx * 0.8, 0);
        // keep feet under the hips
        const fx = (P.shL.position.x + P.shR.position.x) / 2;
        const off = P.torso.position.x - fx;
        addVel(P.shL, off * 4 * dt * 60 * 0.15 * s, 0);
        addVel(P.shR, off * 4 * dt * 60 * 0.15 * s, 0);
        // head above torso
        const hx = P.head.position.x - P.torso.position.x;
        addVel(P.head, -hx * 6 * s * dt * 60 * 0.1, 0);
      }
      if (Math.abs(this.targetVx) > 10) this.walkPhase += dt * Math.abs(this.targetVx) / 14;
    }
  }

  setMark(m: '!' | '?') { this.mark = m; this.markT = 1.6; }

  private think(dt: number) {
    const pl = G.player;
    const c = this.center();
    const dx = pl.x - c.x, dy = pl.y - c.y;
    const d = Math.hypot(dx, dy);
    const visible = pl.visibility() > 0.35 && !pl.dead;
    const canSee = visible && d < 520 && G.terrain.rayGrid(c.x, c.y - 20, dx / d, dy / d, d - 20, 10) < 0;
    this.aiTimer -= dt;
    if (this.burning > 0.1 && this.aiState !== 'panic') { this.aiState = 'panic'; this.aiTimer = 3; this.setMark('!'); }
    switch (this.aiState) {
      case 'idle':
        this.targetVx = 0;
        if (canSee && d < 260 && chance(dt)) { this.facing = Math.sign(dx) || 1; }
        if (this.aiTimer <= 0) { this.aiState = 'wander'; this.aiTimer = rand(2, 5); this.aiTarget = clamp(this.spawn.x + rand(-300, 300), 100, G.terrain.w - 100); }
        break;
      case 'wander': {
        const tx = this.aiTarget - c.x;
        this.facing = Math.sign(tx) || this.facing;
        this.targetVx = Math.abs(tx) < 20 ? 0 : Math.sign(tx) * 70;
        if (this.aiTimer <= 0 || Math.abs(tx) < 20) { this.aiState = 'idle'; this.aiTimer = rand(1.5, 4); }
        if (canSee && d < 240) { this.aiState = 'alert'; this.aiTimer = rand(0.8, 1.4); this.setMark('!'); this.facing = Math.sign(dx) || 1; }
        break;
      }
      case 'alert':
        this.targetVx = 0;
        this.facing = Math.sign(dx) || 1;
        if (!canSee) { this.aiState = 'lost'; this.aiTimer = 2; this.setMark('?'); }
        else if (this.aiTimer <= 0) { this.aiState = 'idle'; this.aiTimer = rand(2, 4); }
        break;
      case 'flee': {
        if (canSee || this.aiTimer > 2) {
          const away = -Math.sign(dx) || 1;
          this.facing = away;
          this.targetVx = away * 190;
        } else {
          this.aiState = 'lost'; this.aiTimer = 2.5; this.setMark('?');
        }
        if (this.aiTimer <= 0) { this.aiState = 'idle'; this.aiTimer = 2; }
        // blocked by a wall? turn around
        if (G.terrain.rayGrid(c.x, c.y, this.facing, 0, 40, 6) >= 0) this.aiTimer = Math.min(this.aiTimer, 0.3);
        break;
      }
      case 'panic':
        if (chance(dt * 1.5)) this.facing *= -1;
        this.targetVx = this.facing * 230;
        if (this.burning <= 0 && this.aiTimer <= 0) { this.aiState = 'flee'; this.aiTimer = 3; }
        break;
      case 'lost':
        this.targetVx = 0;
        if (chance(dt * 1.2)) this.facing *= -1;
        if (canSee) { this.aiState = 'alert'; this.aiTimer = 1; this.setMark('!'); }
        if (this.aiTimer <= 0) { this.aiState = 'wander'; this.aiTimer = rand(2, 4); this.aiTarget = this.spawn.x + rand(-200, 200); }
        break;
    }
    // react to the player's loud actions nearby
    if (G.noise.t > 0 && Math.hypot(G.noise.x - c.x, G.noise.y - c.y) < G.noise.r && this.aiState !== 'panic' && this.aiState !== 'flee') {
      if (visible || Math.hypot(G.noise.x - c.x, G.noise.y - c.y) < G.noise.r * 0.6) {
        this.aiState = 'flee'; this.aiTimer = rand(3, 5); this.setMark('!');
      }
    }
  }

  private ends(b: MBody, len: number, alpha: number) {
    const p = ipos(b, alpha);
    const sx = -Math.sin(p.a) * len / 2, sy = Math.cos(p.a) * len / 2;
    return { a: { x: p.x - sx, y: p.y - sy }, b: { x: p.x + sx, y: p.y + sy } };
  }

  joints2(alpha: number): StickJoints {
    const P = this.parts;
    const t = this.ends(P.torso, TORSO, alpha);
    const h = ipos(P.head, alpha);
    const uaL = this.ends(P.uaL, UA, alpha), laL = this.ends(P.laL, LA, alpha);
    const uaR = this.ends(P.uaR, UA, alpha), laR = this.ends(P.laR, LA, alpha);
    const thL = this.ends(P.thL, TH, alpha), shL = this.ends(P.shL, SH, alpha);
    const thR = this.ends(P.thR, TH, alpha), shR = this.ends(P.shR, SH, alpha);
    return {
      head: { x: h.x, y: h.y }, headR: HEAD, neck: t.a, pelvis: t.b,
      elbowL: uaL.b, handL: laL.b, elbowR: uaR.b, handR: laR.b,
      kneeL: thL.b, footL: shL.b, kneeR: thR.b, footR: shR.b,
      hasArmL: !this.detached.armL, hasArmR: !this.detached.armR, hasLegL: !this.detached.legL, hasLegR: !this.detached.legR,
    };
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number) {
    const j = this.joints2(alpha);
    let a = 1;
    if (this.dead && this.deadTime > 5) a = Math.max(0, 6 - this.deadTime);
    ctx.globalAlpha = a;
    const burnt = this.scorch;
    let col = this.color;
    if (burnt > 0.3) col = burnt > 0.7 ? '#3a3330' : '#8a7a6a';
    if (this.wet > 0.3) col = '#9fb4d0';
    const ko = this.ko > 0 || this.dead;
    drawStick(ctx, j, {
      color: col, width: 4.2, facing: this.facing,
      eyes: ko ? 'x' : this.role === 'npc' ? (this.aiState === 'flee' || this.aiState === 'panic' ? 'wide' : 'dots') : 'none',
      eyeColor: '#10131c',
      outline: 'rgba(5,6,10,0.55)',
    });
    // detached limbs
    const P = this.parts;
    ctx.strokeStyle = col; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
    const limb = (u: MBody, l: MBody, ul: number, ll: number) => {
      const a1 = this.ends(u, ul, alpha), b1 = this.ends(l, ll, alpha);
      ctx.beginPath(); ctx.moveTo(a1.a.x, a1.a.y); ctx.lineTo(a1.b.x, a1.b.y); ctx.lineTo(b1.b.x, b1.b.y); ctx.stroke();
    };
    if (this.detached.armL) limb(P.uaL, P.laL, UA, LA);
    if (this.detached.armR) limb(P.uaR, P.laR, UA, LA);
    if (this.detached.legL) limb(P.thL, P.shL, TH, SH);
    if (this.detached.legR) limb(P.thR, P.shR, TH, SH);
    // dummy target marking on the chest
    if (this.role === 'dummy') {
      const mx = (j.neck.x * 0.6 + j.pelvis.x * 0.4), my = (j.neck.y * 0.6 + j.pelvis.y * 0.4);
      ctx.fillStyle = '#d0452f';
      ctx.beginPath(); ctx.arc(mx, my, 3.2, 0, 6.3); ctx.fill();
    }
    if (this.frozen > 0) {
      ctx.fillStyle = 'rgba(170,225,255,0.45)';
      ctx.strokeStyle = 'rgba(230,250,255,0.8)';
      ctx.lineWidth = 1.5;
      const b = this.bounds();
      ctx.beginPath();
      ctx.moveTo(b.x0 - 3, b.y1 + 2); ctx.lineTo(b.x0 - 5, b.y0 + 12); ctx.lineTo(b.x0 + 6, b.y0 - 4);
      ctx.lineTo(b.x1 - 4, b.y0 - 6); ctx.lineTo(b.x1 + 5, b.y0 + 15); ctx.lineTo(b.x1 + 3, b.y1 + 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // health bar (only when damaged)
    if (!this.dead && this.hp < this.maxHp) {
      const w = 30, x = j.head.x - w / 2, y = j.head.y - 20;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
      const f = this.hp / this.maxHp;
      ctx.fillStyle = f > 0.5 ? '#7be07b' : f > 0.25 ? '#e0c45b' : '#e05b5b';
      ctx.fillRect(x, y, w * f, 3);
    }
    if (this.mark) {
      ctx.fillStyle = this.mark === '!' ? '#ffcf4a' : '#9fd0ff';
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.mark, j.head.x, j.head.y - 24);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  drawGlow(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.shock > 0 || this.charge > 0.2) {
      const j = this.joints2(alpha);
      ctx.globalAlpha = Math.min(1, 0.4 + this.shock);
      drawStick(ctx, j, { color: '#bfe4ff', width: 7, facing: this.facing, eyes: 'none' });
      ctx.globalAlpha = 1;
    }
  }
}

export { angleLerp };
