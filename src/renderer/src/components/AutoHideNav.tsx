import React, { useEffect, useRef, useState } from 'react'
import type { SidebarPosition } from '../store/useStore'

const HIDE_DELAY_MS = 300
const SLIDE_MS = 200
// Thickness of the invisible strip along the screen edge that reveals the menu.
const HOT_ZONE_PX = 24

const EDGE: Record<SidebarPosition, { box: string; hidden: string; zone: string }> = {
  left: { box: 'top-0 bottom-0 left-0', hidden: 'translateX(-100%)', zone: 'top-0 bottom-0 left-0' },
  right: { box: 'top-0 bottom-0 right-0', hidden: 'translateX(100%)', zone: 'top-0 bottom-0 right-0' },
  top: { box: 'top-0 inset-x-0', hidden: 'translateY(-100%)', zone: 'top-0 inset-x-0' },
  bottom: { box: 'bottom-0 inset-x-0', hidden: 'translateY(100%)', zone: 'bottom-0 inset-x-0' },
}

/**
 * Desktop auto-hide for the nav menu, like Windows' auto-hide taskbar: the menu
 * floats over the page, off-screen, and slides in when the pointer touches the
 * edge it lives on. It slides back out shortly after the pointer leaves.
 */
export default function AutoHideNav({ position, children }: { position: SidebarPosition; children: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edge = EDGE[position]
  const vertical = position === 'left' || position === 'right'

  const clear = (): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }
  const show = (): void => { clear(); setOpen(true) }
  const hideSoon = (): void => {
    clear()
    timer.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS)
  }
  useEffect(() => clear, [])

  return (
    <>
      <div
        aria-hidden
        onPointerEnter={show}
        className={`fixed z-40 hidden md:block ${edge.zone}`}
        style={vertical ? { width: HOT_ZONE_PX } : { height: HOT_ZONE_PX }}
      />
      <div
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        // Keep it open while a control inside has keyboard focus.
        onFocus={show}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideSoon() }}
        className={`fixed z-40 hidden md:flex ${edge.box} ${open ? 'shadow-2xl' : 'pointer-events-none'}`}
        style={{
          transform: open ? 'none' : edge.hidden,
          visibility: open ? 'visible' : 'hidden',
          transition: `transform ${SLIDE_MS}ms ease-out, visibility 0s linear ${open ? '0s' : `${SLIDE_MS}ms`}`,
        }}
      >
        {children}
      </div>
    </>
  )
}
