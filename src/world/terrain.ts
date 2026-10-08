// Static level geometry + a coarse occupancy grid used for cheap particle
// collisions, line-of-sight and "am I inside a wall" checks.

import { RGB, seeded } from '../core/math';
import { Bodies, CAT, MBody, plug } from './phys';
import { MatId } from './materials';

export type SolidStyle = 'ground' | 'stone' | 'metal' | 'wood' | 'thick' | 'brick' | 'dirt' | 'concrete';

export interface Solid {
  body: MBody;
  x: number; y: number; w: number; h: number;
  style: SolidStyle;
  mat: MatId;
  oneway: boolean;
  /** precomputed decoration (cracks, planks, bricks) */
  deco: number[];
}

const CELL = 8;

export class Terrain {
  solids: Solid[] = [];
  grid: Uint8Array = new Uint8Array(0);
  gw = 0; gh = 0;
  w = 0; h = 0;

  reset(w: number, h: number) {
    this.solids = [];
    this.w = w; this.h = h;
    this.gw = Math.ceil(w / CELL) + 2;
    this.gh = Math.ceil(h / CELL) + 2;
    this.grid = new Uint8Array(this.gw * this.gh);
  }

  add(x: number, y: number, w: number, h: number, style: SolidStyle, opts: { oneway?: boolean } = {}): Solid {
    const oneway = !!opts.oneway;
    const thick = style === 'thick';
    const body = Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
      isStatic: true,
      friction: style === 'metal' ? 0.5 : 0.8,
      frictionStatic: 1,
      restitution: 0,
      collisionFilter: { category: oneway ? CAT.ONEWAY : thick ? CAT.THICK : CAT.TERRAIN, mask: 0xffff },
      label: 'terrain',
    });
    plug(body).terrain = true;
    plug(body).oneway = oneway;
    const mat: MatId = style === 'metal' ? 'metal' : style === 'wood' ? 'wood' : style === 'stone' || style === 'brick' || style === 'thick' || style === 'concrete' ? 'stone' : 'ground';
    plug(body).mat = mat;
    const rng = seeded((x * 31 + y * 17 + w) | 0);
    const deco: number[] = [];
    for (let i = 0; i < Math.min(60, (w * h) / 1800); i++) deco.push(rng(), rng(), rng());
    const s: Solid = { body, x, y, w, h, style, mat, oneway, deco };
    this.solids.push(s);
    if (!oneway) this.stamp(x, y, w, h, 1);
    return s;
  }

  stamp(x: number, y: number, w: number, h: number, delta: number) {
    const x0 = Math.max(0, Math.floor(x / CELL)), y0 = Math.max(0, Math.floor(y / CELL));
    const x1 = Math.min(this.gw - 1, Math.floor((x + w - 0.01) / CELL)), y1 = Math.min(this.gh - 1, Math.floor((y + h - 0.01) / CELL));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = gy * this.gw + gx;
        this.grid[i] = Math.max(0, Math.min(255, this.grid[i] + delta));
      }
    }
  }

  solidAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0) return true;
    const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
    if (gx >= this.gw || gy >= this.gh) return true;
    return this.grid[gy * this.gw + gx] > 0;
  };

  /** fraction of an AABB covered by solid cells */
  coverage(x0: number, y0: number, x1: number, y1: number) {
    let n = 0, s = 0;
    for (let y = y0; y <= y1; y += CELL) {
      for (let x = x0; x <= x1; x += CELL) { n++; if (this.solidAt(x, y)) s++; }
    }
    return n ? s / n : 0;
  }

  /** march a ray through the grid; returns hit distance or -1 */
  rayGrid(x0: number, y0: number, dx: number, dy: number, maxDist: number, step = 4): number {
    for (let d = 0; d <= maxDist; d += step) {
      if (this.solidAt(x0 + dx * d, y0 + dy * d)) return d;
    }
    return -1;
  }

  /** first ground surface below a point */
  groundBelow(x: number, y: number, maxDist = 2000) {
    let yy = y;
    if (this.solidAt(x, yy)) {
      // inside: walk up
      while (yy > 0 && this.solidAt(x, yy)) yy -= 4;
      return yy + 4;
    }
    for (let d = 0; d < maxDist; d += 4) {
      if (this.solidAt(x, y + d)) return y + d;
    }
    return y + maxDist;
  }

  bodies() { return this.solids.map((s) => s.body); }

  draw(ctx: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }, palette: TerrainPalette) {
    for (const s of this.solids) {
      if (s.x > view.x1 || s.x + s.w < view.x0 || s.y > view.y1 || s.y + s.h < view.y0) continue;
      drawSolid(ctx, s, palette);
    }
  }
}

