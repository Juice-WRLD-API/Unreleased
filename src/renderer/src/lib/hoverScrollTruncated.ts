/** Hovering text cut off with an ellipsis (Tailwind `truncate`, or any
 *  `text-overflow: ellipsis`) scrolls it sideways so the whole thing can be
 *  read: after a short rest it glides to the end, holds, slides back, and
 *  repeats while the pointer stays on it. Leaving puts it back as it was.
 *
 *  One document-level listener instead of a wrapper component, so it reaches
 *  every truncated label in the app (menus, rows, headers, pop-out windows)
 *  without touching each call site. It drives the element's own scrollLeft -
 *  overflow:hidden boxes still scroll programmatically - so layout is never
 *  changed. Mouse/pen only: touch has no hover to end the loop. */

const START_DELAY = 450   // ms resting on the text before it moves
const SPEED = 40          // px/s toward the end
const RETURN_SPEED = 160  // px/s back to the start
const END_HOLD = 1200     // ms paused showing the end
const START_HOLD = 900    // ms paused at the start before looping
const MAX_DEPTH = 6       // ancestors checked above the hovered node

let active: { el: HTMLElement; stop: () => void } | null = null

function findTruncated(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof Element ? node : null
  for (let depth = 0; el && el !== document.body && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return null
    // Cheap size check first so getComputedStyle only runs on boxes that
    // actually overflow.
    if (el.scrollWidth - el.clientWidth < 2) continue
    const cs = getComputedStyle(el)
    if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') return el
  }
  return null
}

function start(el: HTMLElement): () => void {
  const prevTextOverflow = el.style.textOverflow
  const prevScrollBehavior = el.style.scrollBehavior
  el.style.scrollBehavior = 'auto'
  let raf = 0
  let timer = 0

  const glide = (to: number, speed: number, then: () => void): void => {
    const from = el.scrollLeft
    const duration = (Math.abs(to - from) / speed) * 1000
    const t0 = performance.now()
    const step = (now: number): void => {
      if (!el.isConnected) { stopIt(); return }
      const p = duration > 0 ? Math.min(1, (now - t0) / duration) : 1
      el.scrollLeft = from + (to - from) * p
      if (p < 1) raf = requestAnimationFrame(step)
      else then()
    }
    raf = requestAnimationFrame(step)
  }

  const loop = (): void => {
    const max = el.scrollWidth - el.clientWidth
    if (max < 2 || !el.isConnected) return
    // Ellipsis would stay drawn at the right edge while scrolled.
    el.style.textOverflow = 'clip'
    glide(max, SPEED, () => {
      timer = window.setTimeout(() => glide(0, RETURN_SPEED, () => {
        el.style.textOverflow = prevTextOverflow
        timer = window.setTimeout(loop, START_HOLD)
      }), END_HOLD)
    })
  }

  const stopIt = (): void => {
    clearTimeout(timer)
    cancelAnimationFrame(raf)
    el.scrollLeft = 0
    el.style.textOverflow = prevTextOverflow
    el.style.scrollBehavior = prevScrollBehavior
  }

  timer = window.setTimeout(loop, START_DELAY)
  return stopIt
}

function stopActive(): void {
  active?.stop()
  active = null
}

export function installHoverScrollTruncated(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = findTruncated(e.target)
    if (el === active?.el) return
    stopActive()
    if (el) active = { el, stop: start(el) }
  }, { passive: true })
  // Pointer left the window entirely.
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) stopActive() }, { passive: true })
  window.addEventListener('blur', stopActive)
}
