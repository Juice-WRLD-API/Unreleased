import { useMemo, useRef } from 'react'

// Touch-press handling for list rows. A phone has no right-click, so long-press
// is the only way into a selection - and it has to be careful about it:
//
//   · a press that turns into a scroll must not select (the slop check)
//   · the tap that ends a long press must not also open/play the row (the
//     `consumed` flag, which the click handler clears)
//   · the browser's own long-press behaviour (text selection, callout menu)
//     has to be suppressed, which is what preventing contextmenu does
//
// Returns one stable handler object, so it can be spread onto a memoized row
// without defeating the memo.
//
// Being a hook, this only works where each row is its own component. Files
// renders its rows from a plain `renderRow` function inside the view, where a
// per-row hook call would break the rules of hooks - it carries an equivalent
// inline implementation instead, and would need its rows extracted into
// components before it could share this one.

const LONG_PRESS_MS = 420
/** Finger travel, in px, past which a press is treated as a scroll. */
const LONG_PRESS_SLOP = 10
/** How long after a long press any click is treated as part of that gesture. */
const CLICK_SUPPRESS_MS = 700

// Module-scoped on purpose. A long press usually changes the layout - a
// selection bar appears, rows gain a checkbox - and the browser dispatches the
// trailing click to whatever sits under the finger *after* that reflow, which
// can be a different row than the one pressed. A per-row flag never sees that
// click, so the neighbouring row treated it as a fresh tap and selected itself
// too: one press, two songs. A shared timestamp catches it wherever it lands.
let lastLongPressAt = 0

export interface PressHandlers {
  onClick: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: () => void
  onTouchCancel: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

export interface PressOptions {
  onTap: () => void
  onLongPress: () => void
  /** Right-click / long-press-as-menu. Defaults to onLongPress. */
  onMenu?: () => void
}

export function useLongPress(opts: PressOptions): PressHandlers {
  // Read the callbacks through a ref so callers can pass fresh closures every
  // render without the handler object below having to change identity.
  const latest = useRef(opts)
  latest.current = opts

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  return useMemo<PressHandlers>(() => {
    const cancel = (): void => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      origin.current = null
    }
    return {
      onClick: () => {
        // The click trailing a long press is the same gesture, not a new tap -
        // on any row it reaches.
        if (Date.now() - lastLongPressAt < CLICK_SUPPRESS_MS) return
        latest.current.onTap()
      },
      onTouchStart: (e) => {
        const t = e.touches[0]
        origin.current = { x: t.clientX, y: t.clientY }
        timer.current = setTimeout(() => {
          lastLongPressAt = Date.now()
          navigator.vibrate?.(12)
          latest.current.onLongPress()
        }, LONG_PRESS_MS)
      },
      onTouchMove: (e) => {
        const from = origin.current
        if (!from) return
        const t = e.touches[0]
        if (Math.abs(t.clientX - from.x) > LONG_PRESS_SLOP || Math.abs(t.clientY - from.y) > LONG_PRESS_SLOP) cancel()
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      onContextMenu: (e) => {
        e.preventDefault()
        const o = latest.current
        ;(o.onMenu ?? o.onLongPress)()
      },
    }
  }, [])
}
