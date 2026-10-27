// The cards: the song playing faces forward and the others fan out to each side, each further one smaller, turned
// further away and a little darker; a hovered card grows, turns toward the viewer and comes to the front. Each card is
// a few layers of glass in the page, moved by springs; a card's picture is drawn once and only its transform and
// opacity change as it moves. Unreleased's cards are its queue, so they run in a line - the queue's start at the far
// left, its end at the far right - rather than round a ring.
import './cards.css'
import { Spring, Glide, loop, feel, type Feel } from './spring'

/** The player's sizes, from its size setting (and, on the desktop, how big the display is). */
export interface CardMetrics {
  s: number
  glass: number
  cardWidth: number
  cardInset: number
  captionHeight: number
  cardRadius: number
  coverRadius: number
  coverSide: number
  cardHeight: number
  carouselHeight: number
  width: number
}

export function cardMetrics(s: number, glass = 0.6): CardMetrics {
  const m = { s, glass, cardWidth: 232 * s, cardInset: 9 * s, captionHeight: 66 * s, cardRadius: 24 * s, coverRadius: 16 * s } as CardMetrics
  m.coverSide = m.cardWidth - 2 * m.cardInset
  m.cardHeight = m.cardInset + m.coverSide + m.captionHeight
  m.carouselHeight = m.cardHeight + 44 * s
  m.width = 900 * s
  return m
}

/** The variables the card styles read (cards.css), for the element holding the stage. */
export function metricsStyle(m: CardMetrics): Record<string, string> {
  return {
    '--s': String(m.s), '--glass': String(m.glass),
    '--card-width': `${m.cardWidth}px`, '--card-height': `${m.cardHeight}px`, '--card-inset': `${m.cardInset}px`,
    '--caption-height': `${m.captionHeight}px`, '--card-radius': `${m.cardRadius}px`, '--cover-radius': `${m.coverRadius}px`,
    '--cover-side': `${m.coverSide}px`,
  }
}

export interface Card { key: string; title: string; line: string; image: string | null }

export interface Place { x: number; y: number; scale: number; angle: number; dim: number; z: number; opacity: number }
export interface Entry { card: Card; id: string; offset: number; place: Place; rest: Place }

/** Where one card sits, `offset` places from the middle. */
export function placement(offset: number, hovered: number | null, shown: number, tilt: number, m: CardMetrics): Place {
  const steps = Math.min(Math.abs(offset), 4)
  const side = offset < 0 ? -1 : 1
  const spread = [0, 170, 276, 356, 420], scales = [1, 0.84, 0.72, 0.62, 0.54]
  const angles = [0, 30, 40, 46, 50], dims = [0, 0.12, 0.26, 0.38, 0.5]
  const p: Place = {
    x: side * spread[steps] * m.s, y: 0, scale: scales[steps],
    // Each side card turns to face the middle: its outer edge comes toward the viewer.
    angle: -side * angles[steps] * (0.5 + tilt),
    dim: dims[steps], z: 100 - steps * 10, opacity: Math.abs(offset) > shown ? 0 : 1,
  }
  if (hovered === null || hovered !== offset) return p
  p.scale *= offset === 0 ? 1.03 : 1.1
  p.angle *= 0.45
  p.dim = 0
  p.y = -8 * m.s
  // The outermost shown card grows in place: pushed outward it would pass the edge.
  p.x += offset === 0 || Math.abs(offset) >= shown ? 0 : side * 30 * m.s
  p.z = 200
  return p
}

/** Every card close enough to the middle to be drawn, `focus` being the card in the middle. Cards are told apart by
 *  their keys, so one sliding to a new place stays the same card. */
export function placements(cards: Card[], focus: number, hoveredKey: string | null, sideCards: number, tilt: number, m: CardMetrics): Entry[] {
  const hoveredIndex = hoveredKey ? cards.findIndex((c) => c.key === hoveredKey) : -1
  const hovered = hoveredIndex >= 0 ? hoveredIndex - focus : null
  const out: Entry[] = []
  const from = Math.max(0, focus - sideCards - 1), to = Math.min(cards.length - 1, focus + sideCards + 1)
  for (let index = from; index <= to; index++) {
    const offset = index - focus
    out.push({ card: cards[index], id: cards[index].key, offset, place: placement(offset, hovered, sideCards, tilt, m), rest: placement(offset, null, sideCards, tilt, m) })
  }
  return out
}

