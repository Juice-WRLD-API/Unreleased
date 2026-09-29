import { AudioEngine, listAudioInputs, type Boost } from "./audio";
import { Canvas2DRenderer, type PxRect } from "./canvas2d";
import { GLRenderer } from "./gl";
import { extractPalette, paletteFromAccent, parseColor } from "./palette";
import { QUALITY, type AudioFrame, type Quality, type RGB, type VizLayout } from "./types";

export { listAudioInputs };
export type { Boost, Quality, VizLayout };

export interface VisualizerOption {
  id: string;
  name: string;
  group: "ambient" | "spectrum" | "shader";
  engine: "2d" | "gl";
}

export const VISUALIZERS: VisualizerOption[] = [
  { id: "none", name: "Off", group: "ambient", engine: "2d" },
  { id: "aurora", name: "Aurora", group: "ambient", engine: "2d" },
  { id: "bars", name: "Bars", group: "spectrum", engine: "2d" },
  { id: "mirror", name: "Mirror", group: "spectrum", engine: "2d" },
  { id: "wave", name: "Wave", group: "spectrum", engine: "2d" },
  { id: "radial", name: "Radial", group: "spectrum", engine: "2d" },
  { id: "orb", name: "Orb", group: "spectrum", engine: "2d" },
  { id: "particles", name: "Particles", group: "spectrum", engine: "2d" },
  { id: "spiral", name: "Spiral", group: "spectrum", engine: "2d" },
  { id: "notes", name: "Notes", group: "spectrum", engine: "2d" },
  { id: "lissajous", name: "Lissajous", group: "spectrum", engine: "2d" },
  { id: "nebula", name: "Nebula", group: "shader", engine: "gl" },
  { id: "silk", name: "Silk", group: "shader", engine: "gl" },
  { id: "halo", name: "Halo", group: "shader", engine: "gl" },
  { id: "corona", name: "Corona", group: "shader", engine: "gl" },
  { id: "ripples", name: "Ripples", group: "shader", engine: "gl" },
  { id: "lightning", name: "Lightning", group: "shader", engine: "gl" },
  { id: "vortex", name: "Vortex", group: "shader", engine: "gl" },
  { id: "gooey", name: "Gooey", group: "shader", engine: "gl" },
];

/** Maps retired/unknown ids onto a current mode. */
export function normalizeMode(id: string): string {
  if (id === "pulse") return "aurora";
  return VISUALIZERS.some((v) => v.id === id) ? id : "aurora";
}

const LAYOUT_REFRESH_MS = 100;
const GL_RESTORE_TIMEOUT_MS = 3000;
/** Beats remembered for the Ripples and Lightning shaders (matches the u_rip array size). */
const RIPPLE_SLOTS = 8;
/** Seconds a ripple is kept; the shader has faded it out well before this. */
const RIPPLE_LIFE = 4;
/** Seconds without a beat before a softer drop falls on its own. */
const RIPPLE_LULL = 1.1;

export class Visualizer {
  private audio = new AudioEngine();
  private c2d: Canvas2DRenderer;
  private gl: GLRenderer;

  private mode = "aurora";
  private quality: Quality = "medium";
  private playing = false;
  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private time = 0;

  private accentPal: RGB[] = paletteFromAccent({ r: 224, g: 89, b: 47 });
  private artPal: RGB[] | null = null;
  private usePalette = true;
  private pal: RGB[] = this.accentPal.map((c) => ({ ...c }));
  private artToken = 0;

  private layoutProvider: (() => VizLayout) | null = null;
  private layout: VizLayout = { focus: null, protect: [], intensity: 1 };
  private layoutAt = 0;

  private prevBeat = 0;
  private drops: { born: number; angle: number; dist: number; strength: number }[] = [];
  private ripples = new Float32Array(RIPPLE_SLOTS * 4);

  constructor(canvas2d: HTMLCanvasElement, canvasGl: HTMLCanvasElement) {
    this.c2d = new Canvas2DRenderer(canvas2d);
    this.gl = new GLRenderer(canvasGl);
    this.showEngine(null);
  }

