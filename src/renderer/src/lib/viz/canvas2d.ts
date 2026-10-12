import type { AudioFrame, QualityProfile, RGB } from "./types";

export interface PxFocus {
  x: number;
  y: number;
  r: number;
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
}

export interface Canvas2DInput {
  mode: string;
  frame: AudioFrame;
  pal: RGB[];
  focus: PxFocus;
  protect: PxRect[];
  feather: number;
  intensity: number;
  q: QualityProfile;
  time: number;
  dt: number;
  /** Canvas pixels per CSS pixel. */
  px: number;
}

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  spin: number;
  life: number;
  size: number;
}

const rgba = (c: RGB, a: number) =>
  `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${Math.max(0, Math.min(1, a))})`;

/** Colour at position t (wraps) along the palette. */
function palAt(pal: RGB[], t: number): RGB {
  const n = pal.length;
  const x = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const f = x - i;
  const a = pal[i % n];
  const b = pal[(i + 1) % n];
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
}

const lighten = (c: RGB, k: number): RGB => ({
  r: c.r + (255 - c.r) * k,
  g: c.g + (255 - c.g) * k,
  b: c.b + (255 - c.b) * k,
});

/** Averages the 64-bin spectrum down to n bars. */
function resample(src: Float32Array, n: number): number[] {
  const out = new Array<number>(n);
  const step = src.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let s = 0;
    for (let j = a; j < b; j++) s += src[j];
    out[i] = s / (b - a);
  }
  return out;
}

