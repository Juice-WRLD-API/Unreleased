import { RefObject, useLayoutEffect } from 'react'
import { useExitGhost } from './useExitGhost'

const ENTER_EASE = 'cubic-bezier(0.33, 0, 0.15, 1)'
const EXIT_EASE = 'cubic-bezier(0.4, 0, 0.6, 1)'

// The dialog inside an overlay: its last element child - when the scrim is a
// layer of its own (absolute inset-0) it comes first.
function panelOf(root: HTMLElement): HTMLElement | null {
  const el = root.lastElementChild
  return el instanceof HTMLElement ? el : null
}

// A panel resting on the bottom edge is a sheet and travels its full height;
// a centered dialog only lifts a little.
function isSheet(panel: HTMLElement): boolean {
  return panel.getBoundingClientRect().bottom >= window.innerHeight - 1
}

// Open/close motion for a modal overlay - a full-window root holding the scrim
// and the dialog. The whole root fades (scrim and dialog together) while the
// dialog rises into place; closing reverses it on a copy left behind by
// useExitGhost. The rise is composited onto whatever transform the dialog
// already has, so a sheet released mid swipe-to-dismiss carries on down from
// where the finger left it.
export function useOverlayMotion(ref: RefObject<HTMLElement>, enabled = true): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!enabled || !root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const panel = panelOf(root)
    const sheet = !!panel && isSheet(panel)
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: ENTER_EASE })
    panel?.animate(
      [{ transform: sheet ? 'translateY(100%)' : 'translateY(14px)' }, { transform: 'translateY(0)' }],
      { duration: sheet ? 420 : 340, easing: ENTER_EASE, composite: 'add' },
    )
    // Mount only - the dialog's own re-renders aren't openings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useExitGhost(ref, enabled ? (ghost) => {
    const panel = panelOf(ghost)
    const sheet = !!panel && isSheet(panel)
    const duration = sheet ? 260 : 200
    panel?.animate(
      [{ transform: 'translateY(0)' }, { transform: sheet ? 'translateY(100%)' : 'translateY(10px)' }],
      { duration, easing: EXIT_EASE, fill: 'forwards', composite: 'add' },
    )
    return ghost.animate([{ opacity: 0 }], { duration, easing: EXIT_EASE, fill: 'forwards' })
  } : null)
}
