export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type Quality = "low" | "medium" | "high" | "ultra";

export interface QualityProfile {
  /** Max device-pixel ratio for the 2D canvas. */
  dpr: number;
  /** Fraction of device resolution shaders render at (CSS upscales the rest). */
  glScale: number;
  /** fbm octaves in shaders: the dominant per-pixel cost. */
  octaves: number;
  /** Frame cap; 0 = display refresh rate. */
  fps: number;
  /** Canvas shadowBlur glow: expensive on large canvases. */
  glow: boolean;
  particles: number;
  bars: number;
}

/**
 * Smooth shaders upscale almost invisibly, so resolution is the cheapest and
 * most effective lever: "medium" draws a quarter of the pixels of "ultra".
 */
export const QUALITY: Record<Quality, QualityProfile> = {
  low: { dpr: 0.75, glScale: 0.35, octaves: 3, fps: 30, glow: false, particles: 70, bars: 32 },
  medium: { dpr: 1, glScale: 0.5, octaves: 4, fps: 60, glow: true, particles: 120, bars: 48 },
  high: { dpr: 1.5, glScale: 0.75, octaves: 5, fps: 60, glow: true, particles: 170, bars: 64 },
  ultra: { dpr: 2, glScale: 1, octaves: 6, fps: 0, glow: true, particles: 240, bars: 64 },
};

export interface AudioFrame {
  /** 64 log-spaced bins, 0..1, attack/decay enveloped. */
  spec: Float32Array;
  /** Per-bin falling peak caps. */
  peaks: Float32Array;
  /** Time-domain samples, -1..1. */
  wave: Float32Array;
  /** Per-channel samples for the stereo scope, -1..1. */
  waveL: Float32Array;
  waveR: Float32Array;
  /** Loudness per semitone, C2..B6 (60 notes), 0..1. */
  notes: Float32Array;
  /** Loudness per pitch class C..B summed across octaves, max-normalised. */
  chroma: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  /** 1 on a detected onset, decays toward 0. */
  beat: number;
}

/** Layout geometry in CSS pixels relative to the visualizer's container. */
export interface VizRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1: how strongly the visualizer backs off here. */
  strength: number;
}

export interface VizFocus {
  x: number;
  y: number;
  /** Radius that clears the artwork's corners (half its diagonal). */
  r: number;
}

export interface VizLayout {
  /** What circular modes orbit: the cover, or null for screen centre. */
  focus: VizFocus | null;
  /** Regions holding text the visualizer must not compete with. */
  protect: VizRect[];
  /** Overall strength, 0..1. */
  intensity: number;
}
