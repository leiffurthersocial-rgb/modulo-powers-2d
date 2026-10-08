import Matter from 'matter-js';
import { setGame } from './ctx';
import { audio } from './core/audio';
import { Input } from './core/input';
import { Loop, STEP } from './core/loop';
import { clamp, rand, RGB, Vec } from './core/math';
import { Player } from './player/player';
import { Effect, Power, PowerId, KEYS } from './powers/power';
import { Background } from './render/background';
import { Camera } from './render/camera';
import { Decals, FX } from './render/fx';
import { Lighting } from './render/lighting';
import { particles, PK } from './render/particles';
import { Renderer } from './render/renderer';
import { resetFogCache } from './render/atmosphere';
import { Block } from './world/blocks';
import { Entity } from './world/entity';
import { FireSystem } from './world/fire';
import { MapDef, MAPS } from './world/maps';
import { DmgType } from './world/materials';
import { Bodies, Composite, Events, MBody, plug, Query, snapshot, vel } from './world/phys';
import { Prop, PropOpts } from './world/props';
import { Stickman } from './world/stickman';
import { Strawman } from './world/strawman';
import { Terrain } from './world/terrain';
import { WaterSystem } from './world/water';
import { Hud } from './ui/hud';
import { LightningPower } from './powers/lightning';
import { FirePower } from './powers/fire';
import { WaterPower } from './powers/water';
import { EarthPower } from './powers/earth';
import { ShadowPower } from './powers/shadow';

export interface RayHit {
  x: number; y: number; dist: number;
  entity: Entity | null;
  terrain: boolean;
}

interface Respawn { t: number; make: () => void }

export class Game {
  canvas: HTMLCanvasElement;
  input: Input;
  loop: Loop;
  engine: Matter.Engine;
  cam = new Camera();
  lighting = new Lighting();
  fx = new FX();
  decals = new Decals();
  terrain = new Terrain();
  water = new WaterSystem();
  fire = new FireSystem();
  bg = new Background();
  renderer: Renderer;
  hud: Hud;
  player!: Player;
  entities: Entity[] = [];
  effects: Effect[] = [];
  dynamicBodies: MBody[] = [];
  private respawns: Respawn[] = [];
  time = 0;
  realTime = 0;
  mapIndex = 0;
  map!: MapDef;
  powers: { lightning: LightningPower; fire: FirePower; water: WaterPower; earth: EarthPower; shadow: ShadowPower };
  powerList: Power[];
  powerIndex = 0;
  energy = 100;
  maxEnergy = 100;
  shadowEnergy = 100;
  maxShadowEnergy = 100;
  private energyDelay = 0;
  infinite = false;
  slowmo = false;
  godMode = false;
  autoAim = false;
  muted = false;
  showHelp = false;
  private pausedBeforeHelp = false;
  title = true;
  titleT = 0;
  flashAmt = 0;
  flashColor: RGB = [255, 255, 255];
  desat = 0;      // 0..1 screen desaturation (phase)
  aberration = 0; // disorientation effect
  slowmoPulse = 0; // temporary slow motion from abilities
  noise = { x: 0, y: 0, r: 0, t: 0 };
  toast = { text: '', t: 0 };
  private bodiesCache: MBody[] = [];
  perf = { step: 0, render: 0 };

