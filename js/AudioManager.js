// AudioManager.js - Engine sound via Web Audio API (no assets needed)

class AudioManager {
  constructor() {
    this.ctx = null;
    this.oscillator = null;
    this.gainNode = null;
    this.distortion = null;
    this.running = false;
    this._started = false;
  }

  // Must be called after a user gesture
  start() {
    if (this._started) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._buildGraph();
      this._started = true;
    } catch (e) {
      console.warn('Web Audio not available:', e);
    }
  }

  _buildGraph() {
    const ctx = this.ctx;

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.18;
    this.masterGain.connect(ctx.destination);

    // Engine oscillator 1 (fundamental)
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 80;

    // Engine oscillator 2 (harmonic layer)
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 160;

    // Gain for each oscillator
    this.gain1 = ctx.createGain(); this.gain1.gain.value = 0.6;
    this.gain2 = ctx.createGain(); this.gain2.gain.value = 0.25;

    // Distortion (gives harsh F1 engine character)
    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.curve = this._makeDistortionCurve(80);
    this.waveShaper.oversample = '2x';

    // Low-pass filter (rolling off high frequencies for realism)
    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = 'lowpass';
    this.lpf.frequency.value = 4000;
    this.lpf.Q.value = 1.5;

    // High-pass filter (removes very low rumble)
    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 60;

    // Exhaust crackle (noise burst on decel)
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;

    // Connect graph
    this.osc1.connect(this.gain1);
    this.osc2.connect(this.gain2);
    this.gain1.connect(this.waveShaper);
    this.gain2.connect(this.waveShaper);
    this.waveShaper.connect(this.hpf);
    this.hpf.connect(this.lpf);
    this.lpf.connect(this.masterGain);

    this.osc1.start();
    this.osc2.start();
    this.running = true;
  }

  _makeDistortionCurve(amount) {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // Call every frame with current car state
  update(rpm, throttle, surface) {
    if (!this.running || !this.ctx) return;

    const t = this.ctx.currentTime;
    const smoothing = 0.05;

    // Map RPM 800-15000 → frequency range 40-520 Hz (engine pitch)
    const freq = 40 + (rpm - 800) / (15000 - 800) * 480;
    this.osc1.frequency.setTargetAtTime(freq, t, smoothing);
    this.osc2.frequency.setTargetAtTime(freq * 2.05, t, smoothing);

    // Throttle affects gain and filter cutoff
    const targetGain = 0.08 + throttle * 0.15;
    this.masterGain.gain.setTargetAtTime(targetGain, t, smoothing);

    // Open up high frequencies under throttle (more aggressive sound)
    const lpFreq = 1200 + throttle * 3800 + rpm / 15000 * 1500;
    this.lpf.frequency.setTargetAtTime(lpFreq, t, smoothing);

    // Extra roughness on gravel/kerbs
    if (surface === 'kerb') {
      this.waveShaper.curve = this._makeDistortionCurve(120);
    } else {
      this.waveShaper.curve = this._makeDistortionCurve(80);
    }
  }

  stop() {
    if (!this.running) return;
    try {
      this.osc1.stop(); this.osc2.stop();
      this.ctx.close();
    } catch (e) {}
    this.running = false;
  }
}
