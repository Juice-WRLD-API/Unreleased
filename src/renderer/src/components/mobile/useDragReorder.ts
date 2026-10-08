import { useEffect, useRef, useState } from 'react'

// Touch drag-to-reorder for a plain (non-virtualized) list of fixed-height
// rows - the Playlists detail's reorder mode, the WRLD queue sheet, and
// Settings' nav-tabs list all had up/down arrow buttons instead, because
// HTML5 drag events (dragstart/dragover/drop) never fire on touch at all.
// This is the real gesture: press a row's grip handle and drag it into place.
//
// Deliberately index-based rather than DOM-measurement-per-frame: the caller
// owns rendering (key, content, disabled state), this hook only tracks which
// index is being dragged and how far, and hands back a translateY for every
// row so neighbours slide out of the way live. The row height is measured
// once at drag start (from the handle's closest `[data-drag-row]` ancestor)
// rather than passed in, so it stays correct across text-scale settings and
// slightly different row markup at each call site without three copies of a
// hardcoded pixel constant.
export interface DragReorderHandle {
  /** Index currently being dragged, or null when nothing is. */
  dragIndex: number | null
  /** Inline style for row `index` - apply to the same element carrying
   *  `data-drag-row` (or a wrapper around it with the row's real height). */
  rowStyle: (index: number) => React.CSSProperties
  /** Spread onto the grip handle that starts a drag for row `index`. Give the
   *  handle `touch-none` so the browser doesn't also try to scroll from it. */
  handleProps: (index: number) => { onTouchStart: (e: React.TouchEvent<HTMLElement>) => void }
  /** Same start logic as handleProps' onTouchStart, callable without a live
   *  touch event - for gestures (e.g. press-and-hold-to-reorder on the row
   *  itself) that decide to start dragging asynchronously, after a timer,
   *  rather than directly from a dedicated handle's touchstart. */
  startFrom: (index: number, clientY: number, rowEl: HTMLElement | null) => void
}

export function useDragReorder(
  count: number,
  onReorder: (from: number, to: number) => void,
): DragReorderHandle {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragY, setDragY] = useState(0)
  const dragYRef = useRef(0)
  const startYRef = useRef(0)
  const fromRef = useRef<number | null>(null)
  const rowHeightRef = useRef(0)
  const countRef = useRef(count)
  countRef.current = count
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder

  // Real (non-passive) document listeners, not JSX touchmove/touchend props -
  // React attaches its own touch handlers passively by default, so
  // preventDefault() inside a JSX onTouchMove is silently ignored and the
  // page scrolls out from under the drag. Re-subscribed only when a drag
  // starts/stops, not on every move - dragY changes live via a ref instead so
  // this effect doesn't re-run per pixel of movement.
  useEffect(() => {
    if (dragIndex === null) return
    const onMove = (e: TouchEvent): void => {
      e.preventDefault()
      const dy = e.touches[0].clientY - startYRef.current
      dragYRef.current = dy
      setDragY(dy)
    }
    const onEnd = (): void => {
      const from = fromRef.current
      const rh = rowHeightRef.current
      if (from !== null && rh > 0) {
        const target = Math.max(0, Math.min(countRef.current - 1, from + Math.round(dragYRef.current / rh)))
        if (target !== from) onReorderRef.current(from, target)
      }
      fromRef.current = null
      dragYRef.current = 0
      setDragY(0)
      setDragIndex(null)
    }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [dragIndex])

  const startFrom = (index: number, clientY: number, rowEl: HTMLElement | null): void => {
    rowHeightRef.current = rowEl?.getBoundingClientRect().height ?? 0
    fromRef.current = index
    startYRef.current = clientY
    dragYRef.current = 0
    setDragY(0)
    setDragIndex(index)
    navigator.vibrate?.(8)
  }

  const handleProps = (index: number): { onTouchStart: (e: React.TouchEvent<HTMLElement>) => void } => ({
    onTouchStart: (e) => {
      const row = e.currentTarget.closest<HTMLElement>('[data-drag-row]')
      startFrom(index, e.touches[0].clientY, row)
    },
  })

  const rowStyle = (index: number): React.CSSProperties => {
    if (dragIndex === null) return {}
    if (index === dragIndex) {
      // No transition on the dragged row itself - it must track the finger
      // exactly, not ease toward it.
      return { transform: `translateY(${dragY}px)`, transition: 'none', position: 'relative', zIndex: 20 }
    }
    const rh = rowHeightRef.current
    if (!rh) return {}
    const target = Math.max(0, Math.min(countRef.current - 1, dragIndex + Math.round(dragY / rh)))
    let shift = 0
    if (dragIndex < target && index > dragIndex && index <= target) shift = -1
    else if (dragIndex > target && index < dragIndex && index >= target) shift = 1
    return {
      transform: shift !== 0 ? `translateY(${shift * rh}px)` : undefined,
      transition: 'transform 180ms cubic-bezier(0.2,0,0,1)',
    }
  }

  return { dragIndex, rowStyle, handleProps, startFrom }
}
