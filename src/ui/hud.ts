// HUD, reticle/auto-aim lock, title screen, pause screen and the tabbed help
// "field guide" (all canvas-drawn, scaled for small screens).

import type { Game } from '../game';
import { clamp, RGB, rgba, TAU } from '../core/math';
import { KEY_LABELS, Power } from '../powers/power';
import { drawGlyph } from './glyphs';

const FONT = '"SF Pro Display", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

interface Combo { a: string; b: string; text: string; powers: string[] }

export const COMBOS: Combo[] = [
  { a: 'Lightning', b: 'Water', text: 'Shock a pool and the whole surface electrifies everything in it. Don\'t stand in it yourself.', powers: ['lightning', 'water'] },
  { a: 'Water', b: 'Lightning', text: 'Soak targets first: wet things take far more shock damage and conduct chains.', powers: ['water', 'lightning'] },
  { a: 'Lightning', b: 'Metal', text: 'Bolts chain through metal. Overcharge (hold I) powers generators, lamps and doors.', powers: ['lightning'] },
  { a: 'Fire', b: 'Water', text: 'Heat boils water into steam clouds that hide you and scald dummies.', powers: ['fire', 'water'] },
  { a: 'Water', b: 'Freeze', text: 'Freeze a pool into a walkable ice bridge. Soak a dummy, freeze it solid, then shatter it.', powers: ['water'] },
  { a: 'Fire', b: 'Ice', text: 'Heat Wave and flames melt ice walls and bridges.', powers: ['fire', 'water'] },
  { a: 'Fire', b: 'Wood & Straw', text: 'Flames spread from crate to crate and burn things to ash and scorch marks.', powers: ['fire'] },
  { a: 'Fire', b: 'Explosions', text: 'Fireballs knock you back too. Rocket-jump off your own explosions.', powers: ['fire'] },
  { a: 'Earth', b: 'Fire', text: 'Raise a pillar under a burning crate to launch it into a stack.', powers: ['earth', 'fire'] },
  { a: 'Earth', b: 'Lamps', text: 'Throw rocks at lamps to break them and make darkness for Shadow.', powers: ['earth', 'shadow'] },
  { a: 'Earth', b: 'Water', text: 'Raise pillars out of pools. Earthquakes make waves.', powers: ['earth', 'water'] },
  { a: 'Shadow', b: 'Darkness', text: 'Shadow energy regenerates in dark rooms and drains under lamps, fire and lightning.', powers: ['shadow', 'fire', 'lightning'] },
  { a: 'Shadow', b: 'Thick walls', text: 'Phase (hold I) through walls into sealed rooms. Run dry inside and you get violently ejected.', powers: ['shadow'] },
  { a: 'Shadow', b: 'Steam', text: 'Invisible inside a steam cloud: NPCs lose you completely.', powers: ['shadow', 'fire', 'water'] },
];

const TABS = ['lightning', 'fire', 'water', 'earth', 'shadow', 'controls', 'lab'] as const;

export class Hud {
  powerFlash = 0;
  helpTab = 0;
  private energyShown = 1;
  private hpShown = 1;
  private t = 0;
  private lockT = 0;

  update(dt: number) {
    this.t += dt;
    if (this.powerFlash > 0) this.powerFlash = Math.max(0, this.powerFlash - dt * 2);
    this.lockT += dt;
  }

  helpNav(delta: number) { this.helpTab = (this.helpTab + delta + TABS.length) % TABS.length; }

  draw(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    if (g.title) { this.drawTitle(ctx, g, W, H); return; }
    const p = g.power;
    const s = clamp(Math.min(W / 1100, H / 700), 0.7, 1.15);
    this.drawReticle(ctx, g);
    this.drawStatus(ctx, g, p, s);
    this.drawSelector(ctx, g, W / 2, 26 * s, s);
    this.drawChips(ctx, g, W, s);
    this.drawAbilities(ctx, p, g, W, H, s);
    ctx.save();
    ctx.font = `600 ${11 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,240,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText('H  field guide   ·   P  pause', W - 16 * s, H - 14 * s);
    ctx.restore();
    if (g.toast.t > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(g.toast.t * 2, 0, 1);
      ctx.font = `700 ${14 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(g.toast.text).width + 32 * s;
      const ty = 74 * s;
      glass(ctx, W / 2 - tw / 2, ty, tw, 30 * s, 15 * s, p.color);
      ctx.fillStyle = '#eef1ff';
      ctx.fillText(g.toast.text, W / 2, ty + 20 * s);
      ctx.restore();
    }
    if (g.showHelp) this.drawHelp(ctx, g, W, H);
    else if (g.loop.paused) this.drawPause(ctx, g, W, H);
  }

