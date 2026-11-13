import { useLayoutEffect } from 'react'
import type { ViewType } from '../types'

// Opening WRLD from the desktop player bar: WRLD slides up like a sheet from
// where the bar sat, over the page you were on. Everything stays live (no
// view-transition snapshots, which flatten the glass nav pill): App keeps the
// previous view mounted under WRLD until the slide ends, and WRLD animates
// its own page with transform and opacity.

const DURATION_MS = 550
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
/** Corner radius of the floating bar the sheet grows out of. */
const BAR_RADIUS = 22
/** Drop the view under WRLD if WRLD hasn't mounted by then. */
const GIVE_UP_MS = 3000

type Expand = { barTop: number; started: boolean }

let current: Expand | null = null
let giveUp: ReturnType<typeof setTimeout> | null = null

function setCurrent(next: Expand | null): void {
  const ended = current !== null && next === null
  current = next
  // Player holds --player-dock while the slide runs (the page under WRLD keeps
  // its layout). With the bar gone now, release that room.
  if (ended && !document.querySelector('[data-wrld-expand="bar"]')) {
    document.documentElement.style.setProperty('--player-dock', '0px')
  }
  if (giveUp) { clearTimeout(giveUp); giveUp = null }
  if (next) giveUp = setTimeout(() => { if (current === next && !next.started) setCurrent(null) }, GIVE_UP_MS)
}

/** True while the slide is pending or running, so WRLD skips its usual fade. */
export function isExpandingToWrld(): boolean {
  return current !== null
}

/** Calls `open` (which switches to WRLD) and slides WRLD up from the bar, or
 *  just opens it when there's no bar on screen or the user asked for reduced
 *  motion. `from` is the view being left, kept under the sheet. */
export function expandToWrld(open: () => void, from: ViewType): void {
  const bar = document.querySelector<HTMLElement>('[data-wrld-expand="bar"]')
  if (!bar || bar.offsetHeight === 0 || from === 'wrld' || current
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    open()
    return
  }
  setCurrent({ barTop: bar.getBoundingClientRect().top, started: false })
  open()
}

/** WRLD calls this with its page element: on mount, runs the slide if one is
 *  pending. */
export function useWrldExpandIn(ref: React.RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const el = ref.current
    const expand = current
    if (!el || !expand || expand.started) return
    expand.started = true
    const offset = Math.max(0, expand.barTop - el.getBoundingClientRect().top)
    const slide = el.animate(
      [
        { transform: `translateY(${offset}px)`, borderRadius: `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0` },
        { transform: 'none', borderRadius: '0' },
      ],
      { duration: DURATION_MS, easing: EASING },
    )
    const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS * 0.4, easing: EASING })
    slide.onfinish = () => { if (current === expand) setCurrent(null) }
    return () => {
      slide.onfinish = null
      slide.cancel()
      fade.cancel()
      // StrictMode (dev) unmounts and remounts at once: let the remount run
      // the slide again. A real unmount mid-slide ends the expand.
      expand.started = false
      setTimeout(() => { if (current === expand && !expand.started) setCurrent(null) }, 0)
    }
  }, [ref])
}
