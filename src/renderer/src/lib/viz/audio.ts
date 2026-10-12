import type { AudioFrame } from "./types";

export const BINS = 64;
const WAVE_POINTS = 256;
/** Samples per channel handed to the stereo scope. */
const SCOPE_POINTS = 512;
/** Semitones C2..B6. */
export const NOTE_COUNT = 60;
const NOTE_BASE_HZ = 65.406; // C2

/** First 16 log bins ≈ 30–145 Hz: kick and bass fundamentals. */
const BASS_BINS = 16;
/**
 * Auto-gain: aim the loudest bin here, never boost past MAX_GAIN. Kept below 1
 * so the bass emphasis on top still has room to swing on kicks.
 */
const AGC_TARGET = 0.7;
const AGC_MAX_GAIN = 6;
/** Below this the input is treated as silence/noise, and gain is frozen. */
const AGC_GATE = 0.05;

/**
 * Linear up to 0.8, then compresses smoothly toward 1. A hard clamp flattens
 * everything loud to the same value, so kicks stop registering at the top.
 */
function softClip(x: number): number {
  return x <= 0.8 ? x : 0.8 + 0.2 * (1 - Math.exp(-(x - 0.8) / 0.2));
}

/** Input boost: none, adaptive (up to AGC_MAX_GAIN), or a fixed multiplier. */
export type Boost = "off" | "auto" | "2" | "4" | "8";

export interface AudioSource {
  id: string;
  label: string;
}

/**
 * Available capture sources: default-playback loopback plus every recording
 * device. Device labels are hidden until mic permission is granted, so we
 * request once and re-enumerate.
 */
export async function listAudioInputs(): Promise<AudioSource[]> {
  const sources: AudioSource[] = [
    { id: "loopback", label: "System audio (default playback)" },
  ];
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some((d) => d.kind === "audioinput" && !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        /* labels stay generic */
      }
    }
    for (const d of devices) {
      if (d.kind === "audioinput" && d.deviceId && d.deviceId !== "default") {
        sources.push({ id: d.deviceId, label: d.label || "Audio input" });
      }
    }
  } catch {
    /* loopback-only */
  }
  return sources;
}

