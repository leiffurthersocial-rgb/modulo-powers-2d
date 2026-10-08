// The player stickman: a capsule Matter body with tight-but-physical
// platformer movement (acceleration, coyote time, jump buffer, variable jump),
// swimming, phasing support, and a fully procedural animated skeleton.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { angleLerp, chance, clamp, lerp, rand, RGB, smooth, Vec } from '../core/math';
import { particles, PK } from '../render/particles';
import { drawStick, StickJoints } from '../render/stickdraw';
import { DmgType } from '../world/materials';
import { Bodies, Body, CAT, ipos, MBody, plug, setVel, vel } from '../world/phys';

export const P_W = 22, P_H = 76;
const HALF = P_H / 2;

export type CastPose =
  | 'none' | 'point' | 'push' | 'slam' | 'raise' | 'charge' | 'hurl' | 'windup' | 'rocket' | 'spray' | 'phase' | 'stomp' | 'guard' | 'summon' | 'dash';

export class Player {
  body: MBody;
  facing = 1;
  aim = 0; // radians, 0 = right
  aimTarget: Vec = { x: 0, y: 0 };
  grounded = false;
  groundBody: MBody | null = null;
  coyote = 0;
  jumpBuf = 0;
  jumpHeld = false;
  jumpCut = false;
  crouching = false;
  dropT = 0;
  swimming = false;
  inWater = 0;
  hp = 100;
  maxHp = 100;
  dead = false;
  deadT = 0;
  lastHurt = -10;
  hurtFlash = 0;
  spawn: Vec = { x: 200, y: 600 };
  // status
  wet = 0;
  burning = 0;
  shock = 0;
  // power-driven state
  phasing = false;
  invisible = false;
  invisAmount = 0; // 0 visible .. 1 fully invisible
  reveal = 0;      // temporary reveal from attacking / moving
  armor = 0;       // stone armor hp (0 = none)
  armorMax = 0;
  rocket = false;
  locked = 0;      // seconds movement is locked (dash/teleport)
  noGravity = 0;
  speedMul = 1;
  aura: RGB = [255, 255, 255];
  eyeColor = '#ffffff';
  // animation
  cast: CastPose = 'none';
  castT = 0;       // remaining time of cast pose
  castDur = 0.3;
  castCharge = 0;  // 0..1 for hold poses
  private anim = { phase: 0, lean: 0, crouch: 0, air: 0, landT: 0, hands: [{ x: 8, y: -10 }, { x: -8, y: -10 }], feet: [{ x: 5, y: 37 }, { x: -5, y: 37 }], bob: 0, hitLean: 0 };
  private stepT = 0;
  private lastVy = 0;
  private aimedByMouse = false;
  afterimages: { x: number; y: number; j: StickJoints; life: number; color: RGB }[] = [];
  mouseAimUntil = 0;

  constructor(x: number, y: number) {
    this.spawn = { x, y };
    this.body = this.makeBody(x, y);
  }

  private makeBody(x: number, y: number) {
    const b = Bodies.rectangle(x, y, P_W, P_H, {
      chamfer: { radius: 10 }, friction: 0, frictionStatic: 0, frictionAir: 0, restitution: 0,
      density: 0.0012, inertia: Infinity, slop: 0.02,
      collisionFilter: { category: CAT.PLAYER, mask: 0xffff },
      label: 'player',
    } as any);
    Body.setInertia(b, Infinity);
    (b.plugin as any).isPlayer = true;
    return b;
  }

  get x() { return this.body.position.x; }
  get y() { return this.body.position.y; }
  get vx() { return this.body.velocity.x * 60; }
  get vy() { return this.body.velocity.y * 60; }
  get feetY() { return this.body.position.y + HALF; }

  aimDir(): Vec { return { x: Math.cos(this.aim), y: Math.sin(this.aim) }; }

  /** world position of the casting hand */
  hand(dist = 26): Vec {
    const d = this.aimDir();
    return { x: this.x + d.x * dist, y: this.y - 14 + d.y * dist };
  }

  chest(): Vec { return { x: this.x, y: this.y - 16 }; }

