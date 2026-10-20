// The lyric styles beside the fisheye, each on LyricScene: they wake only as a word or a line is due, and every move
// is the browser's own animation.
import { LyricScene, type SceneLine } from './scene'
import { chance, cssColor, ink, spring, width, wrap, type Wrapped } from './type'

const GLIDE = spring(0.6, 0.86)

/** Keyframes that jump from value to value instead of easing between them. */
const stepped = (values: (string | number)[], key: string, offsets?: number[]): Keyframe[] => {
  const frames: Keyframe[] = values.map((value, i) => ({ [key]: value, offset: offsets ? offsets[i] : i / Math.max(values.length - 1, 1), easing: 'step-end' }))
  if ((frames[frames.length - 1].offset as number) < 1) frames.push({ ...frames[frames.length - 1], offset: 1 })
  return frames
}

const translateOf = (el: HTMLElement): string => {
  const t = getComputedStyle(el).translate
  return t === 'none' ? '0px 0px' : t
}

// ---- Spread -----------------------------------------------------------------------------------------------------

/** The phrase as a wall of words: a few short rows, each set wall to wall with wide gaps, every word appearing where
 *  it will stay the moment it's sung; the next phrase cuts in. In the face picked, white, glowing faintly. */
export class SpreadScene extends LyricScene {
  wall: HTMLDivElement | null = null
  wallLine: SceneLine | null = null
  words: HTMLElement[] = []

  restyle(): void { this.wall?.remove(); this.wall = null; this.wallLine = null }

  present(line: SceneLine | null): void {
    this.wall?.remove()
    this.wall = null
    this.wallLine = line
    this.words = []
    if (!line?.words.length) return
    const room = 330 * this.s
    let size = 46 * this.s, css = this.font(size), set = this.rows(line, css, room, size * 0.3)
    while (set.length > 5 && size > 22 * this.s) { size *= 0.9; css = this.font(size); set = this.rows(line, css, room, size * 0.3) }
    const m = this.metrics(size)
    const rowHeight = Math.ceil(m.ascent + m.descent), pitch = rowHeight + size * 0.12
    const block = this.block(room, set.length * pitch - size * 0.12, this.width / 2, this.height / 2)
    const glows = [{ color: cssColor(this.glow, 0.55), radius: 14 * this.s }, { color: 'rgba(0,0,0,0.45)', radius: 3 * this.s }]
    const shown: HTMLElement[] = []
    set.forEach((row, number) => {
      const used = row.reduce((sum, w) => sum + w.width, 0)
      const gap = row.length > 1 ? (room - used) / (row.length - 1) : 0
      let x = 0
      for (const word of row) {
        const picture = ink(line.words[word.index].text, css, '#fff', { glows })
        const el = this.place(picture, { x, y: number * pitch }, rowHeight, rowHeight)
        el.style.opacity = '0'
        block.appendChild(el)
        shown[word.index] = el
        x += word.width + gap
      }
    })
    this.words = line.words.map((_, i) => shown[i] || document.createElement('div'))
    this.wall = block
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    if (line !== this.wallLine || !this.words[index]) return
    const word = this.words[index]
    if (!animated || delay <= 0) { word.getAnimations().forEach((a) => a.cancel()); word.style.opacity = '1'; return }
    // Each word simply appears at its moment.
    this.animate(word, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.02, delay })
  }

  rows(line: SceneLine, css: string, room: number, gap: number): { index: number; width: number }[][] {
    const rows: { index: number; width: number }[][] = []
    let row: { index: number; width: number }[] = [], used = 0
    line.words.forEach((word, index) => {
      const length = width(word.text, css)
      if (row.length && used + gap + length > room) { rows.push(row); row = [{ index, width: length }]; used = length }
      else { used += (row.length ? gap : 0) + length; row.push({ index, width: length }) }
    })
    if (row.length) rows.push(row)
    return rows
  }
}

// ---- Karaoke ----------------------------------------------------------------------------------------------------

interface KaraokeRow { el: HTMLDivElement; sharp: HTMLCanvasElement; soft: HTMLCanvasElement; lit: HTMLElement[] }

/** A sing-along: the lines in a column gliding up, the one sung large and bright, lit whole as it begins - not word
 *  by word; the others smaller, faint, the near ones softly out of focus. Every word as written, adlibs too, in the
 *  app's lyric size and colors. */
