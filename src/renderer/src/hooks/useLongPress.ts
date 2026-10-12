import { useCallback, useRef } from 'react'

// Mouse press-and-hold as a second way into multi-select, alongside Ctrl/Cmd
// +click (see the `onClick` handlers next to every `bind(...)` call site -
// they check `consumeFired()` first so the click that follows a completed
// hold doesn't also run the row's normal single-click action).
//
// One hook instance covers a whole list: `bind` is a plain factory, not a
// hook itself, so it's safe to call once per row inside a `.map()` even in a
// component that itself isn't per-row (see PlaylistsView/ApiFilesView, where
// rows are plain divs rendered from a loop) as well as inside real per-row
// components (see ApiTrackerView's row components) - only one press can be
// in flight at a time, so a single shared timer/origin ref is enough either
// way.

const LONG_PRESS_MS = 450
/** Mouse travel, in px, past which a hold is treated as a drag and cancelled. */
const MOVE_TOLERANCE_PX = 6

export interface LongPressBinding {
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  onMouseLeave: () => void
}

export interface UseLongPressResult {
  bind: (onLongPress: () => void) => LongPressBinding
  /** Call from the row's onClick handler: true means a hold just fired and
   *  this click is its trailing click, so the caller should return early
   *  instead of running its normal click behavior. Resets on read. */
  consumeFired: () => boolean
  /** Call from a native `onDragStart` so a drag-and-drop gesture never turns
   *  into a selection. `onMouseMove`'s slop check normally catches this on
   *  its own, but native drag hijacks mouse events once it takes over, so a
   *  hold that hasn't moved far enough yet can still fire mid-drag without
   *  this explicit cancel. */
  cancel: () => void
}

export function useLongPress(): UseLongPressResult {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    origin.current = null
  }, [])

  const bind = useCallback((onLongPress: () => void): LongPressBinding => ({
    onMouseDown: (e) => {
      if (e.button !== 0) return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onMouseMove: (e) => {
      const from = origin.current
      if (!from) return
      if (Math.abs(e.clientX - from.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - from.y) > MOVE_TOLERANCE_PX) cancel()
    },
    onMouseUp: cancel,
    onMouseLeave: cancel,
  }), [cancel])

  const consumeFired = useCallback((): boolean => {
    const v = fired.current
    fired.current = false
    return v
  }, [])

  return { bind, consumeFired, cancel }
}