  get glSupported(): boolean {
    return this.gl.ok;
  }

  get audioActive(): boolean {
    return this.audio.active;
  }

  get level(): number {
    return this.audio.level;
  }

  /** Boost currently applied to quiet input (1 = none). */
  get gain(): number {
    return this.audio.gain;
  }

  setBoost(boost: Boost) {
    this.audio.boost = boost;
  }

  /**
   * Runs audio analysis without drawing. The render loop only runs while
   * fullscreen is open, so without this the settings meter and boost readout
   * would freeze at whatever they were last time.
   */
  pumpAudio(dt: number) {
    if (this.running && !document.hidden && this.mode !== "none") return; // loop is doing it
    if (this.audio.active) this.audio.analyze(dt, this.playing);
  }

  enableAudio(deviceId = "loopback"): Promise<boolean> {
    return this.audio.enable(deviceId);
  }

  /** Analyses a node in the host's own graph instead of capturing (see AudioEngine.enableNode). */
  enableAudioNode(ctx: AudioContext, node: AudioNode): boolean {
    return this.audio.enableNode(ctx, node);
  }

  disableAudio() {
    this.audio.disable();
  }

  setMode(mode: string) {
    this.mode = normalizeMode(mode);
    this.c2d.reset();
  }

  setQuality(q: Quality) {
    if (QUALITY[q]) this.quality = q;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  setLayoutProvider(fn: () => VizLayout) {
    this.layoutProvider = fn;
  }

  setUsePalette(on: boolean) {
    this.usePalette = on;
  }

  /** Follows the live --accent (used when artwork colours are off/unavailable). */
  syncAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent");
    if (v) this.accentPal = paletteFromAccent(parseColor(v));
  }

  /** Extracts a palette from new artwork; stale results for old tracks are dropped. */
  async setArtwork(url: string) {
    const token = ++this.artToken;
    const pal = url ? await extractPalette(url) : null;
    if (token === this.artToken) this.artPal = pal;
  }

  /** A palette worked out ahead of time, for artwork the page can't sample. */
  setArtworkPalette(pal: RGB[] | null) {
    ++this.artToken; // a setArtwork still in flight is for the previous track
    this.artPal = pal;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.layoutAt = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.c2d.clear();
    this.gl.clear();
    this.showEngine(null);
  }

  /** Stops rendering and releases the audio taps and GL context. Unusable afterwards. */
  dispose() {
    this.stop();
    this.audio.disable();
    this.layoutProvider = null;
    this.gl.dispose();
  }

  private recreateGl() {
    const old = this.gl.canvas;
    const fresh = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(fresh);
    this.gl = new GLRenderer(fresh);
    console.warn("[viz] WebGL context not restored, recreated canvas");
  }

  private showEngine(engine: "2d" | "gl" | null) {
    this.c2d.canvas.style.display = engine === "2d" ? "block" : "none";
    this.gl.canvas.style.display = engine === "gl" ? "block" : "none";
  }

  /** Cross-fade toward the target palette so track changes melt, not snap. */
  private stepPalette(dt: number) {
    const target = this.usePalette && this.artPal ? this.artPal : this.accentPal;
    const k = 1 - Math.exp(-dt * 2.5);
    for (let i = 0; i < this.pal.length; i++) {
      const t = target[i % target.length];
      const c = this.pal[i];
      c.r += (t.r - c.r) * k;
      c.g += (t.g - c.g) * k;
      c.b += (t.b - c.b) * k;
    }
  }

  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const q = QUALITY[this.quality];
    const elapsed = now - this.lastFrame;
    if (q.fps > 0 && elapsed < 1000 / q.fps - 1) return; // frame cap
    this.lastFrame = now;
    if (document.hidden || this.mode === "none") return;

    const dt = Math.min(0.05, elapsed / 1000); // clamp after stalls
    this.time += dt;
    const frame = this.audio.analyze(dt, this.playing);
    this.trackRipples(frame);
    this.stepPalette(dt);

    if (this.layoutProvider && now - this.layoutAt > LAYOUT_REFRESH_MS) {
      this.layout = this.layoutProvider();
      this.layoutAt = now;
    }

