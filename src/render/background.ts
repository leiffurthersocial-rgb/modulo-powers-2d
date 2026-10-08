// Procedural parallax backgrounds (sky, moon, far/mid silhouettes, fog).

import { RGB, seeded } from '../core/math';
import type { Camera } from './camera';

export type Theme = 'yard' | 'industrial' | 'ruins';

interface Layer { canvas: HTMLCanvasElement; factor: number; yOff: number }

const LW = 2048, LH = 900;

export class Background {
  theme: Theme = 'yard';
  private layers: Layer[] = [];
  private sky: [string, string, string] = ['#05060c', '#0b1024', '#1a1630'];
  private stars: { x: number; y: number; s: number; tw: number }[] = [];
  private moon = { x: 0.72, y: 0.18, r: 46, color: '#dfe6ff' };
  get moonX() { return this.moon.x; }
  motes: { x: number; y: number; vx: number; vy: number; s: number; a: number }[] = [];
  private fog: RGB = [40, 50, 90];

  setTheme(theme: Theme) {
    this.theme = theme;
    const rng = seeded(theme === 'yard' ? 11 : theme === 'industrial' ? 22 : 33);
    this.stars = [];
    for (let i = 0; i < 140; i++) this.stars.push({ x: rng(), y: rng() * 0.6, s: rng() * 1.4 + 0.3, tw: rng() * 6 });
    this.motes = [];
    for (let i = 0; i < 60; i++) this.motes.push({ x: rng(), y: rng(), vx: (rng() - 0.5) * 0.01, vy: (rng() - 0.5) * 0.006, s: rng() * 1.6 + 0.4, a: rng() * 0.5 + 0.1 });
    if (theme === 'yard') {
      this.sky = ['#04050b', '#0a1226', '#20183a'];
      this.moon = { x: 0.74, y: 0.17, r: 44, color: '#e3e9ff' };
      this.fog = [60, 50, 110];
      this.layers = [
        this.mountains(rng, 0.12, '#0d1124', 380, 260, 0),
        this.trees(rng, 0.3, '#0a0d1a', 520, 0.9),
        this.fence(rng, 0.55, '#080a14', 640),
      ];
    } else if (theme === 'industrial') {
      this.sky = ['#06050a', '#14101c', '#2a1622'];
      this.moon = { x: 0.2, y: 0.14, r: 30, color: '#ffd9c4' };
      this.fog = [110, 60, 60];
      this.layers = [
        this.city(rng, 0.1, '#110e18', 300, true),
        this.factory(rng, 0.3, '#0c0a12', 480),
        this.city(rng, 0.55, '#08070d', 640, false),
      ];
    } else {
      this.sky = ['#030608', '#081418', '#14302c'];
      this.moon = { x: 0.6, y: 0.12, r: 52, color: '#d9fff0' };
      this.fog = [40, 110, 90];
      this.layers = [
        this.mountains(rng, 0.1, '#0a1618', 330, 300, 1),
        this.ruins(rng, 0.3, '#08120f', 480),
        this.trees(rng, 0.55, '#050b09', 600, 1.4),
      ];
    }
  }

  private mk(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = LW; c.height = LH;
    return [c, c.getContext('2d')!];
  }

