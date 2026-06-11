// AudioManager.js — fully synthesised audio (Web Audio, no assets):
// V6-style engine, gear-shift blip, tire screech, wind, impacts, start beeps.

class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastGear = 1;
  }

  // must be called from a user gesture
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(ctx.destination);

    // ── engine: two detuned saws + sub square → lowpass ──
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 800; this.engFilter.Q.value = 2;
    this.engGain.connect(this.engFilter).connect(this.master);

    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'sawtooth'; this.oscB.detune.value = 9;
    this.oscSub = ctx.createOscillator(); this.oscSub.type = 'square';
    const subGain = ctx.createGain(); subGain.gain.value = 0.5;
    this.oscA.connect(this.engGain);
    this.oscB.connect(this.engGain);
    this.oscSub.connect(subGain).connect(this.engGain);
    this.oscA.start(); this.oscB.start(); this.oscSub.start();

    // ── shared noise buffer ──
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // screech: bandpassed looped noise
    this.scrGain = ctx.createGain(); this.scrGain.gain.value = 0;
    const scrFilter = ctx.createBiquadFilter();
    scrFilter.type = 'bandpass'; scrFilter.frequency.value = 950; scrFilter.Q.value = 7;
    const scrSrc = ctx.createBufferSource();
    scrSrc.buffer = buf; scrSrc.loop = true;
    scrSrc.connect(scrFilter).connect(this.scrGain).connect(this.master);
    scrSrc.start();

    // wind: lowpassed looped noise
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass'; windFilter.frequency.value = 480;
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf; windSrc.loop = true; windSrc.playbackRate.value = 0.6;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();

    // kerb rumble
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    const rumFilter = ctx.createBiquadFilter();
    rumFilter.type = 'lowpass'; rumFilter.frequency.value = 130;
    const rumSrc = ctx.createBufferSource();
    rumSrc.buffer = buf; rumSrc.loop = true; rumSrc.playbackRate.value = 0.4;
    rumSrc.connect(rumFilter).connect(this.rumbleGain).connect(this.master);
    rumSrc.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.28;
  }

  // car: player Car instance; surface: string
  update(car, dt) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // engine pitch from rpm (V6 firing frequency feel)
    const f = 30 + (car.rpm / PHYS.rpmMax) * 230;
    this.oscA.frequency.setTargetAtTime(f, now, 0.02);
    this.oscB.frequency.setTargetAtTime(f * 1.005, now, 0.02);
    this.oscSub.frequency.setTargetAtTime(f / 2, now, 0.02);
    const load = 0.25 + 0.75 * car.input.throttle;
    this.engGain.gain.setTargetAtTime(0.13 + 0.20 * load * Math.min(1, car.rpm / 9000), now, 0.05);
    this.engFilter.frequency.setTargetAtTime(420 + car.input.throttle * 2600 + (car.rpm / PHYS.rpmMax) * 1500, now, 0.06);

    // gear shift blip
    if (car.gear !== this._lastGear) {
      this._lastGear = car.gear;
      this.engGain.gain.cancelScheduledValues(now);
      this.engGain.gain.setValueAtTime(0.05, now);
      this.engGain.gain.setTargetAtTime(0.25, now + 0.05, 0.04);
    }

    // screech follows slide / lockup
    const scr = Math.min(1, car.sliding * 1.2 + (car.lockup ? 0.5 : 0)) * Math.min(1, car.speed / 25);
    this.scrGain.gain.setTargetAtTime(scr * 0.22, now, 0.07);

    // wind by speed³
    const w = Math.pow(car.speed / PHYS.maxSpeed, 3);
    this.windGain.gain.setTargetAtTime(w * 0.16, now, 0.1);

    // kerb / runoff rumble
    const rum = car.surface === 'kerb' ? 0.30 : (car.surface === 'runoff' ? 0.16 : 0);
    this.rumbleGain.gain.setTargetAtTime(rum * Math.min(1, car.speed / 20), now, 0.05);
  }

  thump(strength = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.8, 0.25 * strength), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    src.connect(filter).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 0.3);
  }

  beep(freq = 440, dur = 0.18, vol = 0.2) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + dur);
  }

  stopEngine() {
    if (this.engGain && this.ctx) this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    if (this.scrGain && this.ctx) this.scrGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if (this.windGain && this.ctx) this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if (this.rumbleGain && this.ctx) this.rumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}
