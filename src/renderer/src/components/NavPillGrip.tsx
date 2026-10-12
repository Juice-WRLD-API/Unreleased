import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, GripHorizontal } from 'lucide-react'
import { useStore, type SidebarPosition } from '../store/useStore'

// Ghost placement per edge: inset 12px (matches the pill's p-3) and centred.
const GHOST: Record<SidebarPosition, string> = {
  left: 'left-3 top-1/2 -translate-y-1/2',
  right: 'right-3 top-1/2 -translate-y-1/2',
  top: 'top-3 left-1/2 -translate-x-1/2',
  bottom: 'bottom-3 left-1/2 -translate-x-1/2',
}

// Nearest window edge to the pointer, by fraction of the window so a wide
// window doesn't favour top/bottom.
function nearestEdge(x: number, y: number): SidebarPosition {
  const d: [SidebarPosition, number][] = [
    ['left', x / window.innerWidth],
    ['right', 1 - x / window.innerWidth],
    ['top', y / window.innerHeight],
    ['bottom', 1 - y / window.innerHeight],
  ]
  return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
}

/**
 * Handle on the floating nav pill: drag it toward any window edge and release
 * to dock the nav there. Pointer capture keeps the pill open for the drag.
 */
export default function NavPillGrip({ horizontal }: { horizontal: boolean }): JSX.Element {
  const [target, setTarget] = useState<SidebarPosition | null>(null)
  const active = useRef(false)
  const size = useRef({ long: 0, short: 0 })
  const Icon = horizontal ? GripVertical : GripHorizontal

  const move = (e: React.PointerEvent): void => {
    if (active.current) setTarget(nearestEdge(e.clientX, e.clientY))
  }
  const end = (e: React.PointerEvent, commit: boolean): void => {
    if (!active.current) return
    active.current = false
    const edge = nearestEdge(e.clientX, e.clientY)
    setTarget(null)
    if (commit && edge !== useStore.getState().sidebarPosition) useStore.getState().setSidebarPosition(edge)
  }

  return (
    <>
      <div
        title="Drag to move the menu"
        aria-label="Drag to move the menu"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          active.current = true
          const r = e.currentTarget.parentElement?.getBoundingClientRect()
          if (r) size.current = { long: Math.max(r.width, r.height), short: Math.min(r.width, r.height) }
          setTarget(nearestEdge(e.clientX, e.clientY))
        }}
        onPointerMove={move}
        onPointerUp={(e) => end(e, true)}
        onPointerCancel={(e) => end(e, false)}
        className={`shrink-0 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing touch-none select-none ${horizontal ? 'w-5 h-10' : 'w-10 h-5'}`}
      >
        <Icon size={14} />
      </div>
      {target && createPortal(
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div
            className={`absolute rounded-full border-2 border-accent bg-accent/25 ${GHOST[target]}`}
            style={target === 'top' || target === 'bottom'
              ? { width: size.current.long, height: size.current.short }
              : { width: size.current.short, height: size.current.long }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
