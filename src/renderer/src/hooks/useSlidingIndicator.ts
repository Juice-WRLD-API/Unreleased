import { useCallback, useLayoutEffect, useRef } from 'react'

// A highlight that slides between items instead of jumping: one element
// (class .nav-indicator, see index.css) behind the items, moved onto whichever
// one carries data-indicator-key={activeKey}. The container needs `relative
// isolate` - the isolate gives it its own stacking context, so the indicator's
// negative z-index puts it behind the items but still over the container's
// background. Put the indicator last among the container's children, so it
// doesn't shift a space-x/space-y sibling margin onto the first item.
//
// Only a change of active item animates. Anything else that moves the items -
// a resize, the sidebar collapsing, a reorder - snaps it into place, so it
// never trails behind the layout. Positions and sizes are written straight to
// the element rather than through state: the owner re-renders often (download
// progress, say), and this runs after every one of them.
//
// `layoutKey` names which container is rendered when the owner swaps between
// several (the nav's pill / bar / side layouts): a change re-attaches to the
// new one and fades the indicator in there instead of sliding across.
export function useSlidingIndicator<T extends HTMLElement>(activeKey: string | null, layoutKey = ''): {
  containerRef: React.RefObject<T>
  indicatorRef: React.RefObject<HTMLDivElement>
} {
  const containerRef = useRef<T>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const placed = useRef<{ key: string | null; at: string }>({ key: null, at: '' })
  const placedLayout = useRef(layoutKey)
  if (placedLayout.current !== layoutKey) {
    placedLayout.current = layoutKey
    placed.current = { key: null, at: '' }
  }

  const place = useCallback((): void => {
    const box = containerRef.current
    const ind = indicatorRef.current
    if (!box || !ind) return
    const el = activeKey ? box.querySelector<HTMLElement>(`[data-indicator-key="${CSS.escape(activeKey)}"]`) : null
    if (!el || el.getClientRects().length === 0) {
      if (placed.current.key !== null) ind.style.opacity = '0'
      placed.current = { key: null, at: '' }
      return
    }
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // Relative to the container's scrolled content, which is what an absolute
    // child of a scroll container is positioned (and scrolls) against.
    const x = r.left - b.left - box.clientLeft + box.scrollLeft
    const y = r.top - b.top - box.clientTop + box.scrollTop
    const at = `${x},${y},${r.width},${r.height}`
    const prev = placed.current
    if (prev.key === activeKey && prev.at === at) return
    placed.current = { key: activeKey, at }

    const write = (): void => {
      ind.style.transform = `translate(${x}px, ${y}px)`
      ind.style.width = `${r.width}px`
      ind.style.height = `${r.height}px`
      ind.style.opacity = '1'
    }
    if (prev.key === null) {
      // Appearing (first paint, or back on a tab after a view with none
      // lit): fade in where it belongs rather than sliding from a stale spot.
      ind.style.transition = 'opacity 0.2s ease'
      write()
    } else if (prev.key !== activeKey) {
      ind.style.transition = ''
      write()
    } else {
      ind.style.transition = 'none'
      write()
      void ind.offsetWidth // commit the snap before transitions come back
      ind.style.transition = ''
    }
  }, [activeKey])

  // After every render - a no-op when nothing moved.
  useLayoutEffect(() => { place() })
  useLayoutEffect(() => {
    const box = containerRef.current
    if (!box) return
    const ro = new ResizeObserver(() => place())
    ro.observe(box)
    return () => ro.disconnect()
  }, [place, layoutKey])

  return { containerRef, indicatorRef }
}
