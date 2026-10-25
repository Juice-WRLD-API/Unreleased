// What every lyric style but the fisheye shares: it follows the song line by line and word by word, and wakes only
// as a line or a word is due - everything that moves is handed to the browser's own animations (Web Animations on
// opacity and transforms, which run off the page's thread), never redrawn frame by frame. A style says what a line
// looks like (present) and how a word comes in (sing); this does the rest: which line is sung now, catching up after
// a jump, holding still while the song is paused, and the song's name before the first line and through long breaks.
import { hsbToRgb, type AlbumColors } from '../light/engine'
import { faceCSS } from './looks'
import { cssColor, matchedSize, metricsOf, wrap, type FaceMetrics, type Picture, type RGB } from './type'
import { InterludeMark } from './interlude'
import type { TimedLyrics, TimedWord } from './timing'

export const LEAD = 0.1     // words start coming in this much before they're sung
export const AHEAD = 0.25   // how long before its moment a word is handed to the browser's animations
const SLACK = 1.5           // a step back this small is the clock being corrected, not a jump
const TITLE_TIME = 3        // how long the song's name stands at the start before the note takes its place

/** The song the lyrics are sung for. */
export interface StageSong { id: string; title: string; artist: string; lyrics: TimedLyrics }
/** Where the song is: `seconds` into it at `at` (epoch seconds), whether it runs on from there, and how fast. */
export interface StageClock { seconds: number; at: number; running: boolean; rate?: number }

/** The song's time now, by its clock. */
export const clockTime = (clock: StageClock): number =>
  clock.running ? clock.seconds + (epochNow() - clock.at) * (clock.rate ?? 1) : clock.seconds
export interface StageLook {
  clock: StageClock | null
  isSeen: boolean
  colors: AlbumColors | null
  face: string
  scale: number
  /** The app's own lyric settings: the text size for every style, the colors for one that follows them (Karaoke). */
  tune?: LyricTune
  /** Moves the song to `seconds`, for a style whose lines take a click (Karaoke); none, and they don't. */
  seek?: (seconds: number) => void
}
/** The app's lyric settings (Settings > Lyrics): the text size, and the line sung's and the others' colors (null:
 *  the style's own). */
export interface LyricTune { size: number; active: string | null; inactive: string | null }

/** What draws the lyrics: one of the styles here, or the fisheye. */
export interface LyricRenderer {
  show(song: StageSong, look: StageLook): void
  stop(): void
  destroy(): void
  /** The reader's wheel over the lyrics, for a style that scrolls (Karaoke). */
  scrollBy?(dy: number): void
}

export interface SceneLine { index: number; words: TimedWord[] }
export interface Block { css: string; size: number; spots: { x: number; y: number }[]; width: number; height: number; row: number; letters: number }

/** The time now, in the epoch seconds a clock is told in. */
export const epochNow = (): number => performance.timeOrigin / 1000 + performance.now() / 1000

export class LyricScene implements LyricRenderer {
  host: HTMLElement
  stage: HTMLDivElement
  interlude: InterludeMark
  watch: ResizeObserver
  seenSize = ''
  lines: SceneLine[] = []
  s = 1
  face: string | null = null
  colors: AlbumColors | null = null
  tune: LyricTune | null = null
  seek: ((seconds: number) => void) | null = null
  song: StageSong | null = null
  clock: StageClock | null = null
  isSeen = true
  /** The line on the stage: an index of lines, -1 for the song's name, null for nothing yet. */
  shown: number | null = null
  /** Its words come in so far. */
  sung = -1
  frozen = false
  alarm = 0
  /** The note is up for a break. */
  paused = false

