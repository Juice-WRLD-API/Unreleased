import React, { useEffect, useRef, useState } from 'react'
import { useStore, type SidebarPosition } from '../store/useStore'

const HIDE_DELAY_MS = 300
const SLIDE_MS = 200

const EDGE: Record<SidebarPosition, { box: string; hidden: string; zone: string }> = {
  left: { box: 'top-0 bottom-0 left-0', hidden: 'translateX(-100%)', zone: 'top-0 bottom-0 left-0' },
  right: { box: 'top-0 bottom-0 right-0', hidden: 'translateX(100%)', zone: 'top-0 bottom-0 right-0' },
  top: { box: 'top-0 inset-x-0', hidden: 'translateY(-100%)', zone: 'top-0 inset-x-0' },
  bottom: { box: 'bottom-0 inset-x-0', hidden: 'translateY(100%)', zone: 'bottom-0 inset-x-0' },
}

// Floating pill variant: the wrapper spans the edge, padded, and centres the
// pill along it. The wrapper itself ignores the pointer so only the pill is hit.
const PILL_BOX: Record<SidebarPosition, string> = {
  left: 'top-0 bottom-0 left-0 items-center',
  right: 'top-0 bottom-0 right-0 items-center',
  top: 'top-0 inset-x-0 justify-center items-start',
  bottom: 'bottom-0 inset-x-0 justify-center items-end',
}

/**
 * Desktop overlay for the nav menu. With `autoHide` it behaves like Windows'
 * auto-hide taskbar: the menu floats over the page, off-screen, and slides in
 * when the pointer touches the edge it lives on, then slides back out shortly
 * after the pointer leaves. With `pill` the menu floats as a rounded bar inset
 * from the edge; without `autoHide` it simply stays visible over the page.
 */
export default function AutoHideNav({ position, autoHide = true, pill = false, children }: {
  position: SidebarPosition
  autoHide?: boolean
  pill?: boolean
  children: React.ReactNode
}): JSX.Element {
  const hotZonePx = useStore((s) => s.autoHideNavZone)
  const [hovered, setHovered] = useState(false)
  const open = !autoHide || hovered
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edge = EDGE[position]
  const vertical = position === 'left' || position === 'right'

  const clear = (): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }
  const show = (): void => { clear(); setHovered(true) }
  const hideSoon = (): void => {
    clear()
    timer.current = setTimeout(() => setHovered(false), HIDE_DELAY_MS)
  }
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => clear, [])
  // Pointer jumping to another monitor can skip the element's own leave event,
  // so also close when it leaves the page or the window loses focus.
  useEffect(() => {
    if (!autoHide || !hovered) return
    const hide = (): void => hideSoon()
    document.documentElement.addEventListener('mouseleave', hide)
    window.addEventListener('blur', hide)
    return () => {
      document.documentElement.removeEventListener('mouseleave', hide)
      window.removeEventListener('blur', hide)
    }
  }, [autoHide, hovered])

  return (
    <>
      {autoHide && (
        <div
          aria-hidden
          onPointerEnter={show}
          // Reached the edge but moved away without touching the menu: close.
          onPointerLeave={(e) => { if (!(e.relatedTarget instanceof Node && wrapRef.current?.contains(e.relatedTarget))) hideSoon() }}
          className={`fixed z-40 hidden md:block ${edge.zone}`}
          style={vertical ? { width: hotZonePx } : { height: hotZonePx }}
        />
      )}
      <div
        ref={wrapRef}
        onPointerEnter={autoHide ? show : undefined}
        onPointerLeave={autoHide ? hideSoon : undefined}
        // Keep it open while a control inside has keyboard focus.
        onFocus={autoHide ? show : undefined}
        onBlur={autoHide ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideSoon() } : undefined}
        className={`fixed z-40 hidden md:flex ${
          pill
            ? `${PILL_BOX[position]} p-3 pointer-events-none`
            : `${edge.box} ${open ? 'shadow-2xl' : 'pointer-events-none'}`
        }`}
        style={autoHide ? {
          transform: open ? 'none' : edge.hidden,
          visibility: open ? 'visible' : 'hidden',
          transition: `transform ${SLIDE_MS}ms ease-out, visibility 0s linear ${open ? '0s' : `${SLIDE_MS}ms`}`,
        } : undefined}
      >
        {children}
      </div>
    </>
  )
}
