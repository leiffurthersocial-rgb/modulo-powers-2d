// Frame composition: background -> world -> darkness/lighting -> additive glow
// (with a cheap downsampled bloom) -> screen effects -> HUD/overlays.

import type { Game } from '../game';
import { particles } from './particles';

export class Renderer {
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  private glow: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  private bloom: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private vignette: HTMLCanvasElement | null = null;
  private vigKey = '';
  /** glow buffer resolution relative to CSS px */
  private glowScale = 0.5;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.glow = document.createElement('canvas');
    this.gctx = this.glow.getContext('2d')!;
    this.bloom = document.createElement('canvas');
    this.bctx = this.bloom.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // cap the backing store so iPads don't push 5M+ pixels through every pass
    const maxPx = 2_400_000;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
    this.dpr = Math.max(1, dpr);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.glow.width = Math.ceil(w * this.glowScale);
    this.glow.height = Math.ceil(h * this.glowScale);
    this.bloom.width = Math.ceil(w / 8);
    this.bloom.height = Math.ceil(h / 8);
  }

  private getVignette(w: number, h: number) {
    const key = `${w}x${h}`;
    if (this.vignette && this.vigKey === key) return this.vignette;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w / 4); c.height = Math.ceil(h / 4);
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    this.vignette = c;
    this.vigKey = key;
    return c;
  }

  render(g: Game, alpha: number) {
    const ctx = this.ctx;
    const cam = g.cam;
    const dpr = this.dpr;
    if (cam.vw !== window.innerWidth || cam.vh !== window.innerHeight) cam.resize(window.innerWidth, window.innerHeight);
    const W = cam.vw, H = cam.vh;
    const view = cam.view();
    const t = g.time;

    // ---------------------------------------------------------- background
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    g.bg.draw(ctx, cam, dpr, g.realTime, g.map.h);

    // ---------------------------------------------------------- world
    ctx.save();
    cam.apply(ctx, dpr);
    g.map.drawBack?.(ctx, view, t);
    g.terrain.draw(ctx, view, g.map.palette);
    g.decals.draw(ctx, view);
    for (const e of g.entities) {
      const b = e.bounds();
      if (b.x1 < view.x0 - 60 || b.x0 > view.x1 + 60 || b.y1 < view.y0 - 60 || b.y0 > view.y1 + 60) continue;
      e.draw(ctx, alpha);
    }
    for (const fx of g.effects) fx.draw?.(ctx, alpha);
    g.power.drawWorld(ctx, alpha);
    g.player.draw(ctx, alpha);
    g.water.draw(ctx, view, t);
    particles.drawNormal(ctx, view);
    g.map.drawFront?.(ctx, view, t);
    ctx.restore();

    // ---------------------------------------------------------- lighting
    g.lighting.renderDarkness(ctx, cam, dpr);

    // ---------------------------------------------------------- glow buffer
    const gc = this.gctx;
    const gs = this.glowScale;
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalCompositeOperation = 'source-over';
    gc.clearRect(0, 0, this.glow.width, this.glow.height);
    gc.globalCompositeOperation = 'lighter';
    // world transform at glow resolution
    gc.setTransform(gs, 0, 0, gs, 0, 0);
    gc.translate(W / 2, H / 2);
    gc.rotate(cam.shakeRot);
    gc.scale(cam.scale, cam.scale);
    gc.translate(-cam.x + cam.shakeX / cam.scale, -cam.y + cam.shakeY / cam.scale);
    g.lighting.renderTints(gc, cam);
    for (const e of g.entities) {
      const b = e.bounds();
      if (b.x1 < view.x0 - 60 || b.x0 > view.x1 + 60 || b.y1 < view.y0 - 60 || b.y0 > view.y1 + 60) continue;
      e.drawGlow(gc, alpha);
    }
    g.water.drawGlow(gc, view);
    g.player.drawGlow(gc, alpha);
    for (const fx of g.effects) fx.drawGlow?.(gc, alpha);
    g.power.drawGlow(gc, alpha);
    particles.drawGlow(gc, view, g.realTime);
    g.fx.drawBolts(gc);
    gc.setTransform(gs, 0, 0, gs, 0, 0);
    g.bg.drawMotes(gc, cam, g.realTime, g.map.moteColor);

    // bloom: downsample glow into a tiny buffer, upscale back
    const bc = this.bctx;
    bc.globalCompositeOperation = 'source-over';
    bc.clearRect(0, 0, this.bloom.width, this.bloom.height);
    bc.drawImage(this.glow, 0, 0, this.bloom.width, this.bloom.height);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.glow, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.bloom, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ---------------------------------------------------------- screen fx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g.desat > 0.01) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = g.desat * 0.85;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = g.desat * 0.18;
      ctx.fillStyle = '#2a1050';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (g.flashAmt > 0.01) {
      const c = g.flashColor;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, g.flashAmt);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (g.player.hurtFlash > 0.05) {
      ctx.globalAlpha = Math.min(0.5, g.player.hurtFlash * 0.4);
      ctx.drawImage(this.getVignette(W, H), 0, 0, W, H);
      ctx.fillStyle = 'rgba(160,0,0,0.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.getVignette(W, H), 0, 0, W, H);
    ctx.restore();

    // ---------------------------------------------------------- HUD
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.hud.draw(ctx, g, W, H);
  }
}
