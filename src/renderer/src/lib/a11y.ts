import type { KeyboardEvent, MouseEvent } from 'react'

// Keyboard activation for the clickable things that can't actually be a
// <button>: track rows, cards and list items that already contain their own
// buttons, which nesting would make invalid HTML. Spread it in place of the
// element's onClick:
//
//   <div {...clickable(() => playTrack(track))} className="...">
//
// Enter and Space both fire, matching a native button. The currentTarget
// check is what makes that safe to put on a container - with focus on the
// row's own "more" button, Enter should press that button and not also play
// the track.
//
// Focus styling is central, in index.css: `[role="button"]:focus-visible`.
// These become real tab stops, so they need the ring a native control has.
// `onActivate` receives the element itself, for the handlers that need to
// anchor something to it (see anchorOf). Callers that don't care just take
// no argument.
export function clickable(onActivate: (el: HTMLElement) => void): {
  role: 'button'
  tabIndex: 0
  onClick: (e: MouseEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: (e) => onActivate(e.currentTarget),
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      onActivate(e.currentTarget)
    },
  }
}

// Stand-in for a cursor position when a popover is opened from the keyboard:
// the element's own bottom-left corner, so the card hangs off the thing that
// was activated rather than off wherever the mouse happens to be.
export function anchorOf(el: HTMLElement): { clientX: number; clientY: number } {
  const r = el.getBoundingClientRect()
  return { clientX: r.left, clientY: r.bottom }
}