    const opt = VISUALIZERS.find((v) => v.id === this.mode)!;
    // If the browser hasn't restored a lost context, replace the canvas: a
    // lost context is dead for good, but a fresh <canvas> gets a new one.
    if (this.gl.lostAt && now - this.gl.lostAt > GL_RESTORE_TIMEOUT_MS) this.recreateGl();
    const useGl = opt.engine === "gl" && this.gl.supports(this.mode);
    const host = this.c2d.canvas.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (useGl) {
      this.showEngine("gl");
      const scale = Math.min(dpr, 2) * q.glScale;
      if (!this.gl.resize(scale)) return;
      const H = this.gl.canvas.height;
      const focus = this.focusPx(box, scale, this.gl.canvas.width, H);
      this.gl.render({
        mode: this.mode,
        frame,
        pal: this.pal,
        time: this.time,
        focus: { x: focus.x, y: H - focus.y, r: focus.r }, // GL origin is bottom-left
        protect: this.rectsPx(box, scale).map((r) => ({
          rect: [r.x, H - (r.y + r.h), r.x + r.w, H - r.y],
          strength: r.strength,
        })),
        feather: 110 * scale,
        intensity: this.layout.intensity,
        octaves: q.octaves,
        ripples: this.ripples,
      });
    } else {
      this.showEngine("2d");
      const scale = Math.min(dpr, q.dpr);
      if (!this.c2d.resize(scale)) return;
      this.c2d.render({
        // A shader mode whose program failed falls back to something that works.
        mode: opt.engine === "gl" ? "aurora" : this.mode,
        frame,
        pal: this.pal,
        focus: this.focusPx(box, scale, this.c2d.canvas.width, this.c2d.canvas.height),
        protect: this.rectsPx(box, scale),
        feather: 90 * scale,
        intensity: this.layout.intensity,
        q,
        time: this.time,
        dt,
        px: scale,
      });
    }
  };

  /**
   * Remembers recent beats for the Ripples and Lightning shaders, which only see
   * the current frame. Each onset drops a ring at a random spot around the focus; spots are
   * kept relative to it (angle, distance in focus radii) so rings follow the
   * layout if it moves.
   */
  private trackRipples(frame: AudioFrame) {
    // beat jumps to 1 on an onset and decays after, so a jump marks a new one.
    const onset = frame.beat > this.prevBeat + 0.3;
    // Beats only come from bass onsets, so an intro or breakdown with no low
    // end would leave the pond still. After a pause a softer drop falls anyway.
    const last = this.drops.length ? this.drops[this.drops.length - 1].born : -Infinity;
    if (onset || this.time - last > RIPPLE_LULL) {
      this.drops.push({
        born: this.time,
        angle: Math.random() * Math.PI * 2,
        dist: 0.9 + Math.random() * 0.5,
        strength: onset ? Math.min(1.3, 0.45 + frame.bass * 0.9) : 0.3 + frame.energy * 0.6,
      });
      if (this.drops.length > RIPPLE_SLOTS) this.drops.shift();
    }
    this.prevBeat = frame.beat;
    while (this.drops.length && this.time - this.drops[0].born > RIPPLE_LIFE) this.drops.shift();
    this.ripples.fill(0); // unused slots have zero strength
    this.drops.forEach((d, i) => this.ripples.set([d.angle, d.dist, this.time - d.born, d.strength], i * 4));
  }

  /** Cover centre in canvas px, or screen centre when there's no artwork shown. */
  private focusPx(box: DOMRect, scale: number, w: number, h: number) {
    const f = this.layout.focus;
    if (!f) return { x: w / 2, y: h / 2, r: Math.min(w, h) * 0.17 };
    return { x: (f.x - box.left) * scale, y: (f.y - box.top) * scale, r: f.r * scale };
  }

  private rectsPx(box: DOMRect, scale: number): PxRect[] {
    return this.layout.protect.map((r) => ({
      x: (r.x - box.left) * scale,
      y: (r.y - box.top) * scale,
      w: r.w * scale,
      h: r.h * scale,
      strength: r.strength,
    }));
  }
}
