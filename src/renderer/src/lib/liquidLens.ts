// Liquid glass refraction for the floating chrome (the player bar and the pill
// nav). A pane's rim bends what is behind it, the way a slab of glass with a
// rounded edge does, while its middle stays frosted.
//
// How: a displacement map shaped like the pane (a rounded rectangle) goes into
// an SVG filter, and the pane's ::before uses it as its backdrop-filter
// (`url(#id)`). Red/green hold the sideways shift (128 = none), strongest at
// the edge and fading to nothing a bezel's width in; blue marks the middle,
// where the filter swaps in a heavier blur so text on the pane stays readable.
//
// Only Chromium draws SVG filters in backdrop-filter. Safari and Firefox accept
// the syntax and draw nothing, which would leave the pane bare, so the lens is
// only offered on Chromium and the plain .glass-backdrop blur stays the rest.

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFS_ID = 'liquid-lens-defs'

export const LENS_SUPPORTED: boolean = (() => {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands
  if (brands?.some((b) => /Chromium/i.test(b.brand))) return true
  // Builds without userAgentData. Chrome on iOS says CriOS (it is WebKit).
  return /\bChrome\/\d+/.test(navigator.userAgent)
})()

export interface LensOptions {
  /** Width of the bent rim in px. Clamped to the corner radius. */
  bezel: number
  /** How far the very edge pulls the backdrop inward, in px. */
  strength: number
  /** Blur in the middle of the pane (stdDeviation, px). */
  coreBlur: number
  /** A light softening on the bent rim, so it reads as glass, not a mirror. */
  rimBlur?: number
}

export interface LensShape {
  width: number
  height: number
  radius: number
}

// Map resolution: the filter stretches the map over the pane, and the shift
// varies smoothly, so half size is plenty. Capped so a wide bar stays cheap
// (one pass over ~25k pixels, a couple of ms).
const MAP_SCALE = 0.5
const MAP_MAX = 640

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The displacement map for a rounded rectangle, as a PNG data URL. */
export function buildLensMap(shape: LensShape, bezelPx: number): string {
  const { width: w, height: h } = shape
  const r = Math.min(shape.radius, w / 2, h / 2)
  const bezel = Math.max(1, Math.min(bezelPx, r))
  const scale = Math.min(MAP_SCALE, MAP_MAX / Math.max(w, h))
  const cw = Math.max(2, Math.round(w * scale))
  const ch = Math.max(2, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(cw, ch)
  const px = img.data
  const hx = w / 2 - r
  const hy = h / 2 - r
  for (let y = 0; y < ch; y++) {
    const py = ((y + 0.5) / ch) * h - h / 2
    for (let x = 0; x < cw; x++) {
      const pxl = ((x + 0.5) / cw) * w - w / 2
      // Signed distance to the rounded rectangle (negative inside).
      const qx = Math.abs(pxl) - hx
      const qy = Math.abs(py) - hy
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const len = Math.hypot(ox, oy)
      const d = len + Math.min(Math.max(qx, qy), 0) - r
      const inset = -d // distance in from the edge
      // Outward normal of the nearest edge.
      let nx = 0
      let ny = 0
      if (len > 0) { nx = (ox / len) * Math.sign(pxl); ny = (oy / len) * Math.sign(py) }
      else if (qx > qy) nx = Math.sign(pxl)
      else ny = Math.sign(py)
      // A convex rim: the slope (and so the bend) is steepest at the edge and
      // eases out to flat glass a bezel's width in.
      const e = inset >= 0 && inset < bezel ? 1 - inset / bezel : 0
      const mag = e * e * (1.6 - 0.6 * e) // ~e^1.6, without pow in the loop
      const i = (y * cw + x) * 4
      // Shift inward: the edge shows backdrop from nearer the middle, so the
      // content under the rim looks magnified and curved.
      px[i] = Math.round(128 - nx * mag * 127)
      px[i + 1] = Math.round(128 - ny * mag * 127)
      px[i + 2] = Math.round(smoothstep(bezel * 0.35, bezel * 1.05, inset) * 255)
      px[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

function defsRoot(): SVGSVGElement {
  let svg = document.getElementById(DEFS_ID) as SVGSVGElement | null
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg')
    svg.id = DEFS_ID
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    // Out of layout and hit testing; display:none would drop the filters.
    svg.classList.add('liquid-lens-defs')
    document.body.appendChild(svg)
  }
  return svg
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const n = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  return n
}

/** Creates or replaces the filter `id` for a pane of this shape. */
export function setLens(id: string, shape: LensShape, opts: LensOptions): void {
  const href = buildLensMap(shape, opts.bezel)
  if (!href) return
  // The map's 128 is 128/255, half a step past 0.5: at a 40px scale that is a
  // 0.08px drift, far below anything visible under the blur, so no correction.
  const filter = el('filter', {
    id,
    x: 0, y: 0, width: '100%', height: '100%',
    // Values in the map are shifts, not colors: keep them out of linear RGB.
    'color-interpolation-filters': 'sRGB',
  })
  filter.append(
    el('feImage', { href, x: 0, y: 0, preserveAspectRatio: 'none', result: 'map' }),
    el('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'map', scale: opts.strength * 2,
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent',
    }),
    el('feGaussianBlur', { in: 'bent', stdDeviation: opts.rimBlur ?? 1.5, edgeMode: 'duplicate', result: 'rim' }),
    el('feGaussianBlur', { in: 'bent', stdDeviation: opts.coreBlur, edgeMode: 'duplicate', result: 'soft' }),
    // Blue → alpha: the middle of the pane.
    el('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'middle' }),
    el('feComposite', { in: 'soft', in2: 'middle', operator: 'in', result: 'core' }),
    el('feComposite', { in: 'core', in2: 'rim', operator: 'over' }),
  )
  const root = defsRoot()
  const old = document.getElementById(id)
  if (old && root.contains(old)) old.replaceWith(filter)
  else root.appendChild(filter)
}

export function removeLens(id: string): void {
  document.getElementById(id)?.remove()
}
