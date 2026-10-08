// Power framework: each power has 4 abilities (J/K/L/I) with energy costs and
// cooldowns. Abilities can be tap, hold (continuous) or toggle.

import { G } from '../ctx';
import { audio } from '../core/audio';
import { RGB, Vec } from '../core/math';
import type { GlyphId } from '../ui/glyphs';

export type PowerId = 'lightning' | 'fire' | 'water' | 'earth' | 'shadow';

export interface AbilityDef {
  name: string;
  short: string;
  desc: string;
  /** energy for taps; energy per second for holds/toggles */
  cost: number;
  cooldown: number;
  kind: 'tap' | 'hold' | 'toggle';
  offensive?: boolean;
  glyph: GlyphId;
}

export const KEYS = ['KeyJ', 'KeyK', 'KeyL', 'KeyI'];
export const KEY_LABELS = ['J', 'K', 'L', 'I'];

export abstract class Power {
  abstract id: PowerId;
  abstract name: string;
  abstract color: RGB;
  abstract color2: RGB;
  abstract eye: string;
  abstract tagline: string;
  abstract abilities: AbilityDef[];
  cd = [0, 0, 0, 0];
  holding = [false, false, false, false];
  /** for HUD: 0..1 charge display per ability */
  charge = [0, 0, 0, 0];
  toggled = [false, false, false, false];
  denyFlash = [0, 0, 0, 0];

  /** the energy pool this power uses */
  energyPool(): 'main' | 'shadow' { return 'main'; }

  ready(i: number) {
    return G.infinite || this.cd[i] <= 0;
  }

  /** try to pay for an ability; plays a deny sound if not possible */
  pay(i: number, amount: number, silentFail = false): boolean {
    if (!this.ready(i)) { if (!silentFail) this.deny(i); return false; }
    if (!G.spend(this.energyPool(), amount)) { if (!silentFail) this.deny(i); return false; }
    return true;
  }

  /** drain for holds; returns false when empty */
  drain(amount: number): boolean {
    return G.spend(this.energyPool(), amount, true);
  }

  startCooldown(i: number, mul = 1) {
    if (!G.infinite) this.cd[i] = this.abilities[i].cooldown * mul;
  }

  deny(i: number) {
    this.denyFlash[i] = 0.4;
    audio.tone({ type: 'square', freq: 140, vol: 0.06, decay: 0.08, key: 'deny' });
  }

  tick(dt: number) {
    for (let i = 0; i < 4; i++) {
      if (this.cd[i] > 0) this.cd[i] = Math.max(0, this.cd[i] - dt);
      if (this.denyFlash[i] > 0) this.denyFlash[i] -= dt;
    }
  }

  abstract press(i: number): void;
  release(_i: number): void {}
  /** called every step while the ability key is held */
  hold(_i: number, _dt: number): void {}
  /** always called each step while equipped */
  update(_dt: number): void {}
  /** called each step even when not equipped (lingering toggles etc.) */
  background(_dt: number): void {}
  equip(): void {}
  unequip(): void {
    for (let i = 0; i < 4; i++) if (this.holding[i]) { this.holding[i] = false; this.release(i); }
  }
  drawWorld(_ctx: CanvasRenderingContext2D, _alpha: number): void {}
  drawGlow(_ctx: CanvasRenderingContext2D, _alpha: number): void {}
  /** targeted reticle position (if the current ability set uses one) */
  reticle(): Vec | null { return null; }
  abstract drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void;
}

/** live projectiles/effects that outlive the power that spawned them */
export interface Effect {
  update(dt: number): boolean; // false = remove
  draw?(ctx: CanvasRenderingContext2D, alpha: number): void;
  drawGlow?(ctx: CanvasRenderingContext2D, alpha: number): void;
  stop?(): void;
}
