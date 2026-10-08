import type { RGB } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function parseColor(value: string): RGB {
  const v = value.trim();
  const rgb = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  const hex = v.replace("#", "");
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 224, g: 89, b: 47 };
}

/** Returns [hue 0..360, saturation 0..1, lightness 0..1]. */
export function rgbToHsl(c: RGB): [number, number, number] {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue(hh + 1 / 3) * 255, g: hue(hh) * 255, b: hue(hh - 1 / 3) * 255 };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A harmonious 4-colour palette built around a single accent. */
export function paletteFromAccent(c: RGB): RGB[] {
  const [h, s, l] = rgbToHsl(c);
  if (s < 0.12) {
    // Greyscale accent (e.g. Noir): stay monochrome instead of inventing hues.
    return [
      hslToRgb(h, 0.04, 0.82),
      hslToRgb(h, 0.03, 0.62),
      hslToRgb(h, 0.05, 0.92),
      hslToRgb(h, 0.02, 0.45),
    ];
  }
  const S = clamp(s, 0.5, 0.95);
  const L = clamp(l, 0.5, 0.62);
  return [
    hslToRgb(h, S, L),
    hslToRgb(h + 32, S * 0.95, L + 0.06),
    hslToRgb(h - 40, S * 0.85, L + 0.1),
    hslToRgb(h + 150, S * 0.6, L - 0.04),
  ];
}

/** Artwork is sampled at this square size. Shared with the era-palette bake script. */
export const PALETTE_SAMPLE = 48;

/**
 * Extracts `count` distinct, vivid colours from artwork. Pixels are bucketed by
 * hue and weighted by how vivid they are, so a small bright element can beat a
 * large dull background, which is what reads as "the colour of the cover".
 * Resolves null if the image can't be sampled (e.g. a remote URL without CORS).
 */
export function extractPalette(url: string, count = 4): Promise<RGB[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = PALETTE_SAMPLE;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, size, size);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, size, size).data;
      } catch {
        return resolve(null); // tainted canvas
      }
      resolve(paletteFromPixels(data, count));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The analysis half of extractPalette, on raw RGBA pixels. Kept free of the DOM
 * so artwork that can't be read in the browser can be baked ahead of time with
 * this exact code (see scripts/bake-era-palettes.mjs).
 */
export function paletteFromPixels(data: ArrayLike<number>, count = 4): RGB[] | null {
  const buckets = Array.from({ length: 18 }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
  let satSum = 0;
  let lumSum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    const [h, s, l] = rgbToHsl(c);
    satSum += s;
    lumSum += l;
    n++;
    if (l < 0.08 || l > 0.95) continue;
    const vivid = s * (1 - Math.abs(l - 0.5) * 1.4);
    const w = vivid * vivid + 0.02;
    const bucket = buckets[Math.floor(h / 20) % 18];
    bucket.r += c.r * w;
    bucket.g += c.g * w;
    bucket.b += c.b * w;
    bucket.w += w;
  }
  if (!n) return null;

  // Black & white artwork: a monochrome palette, not a random rainbow.
  if (satSum / n < 0.1) {
    const l = clamp(lumSum / n, 0.4, 0.8);
    return [
      hslToRgb(0, 0, 0.86),
      hslToRgb(0, 0, l),
      hslToRgb(0, 0, 0.66),
      hslToRgb(0, 0, 0.95),
    ];
  }

  const ranked = buckets
    .filter((b) => b.w > 0)
    .sort((a, b) => b.w - a.w)
    .map((b) => ({ r: b.r / b.w, g: b.g / b.w, b: b.b / b.w }));

  const picked: RGB[] = [];
  for (const c of ranked) {
    const hc = rgbToHsl(c)[0];
    if (picked.every((p) => hueDistance(rgbToHsl(p)[0], hc) >= 28)) picked.push(c);
    if (picked.length === count) break;
  }
  if (!picked.length) return null;
  while (picked.length < count) {
    const [h, s, l] = rgbToHsl(picked[0]);
    picked.push(hslToRgb(h + picked.length * 34, s, l));
  }

  // Normalise so every colour glows on a dark background.
  return picked.map((c) => {
    const [h, s, l] = rgbToHsl(c);
    return hslToRgb(h, clamp(s, 0.45, 0.95), clamp(l, 0.5, 0.68));
  });
}
