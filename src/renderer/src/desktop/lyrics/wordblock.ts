// The lyrics set the way a lyric edit sets them: each phrase as a small stack of big type in the song's own colors,
// centered and bulging toward the viewer as through a fisheye lens, filled in word by word exactly as the words are
// sung - nothing ever shifting - and, when the next phrase begins, shattered: its words break into shards that fly
// off toward the viewer. Most words rise into place out of a blur; others are cut in by hand: a phrase's last word
// slams in and shakes the frame; some flip up like cards, open like blinds, pour in letter by letter, whip in from
// the side or fly back out of the lens; some come in the second color or as outlines. Adlibs drift up beside the stack.
//
// The bulge is real 3D: each word is cut into narrow upright strips, and every strip is laid on a sphere and turned
// to face out from it - which is also what lets a word shatter, flip, or open like blinds. Points are kept from the
// block's middle, y up, and turned into the page's y-down only at the transform.
import { hsbToRgb, type AlbumColors } from '../light/engine'
import { faceCSS, STANDARD_FACE } from './looks'
import { cssColor, matchedSize, measure, metricsOf, type RGB } from './type'
import { InterludeMark } from './interlude'
import { AHEAD, LEAD, clockTime, type LyricRenderer, type StageClock, type StageLook, type StageSong } from './scene'
import type { TimedLyrics, TimedWord } from './timing'

const MOST = 4          // rows in one block at most; a longer phrase runs on into another
const SLACK = 1.5       // a step back this small is the clock being corrected, not a jump

// ---- how each word comes in ----

const LITTLE = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'but', 'i', 'im', "i'm", 'i’m', 'you', 'me',
  'my', 'it', 'is', 'be', 'we', 'so', 'for', 'with', 'that', 'this', 'just', 'like', 'oh', 'yeah', 'uh'])

type Entrance = 'rise' | 'slam' | 'pour' | 'whip' | 'flip' | 'blinds' | 'zoom'
interface WordStyle { entrance: Entrance; accent: boolean; outline: boolean }

const MASK = (1n << 64n) - 1n

/** How a word comes in and how it's inked, as an editor would pick: the same word in the same place always gets the same. */
function pickStyle(word: string, index: number, count: number, position: number): WordStyle {
  let seed = 1469598103934665603n
  for (const byte of new TextEncoder().encode(`${position}:${word}`)) seed = ((seed ^ BigInt(byte)) * 1099511628211n) & MASK
  const next = (): number => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK; return Number((seed >> 33n) & 0xFFFFFFn) / 0xFFFFFF }
  const letters = [...word].filter((c) => /\p{L}/u.test(c)).length
  const little = LITTLE.has(word.toLowerCase().replace(/^[\p{P}]+|[\p{P}]+$/gu, ''))
  const last = index === count - 1 && count > 1
  if (last && !little) return { entrance: 'slam', accent: next() < 0.35, outline: false }
  if (little || letters < 3) return { entrance: next() < 0.3 ? 'flip' : 'rise', accent: false, outline: false }
  const roll = next()
  const entrance: Entrance = roll < 0.16 ? (letters >= 5 ? 'pour' : 'flip') : roll < 0.3 ? 'flip' : roll < 0.4 ? (letters >= 4 ? 'blinds' : 'rise')
    : roll < 0.5 ? 'whip' : roll < 0.6 ? 'zoom' : 'rise'
  const paint = next()
  return { entrance, accent: paint < 0.24, outline: paint > 0.9 && letters >= 4 }
}

interface Palette { main: RGB; second: RGB }

/** The type's two colors from the song's artwork, each lifted until it reads over a dark picture; grey artwork gets
 *  warm white and the edit's golden yellow. */