/** Linear read of a spectrum at fractional bin x. */
function specAt(src: Float32Array, x: number): number {
  const k = Math.max(0, Math.min(src.length - 2, Math.floor(x)));
  const t = Math.max(0, Math.min(1, x - k));
  return src[k] + (src[k + 1] - src[k]) * t;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export class Canvas2DRenderer {
  private ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  // Per-mode state; reset() drops it on every mode switch.
  private spiralRot = 0;
  private trail: HTMLCanvasElement | null = null;
  private scopePeak = 0.2;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  reset() {
    this.particles = [];
    this.trail = null;
    this.scopePeak = 0.2;
  }

  resize(scale: number): boolean {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw === 0 || ch === 0) return false;
    const w = Math.floor(cw * scale);
    const h = Math.floor(ch * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }

  clear() {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(i: Canvas2DInput) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    switch (i.mode) {
      case "aurora": this.aurora(ctx, w, h, i); break;
      case "bars": this.bars(ctx, w, h, i); break;
      case "mirror": this.mirror(ctx, w, h, i); break;
      case "wave": this.wave(ctx, w, h, i); break;
      case "radial": this.radial(ctx, i); break;
      case "orb": this.orb(ctx, i); break;
      case "particles": this.drawParticles(ctx, w, h, i); break;
      case "spiral": this.spiral(ctx, i); break;
      case "notes": this.noteBars(ctx, w, h, i); break;
      case "lissajous": this.lissajous(ctx, w, h, i); break;
    }
    ctx.restore();
    this.backOff(ctx, w, h, i);
  }

  private glow(ctx: CanvasRenderingContext2D, i: Canvas2DInput, c: RGB, size: number) {
    if (!i.q.glow) return;
    ctx.shadowColor = rgba(c, 0.55);
    ctx.shadowBlur = size * i.px;
  }

  /**
   * Erases the visualizer behind text and applies overall intensity. Stepped
   * rounded rects approximate a soft falloff far more cheaply than a blur, and
   * compound so the centre reaches exactly (1 - strength).
   */
  private backOff(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    // Enough steps that the falloff doesn't band over flat-coloured shapes.
    const steps = 14;
    for (const r of i.protect) {
      const s = Math.min(0.97, r.strength);
      const a = 1 - Math.pow(1 - s, 1 / steps);
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      for (let k = 0; k < steps; k++) {
        const e = i.feather * (1 - k / (steps - 1));
        ctx.beginPath();
        ctx.roundRect(r.x - e, r.y - e, r.w + e * 2, r.h + e * 2, e + 12 * i.px);
        ctx.fill();
      }
    }
    if (i.intensity < 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - i.intensity})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /** Drifting palette blooms; breathes with overall energy. */
  private aurora(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const f = i.frame;
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 5; k++) {
      const c = i.pal[k % i.pal.length];
      const phase = i.time * (0.1 + k * 0.045) + k * 2.1;
      const x = w * (0.5 + 0.35 * Math.sin(phase));
      const y = h * (0.5 + 0.3 * Math.cos(phase * 0.8 + k));
      const radius = Math.min(w, h) * (0.28 + 0.15 * Math.sin(phase * 1.3)) * (1 + f.energy * 0.6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, rgba(c, 0.13 + f.energy * 0.18 + f.beat * 0.06));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Rounded bars along the bottom, palette-graded, with falling peak caps. */
  private bars(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const n = i.q.bars;
    const vals = resample(i.frame.spec, n);
    const peaks = resample(i.frame.peaks, n);
    const gap = w / n;
    const barW = gap * 0.62;
    const baseY = h * 0.94;
    const maxH = h * 0.5;
    for (let k = 0; k < n; k++) {
      const c = palAt(i.pal, k / n);
      const barH = Math.max(2 * i.px, vals[k] * maxH);
      const x = k * gap + (gap - barW) / 2;
      const g = ctx.createLinearGradient(0, baseY - barH, 0, baseY);
      g.addColorStop(0, rgba(lighten(c, 0.15), 0.95));
      g.addColorStop(1, rgba(c, 0.12));
      ctx.fillStyle = g;
      this.glow(ctx, i, c, 10);
      ctx.beginPath();
      ctx.roundRect(x, baseY - barH, barW, barH, [Math.min(barW / 2, 6 * i.px), Math.min(barW / 2, 6 * i.px), 0, 0]);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(lighten(c, 0.45), 0.85);
      ctx.fillRect(x, baseY - Math.max(2 * i.px, peaks[k] * maxH) - 3 * i.px, barW, 2 * i.px);
    }
  }

  /** Symmetric bars from the vertical centre, fading toward the tips. */
  private mirror(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const n = i.q.bars;
    const vals = resample(i.frame.spec, n);
    const gap = w / n;
    const barW = gap * 0.5;
    const cy = h / 2;
    const maxH = h * 0.34;
    for (let k = 0; k < n; k++) {
      const c = palAt(i.pal, k / n);
      const barH = Math.max(1.5 * i.px, vals[k] * maxH);
      const x = k * gap + (gap - barW) / 2;
      const g = ctx.createLinearGradient(0, cy - barH, 0, cy + barH);
      g.addColorStop(0, rgba(c, 0));
      g.addColorStop(0.5, rgba(lighten(c, 0.2), 0.9));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      this.glow(ctx, i, c, 8);
      ctx.beginPath();
      ctx.roundRect(x, cy - barH, barW, barH * 2, barW / 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  /** Oscilloscope drawn with a palette gradient and a soft glow pass. */
  private wave(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const wave = i.frame.wave;
    const cy = h / 2;
    const amp = h * 0.3;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    i.pal.forEach((c, k) => g.addColorStop(k / (i.pal.length - 1), rgba(c, 1)));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const passes = i.q.glow
      ? [{ width: 14 * i.px, alpha: 0.12 }, { width: 2.5 * i.px, alpha: 0.95 }]
      : [{ width: 2.5 * i.px, alpha: 0.95 }];
    for (const pass of passes) {
      ctx.beginPath();
      for (let k = 0; k < wave.length; k++) {
        const x = (k / (wave.length - 1)) * w;
        const taper = Math.sin((k / (wave.length - 1)) * Math.PI);
        const y = cy + wave[k] * amp * taper;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.globalAlpha = pass.alpha;
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = g;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Spectrum wrapped around the artwork, mirrored so it closes seamlessly. */
  private radial(ctx: CanvasRenderingContext2D, i: Canvas2DInput) {
    const { x: cx, y: cy, r: R } = i.focus;
    const f = i.frame;
    const n = i.q.bars;
    const vals = resample(f.spec, n);
    const count = n * 2;
    const inner = R * (1.04 + f.bass * 0.06 + f.beat * 0.05);
    const maxLen = R * 0.55;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5 * i.px, Math.min(8 * i.px, ((Math.PI * 2 * inner) / count) * 0.5));
    for (let k = 0; k < count; k++) {
      const v = vals[k < n ? k : count - 1 - k];
      const a = (k / count) * Math.PI * 2 - Math.PI / 2 + i.time * 0.05;
      const len = Math.max(2 * i.px, v * maxLen);
      const c = palAt(i.pal, k / count);
      ctx.strokeStyle = rgba(lighten(c, 0.1), 0.55 + v * 0.45);
      this.glow(ctx, i, c, 8);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  /** A soft blob hugging the artwork whose outline follows the spectrum. */
  private orb(ctx: CanvasRenderingContext2D, i: Canvas2DInput) {
    const { x: cx, y: cy, r: R } = i.focus;
    const f = i.frame;
    const base = R * 1.06 * (1 + f.bass * 0.1 + f.beat * 0.06);
    const points = 160;
    ctx.beginPath();
    for (let k = 0; k <= points; k++) {
      const a = (k / points) * Math.PI * 2;
      const idx = Math.floor((Math.abs(Math.PI - a) / Math.PI) * 63);
      const rr = base + f.spec[idx] * R * 0.28 + Math.sin(a * 3 + i.time * 1.4) * base * 0.02;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    // Outline only: a filled interior reads as a flat blob behind the artwork.
    const stroke = ctx.createLinearGradient(cx - base, cy - base, cx + base, cy + base);
    i.pal.forEach((c, k) => stroke.addColorStop(k / (i.pal.length - 1), rgba(lighten(c, 0.2), 1)));
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    // Wide faint pass for the halo, then a crisp core.
    ctx.globalAlpha = 0.14 + f.beat * 0.1;
    ctx.lineWidth = 22 * i.px;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.5 * i.px;
    this.glow(ctx, i, i.pal[0], 16);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /**
   * Motes that spiral outward from the artwork's edge. Stored in polar form
   * relative to the focus, so they follow the cover if the layout shifts.
   */
  private drawParticles(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const { x: cx, y: cy, r: R } = i.focus;
    const f = i.frame;
    const maxR = Math.hypot(w, h) * 0.6;
    const spawn = (p?: Particle): Particle => {
      const q = p ?? ({} as Particle);
      q.angle = Math.random() * Math.PI * 2;
      q.radius = R * (1.02 + Math.random() * 0.08);
      q.speed = (25 + Math.random() * 55) * i.px;
      q.spin = 0.15 + Math.random() * 0.35;
      q.life = 1;
      q.size = (1 + Math.random() * 2.2) * i.px;
      return q;
    };
    while (this.particles.length < i.q.particles) {
      const p = spawn();
      p.life = Math.random(); // stagger so they don't all launch together
      p.radius = R + Math.random() * (maxR - R) * 0.5;
      this.particles.push(p);
    }
    if (this.particles.length > i.q.particles) this.particles.length = i.q.particles;

    const boost = 1 + f.energy * 2.2 + f.beat * 3.5;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      p.radius += p.speed * i.dt * boost;
      p.angle += p.spin * i.dt * (1 + f.energy);
      p.life -= i.dt * 0.25;
      if (p.life <= 0 || p.radius > maxR) spawn(p);
      const c = palAt(i.pal, p.angle / (Math.PI * 2));
      const fadeIn = Math.min(1, (p.radius - R) / (R * 0.3));
      ctx.fillStyle = rgba(lighten(c, 0.2), Math.max(0, p.life) * fadeIn * 0.85);
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(p.angle) * p.radius,
        cy + Math.sin(p.angle) * p.radius,
        p.size * (1 + f.beat * 0.6),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  /** An Archimedean spiral unwinding from the artwork, displaced by the spectrum. */
  private spiral(ctx: CanvasRenderingContext2D, i: Canvas2DInput) {
    const { x: cx, y: cy, r: R } = i.focus;
    const f = i.frame;
    this.spiralRot += i.dt * (0.12 + f.energy * 0.5 + f.beat * 1.2);
    const turns = i.q.bars >= 64 ? 3.5 : 3;
    const gap = R * 0.2;
    const r0 = R * 1.12 * (1 + f.beat * 0.04);
    const n = i.q.bars * 6;
    const total = turns * Math.PI * 2;
    const pts: { x: number; y: number; v: number; t: number }[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const th = t * total;
      const v = specAt(f.spec, t * 56);
      const r = r0 + (th / (Math.PI * 2)) * gap + v * gap * 0.85;
      const a = th + this.spiralRot;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, v, t });
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const seg = 24;
    const passes = i.q.glow ? [8, 1.8] : [1.8];
    for (const width of passes) {
      ctx.lineWidth = width * i.px;
      for (let s0 = 0; s0 < pts.length - 1; s0 += seg) {
        const s1 = Math.min(pts.length - 1, s0 + seg);
        const c = palAt(i.pal, pts[s0].t * 1.5 + i.time * 0.02);
        const fadeOut = 1 - pts[s0].t * 0.55;
        ctx.strokeStyle = rgba(lighten(c, 0.2), (width > 2 ? 0.1 : 0.8) * fadeOut);
        ctx.beginPath();
        ctx.moveTo(pts[s0].x, pts[s0].y);
        for (let k = s0 + 1; k <= s1; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.stroke();
      }
    }
    for (let k = 0; k < pts.length; k += 2) {
      const p = pts[k];
      if (p.v < 0.3) continue;
      ctx.fillStyle = rgba(lighten(palAt(i.pal, p.t * 1.5 + i.time * 0.02), 0.45), p.v);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (1 + p.v * 3) * i.px, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * One bar per semitone (C2–B6), coloured by pitch class so the same note
   * matches across octaves, over a keyboard strip. Notes of the loudest pitch
   * classes brighten, which makes the song's key visible.
   */
  private noteBars(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const f = i.frame;
    const n = f.notes.length;
    const x0 = w * 0.05;
    const gap = (w * 0.9) / n;
    const baseY = h * 0.88;
    const maxH = h * 0.42;
    const px = i.px;
    ctx.font = `${Math.round(10 * px)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let k = 0; k < n; k++) {
      const pc = k % 12;
      const black = BLACK_KEYS.has(pc);
      const lit = f.chroma[pc];
      const v = f.notes[k];
      const c = palAt(i.pal, pc / 12 + i.time * 0.01);
      const barW = gap * (black ? 0.42 : 0.7);
      const x = x0 + k * gap + (gap - barW) / 2;
      const barH = Math.max(2 * px, v * maxH);
      const g = ctx.createLinearGradient(0, baseY - barH, 0, baseY);
      g.addColorStop(0, rgba(lighten(c, 0.15 + lit * 0.3), black ? 0.75 : 0.95));
      g.addColorStop(1, rgba(c, 0.1));
      ctx.fillStyle = g;
      if (v > 0.5) this.glow(ctx, i, c, 10);
      ctx.beginPath();
      const cap = Math.min(barW / 2, 4 * px);
      ctx.roundRect(x, baseY - barH, barW, barH, [cap, cap, 0, 0]);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Keyboard strip.
      ctx.fillStyle = rgba(lighten(c, 0.5), (black ? 0.12 : 0.22) + v * 0.7);
      ctx.beginPath();
      ctx.roundRect(x0 + k * gap + gap * 0.1, baseY + 6 * px, gap * 0.8, (black ? 6 : 10) * px, 2 * px);
      ctx.fill();
      if (pc === 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
        ctx.fillText(`C${2 + k / 12}`, x0 + k * gap + gap / 2, baseY + 20 * px);
      }
    }
  }

  /**
   * Stereo scope wrapped around the artwork. Each sample's mid/side vector is
   * drawn in polar form outside the cover, on a phosphor trail that fades
   * over a fraction of a second. Wide stereo blooms; mono stays narrow.
   */
  private lissajous(ctx: CanvasRenderingContext2D, w: number, h: number, i: Canvas2DInput) {
    const { x: cx, y: cy, r: R } = i.focus;
    const f = i.frame;
    if (!this.trail || this.trail.width !== w || this.trail.height !== h) {
      this.trail = document.createElement("canvas");
      this.trail.width = w;
      this.trail.height = h;
    }
    const t = this.trail.getContext("2d")!;
    t.globalCompositeOperation = "destination-out";
    t.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-i.dt * 10)})`;
    t.fillRect(0, 0, w, h);

    // Normalise to the recent peak so quiet and loud tracks fill the same space.
    const L = f.waveL;
    const Rt = f.waveR;
    let peak = 0;
    for (let k = 0; k < L.length; k++) peak = Math.max(peak, Math.abs(L[k]), Math.abs(Rt[k]));
    if (peak > this.scopePeak) this.scopePeak = peak;
    else this.scopePeak += (peak - this.scopePeak) * (1 - Math.exp(-i.dt / 1.5));
    const norm = 0.9 / Math.max(0.02, this.scopePeak);

    const r0 = R * 1.08 * (1 + f.beat * 0.04);
    const S = R * 0.9;
    const spin = i.time * 0.1;
    t.globalCompositeOperation = "lighter";
    t.lineJoin = "round";
    t.lineCap = "round";
    t.lineWidth = 1.4 * i.px;
    const chunks = 4;
    const per = Math.ceil(L.length / chunks);
    for (let c = 0; c < chunks; c++) {
      // Low alpha: the trail accumulates additively and would otherwise
      // saturate to white wherever the trace overlaps itself.
      t.strokeStyle = rgba(palAt(i.pal, c / chunks + i.time * 0.03), 0.3);
      t.beginPath();
      let prevA = NaN;
      const end = Math.min(L.length - 1, (c + 1) * per);
      for (let k = c * per; k <= end; k++) {
        const mid = (L[k] + Rt[k]) * 0.7071 * norm;
        const side = (Rt[k] - L[k]) * 0.7071 * norm;
        const mag = Math.min(1.4, Math.hypot(mid, side));
        const a = Math.atan2(mid, side) + spin;
        const r = r0 + mag * S;
        const x = cx + Math.cos(a) * r;
        const y = cy - Math.sin(a) * r;
        // Break the line where the angle jumps, or it cuts across the cover.
        let da = Math.abs(a - prevA);
        if (da > Math.PI) da = Math.PI * 2 - da;
        if (da < 0.6) t.lineTo(x, y);
        else t.moveTo(x, y);
        prevA = a;
      }
      t.stroke();
    }
    ctx.drawImage(this.trail, 0, 0);
  }
}
