// Original, synthesised audio (no external assets): a sparse glass drone and soft chimes. Music and effects volumes are independent.
// Audio is never required to understand a threat: every sound has a visual/text equivalent.
export class Sound {
  constructor() { this.ctx = null; this.music = 0.35; this.fx = 0.5; this.node = null; this.started = false; this.muted = false; }
  start() {
    if (this.started) return; try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); this.started = true;
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.music * 0.12; this.musicGain.connect(this.ctx.destination);
      this.fxGain = this.ctx.createGain(); this.fxGain.gain.value = this.fx; this.fxGain.connect(this.ctx.destination);
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900; filt.connect(this.musicGain);
      // slow drone chord: two detuned sines per voice, with a very slow tremolo; meaningful silence is left by the LFO dipping to zero
      [110, 164.8, 220, 277.2].forEach((f, i) => { for (const d of [-1.5, 1.5]) { const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f + d * 0.3; const g = this.ctx.createGain(); g.gain.value = 0.25 / (i + 1); o.connect(g); g.connect(filt); o.start(); } });
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.045; const lg = this.ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(this.musicGain.gain); lfo.start();
      this.chimeTimer = setInterval(() => { if (Math.random() < 0.35 && this.music > 0) this.chime([523.25, 659.25, 783.99, 880][Math.floor(Math.random() * 4)], 0.05, true); }, 7000);
    } catch (e) { }
  }
  setMusic(v) { this.music = v; if (this.musicGain) this.musicGain.gain.value = v * 0.12; }
  setFx(v) { this.fx = v; if (this.fxGain) this.fxGain.gain.value = v; }
  chime(freq = 660, vol = 0.12, ambient = false) {
    if (!this.ctx || (!ambient && this.fx <= 0)) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(ambient ? this.musicGain : this.fxGain); o.start(t); o.stop(t + 1.7);
    const o2 = this.ctx.createOscillator(), g2 = this.ctx.createGain(); o2.type = 'sine'; o2.frequency.value = freq * 2.01; g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vol * 0.3, t + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); o2.connect(g2); g2.connect(ambient ? this.musicGain : this.fxGain); o2.start(t); o2.stop(t + 1);
  }
  click() { this.chime(880, 0.05); } confirm() { this.chime(660, 0.08); setTimeout(() => this.chime(990, 0.06), 90); } warn() { this.chime(311, 0.1); } turn() { this.chime(440, 0.08); setTimeout(() => this.chime(554, 0.06), 120); }
}