function paletteOf(colors: AlbumColors | null): Palette {
  if (!colors) return { main: [0.97, 0.95, 0.9], second: [0.96, 0.8, 0.37] }
  const legible = (c: AlbumColors['primary'], extra = 0): RGB => {
    const rgb = hsbToRgb({ hue: c.hue, saturation: Math.min(c.saturation, 0.9), brightness: 1 })
    const light = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    const whiten = Math.max(extra, light < 0.5 ? (0.5 - light) * 1.1 : 0)
    return rgb.map((v) => v + (1 - v) * whiten) as RGB
  }
  const apart = Math.abs(colors.primary.hue - colors.secondary.hue)
  return { main: legible(colors.primary), second: Math.min(apart, 1 - apart) > 0.08 ? legible(colors.secondary) : legible(colors.primary, 0.55) }
}

interface Art { picture: string; size: { width: number; height: number }; baseline: { x: number; y: number } }

let penContext: CanvasRenderingContext2D | null = null

/** Words already drawn, the most recently used last. Encoding a word's picture is the slow part of a new line, and
 *  songs (and the style picker's made-up lines) keep coming back to the same words in the same face, size and color. */
const drawn = new Map<string, Art>()
const DRAWN_MOST = 300

function drawWord(text: string, key: string, size: number, inkColor: RGB, outline: boolean): Art {
  const id = JSON.stringify([text, key, size, inkColor, outline, window.devicePixelRatio || 1])
  let art = drawn.get(id)
  if (art) drawn.delete(id)
  else art = paintWord(text, key, size, inkColor, outline)
  drawn.set(id, art)
  if (drawn.size > DRAWN_MOST) drawn.delete(drawn.keys().next().value!)
  return art
}

/** A word drawn once: its letters with a soft shadow under them. (The blur a word comes in from is the strips' own
 *  filter, in enter.) */
function paintWord(text: string, key: string, size: number, inkColor: RGB, outline: boolean): Art {
  const font = faceCSS(key, size)
  penContext ??= document.createElement('canvas').getContext('2d')!
  penContext.font = font
  penContext.letterSpacing = '0px'
  const m = penContext.measureText(text)
  const ascent = m.fontBoundingBoxAscent || size * 0.9, descent = m.fontBoundingBoxDescent || size * 0.25
  const margin = Math.ceil(0.3 * size)
  const box = { width: Math.ceil(m.width + 2 * margin), height: Math.ceil(ascent + descent + 2 * margin) }
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(box.width * scale)
  canvas.height = Math.ceil(box.height * scale)
  // Drawn on the CPU: the picture is read straight back out, and reading a GPU canvas waits for everything the GPU
  // has queued - with WRLD's visualizer running, a frame or two.
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.scale(scale, scale)
  g.font = font
  g.shadowColor = 'rgba(0, 0, 0, 0.4)'
  g.shadowBlur = 0.22 * size * scale
  g.shadowOffsetY = 0.03 * size * scale
  if (outline) { g.lineWidth = 0.045 * size; g.lineJoin = 'round'; g.strokeStyle = cssColor(inkColor); g.strokeText(text, margin, margin + ascent) }
  else { g.fillStyle = cssColor(inkColor); g.fillText(text, margin, margin + ascent) }
  return { picture: canvas.toDataURL(), size: box, baseline: { x: margin, y: margin + descent } }
}

// ---- a small repeatable random number source: the same seed, the same numbers ----
function seeded(seed: number): () => number {
  let state = (1469598103934665603n ^ BigInt.asUintN(64, BigInt(Math.trunc(seed)))) & MASK
  const next = (): number => { state = (state * 6364136223846793005n + 1442695040888963407n) & MASK; return Number((state >> 33n) & 0xFFFFFFn) / 0xFFFFFF }
  next()
  return next
}

interface Cue { text: string; start: number; end: number; page: number; row: number; rows: number; x: number; shrink: number; style: WordStyle }
interface Point { x: number; y: number }
/** A strip of a word, with where it stands kept beside it. */
type Strip = HTMLDivElement & { _spot: Point; _word: Point; _seed: number; _final: string }

// ---- the block ----