  visibility() {
    return clamp(1 - this.invisAmount + this.reveal, 0, 1);
  }

  setCast(pose: CastPose, dur: number) {
    this.cast = pose;
    this.castT = dur;
    this.castDur = dur;
  }

  launch(vx: number, vy: number) {
    setVel(this.body, vx === 0 ? this.vx : vx, vy);
    this.coyote = 0;
    this.grounded = false;
  }

  hurt(amount: number, type: DmgType) {
    if (this.dead || G.godMode) return;
    if (this.armor > 0 && type !== 'steam') {
      const absorbed = Math.min(this.armor, amount * 0.75);
      this.armor -= absorbed;
      amount -= absorbed;
      if (this.armor <= 0) G.powers.earth.shatterArmor();
    }
    if (type === 'fire' && this.wet > 0.3) amount *= 0.3;
    this.hp -= amount;
    if (amount > 0.5) {
      if (G.time - this.lastHurt > 0.35) audio.hurt(this.x, this.y);
      this.lastHurt = G.time;
      this.hurtFlash = Math.min(1, this.hurtFlash + amount / 15);
    }
    if (type === 'elec') this.shock = Math.max(this.shock, 0.3);
    if (type === 'fire' && this.wet < 0.3) this.burning = Math.max(this.burning, 0.5);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.hp = 0;
    G.onPlayerDeath();
  }

