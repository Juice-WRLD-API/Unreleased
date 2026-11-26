// Vocal remover / vocal isolator for the playback chain (audioEffects' "Vocals" effect). Runs a short-time Fourier
// transform over the stereo mix and scores every frequency bin by how alike its left and right are: a bin whose two
// sides match in level and phase is panned dead centre, which is where the lead vocal sits in nearly every mix.
//   mode 1 (no vocals):  takes the centre out of those bins, leaving the beat
//   mode 2 (vocals only): keeps only the centre of those bins, leaving the vocal
// Bins under ~120 Hz and over ~11 kHz are never treated as vocal, so the kick and bass line stay in the beat and out
// of the acapella. `amount` (0..1) blends towards the untouched mix. A mono file has everything in the centre, so
// mode 1 empties it; that's the nature of the trick, not a bug.
// Plain JS: it runs in the AudioWorklet scope, loaded by URL (see meter-worklet.js for why it's a file of its own).
const N = 2048;   // frame (≈43 ms at 48 kHz): long enough to split a voice's harmonics from the beat's
const H = 512;    // hop, 75% overlap
const LOW_HZ = 120;
const HIGH_HZ = 11000;
// Centre-ness between these two scores (1 = left and right identical) fades the bin from "beat" to "vocal".
const KNEE_LO = 0.72;
const KNEE_HI = 0.97;
// How much of the last frame's mask carries over, so bins don't flicker frame to frame ("musical noise").
const SMOOTH = 0.45;

class StemsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 0;
    this.amount = 1;
    this.inL = new Float32Array(N); this.inR = new Float32Array(N);
    this.olaL = new Float32Array(N); this.olaR = new Float32Array(N);
    this.outL = new Float32Array(H); this.outR = new Float32Array(H);
    this.fill = 0;
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.mask = new Float32Array(N / 2 + 1);
    // sqrt-Hann on both analysis and synthesis: their product is a Hann, which sums to 2 at 75% overlap.
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    this.cos = new Float64Array(N / 2); this.sin = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) { this.cos[k] = Math.cos((2 * Math.PI * k) / N); this.sin[k] = -Math.sin((2 * Math.PI * k) / N); }
    this.rev = new Uint16Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.kLo = Math.max(1, Math.round((LOW_HZ * N) / sampleRate));
    this.kHi = Math.min(N / 2 - 1, Math.round((HIGH_HZ * N) / sampleRate));
    this.port.onmessage = (event) => {
      const d = event.data || {};
      if (d.mode === 0 || d.mode === 1 || d.mode === 2) this.mode = d.mode;
      if (typeof d.amount === 'number' && Number.isFinite(d.amount)) this.amount = Math.max(0, Math.min(1, d.amount));
    };
  }

  // In-place iterative radix-2 FFT; sign 1 forward, -1 inverse (unscaled).
  fft(re, im, sign) {
    const rev = this.rev;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sign * this.sin[k * step];
          const a = start + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  frame() {
    const { re, im, win, inL, inR, mask } = this;
    // Both channels in one complex FFT: left as the real part, right as the imaginary.
    for (let i = 0; i < N; i++) { re[i] = inL[i] * win[i]; im[i] = inR[i] * win[i]; }
    this.fft(re, im, 1);
    const mode = this.mode, amount = this.amount;
    for (let k = 0; k <= N / 2; k++) {
      const j = (N - k) & (N - 1);
      const zr = re[k], zi = im[k], wr = re[j], wi = im[j];
      // Unpack: L[k] = (Z[k] + conj Z[N-k]) / 2, R[k] = (Z[k] - conj Z[N-k]) / 2i.
      const lr = (zr + wr) / 2, li = (zi - wi) / 2;
      const rr = (zi + wi) / 2, ri = (wr - zr) / 2;
      let m = 0;
      if (k >= this.kLo && k <= this.kHi) {
        const power = lr * lr + li * li + rr * rr + ri * ri;
        const likeness = power > 1e-14 ? (2 * (lr * rr + li * ri)) / power : 0;
        m = (likeness - KNEE_LO) / (KNEE_HI - KNEE_LO);
        m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
      }
      m = mask[k] = mask[k] * SMOOTH + m * (1 - SMOOTH);
      // The centre (vocal) part of this bin.
      const cr = ((lr + rr) / 2) * m, ci = ((li + ri) / 2) * m;
      let yLr, yLi, yRr, yRi;
      if (mode === 2) {
        const rest = 1 - amount;
        yLr = cr + rest * (lr - cr); yLi = ci + rest * (li - ci);
        yRr = cr + rest * (rr - cr); yRi = ci + rest * (ri - ci);
      } else if (mode === 1) {
        yLr = lr - amount * cr; yLi = li - amount * ci;
        yRr = rr - amount * cr; yRi = ri - amount * ci;
      } else {
        yLr = lr; yLi = li; yRr = rr; yRi = ri;
      }
      // Repack Y = YL + i·YR (and its mirror bin) for one inverse FFT.
      re[k] = yLr - yRi; im[k] = yLi + yRr;
      if (k !== 0 && k !== N / 2) { re[j] = yLr + yRi; im[j] = yRr - yLi; }
    }
    this.fft(re, im, -1);
    const { olaL, olaR, outL, outR } = this;
    const scale = 1 / N;
    for (let i = 0; i < N; i++) {
      olaL[i] += re[i] * scale * win[i];
      olaR[i] += im[i] * scale * win[i];
    }
    for (let i = 0; i < H; i++) { outL[i] = olaL[i] * 0.5; outR[i] = olaR[i] * 0.5; }
    olaL.copyWithin(0, H); olaL.fill(0, N - H);
    olaR.copyWithin(0, H); olaR.fill(0, N - H);
    inL.copyWithin(0, H); inR.copyWithin(0, H);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const oL = output[0];
    const oR = output[1] || null;
    const l = input && input[0];
    const r = input && (input[1] || input[0]);
    const frames = oL.length;
    for (let i = 0; i < frames; i++) {
      oL[i] = this.outL[this.fill];
      if (oR) oR[i] = this.outR[this.fill];
      this.inL[N - H + this.fill] = l ? l[i] : 0;
      this.inR[N - H + this.fill] = r ? r[i] : 0;
      if (++this.fill === H) { this.fill = 0; this.frame(); }
    }
    return true;
  }
}

registerProcessor('vocal-stems', StemsProcessor);
