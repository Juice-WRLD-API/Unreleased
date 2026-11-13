import { useLayoutEffect, useRef } from 'react'
import { isExpandingToWrld } from '../lib/wrldExpand'
import { reducedMotion, swapIn } from '../lib/dashboardSwap'

// Fades and lifts a view in as it becomes the one on screen: on mount for most
// views, and on coming back out from under the terminal for the views held
// there (App.tsx). A one-shot Web Animation with no fill, so nothing is left on
// the view afterwards - a lingering transform would make every position:fixed
// overlay inside it position against the view instead of the window. The
// wrapper is display: contents, so the view lays out exactly as it would
// without it. Between Home and a staff dashboard (`swap`, lib/dashboardSwap.ts)
// the widgets swipe in instead and the page itself doesn't move, so the two
// entrances never stack.
export default function ViewFade({ view, active, swap = 0, wholePageSwap = false, children }: { view: string; active: boolean; swap?: 0 | 1 | -1; wholePageSwap?: boolean; children: React.ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current?.firstElementChild
    // Expanding into WRLD from the player bar is its own entrance.
    if (!(el instanceof HTMLElement) || isExpandingToWrld() || reducedMotion()) return
    if (swap && (wholePageSwap || el.querySelector('[data-swap]'))) { swapIn(el, swap, wholePageSwap); return }
    el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(0.33, 0, 0.15, 1)' },
    )
    // Read at mount only, like the fade itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return <div ref={ref} data-view={view} className={active ? 'contents' : 'hidden'}>{children}</div>
}
