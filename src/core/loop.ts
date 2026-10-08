// Fixed-timestep loop with render interpolation, time scaling (slow motion)
// and hit-stop support.

export const STEP = 1 / 60;

export interface LoopHooks {
  step(dt: number): void;
  render(alpha: number, frameDt: number): void;
  frame(frameDt: number): void;
}

export class Loop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  timeScale = 1;
  hitStop = 0; // seconds of real time during which simulation freezes
  paused = false;
  /** smoothed frame time in ms, for perf monitoring */
  frameMs = 16.7;

  constructor(private hooks: LoopHooks) {}

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.1) dt = 0.1; // tab switch / hiccup guard
      this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
      this.hooks.frame(dt);
      if (!this.paused) {
        if (this.hitStop > 0) {
          this.hitStop -= dt;
        } else {
          this.acc += dt * this.timeScale;
          let steps = 0;
          while (this.acc >= STEP && steps < 4) {
            this.hooks.step(STEP);
            this.acc -= STEP;
            steps++;
          }
          if (steps >= 4) this.acc = 0;
        }
      }
      this.hooks.render(Math.min(1, this.acc / STEP), dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() { cancelAnimationFrame(this.raf); }
}
