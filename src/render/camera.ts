import { clamp, smooth } from '../core/math';

/** Smooth follow camera with lookahead, trauma-based shake and zoom punch. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  baseZoom = 1;
  zoomPunch = 0;
  trauma = 0;
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;
  lookX = 0;
  lookY = 0;
  // viewport in CSS px and scale (world -> css px)
  vw = 1280;
  vh = 720;
  scale = 1;
  bounds = { x0: 0, y0: 0, x1: 4000, y1: 1400 };
  /** fit the whole map on screen (single-screen arenas) */
  fit = true;
  private t = 0;

  /** world units visible vertically at zoom 1 */
  static VIEW_H = 760;

  resize(vw: number, vh: number) {
    this.vw = vw;
    this.vh = vh;
  }

  snap(x: number, y: number) {
    if (this.fit) return;
    this.x = x;
    this.y = y;
    this.lookX = this.lookY = 0;
  }

  shake(amount: number) {
    this.trauma = Math.min(1.2, this.trauma + amount);
  }

  punch(amount: number) {
    this.zoomPunch = Math.max(this.zoomPunch, amount);
  }

  update(dt: number, tx: number, ty: number, vx: number, vy: number, aimX: number, aimY: number) {
    this.t += dt;
    if (this.fit) {
      // single-screen arena: show the whole map, centred, no follow
      const b = this.bounds;
      this.zoomPunch = smooth(this.zoomPunch, 0, 6, dt);
      this.zoom = this.baseZoom * (1 + this.zoomPunch);
      this.scale = Math.min(this.vw / (b.x1 - b.x0), this.vh / (b.y1 - b.y0)) * this.zoom;
      this.x = (b.x0 + b.x1) / 2;
      this.y = (b.y0 + b.y1) / 2;
      void tx; void ty; void vx; void vy; void aimX; void aimY;
      this.updateShake(dt);
      return;
    }
    // lookahead from velocity and aim
    const lx = clamp(vx * 0.35, -180, 180) + aimX * 60;
    const ly = clamp(vy * 0.12, -60, 120) + aimY * 40;
    this.lookX = smooth(this.lookX, lx, 2.2, dt);
    this.lookY = smooth(this.lookY, ly, 2.0, dt);
    this.x = smooth(this.x, tx + this.lookX, 5.5, dt);
    this.y = smooth(this.y, ty - 40 + this.lookY, 4.5, dt);

    this.zoomPunch = smooth(this.zoomPunch, 0, 6, dt);
    this.zoom = this.baseZoom * (1 + this.zoomPunch);
    this.scale = (this.vh / Camera.VIEW_H) * this.zoom;

    // clamp to bounds
    const hw = this.vw / this.scale / 2, hh = this.vh / this.scale / 2;
    const b = this.bounds;
    if (b.x1 - b.x0 > hw * 2) this.x = clamp(this.x, b.x0 + hw, b.x1 - hw);
    else this.x = (b.x0 + b.x1) / 2;
    if (b.y1 - b.y0 > hh * 2) this.y = clamp(this.y, b.y0 + hh, b.y1 - hh);
    else this.y = (b.y0 + b.y1) / 2;

    this.updateShake(dt);
  }

  private updateShake(dt: number) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    this.shakeX = s * 22 * (Math.sin(t * 1.13) + Math.sin(t * 2.71) * 0.5);
    this.shakeY = s * 18 * (Math.sin(t * 1.37 + 2) + Math.sin(t * 3.11) * 0.5);
    this.shakeRot = s * 0.03 * Math.sin(t * 0.9 + 1);
  }

  /** visible world rect (with shake ignored) */
  view() {
    const hw = this.vw / this.scale / 2, hh = this.vh / this.scale / 2;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  apply(ctx: CanvasRenderingContext2D, dpr: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.vw / 2, this.vh / 2);
    ctx.rotate(this.shakeRot);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x + this.shakeX / this.scale, -this.y + this.shakeY / this.scale);
  }

  toWorld(sx: number, sy: number) {
    return {
      x: (sx - this.vw / 2) / this.scale + this.x,
      y: (sy - this.vh / 2) / this.scale + this.y,
    };
  }

  toScreen(wx: number, wy: number) {
    return {
      x: (wx - this.x) * this.scale + this.vw / 2,
      y: (wy - this.y) * this.scale + this.vh / 2,
    };
  }
}
