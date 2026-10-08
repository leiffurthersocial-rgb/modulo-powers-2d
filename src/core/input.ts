// Keyboard + pointer input. Uses event.code (physical key positions) so the
// layout works identically on QWERTY and QWERTZ keyboards.

const GAME_KEYS = new Set([
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyJ', 'KeyK', 'KeyL', 'KeyI',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'KeyQ', 'KeyE', 'KeyG', 'KeyP', 'KeyR', 'KeyT', 'KeyN', 'KeyB', 'KeyV', 'KeyF', 'KeyH', 'KeyM',
]);

export class Input {
  private down = new Set<string>();
  private pressedQ: string[] = [];
  private pressed = new Set<string>();
  private released = new Set<string>();
  private releasedQ: string[] = [];
  private framePressedQ: string[] = [];
  private framePressed = new Set<string>();
  anyKeyQueued = false;

  // pointer, in CSS pixels relative to the canvas
  pointerX = 0;
  pointerY = 0;
  pointerActive = false; // true once the mouse moved / touched recently
  pointerDown = false;
  private pointerPressedQ = false;
  pointerPressed = false;
  private pointerReleasedQ = false;
  pointerReleased = false;
  lastPointerMove = -1e9;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // prevent iOS gestures / scrolling
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // never hijack system combos
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    this.anyKeyQueued = true;
    if (e.repeat) return;
    if (!this.down.has(e.code)) {
      this.down.add(e.code);
      this.pressedQ.push(e.code);
      this.framePressedQ.push(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (this.down.has(e.code)) {
      this.down.delete(e.code);
      this.releasedQ.push(e.code);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const r = this.el.getBoundingClientRect();
    this.pointerX = e.clientX - r.left;
    this.pointerY = e.clientY - r.top;
    this.pointerActive = true;
    this.lastPointerMove = performance.now();
  };

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e);
    this.el.focus();
    this.anyKeyQueued = true;
    if (e.button === 0 || e.pointerType !== 'mouse') {
      this.pointerDown = true;
      this.pointerPressedQ = true;
    }
  };

  private onPointerUp = () => {
    if (this.pointerDown) this.pointerReleasedQ = true;
    this.pointerDown = false;
  };

  /** Call once per rendered frame for UI/global keys. */
  pollFrame() {
    this.framePressed.clear();
    for (const c of this.framePressedQ) this.framePressed.add(c);
    this.framePressedQ.length = 0;
  }
  framePressedKey(code: string) { return this.framePressed.has(code); }

  /** Call once per fixed simulation step: moves queued edges into the readable sets. */
  poll() {
    this.pressed.clear();
    this.released.clear();
    for (const c of this.pressedQ) this.pressed.add(c);
    for (const c of this.releasedQ) this.released.add(c);
    this.pressedQ.length = 0;
    this.releasedQ.length = 0;
    this.pointerPressed = this.pointerPressedQ;
    this.pointerReleased = this.pointerReleasedQ;
    this.pointerPressedQ = false;
    this.pointerReleasedQ = false;
  }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  wasReleased(code: string) { return this.released.has(code); }
  consumeAnyKey() { const a = this.anyKeyQueued; this.anyKeyQueued = false; return a; }
}