// ---- the cards on screen ----------------------------------------------------------------------

const TURN = feel(0.55, 0.16), HOVER = feel(0.34, 0.22), FADE = feel(0.3, 0), FOCUS = feel(0.62, 0.14)
// Folding away to the left, and back.
const FOLD = feel(0.5, 0), UNFOLD = feel(0.62, 0.12)

/** The lyrics with their card: the card at the left, turned a little toward the words and floating, the words close
 *  at its right. */
export const LYRICS_TURN = 16
export function lyricsLayout(m: CardMetrics): { cardX: number; wordsX: number; width: number } {
  const seen = m.cardWidth * Math.cos(LYRICS_TURN * Math.PI / 180), gap = 4 * m.s, width = 380 * m.s
  const left = -(seen + gap + width) / 2
  return { cardX: left + seen / 2, wordsX: left + seen + gap + width / 2, width }
}

function focusPlace(m: CardMetrics): Place {
  return { x: lyricsLayout(m).cardX, y: 0, scale: 1, angle: LYRICS_TURN, dim: 0, z: 300, opacity: 1 }
}

class CardView {
  key: string
  root: HTMLDivElement
  veil: HTMLDivElement
  floater: HTMLDivElement
  leaner: HTMLDivElement
  frost: HTMLDivElement
  face: HTMLDivElement
  glare: HTMLDivElement
  dimLayer: HTMLDivElement
  x = new Spring()
  y = new Spring()
  scale = new Spring(1)
  angle = new Spring()
  opacity = new Spring(1)
  dim = new Spring()
  leanX = new Glide()
  leanY = new Glide()
  glareOn = new Glide()
  glareX = new Glide(0.5)
  glareY = new Glide(0.5)
  receded = false
  floating = false
  z = 0
  faceKey = ''

  constructor(stage: HTMLElement, key: string) {
    this.key = key
    this.root = document.createElement('div')
    this.root.className = 'dk-card'
    this.root.dataset.key = key
    this.root.innerHTML = `<div class="veil"><div class="floater"><div class="leaner"><div class="body"><div class="frost"></div><div class="shade"></div>
      <div class="tint"></div><div class="face"></div><div class="glare"></div><div class="dim"></div></div><div class="rim"></div></div></div></div>`
    const q = <T extends HTMLElement>(c: string): T => this.root.querySelector(c) as T
    this.veil = q('.veil')
    this.floater = q('.floater')
    this.leaner = q('.leaner')
    this.frost = q('.frost')
    this.face = q('.face')
    this.glare = q('.glare')
    this.dimLayer = q('.dim')
    stage.appendChild(this.root)
  }

