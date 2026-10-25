// Setting type for the lyric styles: measuring a face, matching faces to one another, words drawn once into canvases
// with their glow baked in (so nothing is blurred or shadowed while it moves), and words wrapped into rows.
import { faceCSS, STANDARD_FACE } from './looks'

export type RGB = [number, number, number]

let penCanvas: CanvasRenderingContext2D | null = null
function pen(): CanvasRenderingContext2D {
  penCanvas ??= document.createElement('canvas').getContext('2d')!
  return penCanvas
}

export const cssColor = (rgb: readonly number[], a = 1): string => `rgba(${rgb.map((v) => Math.round(v * 255)).join(', ')}, ${a})`

/** A number 0..<1 that's always the same for `seed`. */
export function chance(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** The easing of a spring (response, damping fraction) sampled into a CSS linear(), and how long it takes to settle. */
export function spring(response = 0.6, damping = 0.86): { easing: string; duration: number } {
  const w = (2 * Math.PI) / response, z = damping, wd = w * Math.sqrt(1 - z * z)
  const at = (t: number): number => 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
  let settle = 0.1
  while (settle < 3 && Math.abs(1 - at(settle)) > 0.001) settle += 0.02
  const points = Array.from({ length: 41 }, (_, i) => at((i / 40) * settle).toFixed(4))
  return { easing: `linear(${points.join(', ')})`, duration: settle }
}

export interface FaceMetrics { ascent: number; descent: number; cap: number }

export function metricsOf(key: string, size: number): FaceMetrics {
  const g = pen()
  g.font = faceCSS(key, size)
  const m = g.measureText('HXg')
  const cap = g.measureText('H').actualBoundingBoxAscent
  return { ascent: m.fontBoundingBoxAscent || size * 0.9, descent: m.fontBoundingBoxDescent || size * 0.25, cap: cap || size * 0.7 }
}

/** Every face is set so its capitals stand as tall as the standard's, so switching faces doesn't make words jump. */
export function matchedSize(key: string, size: number): number {
  const reference = metricsOf(STANDARD_FACE, 100).cap, own = metricsOf(key, 100).cap
  return reference > 0 && own > 0 ? size * Math.min(Math.max(reference / own, 0.6), 1.8) : size
}

/** How wide `text` stands in face `key` at `size`. */
export function measure(text: string, key: string, size: number): number {
  const g = pen()
  g.font = faceCSS(key, size)
  g.letterSpacing = '0px'
  return g.measureText(text).width
}

/** How wide `text` stands in a CSS font, with `kern` between letters. */
export function width(text: string, font: string, kern = 0): number {
  const g = pen()
  g.font = font
  g.letterSpacing = `${kern}px`
  return g.measureText(text).width
}

export interface Glow { color: string; radius: number }
export interface Picture { el: HTMLCanvasElement; w: number; h: number; pad: number }

/** Words drawn once into a canvas, with any glow baked in. `font` is a CSS font; sizes in CSS pixels. Returns the
 *  canvas, its size and the margin round the letters. */
export function ink(text: string, font: string, color: string, { stroke = 0, glows = [], blur = 0, kern = 0, margin, detail = 1 }: {
  stroke?: number
  glows?: Glow[]
  blur?: number
  kern?: number
  margin?: number
  detail?: number
} = {}): Picture {
  const p = pen()
  p.font = font
  p.letterSpacing = `${kern}px`
  const m = p.measureText(text)
  const ascent = m.fontBoundingBoxAscent, descent = m.fontBoundingBoxDescent
  const size = parseFloat(font.match(/([\d.]+)px/)?.[1] || '20')
  const reach = Math.max(0, ...glows.map((g) => g.radius), blur) * 1.6 + stroke
  const pad = Math.ceil(margin ?? Math.max(reach, 0.12 * size))
  const w = Math.ceil(m.width + 2 * pad), h = Math.ceil(ascent + descent + 2 * pad)
  const scale = Math.min(window.devicePixelRatio || 1, 2) * detail
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(w * scale))
  canvas.height = Math.max(1, Math.ceil(h * scale))
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const g = canvas.getContext('2d')!
  g.scale(scale, scale)
  g.font = font
  g.letterSpacing = `${kern}px`
  g.textBaseline = 'alphabetic'
  const x = pad, y = pad + ascent
  const away = w * 4
  const letters = (dx: number, paint: string): void => {
    if (stroke > 0) { g.lineWidth = stroke; g.lineJoin = 'round'; g.strokeStyle = paint; g.strokeText(text, x + dx, y) }
    else { g.fillStyle = paint; g.fillText(text, x + dx, y) }
  }
  // Each glow is the shadow of letters set far off the canvas, so only the glow lands on it. Shadows are in pixels.
  for (const glow of glows) {
    g.save()
    g.shadowColor = glow.color
    g.shadowBlur = glow.radius * scale
    g.shadowOffsetX = -away * scale
    letters(away, glow.color)
    g.restore()
  }
  if (blur > 0) {
    g.shadowColor = color
    g.shadowBlur = blur * scale
    g.shadowOffsetX = -away * scale
    letters(away, color)
  } else letters(0, color)
  return { el: canvas, w, h, pad }
}

export interface Wrapped { places: { row: number; x: number; width: number }[]; rows: number[] }

/** Where each word goes when the words wrap within `room`: its row, how far across it starts and its width; and
 *  each row's width. */
export function wrap(words: string[], font: string, room: number, kern = 0, space: number | null = null): Wrapped {
  const gap = space ?? width(' ', font, kern) + kern
  const places: Wrapped['places'] = []
  const rows = [0]
  for (const word of words) {
    const length = width(word, font, kern)
    let used = rows[rows.length - 1]
    if (used > 0 && used + gap + length > room) { rows.push(0); used = 0 }
    const x = used > 0 ? used + gap : 0
    places.push({ row: rows.length - 1, x, width: length })
    rows[rows.length - 1] = x + length
  }
  return { places, rows }
}