  constructor(canvas: HTMLCanvasElement) {
    setGame(this);
    this.canvas = canvas;
    this.input = new Input(canvas);
    this.engine = Matter.Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.0016;
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    this.engine.constraintIterations = 3;
    this.installOneWay();
    Events.on(this.engine, 'collisionStart', (e) => this.onCollisions(e.pairs));
    this.renderer = new Renderer(canvas);
    this.hud = new Hud();
    this.powers = {
      lightning: new LightningPower(),
      fire: new FirePower(),
      water: new WaterPower(),
      earth: new EarthPower(),
      shadow: new ShadowPower(),
    };
    this.powerList = [this.powers.lightning, this.powers.fire, this.powers.water, this.powers.earth, this.powers.shadow];
    particles.solid = this.terrain.solidAt;
    try { this.autoAim = localStorage.getItem('mp.autoAim') === '1'; } catch { /* ignore */ }
    this.loadMap(0);
    this.loop = new Loop({
      step: (dt) => { const t0 = performance.now(); this.step(dt); this.perf.step += (performance.now() - t0 - this.perf.step) * 0.05; },
      render: (alpha, dt) => { const t0 = performance.now(); this.render(alpha, dt); this.perf.render += (performance.now() - t0 - this.perf.render) * 0.05; },
      frame: (dt) => this.frame(dt),
    });
    (window as any).__game = this;
    (window as any).__fps = () => Math.round(1000 / this.loop.frameMs);
    (window as any).__perf = () => ({ step: +this.perf.step.toFixed(2), render: +this.perf.render.toFixed(2), particles: particles.count, bodies: this.bodiesCache.length, entities: this.entities.length });
  }

  start() { this.loop.start(); }

  get power(): Power { return this.powerList[this.powerIndex]; }

  // ------------------------------------------------------------------ physics

  /** one-way platforms: disable contact pairs before Matter resolves them */
  private installOneWay() {
    const R = Matter.Resolver as any;
    const orig = R.preSolvePosition;
    R.preSolvePosition = (pairs: Matter.Pair[]) => {
      for (let i = 0; i < pairs.length; i++) {
        const pr = pairs[i];
        if (!pr.isActive) continue;
        const a = pr.collision.parentA, b = pr.collision.parentB;
        const pa = plug(a), pb = plug(b);
        let plat: MBody | null = null, other: MBody | null = null;
        if (pa.oneway) { plat = a; other = b; } else if (pb.oneway) { plat = b; other = a; }
        if (!plat || !other) continue;
        const top = plat.bounds.min.y;
        const bottom = other.bounds.max.y;
        const vy = other.velocity.y;
        const isPlayer = (other.plugin as any).isPlayer;
        // pass through when coming from below, moving up, or (player) dropping
        if (bottom - vy > top + 6 || vy < -0.5 || (isPlayer && this.player.dropT > 0)) pr.isActive = false;
      }
      orig(pairs);
    };
  }

  private onCollisions(pairs: Matter.Pair[]) {
    for (const pr of pairs) {
      if (!pr.isActive) continue;
      const a = pr.collision.parentA, b = pr.collision.parentB;
      const n = pr.collision.normal;
      const rvx = (a.velocity.x - b.velocity.x) * 60, rvy = (a.velocity.y - b.velocity.y) * 60;
      const speed = Math.abs(rvx * n.x + rvy * n.y);
      if (speed < 120) continue;
      const oa = plug(a).owner, ob = plug(b).owner;
      const sup = pr.collision.supports[0] || a.position;
      const pt = { x: sup.x, y: sup.y };
      // heavy objects deal crush damage to softer things
      const crush = (src: Entity | undefined, dst: Entity | undefined, srcBody: MBody) => {
        if (!dst || dst.dead) return;
        const m = srcBody.isStatic ? 3 : srcBody.mass;
        const thrown = src instanceof Prop && src.crushing > 0;
        if (dst instanceof Stickman || dst instanceof Strawman) {
          const k = Math.min(thrown ? 55 : 35, (speed - 260) * 0.02 * Math.min(2.5, m) * (thrown ? 1.5 : 1));
          if (k > 1 && this.time - dst.lastImpactT > 0.25) {
            dst.lastImpactT = this.time;
            dst.damage(k, 'blunt', pt.x, pt.y);
            if (k > 6) dst.applyImpulse(rvx * 0, 0);
          }
        }
      };
      if (oa instanceof Prop) oa.onImpact(speed, ob ?? null, pt);
      if (ob instanceof Prop) ob.onImpact(speed, oa ?? null, pt);
      if (speed > 260) {
        crush(oa, ob, a);
        crush(ob, oa, b);
        // ragdolls slamming into terrain
        // ragdolls slamming into terrain: once per 0.3 s, not once per limb
        for (const [st, other] of [[oa, b], [ob, a]] as const) {
          if (st instanceof Stickman && other.isStatic && speed > 750 && this.time - st.lastImpactT > 0.3) {
            st.lastImpactT = this.time;
            st.damage(Math.min(25, (speed - 750) * 0.035), 'blunt');
          }
        }
      }
      // stone armor body-check
      const pl = this.player;
      if (pl.armor > 0 && (a === pl.body || b === pl.body)) {
        const other = a === pl.body ? ob : oa;
        if (other && !other.dead && speed > 220) {
          other.damage(speed * 0.03, 'blunt', pt.x, pt.y);
          const d = Math.sign(pl.vx) || pl.facing;
          other.applyImpulse(d * other.mass() * 380, -other.mass() * 200, pt.x, pt.y);
          audio.impact('stone', pt.x, pt.y, 0.6);
          this.cam.shake(0.15);
        }
      }
    }
  }

