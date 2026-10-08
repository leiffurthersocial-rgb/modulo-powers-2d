// Dynamic lighting: a low-res darkness buffer that lights cut holes into,
// plus coloured additive light washes in the glow buffer. The same data is
// used by Shadow's energy system via lightAt().

import { RGB } from '../core/math';
import type { Camera } from './camera';

export interface Light {
  x: number; y: number; r: number; color: RGB; intensity: number; flicker: number;
  ttl?: number; maxTtl?: number;
}

export interface Zone {
  x: number; y: number; w: number; h: number;
  /** negative = darker than ambient, positive = brighter */
  light: number;
  tint?: RGB;
}

export class Lighting {
  lights: Light[] = [];
  private stepLights: Light[] = [];
  flashes: Light[] = [];
  zones: Zone[] = [];
  ambient = 0.4; // 0 = pitch black, 1 = fully lit
  ambientTint: RGB = [6, 8, 18];
  /** global darkness override used by Shadow Strike's dimming (0..1) */
  dim = 0;
  private dark: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private holeSprite: HTMLCanvasElement;
  private tintSprites = new Map<string, HTMLCanvasElement>();
  private time = 0;

  constructor() {
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d')!;
    this.holeSprite = document.createElement('canvas');
    this.holeSprite.width = this.holeSprite.height = 128;
    const c = this.holeSprite.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }

  /** called at the start of every fixed step: lights are re-submitted each step */
  beginStep() {
    const t = this.lights;
    this.lights = this.stepLights;
    this.stepLights = t;
    this.stepLights.length = 0;
  }

  /** submit a light for this step */
  add(x: number, y: number, r: number, color: RGB, intensity = 1, flicker = 0) {
    if (this.stepLights.length > 120) return;
    this.stepLights.push({ x, y, r, color, intensity, flicker });
  }

  /** transient light that fades out over `ttl` seconds (explosions, bolts) */
  flash(x: number, y: number, r: number, color: RGB, intensity: number, ttl: number) {
    if (this.flashes.length > 40) this.flashes.shift();
    this.flashes.push({ x, y, r, color, intensity, flicker: 0, ttl, maxTtl: ttl });
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.ttl! -= dt;
      if (f.ttl! <= 0) this.flashes.splice(i, 1);
    }
    this.dim = Math.max(0, this.dim - dt * 0.6);
  }

  clear() {
    this.lights.length = 0;
    this.stepLights.length = 0;
    this.flashes.length = 0;
  }

  private all(): Light[] {
    return this.stepLights.length ? this.stepLights : this.lights;
  }

  /** brightness 0..~2 at a world point (zones + lights). Used by Shadow. */
  lightAt(x: number, y: number, includeFlashes = true) {
    let l = this.ambient;
    for (const z of this.zones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) l += z.light;
    }
    l = Math.max(0, l);
    const src = this.all();
    for (const s of src) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.r) { const f = 1 - d / s.r; l += s.intensity * f * f * 1.2; }
    }
    if (includeFlashes) {
      for (const s of this.flashes) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r) { const f = 1 - d / s.r; l += s.intensity * (s.ttl! / s.maxTtl!) * f * f; }
      }
    }
    return l - this.dim * 0.5;
  }

  private tintSprite(c: RGB) {
    const key = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
    let s = this.tintSprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 128;
    const x = s.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.9)`);
    g.addColorStop(0.4, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    this.tintSprites.set(key, s);
    return s;
  }

  /**
   * Render the darkness overlay onto `ctx` (device pixel space).
   * `scale` = world -> device px factor.
   */
  renderDarkness(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, extraDark = 0) {
    const W = Math.ceil(cam.vw / 4), H = Math.ceil(cam.vh / 4);
    if (this.dark.width !== W || this.dark.height !== H) { this.dark.width = W; this.dark.height = H; }
    const d = this.dctx;
    const s = cam.scale / 4;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    const base = Math.min(0.97, Math.max(0, 1 - this.ambient + this.dim * 0.5 + extraDark));
    const t = this.ambientTint;
    d.fillStyle = `rgba(${t[0]},${t[1]},${t[2]},${base})`;
    d.fillRect(0, 0, W, H);
    // world transform (no shake rotation, it's subtle enough)
    d.setTransform(s, 0, 0, s, W / 2 - (cam.x - cam.shakeX / cam.scale) * s, H / 2 - (cam.y - cam.shakeY / cam.scale) * s);
    for (const z of this.zones) {
      if (z.light < 0) {
        d.globalCompositeOperation = 'source-over';
        d.fillStyle = `rgba(2,2,6,${Math.min(0.9, -z.light)})`;
        d.fillRect(z.x, z.y, z.w, z.h);
      } else if (z.light > 0) {
        d.globalCompositeOperation = 'destination-out';
        d.fillStyle = `rgba(0,0,0,${Math.min(1, z.light)})`;
        d.fillRect(z.x, z.y, z.w, z.h);
      }
    }
    d.globalCompositeOperation = 'destination-out';
    const v = cam.view();
    const draw = (l: Light, k: number) => {
      if (l.x + l.r < v.x0 || l.x - l.r > v.x1 || l.y + l.r < v.y0 || l.y - l.r > v.y1) return;
      let a = Math.min(1, l.intensity * k);
      if (l.flicker) a *= 1 - l.flicker * 0.25 * (1 + Math.sin(this.time * 23 + l.x * 0.1) * Math.sin(this.time * 7.3 + l.y));
      d.globalAlpha = Math.max(0, a);
      d.drawImage(this.holeSprite, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    };
    for (const l of this.all()) draw(l, 1);
    for (const f of this.flashes) draw(f, f.ttl! / f.maxTtl!);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.dark, 0, 0, W, H, 0, 0, cam.vw * dpr, cam.vh * dpr);
    ctx.restore();
  }

  /** coloured light washes, drawn additively into the glow buffer (world transform set) */
  renderTints(ctx: CanvasRenderingContext2D, cam: Camera) {
    const v = cam.view();
    const draw = (l: Light, k: number) => {
      if (l.x + l.r < v.x0 || l.x - l.r > v.x1 || l.y + l.r < v.y0 || l.y - l.r > v.y1) return;
      ctx.globalAlpha = Math.min(1, l.intensity * k * 0.28);
      ctx.drawImage(this.tintSprite(l.color), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    };
    for (const l of this.all()) draw(l, 1);
    for (const f of this.flashes) draw(f, f.ttl! / f.maxTtl!);
    for (const z of this.zones) {
      if (z.tint && z.light > 0) {
        if (z.x > v.x1 || z.x + z.w < v.x0 || z.y > v.y1 || z.y + z.h < v.y0) continue;
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = `rgb(${z.tint[0]},${z.tint[1]},${z.tint[2]})`;
        ctx.fillRect(z.x, z.y, z.w, z.h);
      }
    }
    ctx.globalAlpha = 1;
  }
}
