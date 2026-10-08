// Small procedural ability icons, drawn centred at (x, y) within a box of size s.

export type GlyphId =
  | 'bolt' | 'skystrike' | 'dash' | 'charge'
  | 'fireball' | 'flame' | 'rocket' | 'heat'
  | 'jet' | 'wave' | 'snow' | 'geyser'
  | 'rock' | 'pillar' | 'quake' | 'armor'
  | 'spikes' | 'invis' | 'step' | 'phase';

export function drawGlyph(ctx: CanvasRenderingContext2D, id: GlyphId, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24); // design space: -12..12
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (pts: number[], close = false) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
  };
  switch (id) {
    case 'bolt':
      path([2, -11, -6, 1, 0, 1, -3, 11, 7, -3, 1, -3, 4, -11], true); ctx.fill();
      break;
    case 'skystrike':
      ctx.beginPath(); ctx.arc(-4, -7, 4, Math.PI * 0.9, Math.PI * 1.9); ctx.arc(3, -8, 5, Math.PI * 1.1, Math.PI * 2.05); ctx.lineTo(8, -4); ctx.lineTo(-8, -4); ctx.closePath(); ctx.fill();
      path([1, -3, -3, 3, 1, 3, -2, 11]); ctx.stroke();
      path([-9, 11, 5, 11]); ctx.stroke();
      break;
    case 'dash':
      path([-2, -7, 8, 0, -2, 7]); ctx.stroke();
      path([-11, -4, -4, -4]); ctx.stroke(); path([-11, 0, -2, 0]); ctx.stroke(); path([-11, 4, -4, 4]); ctx.stroke();
      break;
    case 'charge':
      ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        path([Math.cos(a) * 7, Math.sin(a) * 7, Math.cos(a + 0.2) * 9.5, Math.sin(a + 0.2) * 9.5, Math.cos(a) * 11.5, Math.sin(a) * 11.5]); ctx.stroke();
      }
      break;
    case 'fireball':
      ctx.beginPath(); ctx.arc(4, 2, 6, 0, Math.PI * 2); ctx.fill();
      path([-1, -3, -11, -9]); ctx.stroke(); path([-2, 2, -11, 0]); ctx.stroke(); path([0, 6, -8, 9]); ctx.stroke();
      break;
    case 'flame':
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(0, -12, 11, -5); ctx.quadraticCurveTo(4, 0, 11, 5); ctx.quadraticCurveTo(0, 12, -10, 0); ctx.fill();
      break;
    case 'rocket':
      path([0, -11, 5, -2, 3, 4, -3, 4, -5, -2], true); ctx.fill();
      path([-2, 7, -3, 11]); ctx.stroke(); path([2, 7, 3, 11]); ctx.stroke(); path([0, 7, 0, 12]); ctx.stroke();
      break;
    case 'heat':
      for (const r of [3, 7, 11]) { ctx.beginPath(); ctx.arc(0, 4, r, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 6, 2.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'jet':
      path([-11, -2, 6, -2]); ctx.stroke(); path([-11, 2, 8, 2]); ctx.stroke();
      ctx.beginPath(); ctx.arc(9, -6, 1.5, 0, 7); ctx.arc(10, 6, 1.5, 0, 7); ctx.fill();
      break;
    case 'wave':
      ctx.beginPath(); ctx.moveTo(-11, 8); ctx.quadraticCurveTo(-6, 6, -3, -2); ctx.quadraticCurveTo(0, -10, 7, -8); ctx.quadraticCurveTo(2, -5, 4, 0); ctx.quadraticCurveTo(6, 6, 11, 8); ctx.closePath(); ctx.fill();
      break;
    case 'snow':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        const c = Math.cos(a) * 10, sn = Math.sin(a) * 10;
        path([-c, -sn, c, sn]); ctx.stroke();
        for (const k of [-1, 1]) {
          const bx = c * 0.6 * k, by = sn * 0.6 * k;
          path([bx, by, bx + Math.cos(a + 2.4 * k) * 3.5, by + Math.sin(a + 2.4 * k) * 3.5]); ctx.stroke();
          path([bx, by, bx + Math.cos(a - 2.4 * k) * 3.5, by + Math.sin(a - 2.4 * k) * 3.5]); ctx.stroke();
        }
      }
      break;
    case 'geyser':
      path([-4, 11, -4, -2, -8, -2, 0, -11, 8, -2, 4, -2, 4, 11], true); ctx.fill();
      break;
    case 'rock':
      path([-9, 3, -6, -7, 3, -9, 10, -2, 8, 7, -2, 9], true); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; path([-3, -4, 1, 1, 6, -1]); ctx.stroke();
      break;
    case 'pillar':
      ctx.fillRect(-5, -6, 10, 17);
      path([-11, 11, 11, 11]); ctx.stroke();
      path([-3, -8, 0, -12, 3, -8]); ctx.stroke();
      break;
    case 'quake':
      path([-11, 0, 11, 0]); ctx.stroke();
      path([-2, 0, 1, 4, -2, 7, 1, 11]); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 10.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      break;
    case 'armor':
      path([0, -11, 9, -7, 8, 3, 0, 11, -8, 3, -9, -7], true); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; path([0, -7, 0, 7]); ctx.stroke(); path([-5, -1, 5, -1]); ctx.stroke();
      break;
    case 'spikes':
      path([-10, 10, -7, -2, -4, 10], true); ctx.fill();
      path([-4, 10, 0, -11, 4, 10], true); ctx.fill();
      path([4, 10, 7, -4, 10, 10], true); ctx.fill();
      break;
    case 'invis':
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(0, -10, 11, 0); ctx.quadraticCurveTo(0, 10, -11, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      path([-9, 9, 9, -9]); ctx.stroke();
      break;
    case 'step':
      ctx.setLineDash([2.5, 3]);
      ctx.beginPath(); ctx.moveTo(-9, 8); ctx.quadraticCurveTo(-4, -10, 6, -2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(7, 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-9, 8, 2, 0, Math.PI * 2); ctx.fill();
      break;
    case 'phase':
      ctx.globalAlpha = 0.45; ctx.fillRect(-2, -12, 5, 24); ctx.globalAlpha = 1;
      ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath(); ctx.arc(-1, -6, 3.5, 0, Math.PI * 2); ctx.stroke();
      path([-1, -2, -1, 5, -6, 11]); ctx.stroke(); path([-1, 5, 4, 11]); ctx.stroke(); path([-7, 0, 5, 0]); ctx.stroke();
      ctx.setLineDash([]);
      break;
  }
  ctx.restore();
}