  // ------------------------------------------------------------------ status

  private drawStatus(ctx: CanvasRenderingContext2D, g: Game, p: Power, s: number) {
    const col = p.color;
    ctx.save();
    ctx.translate(16 * s, 16 * s);
    ctx.scale(s, s);
    glass(ctx, 0, 0, 268, 76, 18, col);
    const pool = p.energyPool();
    const e = pool === 'shadow' ? g.shadowEnergy / g.maxShadowEnergy : g.energy / g.maxEnergy;
    this.energyShown += (clamp(e, 0, 1) - this.energyShown) * 0.25;
    const pulse = 1 + this.powerFlash * 0.2;
    ctx.save();
    ctx.translate(38, 38);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(4,6,14,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(col, 0.95);
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + TAU * (g.infinite ? 1 : this.energyShown)); ctx.stroke();
    ctx.shadowBlur = 0;
    p.drawIcon(ctx, 0, 0, 15);
    ctx.restore();
    ctx.font = `800 17px ${FONT}`;
    ctx.fillStyle = rgba(col, 1);
    const nm = p.name.toUpperCase();
    ctx.fillText(nm, 74, 26);
    const nw = ctx.measureText(nm).width;
    ctx.font = `600 9.5px ${FONT}`;
    ctx.fillStyle = 'rgba(210,216,245,0.5)';
    ctx.fillText(pool === 'shadow' ? 'SHADOW ENERGY' : 'ENERGY', 74 + nw + 10, 25);
    this.bar(ctx, 74, 36, 178, 8, g.infinite ? 1 : this.energyShown, col, g.infinite ? '∞' : `${Math.round(pool === 'shadow' ? g.shadowEnergy : g.energy)}`);
    const hp = clamp(g.player.hp / g.player.maxHp, 0, 1);
    this.hpShown += (hp - this.hpShown) * 0.2;
    this.bar(ctx, 74, 52, 178, 6, this.hpShown, hp > 0.35 ? [110, 230, 150] : [255, 90, 80], '', 10);
    if (g.player.armor > 0) this.bar(ctx, 74, 62, 178, 4, g.player.armor / Math.max(1, g.player.armorMax), [190, 160, 120], '');
    ctx.restore();
    if (p.id === 'shadow') {
      const light = g.lighting.lightAt(g.player.x, g.player.y - 20);
      const dark = light < 0.45;
      const txt = dark ? '◐  IN SHADOW · regenerating' : light > 0.9 ? '☀  EXPOSED · draining' : '◑  DIM · slow regen';
      ctx.save();
      ctx.font = `700 ${11 * s}px ${FONT}`;
      const w = ctx.measureText(txt).width + 22 * s;
      const c: RGB = dark ? [190, 150, 255] : light > 0.9 ? [255, 200, 120] : [210, 200, 230];
      glass(ctx, 16 * s, 98 * s, w, 22 * s, 11 * s, c);
      ctx.fillStyle = rgba(c, 1);
      ctx.fillText(txt, 27 * s, 113 * s);
      ctx.restore();
    }
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, col: RGB, label: string, ticks = 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    pill(ctx, x, y, w, h); ctx.fill();
    if (f > 0.001) {
      const gr = ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, rgba(col, 0.65));
      gr.addColorStop(1, rgba(col, 1));
      ctx.fillStyle = gr;
      pill(ctx, x, y, Math.max(h, w * f), h); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      pill(ctx, x + 2, y + 1, Math.max(0, w * f - 4), Math.max(1, h * 0.3)); ctx.fill();
    }
    if (ticks) {
      ctx.fillStyle = 'rgba(4,6,14,0.6)';
      for (let i = 1; i < ticks; i++) ctx.fillRect(x + (w * i) / ticks - 0.5, y, 1, h);
    }
    if (label) {
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = 'rgba(230,235,255,0.7)';
      ctx.textAlign = 'right';
      ctx.fillText(label, x + w, y - 3);
      ctx.textAlign = 'left';
    }
  }

  private drawSelector(ctx: CanvasRenderingContext2D, g: Game, cx: number, y: number, s: number) {
    const n = g.powerList.length;
    const gap = 42 * s;
    const w = gap * n + 40 * s;
    ctx.save();
    glass(ctx, cx - w / 2, y - 20 * s, w, 46 * s, 23 * s, g.power.color);
    ctx.font = `700 ${9 * s}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,216,245,0.45)';
    ctx.fillText('Q', cx - w / 2 + 12 * s, y + 6 * s);
    ctx.fillText('E', cx + w / 2 - 12 * s, y + 6 * s);
    for (let i = 0; i < n; i++) {
      const p = g.powerList[i];
      const x = cx + (i - (n - 1) / 2) * gap;
      const cur = i === g.powerIndex;
      if (cur) {
        ctx.fillStyle = rgba(p.color, 0.18);
        ctx.beginPath(); ctx.arc(x, y, 16 * s, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(p.color, 0.95);
        ctx.lineWidth = 2 * s;
        ctx.shadowColor = rgba(p.color, 0.9);
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = cur ? 1 : 0.42;
      p.drawIcon(ctx, x, y, (cur ? 10 : 8) * s);
      ctx.globalAlpha = cur ? 0.95 : 0.4;
      ctx.fillStyle = cur ? rgba(p.color, 1) : '#cfd6ff';
      ctx.fillText(String(i + 1), x, y + 22 * s);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawChips(ctx: CanvasRenderingContext2D, g: Game, W: number, s: number) {
    ctx.save();
    ctx.font = `700 ${11 * s}px ${FONT}`;
    let y = 16 * s;
    const chip = (text: string, col: RGB, strong = false) => {
      const w = ctx.measureText(text).width + 22 * s;
      const x = W - 16 * s - w;
      glass(ctx, x, y, w, 24 * s, 12 * s, col, strong ? 0.5 : 0.25);
      ctx.fillStyle = strong ? rgba(col, 1) : 'rgba(220,226,250,0.85)';
      ctx.fillText(text, x + 11 * s, y + 16 * s);
      y += 30 * s;
    };
    chip(`${g.map.name}   N ›`, [160, 180, 255]);
    if (g.autoAim) chip('◎ AUTO-AIM  G', [120, 255, 190], true);
    if (g.infinite) chip('∞ SANDBOX  F', [255, 211, 107], true);
    if (g.slowmo) chip('◷ SLOW-MO  V', [143, 216, 255], true);
    if (g.muted) chip('MUTED  M', [255, 154, 143], true);
    ctx.restore();
  }

  private drawAbilities(ctx: CanvasRenderingContext2D, p: Power, g: Game, W: number, H: number, s: number) {
    const slotW = 104 * s, slotH = 70 * s, gap = 10 * s;
    const total = slotW * 4 + gap * 3;
    const x0 = W / 2 - total / 2;
    const y0 = H - slotH - 16 * s;
    const pool = p.energyPool();
    const energy = pool === 'shadow' ? g.shadowEnergy : g.energy;
    for (let i = 0; i < 4; i++) {
      const a = p.abilities[i];
      const x = x0 + i * (slotW + gap);
      const active = p.holding[i] || p.toggled[i];
      const cd = g.infinite ? 0 : p.cd[i];
      const afford = g.infinite || energy >= (a.kind === 'tap' ? a.cost : 2);
      ctx.save();
      glass(ctx, x, y0, slotW, slotH, 14 * s, p.color, active ? 0.9 : 0.25, active ? 0.2 : 0);
      if (active) {
        ctx.shadowColor = rgba(p.color, 0.8);
        ctx.shadowBlur = 16;
        ctx.strokeStyle = rgba(p.color, 0.9);
        ctx.lineWidth = 2;
        rr(ctx, x, y0, slotW, slotH, 14 * s); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (p.denyFlash[i] > 0) {
        ctx.strokeStyle = `rgba(255,80,80,${Math.min(1, p.denyFlash[i] * 2)})`;
        ctx.lineWidth = 2;
        rr(ctx, x, y0, slotW, slotH, 14 * s); ctx.stroke();
      }
      const gx = x + 26 * s, gy = y0 + 30 * s;
      ctx.fillStyle = rgba(p.color, active ? 0.25 : 0.1);
      ctx.beginPath(); ctx.arc(gx, gy, 17 * s, 0, TAU); ctx.fill();
      ctx.globalAlpha = cd > 0 || !afford ? 0.4 : 1;
      drawGlyph(ctx, a.glyph, gx, gy, 22 * s, rgba(p.color, 1));
      ctx.globalAlpha = 1;
      if (cd > 0 && a.cooldown > 0) {
        const f = cd / a.cooldown;
        ctx.fillStyle = 'rgba(2,3,8,0.6)';
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.arc(gx, gy, 18 * s, -Math.PI / 2, -Math.PI / 2 + TAU * f);
        ctx.closePath();
        ctx.fill();
        ctx.font = `800 ${10 * s}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(cd.toFixed(1), gx, gy + 4 * s);
        ctx.textAlign = 'left';
      }
      const kx = x + slotW - 22 * s, ky = y0 + 8 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      rr(ctx, kx, ky, 15 * s, 16 * s, 4 * s); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(kx, ky + 13 * s, 15 * s, 3 * s);
      ctx.font = `800 ${10 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2f4ff';
      ctx.fillText(KEY_LABELS[i], kx + 7.5 * s, ky + 11.5 * s);
      ctx.textAlign = 'left';
      ctx.font = `700 ${11 * s}px ${FONT}`;
      ctx.fillStyle = cd > 0 ? 'rgba(220,225,255,0.55)' : '#eef1ff';
      ctx.fillText(a.short, x + 48 * s, y0 + 28 * s, slotW - 72 * s);
      ctx.font = `700 ${8.5 * s}px ${FONT}`;
      ctx.fillStyle = rgba(p.color, 0.85);
      const tag = a.kind === 'hold' ? 'HOLD' : a.kind === 'toggle' ? (p.toggled[i] ? 'ON' : 'TOGGLE') : 'TAP';
      ctx.fillText(tag + (a.offensive ? ' · ATK' : ''), x + 48 * s, y0 + 41 * s);
      ctx.font = `600 ${8.5 * s}px ${FONT}`;
      ctx.fillStyle = afford ? 'rgba(200,205,230,0.55)' : 'rgba(255,110,100,0.9)';
      ctx.fillText(a.kind === 'tap' ? `${a.cost} energy` : `${a.cost}/s`, x + 48 * s, y0 + 56 * s);
      if (p.charge[i] > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        pill(ctx, x + 10 * s, y0 + slotH - 8 * s, slotW - 20 * s, 3 * s); ctx.fill();
        ctx.fillStyle = rgba(p.color, 1);
        pill(ctx, x + 10 * s, y0 + slotH - 8 * s, (slotW - 20 * s) * clamp(p.charge[i], 0, 1), 3 * s); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ reticle

  private drawReticle(ctx: CanvasRenderingContext2D, g: Game) {
    const pl = g.player;
    if (pl.dead) return;
    const p = g.power;
    const d = pl.aimDir();
    const near = g.cam.toScreen(pl.x + d.x * 90, pl.y - 14 + d.y * 90);
    const col = p.color;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.translate(near.x, near.y);
    ctx.rotate(Math.atan2(d.y, d.x));
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(2, 0); ctx.lineTo(-5, 6); ctx.stroke();
    ctx.strokeStyle = rgba(col, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(2, 0); ctx.lineTo(-5, 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(-14, 0, 2, 0, TAU); ctx.fillStyle = rgba(col, 0.8); ctx.fill();
    ctx.restore();
    const tgt = pl.autoTarget;
    if (g.autoAim && tgt && !tgt.dead) {
      const b = tgt.bounds();
      const tl = g.cam.toScreen(b.x0 - 6, b.y0 - 6), br = g.cam.toScreen(b.x1 + 6, b.y1 + 6);
      const w = br.x - tl.x, L = Math.min(10, w / 3);
      const k = 1 + Math.sin(this.lockT * 8) * 0.04;
      const cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      ctx.strokeStyle = 'rgba(130,255,190,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [x, y, sx, sy] of [[tl.x, tl.y, 1, 1], [br.x, tl.y, -1, 1], [tl.x, br.y, 1, -1], [br.x, br.y, -1, -1]] as const) {
        ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    const r = p.reticle();
    if (r) {
      const sp = g.cam.toScreen(r.x, r.y);
      ctx.save();
      ctx.strokeStyle = rgba(col, 0.75);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -this.t * 20;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 15 + Math.sin(this.t * 6) * 2, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(col, 0.9);
      ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ title

  private drawTitle(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const t = g.realTime;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(3,4,10,0.75)');
    grd.addColorStop(0.5, 'rgba(3,4,10,0.35)');
    grd.addColorStop(1, 'rgba(3,4,10,0.85)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = 'center';
    const big = Math.min(104, W / 8.5);
    const cols: RGB[] = g.powerList.map((p) => p.color);
    const ci = ((Math.floor(t * 0.6) % cols.length) + cols.length) % cols.length;
    const c = cols[ci] || cols[0];
    ctx.font = `900 ${big}px ${FONT}`;
    ctx.shadowColor = rgba(c, 0.9);
    ctx.shadowBlur = 40 + Math.sin(t * 3) * 10;
    ctx.fillStyle = '#f4f6ff';
    ctx.fillText('MODULO', W / 2, H / 2 - big * 0.32);
    ctx.font = `800 ${big * 0.5}px ${FONT}`;
    ctx.fillStyle = rgba(c, 1);
    ctx.fillText('P  O  W  E  R  S', W / 2, H / 2 + big * 0.36);
    ctx.shadowBlur = 0;
    const n = g.powerList.length, gap = big * 0.7;
    for (let i = 0; i < n; i++) {
      const p = g.powerList[i];
      const x = W / 2 + (i - (n - 1) / 2) * gap, y = H / 2 + big * 0.95;
      ctx.globalAlpha = i === ci ? 1 : 0.45;
      p.drawIcon(ctx, x, y, big * (i === ci ? 0.16 : 0.12));
    }
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 3);
    ctx.font = `700 ${Math.max(14, big * 0.18)}px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('press any key', W / 2, H / 2 + big * 1.55);
    ctx.globalAlpha = 0.5;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText('A/D move  ·  W jump  ·  J K L I abilities  ·  1–5 powers  ·  G auto-aim  ·  H field guide', W / 2, H - 28);
    ctx.restore();
  }

  // ------------------------------------------------------------------ overlays

  private panel(ctx: CanvasRenderingContext2D, W: number, H: number, pw: number, ph: number, col: RGB) {
    ctx.fillStyle = 'rgba(2,3,8,0.62)';
    ctx.fillRect(0, 0, W, H);
    const x = W / 2 - pw / 2, y = Math.max(8, H / 2 - ph / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = 'rgba(10,12,24,0.95)';
    rr(ctx, x, y, pw, ph, 20); ctx.fill();
    ctx.restore();
    const gr = ctx.createLinearGradient(x, y, x + pw, y + ph);
    gr.addColorStop(0, rgba(col, 0.55));
    gr.addColorStop(0.5, 'rgba(140,160,255,0.12)');
    gr.addColorStop(1, rgba(col, 0.3));
    ctx.strokeStyle = gr;
    ctx.lineWidth = 1.5;
    rr(ctx, x, y, pw, ph, 20); ctx.stroke();
    return { x, y };
  }

  private drawPause(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const s = clamp(Math.min(W / 760, H / 560), 0.6, 1.1);
    const pw = 640 * s, ph = 480 * s;
    const { x, y } = this.panel(ctx, W, H, pw, ph, g.power.color);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.font = `900 36px ${FONT}`;
    ctx.fillStyle = '#f2f4ff';
    ctx.fillText('PAUSED', 320, 54);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,255,0.6)';
    ctx.fillText('P resume   ·   H field guide', 320, 76);
    ctx.textAlign = 'left';
    this.controlsGrid(ctx, 34, 108, 572);
    ctx.restore();
  }

  private controlsGrid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const groups: [string, [string, string][]][] = [
      ['MOVE', [['A / D', 'move'], ['W / Space', 'jump (hold = higher)'], ['S', 'crouch / drop through'], ['Arrows', 'aim (mouse aims too)']]],
      ['POWERS', [['J', 'attack (click / tap)'], ['K  L  I', 'abilities 2 · 3 · 4'], ['1 – 5', 'pick a power'], ['Q / E', 'previous / next'], ['G', 'toggle auto-aim']]],
      ['WORLD', [['R', 'reset map'], ['T', 'reset player'], ['N', 'next map'], ['B', 'spawn dummy at aim']]],
      ['SANDBOX', [['F', 'infinite energy'], ['V', 'slow motion'], ['M', 'mute'], ['P / H', 'pause / field guide']]],
    ];
    const colW = w / 2;
    groups.forEach(([title, rows], gi) => {
      const cx = x + (gi % 2) * colW;
      let cy = y + Math.floor(gi / 2) * 172;
      ctx.font = `800 11px ${FONT}`;
      ctx.fillStyle = 'rgba(170,185,255,0.7)';
      ctx.fillText(title, cx, cy);
      cy += 24;
      for (const [k, d] of rows) {
        keycap(ctx, cx, cy, k);
        ctx.font = `500 12.5px ${FONT}`;
        ctx.fillStyle = 'rgba(215,220,245,0.85)';
        ctx.fillText(d, cx + 92, cy + 1);
        cy += 28;
      }
    });
  }

  private drawHelp(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const s = clamp(Math.min(W / 1020, H / 680), 0.5, 1.15);
    const pw = 980 * s, ph = 640 * s;
    const tab = TABS[this.helpTab];
    const tabPower = g.powerList.find((p) => p.id === tab);
    const col: RGB = tabPower ? tabPower.color : tab === 'lab' ? [255, 210, 130] : [160, 180, 255];
    const { x, y } = this.panel(ctx, W, H, pw, ph, col);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.font = `900 13px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,255,0.55)';
    ctx.fillText('MODULO: POWERS  ·  FIELD GUIDE', 30, 36);
    ctx.textAlign = 'right';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText('← →  switch tab    ·    1–5  power    ·    H  close', 950, 36);
    ctx.textAlign = 'left';
    let tx = 30;
    const ty = 52;
    for (let i = 0; i < TABS.length; i++) {
      const id = TABS[i];
      const p = g.powerList.find((q) => q.id === id);
      const label = p ? p.name : id === 'controls' ? 'Controls' : '⚗ Power Lab';
      ctx.font = `800 13px ${FONT}`;
      const tw = ctx.measureText(label).width + (p ? 46 : 26);
      const cur = i === this.helpTab;
      const c: RGB = p ? p.color : id === 'lab' ? [255, 210, 130] : [160, 180, 255];
      ctx.fillStyle = cur ? rgba(c, 0.2) : 'rgba(255,255,255,0.04)';
      rr(ctx, tx, ty, tw, 34, 17); ctx.fill();
      if (cur) { ctx.strokeStyle = rgba(c, 0.9); ctx.lineWidth = 1.5; rr(ctx, tx, ty, tw, 34, 17); ctx.stroke(); }
      if (p) { ctx.globalAlpha = cur ? 1 : 0.6; p.drawIcon(ctx, tx + 20, ty + 17, 8); ctx.globalAlpha = 1; }
      ctx.fillStyle = cur ? rgba(c, 1) : 'rgba(210,216,245,0.6)';
      ctx.fillText(label, tx + (p ? 34 : 13), ty + 22);
      tx += tw + 8;
    }
    const by = 106;
    if (tabPower) this.helpPower(ctx, g, tabPower, by);
    else if (tab === 'controls') this.controlsGrid(ctx, 60, by + 40, 860);
    else this.helpLab(ctx, by);
    ctx.restore();
  }

  private helpPower(ctx: CanvasRenderingContext2D, g: Game, p: Power, y: number) {
    const col = p.color;
    ctx.fillStyle = rgba(col, 0.1);
    ctx.beginPath(); ctx.arc(66, y + 40, 34, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 2; ctx.stroke();
    p.drawIcon(ctx, 66, y + 40, 20);
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = rgba(col, 1);
    ctx.fillText(p.name.toUpperCase(), 116, y + 38);
    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = 'rgba(215,220,245,0.8)';
    ctx.fillText(p.tagline, 116, y + 60);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(200,205,235,0.5)';
    ctx.fillText(p.energyPool() === 'shadow' ? 'Uses its own SHADOW energy: regenerates in darkness, drains in light.' : 'Uses the shared energy bar. Press F for unlimited energy and no cooldowns.', 116, y + 78);
    const idx = g.powerList.indexOf(p);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(200,205,235,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText('select with', 912, y + 24);
    ctx.textAlign = 'left';
    keycap(ctx, 920, y + 24, String(idx + 1));
    const cw = 452, ch = 118;
    for (let i = 0; i < 4; i++) {
      const a = p.abilities[i];
      const cx = 30 + (i % 2) * (cw + 16), cy = y + 100 + Math.floor(i / 2) * (ch + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      rr(ctx, cx, cy, cw, ch, 14); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.22); ctx.lineWidth = 1; rr(ctx, cx, cy, cw, ch, 14); ctx.stroke();
      ctx.fillStyle = rgba(col, 0.12);
      ctx.beginPath(); ctx.arc(cx + 40, cy + 42, 24, 0, TAU); ctx.fill();
      drawGlyph(ctx, a.glyph, cx + 40, cy + 42, 30, rgba(col, 1));
      keycap(ctx, cx + 28, cy + 92, KEY_LABELS[i]);
      ctx.font = `800 15px ${FONT}`;
      ctx.fillStyle = '#f2f4ff';
      ctx.fillText(a.name, cx + 80, cy + 28);
      const tag = `${a.kind.toUpperCase()}${a.offensive ? ' · ATTACK' : ''}   ·   ${a.kind === 'tap' ? a.cost + ' energy' : a.cost + ' energy/s'}${a.cooldown ? '   ·   ' + a.cooldown + ' s cooldown' : ''}`;
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = rgba(col, 0.9);
      ctx.fillText(tag, cx + 80, cy + 45);
      ctx.font = `500 12.5px ${FONT}`;
      ctx.fillStyle = 'rgba(210,216,245,0.82)';
      wrap(ctx, a.desc, cx + 80, cy + 66, cw - 96, 16);
    }
    const combos = COMBOS.filter((c) => c.powers.includes(p.id)).slice(0, 3);
    let cy = y + 100 + 2 * (ch + 12) + 14;
    ctx.font = `800 12px ${FONT}`;
    ctx.fillStyle = '#ffd98a';
    ctx.fillText('⚗  TRY THIS', 30, cy);
    for (const c of combos) {
      cy += 20;
      ctx.fillStyle = '#ffe9b8';
      ctx.font = `700 12px ${FONT}`;
      const head = `${c.a} + ${c.b}:  `;
      ctx.fillText(head, 44, cy);
      const hw = ctx.measureText(head).width;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillStyle = 'rgba(215,220,245,0.75)';
      ctx.fillText(c.text, 44 + hw, cy, 880 - hw);
    }
  }

  private helpLab(ctx: CanvasRenderingContext2D, y: number) {
    ctx.font = `900 22px ${FONT}`;
    ctx.fillStyle = '#ffd98a';
    ctx.fillText('⚗  POWER LAB', 30, y + 24);
    ctx.font = `500 13px ${FONT}`;
    ctx.fillStyle = 'rgba(215,220,245,0.7)';
    ctx.fillText('The world reacts to every power. These combos are waiting to be discovered:', 30, y + 46);
    const colW = 452;
    COMBOS.forEach((c, i) => {
      const cx = 30 + (i % 2) * (colW + 16), cy = y + 64 + Math.floor(i / 2) * 64;
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      rr(ctx, cx, cy, colW, 56, 12); ctx.fill();
      ctx.font = `800 13px ${FONT}`;
      ctx.fillStyle = '#ffe9b8';
      ctx.fillText(`${c.a}  +  ${c.b}`, cx + 14, cy + 21);
      ctx.font = `500 11.5px ${FONT}`;
      ctx.fillStyle = 'rgba(215,220,245,0.78)';
      wrap(ctx, c.text, cx + 14, cy + 38, colW - 28, 14);
    });
  }
}

// ------------------------------------------------------------------ helpers

function keycap(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.save();
  ctx.font = `800 11.5px ${FONT}`;
  const w = Math.max(24, ctx.measureText(label).width + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.11)';
  rr(ctx, x, y - 15, w, 22, 6); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 3, y + 5, w - 6, 2);
  ctx.fillStyle = '#f2f4ff';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y);
  ctx.restore();
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, col: RGB, border = 0.25, tint = 0) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(18,22,40,0.78)');
  g.addColorStop(1, 'rgba(6,8,16,0.82)');
  ctx.fillStyle = g;
  rr(ctx, x, y, w, h, r); ctx.fill();
  if (tint) { ctx.fillStyle = rgba(col, tint); rr(ctx, x, y, w, h, r); ctx.fill(); }
  ctx.strokeStyle = rgba(col, border);
  ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(x + r, y + 1.5); ctx.lineTo(x + w - r, y + 1.5); ctx.stroke();
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) { rr(ctx, x, y, w, h, h / 2); }

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export const roundRect = rr;

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > w && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}