  /** Its cover and words. */
  show(card: Card, m: CardMetrics): void {
    const faceKey = `${card.title}|${card.line}|${card.image}|${m.s}`
    if (faceKey === this.faceKey) return
    this.faceKey = faceKey
    this.face.replaceChildren()
    if (card.image) {
      const img = document.createElement('img')
      img.className = 'cover'
      img.src = card.image
      img.draggable = false
      img.decoding = 'async'
      img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'cover none' })) }
      this.face.appendChild(img)
    } else {
      this.face.appendChild(Object.assign(document.createElement('div'), { className: 'cover none' }))
    }
    const caption = document.createElement('div')
    caption.className = 'caption'
    caption.append(
      Object.assign(document.createElement('div'), { className: 'title', textContent: card.title }),
      Object.assign(document.createElement('div'), { className: 'line', textContent: card.line }),
    )
    this.face.appendChild(caption)
    this.frost.style.backgroundImage = card.image ? `url("${card.image.replace(/"/g, '%22')}")` : ''
    this.frost.classList.toggle('plain', !card.image)
  }

  place(p: Place, spring: Feel | null): void {
    if (this.z !== p.z) { this.z = p.z; this.root.style.zIndex = String(p.z) }
    this.x.to(p.x, spring)
    this.y.to(p.y, spring)
    this.scale.to(p.scale, spring)
    this.angle.to(p.angle, spring)
    this.opacity.to(p.opacity, spring)
    this.dim.to(p.dim, spring)
  }

  /** Leans toward the pointer and lights the glass where it points; null stands straight. */
  lean(spot: { x: number; y: number } | null): void {
    if (spot) {
      this.leanX.to(spot.x * 6)
      this.leanY.to(spot.y * 6)
      this.glareX.to((spot.x + 1) / 2)
      this.glareY.to((spot.y + 1) / 2)
      if (this.glareOn.target !== 1) this.glareOn.to(1, 0.25)
    } else {
      this.leanX.to(0, 0.45)
      this.leanY.to(0, 0.45)
      this.glareOn.to(0, 0.45)
    }
  }

  /** Steps back into the distance and fades, or comes forward again, after `delay` seconds. */
  recede(away: boolean, delay: number, animated: boolean): void {
    if (away === this.receded) return
    this.receded = away
    const to = away ? { transform: 'scale(0.78)', opacity: '0' } : { transform: 'scale(1)', opacity: '1' }
    if (!animated) { this.veil.getAnimations().forEach((a) => a.cancel()); Object.assign(this.veil.style, to); return }
    const from = getComputedStyle(this.veil)
    const start = { transform: from.transform === 'none' ? 'scale(1)' : from.transform, opacity: from.opacity }
    Object.assign(this.veil.style, to)
    this.veil.animate([start, to], away
      ? { duration: 360, delay: delay * 1000, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'backwards' }
      : { duration: 600, delay: delay * 1000, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.08)', fill: 'backwards' })
  }

  /** Floating beside the lyrics: a slow rise and fall, the compositor's own animation (cards.css .floating), nothing
   *  for the page to do each frame. Stopped, it settles back from wherever it was. */
  float(on: boolean): void {
    if (on === this.floating) return
    this.floating = on
    if (on) { this.root.classList.add('floating'); return }
    const was = getComputedStyle(this.floater).transform
    this.root.classList.remove('floating')
    if (was && was !== 'none') this.floater.animate([{ transform: was }, { transform: 'none' }], { duration: 400, easing: 'ease-out' })
  }

  tick(dt: number, depth: number): boolean {
    let busy = false
    for (const s of [this.x, this.y, this.scale, this.angle, this.opacity, this.dim, this.leanX, this.leanY, this.glareOn, this.glareX, this.glareY]) if (s.step(dt)) busy = true
    this.root.style.transform = `translate(${this.x.value}px, ${this.y.value}px) perspective(${depth}px) rotateY(${this.angle.value}deg) scale(${this.scale.value})`
    this.root.style.opacity = String(Math.max(0, Math.min(1, this.opacity.value)))
    this.dimLayer.style.opacity = String(Math.max(0, this.dim.value))
    this.leaner.style.transform = `perspective(${depth}px) rotateY(${this.leanX.value}deg) rotateX(${-this.leanY.value}deg)`
    this.glare.style.opacity = String(this.glareOn.value)
    this.glare.style.background = `radial-gradient(circle at ${this.glareX.value * 100}% ${this.glareY.value * 100}%, rgba(255,255,255,0.18), rgba(255,255,255,0) 75%)`
    return busy
  }
}

export interface StackShow {
  m: CardMetrics
  /** Changes whenever the middle card does, so the cards glide rather than hover-spring to their places. */
  turn: number
  hoveredKey: string | null
  /** Every card stepped back, out of the way (search over the player). */
  receded?: boolean
  /** The card standing beside the lyrics, and whether it floats or is folded away. */
  focusedKey?: string | null
  floating?: boolean
  folded?: boolean
}

export class CardStack {
  stage: HTMLElement
  layers = new Map<string, CardView>()
  leaving = new Set<string>()
  lastTurn: number | null = null
  receded = false
  folded = false
  foldTurn = 0
  focusedID: string | null = null
  leanedID: string | null = null
  m: CardMetrics | null = null

  constructor(stage: HTMLElement) {
    this.stage = stage
    loop.add(this)
  }

  depth(): number { return Math.max(this.m!.cardWidth, this.m!.cardHeight) / 0.55 }