  respawn(x = this.spawn.x, y = this.spawn.y) {
    this.dead = false;
    this.hp = this.maxHp;
    this.wet = this.burning = this.shock = 0;
    this.armor = 0;
    this.phasing = false;
    this.invisible = false;
    this.invisAmount = 0;
    this.locked = 0;
    this.body.collisionFilter.mask = 0xffff;
    Body.setPosition(this.body, { x, y });
    setVel(this.body, 0, 0);
    const p = plug(this.body);
    p.px = x; p.py = y; p.pa = 0;
    for (let i = 0; i < 30; i++) particles.emit({ kind: PK.Glow, x: x + rand(-20, 20), y: y + rand(-40, 40), vx: rand(-40, 40), vy: rand(-120, -20), life: rand(0.4, 0.9), size: rand(4, 9), color: this.aura, alpha: 0.8 });
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const inp = G.input;
    if (this.dead) {
      this.deadT += dt;
      return;
    }
    if (this.hurtFlash > 0) this.hurtFlash -= dt * 2;
    if (this.castT > 0) { this.castT -= dt; if (this.castT <= 0) this.cast = 'none'; }
    if (this.reveal > 0) this.reveal -= dt * 1.2;
    if (this.locked > 0) this.locked -= dt;
    if (this.dropT > 0) this.dropT -= dt;
    if (G.time - this.lastHurt > 3 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 8);

    // ---- aim
    this.updateAim(dt);

    // ---- statuses
    if (this.wet > 0) this.wet = Math.max(0, this.wet - dt * 0.08);
    if (this.shock > 0) this.shock -= dt;
    if (this.burning > 0) {
      this.burning -= dt * 0.35;
      this.hurt(dt * 5, 'steam');
      if (chance(dt * 25)) particles.emit({ kind: PK.Glow, x: this.x + rand(-8, 8), y: this.y + rand(-30, 30), vy: rand(-120, -40), life: 0.4, size: rand(5, 10), sizeEnd: 1, color: [255, 140, 40], flicker: 0.5 });
      if (this.wet > 0.3 || this.inWater > 20) this.burning = 0;
    }

    // water
    const depth = G.water.depthAt(this.x, this.feetY);
    this.inWater = depth;
    const chestDepth = G.water.depthAt(this.x, this.y - 10);
    const wasSwimming = this.swimming;
    this.swimming = chestDepth > 4 && !this.phasing;
    if (depth > 5) {
      this.wet = 1;
      const pool = G.water.poolAt(this.x, this.feetY - 2);
      if (pool && pool.elec > 0) {
        this.hurt(dt * 22, 'elec');
        this.shock = 0.3;
      }
    }
    if (this.swimming && !wasSwimming && this.vy > 200) G.fx.splash(this.x, this.y, Math.min(1, this.vy / 900));

    // ---- grounded check
    this.checkGround();

    const left = inp.isDown('KeyA'), right = inp.isDown('KeyD');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const jumpPressed = inp.wasPressed('KeyW') || inp.wasPressed('Space');
    const jumpDown = inp.isDown('KeyW') || inp.isDown('Space');
    const down = inp.isDown('KeyS');

    if (this.phasing) { this.updatePhase(dt, dir, jumpDown, down); this.animate(dt, dir); return; }

    if (jumpPressed) this.jumpBuf = 0.13;
    else this.jumpBuf -= dt;
    if (this.grounded) this.coyote = 0.1; else this.coyote -= dt;

    // crouch & drop-through
    this.crouching = down && this.grounded && !this.swimming;
    if (inp.wasPressed('KeyS') && this.grounded && this.groundBody && plug(this.groundBody).oneway) {
      this.dropT = 0.3;
      this.crouching = false;
    }

    let vx = this.vx, vy = this.vy;
    const armorMul = this.armor > 0 ? 0.78 : 1;
    const maxSpeed = (this.crouching ? 140 : 330) * armorMul * this.speedMul;

    if (this.locked <= 0) {
      if (this.swimming) {
        const target = dir * 230;
        vx = smooth(vx, target, 4, dt);
        // buoyancy + swim strokes
        const surfaceNear = chestDepth < 26;
        vy -= 1600 * dt * 1.02; // cancel gravity
        if (jumpDown) vy = smooth(vy, -220, 5, dt);
        else if (down) vy = smooth(vy, 200, 4, dt);
        else vy = smooth(vy, chestDepth > 18 ? -60 : 0, 3, dt);
        if (jumpPressed && surfaceNear) { vy = -620; audio.splash(this.x, this.y, 0.3); G.fx.splash(this.x, this.y - 10, 0.4); }
      } else {
        const target = dir * maxSpeed;
        const accel = this.grounded ? (dir !== 0 ? 2600 : 3200) : 1500;
        const dv = target - vx;
        const step = accel * dt;
        // keep momentum when we're already moving faster (knockback, dashes)
        if (Math.abs(vx) > maxSpeed && Math.sign(vx) === Math.sign(target) && Math.abs(target) > 0) {
          vx = smooth(vx, target, this.grounded ? 3 : 0.8, dt);
        } else if (!this.grounded && dir === 0) {
          vx = smooth(vx, 0, 1.2, dt);
        } else {
          vx += clamp(dv, -step, step);
        }
        // jump
        if (this.jumpBuf > 0 && this.coyote > 0) {
          vy = -700 * (this.armor > 0 ? 0.85 : 1);
          this.jumpBuf = 0;
          this.coyote = 0;
          this.jumpCut = false;
          this.grounded = false;
          this.anim.landT = 0;
          audio.whoosh(this.x, this.y, 0.15, 0.08, 300, 900);
          G.fx.dust(this.x, this.feetY, 3);
        }
        if (!jumpDown && vy < -200 && !this.jumpCut && !this.rocket && this.noGravity <= 0) {
          vy *= 0.55;
          this.jumpCut = true;
        }
        // heavier fall
        if (vy > 0 && this.noGravity <= 0) vy += 520 * dt;
        vy = Math.min(vy, 1250);
      }
    }
    // step-up assist: walk onto low ledges (<= 30px) instead of getting stuck
    if (this.grounded && dir !== 0 && !this.swimming && this.locked <= 0) {
      const T = G.terrain;
      const fx = this.x + dir * (P_W / 2 + 3), fy = this.feetY;
      if (T.solidAt(fx, fy - 4)) {
        let top = fy - 4;
        while (fy - top < 34 && T.solidAt(fx, top)) top -= 2;
        const h = fy - top;
        if (h < 32 && !T.solidAt(fx, top - P_H) && !T.solidAt(this.x, top - P_H)) {
          Body.setPosition(this.body, { x: this.x + dir * 3, y: this.y - h - 1 });
          vx = dir * Math.max(Math.abs(vx), 160);
          vy = Math.min(vy, 0);
        }
      }
    }
    if (this.noGravity > 0) { this.noGravity -= dt; vy -= 1600 * dt; }
    if (dir !== 0 && this.locked <= 0 && this.cast === 'none') this.facing = dir;
    else if (this.cast !== 'none' && Math.abs(Math.cos(this.aim)) > 0.15) this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;
    setVel(this.body, vx, vy);

    // landing
    if (this.grounded && this.lastVy > 500) {
      this.anim.landT = Math.min(1, this.lastVy / 1100);
      G.fx.dust(this.x, this.feetY, Math.min(8, this.lastVy / 140));
      audio.thud(this.x, this.feetY, Math.min(0.5, this.lastVy / 2400) * (this.armor > 0 ? 2 : 1));
      if (this.lastVy > 1150 && !this.swimming) this.hurt((this.lastVy - 1150) * 0.05, 'blunt');
      if (this.armor > 0 && this.lastVy > 700) G.cam.shake(0.25);
    }
    this.lastVy = this.grounded ? 0 : vy;

    // footsteps
    if (this.grounded && Math.abs(vx) > 60) {
      this.stepT -= dt * Math.abs(vx) / 330;
      if (this.stepT <= 0) {
        this.stepT = 0.28;
        audio.burst({ type: 'lowpass', freq: this.armor > 0 ? 300 : 700, vol: this.armor > 0 ? 0.18 : 0.05, decay: 0.05, x: this.x, y: this.feetY, key: 'step' });
        if (this.wet > 0.3 && chance(0.6)) particles.emit({ kind: PK.Drop, x: this.x, y: this.feetY - 2, vx: rand(-60, 60), vy: rand(-120, -40), life: 0.4, size: 1.5, color: [130, 190, 255], gravity: 1200 });
        if (this.armor > 0) G.fx.dust(this.x, this.feetY, 1);
      }
    }

    // invisibility fade
    const wantInvis = this.invisible ? 1 : 0;
    this.invisAmount = smooth(this.invisAmount, wantInvis, wantInvis ? 3 : 6, dt);
    if (this.invisible && (Math.abs(vx) > 250 || !this.grounded)) this.reveal = Math.max(this.reveal, 0.15);

    this.animate(dt, dir);

    // fell out of the world
    if (this.y > G.terrain.h + 300) { this.hurt(1e3, 'blunt'); }
  }