export class WordBlock implements LyricRenderer {
  host: HTMLElement
  lens: HTMLDivElement
  blockEl: HTMLDivElement
  adlibHost: HTMLDivElement
  interlude: InterludeMark
  song: StageSong | null = null
  clock: StageClock | null = null
  isSeen = true
  colors: AlbumColors | null = null
  palette: Palette | null = null
  face = STANDARD_FACE
  s = 1
  fontSize = 64
  cap = 40
  pitch = 64
  blockHeight = 256
  cues: Cue[] = []
  adlibs: TimedWord[] = []
  page = -1
  words = new Map<number, Strip[]>()
  pageLayers: Strip[] = []
  arts = new Map<number, Art>()
  shown = -1
  nextAdlib = 0
  adlibSide = 1
  resting = false
  titleShown = false
  alarm = 0

  constructor(host: HTMLElement) {
    this.host = host
    host.innerHTML = '<div class="wb-lens"><div class="wb-block"></div></div><div class="wb-adlibs"></div>'
    this.lens = host.querySelector('.wb-lens')!
    this.blockEl = host.querySelector('.wb-block')!
    this.adlibHost = host.querySelector('.wb-adlibs')!
    // Through a break in the singing, where the block was.
    this.interlude = new InterludeMark(host)
  }

  get size(): number { return 64 * this.s }
  get width(): number { return 5.1 * this.size }
  get radius(): number { return 172 * this.s }
  get eye(): number { return 360 * this.s }

  /** Everything the block follows; it sets itself afresh only when the song, its look or the clock's course changed. */
  show(song: StageSong, { clock, isSeen, colors, face, scale }: StageLook): void {
    let redo = false
    if (face !== this.face) { this.face = face; this.song = null; this.arts.clear() }
    if (JSON.stringify(colors) !== JSON.stringify(this.colors)) { this.colors = colors; this.palette = paletteOf(colors); this.arts.clear(); redo = true }
    if (!this.palette) this.palette = paletteOf(colors)
    if (scale !== this.s || song.id !== this.song?.id || song.lyrics !== this.song?.lyrics) {
      this.s = scale
      this.song = song
      this.fontSize = matchedSize(this.face, this.size)
      const own = metricsOf(this.face, this.fontSize), standard = metricsOf(STANDARD_FACE, this.size)
      this.cap = own.cap
      this.pitch = 1.02 * this.size * Math.max(1, (own.ascent + own.descent) / Math.max(standard.ascent + standard.descent, 1))
      this.shapeBlock()
      this.cues = this.typeset(song.lyrics)
      this.adlibs = song.lyrics.lines.flatMap((l) => l.adlibs || []).sort((a, b) => a.start - b.start)
      this.arts.clear()
      redo = true
    }
    const clockChanged = JSON.stringify(clock) !== JSON.stringify(this.clock)
    this.clock = clock
    // The note stops with the song.
    this.interlude.hold(!clock?.running)
    if (isSeen !== this.isSeen) { this.isSeen = isSeen; redo = redo || isSeen }
    if (redo) this.rebuild()
    else if (clockChanged) this.catchUp()
    this.schedule()
  }

  stop(): void {
    clearTimeout(this.alarm)
    this.release(false)
    this.interlude.hide(false)
    this.adlibHost.innerHTML = ''
    this.song = null
  }

  destroy(): void {
    this.stop()
    this.host.innerHTML = ''
  }

  shapeBlock(): void {
    const height = MOST * this.pitch
    this.blockHeight = height
    Object.assign(this.blockEl.style, { width: `${this.width}px`, height: `${height}px`, marginLeft: `${-this.width / 2}px`, marginTop: `${-height / 2}px` })
    this.lens.style.perspective = `${this.eye}px`
  }

  get now(): number | null {
    if (!this.clock) return null
    return clockTime(this.clock) + LEAD
  }
  get isRunning(): boolean { return this.isSeen && Boolean(this.clock?.running) }

