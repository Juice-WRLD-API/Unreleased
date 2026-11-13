// iOS-like wheel scrolling, app-wide. A mouse wheel notch normally jumps
// ~100px in a short fixed animation and stops dead; here each notch moves a
// target and the scroller under the pointer glides toward it, slowing down
// the whole way (exponential decay), so quick notches build up speed and
// coast out.
//
// One window listener (bubble phase, so element handlers that call
// preventDefault, like Home's sideways strips, win) picks the scroller the
// browser would: the nearest ancestor that can still move this way, chaining
// outward past ones at their edge unless they set overscroll-behavior.
//
// Left native: trackpads (small or fractional pixel deltas, they carry their
// own momentum), ctrl+wheel zoom, horizontal wheels, scrollers with scroll
// snapping or scroll-behavior: smooth, anything inside [data-native-wheel],
// and everything under reduced motion. Scrollbar drags, keys and programmatic
// scrolls aren't fought: the glide lets go and restarts from wherever the
// scroller actually is.

// How quickly the glide closes on its target: about 63% of the remaining
// distance every TAU ms. Higher feels floatier.
const TAU = 120
// Each wheel notch travels a little further than the native step, since the
// glide spends its last stretch slowing down.
const GAIN = 1.15
const LINE_PX = 40

interface Glide { target: number; current: number; frame: number; last: number }
const glides = new WeakMap<HTMLElement, Glide>()

function isTrackpadWheel(e: WheelEvent): boolean {
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false
  return Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY)
}

// Where the scroller is headed: the glide's target while one runs.
const glideHeadedTo = (el: HTMLElement): number => {
  const g = glides.get(el)
  return g?.frame ? g.target : el.scrollTop
}

function canScrollFurther(el: HTMLElement, dy: number): boolean {
  const pos = glideHeadedTo(el)
  return dy < 0 ? pos > 0.5 : pos < el.scrollHeight - el.clientHeight - 0.5
}

// The scroller this wheel belongs to, or null to leave it to the browser.
function wheelScrollerFor(e: WheelEvent): HTMLElement | null {
  for (let el = e.target as Element | null; el && el !== document.documentElement; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue
    if (el.hasAttribute('data-native-wheel')) return null
    if (el.scrollHeight <= el.clientHeight + 1) continue
    const style = getComputedStyle(el)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    if (canScrollFurther(el, e.deltaY)) {
      if (style.scrollSnapType !== 'none' || style.scrollBehavior === 'smooth') return null
      return el
    }
    if (style.overscrollBehaviorY !== 'auto') return null
  }
  return null
}

function stopGlide(el: HTMLElement): void {
  const g = glides.get(el)
  if (g?.frame) { cancelAnimationFrame(g.frame); g.frame = 0 }
}

function startGlide(el: HTMLElement, px: number): void {
  let g = glides.get(el)
  if (!g) { g = { target: 0, current: 0, frame: 0, last: 0 }; glides.set(el, g) }
  if (!g.frame) { g.current = el.scrollTop; g.target = g.current }
  // Reversing direction drops the rest of the old glide at once.
  if (g.target !== g.current && Math.sign(px) !== Math.sign(g.target - g.current)) g.target = g.current
  g.target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, g.target + px * GAIN))
  if (g.frame) return
  const s = g
  s.last = performance.now()
  const step = (now: number): void => {
    const dt = Math.min(64, now - s.last)
    s.last = now
    // Someone else moved it (scrollbar drag, keys, scrollIntoView): let go.
    if (Math.abs(el.scrollTop - Math.round(s.current)) > 2) { s.frame = 0; return }
    s.current += (s.target - s.current) * (1 - Math.exp(-dt / TAU))
    if (Math.abs(s.target - s.current) < 0.5) s.current = s.target
    el.scrollTop = s.current
    if (s.current === s.target) { s.frame = 0; return }
    s.frame = requestAnimationFrame(step)
  }
  s.frame = requestAnimationFrame(step)
}

export function installSmoothWheel(): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onWheel = (e: WheelEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || reduced.matches) return
    if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const el = wheelScrollerFor(e)
    if (!el) return
    if (isTrackpadWheel(e)) { stopGlide(el); return }
    e.preventDefault()
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_PX
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * el.clientHeight
      : e.deltaY
    startGlide(el, px)
  }
  window.addEventListener('wheel', onWheel, { passive: false })
  return () => window.removeEventListener('wheel', onWheel)
}
