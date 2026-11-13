import { useCallback, useLayoutEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Tracks the content-box size of whatever DOM node the returned callback ref
 * gets attached to. Returns `[ref, size]` - pass `ref` directly as the
 * element's `ref` prop rather than holding your own `useRef`: a plain ref
 * object's identity never changes across renders, so an effect keyed on it
 * (`useEffect(..., [ref])`) only ever runs once, right after the very first
 * mount - if the element it points at isn't in the DOM yet at that exact
 * moment (e.g. a conditional renders an empty state first and swaps in the
 * real element once data arrives), that first run sees `ref.current === null`
 * and never gets another chance, even once the element shows up for real. A
 * callback ref calls back on every attach and detach, so this one always
 * re-measures and re-subscribes exactly when it should.
 *
 * Measured in a layout effect, so the first paint already has the size: Home
 * used to show its bento stacked for a frame or two and then jump into pairs,
 * which showed through the tab swipe (lib/dashboardSwap).
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [node, setNode] = useState<T | null>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  const ref = useCallback((el: T | null) => setNode(el), [])

  useLayoutEffect(() => {
    if (!node) {
      setSize({ width: 0, height: 0 })
      return
    }
    const measure = (): void => {
      setSize((prev) => (
        prev.width === node.clientWidth && prev.height === node.clientHeight
          ? prev
          : { width: node.clientWidth, height: node.clientHeight }
      ))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])

  return [ref, size]
}