  show(cards: Entry[], { m, turn, hoveredKey, receded = false, focusedKey = null, floating = false, folded = false }: StackShow): void {
    this.m = m
    // The card beside the lyrics folded away: at the far left, turned edge-on as if closing against it, gone;
    // unfolding, it springs back out beside the words.
    const folding = folded !== this.folded
    this.folded = folded
    if (folding) this.foldTurn++
    const foldTurn = this.foldTurn
    const foldedPlace = (entry: Entry): Place => ({ ...entry.place, x: -m.width / 2 + m.cardWidth * 0.32, scale: 0.8, angle: 82, opacity: 0 })
    const turned = this.lastTurn !== turn
    this.lastTurn = turn
    const focused = focusedKey == null ? null : cards.find((c) => c.card.key === focusedKey)?.id ?? null
    const refocused = focused !== this.focusedID
    this.focusedID = focused
    const spring = refocused ? FOCUS : turned ? TURN : HOVER
    // Stepped away: everything while search shows, and all but the card beside the lyrics.
    const away = (entry: Entry): boolean => entry.id !== focused && (receded || focused != null)
    const ids = new Set(cards.map((c) => c.id))
    const fresh = this.layers.size === 0

    for (const entry of cards) {
      let view = this.layers.get(entry.id)
      const existing = Boolean(view)
      if (!view) {
        view = new CardView(this.stage, entry.card.key)
        this.layers.set(entry.id, view)
        view.recede(away(entry) || fresh, 0, false)
      }
      this.leaving.delete(entry.id)
      view.show(entry.card, m)
      if (!existing && !fresh) {
        // New to a line already there: it arrives from its own side.
        view.place({ ...entry.place, x: entry.place.x + (entry.offset < 0 ? -170 : 170) * m.s, opacity: 0 }, null)
      }
      const target = entry.id === focused ? (folded ? foldedPlace(entry) : focusPlace(m)) : entry.place
      if (folding && existing && entry.id === focused) {
        const moving = view
        requestAnimationFrame(() => { if (this.foldTurn === foldTurn) moving.place(target, folded ? FOLD : UNFOLD) })
      } else {
        view.place(target, fresh && !existing ? null : spring)
      }
      view.float(entry.id === focused && floating)
    }
    if (fresh) for (const entry of cards) if (!away(entry)) this.layers.get(entry.id)?.recede(false, Math.abs(entry.offset) * 0.06, true)

    // Search or the lyrics opened or closed: the cards step back from the outside in, and come back from the middle out.
    this.receded = receded
    const farthest = Math.max(0, ...cards.map((c) => Math.abs(c.offset)))
    for (const entry of cards) {
      const view = this.layers.get(entry.id)
      if (!view || view.receded === away(entry)) continue
      const rank = away(entry) ? farthest - Math.abs(entry.offset) : Math.abs(entry.offset)
      view.recede(away(entry), rank * 0.06, true)
    }

    for (const [id, view] of this.layers) {
      if (ids.has(id) || this.leaving.has(id)) continue
      this.leaving.add(id)
      view.opacity.to(0, FADE)
      window.setTimeout(() => {
        if (!this.leaving.has(id)) return
        this.leaving.delete(id)
        view.root.remove()
        this.layers.delete(id)
      }, 450)
    }

    if (this.leanedID && !cards.some((c) => c.id === this.leanedID && c.card.key === hoveredKey)) {
      this.layers.get(this.leanedID)?.lean(null)
      this.leanedID = null
    }
    loop.wake()
  }

  lean(key: string | null, spot: { x: number; y: number } | null): void {
    let id: string | null = null
    if (key) for (const [cardID, view] of this.layers) if (view.key === key && !this.leaving.has(cardID)) id = cardID
    if (this.leanedID && this.leanedID !== id) this.layers.get(this.leanedID)?.lean(null)
    this.leanedID = id
    if (id) this.layers.get(id)?.lean(spot)
  }

  /** The card under a point in the page, front-most first, with where on it: -1...1 across and down. */
  hit(x: number, y: number): { key: string; spot: { x: number; y: number } } | null {
    let best: { view: CardView; r: DOMRect } | null = null
    for (const [id, view] of this.layers) {
      if (this.leaving.has(id) || view.opacity.target < 0.5 || view.receded) continue
      const r = view.root.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      if (!best || view.z > best.view.z) best = { view, r }
    }
    if (!best) return null
    const { view, r } = best
    return {
      key: view.key,
      spot: { x: Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width / 2))), y: Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / (r.height / 2))) },
    }
  }

  tick(dt: number): boolean {
    if (!this.m) return false
    const depth = this.depth()
    let busy = false
    for (const view of this.layers.values()) if (view.tick(dt, depth)) busy = true
    return busy
  }

  destroy(): void {
    loop.remove(this)
    for (const view of this.layers.values()) view.root.remove()
    this.layers.clear()
  }
}