  // ------------------------------------------------------------------ entities

  addEntity(e: Entity) {
    this.entities.push(e);
    if (e instanceof Stickman || e instanceof Strawman) e.addToWorld(this.engine.world);
    else if (e.bodies.length) Composite.add(this.engine.world, e.bodies);
    this.refreshBodies();
    // seed interpolation
    for (const b of e.bodies) { const p = plug(b); p.px = b.position.x; p.py = b.position.y; p.pa = b.angle; }
    return e;
  }

  spawnProp(o: PropOpts) {
    // cap debris
    if (o.kind === 'chunk' || o.kind === 'plank') {
      const debris = this.entities.filter((e) => e instanceof Prop && e.lifetime > 0);
      if (debris.length > 40) (debris[0] as Prop).remove();
    }
    return this.addEntity(new Prop(o)) as Prop;
  }

  private refreshBodies() {
    this.bodiesCache = Composite.allBodies(this.engine.world);
    this.dynamicBodies = this.bodiesCache.filter((b) => !b.isStatic);
  }

  private purge() {
    let changed = false;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.removed) continue;
      this.entities.splice(i, 1);
      if (e instanceof Stickman || e instanceof Strawman) e.removeFromWorld(this.engine.world);
      else if (e.bodies.length) Composite.remove(this.engine.world, e.bodies);
      changed = true;
      // schedule respawn for training targets
      if (e instanceof Stickman && e.role !== 'corpse') {
        const s = e.spawn, role = e.role, color = e.role === 'npc' ? e.color : undefined;
        this.respawns.push({ t: 4, make: () => { const n = new Stickman(s.x, s.y, role, color); this.addEntity(n); this.poof(s.x, s.y - 40); } });
      } else if (e instanceof Strawman) {
        const s = e.spawn;
        this.respawns.push({ t: 6, make: () => { this.addEntity(new Strawman(s.x, s.y)); this.poof(s.x, s.y - 60); } });
      }
    }
    if (changed) this.refreshBodies();
  }

  poof(x: number, y: number) {
    for (let i = 0; i < 16; i++) particles.emit({ kind: PK.Glow, x: x + rand(-15, 15), y: y + rand(-30, 30), vx: rand(-60, 60), vy: rand(-80, 20), life: rand(0.4, 0.8), size: rand(4, 8), color: [200, 210, 255], alpha: 0.6 });
    this.fx.dust(x, y + 30, 4, [150, 150, 170]);
  }

  // -------------------------------------------------------------- map loading

  loadMap(index: number) {
    for (const e of this.effects) e.stop?.();
    if (this.player) for (const p of this.powerList) p.unequip();
    this.effects = [];
    this.mapIndex = (index + MAPS.length) % MAPS.length;
    this.map = MAPS[this.mapIndex];
    Composite.clear(this.engine.world, false, true);
    this.engine.pairs.table = {};
    this.engine.pairs.list.length = 0;
    this.entities = [];
    this.respawns = [];
    particles.clear();
    this.fx.clear();
    this.decals.clear();
    this.fire.clear();
    this.water.clear();
    this.lighting.clear();
    this.lighting.zones = [];
    this.lighting.ambient = this.map.ambient;
    this.lighting.ambientTint = this.map.tint;
    this.terrain.reset(this.map.w, this.map.h);
    resetFogCache();
    this.bg.setTheme(this.map.theme);
    this.cam.bounds = { x0: 0, y0: 0, x1: this.map.w, y1: this.map.h };
    const spawn = this.map.build(this);
    // world bounds
    const W = this.map.w, H = this.map.h;
    const edge = this.map.theme === 'industrial' ? 'concrete' : this.map.theme === 'ruins' ? 'stone' : 'dirt';
    this.terrain.add(-240, -400, 240, H + 800, edge);
    this.terrain.add(W, -400, 240, H + 800, edge);
    this.terrain.add(-240, -260, W + 480, 160, 'concrete'); // ceiling just above the screen
    Composite.add(this.engine.world, this.terrain.bodies());
    this.player = new Player(spawn.x, spawn.y);
    Composite.add(this.engine.world, this.player.body);
    this.refreshBodies();
    this.cam.snap(spawn.x, spawn.y);
    this.energy = this.maxEnergy;
    this.shadowEnergy = this.maxShadowEnergy;
    this.power.equip();
    this.applyPowerLook();
  }

  resetMap() {
    this.loadMap(this.mapIndex);
    this.showToast('Map reset');
    audio.whoosh(undefined, undefined, 0.4, 0.2, 2000, 300);
  }

  /** used by map builders */
  addDummy(x: number, groundY: number) { return this.addEntity(new Stickman(x, groundY, 'dummy')); }
  addNpc(x: number, groundY: number, color?: string) { return this.addEntity(new Stickman(x, groundY, 'npc', color)); }
  addStrawman(x: number, groundY: number) { return this.addEntity(new Strawman(x, groundY)); }
  addBlock(b: Block) { return this.addEntity(b) as Block; }

  // ------------------------------------------------------------------ energy

  spend(pool: 'main' | 'shadow', amount: number, partial = false): boolean {
    if (this.infinite) return true;
    if (pool === 'shadow') {
      if (this.shadowEnergy < amount && !partial) return false;
      if (this.shadowEnergy <= 0) return false;
      this.shadowEnergy = Math.max(0, this.shadowEnergy - amount);
      return true;
    }
    if (this.energy < amount && !partial) return false;
    if (this.energy <= 0) return false;
    this.energy = Math.max(0, this.energy - amount);
    this.energyDelay = 0.7;
    return true;
  }

  // ------------------------------------------------------------- world query

  /** entities overlapping a circle (bounds-based) */
  entitiesInRadius(x: number, y: number, r: number): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities) {
      if (e.dead && !(e instanceof Stickman)) continue;
      const b = e.bounds();
      const cx = clamp(x, b.x0, b.x1), cy = clamp(y, b.y0, b.y1);
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) out.push(e);
    }
    return out;
  }

  /** march a ray against terrain + entities */
  raycast(x0: number, y0: number, dx: number, dy: number, maxDist: number, opts: { entities?: boolean; ignore?: Entity | null; step?: number; throughChars?: boolean } = {}): RayHit {
    const step = opts.step ?? 5;
    const useEnt = opts.entities !== false;
    let cands: Entity[] = [];
    if (useEnt) {
      const x1 = x0 + dx * maxDist, y1 = y0 + dy * maxDist;
      const bx0 = Math.min(x0, x1), bx1 = Math.max(x0, x1), by0 = Math.min(y0, y1), by1 = Math.max(y0, y1);
      for (const e of this.entities) {
        if (e === opts.ignore || (e.dead && !(e instanceof Stickman))) continue;
        if (opts.throughChars && (e instanceof Stickman || e instanceof Strawman)) continue;
        const b = e.bounds();
        if (b.x1 < bx0 || b.x0 > bx1 || b.y1 < by0 || b.y0 > by1) continue;
        if (e instanceof Block) continue; // blocks are in the terrain grid
        cands.push(e);
      }
    }
    for (let d = 0; d <= maxDist; d += step) {
      const x = x0 + dx * d, y = y0 + dy * d;
      if (this.terrain.solidAt(x, y)) return { x, y, dist: d, entity: this.blockAt(x, y), terrain: true };
      for (const e of cands) {
        const b = e.bounds();
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        if (e.bodies.length === 0 || Query.point(e.bodies, { x, y }).length > 0 || (e instanceof Stickman && this.nearStick(e, x, y))) {
          return { x, y, dist: d, entity: e, terrain: false };
        }
      }
    }
    return { x: x0 + dx * maxDist, y: y0 + dy * maxDist, dist: maxDist, entity: null, terrain: false };
  }

  private nearStick(s: Stickman, x: number, y: number) {
    for (const b of s.bodies) if (Math.abs(b.position.x - x) < 9 && Math.abs(b.position.y - y) < 12) return true;
    return false;
  }

  blockAt(x: number, y: number): Entity | null {
    for (const e of this.entities) {
      if (!(e instanceof Block) && !(e.bodies[0]?.isStatic)) continue;
      const b = e.bounds();
      if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return e;
    }
    return null;
  }

  /** radial blast: damage, knockback, status */
  explode(x: number, y: number, radius: number, force: number, damage: number, type: DmgType, opts: { ignite?: boolean; selfKnock?: boolean; elec?: boolean; soak?: boolean } = {}) {
    for (const e of this.entitiesInRadius(x, y, radius)) {
      const c = e.center();
      const dx = c.x - x, dy = c.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const k = clamp(1 - d / (radius + 20), 0.15, 1);
      e.damage(damage * k, type, x, y);
      const m = e.mass();
      const ux = dx / d, uy = dy / d - 0.35;
      e.applyImpulse(ux * force * k * Math.sqrt(m) * 1.6, uy * force * k * Math.sqrt(m) * 1.6, x, y);
      if (opts.ignite) e.ignite(1.2 * k);
      if (opts.elec) e.electrocute(0.6 * k, 0);
      if (opts.soak) e.soak(k);
      if (e instanceof Stickman) e.startle = 1;
    }
    // startle everything further out
    for (const e of this.entitiesInRadius(x, y, radius * 2.5)) if (e instanceof Stickman && !e.dead) e.startle = Math.max(e.startle, 0.6);
    if (opts.selfKnock) {
      const pl = this.player;
      const dx = pl.x - x, dy = pl.y - y, d = Math.hypot(dx, dy);
      if (d < radius) {
        const k = 1 - d / radius;
        pl.launch(pl.vx + (dx / (d || 1)) * force * k * 0.9, Math.min(pl.vy, 0) + ((dy / (d || 1)) - 0.5) * force * k * 0.9);
      }
    }
    const pool = this.water.poolNear(x, y, radius);
    if (pool) pool.disturb(x, force * 0.15, radius);
    this.makeNoise(x, y, radius * 3);
  }

  makeNoise(x: number, y: number, r: number) {
    this.noise = { x, y, r, t: 0.2 };
  }

  // ------------------------------------------------------------------ juice

  flash(amount: number, color: RGB = [255, 255, 255]) {
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashColor = color;
  }
  hitstop(seconds: number) { this.loop.hitStop = Math.max(this.loop.hitStop, seconds); }
  slowPulse(seconds: number) { this.slowmoPulse = Math.max(this.slowmoPulse, seconds); }
  showToast(text: string) { this.toast = { text, t: 1.8 }; }

  onPlayerDeath() {
    const pl = this.player;
    const corpse = new Stickman(pl.x, pl.feetY, 'corpse', '#f2f4fa');
    corpse.ko = 999;
    corpse.dead = true;
    corpse.deadTime = 2;
    this.addEntity(corpse);
    for (const b of corpse.bodies) Matter.Body.setVelocity(b, { x: pl.body.velocity.x, y: pl.body.velocity.y });
    Composite.remove(this.engine.world, pl.body);
    this.cam.shake(0.5);
    this.flash(0.4, [255, 60, 60]);
    this.respawns.push({ t: 2.2, make: () => this.respawnPlayer() });
    audio.thud(pl.x, pl.y, 0.7);
    this.showToast('You went down. Respawning...');
  }

  respawnPlayer() {
    const pl = this.player;
    if (!this.engine.world.bodies.includes(pl.body)) Composite.add(this.engine.world, pl.body);
    this.power.unequip();
    pl.respawn();
    this.power.equip();
    this.applyPowerLook();
    this.refreshBodies();
  }

  // ------------------------------------------------------------------ powers

  switchPower(i: number) {
    i = ((i % this.powerList.length) + this.powerList.length) % this.powerList.length;
    if (i === this.powerIndex) return;
    this.power.unequip();
    this.powerIndex = i;
    this.power.equip();
    this.applyPowerLook();
    const p = this.power;
    const chords: Record<PowerId, number[]> = {
      lightning: [660, 990, 1320], fire: [220, 330, 440], water: [392, 523, 659], earth: [98, 147, 196], shadow: [233, 277, 349],
    };
    audio.chord(chords[p.id], 0.08, p.id === 'earth' ? 'sawtooth' : 'triangle');
    this.hud.powerFlash = 1;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      particles.emit({ kind: PK.Glow, x: this.player.x + Math.cos(a) * 10, y: this.player.y + Math.sin(a) * 20, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 0.45, size: 6, sizeEnd: 1, color: p.color, drag: 3 });
    }
    this.fx.ring(this.player.x, this.player.y, 10, 70, p.color, 0.35);
  }

  applyPowerLook() {
    const p = this.power;
    this.player.aura = p.color;
    this.player.eyeColor = p.eye;
  }

  // ------------------------------------------------------------------ frame

  private frame(dt: number) {
    const inp = this.input;
    inp.pollFrame();
    this.realTime += dt;
    if (this.title) {
      this.titleT += dt;
      if (inp.consumeAnyKey() && this.titleT > 0.4) {
        this.title = false;
        this.loop.paused = false;
        audio.unlock();
        audio.chord([196, 294, 392, 587], 0.09);
        this.canvas.focus();
        inp.poll();
        return;
      }
      this.loop.paused = true;
      inp.poll();
      return;
    }
    inp.consumeAnyKey();
    // field guide: pauses the game, arrows / 1-5 / Q E switch tabs
    if (this.showHelp) {
      if (inp.framePressedKey('KeyH') || inp.framePressedKey('KeyP')) {
        this.showHelp = false;
        this.loop.paused = this.pausedBeforeHelp;
        audio.blip(440);
      } else {
        if (inp.framePressedKey('ArrowRight') || inp.framePressedKey('KeyD')) { this.hud.helpNav(1); audio.blip(700, 0.06); }
        if (inp.framePressedKey('ArrowLeft') || inp.framePressedKey('KeyA')) { this.hud.helpNav(-1); audio.blip(620, 0.06); }
        for (let i = 0; i < 5; i++) if (inp.framePressedKey('Digit' + (i + 1))) { this.switchPower(i); this.hud.helpTab = i; }
        if (inp.framePressedKey('KeyQ')) { this.switchPower(this.powerIndex - 1); this.hud.helpTab = this.powerIndex; }
        if (inp.framePressedKey('KeyE')) { this.switchPower(this.powerIndex + 1); this.hud.helpTab = this.powerIndex; }
        if (inp.framePressedKey('KeyM')) { this.muted = !this.muted; audio.setMuted(this.muted); }
      }
      inp.poll();
      return;
    }
    if (inp.framePressedKey('KeyH')) {
      this.showHelp = true;
      this.pausedBeforeHelp = this.loop.paused;
      this.loop.paused = true;
      this.hud.helpTab = this.powerIndex;
      audio.blip(520);
      inp.poll();
      return;
    }
    if (inp.framePressedKey('KeyP')) {
      this.loop.paused = !this.loop.paused;
      audio.blip(this.loop.paused ? 440 : 660);
    }
    if (inp.framePressedKey('KeyM')) {
      this.muted = !this.muted;
      audio.setMuted(this.muted);
      this.showToast(this.muted ? 'Sound muted' : 'Sound on');
    }
    if (this.loop.paused) { inp.poll(); return; }
    if (inp.framePressedKey('KeyR')) { this.resetMap(); return; }
    if (inp.framePressedKey('KeyN')) {
      this.loadMap(this.mapIndex + 1);
      this.showToast(this.map.name);
      audio.chord([262, 392, 523], 0.08);
      return;
    }
    if (inp.framePressedKey('KeyT')) {
      this.respawnPlayer();
      this.cam.snap(this.player.x, this.player.y);
      this.showToast('Player reset');
    }
    if (inp.framePressedKey('KeyV')) { this.slowmo = !this.slowmo; this.showToast(this.slowmo ? 'Slow motion ON' : 'Slow motion OFF'); audio.whoosh(undefined, undefined, 0.5, 0.2, this.slowmo ? 1800 : 300, this.slowmo ? 300 : 1800); }
    if (inp.framePressedKey('KeyF')) {
      this.infinite = !this.infinite;
      this.showToast(this.infinite ? 'Sandbox: infinite energy, no cooldowns' : 'Sandbox mode OFF');
      audio.blip(this.infinite ? 880 : 330);
      if (this.infinite) for (const p of this.powerList) p.cd = [0, 0, 0, 0];
    }
    if (inp.framePressedKey('KeyB')) this.spawnDummyAtAim();
    if (inp.framePressedKey('KeyG')) {
      this.autoAim = !this.autoAim;
      this.showToast(this.autoAim ? 'Auto-aim ON: locks onto the nearest target' : 'Auto-aim OFF');
      audio.blip(this.autoAim ? 990 : 440);
      try { localStorage.setItem('mp.autoAim', this.autoAim ? '1' : '0'); } catch { /* ignore */ }
    }
    for (let i = 0; i < 5; i++) if (inp.framePressedKey('Digit' + (i + 1))) this.switchPower(i);
    if (inp.framePressedKey('KeyQ')) this.switchPower(this.powerIndex - 1);
    if (inp.framePressedKey('KeyE')) this.switchPower(this.powerIndex + 1);

    // time scale
    let ts = this.slowmo ? 0.3 : 1;
    if (this.slowmoPulse > 0) { this.slowmoPulse -= dt; ts = Math.min(ts, 0.35); }
    this.loop.timeScale = ts;
  }

  spawnDummyAtAim() {
    const pl = this.player;
    const t = pl.mouseAiming ? this.cam.toWorld(this.input.pointerX, this.input.pointerY) : this.aimPoint(260);
    let x = clamp(t.x, 60, this.map.w - 60);
    let gy = this.terrain.groundBelow(x, Math.max(30, t.y - 60));
    if (this.water.depthAt(x, gy - 4) > 0) gy = this.water.poolAt(x, gy - 4)!.y;
    const count = this.entities.filter((e) => e instanceof Stickman && e.role === 'dummy').length;
    if (count > 12) { this.showToast('Arena is full (max 12 dummies)'); return; }
    const kinds = ['dummy', 'dummy', 'straw'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (k === 'straw') this.addStrawman(x, gy);
    else this.addDummy(x, gy);
    this.poof(x, gy - 40);
    audio.blip(700, 0.1);
  }

  /** a point along the aim ray, stopping at terrain */
  aimPoint(range: number, opts: { ground?: boolean } = {}): Vec {
    const pl = this.player;
    const d = pl.aimDir();
    const ox = pl.x, oy = pl.y - 14;
    const h = this.raycast(ox, oy, d.x, d.y, range, { entities: false });
    let x = h.x, y = h.y;
    if (h.terrain) { x -= d.x * 6; y -= d.y * 6; }
    if (opts.ground) y = this.terrain.groundBelow(x, y - 2);
    return { x, y };
  }

  // ------------------------------------------------------------------ step

  private step(dt: number) {
    this.input.poll();
    this.time += dt;
    snapshot(this.bodiesCache);
    this.lighting.beginStep();
    this.fire.beginStep();
    if (this.noise.t > 0) this.noise.t -= dt;

    // energy regen
    if (this.energyDelay > 0) this.energyDelay -= dt;
    else this.energy = Math.min(this.maxEnergy, this.energy + dt * 20);
    this.powers.shadow.regen(dt);

    // powers: input -> abilities
    const pw = this.power;
    const pl = this.player;
    if (!pl.dead) {
      for (let i = 0; i < 4; i++) {
        const key = KEYS[i];
        let pressed = this.input.wasPressed(key);
        let released = this.input.wasReleased(key);
        let down = this.input.isDown(key);
        if (i === 0) {
          pressed = pressed || this.input.pointerPressed;
          released = released || this.input.pointerReleased;
          down = down || this.input.pointerDown;
        }
        if (pressed && !pw.holding[i]) { pw.holding[i] = true; pw.press(i); }
        if (pw.holding[i] && down) pw.hold(i, dt);
        if (pw.holding[i] && (released || !down)) { pw.holding[i] = false; pw.release(i); }
      }
    }
    for (const p of this.powerList) { p.tick(dt); if (p !== pw) p.background(dt); }
    pw.update(dt);

    pl.update(dt);
    pl.updateAfterimages(dt);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(dt)) { this.effects[i].stop?.(); this.effects.splice(i, 1); }
    }
    for (const e of this.entities) e.update(dt);
    this.water.update(dt);
    this.fire.update(dt);
    this.decals.update(dt);

    Matter.Engine.update(this.engine, STEP * 1000);
    this.purge();

    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      r.t -= dt;
      if (r.t <= 0) { this.respawns.splice(i, 1); r.make(); }
    }
    particles.update(dt, Math.sin(this.time * 0.3) * 10);
  }

  // ------------------------------------------------------------------ render

  private render(alpha: number, dt: number) {
    const pl = this.player;
    const v = vel(pl.body);
    const d = pl.aimDir();
    if (!this.loop.paused || this.title) {
      this.cam.update(dt, pl.x, pl.y, v.x, v.y, d.x, d.y);
      this.lighting.update(dt * this.loop.timeScale);
      this.fx.update(dt * this.loop.timeScale);
      this.bg.update(dt);
      if (this.flashAmt > 0) this.flashAmt = Math.max(0, this.flashAmt - dt * 3.5);
      if (this.toast.t > 0) this.toast.t -= dt;
      this.hud.update(dt);
    }
    audio.lx = this.cam.x; audio.ly = this.cam.y;
    const phase = this.powers.shadow.phaseLook;
    this.desat = phase;
    audio.setMuffle(phase * 0.85 + (pl.swimming ? 0.5 : 0));
    if (this.aberration > 0) this.aberration = Math.max(0, this.aberration - dt * 1.5);
    // adaptive particle budget (frame time)
    const ms = this.loop.frameMs;
    particles.budget = ms > 24 ? 0.5 : ms > 19 ? 0.75 : 1;
    if (!this.loop.paused && !this.title) this.renderer.adapt(ms, dt);
    this.renderer.render(this, alpha);
  }
}