  private mountains(rng: () => number, factor: number, color: string, baseY: number, amp: number, jag: number): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, LH);
    const pts = 18;
    const hs: number[] = [];
    for (let i = 0; i <= pts; i++) hs.push(rng());
    hs[pts] = hs[0];
    for (let i = 0; i <= pts * 8; i++) {
      const t = i / 8, i0 = Math.floor(t), f = t - i0;
      const h = hs[i0] * (1 - f) + hs[Math.min(pts, i0 + 1)] * f;
      const n = jag ? (rng() - 0.5) * 18 : (rng() - 0.5) * 6;
      x.lineTo((i / (pts * 8)) * LW, baseY - h * amp + n);
    }
    x.lineTo(LW, LH);
    x.closePath();
    x.fill();
    return { canvas: c, factor, yOff: 0 };
  }

  private trees(rng: () => number, factor: number, color: string, baseY: number, scale: number): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.fillRect(0, baseY, LW, LH - baseY);
    for (let i = 0; i < 70; i++) {
      const tx = rng() * LW;
      const h = (60 + rng() * 140) * scale;
      const w = h * (0.25 + rng() * 0.15);
      x.beginPath();
      x.moveTo(tx, baseY - h);
      x.lineTo(tx + w, baseY + 4);
      x.lineTo(tx - w, baseY + 4);
      x.closePath();
      x.fill();
      x.fillRect(tx - 2, baseY - 10, 4, 14);
    }
    return { canvas: c, factor, yOff: 0 };
  }

  private fence(rng: () => number, factor: number, color: string, baseY: number): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.fillRect(0, baseY, LW, LH - baseY);
    for (let px = 0; px < LW; px += 26) x.fillRect(px, baseY - 40 - rng() * 6, 6, 44);
    x.fillRect(0, baseY - 30, LW, 4);
    x.fillRect(0, baseY - 16, LW, 4);
    // watch tower + barn silhouettes
    for (let k = 0; k < 3; k++) {
      const bx = rng() * LW;
      x.fillRect(bx, baseY - 120, 90, 120);
      x.beginPath(); x.moveTo(bx - 10, baseY - 120); x.lineTo(bx + 45, baseY - 170); x.lineTo(bx + 100, baseY - 120); x.closePath(); x.fill();
    }
    return { canvas: c, factor, yOff: 0 };
  }

  private city(rng: () => number, factor: number, color: string, baseY: number, lights: boolean): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.fillRect(0, baseY, LW, LH - baseY);
    let px = 0;
    while (px < LW) {
      const w = 40 + rng() * 90, h = 60 + rng() * 220;
      x.fillStyle = color;
      x.fillRect(px, baseY - h, w, h + 2);
      if (lights) {
        for (let wy = baseY - h + 10; wy < baseY - 10; wy += 14) {
          for (let wx = px + 6; wx < px + w - 6; wx += 12) {
            if (rng() < 0.12) { x.fillStyle = rng() < 0.5 ? 'rgba(255,190,120,0.35)' : 'rgba(140,200,255,0.25)'; x.fillRect(wx, wy, 4, 6); }
          }
        }
      }
      px += w + rng() * 10;
    }
    return { canvas: c, factor, yOff: 0 };
  }

  private factory(rng: () => number, factor: number, color: string, baseY: number): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.fillRect(0, baseY, LW, LH - baseY);
    for (let i = 0; i < 9; i++) {
      const fx = rng() * LW, w = 120 + rng() * 160, h = 80 + rng() * 120;
      x.fillRect(fx, baseY - h, w, h);
      // saw-tooth roof
      for (let k = 0; k < w; k += 30) { x.beginPath(); x.moveTo(fx + k, baseY - h); x.lineTo(fx + k + 30, baseY - h - 18); x.lineTo(fx + k + 30, baseY - h); x.fill(); }
      // chimneys
      const ch = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < ch; k++) x.fillRect(fx + 20 + k * 40, baseY - h - 120 - rng() * 60, 14, 140);
    }
    // pipes
    x.fillRect(0, baseY - 50, LW, 8);
    return { canvas: c, factor, yOff: 0 };
  }

  private ruins(rng: () => number, factor: number, color: string, baseY: number): Layer {
    const [c, x] = this.mk();
    x.fillStyle = color;
    x.fillRect(0, baseY, LW, LH - baseY);
    for (let i = 0; i < 16; i++) {
      const rx = rng() * LW, h = 60 + rng() * 180, w = 18 + rng() * 20;
      x.fillRect(rx, baseY - h, w, h);
      if (rng() < 0.5) x.fillRect(rx - 10, baseY - h - 8, w + 20, 10);
      if (rng() < 0.3) { x.beginPath(); x.arc(rx + w + 40, baseY - h + 20, 40, Math.PI, 0); x.lineWidth = 14; x.strokeStyle = color; x.stroke(); }
    }
    return { canvas: c, factor, yOff: 0 };
  }

  update(dt: number) {
    for (const m of this.motes) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < 0) m.x += 1; if (m.x > 1) m.x -= 1;
      if (m.y < 0) m.y += 1; if (m.y > 1) m.y -= 1;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, time: number, worldH: number) {
    const W = cam.vw, H = cam.vh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, this.sky[0]);
    g.addColorStop(0.6, this.sky[1]);
    g.addColorStop(1, this.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars
    const sx = -cam.x * 0.02, sy = -cam.y * 0.02;
    for (const s of this.stars) {
      const x = ((s.x * W * 1.3 + sx) % (W * 1.3) + W * 1.3) % (W * 1.3) - W * 0.15;
      const y = s.y * H + sy;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 1.5 + s.tw);
      ctx.fillStyle = '#cfd8ff';
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // moon with halo
    const mx = this.moon.x * W - cam.x * 0.015, my = this.moon.y * H - cam.y * 0.015;
    const halo = ctx.createRadialGradient(mx, my, this.moon.r * 0.5, mx, my, this.moon.r * 5);
    halo.addColorStop(0, 'rgba(200,210,255,0.22)');
    halo.addColorStop(1, 'rgba(200,210,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - this.moon.r * 5, my - this.moon.r * 5, this.moon.r * 10, this.moon.r * 10);
    ctx.fillStyle = this.moon.color;
    ctx.beginPath(); ctx.arc(mx, my, this.moon.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.arc(mx - 12, my - 8, this.moon.r * 0.25, 0, 6.3); ctx.arc(mx + 14, my + 10, this.moon.r * 0.18, 0, 6.3); ctx.fill();

    // parallax layers (in a scaled space so they line up with the world horizon)
    const s = cam.scale;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      const scale = s * (0.7 + L.factor * 0.5);
      const scroll = cam.x * L.factor * scale;
      // horizon: tie the layer bottom loosely to world ground level
      const groundScreenY = (worldH - 300 - cam.y) * s * (0.25 + L.factor) + H * 0.62;
      const top = groundScreenY - (LH - 200) * scale * 0.9;
      const w = LW * scale;
      let x0 = -((scroll % w) + w) % w;
      for (; x0 < W; x0 += w) ctx.drawImage(L.canvas, x0, top, w, LH * scale);
      // fog band between layers
      const fogY = top + 560 * scale;
      const fg = ctx.createLinearGradient(0, fogY - 120 * scale, 0, fogY + 160 * scale);
      const f = this.fog;
      fg.addColorStop(0, `rgba(${f[0]},${f[1]},${f[2]},0)`);
      fg.addColorStop(0.5, `rgba(${f[0]},${f[1]},${f[2]},${0.07 + li * 0.02})`);
      fg.addColorStop(1, `rgba(${f[0]},${f[1]},${f[2]},0)`);
      ctx.fillStyle = fg;
      ctx.fillRect(0, fogY - 120 * scale, W, 280 * scale);
    }
  }

  /** floating ambient motes, drawn in screen space over the world (in glow) */
  drawMotes(ctx: CanvasRenderingContext2D, cam: Camera, time: number, color: RGB) {
    const W = cam.vw, H = cam.vh;
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    for (const m of this.motes) {
      const x = (((m.x * W * 1.2 - cam.x * 0.3) % (W * 1.2)) + W * 1.2) % (W * 1.2) - W * 0.1;
      const y = (((m.y * H * 1.2 - cam.y * 0.3) % (H * 1.2)) + H * 1.2) % (H * 1.2) - H * 0.1;
      ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(time * 2 + m.x * 50));
      ctx.fillRect(x, y, m.s, m.s);
    }
    ctx.globalAlpha = 1;
  }
}