export interface TerrainPalette {
  ground: RGB; groundTop: RGB; rim: RGB;
}

function drawSolid(ctx: CanvasRenderingContext2D, s: Solid, pal: TerrainPalette) {
  const { x, y, w, h } = s;
  switch (s.style) {
    case 'ground':
    case 'dirt': {
      const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 260));
      g.addColorStop(0, `rgb(${pal.groundTop[0]},${pal.groundTop[1]},${pal.groundTop[2]})`);
      g.addColorStop(1, `rgb(${pal.ground[0]},${pal.ground[1]},${pal.ground[2]})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      // strata/pebbles
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < s.deco.length; i += 3) {
        ctx.fillRect(x + s.deco[i] * w, y + 14 + s.deco[i + 1] * (h - 18), 3 + s.deco[i + 2] * 14, 2);
      }
      // top rim
      ctx.fillStyle = `rgb(${pal.rim[0]},${pal.rim[1]},${pal.rim[2]})`;
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y + 3, w, 3);
      break;
    }
    case 'stone':
    case 'brick':
    case 'concrete':
    case 'thick': {
      const base = s.style === 'thick' ? '#2a2c38' : s.style === 'concrete' ? '#30333d' : s.style === 'brick' ? '#3a2e2c' : '#363a46';
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      if (s.style === 'brick' || s.style === 'stone') {
        const bh = s.style === 'brick' ? 14 : 26, bw = s.style === 'brick' ? 30 : 48;
        ctx.beginPath();
        for (let yy = y + bh, row = 0; yy < y + h; yy += bh, row++) {
          ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
        }
        for (let yy = y, row = 0; yy < y + h; yy += bh, row++) {
          for (let xx = x + ((row % 2) * bw) / 2; xx < x + w; xx += bw) {
            ctx.moveTo(xx, yy); ctx.lineTo(xx, Math.min(y + h, yy + bh));
          }
        }
        ctx.stroke();
      } else if (s.style === 'thick') {
        // reinforced concrete: diagonal hatching + bolts
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        for (let d = -h; d < w; d += 22) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(160,140,255,0.12)';
        ctx.fillRect(x, y, 3, h); ctx.fillRect(x + w - 3, y, 3, h);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        for (let i = 0; i < s.deco.length; i += 3) ctx.fillRect(x + s.deco[i] * w, y + s.deco[i + 1] * h, 2 + s.deco[i + 2] * 8, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + h - 3, w, 3);
      break;
    }
    case 'metal': {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#4a5462');
      g.addColorStop(1, '#262c36');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let xx = x + 40; xx < x + w; xx += 40) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,220,255,0.18)';
      for (let xx = x + 6; xx < x + w; xx += 40) {
        ctx.fillRect(xx, y + 4, 2, 2);
        if (h > 16) ctx.fillRect(xx, y + h - 6, 2, 2);
      }
      ctx.fillStyle = 'rgba(180,210,255,0.25)';
      ctx.fillRect(x, y, w, 2);
      break;
    }
    case 'wood': {
      ctx.fillStyle = '#5a3e26';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (w > h) for (let xx = x + 34; xx < x + w; xx += 34) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
      else for (let yy = y + 34; yy < y + h; yy += 34) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,170,0.12)';
      ctx.fillRect(x, y, w, 2);
      break;
    }
  }
  if (s.oneway) {
    ctx.fillStyle = 'rgba(140,200,255,0.25)';
    ctx.fillRect(x, y, w, 2);
  }
}
