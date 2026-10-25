import { useEffect, useState, type CSSProperties, type RefObject } from 'react'

/* Placement + dismissal for a popover portaled to <body> next to an anchor,
   same rules as ThemedSelect's list: fixed position so overflow-hidden cards
   can't clip it, opens below unless there's no room and more space above,
   clamped to the window, and closes on outside mousedown, outside scroll,
   resize or window blur. Escape is left to the popover's own key handler. */
export function placeNear(anchor: HTMLElement | null, width: number, height: number): CSSProperties | null {
  const r = anchor?.getBoundingClientRect()
  if (!r) return null
  const below = window.innerHeight - r.bottom
  const up = below < height + 12 && r.top > below
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
  return {
    position: 'fixed', left, width,
    ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
  }
}

export function useAnchoredPopover(
  anchorRef: RefObject<HTMLElement>, popRef: RefObject<HTMLElement>, width: number, height: number,
): { open: boolean; pos: CSSProperties | null; show: () => void; hide: () => void } {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Node && (!!popRef.current?.contains(t) || !!anchorRef.current?.contains(t))
    const onDown = (e: MouseEvent): void => { if (!inside(e.target)) setOpen(false) }
    const onScroll = (e: Event): void => { if (!inside(e.target)) setOpen(false) }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open, anchorRef, popRef])

  return {
    open, pos,
    show: () => { setPos(placeNear(anchorRef.current, width, height)); setOpen(true) },
    hide: () => setOpen(false),
  }
}