  private updatePhase(dt: number, dir: number, up: boolean, down: boolean) {
    const inSolid = this.insideSolid();
    const speed = inSolid ? 190 : 280;
    const vy = (down ? 1 : 0) - (up ? 1 : 0);
    // weightless: hover unless W/S is held, so you never sink into floors by accident
    const tvx = dir * speed;
    const tvy = vy * speed;
    setVel(this.body, smooth(this.vx, tvx, 7, dt), smooth(this.vy, tvy, 7, dt));
    if (dir !== 0) this.facing = dir;
    this.grounded = false;
    // keep inside world bounds
    const b = G.cam.bounds;
    if (this.x < b.x0 + 20) Body.setPosition(this.body, { x: b.x0 + 20, y: this.y });
    if (this.x > b.x1 - 20) Body.setPosition(this.body, { x: b.x1 - 20, y: this.y });
    if (this.y > G.terrain.h - 40) Body.setPosition(this.body, { x: this.x, y: G.terrain.h - 40 });
    if (this.y < 40) Body.setPosition(this.body, { x: this.x, y: 40 });
  }

  /** true if a meaningful part of the player overlaps level geometry */
  insideSolid(margin = 2) {
    const x0 = this.x - P_W / 2 + margin, x1 = this.x + P_W / 2 - margin;
    const y0 = this.y - HALF + margin, y1 = this.y + HALF - margin;
    return G.terrain.coverage(x0, y0, x1, y1) > 0.08;
  }

  private checkGround() {
    this.grounded = false;
    this.groundBody = null;
    if (this.phasing) return;
    const pairs = G.engine.pairs.list;
    for (let i = 0; i < pairs.length; i++) {
      const pr = pairs[i];
      if (!pr.isActive || pr.isSensor) continue;
      const c = pr.collision;
      let other: MBody | null = null;
      let ny = 0;
      if (c.parentA === this.body) { other = c.parentB; ny = -c.normal.y; }
      else if (c.parentB === this.body) { other = c.parentA; ny = c.normal.y; }
      else continue;
      // Matter's normal points from B toward A; flip so ny > 0 means support below us
      if (ny > 0.55) {
        this.grounded = true;
        this.groundBody = other;
      }
    }
    if (this.grounded && this.vy < -50) this.grounded = false;
  }

