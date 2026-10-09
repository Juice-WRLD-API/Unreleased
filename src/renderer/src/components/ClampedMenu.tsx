import { forwardRef, useLayoutEffect, useRef, useState } from 'react'

// Fixed-position popup menu that keeps itself fully on-screen by measuring its
// real rendered box after every render - the estimate-free counterpart to
// hardcoded `window.innerHeight - N` clamps, which undershoot whenever a
// submenu grows the menu past the guess and its bottom gets clipped, worst on
// short mobile viewports. Height is capped to the viewport so an over-tall
// menu scrolls instead of clipping.
//
// Re-clamps on ResizeObserver (not just on mount) so content that grows after
// the initial paint - a submenu opening, an inline rename field - still ends
// up on-screen instead of clipped at the original, smaller measurement.
//
// Only handles positioning. Escape-to-close and click-outside are each
// caller's own concern (usually one shared effect covering all of that view's
// menus at once) since they're already centralized per-file and vary in
// exactly what should close together.
export interface ClampedMenuProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  x: number
  y: number
  // Fires with the settled clamped position after every (re)clamp - for a
  // dependent flyout/submenu that needs to place itself off this menu's
  // *final* on-screen box, not the raw (possibly off-screen) x/y it opened
  // at. Plain prop-drilling `left`/`top` back out would lag a commit behind
  // (this component's own clamp is itself async, via ResizeObserver), so the
  // callback is the only way a caller can react to the settled value.
  onPositioned?: (pos: { left: number; top: number }) => void
  // Opened from a button rather than a pointer: `x` is the left edge to align
  // to and the menu drops below `anchor.bottom`, flipping above `anchor.top`
  // when it would run off the bottom (a menu button in a bottom nav bar).
  anchor?: { top: number; bottom: number }
  // Numeric so dependants (flyouts) can stack relative to it; the z-50 class
  // is the fallback.
  zIndex?: number
}

export const ClampedMenu = forwardRef<HTMLDivElement, ClampedMenuProps>(
  ({ x, y, className = '', children, onClick, onPositioned, anchor, zIndex, ...rest }, forwardedRef) => {
    const ownRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({ left: x, top: y })
    const [up, setUp] = useState(false)

    useLayoutEffect(() => {
      const el = ownRef.current
      if (!el) return
      const clamp = (): void => {
        // Layout size, not getBoundingClientRect: a menu mid scale-in animation
        // would measure small and clamp a few px too far out.
        const rect = { width: el.offsetWidth, height: el.offsetHeight }
        const left = Math.round(Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)))
        let top = Math.round(Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)))
        let flipped = false
        if (anchor) {
          flipped = anchor.bottom + 2 + rect.height > window.innerHeight - 8 && anchor.top - rect.height - 2 >= 4
          if (flipped) top = Math.round(anchor.top - rect.height - 2)
        }
        setUp(flipped)
        setPos(prev => (prev.left === left && prev.top === top ? prev : { left, top }))
        onPositioned?.({ left, top })
      }
      clamp()
      const ro = new ResizeObserver(clamp)
      ro.observe(el)
      return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [x, y, anchor?.top, anchor?.bottom])

    return (
      <div
        ref={(el) => {
          ;(ownRef as React.MutableRefObject<HTMLDivElement | null>).current = el
          if (typeof forwardedRef === 'function') forwardedRef(el)
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        }}
        className={`fixed z-50 bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 overflow-y-auto overflow-x-hidden ${className}`}
        style={{
          left: pos.left,
          top: pos.top,
          maxHeight: window.innerHeight - 16,
          zIndex,
          // Menus can open over the frameless title strip, which the OS would
          // otherwise treat as a window-drag handle and swallow the clicks.
          WebkitAppRegion: 'no-drag',
          transformOrigin: up ? 'bottom left' : 'top left',
        } as React.CSSProperties}
        onClick={onClick ?? (e => e.stopPropagation())}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
ClampedMenu.displayName = 'ClampedMenu'
