// HUD, reticle, title screen, pause and help overlays (all canvas-drawn).

import type { Game } from '../game';
import { clamp, RGB, rgba, TAU } from '../core/math';
import { KEY_LABELS, Power } from '../powers/power';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class Hud {
  powerFlash = 0;
  private energyShown = 100;
  private t = 0;

  update(dt: number) {
    this.t += dt;
    if (this.powerFlash > 0) this.powerFlash = Math.max(0, this.powerFlash - dt * 2);
  }

  draw(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    if (g.title) { this.drawTitle(ctx, g, W, H); return; }
    const p = g.power;
    this.drawReticle(ctx, g);
    const compact = W < 760;
    const s = compact ? 0.82 : 1;

    // ---- top-left: power badge + bars
    ctx.save();
    ctx.translate(18, 18);
    ctx.scale(s, s);
    const col = p.color;
    // badge
    const pulse = 1 + this.powerFlash * 0.25;
    ctx.save();
    ctx.translate(30, 30);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(8,10,18,0.75)';
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = 2.5;
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    p.drawIcon(ctx, 0, 0, 20);
    ctx.restore();
    ctx.font = `800 18px ${FONT}`;
    ctx.fillStyle = rgba(col, 1);
    ctx.fillText(p.name.toUpperCase(), 70, 22);
    // energy bar
    const pool = p.energyPool();
    const e = pool === 'shadow' ? g.shadowEnergy / g.maxShadowEnergy : g.energy / g.maxEnergy;
    this.energyShown += (e - this.energyShown) * 0.25;
    this.bar(ctx, 70, 32, 180, 9, clamp(this.energyShown, 0, 1), col, g.infinite ? '∞' : pool === 'shadow' ? 'SHADOW' : 'ENERGY');
    // hp bar
    const hp = g.player.hp / g.player.maxHp;
    this.bar(ctx, 70, 48, 180, 6, hp, hp > 0.4 ? [120, 230, 140] : [255, 90, 80], 'HP');
    if (g.player.armor > 0) this.bar(ctx, 70, 59, 180, 4, g.player.armor / Math.max(1, g.player.armorMax), [170, 140, 110], '');
    // shadow light meter when shadow is equipped
    if (p.id === 'shadow') {
      const light = g.lighting.lightAt(g.player.x, g.player.y - 20);
      const dark = light < 0.45;
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = dark ? 'rgba(200,160,255,0.95)' : 'rgba(255,220,150,0.95)';
      ctx.fillText(dark ? '◐ IN SHADOW: regenerating' : light > 0.9 ? '☀ EXPOSED: draining' : '◑ DIM: slow regen', 70, 78);
    }
    ctx.restore();

    // ---- power selector (top-center)
    this.drawSelector(ctx, g, W / 2, 22, s);

    // ---- top-right: map + modes + help hint
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,240,0.8)';
    ctx.fillText(`${g.map.name}  ·  N`, W - 18, 26);
    let y = 44;
    ctx.font = `700 11px ${FONT}`;
    if (g.infinite) { ctx.fillStyle = '#ffd36b'; ctx.fillText('∞ SANDBOX (F)', W - 18, y); y += 16; }
    if (g.slowmo) { ctx.fillStyle = '#8fd8ff'; ctx.fillText('SLOW-MO (V)', W - 18, y); y += 16; }
    if (g.muted) { ctx.fillStyle = '#ff9a8f'; ctx.fillText('MUTED (M)', W - 18, y); y += 16; }
    ctx.fillStyle = 'rgba(200,210,240,0.55)';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText('press H for help · P pause', W - 18, H - 16);
    ctx.restore();

    // ---- abilities (bottom-center)
    this.drawAbilities(ctx, p, g, W, H, s);

    // ---- toast
    if (g.toast.t > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(g.toast.t * 2, 0, 1);
      ctx.font = `700 15px ${FONT}`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(g.toast.text).width + 28;
      ctx.fillStyle = 'rgba(8,10,18,0.75)';
      roundRect(ctx, W / 2 - tw / 2, 64, tw, 30, 15); ctx.fill();
      ctx.fillStyle = '#e8ecff';
      ctx.fillText(g.toast.text, W / 2, 84);
      ctx.restore();
    }

    if (g.loop.paused) this.drawPause(ctx, g, W, H);
    else if (g.showHelp) this.drawHelp(ctx, g, W, H);
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, col: RGB, label: string) {
    ctx.fillStyle = 'rgba(8,10,18,0.7)';
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2); ctx.fill();
    if (f > 0) {
      const gr = ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, rgba(col, 0.75));
      gr.addColorStop(1, rgba(col, 1));
      ctx.fillStyle = gr;
      roundRect(ctx, x, y, Math.max(h, w * f), h, h / 2); ctx.fill();
    }
    if (label) {
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = 'rgba(230,235,255,0.7)';
      ctx.fillText(label, x + w + 8, y + h - 1);
    }
  }

  private drawSelector(ctx: CanvasRenderingContext2D, g: Game, cx: number, y: number, s: number) {
    const n = g.powerList.length;
    const gap = 40 * s;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const p = g.powerList[i];
      const x = cx + (i - (n - 1) / 2) * gap;
      const cur = i === g.powerIndex;
      ctx.globalAlpha = cur ? 1 : 0.45;
      ctx.fillStyle = 'rgba(8,10,18,0.7)';
      ctx.beginPath(); ctx.arc(x, y, cur ? 15 * s : 12 * s, 0, TAU); ctx.fill();
      if (cur) {
        ctx.strokeStyle = rgba(p.color, 1);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      p.drawIcon(ctx, x, y, (cur ? 10 : 8) * s);
      ctx.font = `700 ${9 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220,225,255,0.8)';
      ctx.fillText(String(i + 1), x, y + 27 * s);
    }
    ctx.globalAlpha = 0.5;
    ctx.font = `700 ${10 * s}px ${FONT}`;
    ctx.fillStyle = '#cfd6ff';
    ctx.textAlign = 'right';
    ctx.fillText('Q', cx - ((n - 1) / 2) * gap - 26 * s, y + 4);
    ctx.textAlign = 'left';
    ctx.fillText('E', cx + ((n - 1) / 2) * gap + 26 * s, y + 4);
    ctx.restore();
  }

  private drawAbilities(ctx: CanvasRenderingContext2D, p: Power, g: Game, W: number, H: number, s: number) {
    const slotW = 92 * s, gap = 10 * s;
    const total = slotW * 4 + gap * 3;
    const x0 = W / 2 - total / 2;
    const y0 = H - 86 * s;
    for (let i = 0; i < 4; i++) {
      const a = p.abilities[i];
      const x = x0 + i * (slotW + gap);
      const active = p.holding[i] || p.toggled[i];
      const cd = p.cd[i];
      ctx.save();
      ctx.fillStyle = active ? rgba(p.color, 0.22) : 'rgba(8,10,18,0.72)';
      roundRect(ctx, x, y0, slotW, 64 * s, 12 * s); ctx.fill();
      ctx.strokeStyle = p.denyFlash[i] > 0 ? 'rgba(255,80,80,0.9)' : active ? rgba(p.color, 0.95) : rgba(p.color, 0.3);
      ctx.lineWidth = active ? 2 : 1.2;
      roundRect(ctx, x, y0, slotW, 64 * s, 12 * s); ctx.stroke();
      // key cap
      const kx = x + 18 * s, ky = y0 + 20 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, kx - 11 * s, ky - 11 * s, 22 * s, 22 * s, 5 * s); ctx.fill();
      ctx.font = `800 ${13 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eef1ff';
      ctx.fillText(KEY_LABELS[i], kx, ky + 5 * s);
      // cooldown ring around the key cap
      if (cd > 0 && a.cooldown > 0) {
        const f = cd / a.cooldown;
        ctx.strokeStyle = rgba(p.color, 0.9);
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.arc(kx, ky, 15 * s, -Math.PI / 2, -Math.PI / 2 + TAU * f);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(ctx, x, y0, slotW, 64 * s, 12 * s); ctx.fill();
      }
      if (p.charge[i] > 0) {
        ctx.fillStyle = rgba(p.color, 0.9);
        ctx.fillRect(x + 8 * s, y0 + 58 * s, (slotW - 16 * s) * clamp(p.charge[i], 0, 1), 3 * s);
      }
      // labels
      ctx.textAlign = 'left';
      ctx.font = `700 ${10.5 * s}px ${FONT}`;
      ctx.fillStyle = cd > 0 ? 'rgba(220,225,255,0.5)' : '#e6eaff';
      ctx.fillText(a.short, x + 34 * s, y0 + 18 * s);
      ctx.font = `600 ${9 * s}px ${FONT}`;
      ctx.fillStyle = rgba(p.color, 0.85);
      const tag = a.kind === 'hold' ? 'HOLD' : a.kind === 'toggle' ? 'TOGGLE' : 'TAP';
      ctx.fillText(tag, x + 34 * s, y0 + 31 * s);
      ctx.fillStyle = 'rgba(200,205,230,0.6)';
      ctx.fillText(a.offensive ? 'attack' : 'utility', x + 8 * s, y0 + 50 * s);
      ctx.restore();
    }
  }

  private drawReticle(ctx: CanvasRenderingContext2D, g: Game) {
    const pl = g.player;
    if (pl.dead) return;
    const p = g.power;
    const d = pl.aimDir();
    const near = g.cam.toScreen(pl.x + d.x * 90, pl.y - 14 + d.y * 90);
    const col = p.color;
    ctx.save();
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(near.x, near.y, 7, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    const a = Math.atan2(d.y, d.x);
    ctx.moveTo(near.x + Math.cos(a) * 11, near.y + Math.sin(a) * 11);
    ctx.lineTo(near.x + Math.cos(a) * 17, near.y + Math.sin(a) * 17);
    ctx.stroke();
    const r = p.reticle();
    if (r) {
      const s = g.cam.toScreen(r.x, r.y);
      const t = this.t;
      ctx.strokeStyle = rgba(col, 0.75);
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -t * 20;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16 + Math.sin(t * 6) * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(col, 0.9);
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.restore();
  }

  private drawTitle(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const t = g.realTime;
    ctx.fillStyle = 'rgba(3,4,10,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = 'center';
    const big = Math.min(96, W / 9);
    ctx.font = `900 ${big}px ${FONT}`;
    const cols: RGB[] = [[255, 240, 120], [255, 120, 40], [80, 200, 255], [160, 130, 90], [180, 110, 255]];
    const ci = Math.floor(t * 0.6) % cols.length;
    const c = cols[ci] || cols[0];
    ctx.shadowColor = rgba(c, 0.9);
    ctx.shadowBlur = 40 + Math.sin(t * 3) * 10;
    ctx.fillStyle = '#f4f6ff';
    ctx.fillText('MODULO', W / 2, H / 2 - big * 0.35);
    ctx.font = `800 ${big * 0.55}px ${FONT}`;
    ctx.fillStyle = rgba(c, 1);
    ctx.fillText('P O W E R S', W / 2, H / 2 + big * 0.38);
    ctx.shadowBlur = 0;
    ctx.font = `600 ${Math.max(13, big * 0.17)}px ${FONT}`;
    ctx.fillStyle = 'rgba(210,218,255,0.75)';
    ctx.fillText('Lightning · Fire · Water · Earth · Shadow', W / 2, H / 2 + big * 0.85);
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.font = `700 ${Math.max(14, big * 0.2)}px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('press any key', W / 2, H / 2 + big * 1.5);
    ctx.globalAlpha = 0.55;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText('A/D move · W jump · J K L I abilities · 1-5 switch power · H help', W / 2, H - 30);
    ctx.restore();
  }

  private panel(ctx: CanvasRenderingContext2D, W: number, H: number, pw: number, ph: number) {
    ctx.fillStyle = 'rgba(2,3,8,0.6)';
    ctx.fillRect(0, 0, W, H);
    const x = W / 2 - pw / 2, y = Math.max(10, H / 2 - ph / 2);
    ctx.fillStyle = 'rgba(12,14,26,0.92)';
    roundRect(ctx, x, y, pw, ph, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(140,160,255,0.25)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, pw, ph, 18); ctx.stroke();
    return { x, y };
  }

  private drawPause(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const pw = Math.min(620, W - 30), ph = Math.min(470, H - 20);
    const { x, y } = this.panel(ctx, W, H, pw, ph);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `900 34px ${FONT}`;
    ctx.fillStyle = '#f2f4ff';
    ctx.fillText('PAUSED', W / 2, y + 48);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,255,0.6)';
    ctx.fillText('press P to resume', W / 2, y + 70);
    ctx.restore();
    this.controls(ctx, x + 30, y + 100, pw - 60);
  }

  private controls(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const rows: [string, string][] = [
      ['A / D', 'move'], ['W / Space', 'jump'], ['S', 'crouch / drop through platform'],
      ['Arrows', 'rotate aim (mouse also aims, click = J)'], ['J', 'ability 1: attack'], ['K  L  I', 'abilities 2, 3, 4'],
      ['1 – 5', 'Lightning, Fire, Water, Earth, Shadow'], ['Q / E', 'previous / next power'],
      ['P', 'pause'], ['R', 'reset map'], ['T', 'reset player'], ['N', 'next map'],
      ['B', 'spawn dummy at aim'], ['V', 'slow motion'], ['F', 'sandbox: infinite energy'], ['H', 'help · M mute'],
    ];
    const col = rows.length > 8 ? 2 : 1;
    const per = Math.ceil(rows.length / col);
    const cw = w / col;
    ctx.save();
    for (let i = 0; i < rows.length; i++) {
      const c = Math.floor(i / per), r = i % per;
      const xx = x + c * cw, yy = y + r * 32;
      ctx.font = `800 12px ${FONT}`;
      const kw = ctx.measureText(rows[i][0]).width + 14;
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      roundRect(ctx, xx, yy - 14, kw, 22, 6); ctx.fill();
      ctx.fillStyle = '#eef1ff';
      ctx.fillText(rows[i][0], xx + 7, yy + 1);
      ctx.font = `500 12px ${FONT}`;
      ctx.fillStyle = 'rgba(210,216,245,0.8)';
      ctx.fillText(rows[i][1], xx + kw + 8, yy + 1);
    }
    ctx.restore();
  }

  private drawHelp(ctx: CanvasRenderingContext2D, g: Game, W: number, H: number) {
    const pw = Math.min(980, W - 24), ph = Math.min(H - 24, 640);
    const { x, y } = this.panel(ctx, W, H, pw, ph);
    const p = g.power;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.clip();
    ctx.font = `900 22px ${FONT}`;
    ctx.fillStyle = rgba(p.color, 1);
    ctx.fillText(`${p.name.toUpperCase()}`, x + 26, y + 38);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,255,0.6)';
    ctx.fillText('H to close · switch powers to read about each one', x + 26 + ctx.measureText(p.name.toUpperCase()).width * 1.9 + 20, y + 38);
    let yy = y + 66;
    const wide = pw > 760;
    const colW = wide ? (pw - 60) / 2 : pw - 52;
    for (let i = 0; i < 4; i++) {
      const a = p.abilities[i];
      ctx.font = `800 13px ${FONT}`;
      ctx.fillStyle = '#eef1ff';
      ctx.fillText(`${KEY_LABELS[i]}  ${a.name}`, x + 26, yy);
      ctx.font = `500 12px ${FONT}`;
      ctx.fillStyle = 'rgba(210,216,245,0.82)';
      yy = wrap(ctx, a.desc, x + 46, yy + 17, colW - 20, 15) + 10;
    }
    // power lab
    const lx = wide ? x + 30 + colW + 10 : x + 26;
    let ly = wide ? y + 66 : yy + 10;
    ctx.font = `900 15px ${FONT}`;
    ctx.fillStyle = '#ffd98a';
    ctx.fillText('⚗ POWER LAB: combos to discover', lx, ly);
    ly += 22;
    const combos = [
      ['Lightning + Water', 'Shock a pool: the whole surface electrifies everything in it. Don\'t stand in it.'],
      ['Lightning + Metal', 'Bolts chain through metal. Overcharge (hold I) powers generators, lamps and doors.'],
      ['Water + Lightning on targets', 'Soaked targets take far more shock damage.'],
      ['Fire + Water', 'Fire boils water into steam. Steam hides you and scalds dummies.'],
      ['Water + Freeze', 'Freeze (L) a pool for an ice bridge. Soak a dummy, then freeze it solid and shatter it.'],
      ['Fire + Ice', 'Heat Wave or fire melts ice walls and bridges.'],
      ['Fire + Straw/Wood', 'Flames spread crate to crate, burn to ash and leave scorch marks.'],
      ['Earth + Fire', 'Raise a pillar under a burning crate to launch it.'],
      ['Shadow + Darkness', 'Shadow energy regenerates in dark rooms and drains under lamps, fire and lightning.'],
      ['Shadow + Thick walls', 'Phase (hold I) through walls. Run out of energy inside and you\'re violently ejected.'],
      ['Earth + Lamps', 'Break lamps with rocks to make your own darkness for Shadow.'],
      ['Fire + Rocket', 'Fireballs knock you back too. Rocket-jump off explosions.'],
    ];
    for (const [a, b] of combos) {
      ctx.font = `800 12px ${FONT}`;
      ctx.fillStyle = '#ffe9b8';
      ctx.fillText(a, lx, ly);
      ctx.font = `500 11.5px ${FONT}`;
      ctx.fillStyle = 'rgba(210,216,245,0.75)';
      ly = wrap(ctx, b, lx + 10, ly + 15, colW - 20, 14) + 6;
      if (ly > y + ph - 20) break;
    }
    ctx.restore();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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