  private updateAim(dt: number) {
    const inp = G.input;
    const ax = (inp.isDown('ArrowRight') ? 1 : 0) - (inp.isDown('ArrowLeft') ? 1 : 0);
    const ay = (inp.isDown('ArrowDown') ? 1 : 0) - (inp.isDown('ArrowUp') ? 1 : 0);
    if (ax !== 0 || ay !== 0) {
      const target = Math.atan2(ay, ax);
      this.aim = angleLerp(this.aim, target, Math.min(1, dt * 9));
      this.aimedByMouse = false;
      this.mouseAimUntil = 0;
    } else if (inp.pointerActive && performance.now() - inp.lastPointerMove < 4000 || inp.pointerDown) {
      const w = G.cam.toWorld(inp.pointerX, inp.pointerY);
      this.aim = Math.atan2(w.y - (this.y - 14), w.x - this.x);
      this.aimedByMouse = true;
      this.mouseAimUntil = G.time + 2;
    } else {
      this.aimedByMouse = false;
      // mirror the aim when turning around so it always points the way we face
      const cx = Math.cos(this.aim);
      if (Math.abs(cx) > 0.05 && Math.sign(cx) !== this.facing && (inp.isDown('KeyA') || inp.isDown('KeyD'))) {
        this.aim = Math.atan2(Math.sin(this.aim), -cx);
      }
    }
  }

  get mouseAiming() { return this.aimedByMouse; }

  // --------------------------------------------------------------- animation

  private animate(dt: number, dir: number) {
    const a = this.anim;
    const speed = Math.abs(this.vx);
    a.lean = smooth(a.lean, clamp(this.vx / 330, -1, 1) * 0.18, 8, dt);
    a.crouch = smooth(a.crouch, this.crouching ? 1 : a.landT > 0 ? a.landT * 0.7 : 0, 14, dt);
    if (a.landT > 0) a.landT = Math.max(0, a.landT - dt * 4);
    a.air = smooth(a.air, this.grounded || this.swimming ? 0 : 1, 10, dt);
    if (this.grounded && speed > 20) a.phase += dt * (speed / 330) * 11;
    else if (this.swimming) a.phase += dt * 5;
    a.bob += dt;
    a.hitLean = smooth(a.hitLean, this.hurtFlash > 0.3 ? 1 : 0, 10, dt);
    void dir;
  }

