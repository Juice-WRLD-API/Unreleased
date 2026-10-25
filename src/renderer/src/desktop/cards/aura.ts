// Life around the card of the song playing: a soft glow of the artwork's color breathing behind it, and small sparks
// drifting off its edges, rising and fading like embers. On every beat the glow flares and the sparks swell. The
// breath and the drift are the compositor's animations; the page only listens for beats, 20 times a second, and only
// while the aura shows.
import { BeatFollower, hsbToRgb, type HSB, type LightStyle, type Meter, type RGB } from '../light/engine'

export const MARGIN = 44
const SPARKS = 26
const css = (rgb: RGB, alpha = 1): string => `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, ${alpha})`
const random = (a: number, b: number): number => a + Math.random() * (b - a)

interface Box { x: number; y: number; width: number; height: number; radius: number }

export class Aura {
  host: HTMLElement
  meter: () => Meter
  style: () => Pick<LightStyle, 'sensitivity' | 'smoothness' | 'reaction'>
  active = false
  key = ''
  beat = new BeatFollower()
  wasKicking = false
  timer = 0
  stage: HTMLDivElement
  glow: HTMLDivElement
  breath: HTMLDivElement
  flareLayer: HTMLDivElement
  sparks: HTMLDivElement
  dots: HTMLDivElement[] = []
  card: Box = { x: 0, y: 0, width: 0, height: 0, radius: 0 }

  constructor(host: HTMLElement, { meter, style }: { meter: () => Meter; style: Aura['style'] }) {
    this.host = host
    this.meter = meter
    this.style = style
    host.innerHTML = '<div class="aura-stage"><div class="aura-glow"><div class="aura-breath"></div><div class="aura-flare"></div></div><div class="aura-sparks"></div></div>'
    const q = <T extends HTMLElement>(c: string): T => host.querySelector(c) as T
    this.stage = q('.aura-stage')
    this.glow = q('.aura-glow')
    this.breath = q('.aura-breath')
    this.flareLayer = q('.aura-flare')
    this.sparks = q('.aura-sparks')
    this.stage.style.opacity = '0'
  }

  /** colors: two HSB; card: its size in page pixels. */
  update(colors: [HSB, HSB], active: boolean, card: { width: number; height: number; radius: number }): void {
    const key = JSON.stringify([colors, card])
    if (key !== this.key) { this.key = key; this.build(colors, card); if (this.active) this.animate() }
    if (active !== this.active) { this.active = active; if (active) this.start(); else this.stop() }
  }

  build(colors: [HSB, HSB], card: { width: number; height: number; radius: number }): void {
    const [first, second] = colors.map(hsbToRgb)
    const w = card.width + 2 * MARGIN, h = card.height + 2 * MARGIN
    Object.assign(this.host.style, { width: `${w}px`, height: `${h}px` })
    for (const layer of [this.breath, this.flareLayer]) {
      Object.assign(layer.style, { left: `${MARGIN + 10}px`, top: `${MARGIN + 10}px`, width: `${card.width - 20}px`, height: `${card.height - 20}px`,
        borderRadius: `${card.radius}px`, background: css(first, 0.9), boxShadow: `0 0 44px 12px ${css(first, 0.95)}`, filter: 'blur(14px)' })
    }
    const white: RGB = [first[0] * 0.55 + 0.45, first[1] * 0.55 + 0.45, first[2] * 0.55 + 0.45]
    const tints = [first, second, white]
    this.sparks.replaceChildren()
    this.dots = []
    for (let i = 0; i < SPARKS; i++) {
      const dot = document.createElement('div')
      const side = random(2.2, 4.6) * 2.4
      const tint = tints[i % tints.length]
      Object.assign(dot.style, { width: `${side}px`, height: `${side}px`, marginLeft: `${-side / 2}px`, marginTop: `${-side / 2}px`,
        background: `radial-gradient(circle, #fff 0%, ${css(tint, 0.85)} 30%, ${css(tint, 0)} 70%)` })
      dot.className = 'spark'
      this.sparks.appendChild(dot)
      this.dots.push(dot)
    }
    this.card = { x: MARGIN, y: MARGIN, width: card.width, height: card.height, radius: card.radius }
  }

  start(): void {
    this.animate()
    void this.fade(1, 800)
    window.clearInterval(this.timer)
    let last = performance.now()
    this.timer = window.setInterval(() => {
      const now = performance.now()
      const style = this.style()
      this.beat.follow(this.meter().punch || 0, style, Math.min((now - last) / 1000, 0.3))
      last = now
      const kicking = this.beat.kick > 0.45
      if (kicking && !this.wasKicking) this.flare(Math.min(this.beat.kick, 1) * (style.reaction ?? 0.6))
      this.wasKicking = kicking
    }, 50)
  }

