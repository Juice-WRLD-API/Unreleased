import type { ViewType } from '../types'

// Moving between Home and a staff dashboard (both built from Tile widgets)
// swipes the widgets across: the old page's slide out one way while the new
// page's slide in from the other side. The new page is live React (ViewFade
// runs swapIn on it); the old one has already unmounted by then, so what
// slides out is a copy of its DOM taken just before the switch
// (captureLeaving), laid over the view box and removed once it has run.

const TILE_DASHBOARDS: ViewType[] = ['home', 'editor-profile', 'contributor-profile']

const PX = 56
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
/** The new widgets start this long after the old ones begin to leave. */
const ENTER_AFTER = 110

/** 1 when going from Home into a staff dashboard, -1 coming back, 0 for any
 *  other move. Incoming widgets slide in from that side (1 = from the right)
 *  and outgoing ones leave toward the other. */
export function dashboardSwap(from: ViewType | null, to: ViewType): 0 | 1 | -1 {
  if (!from || from === to || !TILE_DASHBOARDS.includes(from) || !TILE_DASHBOARDS.includes(to)) return 0
  return to === 'home' ? -1 : 1
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A page's [data-swap] widgets. A widget inside another moves with it. */
function widgets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-swap]'))
    .filter((el) => !el.parentElement?.closest('[data-swap]'))
}

/** The widgets in reading order (tops within 12px count as one row), with
 *  the ones off screen last. */
function readingOrder(els: HTMLElement[]): HTMLElement[] {
  const vh = window.innerHeight
  return els
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .map((x) => ({ ...x, off: x.r.width === 0 || x.r.bottom <= 0 || x.r.top >= vh }))
    .sort((a, b) => (a.off !== b.off ? (a.off ? 1 : -1)
      : Math.abs(a.r.top - b.r.top) > 12 ? a.r.top - b.r.top : a.r.left - b.r.left))
    .map(({ el }) => el)
}

const enterDelay = (i: number): number => ENTER_AFTER + Math.min(i * 40, 280)

/** Slides the new page's widgets in from the `dir` side. fill: 'backwards'
 *  hides each during its delay and leaves nothing on it afterwards.
 *  Every widget is started now, so none can show before its turn: Home's
 *  first layout is before it has measured its width, with the bento still
 *  stacked and the lower tiles (Tools) below the window. The stagger is put
 *  in order again two frames later, once that has settled; every delay is
 *  still ahead then. */
export function swapIn(root: HTMLElement, dir: 1 | -1): void {
  const runs = new Map<HTMLElement, Animation>()
  readingOrder(widgets(root)).forEach((el, i) => {
    runs.set(el, el.animate(
      [{ opacity: 0, transform: `translateX(${dir * PX}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 520, delay: enterDelay(i), easing: EASE, fill: 'backwards' },
    ))
  })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    readingOrder([...runs.keys()]).forEach((el, i) => runs.get(el)?.effect?.updateTiming({ delay: enterDelay(i) }))
  }))
}

let current: HTMLElement | null = null

/** Copies the leaving page now, while its DOM is still on screen, and returns
 *  a function that lays the copy over `box` and swipes its widgets out. Call
 *  that once the new page has committed (before paint). */
export function captureLeaving(box: HTMLElement, page: Element, dir: 1 | -1): () => void {
  const copy = page.cloneNode(true) as HTMLElement
  // Scroll offsets and canvas pixels don't survive cloneNode.
  const from = page.querySelectorAll('*')
  const to = copy.querySelectorAll('*')
  const scrolled: [Element, number, number][] = []
  from.forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) scrolled.push([to[i], el.scrollTop, el.scrollLeft])
    if (el instanceof HTMLCanvasElement) {
      try { (to[i] as HTMLCanvasElement).getContext('2d')?.drawImage(el, 0, 0) } catch { /* tainted or webgl */ }
    }
  })
  // The copy must lay out exactly as the page did, or something reflows as it
  // leaves: On this day sat a few pixels over the width of three columns, and
  // a scrollbar appearing in the copy dropped it to two. So every box in the
  // copy is held at the size it had on screen (fractional, from the rects
  // read here), and nothing inside can re-flow whatever else differs. Inline
  // boxes ignore a width, and display: none / contents have no rect to keep.
  // The layer also takes the box's `scroll-under` class, which Home's bottom
  // padding hangs off and which the box loses once a dashboard is in it.
  const sizes: [HTMLElement, number, number][] = []
  from.forEach((el, i) => {
    const twin = to[i]
    if (!(el instanceof HTMLElement) || !(twin instanceof HTMLElement)) return
    const r = el.getBoundingClientRect()
    if (r.width || r.height) sizes.push([twin, r.width, r.height])
  })
  const root = page.getBoundingClientRect()
  sizes.push([copy, root.width, root.height])
  for (const [twin, w, h] of sizes) {
    Object.assign(twin.style, { width: `${w}px`, height: `${h}px`, minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none', flex: '0 0 auto', boxSizing: 'border-box' })
  }
  const scrollUnder = box.classList.contains('scroll-under')
  // The shared top line (HomeHero) is on the new page in the same spot, so
  // the copy's own stays out of sight and the line never seems to move.
  copy.querySelectorAll<HTMLElement>('[data-swap-keep]').forEach((el) => { el.style.visibility = 'hidden' })
  const cs = getComputedStyle(box)
  const padding = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ')

  return () => {
    current?.remove()
    const layer = document.createElement('div')
    layer.className = `absolute inset-0 flex pointer-events-none ${scrollUnder ? 'scroll-under' : ''}`
    layer.setAttribute('aria-hidden', 'true')
    layer.inert = true
    layer.style.padding = padding
    layer.appendChild(copy)
    box.appendChild(layer)
    current = layer
    for (const [el, top, left] of scrolled) { el.scrollTop = top; el.scrollLeft = left }

    const runs = readingOrder(widgets(copy)).map((el, i) => el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * PX}px)` }],
      { duration: 380, delay: Math.min(i * 30, 210), easing: EASE, fill: 'forwards' },
    ))
    // Anything on the page that isn't a widget goes with the last of them.
    runs.push(layer.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
      { duration: 600, easing: 'linear', fill: 'forwards' },
    ))
    void Promise.all(runs.map((a) => a.finished)).catch(() => undefined).finally(() => {
      layer.remove()
      if (current === layer) current = null
    })
  }
}