export class KaraokeScene extends LyricScene {
  rows = new Map<number, KaraokeRow>()
  tops: number[] = []
  heights: number[] = []
  sets: Wrapped[] = []
  anchor = 0
  current: number | null = null
  /** Room opened in the column through a break, for the note. */
  opening = 0
  /** The room is above the anchor, not under it: before the first line. */
  roomAbove = false
  css = ''
  rowHeight = 0
  measuredFor = ''
  column: HTMLDivElement

  /** The note from the start: the column shows no name. */
  get showsTitle(): boolean { return false }
  /** A sing-along has the whole line to sing, "(yeah)" and all. */
  get singsAdlibs(): boolean { return true }

  constructor(host: HTMLElement) {
    super(host)
    this.column = document.createElement('div')
    Object.assign(this.column.style, { position: 'absolute', left: '0', top: '0' })
    this.stage.appendChild(this.column)
    // The column fades out at its top and bottom.
    this.stage.style.maskImage = 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)'
  }

  get size(): number { return 30 * this.s * (this.tune?.size || 1) }
  get boxWidth(): number { return Math.min(this.width, 520 * this.s) }
  get room(): number { return this.boxWidth - 20 * this.s }
  get space(): number { return this.size * 0.28 }
  get rowGap(): number { return this.size * 0.08 }

  restyle(): void { this.rows.forEach((r) => r.el.remove()); this.rows.clear(); this.tops = [] }

  measure(): void {
    this.css = this.font(this.size)
    const m = this.metrics(this.size)
    this.rowHeight = Math.ceil(m.ascent + m.descent)
    this.tops = []
    this.heights = []
    this.sets = []
    let y = 0
    for (const line of this.lines) {
      const set = wrap(line.words.map((w) => w.text), this.css, this.room, 0, this.space)
      const height = set.rows.length * this.rowHeight + (set.rows.length - 1) * this.rowGap
      this.tops.push(y)
      this.heights.push(height)
      this.sets.push(set)
      y += height + 18 * this.s
    }
    this.measuredFor = `${this.width}:${this.lines.length}`
  }

  present(line: SceneLine | null, animated: boolean): void {
    if (this.measuredFor !== `${this.width}:${this.lines.length}` || this.tops.length !== this.lines.length) {
      this.rows.forEach((r) => r.el.remove())
      this.rows.clear()
      this.measure()
    }
    const previous = this.current
    this.opening = 0
    this.roomAbove = false
    if (line && line.index >= 0) { this.current = line.index; this.anchor = line.index }
    else { this.current = null; if (!animated) this.anchor = Math.min(this.anchor, Math.max(this.lines.length - 1, 0)) }
    if (!this.lines.length) return
    const first = Math.max(this.anchor - 4, 0), last = Math.min(this.anchor + 6, this.lines.length - 1)
    for (const [index, row] of [...this.rows]) {
      if (index >= first && index <= last) continue
      if (animated) this.fadeAway(row.el, 0.3); else row.el.remove()
      this.rows.delete(index)
    }
    for (let index = first; index <= last; index++) {
      if (this.rows.has(index)) continue
      const row = this.make(index)
      this.rows.set(index, row)
      this.column.appendChild(row.el)
      if (animated) this.animate(row.el, [{ opacity: 0 }, { opacity: row.el.style.opacity || 1 }], { duration: 0.35 })
    }
    // The line that was sung goes back to dim; the one sung now gets its bright words.
    const before = previous != null && previous !== this.current ? this.rows.get(previous) : undefined
    if (before) {
      for (const lit of before.lit) { if (animated) this.fadeAway(lit, 0.3); else lit.remove() }
      before.lit = []
    }
    const sungRow = this.current != null ? this.rows.get(this.current) : undefined
    if (this.current != null && sungRow && !sungRow.lit.length) {
      const lit = this.light(this.current, sungRow.el)
      sungRow.lit = lit
      if (animated) lit.forEach((el) => this.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.25 }))
    }
    this.settle(animated)
    // The column glides so the line sung stands a little above the middle.
    const x = (this.width - this.boxWidth) / 2 + 10 * this.s, y = this.height * 0.36 - this.tops[this.anchor]
    const to = `${x}px ${y}px`
    if (animated) {
      const from = getComputedStyle(this.column).translate
      this.animate(this.column, [{ translate: from === 'none' ? to : from }, { translate: to }], { duration: GLIDE.duration, easing: GLIDE.easing })
    } else this.column.style.translate = to
    for (const [index, row] of this.rows) {
      const distance = Math.abs(index - this.anchor), sung = index === this.current
      const opacity = sung ? 1 : Math.max(0.45 - 0.08 * (Math.max(distance, 1) - 1), 0.12)
      const scale = sung ? 1 : 0.86
      // Out of focus near the line sung only: further lines are faint enough already.
      const soft = !sung && distance <= 2 ? 1 : 0
      if (animated) {
        const now = getComputedStyle(row.el)
        this.animate(row.el, [{ opacity: now.opacity, scale: now.scale === 'none' ? 1 : now.scale }, { opacity: String(opacity), scale: String(scale) }],
          { duration: GLIDE.duration, easing: GLIDE.easing })
        if (String(soft) !== row.soft.style.opacity) {
          this.animate(row.soft, [{ opacity: row.soft.style.opacity || 0 }, { opacity: String(soft) }], { duration: 0.4 })
          this.animate(row.sharp, [{ opacity: row.sharp.style.opacity || 1 }, { opacity: String(1 - soft) }], { duration: 0.4 })
        }
      } else {
        row.el.getAnimations().forEach((a) => a.cancel())
        Object.assign(row.el.style, { opacity: String(opacity), scale: String(scale) })
        row.soft.style.opacity = String(soft)
        row.sharp.style.opacity = String(1 - soft)
      }
    }
  }

  /** One line, dim, as a sharp and a soft picture, wrapped as a paragraph, scaled from its left. */
  make(index: number): KaraokeRow {
    const line = this.lines[index], set = this.sets[index], height = this.heights[index]
    const el = document.createElement('div')
    Object.assign(el.style, { position: 'absolute', left: '0', top: `${this.tops[index]}px`, width: `${this.room}px`, height: `${height}px`, transformOrigin: 'left center' })
    const paint = (blur: number, detail: number): HTMLCanvasElement => {
      const pad = 8 * this.s
      const w = this.room + 2 * pad, h = height + 2 * pad
      const scale = Math.min(window.devicePixelRatio || 1, 2) * detail
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(w * scale)
      canvas.height = Math.ceil(h * scale)
      Object.assign(canvas.style, { position: 'absolute', left: `${-pad}px`, top: `${-pad}px`, width: `${w}px`, height: `${h}px` })
      const g = canvas.getContext('2d')!
      g.scale(scale, scale)
      g.font = this.css
      const away = w * 4
      // A color picked for the other lines is painted whole: the row's own fading dims it as it does the white.
      const dim = this.tune?.inactive || 'rgba(255,255,255,0.32)'
      g.fillStyle = dim
      if (blur) { g.shadowColor = dim; g.shadowBlur = blur * scale; g.shadowOffsetX = -away * scale }
      const ascent = this.metrics(this.size).ascent
      line.words.forEach((word, i) => {
        const p = set.places[i]
        g.fillText(word.text, pad + p.x + (blur ? away : 0), pad + p.row * (this.rowHeight + this.rowGap) + ascent)
      })
      return canvas
    }
    const sharp = paint(0, 1), soft = paint(1.6 * this.s, 0.5)
    el.append(sharp, soft)
    return { el, sharp, soft, lit: [] }
  }

  /** The line sung, lit whole as it begins: its words the dim ones' bright copies, glowing. */
  light(index: number, el: HTMLElement): HTMLElement[] {
    const line = this.lines[index], set = this.sets[index]
    const glows = [{ color: cssColor(this.glow, 0.55), radius: 9 * this.s }]
    return line.words.map((word, i) => {
      const p = set.places[i]
      const picture = ink(word.text, this.css, this.tune?.active || '#fff', { glows })
      el.appendChild(this.place(picture, { x: p.x, y: p.row * (this.rowHeight + this.rowGap) }, null, picture.h - 2 * picture.pad))
      return picture.el
    })
  }

  /** Through a break the lines after the one last sung move down, and the note stands in the room they leave, at the
   *  lines' left edge - not over them. Before the first line, the room is above it, the column standing at it. */
  interludeSpot(size: { w: number; h: number }, ahead: boolean, animated: boolean): { x: number; y: number } {
    if (this.tops[this.anchor] == null) return super.interludeSpot(size, ahead, animated)
    if (ahead) { this.anchor = 0; this.present(null, animated) }
    this.opening = size.h + 18 * this.s
    this.roomAbove = ahead
    this.settle(animated)
    const x = (this.width - this.boxWidth) / 2 + 10 * this.s, y = this.height * 0.36 - this.tops[this.anchor]
    const top = y + (ahead ? this.tops[0] : this.tops[this.anchor] + this.heights[this.anchor] + 18 * this.s)
    return { x: x + size.w / 2 - 6 * this.s, y: top + size.h / 2 }
  }

  /** Each row where it stands in the column, those after the anchor below any room opened. */
  settle(animated: boolean): void {
    for (const [index, row] of this.rows) {
      const down = index > this.anchor || (this.roomAbove && index === this.anchor) ? this.opening : 0
      const to = `0px ${down}px`
      if (row.el.style.translate === to || (!row.el.style.translate && down === 0)) continue
      if (animated) this.animate(row.el, [{ translate: translateOf(row.el) }, { translate: to }], { duration: GLIDE.duration, easing: GLIDE.easing })
      else row.el.style.translate = to
    }
  }
}

