import { useState, useRef, useCallback } from 'react'

/**
 * Returns [width, dragHandleProps] for a resizable right-side panel.
 * Mount the handle div on the LEFT edge of the panel.
 * Uses a ref for startWidth so the drag callback never goes stale.
 */
export function useResizablePanel(
  defaultWidth: number,
  min = 220,
  max = 560
): [number, React.HTMLAttributes<HTMLDivElement>] {
  const [width, setWidth] = useState(defaultWidth)
  const widthRef = useRef(defaultWidth)

  // Keep ref in sync with state
  widthRef.current = width

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = widthRef.current

      const onMove = (me: MouseEvent): void => {
        const delta = startX - me.clientX          // drag left → panel grows
        const next = Math.min(max, Math.max(min, startW + delta))
        widthRef.current = next
        setWidth(next)
      }

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [min, max]   // no `width` dep - reads from ref instead
  )

  return [width, { onMouseDown, style: { cursor: 'ew-resize' } }]
}
