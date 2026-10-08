// Shared stickman drawing used by the player and the ragdolls.
import { Vec } from '../core/math';

export interface StickJoints {
  head: Vec; headR: number;
  neck: Vec; pelvis: Vec;
  elbowL: Vec; handL: Vec; elbowR: Vec; handR: Vec;
  kneeL: Vec; footL: Vec; kneeR: Vec; footR: Vec;
  /** which limbs exist (detached limbs are drawn separately) */
  toeL?: Vec; toeR?: Vec;
  hasArmL?: boolean; hasArmR?: boolean; hasLegL?: boolean; hasLegR?: boolean;
}

export interface StickStyle {
  color: string;
  width: number;
  headFill?: string;
  eyes?: 'dots' | 'x' | 'glow' | 'none' | 'wide';
  eyeColor?: string;
  facing: number;
  outline?: string;
}

export function drawStick(ctx: CanvasRenderingContext2D, j: StickJoints, st: StickStyle) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const seg = (a: Vec, b: Vec, c: Vec) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); };
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(j.neck.x, j.neck.y); ctx.lineTo(j.pelvis.x, j.pelvis.y);
    if (j.hasArmL !== false) seg(j.neck, j.elbowL, j.handL);
    if (j.hasArmR !== false) seg(j.neck, j.elbowR, j.handR);
    if (j.hasLegL !== false) { seg(j.pelvis, j.kneeL, j.footL); if (j.toeL) ctx.lineTo(j.toeL.x, j.toeL.y); }
    if (j.hasLegR !== false) { seg(j.pelvis, j.kneeR, j.footR); if (j.toeR) ctx.lineTo(j.toeR.x, j.toeR.y); }
  };
  if (st.outline) {
    ctx.strokeStyle = st.outline;
    ctx.lineWidth = st.width + 3;
    body(); ctx.stroke();
    ctx.beginPath(); ctx.arc(j.head.x, j.head.y, j.headR + 1.5, 0, Math.PI * 2); ctx.fillStyle = st.outline; ctx.fill();
  }
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.width;
  body();
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(j.head.x, j.head.y, j.headR, 0, Math.PI * 2);
  ctx.fillStyle = st.headFill ?? st.color;
  ctx.fill();
  if (st.headFill) { ctx.lineWidth = 2; ctx.stroke(); }
  // eyes
  const f = st.facing;
  const ex = j.head.x + f * j.headR * 0.38, ey = j.head.y - j.headR * 0.1;
  const ec = st.eyeColor ?? '#0b0d14';
  switch (st.eyes) {
    case 'dots':
      ctx.fillStyle = ec;
      ctx.fillRect(ex - 1, ey - 2, 2.2, 3.5);
      ctx.fillRect(ex + f * 3.5 - 1, ey - 2, 2.2, 3.5);
      break;
    case 'wide':
      ctx.fillStyle = ec;
      ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 6.3); ctx.arc(ex + f * 4, ey, 2, 0, 6.3); ctx.fill();
      break;
    case 'glow':
      ctx.fillStyle = ec;
      ctx.fillRect(ex - 1.5, ey - 1.5, 3.5, 2.6);
      ctx.fillRect(ex + f * 4 - 1.5, ey - 1.5, 3.5, 2.6);
      break;
    case 'x': {
      ctx.strokeStyle = ec; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const ox of [0, f * 4.2]) {
        ctx.moveTo(ex + ox - 1.6, ey - 1.6); ctx.lineTo(ex + ox + 1.6, ey + 1.6);
        ctx.moveTo(ex + ox + 1.6, ey - 1.6); ctx.lineTo(ex + ox - 1.6, ey + 1.6);
      }
      ctx.stroke();
      break;
    }
  }
}