// ---- Typewriter -------------------------------------------------------------------------------------------------

interface TypedWord { win: HTMLDivElement; inner: HTMLCanvasElement; x: number; left: number; top: number; w: number; offsets: number[] }
interface TypedLine { line: SceneLine; block: HTMLDivElement; height: number; top: number; left: number; words: TypedWord[]; caret: HTMLDivElement; row: number }

/** Typed out as sung: each word struck letter by letter, a caret in the song's color blinking after the last letter,
 *  the lines before rolling up the page and fading. */
export class TypewriterScene extends LyricScene {
  page: TypedLine[] = []

  restyle(): void { this.page.forEach((t) => t.block.remove()); this.page = [] }

  get room(): number { return Math.min(this.width - 24 * this.s, 400 * this.s) }

  present(line: SceneLine | null, animated: boolean): void {
    if (!animated) { this.page.forEach((t) => t.block.remove()); this.page = [] }
    if (!line?.words.length) return
    let size = 26 * this.s, css: string, set: Wrapped
    for (;;) {
      css = this.font(size)
      set = wrap(line.words.map((w) => w.text), css, this.room)
      if (set.rows.length <= 3 || size < 15 * this.s) break
      size *= 0.9
    }
    const m = this.metrics(size)
    const row = Math.ceil((m.ascent + m.descent) * 1.18), letters = m.ascent + m.descent
    const gap = 12 * this.s, height = set.rows.length * row
    const left = (this.width - this.room) / 2, top = this.height * 0.5 - height / 2
    const block = document.createElement('div')
    Object.assign(block.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${this.room}px`, height: `${height}px` })
    const words = line.words.map((word, index): TypedWord => {
      const p = set.places[index]
      const picture = ink(word.text, css, 'rgb(245,245,245)', { glows: [{ color: 'rgba(0,0,0,0.45)', radius: 3 * this.s }] })
      const y = p.row * row
      const win = document.createElement('div')
      Object.assign(win.style, { position: 'absolute', left: `${p.x - picture.pad}px`, top: `${y + (row - letters) / 2 - picture.pad}px`,
        width: `${picture.w}px`, height: `${picture.h}px`, overflow: 'hidden', translate: `${-picture.w}px 0` })
      picture.el.style.position = 'absolute'
      picture.el.style.translate = `${picture.w}px 0`
      win.appendChild(picture.el)
      block.appendChild(win)
      // Where each letter ends, from the word's start.
      const chars = [...word.text]
      const offsets = chars.map((_, i) => picture.pad + width(chars.slice(0, i + 1).join(''), css))
      return { win, inner: picture.el, x: p.x, left: p.x - picture.pad, top: y, w: picture.w, offsets }
    })
    const caret = document.createElement('div')
    Object.assign(caret.style, { position: 'absolute', left: '0', top: `${row * 0.88 - 3 * this.s}px`, width: `${0.42 * size}px`, height: `${3 * this.s}px`,
      borderRadius: `${1.5 * this.s}px`, background: cssColor(this.glow), translate: `${(words[0]?.x ?? 0) + 1.5 * this.s}px 0px` })
    // Blinking as a caret does.
    caret.animate([{ opacity: 1, easing: 'step-end' }, { opacity: 0, offset: 0.5, easing: 'step-end' }, { opacity: 0 }], { duration: 1050, iterations: Infinity })
    block.appendChild(caret)
    this.stage.appendChild(block)

    // The page rolls up: the line before steps above the new one, the older further, fainter.
    this.page = [{ line, block, height, top, left, words, caret, row }, ...this.page]
    let y = top
    const kept: TypedLine[] = []
    this.page.forEach((typed, age) => {
      if (age === 0) { kept.push(typed); return }
      y -= gap + typed.height
      typed.caret.remove()
      if (age > 2 || y < 4 * this.s) { if (animated) this.fadeAway(typed.block, 0.3); else typed.block.remove(); return }
      const fade = age === 1 ? 0.42 : 0.18
      const to = `0px ${y - typed.top}px`
      if (animated) {
        const now = getComputedStyle(typed.block)
        this.animate(typed.block, [{ translate: now.translate === 'none' ? '0px 0px' : now.translate, opacity: now.opacity }, { translate: to, opacity: String(fade) }],
          { duration: 0.45, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' })
      } else Object.assign(typed.block.style, { translate: to, opacity: String(fade) })
      kept.push(typed)
    })
    this.page = kept
    if (animated) this.animate(block, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.15 })
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    const typed = this.page[0]
    if (!typed || typed.line !== line || !typed.words[index]) return
    const word = typed.words[index], steps = word.offsets
    const caretAt = (w: number): string => `${word.left + w + 1.5 * this.s}px ${word.top}px`
    if (!animated) {
      word.win.getAnimations().forEach((a) => a.cancel())
      word.inner.getAnimations().forEach((a) => a.cancel())
      word.win.style.translate = '0px 0px'
      word.inner.style.translate = '0px 0px'
      typed.caret.getAnimations().filter((a) => a.id === 'travel').forEach((a) => a.cancel())
      typed.caret.style.translate = caretAt(steps[steps.length - 1] ?? word.w)
      return
    }
    const spoken = line.words[index], count = steps.length
    const span = Math.min(Math.max(spoken.end - spoken.start, 0.06), 0.065 * count)
    const offsets = [0, ...steps.map((_, i) => (i / count) * 0.98 + 0.0001)]
    const reach = [0, ...steps]
    this.animate(word.win, stepped(reach.map((r) => `${r - word.w}px 0px`), 'translate', offsets), { duration: span, delay, easing: 'linear' })
    this.animate(word.inner, stepped(reach.map((r) => `${word.w - r}px 0px`), 'translate', offsets), { duration: span, delay, easing: 'linear' })
    word.win.style.translate = '0px 0px'
    word.inner.style.translate = '0px 0px'
    // The caret follows the letters, and waits after each word's last for the next.
    const travel = typed.caret.animate(stepped(steps.map(caretAt), 'translate', steps.map((_, i) => (i / count) * 0.98)),
      { duration: span * 1000, delay: delay * 1000, fill: 'forwards', id: 'travel' })
    travel.id = 'travel'
    if (this.frozen) travel.pause()
  }
}

// ---- Neon -------------------------------------------------------------------------------------------------------

/** A neon sign: the line's tubes there unlit, a faint grey; each word buzzes on as it's sung, in the song's color
 *  (every other line in its second), and now and then a lit word stutters. */
export class NeonScene extends LyricScene {
  sign: HTMLDivElement | null = null
  signLine: SceneLine | null = null
  lit: HTMLElement[] = []

  restyle(): void { this.sign?.remove(); this.sign = null; this.signLine = null }

  present(line: SceneLine | null, animated: boolean): void {
    if (this.sign) {
      const old = this.sign
      if (animated) {
        // The old sign dies: a stutter, then dark.
        this.animate(old, stepped([1, 0.25, 0.8, 0.1, 0], 'opacity', [0, 0.2, 0.4, 0.7, 1]), { duration: 0.24 }).finished
          .then(() => old.remove(), () => old.remove())
      } else old.remove()
    }
    this.sign = null
    this.signLine = line
    this.lit = []
    if (!line?.words.length) return
    const set = this.centered(line, Math.min(this.width - 30 * this.s, 400 * this.s), 38 * this.s, 3, { leading: 1.18 })
    const block = this.block(set.width, set.height, this.width / 2, this.height * 0.5)
    const color = line.index % 2 === 0 ? this.glow : this.secondGlow
    const tube = color.map((v) => v + (1 - v) * 0.6)
    line.words.forEach((word, i) => {
      block.appendChild(this.place(ink(word.text, set.css, 'rgba(255,255,255,0.09)'), set.spots[i], set.row, set.letters))
      const on = this.place(ink(word.text, set.css, cssColor(tube), {
        glows: [{ color: cssColor(color, 0.95), radius: 3.5 * this.s }, { color: cssColor(color, 0.7), radius: 13 * this.s }] }), set.spots[i], set.row, set.letters)
      on.style.opacity = '0'
      block.appendChild(on)
      this.lit.push(on)
    })
    this.sign = block
    if (animated) this.animate(block, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.18, delay: 0.12 })
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    if (line !== this.signLine || !this.lit[index]) return
    const tube = this.lit[index]
    if (!animated) { tube.getAnimations().forEach((a) => a.cancel()); tube.style.opacity = '1'; return }
    // Each tube catches in its own way.
    const flicker = chance(line.index * 31 + index) < 0.5 ? [0, 0.9, 0.15, 1, 0.45, 1] : [0, 0.6, 0.05, 0.85, 1, 1]
    this.animate(tube, stepped(flicker, 'opacity', [0, 0.14, 0.3, 0.5, 0.7, 1]), { duration: 0.3, delay })
    const later = 0.9 + 1.4 * chance(line.index * 17 + index * 5)
    const left = LyricScene.end(line) + 0.6 - line.words[index].start
    if (chance(line.index * 7 + index * 13) < 0.22 && later + 0.2 < left) {
      this.animate(tube, stepped([1, 0.3, 1, 0.55, 1], 'opacity'), { duration: 0.22, delay: delay + later, hold: false })
    }
  }
}

// ---- Echo -------------------------------------------------------------------------------------------------------

interface SaidLine { line: SceneLine; block: HTMLDivElement; height: number; words: HTMLElement[]; rings: HTMLElement[][]; y: number }

/** Each word lands with a small bounce and rings out - two copies in the song's color swelling away and fading - and
 *  the lines sung before step back above the new one, smaller and fainter. */
export class EchoScene extends LyricScene {
  said: SaidLine[] = []

  restyle(): void { this.said.forEach((l) => l.block.remove()); this.said = [] }

  present(line: SceneLine | null, animated: boolean): void {
    if (!animated) { this.said.forEach((l) => l.block.remove()); this.said = [] }
    if (line?.words.length) {
      const set = this.centered(line, Math.min(this.width - 30 * this.s, 390 * this.s), 40 * this.s, 3, { leading: 1.04 })
      const block = this.block(set.width, set.height, this.width / 2, this.height * 0.6)
      const words: HTMLElement[] = [], rings: HTMLElement[][] = []
      line.words.forEach((word, i) => {
        const ring = (): HTMLElement => {
          const el = this.place(ink(word.text, set.css, cssColor(this.glow)), set.spots[i], set.row, set.letters)
          el.style.opacity = '0'
          block.appendChild(el)
          return el
        }
        rings.push([ring(), ring()])
        const el = this.place(ink(word.text, set.css, '#fff', {
          glows: [{ color: cssColor(this.glow, 0.55), radius: 12 * this.s }, { color: 'rgba(0,0,0,0.4)', radius: 3 * this.s }] }), set.spots[i], set.row, set.letters)
        el.style.opacity = '0'
        block.appendChild(el)
        words.push(el)
      })
      this.said.unshift({ line, block, height: set.height, words, rings, y: this.height * 0.6 })
    }
    this.arrange(animated, Boolean(line))
  }

  /** The newest line a little below the middle; those before it stepped back above it, smaller and fainter. */
  arrange(animated: boolean, fresh: boolean): void {
    const scales = [1, 0.58, 0.36], fades = [1, 0.3, 0.1]
    const shift = fresh ? 0 : 1
    let y = this.height * 0.6
    const kept: SaidLine[] = []
    this.said.forEach((line, age) => {
      const step = age + shift
      if (step >= scales.length) { if (animated) this.fadeAway(line.block, 0.35); else line.block.remove(); return }
      if (age > 0 || shift > 0) {
        const before = age > 0 ? this.said[age - 1].height * scales[step - 1] : 0
        y -= before / 2 + 16 * this.s * scales[step] + line.height * scales[step] / 2
      }
      const to = { translate: `0px ${y - line.y}px`, scale: String(scales[step]), opacity: String(fades[step]) }
      if (animated && (age > 0 || shift > 0)) {
        const now = getComputedStyle(line.block)
        this.animate(line.block, [{ translate: now.translate === 'none' ? '0px 0px' : now.translate, scale: now.scale === 'none' ? '1' : now.scale, opacity: now.opacity }, to],
          { duration: 0.55, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' })
      } else Object.assign(line.block.style, to)
      kept.push(line)
    })
    this.said = kept
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    const current = this.said[0]
    if (!current || current.line !== line || !current.words[index]) return
    const word = current.words[index]
    if (!animated) { word.getAnimations().forEach((a) => a.cancel()); word.style.opacity = '1'; return }
    this.animate(word, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.08, delay })
    this.animate(word, [{ scale: '1.35' }, { scale: '1' }], { duration: 0.42, delay, easing: 'cubic-bezier(0.25, 1.5, 0.45, 1)' })
    // The echo: two copies swelling away, fading.
    current.rings[index].forEach((ring, number) => {
      const wait = delay + 0.04 + number * 0.09, duration = 0.55 + number * 0.15
      this.animate(ring, [{ opacity: number === 0 ? 0.7 : 0.4, scale: '1' }, { opacity: 0, scale: number === 0 ? '1.3' : '1.6' }],
        { duration, delay: wait, easing: 'ease-in', hold: false })
    })
  }
}

// ---- Glitch -----------------------------------------------------------------------------------------------------

const BANDS = 3

interface Torn { line: SceneLine; block: HTMLDivElement; slices: HTMLCanvasElement[][]; splits: HTMLElement[][] }

/** Each word cuts in torn - sliced across, the slices jolting sideways, two copies in the song's two colors split off
 *  left and right - and snaps clean a fifth of a second later; now and then a word sung jolts again. */
export class GlitchScene extends LyricScene {
  torn: Torn | null = null

  restyle(): void { this.torn?.block.remove(); this.torn = null }

  present(line: SceneLine | null, animated: boolean): void {
    if (this.torn) {
      const old = this.torn.block
      if (animated) {
        const jolt = 9 * this.s
        this.animate(old, stepped([0, jolt, -jolt * 1.6, jolt * 0.5, 0].map((x) => `${x}px 0px`), 'translate'), { duration: 0.16 })
        this.animate(old, stepped([1, 0.7, 1, 0.35, 0], 'opacity'), { duration: 0.16 }).finished.then(() => old.remove(), () => old.remove())
      } else old.remove()
    }
    this.torn = null
    if (!line?.words.length) return
    const set = this.centered(line, Math.min(this.width - 30 * this.s, 390 * this.s), 42 * this.s, 3, { leading: 1.02 })
    const block = this.block(set.width, set.height, this.width / 2, this.height * 0.52)
    const slices: HTMLCanvasElement[][] = [], splits: HTMLElement[][] = []
    line.words.forEach((word, i) => {
      splits.push([this.glow, this.secondGlow].map((color) => {
        const el = this.place(ink(word.text, set.css, cssColor(color)), set.spots[i], set.row, set.letters)
        el.style.opacity = '0'
        block.appendChild(el)
        return el
      }))
      // The word cut across into bands, each showing its part of the picture.
      const picture = ink(word.text, set.css, '#fff', { glows: [{ color: 'rgba(0,0,0,0.45)', radius: 3 * this.s }] })
      const whole = this.place(picture, set.spots[i], set.row, set.letters)
      const left = parseFloat(whole.style.left), top = parseFloat(whole.style.top)
      slices.push(Array.from({ length: BANDS }, (_, band) => {
        const part = document.createElement('canvas')
        const share = picture.el.height / BANDS
        part.width = picture.el.width
        part.height = Math.ceil(share)
        part.getContext('2d')?.drawImage(picture.el, 0, -band * share)
        Object.assign(part.style, { position: 'absolute', left: `${left}px`, top: `${top + band * picture.h / BANDS}px`, width: `${picture.w}px`,
          height: `${picture.h / BANDS}px`, opacity: '0' })
        block.appendChild(part)
        return part
      }))
    })
    this.torn = { line, block, slices, splits }
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    if (!this.torn || this.torn.line !== line || !this.torn.slices[index]) return
    if (!animated) { this.torn.slices[index].forEach((p) => { p.getAnimations().forEach((a) => a.cancel()); p.style.opacity = '1' }); return }
    const seed = line.index * 37 + index * 11
    this.tear(this.torn.slices[index], this.torn.splits[index], seed, delay, true)
    const later = 0.8 + 1.2 * chance(seed + 3)
    if (chance(seed + 9) < 0.25 && line.words[index].start + later + 0.2 < LyricScene.end(line) + 0.5) {
      this.tear(this.torn.slices[index], this.torn.splits[index], seed + 1, delay + later, false)
    }
  }

  tear(slices: HTMLElement[], splits: HTMLElement[], seed: number, delay: number, entering: boolean): void {
    const jolt = 11 * this.s, steps = 5, duration = 0.2
    slices.forEach((part, band) => {
      const moves = Array.from({ length: steps }, (_, step) => (step === steps - 1 ? 0 : jolt * (chance(seed * 7 + band * 3 + step) * 2 - 1)))
      this.animate(part, stepped(moves.map((x) => `${x}px 0px`), 'translate'), { duration, delay, hold: entering })
      if (entering) this.animate(part, stepped([0, 1, 0.6, 1, 1], 'opacity'), { duration, delay })
    })
    splits.forEach((split, side) => {
      const away = (side === 0 ? -1 : 1) * jolt * 0.8
      const frames: Keyframe[] = [away, away * 0.4, away * 1.3, away * 0.6, 0].map((x, i) => ({ translate: `${x}px 0px`, opacity: [0.9, 0.8, 0.9, 0.5, 0][i], offset: i / 4, easing: 'step-end' }))
      this.animate(split, frames, { duration: duration + 0.04, delay, hold: false })
      split.style.translate = '0px 0px'
      split.style.opacity = '0'
    })
  }
}

// ---- Cinema -----------------------------------------------------------------------------------------------------

/** A film's titles: the face picked, widely spaced, warm white; each word comes into focus out of a soft blur as it's
 *  sung, rising a hair, and the line drifts up and fades as the next one comes. */
export class CinemaScene extends LyricScene {
  title: { line: SceneLine; block: HTMLDivElement; words: { sharp: HTMLElement; soft: HTMLElement }[] } | null = null

  restyle(): void { this.title?.block.remove(); this.title = null }

  present(line: SceneLine | null, animated: boolean): void {
    if (this.title) {
      const old = this.title.block
      if (animated) {
        this.fadeAway(old, 0.45)
        this.animate(old, [{ translate: '0px 0px' }, { translate: `0px ${-22 * this.s}px` }], { duration: 0.5, easing: 'ease-in' })
      } else old.remove()
    }
    this.title = null
    if (!line?.words.length) return
    const kern = 1.2 * this.s
    const set = this.centered(line, Math.min(this.width - 40 * this.s, 380 * this.s), 33 * this.s, 3, { leading: 1.28, kern })
    const block = this.block(set.width, set.height, this.width / 2, this.height * 0.52)
    const inkColor = 'rgb(250,242,230)'
    const words = line.words.map((word, i) => {
      const sharp = this.place(ink(word.text, set.css, inkColor, { kern,
        glows: [{ color: cssColor(this.glow, 0.4), radius: 10 * this.s }, { color: 'rgba(0,0,0,0.5)', radius: 2.5 * this.s }] }), set.spots[i], set.row, set.letters)
      const soft = this.place(ink(word.text, set.css, inkColor, { kern, blur: 5 * this.s, detail: 0.5 }), set.spots[i], set.row, set.letters)
      sharp.style.opacity = '0'
      soft.style.opacity = '0'
      block.append(soft, sharp)
      return { sharp, soft }
    })
    this.title = { line, block, words }
  }

  sing(index: number, line: SceneLine, delay: number, animated: boolean): void {
    if (!this.title || this.title.line !== line || !this.title.words[index]) return
    const word = this.title.words[index]
    if (!animated) { word.sharp.getAnimations().forEach((a) => a.cancel()); word.sharp.style.opacity = '1'; return }
    // Out of a blur into focus, rising a little.
    this.animate(word.soft, [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 0.75, delay, easing: 'linear' })
    this.animate(word.sharp, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.6, delay: delay + 0.12, easing: 'ease-in-out' })
    for (const el of [word.sharp, word.soft]) {
      this.animate(el, [{ translate: `0px ${6 * this.s}px` }, { translate: '0px 0px' }], { duration: 0.9, delay, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
    }
  }
}

export const SCENES: Record<string, new (host: HTMLElement) => LyricScene> = {
  spread: SpreadScene, karaoke: KaraokeScene, typewriter: TypewriterScene, neon: NeonScene, echo: EchoScene, glitch: GlitchScene, cinema: CinemaScene,
}
