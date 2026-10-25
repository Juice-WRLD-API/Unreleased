// Through a break in the singing - the beat alone, a hum - the words go and a note stands in their place, breathing,
// three dots beneath it lighting one by one until the singing comes back. Set once per break, everything that moves
// handed to the browser's own animations (opacity and transforms), nothing redrawn as it plays. The lyric styles and
// the fisheye share it.

// The note, as Apple's "music.note" draws it near enough: a head and a stem with a flag, in a 24-point box.
const NOTE_PATH = 'M9.5 21.2c-2.3 0-3.9-1.3-3.9-3.1 0-2.1 2-3.7 4.6-3.7.6 0 1.2.1 1.7.3V4.6c0-.8.5-1.4 1.2-1.6l5.2-1.4c.9-.2 1.7.4 1.7 1.3v2.9c0 .7-.4 1.2-1.1 1.4l-4.6 1.2v9.6c0 1.9-2 3.2-4.8 3.2z'
let notePath: Path2D | null = null

export interface InterludeShow {
  /** The song's time now. */
  now: number
  /** When the singing comes back; null when it doesn't. */
  next: number | null
  size: number
  color: string
  glow: string
  animated: boolean
  /** When the break began, so the dots are as far on as it is. */
  began?: number | null
  /** The song is paused, so is the note. */
  frozen?: boolean
}

export class InterludeMark {
  isUp = false
  /** The size and colors it's drawn for. */
  drawn: string | null = null
  el: HTMLDivElement
  sway: HTMLDivElement
  note: HTMLCanvasElement
  dots: HTMLDivElement[]
  w = 0
  h = 0

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    Object.assign(this.el.style, { position: 'absolute', left: '0', top: '0', opacity: '0', pointerEvents: 'none', zIndex: '10' })
    this.sway = document.createElement('div')
    this.sway.style.position = 'absolute'
    this.note = document.createElement('canvas')
    this.note.style.position = 'absolute'
    this.sway.appendChild(this.note)
    this.el.appendChild(this.sway)
    this.dots = [0, 1, 2].map(() => {
      const dot = document.createElement('div')
      Object.assign(dot.style, { position: 'absolute', borderRadius: '50%' })
      this.el.appendChild(dot)
      return dot
    })
    parent.appendChild(this.el)
  }

  /** Its size, once drawn. */
  get size(): { w: number; h: number } { return { w: this.w, h: this.h } }

  /** Stands with its middle at (x, y). */
  at(x: number, y: number): void {
    this.el.style.left = `${x - this.size.w / 2}px`
    this.el.style.top = `${y - this.size.h / 2}px`
  }

  /** Comes up for a break. Not `animated`, it simply stands there, its dots as far on as the break is. */
  show({ now, next, size, color, glow, animated, began = null, frozen = false }: InterludeShow): void {
    this.draw(size, color, glow)
    this.isUp = true
    this.cancel()
    this.el.style.opacity = '1'
    this.el.style.transform = ''
    const run = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Animation => {
      const animation = el.animate(frames, options)
      if (frozen) animation.pause()
      return animation
    }
    if (animated) {
      run(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 150, easing: 'ease-out', fill: 'backwards' })
      run(this.el, [{ transform: 'scale(0.7)' }, { transform: 'scale(1)' }],
        { duration: 700, delay: 150, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)', fill: 'backwards' })
    }
    // The note breathes, slowly, and sways a little.
    run(this.note, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }],
      { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
    run(this.sway, [{ transform: 'rotate(-0.06rad)' }, { transform: 'rotate(0.06rad)' }],
      { duration: 1600, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
    // The dots light one by one as the break runs out: the last a moment before the singing is back. With no end to
    // it, they ripple.
    this.dots.forEach((dot, index) => {
      if (next != null && next > now) {
        const start = began ?? now
        const length = Math.max(next - start, 0.6)
        const lit = start + (length * (index + 1)) / 3.6 - now
        dot.style.opacity = '1'
        if (lit > 0) {
          run(dot, [{ opacity: 0.22 }, { opacity: 1 }], { duration: 350, delay: lit * 1000, easing: 'ease-out', fill: 'backwards' })
          run(dot, [{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }],
            { duration: 450, delay: lit * 1000, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)', fill: 'backwards' })
        }
      } else {
        dot.style.opacity = '0.22'
        run(dot, [{ opacity: 0.22 }, { opacity: 1 }],
          { duration: 500, delay: 250 * index, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
      }
    })
  }

  /** The singing is back: the note shrinks away. Not `animated`, it's simply gone. */
  hide(animated: boolean): void {
    if (!this.isUp) return
    this.isUp = false
    const from = getComputedStyle(this.el).opacity
    this.cancel()
    this.el.style.opacity = '0'
    if (!animated) return
    this.el.animate([{ opacity: from, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.8)' }],
      { duration: 300, easing: 'ease-in' })
  }

  /** Holds still with the song paused, and goes on with it. */
  hold(stop: boolean): void {
    for (const a of this.el.getAnimations({ subtree: true })) if (stop) a.pause(); else a.play()
  }

  cancel(): void {
    for (const a of this.el.getAnimations({ subtree: true })) a.cancel()
  }

  /** The note as a picture, its glow baked in, and the dots under it. */
  draw(size: number, color: string, glow: string): void {
    const key = `${size}|${color}|${glow}`
    if (this.drawn === key) return
    this.drawn = key
    notePath ??= new Path2D(NOTE_PATH)
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    const margin = size * 0.45
    const box = size + 2 * margin
    const g = this.note.getContext('2d')
    this.note.width = Math.ceil(box * scale)
    this.note.height = Math.ceil(box * scale)
    Object.assign(this.note.style, { width: `${box}px`, height: `${box}px` })
    if (g) {
      g.setTransform(scale, 0, 0, scale, 0, 0)
      g.clearRect(0, 0, box, box)
      g.translate(margin, margin)
      g.scale(size / 24, size / 24)
      g.shadowColor = glow
      g.shadowBlur = size * 0.35 * scale
      g.fillStyle = color
      g.fill(notePath)
      g.shadowBlur = 0
      g.fill(notePath)
    }

    const dot = size * 0.15, gap = size * 0.3, below = size * 0.12
    const w = Math.max(box, 3 * dot + 2 * gap)
    const h = box - margin + below + dot
    this.w = w
    this.h = h
    Object.assign(this.el.style, { width: `${w}px`, height: `${h}px` })
    // The note sways from its middle.
    Object.assign(this.sway.style, { left: `${(w - box) / 2}px`, top: '0', width: `${box}px`, height: `${box}px` })
    this.dots.forEach((el, index) => Object.assign(el.style, {
      width: `${dot}px`, height: `${dot}px`, background: color, boxShadow: `0 0 ${dot * 1.2}px ${glow}`,
      left: `${w / 2 + (index - 1) * (dot + gap) - dot / 2}px`, top: `${box - margin + below}px`,
    }))
  }
}
