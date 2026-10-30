// Sons sintetizados na hora (sem arquivos): turbina (sobe com a velocidade), vento, metralhadora,
// míssil, explosões, impacto no casco, bipes da trava (rápido travando, contínuo travado), alarme,
// portal, chegada de onda, vitória e derrota. Só começa depois de um clique, de uma tecla ou da
// entrada no VR (regra do navegador). Os testes nunca criam esta classe.
export class Sfx {
  constructor() { this.ctx = null; this.on = true; this.lockState = 0; this.beepT = 0; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.7 : 0;
      this.master.connect(this.ctx.destination);
      this.noise = this.noiseBuffer(2);
      this.startEngine();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setOn(v) {
    this.on = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  noiseBuffer(sec) {
    const c = this.ctx, buf = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  startEngine() {
    const c = this.ctx;
    // ronco: dente de serra filtrado + chiado da turbina + vento
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 60;
    this.eng2 = c.createOscillator(); this.eng2.type = 'square'; this.eng2.frequency.value = 90;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 400; this.engF.Q.value = 2;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF); this.eng2.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master);
    this.eng.start(); this.eng2.start();
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    this.hissF = c.createBiquadFilter(); this.hissF.type = 'bandpass'; this.hissF.frequency.value = 2400; this.hissF.Q.value = 0.8;
    this.hissG = c.createGain(); this.hissG.gain.value = 0;
    src.connect(this.hissF); this.hissF.connect(this.hissG); this.hissG.connect(this.master);
    const src2 = c.createBufferSource(); src2.buffer = this.noise; src2.loop = true;
    this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 600;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    src2.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    src.start(); src2.start();
    // tom contínuo da trava
    this.lockO = c.createOscillator(); this.lockO.type = 'square'; this.lockO.frequency.value = 1320;
    this.lockG = c.createGain(); this.lockG.gain.value = 0;
    this.lockO.connect(this.lockG); this.lockG.connect(this.master); this.lockO.start();
  }
  // v em m/s, boost true/false, active = jogando (no menu o motor fica baixinho)
  setEngine(v, throttle, boost, active, gForce = 0) {
    if (!this.eng) return;
    const t = this.ctx.currentTime, k = Math.min(1, v / 215);
    this.eng.frequency.setTargetAtTime(48 + 70 * k + (boost ? 25 : 0), t, 0.15);
    this.eng2.frequency.setTargetAtTime(72 + 105 * k + (boost ? 40 : 0), t, 0.15);
    this.engF.frequency.setTargetAtTime(300 + 900 * throttle + (boost ? 900 : 0), t, 0.2);
    this.engG.gain.setTargetAtTime(active ? 0.05 + 0.05 * throttle : 0.02, t, 0.2);
    this.hissG.gain.setTargetAtTime(active ? 0.015 + 0.03 * k + (boost ? 0.05 : 0) : 0.006, t, 0.2);
    this.hissF.frequency.setTargetAtTime(1800 + 2400 * k, t, 0.2);
    this.windG.gain.setTargetAtTime(active ? 0.03 + 0.08 * k + Math.min(0.1, gForce * 0.05) : 0.02, t, 0.3);
    this.windF.frequency.setTargetAtTime(400 + 900 * k, t, 0.3);
  }
  // 0 = nada, 1 = travando (bipes), 2 = travado (tom contínuo)
  setLock(state, dt) {
    if (!this.lockG) return;
    const t = this.ctx.currentTime;
    if (state === 2) this.lockG.gain.setTargetAtTime(0.035, t, 0.01);
    else this.lockG.gain.setTargetAtTime(0, t, 0.01);
    if (state === 1) { this.beepT -= dt; if (this.beepT <= 0) { this.beepT = 0.16; this.tone(990, 0.05, { type: 'square', vol: 0.04 }); } }
    else this.beepT = 0;
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(dur, { freq = 1000, q = 1, vol = 0.3, type = 'bandpass', at = 0, slide = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  gun() { this.burst(0.06, { freq: 1800, q: 0.9, vol: 0.16 }); this.tone(140, 0.05, { type: 'square', vol: 0.06, slide: 0.6 }); }
  missile() { this.burst(0.9, { freq: 600, q: 0.6, vol: 0.3, slide: 3 }); this.tone(220, 0.5, { type: 'sawtooth', vol: 0.05, slide: 2.5 }); }
  boom(big = false, near = 1) {
    const v = (big ? 0.55 : 0.32) * near;
    if (v < 0.01) return;
    this.burst(big ? 1.6 : 0.8, { freq: big ? 500 : 900, type: 'lowpass', q: 0.5, vol: v, slide: 0.15 });
    this.tone(big ? 55 : 80, big ? 1.2 : 0.5, { type: 'sine', vol: v * 0.8, slide: 0.5 });
  }
  hit() { this.tone(1500 + Math.random() * 400, 0.04, { type: 'triangle', vol: 0.05 }); }
  hurt() { this.burst(0.18, { freq: 300, type: 'lowpass', vol: 0.35 }); this.tone(90, 0.15, { type: 'square', vol: 0.08, slide: 0.7 }); }
  crash() { this.burst(0.7, { freq: 220, type: 'lowpass', vol: 0.6, slide: 0.4 }); this.tone(50, 0.6, { vol: 0.4, slide: 0.6 }); }
  warn() { this.tone(880, 0.12, { type: 'square', vol: 0.05 }); this.tone(660, 0.12, { type: 'square', vol: 0.05, at: 0.15 }); }
  noAmmo() { this.tone(300, 0.08, { type: 'square', vol: 0.05 }); }
  boost() { this.burst(1.2, { freq: 300, q: 0.7, vol: 0.3, slide: 5 }); }
  portal(n) { this.tone(660 + n * 25, 0.18, { type: 'triangle', vol: 0.15 }); this.tone(990 + n * 37, 0.25, { type: 'triangle', vol: 0.12, at: 0.08 }); }
  portalMiss() { this.tone(300, 0.3, { type: 'sawtooth', vol: 0.08, slide: 0.6 }); }
  wave() { [523, 659, 523].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.05, at: i * 0.16 })); }
  shieldDown() { this.burst(1.2, { freq: 2000, q: 2, vol: 0.2, slide: 0.2 }); this.tone(440, 0.8, { type: 'sawtooth', vol: 0.08, slide: 0.3 }); }
  flare() { for (let i = 0; i < 4; i++) this.burst(0.15, { freq: 2600, q: 3, vol: 0.08, at: i * 0.07 }); }
  click() { this.tone(900, 0.04, { type: 'triangle', vol: 0.1 }); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.14, at: i * 0.14 })); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'sawtooth', vol: 0.07, at: i * 0.2 })); }
  star(k) { this.tone(880 + k * 220, 0.3, { type: 'triangle', vol: 0.15 }); }
}