/**
 * Audio capture + analysis. Without capture it synthesises a gentle signal so
 * reactive modes still move rather than sitting dead flat.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  // Stereo scope taps, and a long-window analyser that resolves semitones. It's
  // separate because a window that long smears kicks in the main analyser.
  private anL: AnalyserNode | null = null;
  private anR: AnalyserNode | null = null;
  private anNotes: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  /** The host's node we're tapping, when the context isn't ours (see enableNode). */
  private tapSource: AudioNode | null = null;
  private bufL = new Float32Array(0);
  private bufR = new Float32Array(0);
  private noteFreq = new Uint8Array(0);
  private noteTarget = new Float32Array(NOTE_COUNT);
  private stream: MediaStream | null = null;
  private freq = new Uint8Array(0);
  private time = new Uint8Array(0);
  private raw = new Float32Array(BINS);
  private prevBass = new Float32Array(BASS_BINS);
  private t = 0;
  private fluxAvg = 0;
  private cooldown = 0;

  // Auto-gain state
  private ref = 0.3; // slow-moving estimate of how loud the input runs
  private _gain = 1;
  boost: Boost = "auto";

  /** Current boost applied to quiet input (1 = none). */
  get gain(): number {
    return this.active ? this._gain : 1;
  }

  readonly frame: AudioFrame = {
    spec: new Float32Array(BINS),
    peaks: new Float32Array(BINS),
    wave: new Float32Array(WAVE_POINTS),
    bass: 0,
    mid: 0,
    treble: 0,
    energy: 0,
    beat: 0,
    waveL: new Float32Array(SCOPE_POINTS),
    waveR: new Float32Array(SCOPE_POINTS),
    notes: new Float32Array(NOTE_COUNT),
    chroma: new Float32Array(12),
  };

  get active(): boolean {
    return this.analyser !== null;
  }

  /** RMS level 0..1 of the captured signal, used to confirm real input. */
  get level(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.time as any);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.time.length) * 3);
  }

  /**
   * "loopback" grabs the default playback device via getDisplayMedia; anything
   * else opens that recording device. The device path matters for virtual
   * mixers (VoiceMeeter, VB-Cable): audio on a non-default bus never appears in
   * default-endpoint loopback, so those users capture the mixer's bus directly.
   */
  async enable(deviceId = "loopback"): Promise<boolean> {
    this.disable();
    try {
      let stream: MediaStream;
      if (deviceId === "loopback") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop()); // we only want sound
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            // Voice processing would gut a music signal.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      this.stream = stream;
      this.buildTaps(ctx, source);
      return true;
    } catch (e) {
      console.warn("[viz] audio capture failed", e);
      return false;
    }
  }

  /**
   * Taps a graph the host already built, instead of opening a capture: for an
   * app that plays its own audio through Web Audio. The context and source are
   * the host's, so they're never closed here, and nothing is connected to the
   * destination - the host's chain already plays the audio, and a second path
   * would play it twice. Analysers only need an input to be pulled.
   */
  enableNode(ctx: AudioContext, source: AudioNode): boolean {
    this.disable();
    try {
      this.tapSource = source;
      this.buildTaps(ctx, source);
      return true;
    } catch (e) {
      console.warn("[viz] audio tap failed", e);
      this.disable();
      return false;
    }
  }

  /** The analyser chain, shared by both input paths so their settings can't drift. */
  private buildTaps(ctx: AudioContext, source: AudioNode) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096; // finer low-end resolution
    analyser.smoothingTimeConstant = 0.72;
    // Wide window: loud masters push bass above -12 dB, which clipped the
    // FFT and pinned the bass bars. Auto-gain lifts quiet material instead.
    analyser.minDecibels = -90;
    analyser.maxDecibels = -4;
    source.connect(analyser);

    const splitter = ctx.createChannelSplitter(2);
    source.connect(splitter);
    const anL = ctx.createAnalyser();
    const anR = ctx.createAnalyser();
    anL.fftSize = anR.fftSize = 1024;
    splitter.connect(anL, 0);
    splitter.connect(anR, 1);

    const anNotes = ctx.createAnalyser();
    anNotes.fftSize = 16384; // ~2.9 Hz bins: enough to separate semitones from C2 up
    anNotes.smoothingTimeConstant = 0.5;
    anNotes.minDecibels = -90;
    anNotes.maxDecibels = -4;
    source.connect(anNotes);

    this.ctx = ctx;
    this.analyser = analyser;
    this.splitter = splitter;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);
    this.anL = anL;
    this.anR = anR;
    this.anNotes = anNotes;
    this.bufL = new Float32Array(anL.fftSize);
    this.bufR = new Float32Array(anR.fftSize);
    this.noteFreq = new Uint8Array(anNotes.frequencyBinCount);
  }

  disable() {
    if (this.tapSource) {
      // Borrowed graph: remove only the edges we added. A bare disconnect() on
      // the host's node would cut its whole playback chain.
      for (const n of [this.analyser, this.splitter, this.anNotes]) {
        if (!n) continue;
        try {
          this.tapSource.disconnect(n);
        } catch {
          /* edge already gone */
        }
      }
      this.splitter?.disconnect();
    } else {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.ctx?.close().catch(() => {});
    }
    this.tapSource = null;
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.splitter = null;
    this.anL = this.anR = this.anNotes = null;
  }

  analyze(dt: number, playing: boolean): AudioFrame {
    this.t += dt;
    const f = this.frame;
    const raw = this.raw;

    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freq as any);
      // Log-spaced bins: linear FFT hands almost every bin to the low end.
      const bins = this.freq.length;
      const hzPerBin = (this.ctx?.sampleRate ?? 48000) / 2 / bins;
      const minHz = 30;
      const maxHz = 16000;
      for (let i = 0; i < BINS; i++) {
        const f0 = minHz * Math.pow(maxHz / minHz, i / BINS);
        const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / BINS);
        const lo = Math.max(0, Math.floor(f0 / hzPerBin));
        const hi = Math.min(bins - 1, Math.max(lo + 1, Math.ceil(f1 / hzPerBin)));
        let peak = 0;
        for (let j = lo; j < hi; j++) peak = Math.max(peak, this.freq[j]);
        raw[i] = Math.min(1, (peak / 255) * (1 + (i / BINS) * 0.65)); // lift highs
      }
      this.analyser.getByteTimeDomainData(this.time as any);
      const step = this.time.length / f.wave.length;
      for (let i = 0; i < f.wave.length; i++) {
        f.wave[i] = (this.time[Math.floor(i * step)] - 128) / 128;
      }
    } else {
      const amp = playing ? 0.34 : 0.07;
      for (let i = 0; i < BINS; i++) {
        const p = i / BINS;
        raw[i] =
          amp *
          (0.55 + 0.45 * Math.sin(this.t * 1.7 + p * 7) * Math.sin(this.t * 0.8 + p * 3.3)) *
          (1 - p * 0.5);
      }
      const wamp = playing ? 0.32 : 0.08;
      for (let i = 0; i < f.wave.length; i++) {
        const p = i / f.wave.length;
        f.wave[i] =
          wamp * Math.sin(p * Math.PI * 6 + this.t * 2.2) * Math.sin(p * Math.PI * 2 + this.t * 0.9);
      }
    }

    this.analyzeScope();
    this.analyzeNotes(dt);

    if (this.analyser) this.applyAutoGain(dt);
    // Real audio gets the bass emphasis; the synthetic idle signal only needs
    // the flux for beat timing.
    const bassFlux = this.punchBass(this.analyser !== null);

    // Fast attack / slow decay: hits punch, then fall away naturally. Bass bins
    // release faster so consecutive kicks read as separate hits, not a smear.
    const attack = 1 - Math.exp(-dt * 124);
    const decay = 1 - Math.exp(-dt * 15);
    const bassDecay = 1 - Math.exp(-dt * 26);
    for (let i = 0; i < BINS; i++) {
      const k = raw[i] > f.spec[i] ? attack : i < BASS_BINS ? bassDecay : decay;
      f.spec[i] += (raw[i] - f.spec[i]) * k;
      f.peaks[i] = Math.max(f.peaks[i] - dt * 0.55, f.spec[i]);
    }

    const avg = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += f.spec[i];
      return s / (b - a);
    };
    f.bass = avg(0, BASS_BINS);
    f.mid = avg(BASS_BINS, Math.floor(BINS * 0.55));
    f.treble = avg(Math.floor(BINS * 0.55), BINS);
    f.energy = (f.bass + f.mid + f.treble) / 3;

    // Beats fire on bass *onsets* (spectral flux), not bass level: a sustained
    // 808 holds the level high without re-triggering, but every kick is a jump.
    // The average is time-based so it behaves the same at 30fps and 144fps.
    this.cooldown -= dt;
    if (bassFlux > this.fluxAvg * 1.8 + 0.012 && this.cooldown <= 0) {
      f.beat = 1;
      this.cooldown = 0.14;
    }
    this.fluxAvg += (bassFlux - this.fluxAvg) * (1 - Math.exp(-dt / 0.6));
    f.beat = Math.max(0, f.beat - dt * 3.6);
    return f;
  }

  /**
   * Fills the stereo scope. Mono sources (or the synthetic idle signal) have
   * identical channels, which collapses a goniometer to a flat line. For those
   * the right channel becomes a slightly delayed copy of the left, which draws
   * the signal's phase portrait instead.
   */
  private analyzeScope() {
    const f = this.frame;
    const n = SCOPE_POINTS;
    let src: Float32Array;
    let alt: Float32Array | null = null;
    if (this.anL && this.anR) {
      this.anL.getFloatTimeDomainData(this.bufL as any);
      this.anR.getFloatTimeDomainData(this.bufR as any);
      src = this.bufL;
      let diff = 0;
      let mag = 0;
      for (let i = 0; i < src.length; i += 4) {
        diff += Math.abs(this.bufL[i] - this.bufR[i]);
        mag += Math.abs(this.bufL[i]);
      }
      if (diff > mag * 0.02) alt = this.bufR;
    } else {
      src = f.wave; // synthetic
    }
    const delay = Math.max(1, Math.round(src.length / 40));
    const span = src.length - delay;
    for (let i = 0; i < n; i++) {
      const j = Math.floor((i / n) * span);
      f.waveL[i] = src[j];
      f.waveR[i] = alt ? alt[j] : src[j + delay];
    }
  }

  /** Semitone loudness from the long-window analyser, plus a chroma summary. */
  private analyzeNotes(dt: number) {
    const f = this.frame;
    const notes = f.notes;
    const target = this.noteTarget;
    if (this.anNotes && this.ctx) {
      this.anNotes.getByteFrequencyData(this.noteFreq as any);
      const hzPerBin = this.ctx.sampleRate / this.anNotes.fftSize;
      const last = this.noteFreq.length - 1;
      const gain = this._gain;
      for (let i = 0; i < NOTE_COUNT; i++) {
        // Loudest bin within ±half a semitone of the note.
        const hz = NOTE_BASE_HZ * Math.pow(2, i / 12);
        const lo = Math.max(0, Math.floor((hz * 0.9715) / hzPerBin));
        const hi = Math.min(last, Math.ceil((hz * 1.0293) / hzPerBin));
        let peak = 0;
        for (let j = lo; j <= hi; j++) peak = Math.max(peak, this.noteFreq[j]);
        target[i] = softClip((peak / 255) * gain * (1 + (i / NOTE_COUNT) * 0.4));
      }
    } else {
      // Synthetic: read notes off the log spectrum (C2 ≈ bin 10 of 64).
      const spec = f.spec;
      for (let i = 0; i < NOTE_COUNT; i++) {
        const hz = NOTE_BASE_HZ * Math.pow(2, i / 12);
        const x = (Math.log(hz / 30) / Math.log(16000 / 30)) * BINS;
        const k = Math.min(BINS - 2, Math.max(0, Math.floor(x)));
        target[i] = spec[k] + (spec[k + 1] - spec[k]) * (x - k);
      }
    }
    // Contrast: notes only matter relative to their neighbours, so the average
    // floor is pulled down and what stands out above it is kept.
    let mean = 0;
    for (let i = 0; i < NOTE_COUNT; i++) mean += target[i];
    mean /= NOTE_COUNT;
    const attack = 1 - Math.exp(-dt * 60);
    const decay = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < NOTE_COUNT; i++) {
      const v = Math.max(0, (target[i] - mean * 0.6) / (1 - mean * 0.6 + 1e-6));
      notes[i] += (v - notes[i]) * (v > notes[i] ? attack : decay);
    }
    const ch = f.chroma;
    ch.fill(0);
    for (let i = 0; i < NOTE_COUNT; i++) ch[i % 12] += notes[i];
    let max = 1e-6;
    for (let i = 0; i < 12; i++) max = Math.max(max, ch[i]);
    for (let i = 0; i < 12; i++) ch[i] /= max;
  }

  /**
   * Applies the chosen boost. "auto" lifts quiet captures (e.g. a VoiceMeeter
   * bus at low volume) toward a usable level. Attack is fast so a loud hit pulls gain down before it
   * clips; release is slow so gain doesn't pump between beats. Below the gate
   * the estimate freezes, so silence and hiss never get amplified.
   */
  private applyAutoGain(dt: number) {
    const raw = this.raw;
    let loud = 0;
    for (let i = 0; i < BINS; i++) loud = Math.max(loud, raw[i]);

    if (this.boost === "auto") {
      if (loud > AGC_GATE) {
        const tau = loud > this.ref ? 0.08 : 2.5;
        this.ref += (loud - this.ref) * (1 - Math.exp(-dt / tau));
      }
      const target = Math.min(AGC_MAX_GAIN, Math.max(1, AGC_TARGET / Math.max(this.ref, 0.05)));
      this._gain += (target - this._gain) * (1 - Math.exp(-dt / 0.4));
    } else {
      this._gain = this.boost === "off" ? 1 : Number(this.boost);
    }

    // Soft clip rather than clamp: a big fixed boost would otherwise pin every
    // loud bin at exactly 1 and the visualizer would stop moving.
    if (this._gain !== 1) {
      for (let i = 0; i < BINS; i++) raw[i] = softClip(raw[i] * this._gain);
    }
  }

  /**
   * Emphasises the low end and adds a transient kick: the frame-to-frame rise
   * in each bass bin is added on top, so onsets jump harder than sustained bass.
   * Returns the mean bass flux, which drives beat detection.
   */
  private punchBass(emphasize: boolean): number {
    const raw = this.raw;
    let flux = 0;
    for (let i = 0; i < BASS_BINS; i++) {
      const rise = Math.max(0, raw[i] - this.prevBass[i]);
      this.prevBass[i] = raw[i];
      flux += rise;
      if (emphasize) raw[i] = softClip(raw[i] * 1.2 + rise * 1.6);
    }
    return flux / BASS_BINS;
  }
}
