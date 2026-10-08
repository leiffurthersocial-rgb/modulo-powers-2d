// Procedural Web Audio sound engine. Every sound is synthesized: no assets.

type Ctx = AudioContext;

export interface LoopHandle {
  set(intensity: number, pitch?: number): void;
  stop(): void;
}

const NOOP_LOOP: LoopHandle = { set() {}, stop() {} };

export class Audio {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  muted = false;
  /** listener position in world space for simple spatialisation */
  lx = 0;
  ly = 0;
  private recent = new Map<string, number>();
  private voices = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.muffle);
    this.muffle.connect(this.comp);
    this.comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** 0 = normal, 1 = fully muffled (phase / underwater) */
  setMuffle(amount: number) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(400 / 20000, amount);
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  private ok(key?: string, minGap = 0.02) {
    if (!this.ctx || this.muted) return false;
    if (this.voices > 48) return false;
    if (key) {
      const t = this.ctx.currentTime;
      const last = this.recent.get(key) ?? -1;
      if (t - last < minGap) return false;
      this.recent.set(key, t);
    }
    return true;
  }

  /** returns [gain, pan] for a world position */
  private spatial(x?: number, y?: number): [number, number] {
    if (x === undefined || y === undefined) return [1, 0];
    const dx = x - this.lx, dy = y - this.ly;
    const d = Math.hypot(dx, dy);
    const g = 1 / (1 + Math.max(0, d - 300) / 500);
    const pan = Math.max(-0.8, Math.min(0.8, dx / 700));
    return [g, pan];
  }

  private out(vol: number, x?: number, y?: number, t0 = 0): { node: GainNode; end: (t: number) => void } {
    const ctx = this.ctx!;
    const [g, pan] = this.spatial(x, y);
    const gain = ctx.createGain();
    gain.gain.value = vol * g;
    let last: AudioNode = gain;
    if ((ctx as any).createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      last = p;
    }
    last.connect(this.master);
    this.voices++;
    return {
      node: gain,
      end: (t: number) => {
        setTimeout(() => {
          this.voices--;
          try { last.disconnect(); gain.disconnect(); } catch { /* ignore */ }
        }, (t - ctx.currentTime + 0.1) * 1000 + t0 * 1000);
      },
    };
  }

  private noiseSrc(brown = false, rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    (s as any).loopStart = Math.random();
    return s;
  }

  private env(param: AudioParam, t: number, a: number, peak: number, d: number, sustainTo = 0.0001) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    param.exponentialRampToValueAtTime(Math.max(sustainTo, 0.0001), t + a + d);
  }

  /** filtered noise burst */
  burst(opts: {
    type?: BiquadFilterType; freq: number; freqEnd?: number; q?: number; vol: number;
    attack?: number; decay: number; brown?: boolean; delay?: number; x?: number; y?: number; key?: string; rate?: number;
  }) {
    if (!this.ok(opts.key)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = this.noiseSrc(opts.brown, opts.rate ?? 1);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.attack ?? 0.005) + opts.decay);
    f.Q.value = opts.q ?? 1;
    const o = this.out(1, opts.x, opts.y);
    const g = ctx.createGain();
    this.env(g.gain, t, opts.attack ?? 0.005, opts.vol, opts.decay);
    src.connect(f); f.connect(g); g.connect(o.node);
    const end = t + (opts.attack ?? 0.005) + opts.decay + 0.05;
    src.start(t, Math.random() * 1.5);
    src.stop(end);
    o.end(end);
  }

  tone(opts: {
    type?: OscillatorType; freq: number; freqEnd?: number; vol: number; attack?: number; decay: number;
    delay?: number; x?: number; y?: number; key?: string; detune?: number; filter?: number;
  }) {
    if (!this.ok(opts.key)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t + (opts.attack ?? 0.005) + opts.decay);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    this.env(g.gain, t, opts.attack ?? 0.005, opts.vol, opts.decay);
    const o = this.out(1, opts.x, opts.y);
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      osc.connect(f); f.connect(g);
    } else osc.connect(g);
    g.connect(o.node);
    const end = t + (opts.attack ?? 0.005) + opts.decay + 0.05;
    osc.start(t);
    osc.stop(end);
    o.end(end);
  }

  // ---------------------------------------------------------------- presets

  zap(x?: number, y?: number, big = 1) {
    if (!this.ok('zap', 0.03)) return;
    this.burst({ type: 'highpass', freq: 2500, vol: 0.5 * big, decay: 0.12, x, y });
    this.tone({ type: 'sawtooth', freq: 180 + Math.random() * 120, freqEnd: 60, vol: 0.25 * big, decay: 0.18, x, y, filter: 3000 });
    this.tone({ type: 'square', freq: 1200 + Math.random() * 800, freqEnd: 300, vol: 0.08 * big, decay: 0.1, x, y });
  }

  crackle(x?: number, y?: number, vol = 0.25) {
    if (!this.ok('crackle', 0.04)) return;
    for (let i = 0; i < 4; i++) {
      this.burst({ type: 'highpass', freq: 3000 + Math.random() * 3000, vol: vol * Math.random(), decay: 0.02, delay: Math.random() * 0.15, x, y });
    }
  }

  thunder(x?: number, y?: number, delay = 0.25, size = 1) {
    if (!this.ctx || this.muted) return;
    // crack
    this.burst({ type: 'highpass', freq: 1800, vol: 0.9 * size, decay: 0.08, x, y });
    this.burst({ type: 'bandpass', freq: 900, q: 0.6, vol: 0.6 * size, decay: 0.25, x, y });
    // rolling boom, delayed by "distance"
    this.burst({ type: 'lowpass', freq: 400, freqEnd: 60, vol: 1.2 * size, attack: 0.04, decay: 1.8 + size * 0.6, brown: true, delay, x, y });
    this.burst({ type: 'lowpass', freq: 200, freqEnd: 40, vol: 0.8 * size, attack: 0.2, decay: 2.2, brown: true, delay: delay + 0.3, x, y });
  }

  explosion(x?: number, y?: number, size = 1) {
    if (!this.ok('explo', 0.03)) return;
    this.tone({ type: 'sine', freq: 140, freqEnd: 32, vol: 0.9 * size, decay: 0.5 + size * 0.2, x, y });
    this.burst({ type: 'lowpass', freq: 2200, freqEnd: 120, vol: 0.8 * size, decay: 0.6 + size * 0.3, x, y });
    this.burst({ type: 'lowpass', freq: 300, freqEnd: 50, vol: 0.6 * size, attack: 0.03, decay: 1.2, brown: true, x, y });
  }

  thud(x?: number, y?: number, vol = 0.5) {
    if (!this.ok('thud', 0.03)) return;
    this.tone({ type: 'sine', freq: 110 + Math.random() * 30, freqEnd: 45, vol, decay: 0.18, x, y });
    this.burst({ type: 'lowpass', freq: 900, vol: vol * 0.6, decay: 0.08, x, y });
  }

  impact(material: string, x?: number, y?: number, vol = 0.5) {
    if (!this.ok('imp' + material, 0.05)) return;
    vol = Math.min(1, vol);
    switch (material) {
      case 'wood':
        this.burst({ type: 'bandpass', freq: 500 + Math.random() * 300, q: 3, vol: vol * 0.7, decay: 0.09, x, y });
        this.tone({ type: 'triangle', freq: 200 + Math.random() * 60, freqEnd: 120, vol: vol * 0.3, decay: 0.08, x, y });
        break;
      case 'stone':
        this.burst({ type: 'lowpass', freq: 700, vol: vol * 0.8, decay: 0.15, x, y });
        this.tone({ type: 'sine', freq: 80, freqEnd: 40, vol: vol * 0.7, decay: 0.2, x, y });
        break;
      case 'metal':
        this.tone({ type: 'triangle', freq: 600 + Math.random() * 400, vol: vol * 0.25, decay: 0.5, x, y });
        this.tone({ type: 'sine', freq: 1500 + Math.random() * 700, vol: vol * 0.12, decay: 0.7, x, y });
        this.burst({ type: 'highpass', freq: 3000, vol: vol * 0.3, decay: 0.04, x, y });
        break;
      case 'ice':
        this.tone({ type: 'sine', freq: 2400 + Math.random() * 1500, vol: vol * 0.2, decay: 0.25, x, y });
        this.burst({ type: 'highpass', freq: 4000, vol: vol * 0.4, decay: 0.08, x, y });
        break;
      case 'straw':
        this.burst({ type: 'bandpass', freq: 2500, q: 0.8, vol: vol * 0.4, decay: 0.12, x, y });
        break;
      default:
        this.thud(x, y, vol * 0.7);
    }
  }

  whoosh(x?: number, y?: number, dur = 0.3, vol = 0.4, from = 400, to = 2400) {
    if (!this.ok('whoosh', 0.03)) return;
    this.burst({ type: 'bandpass', freq: from, freqEnd: to, q: 1.2, vol, attack: dur * 0.4, decay: dur * 0.6, x, y });
  }

  splash(x?: number, y?: number, vol = 0.5) {
    if (!this.ok('splash', 0.06)) return;
    this.burst({ type: 'bandpass', freq: 1200, freqEnd: 400, q: 0.7, vol, decay: 0.35, x, y });
    this.burst({ type: 'highpass', freq: 3000, vol: vol * 0.4, decay: 0.2, delay: 0.03, x, y });
    for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: 500 + Math.random() * 800, freqEnd: 1600, vol: vol * 0.12, decay: 0.06, delay: 0.05 + Math.random() * 0.2, x, y });
  }

  hiss(x?: number, y?: number, vol = 0.4, dur = 0.8) {
    if (!this.ok('hiss', 0.1)) return;
    this.burst({ type: 'highpass', freq: 4000, vol, attack: 0.05, decay: dur, x, y });
  }

  freeze(x?: number, y?: number) {
    if (!this.ok('freeze', 0.05)) return;
    this.burst({ type: 'highpass', freq: 5000, freqEnd: 2000, vol: 0.4, decay: 0.4, x, y });
    for (let i = 0; i < 6; i++) this.tone({ type: 'sine', freq: 1800 + Math.random() * 3000, vol: 0.1, decay: 0.3, delay: i * 0.04, x, y });
    this.tone({ type: 'sine', freq: 300, freqEnd: 90, vol: 0.3, decay: 0.3, x, y });
  }

  shatter(x?: number, y?: number, vol = 0.6) {
    if (!this.ok('shatter', 0.05)) return;
    this.burst({ type: 'highpass', freq: 3500, vol, decay: 0.3, x, y });
    for (let i = 0; i < 8; i++) this.tone({ type: 'sine', freq: 2000 + Math.random() * 4000, vol: vol * 0.15, decay: 0.15 + Math.random() * 0.3, delay: Math.random() * 0.15, x, y });
  }

  rumble(x?: number, y?: number, vol = 0.8, dur = 1.2) {
    if (!this.ok('rumble', 0.1)) return;
    this.burst({ type: 'lowpass', freq: 160, freqEnd: 40, vol, attack: 0.06, decay: dur, brown: true, x, y });
    this.tone({ type: 'sine', freq: 55, freqEnd: 30, vol: vol * 0.7, attack: 0.02, decay: dur * 0.8, x, y });
  }

  crumble(x?: number, y?: number, vol = 0.6) {
    if (!this.ok('crumble', 0.06)) return;
    this.burst({ type: 'lowpass', freq: 1200, freqEnd: 200, vol, decay: 0.5, x, y });
    for (let i = 0; i < 5; i++) this.burst({ type: 'bandpass', freq: 300 + Math.random() * 500, q: 4, vol: vol * 0.4, decay: 0.05, delay: Math.random() * 0.4, x, y });
  }

  fireWhoosh(x?: number, y?: number, vol = 0.5) {
    if (!this.ok('firewhoosh', 0.05)) return;
    this.burst({ type: 'lowpass', freq: 300, freqEnd: 1800, vol, attack: 0.08, decay: 0.35, x, y });
    this.burst({ type: 'bandpass', freq: 800, q: 0.5, vol: vol * 0.5, decay: 0.3, x, y });
  }

  shadowWhoosh(x?: number, y?: number, vol = 0.5, rising = true) {
    if (!this.ok('shadow', 0.04)) return;
    this.burst({ type: 'bandpass', freq: rising ? 200 : 1600, freqEnd: rising ? 1600 : 150, q: 2, vol, attack: rising ? 0.25 : 0.02, decay: rising ? 0.1 : 0.35, x, y });
    this.tone({ type: 'sine', freq: rising ? 80 : 300, freqEnd: rising ? 300 : 60, vol: vol * 0.6, attack: 0.05, decay: 0.35, x, y, detune: -30 });
    this.tone({ type: 'sawtooth', freq: rising ? 82 : 290, freqEnd: rising ? 290 : 58, vol: vol * 0.12, attack: 0.05, decay: 0.35, x, y, filter: 600 });
  }

  hurt(x?: number, y?: number) {
    if (!this.ok('hurt', 0.1)) return;
    this.tone({ type: 'square', freq: 220, freqEnd: 110, vol: 0.15, decay: 0.15, x, y, filter: 1200 });
  }

  blip(freq = 660, vol = 0.15) {
    if (!this.ok('blip', 0.02)) return;
    this.tone({ type: 'triangle', freq, vol, decay: 0.12 });
  }

  chord(freqs: number[], vol = 0.12, type: OscillatorType = 'triangle') {
    if (!this.ctx || this.muted) return;
    freqs.forEach((f, i) => this.tone({ type, freq: f, vol, attack: 0.01, decay: 0.45, delay: i * 0.035 }));
  }

  powerOn(x?: number, y?: number) {
    if (!this.ok('powerOn', 0.1)) return;
    this.tone({ type: 'sawtooth', freq: 50, freqEnd: 120, vol: 0.2, attack: 0.3, decay: 0.6, x, y, filter: 800 });
    this.tone({ type: 'sine', freq: 120, vol: 0.15, attack: 0.3, decay: 0.8, x, y });
  }

  // ---------------------------------------------------------------- loops

  loop(kind: 'flame' | 'jet' | 'hum' | 'rocket' | 'drone' | 'buzz' | 'fire' | 'wind'): LoopHandle {
    if (!this.ctx) return NOOP_LOOP;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    let filter: BiquadFilterNode | null = null;
    let osc: OscillatorNode | null = null;
    let baseFreq = 0;
    let gainScale = 1;

    const mkNoise = (brown: boolean, type: BiquadFilterType, freq: number, q = 1) => {
      const s = this.noiseSrc(brown);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      s.connect(f); f.connect(g);
      s.start();
      nodes.push(s);
      return f;
    };

    switch (kind) {
      case 'flame':
        filter = mkNoise(true, 'lowpass', 900);
        mkNoise(false, 'bandpass', 1400, 0.4);
        baseFreq = 900; gainScale = 0.6;
        break;
      case 'rocket':
        filter = mkNoise(true, 'lowpass', 500);
        mkNoise(false, 'lowpass', 1200);
        baseFreq = 500; gainScale = 0.8;
        break;
      case 'jet':
        filter = mkNoise(false, 'bandpass', 1800, 0.6);
        baseFreq = 1800; gainScale = 0.45;
        break;
      case 'fire':
        filter = mkNoise(true, 'lowpass', 600);
        baseFreq = 600; gainScale = 0.35;
        break;
      case 'wind':
        filter = mkNoise(false, 'bandpass', 500, 0.8);
        baseFreq = 500; gainScale = 0.25;
        break;
      case 'hum': {
        osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 60;
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        filter.Q.value = 6;
        osc.connect(filter); filter.connect(g);
        osc.start(); nodes.push(osc);
        const o2 = ctx.createOscillator();
        o2.type = 'square'; o2.frequency.value = 60.7;
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        o2.connect(g2); g2.connect(filter); o2.start(); nodes.push(o2);
        (osc as any)._o2 = o2;
        mkNoise(false, 'highpass', 6000);
        baseFreq = 60; gainScale = 0.3;
        break;
      }
      case 'buzz': {
        osc = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = 100;
        filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = 2;
        osc.connect(filter); filter.connect(g); osc.start(); nodes.push(osc);
        mkNoise(false, 'highpass', 5000);
        baseFreq = 100; gainScale = 0.25;
        break;
      }
      case 'drone': {
        osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = 55;
        osc.connect(g); osc.start(); nodes.push(osc);
        const o2 = ctx.createOscillator();
        o2.type = 'triangle'; o2.frequency.value = 82.6;
        const g2 = ctx.createGain(); g2.gain.value = 0.4;
        o2.connect(g2); g2.connect(g); o2.start(); nodes.push(o2);
        filter = mkNoise(true, 'lowpass', 300);
        baseFreq = 55; gainScale = 0.4;
        break;
      }
    }
    let stopped = false;
    return {
      set: (intensity: number, pitch = 1) => {
        if (stopped) return;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(this.muted ? 0 : Math.max(0, intensity) * gainScale, t, 0.05);
        if (osc) {
          osc.frequency.setTargetAtTime(baseFreq * pitch, t, 0.05);
          const o2 = (osc as any)._o2 as OscillatorNode | undefined;
          if (o2) o2.frequency.setTargetAtTime(baseFreq * pitch * 1.012, t, 0.05);
          if (filter && kind === 'hum') filter.frequency.setTargetAtTime(400 + pitch * 600, t, 0.05);
        } else if (filter) {
          filter.frequency.setTargetAtTime(baseFreq * pitch, t, 0.05);
        }
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.06);
        setTimeout(() => {
          nodes.forEach((n) => { try { n.stop(); } catch { /* */ } });
          try { g.disconnect(); } catch { /* */ }
        }, 400);
      },
    };
  }
}

export const audio = new Audio();