  constructor(host: HTMLElement) {
    this.host = host
    host.innerHTML = ''
    this.stage = document.createElement('div')
    this.stage.className = 'scene'
    Object.assign(this.stage.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' })
    host.appendChild(this.stage)
    // Through a break in the singing, in the words' place.
    this.interlude = new InterludeMark(this.stage)
    this.watch = new ResizeObserver(() => {
      const size = `${host.clientWidth}x${host.clientHeight}`
      if (size === this.seenSize) return
      this.seenSize = size
      if (this.song && host.clientWidth > 0) { this.rebuild(); this.schedule() }
    })
    this.watch.observe(host)
  }

  get width(): number { return this.host.clientWidth }
  get height(): number { return this.host.clientHeight }

  // ---- for the styles ----

  present(_line: SceneLine | null, _animated: boolean): void {}
  sing(_index: number, _line: SceneLine, _delay: number, _animated: boolean): void {}
  restyle(): void {}

  /** Where the note stands through a break, `size` big, the stage emptied for it: in the words' middle, as most
   *  styles have it; a style keeping its other lines in sight makes room for it among them. `ahead`: before the
   *  first line. */
  interludeSpot(_size: { w: number; h: number }, _ahead: boolean, _animated: boolean): { x: number; y: number } {
    return { x: this.width / 2, y: this.height * 0.5 }
  }

  /** The style shows the song's name before the singing begins (for its first seconds, then the note). One that
   *  doesn't has the note from the start. */
  get showsTitle(): boolean { return true }

  /** The style sings the adlibs in the line, as written, rather than leaving them out. */
  get singsAdlibs(): boolean { return false }

  /** The app's lyric text size, 1 at its middle step. */
  get textSize(): number { return this.tune?.size || 1 }

  /** The face at `size`, matched to the standard's capitals, as a CSS font. */
  font(size: number): string { return faceCSS(this.face!, matchedSize(this.face!, size)) }
  metrics(size: number): FaceMetrics { return metricsOf(this.face!, matchedSize(this.face!, size)) }

  /** Animates `el` through `frames` from `delay` seconds now, holding the first frame until then (unless `hold` is
   *  false); the element is left at the last frame, so once done, and set with no animation, it simply stands there. */
  animate(el: HTMLElement, frames: Keyframe[], { duration, delay = 0, easing = 'ease-out', hold = true }: {
    duration: number; delay?: number; easing?: string; hold?: boolean
  }): Animation {
    const animation = el.animate(frames, { duration: duration * 1000, delay: delay * 1000, easing, fill: hold ? 'backwards' : 'none' })
    const last = frames[frames.length - 1]
    const style = el.style as unknown as Record<string, string>
    for (const key of Object.keys(last)) if (key !== 'offset' && key !== 'easing' && key !== 'composite') style[key] = String(last[key])
    if (this.frozen) animation.pause()
    return animation
  }

  /** Fades `el` out and takes it off the stage once gone. */
  fadeAway(el: HTMLElement, duration: number, delay = 0): void {
    const from = getComputedStyle(el).opacity
    el.getAnimations().forEach((a) => {
      const effect = a.effect as KeyframeEffect | null
      if (effect?.getKeyframes().some((k) => 'opacity' in k)) a.cancel()
    })
    this.animate(el, [{ opacity: from }, { opacity: 0 }], { duration, delay, easing: 'ease-in' }).finished
      .then(() => el.remove(), () => el.remove())
  }

  /** The song's main color made bright enough to glow, and its second; white for grey artwork. */
  get glow(): RGB {
    const c = this.colors?.primary
    return c ? hsbToRgb({ hue: c.hue, saturation: Math.min(c.saturation, 0.85), brightness: 1 }) : [1, 1, 1]
  }
  get secondGlow(): RGB {
    const c = this.colors?.secondary
    return c ? hsbToRgb({ hue: c.hue, saturation: Math.min(Math.max(c.saturation, 0.35), 0.85), brightness: 1 }) : [0.8, 0.8, 0.8]
  }

  /** A line's words set in centered rows `room` wide, the face at `size` made smaller until the line takes `most`
   *  rows at most: where each word's letters stand in the block (their top left), and the block's size. `size` and
   *  `most` are for the middle text size; a larger one sets the words larger and lets the line take more rows. */
  centered(line: SceneLine, room: number, size: number, most: number, { leading = 1.1, kern = 0 }: { leading?: number; kern?: number } = {}): Block {
    size *= this.textSize
    most = Math.max(most, Math.round(most * this.textSize))
    let css = this.font(size), set = wrap(line.words.map((w) => w.text), css, room, kern)
    while (set.rows.length > most && size > 9 * this.s) {
      size *= 0.9
      css = this.font(size)
      set = wrap(line.words.map((w) => w.text), css, room, kern)
    }
    const m = this.metrics(size)
    const row = Math.ceil((m.ascent + m.descent) * leading)
    const spots = set.places.map((p) => ({ x: (room - set.rows[p.row]) / 2 + p.x, y: p.row * row }))
    return { css, size, spots, width: room, height: set.rows.length * row, row, letters: m.ascent + m.descent }
  }

  /** Puts a picture with its letters' top left at `spot`, centered down a row `row` tall. */
  place(picture: Picture, spot: { x: number; y: number }, row: number | null, letters: number): HTMLCanvasElement {
    const el = picture.el
    el.style.position = 'absolute'
    el.style.left = `${spot.x - picture.pad}px`
    el.style.top = `${spot.y + ((row ?? letters) - letters) / 2 - picture.pad}px`
    return el
  }

  /** A block on the stage, `w` × `h`, its middle at (x, y). */
  block(w: number, h: number, x: number, y: number): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, { position: 'absolute', width: `${w}px`, height: `${h}px`, left: `${x - w / 2}px`, top: `${y - h / 2}px` })
    this.stage.appendChild(el)
    return el
  }

  // ---- following the song ----

  show(song: StageSong, { clock, isSeen, colors, face, scale, tune: tuned, seek }: StageLook): void {
    let redo = false
    this.seek = seek ?? null
    const tune = tuned ?? null
    const colorsChanged = JSON.stringify(colors) !== JSON.stringify(this.colors)
    const tuneChanged = JSON.stringify(tune) !== JSON.stringify(this.tune)
    if (face !== this.face || colorsChanged || tuneChanged || scale !== this.s) {
      this.face = face
      this.colors = colors
      this.tune = tune
      this.s = scale
      this.restyle()
      redo = true
    }
    if (song.id !== this.song?.id || song.lyrics !== this.song?.lyrics) {
      this.song = song
      this.lines = LyricScene.linesOf(song, this.singsAdlibs)
      redo = true
    }
    const clockChanged = JSON.stringify(clock) !== JSON.stringify(this.clock)
    this.clock = clock
    if (isSeen !== this.isSeen) { this.isSeen = isSeen; redo = redo || isSeen }
    this.freeze(!clock?.running)
    if (this.width > 0) {
      if (redo) this.rebuild()
      else if (clockChanged) this.catchUp()
    }
    this.schedule()
  }

  /** Nothing to show: the stage emptied, set again by the next show. */
  stop(): void {
    clearTimeout(this.alarm)
    this.interlude.hide(false)
    this.paused = false
    this.restyle()
    this.shown = null
    this.song = null
  }

  /** Another style takes the place. */
  destroy(): void {
    this.stop()
    this.watch.disconnect()
    this.stage.remove()
  }

  /** The song's timed lines with their words: the adlibs left out, or `withAdlibs` sung where they're written. */
  static linesOf(song: StageSong | null, withAdlibs = false): SceneLine[] {
    return (song?.lyrics?.lines || []).map((l) => (withAdlibs ? l.all ?? l.words : l.text?.trim() ? l.words : []))
      .filter((words) => words?.length).map((words, index) => ({ index, words }))
  }

  get titleLine(): SceneLine {
    return { index: -1, words: (this.song?.title || '').split(/\s+/).filter(Boolean).map((text) => ({ text, start: 0, end: 0.3 })) }
  }
  lineFor(index: number): SceneLine { return index >= 0 ? this.lines[index] : this.titleLine }
  static start(line: SceneLine): number { return line.words[0]?.start ?? 0 }
  static end(line: SceneLine): number { return line.words[line.words.length - 1]?.end ?? LyricScene.start(line) }

  /** The stage's clock stops with the song, so a word on its way stops where it is, and goes on with it. */
  freeze(stop: boolean): void {
    if (stop === this.frozen) return
    this.frozen = stop
    for (const a of this.stage.getAnimations({ subtree: true })) if (stop) a.pause(); else a.play()
  }

  /** A break: the note in the words' place - once the singing has begun, or before it, after the song's name has
   *  stood a while, with the first line still a way off. */
  isBreak(target: number, time: number): boolean {
    if (target !== -1 || !this.lines.length) return false
    const first = LyricScene.start(this.lines[0])
    return time >= first || ((!this.showsTitle || time >= TITLE_TIME) && first - time >= 2.5)
  }

  /** The words gone for a break, and the note up in their place, counting down to the next line. */
  pause(now: number, animated: boolean): void {
    this.paused = true
    this.present(null, animated)
    this.sung = this.titleLine.words.length - 1
    let last = -1
    this.lines.forEach((l, i) => { if (LyricScene.start(l) <= now) last = i })
    const next = last >= 0 ? (this.lines[last + 1] ? LyricScene.start(this.lines[last + 1]) : null)
      : (this.lines[0] ? LyricScene.start(this.lines[0]) : null)
    this.interlude.show({ now, next, size: 46 * this.s, color: 'rgb(250, 242, 230)', glow: cssColor(this.glow),
      animated, began: last >= 0 ? LyricScene.end(this.lines[last]) + 2.5 : null, frozen: this.frozen })
    const spot = this.interludeSpot(this.interlude.size, last < 0, animated)
    this.interlude.at(spot.x, spot.y)
  }

  get now(): number | null {
    if (!this.clock) return null
    return clockTime(this.clock) + LEAD
  }
  get isRunning(): boolean { return this.isSeen && Boolean(this.clock?.running) && this.width > 0 }

  /** The line being sung at `time`: its index, -1 before the first or through a long break (the song's name then). */
  lineAt(time: number): number {
    let low = 0, high = this.lines.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (LyricScene.start(this.lines[middle]) <= time) low = middle + 1; else high = middle
    }
    const index = low - 1
    if (index < 0) return -1
    return this.resting(index, time) ? -1 : index
  }

  resting(index: number, time: number): boolean {
    const next = this.lines[index + 1] ? LyricScene.start(this.lines[index + 1]) : Infinity
    const quiet = LyricScene.end(this.lines[index]) + 2.5
    return time >= quiet && next - quiet > 3
  }

  due(line: SceneLine, time: number): number {
    if (line.index < 0) return line.words.length - 1
    let last = -1
    line.words.forEach((w, i) => { if (w.start <= time) last = i })
    return last
  }

  rebuild(): void {
    const now = this.now
    if (!this.isSeen || now == null || this.width <= 0) return
    const target = this.lineAt(now)
    this.shown = target
    this.sung = -1
    if (this.isBreak(target, now)) { this.pause(now, false); return }
    this.paused = false
    this.interlude.hide(false)
    const line = this.lineFor(target)
    this.present(line, false)
    const through = this.due(line, now)
    for (let word = 0; word <= through; word++) this.sing(word, line, 0, false)
    this.sung = through
  }

  catchUp(): void {
    const now = this.now
    if (!this.isSeen || now == null) return
    if (this.shown == null) { this.rebuild(); return }
    const target = this.lineAt(now), shown = this.shown
    if (target === shown && target === -1 && !this.paused && this.isBreak(target, now)) this.cut(target, now)
    else if (target === shown) {
      const line = this.lineFor(target)
      const through = this.due(line, now)
      if (through > this.sung) {
        if (through - this.sung <= 3) this.singThrough(through, line, now); else this.rebuild()
      } else if (through < this.sung && target >= 0 && line.words[Math.max(this.sung, 0)].start - now > SLACK) this.rebuild()
    } else if (target === shown + 1 || (target === -1 && shown >= 0)
      || (shown === -1 && target >= 0 && now - LyricScene.start(this.lines[target]) < 1)) this.cut(target, now)
    else this.rebuild()
  }

  cut(target: number, now: number): void {
    this.shown = target
    this.sung = -1
    if (this.isBreak(target, now)) { this.pause(now, true); return }
    this.paused = false
    this.interlude.hide(true)
    const line = this.lineFor(target)
    this.present(line, true)
    if (target === -1) {
      line.words.forEach((_, word) => this.sing(word, line, 0.25 + word * 0.07, true))
      this.sung = line.words.length - 1
    } else this.singThrough(this.due(line, now + AHEAD), line, now)
  }

  singThrough(through: number, line: SceneLine, now: number): void {
    if (through <= this.sung) return
    for (let word = this.sung + 1; word <= through; word++) this.sing(word, line, Math.max(line.words[word].start - now, 0), true)
    this.sung = through
  }

  schedule(): void {
    clearTimeout(this.alarm)
    const now = this.now
    if (!this.isRunning || now == null || this.shown == null) return
    const next: number[] = []
    if (this.shown >= 0) {
      const line = this.lines[this.shown]
      if (line.words[this.sung + 1]) next.push(line.words[this.sung + 1].start - AHEAD)
      const after = this.lines[this.shown + 1] ? LyricScene.start(this.lines[this.shown + 1]) : Infinity
      const quiet = LyricScene.end(line) + 2.5
      if (after - quiet > 3) next.push(quiet)
    }
    const coming = this.lines.findIndex((l) => LyricScene.start(l) > now)
    if (coming >= 0 && coming > this.shown) next.push(LyricScene.start(this.lines[coming]))
    // The song's name gives way to the note.
    if (this.shown === -1 && !this.paused && now < TITLE_TIME) next.push(TITLE_TIME)
    if (!next.length) return
    this.alarm = window.setTimeout(() => this.tick(), Math.max((Math.min(...next) - now) * 1000, 1))
  }

  tick(): void {
    const now = this.now
    if (!this.isRunning || now == null || this.shown == null) return
    const target = this.lineAt(now)
    if (target !== this.shown || (target === -1 && !this.paused && this.isBreak(target, now))) this.cut(target, now)
    else if (target >= 0) this.singThrough(this.due(this.lines[target], now + AHEAD), this.lines[target], now)
    this.schedule()
  }
}
