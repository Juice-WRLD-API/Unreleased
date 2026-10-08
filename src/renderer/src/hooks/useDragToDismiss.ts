import { CSSProperties, RefObject, TouchEvent as ReactTouchEvent, useRef, useState } from 'react'

// Shared "drag down to close" gesture - the curtain-reveal WRLD's full-screen
// player uses, and every bottom-sheet-style panel (SongInfoModal, mobile/
// Sheet.tsx) since. Wire `handlers` onto whatever region should arm the
// gesture (often just a header/grabber, not the whole scrollable panel, so it
// doesn't fight that panel's own scroll) and spread `style` onto the element
// that should actually translate.
interface Options {
  /** Downward drag distance (px) past which `onDismiss` fires. */
  threshold?: number
  /** Scale upward drag instead of freezing it in place, for a rubber-band
   *  feel (mobile/Sheet.tsx's grabber). Off by default, matching WRLD/
   *  SongInfoModal: dragging back up just holds at the last downward offset. */
  rubberBand?: boolean
  /** Transition applied once the finger lifts (snap back, or into the close
   *  animation). */
  transition?: string
  /** Opt into writing the live drag offset straight to this element's DOM
   *  node on every touchmove instead of through `setState` + the returned
   *  `style` - skips a React re-render of whatever owns the element on every
   *  touch frame. Pointless for a small panel (Sheet, Modal, SongInfoModal -
   *  re-rendering those is cheap either way) but was visibly janky on WRLD's
   *  ~2000-line full-screen player, which re-rendered its entire subtree
   *  (blurred cover backdrop, lyrics, queue, everything) on every finger
   *  move. `dragY`/`style` still update (rarely - only at drag start/end),
   *  so consumers that don't pass this keep working exactly as before. */
  elRef?: RefObject<HTMLElement | null>
  /** Custom DOM write for the `elRef` path, e.g. WRLD also derives a
   *  border-radius from the same offset. Defaults to a plain translateY. */
  applyStyle?: (el: HTMLElement, dy: number) => void
}

export function useDragToDismiss(onDismiss: () => void, options: Options = {}) {
  const { threshold = 110, rubberBand = false, transition = 'transform 0.25s ease-out', elRef, applyStyle } = options
  const dragStartY = useRef<number | null>(null)
  // Mirrors the live offset even when it's being written straight to the DOM
  // (elRef path) rather than through state, so onTouchEnd's threshold check
  // always sees the latest value.
  const dragYRef = useRef(0)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)

  const writeOffset = (dy: number): void => {
    dragYRef.current = dy
    const el = elRef?.current
    if (el) {
      if (applyStyle) applyStyle(el, dy)
      else el.style.transform = dy ? `translateY(${dy}px)` : ''
    } else {
      setDragY(dy)
    }
  }

  const onTouchStart = (e: ReactTouchEvent): void => {
    if (e.touches.length !== 1) return
    // Let the handle's own buttons (close/edit/lock, etc.) work normally
    // instead of starting a drag.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    dragStartY.current = e.touches[0].clientY
    setDragging(true)
  }
  const onTouchMove = (e: ReactTouchEvent): void => {
    if (dragStartY.current == null) return
    const dy = e.touches[0].clientY - dragStartY.current
    if (rubberBand) writeOffset(dy > 0 ? dy : dy / 5)
    else if (dy > 0) writeOffset(dy)
  }
  const onTouchEnd = (): void => {
    if (dragStartY.current == null) return
    if (dragYRef.current > threshold) onDismiss()
    writeOffset(0)
    setDragging(false)
    dragStartY.current = null
  }

  const style: CSSProperties = {
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition: dragging ? 'none' : transition,
  }

  return {
    dragY,
    dragging,
    style,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  }
}
