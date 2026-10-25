// What the app is playing, measured on the audio thread: loudness, and `punch`, the bass's jump over its own recent
// level on every kick (two one-pole low-passes at 150 Hz). Plain JS: it runs in the AudioWorklet scope, loaded by URL.
class MeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lp1 = 0; this.lp2 = 0;
    this.envelope = 0; this.bassNow = 0; this.bassUsual = 0;
    this.decibels = -120; this.punch = 0;
    this.blocks = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) return true;
    const frames = input[0].length;
    const channels = input.length;
    const c = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
    let squares = 0, bassSquares = 0;
    for (let i = 0; i < frames; i++) {
      let mono = 0;
      for (let ch = 0; ch < channels; ch++) { const v = input[ch][i]; squares += v * v; mono += v; }
      mono /= channels;
      this.lp1 += c * (mono - this.lp1);
      this.lp2 += c * (this.lp1 - this.lp2);
      bassSquares += this.lp2 * this.lp2;
    }
    const rms = Math.sqrt(squares / (frames * channels));
    const bass = Math.sqrt(bassSquares / frames);
    const seconds = frames / sampleRate;
    const step = (t) => 1 - Math.exp(-seconds / t);
    this.envelope += (rms - this.envelope) * (rms > this.envelope ? step(0.005) : step(0.05));
    this.bassNow += (bass - this.bassNow) * (bass > this.bassNow ? step(0.004) : step(0.06));
    this.bassUsual += (bass - this.bassUsual) * step(1.2);
    this.decibels = Math.max(20 * Math.log10(Math.max(this.envelope, 1e-6)), -120);
    this.punch = this.bassUsual > 0.0005 ? this.bassNow / this.bassUsual : 0;
    // About every 8 ms is plenty: the light draws at most 60 times a second.
    if (++this.blocks % 3 === 0) this.port.postMessage({ decibels: this.decibels, punch: this.punch });
    return true;
  }
}
registerProcessor('desktop-meter', MeterProcessor);
