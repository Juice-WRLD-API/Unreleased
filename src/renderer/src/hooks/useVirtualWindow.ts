import { RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface VirtualWindow {
  /** First row index to render (inclusive). */
  start: number
  /** Last row index to render (exclusive). */
  end: number
  /** Full scroll height of all rows - set on the positioned content container. */
  totalHeight: number
}

type Range = Pick<VirtualWindow, 'start' | 'end'>
type ElementSource = HTMLElement | RefObject<HTMLElement> | null
const elementOf = (source: ElementSource): HTMLElement | null => source && ('current' in source ? source.current : source)

// Keep pixels outside React. Scrolling within the same row window should not
// rebuild the list; multiple scroll events in one frame share a single update.
function useWindowRange(
  scrollSource: ElementSource,
  contentSource: ElementSource,
  rangeAt: (top: number, height: number) => Range,
  rowCount: number,
  totalHeight: number,
): VirtualWindow {
  const [range, setRange] = useState(() => rangeAt(0, 0))
  const published = useRef(range)

  useLayoutEffect(() => {
    const scroll = elementOf(scrollSource)
    const content = elementOf(contentSource)
    let frame = 0
    let height = 0
    let offset = 0
    const update = (): void => {
      const next = rangeAt(Math.max(0, (scroll?.scrollTop ?? 0) - offset), height)
      if (next.start === published.current.start && next.end === published.current.end) return
      published.current = next
      setRange(next)
    }
    const measure = (): void => {
      height = scroll?.clientHeight ?? 0
      // offsetTop can refer to a positioned ancestor outside the scroller.
      offset = scroll && content
        ? content.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop
        : 0
      update()
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update() })
    }
    measure()
    if (!scroll) return
    scroll.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    if (content) observer.observe(content)
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [scrollSource, contentSource, rangeAt, totalHeight])

  // Filtering can shrink the list before the browser clamps its scrollTop.
  return { start: Math.min(range.start, rowCount), end: Math.min(range.end, rowCount), totalHeight }
}

function useFixedWindow(
  scroll: ElementSource,
  content: ElementSource,
  rowCount: number,
  rowStride: number,
  overscan: number,
): VirtualWindow {
  const rangeAt = useCallback((top: number, height: number): Range => {
    if (rowStride <= 0 || rowCount === 0) return { start: 0, end: rowCount }
    const start = Math.min(rowCount, Math.max(0, Math.floor(top / rowStride) - overscan))
    const end = Math.min(rowCount, Math.ceil((top + height) / rowStride) + overscan)
    return { start, end: Math.max(start, end) }
  }, [rowCount, rowStride, overscan])
  return useWindowRange(scroll, content, rangeAt, rowCount, Math.max(0, rowCount * rowStride))
}

/** Fixed-stride rows positioned at index * rowStride inside contentRef. */
export function useVirtualWindow(
  scrollRef: RefObject<HTMLElement>,
  contentRef: RefObject<HTMLElement>,
  rowCount: number,
  rowStride: number,
  overscan = 4,
): VirtualWindow {
  return useFixedWindow(scrollRef, contentRef, rowCount, rowStride, overscan)
}

/** Element-state refs for lists that mount later, such as playlist details. */
export function useVirtualWindowEl(
  scrollEl: HTMLElement | null,
  contentEl: HTMLElement | null,
  rowCount: number,
  rowStride: number,
  overscan = 4,
): VirtualWindow {
  return useFixedWindow(scrollEl, contentEl, rowCount, rowStride, overscan)
}

/** Variable-height rows described by a prefix sum, including the final edge. */
export function useVariableVirtualWindow(
  scrollRef: RefObject<HTMLElement>,
  contentRef: RefObject<HTMLElement>,
  offsets: readonly number[],
  totalHeight: number,
): VirtualWindow {
  const rowCount = Math.max(0, offsets.length - 1)
  const rangeAt = useCallback((top: number, height: number): Range => {
    const viewTop = top - height
    const viewBottom = top + height * 2 // one viewport of overscan on each side
    let low = 0
    let high = rowCount
    while (low < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid + 1] < viewTop) low = mid + 1
      else high = mid
    }
    const start = low
    high = rowCount
    while (low < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid] <= viewBottom) low = mid + 1
      else high = mid
    }
    return { start, end: low }
  }, [offsets, rowCount])
  return useWindowRange(scrollRef, contentRef, rangeAt, rowCount, totalHeight)
}