  /** The newest word due by `time`; -1 when none is. */
  cueAt(time: number): number {
    let low = 0, high = this.cues.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.cues[middle].start <= time) low = middle + 1; else high = middle
    }
    return low - 1
  }

  rebuild(): void {
    const now = this.now
    if (!this.isSeen || now == null) return
    this.nextAdlib = this.adlibs.findIndex((a) => a.start > now)
    if (this.nextAdlib < 0) this.nextAdlib = this.adlibs.length
    const target = this.cueAt(now)
    this.shown = -1
    this.resting = false
    this.interlude.hide(false)
    if (target < 0) { this.showTitle(); return }
    this.cut(this.cues[target].page, false)
    this.reveal(target, false)
    if (this.shouldRest(now)) this.rest(false)
  }

  /** The clock moved: words just due come in; anything else sets the block afresh - except a small step back. */
  catchUp(): void {
    const now = this.now
    if (!this.isSeen || now == null) return
    const target = this.cueAt(now)
    if (target === this.shown) return
    if (target > this.shown && target - this.shown <= 3 && target >= 0) this.advance(target, now)
    else if (target < this.shown && this.cues[this.shown] && this.cues[this.shown].start - now < SLACK) return
    else this.rebuild()
  }

  schedule(): void {
    clearTimeout(this.alarm)
    const now = this.now
    if (!this.isRunning || now == null) return
    const next: number[] = []
    const word = this.cues[this.shown + 1]
    if (word) next.push(word.page === this.page && !this.resting && !this.titleShown ? word.start - AHEAD : word.start)
    if (this.adlibs[this.nextAdlib]) next.push(this.adlibs[this.nextAdlib].start)
    const rest = this.restTime()
    if (rest != null) next.push(rest)
    if (!next.length) return
    const due = Math.min(...next)
    this.alarm = window.setTimeout(() => this.tick(), Math.max((due - now) * 1000, 1))
  }

  tick(): void {
    const now = this.now
    if (!this.isRunning || now == null) return
    while (this.adlibs[this.nextAdlib] && this.adlibs[this.nextAdlib].start <= now) {
      if (now - this.adlibs[this.nextAdlib].start < 0.8) this.drift(this.adlibs[this.nextAdlib])
      this.nextAdlib++
    }
    const target = this.cueAt(now)
    const due = target > this.shown
    if (due) this.advance(target, now)
    const soon = this.cueAt(now + AHEAD)
    if (soon > this.shown && this.cues[soon].page === this.page && !this.resting && !this.titleShown) this.reveal(soon, true, now)
    else if (!due && !this.resting && this.shouldRest(now)) this.rest(true)
    this.schedule()
  }

  advance(target: number, now: number): void {
    if (this.cues[target].page !== this.page || this.resting || this.titleShown) this.cut(this.cues[target].page, true)
    this.reveal(target, true, now)
  }

  restTime(): number | null {
    if (this.resting || !this.cues[this.shown]) return null
    const after = this.cues[this.shown].end + 1.6
    const next = this.cues[this.shown + 1] ? this.cues[this.shown + 1].start : Infinity
    return next - after > 1.2 ? after : null
  }
  shouldRest(now: number): boolean { const after = this.restTime(); return after != null && now >= after }

  // ---- the block ----

  cut(next: number, animated: boolean): void {
    this.release(animated)
    this.interlude.hide(animated)
    this.page = next
    this.resting = false
    this.titleShown = false
    this.cues.forEach((cue, index) => {
      if (cue.page !== next) return
      const art = this.art(index)
      this.words.set(index, this.strips(art, cue.x, this.baseline(cue.row, cue.rows), index))
    })
  }

  art(index: number): Art {
    let art = this.arts.get(index)
    if (!art) {
      const cue = this.cues[index]
      const palette = this.palette!
      art = drawWord(cue.text, this.face, this.fontSize * cue.shrink, cue.style.accent ? palette.second : palette.main, cue.style.outline)
      this.arts.set(index, art)
    }
    return art
  }

  reveal(target: number, animated: boolean, now: number | null = null): void {
    if (target <= this.shown) return
    for (let index = Math.max(this.shown + 1, 0); index <= target; index++) {
      const strips = this.words.get(index), art = this.arts.get(index)
      if (!strips || !art) continue
      const entrance = animated ? this.cues[index].style.entrance : null
      const wait = now == null ? 0 : Math.max(this.cues[index].start - now, 0)
      strips.forEach((strip, number) => this.enter(strip, art, entrance, number, wait))
      if (entrance === 'slam') this.shake(wait)
    }
    this.shown = target
  }

  /** A word's strips: the picture cut into narrow upright slices, each laid on the sphere where its part of the word
   *  falls and turned to face out, unseen until the word is due; `flat`, they stand where they fall, off the lens. */
  strips(art: Art, x: number, baseline: number, seed: number, flat = false): Strip[] {
    const size = art.size
    const count = Math.max(1, Math.ceil(size.width / (0.45 * this.size)))
    const slice = size.width / count
    const corner = { x: x - this.width / 2 - art.baseline.x, y: baseline - this.blockHeight / 2 - art.baseline.y }
    const middle = { x: corner.x + size.width / 2, y: corner.y + size.height / 2 }
    const out: Strip[] = []
    for (let index = 0; index < count; index++) {
      const strip = document.createElement('div') as Strip
      strip.className = 'wb-strip'
      const overlap = 0.5
      const w = slice + 2 * overlap
      Object.assign(strip.style, { width: `${w}px`, height: `${size.height}px`, marginLeft: `${-w / 2}px`, marginTop: `${-size.height / 2}px`,
        backgroundImage: `url("${art.picture}")`, backgroundSize: `${size.width}px ${size.height}px`, backgroundPosition: `${-(index * slice - overlap)}px 0px`, opacity: '0' })
      const spot = { x: corner.x + (index + 0.5) * slice, y: corner.y + size.height / 2 }
      strip._spot = spot
      strip._word = middle
      strip._seed = seed
      strip._final = flat ? this.flat(spot) : this.bulge(spot)
      strip.style.transform = strip._final
      this.blockEl.appendChild(strip)
      this.pageLayers.push(strip)
      out.push(strip)
    }
    return out
  }

  /** A point of the flat block (from its middle, y up) carried onto the sphere, each strip turned to face out. */
  bulge(point: Point, lift = 0, grow = 1): string {
    const r = this.radius, across = point.x / r, up = (point.y + lift) / r
    const tx = r * Math.cos(up) * Math.sin(across), ty = r * Math.sin(up), tz = r * (Math.cos(up) * Math.cos(across) - 1)
    return `translate3d(${tx}px, ${-ty}px, ${tz}px) rotateY(${across}rad) rotateX(${up}rad) scale(${grow})`
  }
  flat(point: Point): string { return `translate3d(${point.x}px, ${-point.y}px, 0px)` }

  /** A strip coming in, the way its word enters; with no entrance it's simply there. `wait`: how long until it's due. */
  enter(strip: Strip, art: Art, entrance: Entrance | null, number: number, wait = 0): void {
    const spot = strip._spot, word = strip._word, final = strip._final
    strip.style.opacity = '1'
    if (!entrance) return
    let from: string, duration = 220, delay = 0, focused = true, easing = 'cubic-bezier(0.2, 0.8, 0.3, 1)'
    switch (entrance) {
      case 'rise': from = this.bulge(spot, -0.14 * this.size, 1.08); break
      case 'slam': {
        const grow = 1.75
        from = this.bulge({ x: word.x + (spot.x - word.x) * grow, y: word.y + (spot.y - word.y) * grow }, 0, grow)
        duration = 200
        easing = 'cubic-bezier(0.5, 0, 0.9, 0.6)'
        break
      }
      case 'pour': from = this.bulge(spot, 0.42 * this.size); delay = number * 28; duration = 240; focused = false; easing = 'cubic-bezier(0.25, 1.35, 0.5, 1)'; break
      case 'whip': {
        const side = art.size.width % 2 < 1 ? -1 : 1
        from = this.bulge({ x: spot.x + side * 0.9 * this.size, y: spot.y })
        duration = 180
        easing = 'cubic-bezier(0.1, 0.9, 0.2, 1)'
        break
      }
      case 'flip': from = `${final} rotateX(${Math.PI / 2 * 0.97}rad)`; delay = number * 14; duration = 340; focused = false; easing = 'cubic-bezier(0.3, 1.45, 0.5, 1)'; break
      case 'blinds': from = `${final} rotateY(${Math.PI / 2 * 0.97}rad)`; delay = number * 24; duration = 260; focused = false; break
      case 'zoom': from = `translate3d(0px, ${0.25 * this.size}px, ${0.62 * this.eye}px) ${final}`; duration = 300; easing = 'cubic-bezier(0.12, 0.85, 0.3, 1)'; break
      default: return
    }
    const begin = delay + wait * 1000
    strip.animate([{ transform: from }, { transform: final }], { duration, delay: begin, easing, fill: 'backwards' })
    strip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(120, duration), delay: begin, fill: 'backwards' })
    if (focused) strip.animate([{ filter: `blur(${(0.06 * this.size).toFixed(1)}px)` }, { filter: 'blur(0px)' }], { duration: Math.min(duration, 200), delay: begin, fill: 'backwards' })
  }

  /** The jolt of a word landing hard: the frame knocked a few points and settling, with its word. */
  shake(wait = 0): void {
    const s = this.s
    const steps = [[0, 0], [0, 0], [6, -5], [-5, 4], [3, -2], [-1, 1], [0, 0]]
    const offsets = [0, 0.4, 0.52, 0.66, 0.78, 0.9, 1]
    this.blockEl.animate(steps.map(([x, y], i) => ({ translate: `${x * s}px ${-y * s}px`, offset: offsets[i] })), { duration: 360, delay: wait * 1000 })
  }

  // ---- going ----

  /** In a cut the block shatters: every strip flies off toward the viewer and out from the middle, each a little its
   *  own way, tumbling; for a pause in the singing it drifts back and fades; set afresh, it simply goes. */
  release(flying: boolean, drifting = false): void {
    const old = this.pageLayers
    this.pageLayers = []
    this.words = new Map()
    this.page = -1
    if (!flying && !drifting) { old.forEach((l) => l.remove()); return }
    const duration = drifting ? 800 : 340
    // Where every strip is, read before any is moved: a read after a move works the page's styles out again, strip by strip.
    const from = old.map((layer) => { const style = getComputedStyle(layer); return { transform: style.transform, opacity: style.opacity } })
    old.forEach((layer, index) => {
      const { transform: fromTransform, opacity: fromOpacity } = from[index]
      const word = layer._word || { x: 0, y: 0 }
      const random = seeded((layer._seed || 0) * 31 + Math.round(word.x))
      let target: string
      if (drifting) target = `translate3d(0px, ${-20 * this.s}px, ${-260 * this.s}px) ${layer._final}`
      else {
        const out = { x: word.x * 1.1 + (random() - 0.5) * 60 * this.s, y: word.y * 1.1 + (random() - 0.3) * 50 * this.s }
        const ax = random(), ay = random()
        target = `translate3d(${out.x}px, ${-out.y}px, ${0.55 * this.eye}px) ${layer._final} rotate3d(${ax}, ${-ay}, 1, ${(random() - 0.5) * 2.2}rad)`
      }
      layer.getAnimations().forEach((a) => a.cancel())
      layer.style.transform = target
      layer.style.opacity = '0'
      layer.animate([{ transform: fromTransform === 'none' ? layer._final : fromTransform, opacity: fromOpacity }, { transform: target, opacity: 0 }],
        { duration, easing: drifting ? 'cubic-bezier(0.4, 0, 0.2, 1)' : 'cubic-bezier(0.55, 0, 1, 0.5)' })
      window.setTimeout(() => layer.remove(), duration + 20)
    })
  }

  /** The singing has paused: the block drifts off into the distance, and for a break longer than a breath or two the
   *  note stands where it was. */
  rest(animated: boolean): void {
    this.resting = true
    this.release(false, animated)
    const now = this.now, cue = this.cues[this.shown], next = this.cues[this.shown + 1]
    if (now == null || !cue || (next && next.start - now < 2.5)) return
    const palette = this.palette!
    this.interlude.show({ now, next: next ? next.start : null, size: 46 * this.s, color: cssColor(palette.main),
      glow: cssColor(palette.second), animated, began: cue.end + 1.6, frozen: !this.clock?.running })
    this.interlude.at(this.host.clientWidth / 2, this.host.clientHeight * 0.45)
  }

  /** Before the singing starts: the song's name set as a block in the middle, its artist beneath, smaller - flat, off the lens. */
  showTitle(): void {
    if (!this.song) return
    this.release(false)
    this.titleShown = true
    const palette = this.palette!
    let name = this.song.title
    for (const mark of [' (', ' [', ' - ']) { const i = name.indexOf(mark); if (i > 0) name = name.slice(0, i) }
    const rows = this.rows(name.split(/\s+/).filter(Boolean)).slice(0, MOST - 1)
    rows.forEach((row, number) => {
      for (const [text, x, shrink] of this.center(row)) {
        const art = drawWord(text, this.face, this.fontSize * shrink, palette.main, false)
        this.strips(art, x, this.baseline(number, rows.length + 1), number, true).forEach((strip, i) => this.enter(strip, art, 'flip', i))
      }
    })
    if (!this.song.artist) return
    const art = drawWord(this.song.artist, this.face, this.fontSize * 0.4, palette.second, false)
    const x = (this.width - art.size.width) / 2 + art.baseline.x
    this.strips(art, x, this.baseline(rows.length, rows.length + 1) + 0.3 * this.size, 99, true).forEach((strip, i) => this.enter(strip, art, 'blinds', i))
  }

  // ---- adlibs ----

  /** An adlib rises faintly just beside the words being sung, as it's sung, and fades; the sides take turns. */
  drift(adlib: TimedWord): void {
    const palette = this.palette!
    const el = document.createElement('div')
    el.className = 'wb-adlib'
    el.textContent = adlib.text
    el.style.font = faceCSS(this.face, this.fontSize * 0.4)
    el.style.color = cssColor(palette.second)
    this.adlibHost.appendChild(el)
    const host = this.host.getBoundingClientRect()
    const rowBox = this.rowSeen(host)
    const gap = (10 + Math.random() * 18) * this.s
    const half = el.offsetWidth / 2, margin = 12 * this.s
    const spot = (side: number): number => (side > 0 ? rowBox.right + gap + half : rowBox.left - gap - half)
    const fits = (x: number): boolean => x - half >= margin && x + half <= host.width - margin
    this.adlibSide = -this.adlibSide
    if (!fits(spot(this.adlibSide)) && fits(spot(-this.adlibSide))) this.adlibSide = -this.adlibSide
    const x = Math.min(Math.max(spot(this.adlibSide), half + margin), host.width - half - margin)
    const y = rowBox.middle + (Math.random() - 0.5) * 0.36 * this.pitch
    Object.assign(el.style, { left: `${x - half}px`, top: `${y - el.offsetHeight / 2}px` })
    const life = Math.min(Math.max(adlib.end - adlib.start + 0.8, 1.2), 2) * 1000
    el.animate([{ opacity: 0, translate: '0 0' }, { opacity: 0.72, offset: 0.1 }, { opacity: 0.72, offset: 0.6 }, { opacity: 0, translate: `0 ${-26 * this.s}px` }], { duration: life, easing: 'ease-out', fill: 'forwards' })
    window.setTimeout(() => el.remove(), life)
  }

  /** The row being sung, as seen on screen: where its words begin and end across, and its middle's height. */
  rowSeen(host: DOMRect): { left: number; right: number; middle: number } {
    const cue = this.cues[this.shown]
    const center = { x: host.width / 2, y: host.height * 0.45 }
    if (!cue || cue.page !== this.page || this.resting || this.titleShown) return { left: center.x - this.width * 0.35, right: center.x + this.width * 0.35, middle: center.y }
    const row = this.cues.filter((c) => c.page === cue.page && c.row === cue.row)
    const start = Math.min(...row.map((c) => c.x))
    const end = Math.max(...row.map((c) => c.x + measure(c.text, this.face, this.fontSize) * c.shrink))
    const height = this.baseline(cue.row, cue.rows) - this.blockHeight / 2 + this.cap / 2
    const seen = (p: Point): Point => {
      const r = this.radius, across = p.x / r, up = p.y / r
      const away = 1 - r * (Math.cos(up) * Math.cos(across) - 1) / this.eye
      return { x: center.x + 1.15 * r * Math.cos(up) * Math.sin(across) / away, y: center.y - 1.15 * r * Math.sin(up) / away }
    }
    const left = seen({ x: start - this.width / 2, y: height }), right = seen({ x: end - this.width / 2, y: height })
    return { left: left.x, right: right.x, middle: (left.y + right.y) / 2 }
  }

  // ---- type ----

  /** Where a row's letters stand, in a block of `rows` rows kept to the middle of the box (from the bottom, y up). */
  baseline(row: number, rows: number): number {
    const top = (MOST - rows) / 2 * this.pitch
    return this.blockHeight - top - row * this.pitch - this.cap * 1.08
  }

  /** Every word of the song, placed: each line split into the phrases it's sung in, each phrase wrapped in the box,
   *  four rows to a block, each row centered. */
  typeset(lyrics: TimedLyrics): Cue[] {
    const cues: Cue[] = []
    let page = 0
    for (const line of lyrics.lines) {
      if (!line.words?.length) continue
      for (const phrase of this.phrases(line.words)) {
        const rows = this.rows(phrase.map((w) => w.text))
        let index = 0
        rows.forEach((row, number) => {
          if (number > 0 && number % MOST === 0) page++
          const inBlock = Math.min(rows.length - Math.floor(number / MOST) * MOST, MOST)
          for (const [text, x, shrink] of this.center(row)) {
            const word = phrase[index]
            cues.push({ text, start: word.start, end: word.end, page, row: number % MOST, rows: inBlock, x, shrink, style: pickStyle(text, index, phrase.length, cues.length) })
            index++
          }
        })
        page++
      }
    }
    return cues.sort((a, b) => a.start - b.start)
  }

  /** A line's words in the phrases they're sung in: a comma, a question or an exclamation ends one, as a breath does -
   *  as long as two words at least stand on each side. */
  phrases(words: TimedWord[]): TimedWord[][] {
    const phrases: TimedWord[][] = []
    let current: TimedWord[] = []
    words.forEach((word, index) => {
      current.push(word)
      if (current.length < 2 || words.length - index - 1 < 2) return
      if (',;:!?…—'.includes(word.text.slice(-1))) { phrases.push(current); current = [] }
    })
    if (current.length) phrases.push(current)
    return phrases
  }

  /** Words into rows no wider than the box, as a text box wraps them. */
  rows(words: string[]): string[][] {
    const space = measure(' ', this.face, this.fontSize)
    const rows: string[][] = []
    let row: string[] = [], used = 0
    for (const word of words) {
      const length = measure(word, this.face, this.fontSize)
      if (row.length && used + space + length > this.width) { rows.push(row); row = []; used = 0 }
      used += (row.length ? space : 0) + length
      row.push(word)
    }
    if (row.length) rows.push(row)
    return rows
  }

  /** A row's words with where each starts across the box, the row centered; a single word wider than the box shrinks. */
  center(row: string[]): [string, number, number][] {
    const lengths = row.map((w) => measure(w, this.face, this.fontSize))
    const space = measure(' ', this.face, this.fontSize)
    const total = lengths.reduce((a, b) => a + b, 0) + space * (row.length - 1)
    if (row.length === 1 && total > this.width) return [[row[0], 0, this.width / Math.max(total, 1)]]
    let x = (this.width - total) / 2
    return row.map((word, i) => { const at = x; x += lengths[i] + space; return [word, at, 1] })
  }
}