  /** Quick, so the glow is gone before the card in front of it steps away. */
  stop(): void {
    window.clearInterval(this.timer)
    this.timer = 0
    this.beat = new BeatFollower()
    void this.fade(0, 250).then(() => {
      if (this.active) return
      for (const el of [this.breath, ...this.dots]) el.getAnimations().forEach((a) => a.cancel())
    })
  }

  destroy(): void {
    window.clearInterval(this.timer)
    this.host.replaceChildren()
  }

  fade(opacity: number, duration: number): Promise<unknown> {
    const from = getComputedStyle(this.stage).opacity
    this.stage.style.opacity = String(opacity)
    return this.stage.animate([{ opacity: from }, { opacity }], { duration, easing: opacity > 0 ? 'ease-out' : 'ease-in' }).finished.catch(() => {})
  }

  /** The breath and every spark's endless drift, each on its own path and pace. */
  animate(): void {
    this.breath.getAnimations().forEach((a) => a.cancel())
    this.breath.animate([{ opacity: 0.3 }, { opacity: 0.55 }], { duration: 3200, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
    for (const dot of this.dots) {
      dot.getAnimations().forEach((a) => a.cancel())
      const [start, out] = this.edgePoint()
      const distance = random(14, 34), rise = random(4, 16), sway = random(-6, 6)
      // y grows downward here: rising is negative.
      const end = { x: start.x + out.x * distance + sway, y: start.y + out.y * distance - rise }
      const mid = { x: (start.x + end.x) / 2 - out.y * sway, y: (start.y + end.y) / 2 + out.x * sway }
      const at = (t: number): { x: number; y: number } => ({
        x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * mid.x + t * t * end.x,
        y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * mid.y + t * t * end.y,
      })
      const frames = [0, 0.15, 0.2, 0.6, 1].map((t) => {
        const p = at(t)
        const scale = t < 0.2 ? 0.5 + (t / 0.2) * 0.5 : 1 - ((t - 0.2) / 0.8) * 0.65
        const opacity = t < 0.15 ? (t / 0.15) * 0.95 : t < 0.6 ? 0.95 - ((t - 0.15) / 0.45) * 0.25 : 0.7 - ((t - 0.6) / 0.4) * 0.7
        return { offset: t, transform: `translate(${p.x}px, ${p.y}px) scale(${scale})`, opacity }
      })
      dot.animate(frames, { duration: random(1900, 3200), delay: random(0, 3000), iterations: Infinity, fill: 'backwards' })
    }
  }

  /** A random point along the rounded card's edge and the outward direction there. */
  edgePoint(): [{ x: number; y: number }, { x: number; y: number }] {
    const c = this.card, r = c.radius
    const sx = c.width - 2 * r, sy = c.height - 2 * r, corner = r * Math.PI / 2
    let s = Math.random() * (2 * sx + 2 * sy + 4 * corner)
    if (s < sx) return [{ x: c.x + r + s, y: c.y }, { x: 0, y: -1 }]
    s -= sx
    if (s < sx) return [{ x: c.x + r + s, y: c.y + c.height }, { x: 0, y: 1 }]
    s -= sx
    if (s < sy) return [{ x: c.x, y: c.y + r + s }, { x: -1, y: 0 }]
    s -= sy
    if (s < sy) return [{ x: c.x + c.width, y: c.y + r + s }, { x: 1, y: 0 }]
    s -= sy
    const index = Math.floor(s / corner) % 4
    const angle = ((s % corner) / corner) * Math.PI / 2
    const centers = [{ x: c.x + c.width - r, y: c.y + r }, { x: c.x + r, y: c.y + r }, { x: c.x + r, y: c.y + c.height - r }, { x: c.x + c.width - r, y: c.y + c.height - r }]
    const base = index * Math.PI / 2
    const d = { x: Math.cos(base + angle), y: -Math.sin(base + angle) }
    const center = centers[index]
    return [{ x: center.x + d.x * r, y: center.y + d.y * r }, d]
  }

  flare(strength: number): void {
    if (strength <= 0.05) return
    this.glow.animate([{ transform: 'scale(1)' }, { transform: `scale(${1 + 0.035 * strength})`, offset: 0.25 }, { transform: 'scale(1)' }], { duration: 450 })
    this.flareLayer.animate([{ opacity: 0 }, { opacity: 0.4 * strength, offset: 0.2 }, { opacity: 0 }], { duration: 450 })
    this.sparks.animate([{ transform: 'scale(1)' }, { transform: `scale(${1 + 0.05 * strength})`, offset: 0.25 }, { transform: 'scale(1)' }], { duration: 500 })
  }
}