  /** compute the skeleton in world space (facing-aware) */
  skeleton(alpha: number): StickJoints {
    const ip = this.dead ? { x: this.x, y: this.y } : ipos(this.body, alpha);
    const a = this.anim;
    const f = this.facing;
    const ox = ip.x, feetY = ip.y + HALF;
    const crouch = a.crouch;
    const t = a.bob;
    const speed = Math.abs(this.vx);
    const running = this.grounded && speed > 20 ? clamp(speed / 330, 0, 1.3) : 0;

    let pelvisY = feetY - 37 + crouch * 14 + Math.abs(Math.sin(a.phase)) * -3 * running + Math.sin(t * 2.2) * 0.8 * (1 - running);
    let lean = a.lean * f * 0 + a.lean - a.hitLean * f * 0.25;
    if (this.cast === 'slam' || this.cast === 'stomp') { pelvisY += 8; }
    if (this.cast === 'charge') { pelvisY += 6 * this.castCharge; }
    const pelvis = { x: ox, y: pelvisY };
    const torsoLen = 28;
    const neck = { x: pelvis.x + Math.sin(lean) * torsoLen, y: pelvis.y - Math.cos(lean) * torsoLen };
    const head = { x: neck.x + Math.sin(lean) * 10, y: neck.y - 10 };

    // ---- legs (IK to foot targets)
    let fL: Vec, fR: Vec;
    if (this.swimming) {
      const k = Math.sin(a.phase * 2) * 8;
      fL = { x: ox - f * 14, y: pelvis.y + 28 + k };
      fR = { x: ox - f * 18, y: pelvis.y + 26 - k };
    } else if (!this.grounded && !this.phasing) {
      const up = this.vy < 0;
      fL = { x: ox + f * (up ? 6 : 4), y: pelvis.y + (up ? 22 : 32) };
      fR = { x: ox - f * (up ? 8 : 10), y: pelvis.y + (up ? 28 : 26) };
      if (this.rocket) { fL = { x: ox - f * 4, y: pelvis.y + 34 }; fR = { x: ox - f * 9, y: pelvis.y + 32 }; }
    } else if (this.phasing) {
      const k = Math.sin(t * 3) * 3;
      fL = { x: ox + 4, y: pelvis.y + 34 + k }; fR = { x: ox - 4, y: pelvis.y + 33 - k };
    } else if (running > 0) {
      const stride = 17 * running;
      const lift = 10 * running;
      const p = a.phase;
      fL = { x: ox + f * Math.sin(p) * stride, y: feetY - Math.max(0, Math.cos(p)) * lift };
      fR = { x: ox + f * Math.sin(p + Math.PI) * stride, y: feetY - Math.max(0, Math.cos(p + Math.PI)) * lift };
    } else {
      const w = crouch > 0.5 ? 12 : 7;
      fL = { x: ox + f * w, y: feetY };
      fR = { x: ox - f * (w - 2), y: feetY };
      if (this.cast === 'stomp' || this.cast === 'slam') { fL = { x: ox + f * 14, y: feetY }; fR = { x: ox - f * 12, y: feetY }; }
    }
    const kneeL = ik(pelvis, fL, 18, 18, f);
    const kneeR = ik(pelvis, fR, 18, 18, f);

    // ---- arms
    const d = this.aimDir();
    const sh = { x: neck.x, y: neck.y + 2 };
    let hL: Vec, hR: Vec; // L = front arm (aim arm), R = back arm
    const castK = this.castDur > 0 ? clamp(this.castT / this.castDur, 0, 1) : 0;
    switch (this.cast) {
      case 'point': case 'spray':
        hL = { x: sh.x + d.x * 28, y: sh.y + d.y * 28 };
        hR = { x: sh.x - f * 10, y: sh.y + 18 };
        if (this.cast === 'spray') hR = { x: sh.x + d.x * 22 + d.y * 4, y: sh.y + d.y * 22 - d.x * 4 + 3 };
        break;
      case 'push': case 'guard':
        hL = { x: sh.x + d.x * 27 - d.y * 5, y: sh.y + d.y * 27 + d.x * 5 };
        hR = { x: sh.x + d.x * 25 + d.y * 6, y: sh.y + d.y * 25 - d.x * 6 };
        break;
      case 'windup': {
        // arm cocked behind, charging
        hL = { x: sh.x - d.x * 18, y: sh.y - 16 };
        hR = { x: sh.x + d.x * 14, y: sh.y + 6 };
        break;
      }
      case 'hurl': {
        const k = 1 - castK;
        hL = { x: sh.x + d.x * 28 * (0.5 + k * 0.5), y: sh.y + d.y * 28 + (1 - k) * -10 };
        hR = { x: sh.x - f * 12, y: sh.y + 14 };
        break;
      }
      case 'raise': case 'summon':
        hL = { x: sh.x + f * 16, y: sh.y - 22 * (this.cast === 'raise' ? 1 : 0.6) };
        hR = { x: sh.x + f * 4, y: sh.y - 24 * (this.cast === 'raise' ? 1 : 0.6) };
        break;
      case 'slam': case 'stomp':
        hL = { x: sh.x + f * 16, y: sh.y + 22 };
        hR = { x: sh.x - f * 12, y: sh.y + 20 };
        break;
      case 'charge': {
        const k = this.castCharge;
        const jit = this.castCharge > 0.5 ? Math.sin(t * 50) * 2 : 0;
        hL = { x: sh.x + f * (12 + k * 10), y: sh.y + 14 - k * 20 + jit };
        hR = { x: sh.x - f * (12 + k * 10), y: sh.y + 14 - k * 20 - jit };
        break;
      }
      case 'rocket':
        hL = { x: sh.x + f * 6 - d.x * 4, y: sh.y + 26 };
        hR = { x: sh.x - f * 8, y: sh.y + 25 };
        break;
      case 'phase':
        hL = { x: sh.x + f * 14, y: sh.y + 6 + Math.sin(t * 3) * 3 };
        hR = { x: sh.x - f * 14, y: sh.y + 6 - Math.sin(t * 3) * 3 };
        break;
      case 'dash':
        hL = { x: sh.x - f * 22, y: sh.y + 10 };
        hR = { x: sh.x - f * 18, y: sh.y + 16 };
        break;
      default: {
        if (this.swimming) {
          const k = Math.sin(a.phase);
          hL = { x: sh.x + f * (14 + k * 10), y: sh.y - 4 + k * 8 };
          hR = { x: sh.x + f * (10 - k * 10), y: sh.y - 2 - k * 8 };
        } else if (!this.grounded && a.air > 0.5) {
          const up = this.vy < 0;
          hL = { x: sh.x + f * 16, y: sh.y + (up ? -12 : -6) + Math.sin(t * 9) * 3 };
          hR = { x: sh.x - f * 16, y: sh.y + (up ? -8 : -10) - Math.sin(t * 9) * 3 };
        } else if (running > 0) {
          const p = a.phase;
          hL = { x: sh.x - f * Math.sin(p) * 14 * running + f * 3, y: sh.y + 22 - Math.abs(Math.sin(p)) * 4 };
          hR = { x: sh.x - f * Math.sin(p + Math.PI) * 14 * running + f * 3, y: sh.y + 22 - Math.abs(Math.cos(p)) * 4 };
        } else {
          const br = Math.sin(t * 2.2) * 1.2;
          hL = { x: sh.x + f * 6, y: sh.y + 27 + br };
          hR = { x: sh.x - f * 5, y: sh.y + 27 + br };
        }
      }
    }
    // smooth hand motion
    const sm = (cur: Vec, target: Vec, i: number) => {
      const relX = target.x - ox, relY = target.y - pelvis.y;
      cur.x = lerp(cur.x, relX, 0.45); cur.y = lerp(cur.y, relY, 0.45);
      void i;
      return { x: ox + cur.x, y: pelvis.y + cur.y };
    };
    const HL = sm(a.hands[0], hL, 0), HR = sm(a.hands[1], hR, 1);
    const elbowL = ik(sh, HL, 15, 15, -f);
    const elbowR = ik(sh, HR, 15, 15, -f);
    return { head, headR: 8, neck, pelvis, elbowL, handL: HL, elbowR, handR: HR, kneeL, footL: fL, kneeR, footR: fR };
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.dead) return;
    const j = this.skeleton(alpha);
    // afterimages
    for (const ai of this.afterimages) {
      ctx.globalAlpha = ai.life * 0.5;
      drawStick(ctx, ai.j, { color: `rgb(${ai.color[0]},${ai.color[1]},${ai.color[2]})`, width: 4, facing: this.facing, eyes: 'none' });
    }
    ctx.globalAlpha = 1;
    const vis = this.visibility();
    if (vis < 0.98) {
      // heat-haze outline
      const t = G.time;
      ctx.globalAlpha = 0.12 + vis * 0.5;
      const wob = (v: Vec, i: number) => ({ x: v.x + Math.sin(t * 9 + i) * 1.2, y: v.y + Math.cos(t * 7 + i) * 1.2 });
      const jj: StickJoints = { ...j, head: wob(j.head, 1), neck: wob(j.neck, 2), elbowL: wob(j.elbowL, 3), handL: wob(j.handL, 4), elbowR: wob(j.elbowR, 5), handR: wob(j.handR, 6), kneeL: wob(j.kneeL, 7), kneeR: wob(j.kneeR, 8) };
      drawStick(ctx, jj, { color: 'rgba(200,180,255,0.9)', width: 2, facing: this.facing, eyes: 'none' });
      ctx.globalAlpha = 1;
      if (vis < 0.4) return;
      ctx.globalAlpha = vis;
    }
    if (this.phasing) ctx.globalAlpha = 0.55;
    let color = '#f2f4fa';
    if (this.hurtFlash > 0.2 && Math.floor(G.time * 20) % 2 === 0) color = '#ff8080';
    else if (this.wet > 0.4) color = '#cfe2ff';
    drawStick(ctx, j, { color, width: 4.6, facing: this.facing, eyes: 'glow', eyeColor: this.eyeColor, outline: 'rgba(4,5,10,0.7)' });
    // stone armor plates
    if (this.armor > 0) {
      const k = this.armor / Math.max(1, this.armorMax);
      ctx.fillStyle = '#6b5e52';
      ctx.strokeStyle = '#2e2620';
      ctx.lineWidth = 1.5;
      const plate = (a: Vec, b: Vec, w: number) => {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * w, ny = dx / l * w;
        ctx.beginPath();
        ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx * 0.8, b.y + ny * 0.8); ctx.lineTo(b.x - nx * 0.8, b.y - ny * 0.8); ctx.lineTo(a.x - nx, a.y - ny);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      };
      plate(j.neck, j.pelvis, 8);
      if (k > 0.3) { plate(j.neck, j.elbowL, 4.5); plate(j.neck, j.elbowR, 4.5); }
      if (k > 0.15) { plate(j.pelvis, j.kneeL, 5); plate(j.pelvis, j.kneeR, 5); }
      if (k > 0.5) { plate(j.kneeL, j.footL, 4); plate(j.kneeR, j.footR, 4); plate(j.elbowL, j.handL, 3.5); plate(j.elbowR, j.handR, 3.5); }
      ctx.beginPath(); ctx.arc(j.head.x, j.head.y - 2, 9.5, Math.PI, 0); ctx.fill(); ctx.stroke();
      // cracks
      if (k < 0.6) {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.moveTo(j.neck.x - 3, j.neck.y + 4); ctx.lineTo(j.neck.x + 2, j.neck.y + 12); ctx.lineTo(j.neck.x - 2, j.neck.y + 18); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawGlow(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.dead) return;
    const vis = this.visibility();
    if (vis < 0.3) return;
    const j = this.skeleton(alpha);
    const c = this.aura;
    ctx.globalAlpha = 0.22 * vis * (this.phasing ? 1.6 : 1);
    drawStick(ctx, j, { color: `rgb(${c[0]},${c[1]},${c[2]})`, width: 10, facing: this.facing, eyes: 'none' });
    ctx.globalAlpha = 0.9 * vis;
    // glowing eyes
    const f = this.facing;
    ctx.fillStyle = this.eyeColor;
    const ex = j.head.x + f * 3, ey = j.head.y - 1;
    ctx.fillRect(ex - 2, ey - 2, 4.5, 3.5);
    ctx.fillRect(ex + f * 4 - 2, ey - 2, 4.5, 3.5);
    ctx.globalAlpha = 1;
    if (this.shock > 0) {
      ctx.globalAlpha = 0.6;
      drawStick(ctx, j, { color: '#bfe4ff', width: 6, facing: f, eyes: 'none' });
      ctx.globalAlpha = 1;
    }
  }

  updateAfterimages(dt: number) {
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt * 2.5;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }
  }

  addAfterimage(color: RGB) {
    if (this.afterimages.length > 14) this.afterimages.shift();
    const j = this.skeleton(1);
    this.afterimages.push({ x: this.x, y: this.y, j: JSON.parse(JSON.stringify(j)), life: 1, color });
  }
}

/** 2-bone IK: returns the middle joint. `bend` chooses the side of the bend. */
export function ik(a: Vec, c: Vec, l1: number, l2: number, bend: number): Vec {
  let dx = c.x - a.x, dy = c.y - a.y;
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < 0.001) return { x: a.x, y: a.y + l1 };
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = Math.atan2(dy, dx) + Math.acos(cosA) * (bend >= 0 ? -1 : 1);
  return { x: a.x + Math.cos(ang) * l1, y: a.y + Math.sin(ang) * l1 };
}

export { vel };
