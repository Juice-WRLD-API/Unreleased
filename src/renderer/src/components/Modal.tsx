import { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Lock, Unlock } from 'lucide-react'
import { ls } from '../lib/persist'
import { dimThemeColorMeta, syncThemeColorMeta } from '../lib/themeEffects'

// Locked panels sit in their own z-index band, comfortably above anything
// zCounter could reach in a real session - so "locked" always beats
// "unlocked" regardless of which was interacted with more recently.
const LOCK_TIER = 1_000_000

function clamp(n: number, min: number, max: number): number {
  return max < min ? max : Math.min(Math.max(n, min), max)
}

// The "sandbox" is the pill notch at the top of the app (see SandboxNotch.tsx)
// that every in-app modal now docks into instead of showing as a full-screen
// overlay. `dockedIds` is just presence tracking (so the notch knows whether
// there's anything to show); `expanded` is the dropdown's own show/hide state,
// independent of whether a modal is actually open - collapsing it hides the
// docked modal without closing it, and expanding it again reveals the same
// mounted instance, state intact.
interface SandboxState {
  dockedIds: Set<string>
  expanded: boolean
  // Stacking order among docked panels - several can be open (and overlap)
  // at once. zCounter only ever increments; panelZ[id] is the counter value
  // at the moment that panel last opened, moved, or resized, so "most
  // recently touched" always sorts on top without needing to renumber
  // everyone else.
  zCounter: number
  panelZ: Record<string, number>
  // Locked panels can't be covered by anything else docked in the sandbox -
  // see LOCK_TIER below.
  lockedIds: Set<string>
  // Master on/off for the whole docking behavior (Settings > Window). Off
  // makes every non-floating, non-standalone ModalOverlay fall back to a
  // plain centered backdrop instead of docking into the notch - see the
  // `dockingOff` checks in ModalOverlay below. Read from localStorage at
  // module init (not inside a component) since it has to be correct on the
  // very first render, before any effect has a chance to run.
  sandboxEnabled: boolean
  dock: (id: string) => void
  undock: (id: string) => void
  bringToFront: (id: string) => void
  toggleLock: (id: string) => void
  expand: () => void
  collapse: () => void
  toggle: () => void
  setSandboxEnabled: (enabled: boolean) => void
}
export const useSandboxStore = create<SandboxState>((set) => ({
  dockedIds: new Set(),
  expanded: false,
  zCounter: 0,
  panelZ: {},
  lockedIds: new Set(),
  sandboxEnabled: ls.get<boolean>('sandboxEnabled') ?? false,
  dock: (id) => set((s) => {
    const z = s.zCounter + 1
    return { dockedIds: new Set(s.dockedIds).add(id), expanded: true, zCounter: z, panelZ: { ...s.panelZ, [id]: z } }
  }),
  undock: (id) => set((s) => {
    const next = new Set(s.dockedIds)
    next.delete(id)
    const nextLocked = new Set(s.lockedIds)
    nextLocked.delete(id)
    return { dockedIds: next, expanded: next.size > 0 && s.expanded, lockedIds: nextLocked }
  }),
  bringToFront: (id) => set((s) => {
    const z = s.zCounter + 1
    return { zCounter: z, panelZ: { ...s.panelZ, [id]: z } }
  }),
  toggleLock: (id) => set((s) => {
    const next = new Set(s.lockedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    return { lockedIds: next }
  }),
  expand: () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
  toggle: () => set((s) => ({ expanded: !s.expanded })),
  setSandboxEnabled: (enabled) => {
    ls.set('sandboxEnabled', enabled)
    set({ sandboxEnabled: enabled })
  },
}))

// The notch's dropdown body - a plain DOM node (not React-portalled from the
// notch itself) so ModalOverlay can portal into it without needing the notch
// component higher in the tree to hand down a ref through props. SandboxNotch
// claims this node on mount and positions it under the pill; it's always
// mounted at the app root, well before any modal has a reason to open.
export const sandboxSlotRef: { current: HTMLDivElement | null } = { current: null }

interface Rect { left: number; top: number; width: number; height: number }

// Live registry of every currently-dragged-or-resized-at-least-once panel's
// rect, keyed by id - a plain mutable Map (not store state) since it's
// written on every mousemove frame while dragging and would otherwise cause
// every docked panel to re-render on every frame of every other panel's drag.
// Read only inside the drag math below, never rendered from directly.
const panelRects = new Map<string, Rect>()

const SNAP_THRESHOLD = 8

// Snaps `pos` (the coordinate of the panel's leading edge) to align its
// leading edge, trailing edge, or center with any target within threshold -
// the same three-way alignment guides design tools like Figma use. Returns
// the untouched `pos` when nothing is close enough.
function snapAxis(pos: number, size: number, targets: number[]): number {
  let best: { dist: number; pos: number } | null = null
  for (const t of targets) {
    for (const offset of [0, size / 2, size]) {
      const dist = Math.abs(pos + offset - t)
      if (dist <= SNAP_THRESHOLD && (!best || dist < best.dist)) best = { dist, pos: t - offset }
    }
  }
  return best ? best.pos : pos
}

// Same idea but for a single moving edge (resize) rather than a whole panel.
function snapEdge(value: number, targets: number[]): number {
  let best: { dist: number; value: number } | null = null
  for (const t of targets) {
    const dist = Math.abs(value - t)
    if (dist <= SNAP_THRESHOLD && (!best || dist < best.dist)) best = { dist, value: t }
  }
  return best ? best.value : value
}

// Viewport + every OTHER tracked panel's edges/centers, as snap targets for
// each axis. `excludeId` keeps a panel from snapping to its own last rect.
function snapTargets(excludeId: string): { x: number[]; y: number[] } {
  const x = [0, window.innerWidth, window.innerWidth / 2]
  const y = [0, window.innerHeight, window.innerHeight / 2]
  for (const [otherId, r] of panelRects) {
    if (otherId === excludeId) continue
    x.push(r.left, r.left + r.width, r.left + r.width / 2)
    y.push(r.top, r.top + r.height, r.top + r.height / 2)
  }
  return { x, y }
}

// Lock toggle - an ordinary (non-absolute) icon button meant to sit inline
// in the modal's own header, next to its other icon buttons. Locking a panel
// pins it in LOCK_TIER, above every unlocked panel's z-index no matter what
// gets moved/resized afterward - the only way something else docked in the
// sandbox can cover it again is if that something else is ALSO locked (and
// more recently touched).
export function LockToggle({
  locked, onClick, className,
}: {
  locked: boolean
  onClick: (e: ReactMouseEvent) => void
  /** Override the default (plain-surface-header) coloring - e.g. for a dark hero image. */
  className?: string
}): JSX.Element {
  const Icon = locked ? Lock : Unlock
  return (
    <button
      onClick={onClick}
      title={locked ? 'Unlock - other panels can cover this again' : 'Lock on top - nothing else can cover this'}
      className={className ?? `w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
        locked ? 'text-accent' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      <Icon size={13} />
    </button>
  )
}

// Bottom-right resize grip, absolutely positioned inside the panel ModalOverlay owns.
function ResizeHandle({ onMouseDown }: { onMouseDown: (e: ReactMouseEvent) => void }): JSX.Element {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Resize"
      className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none z-20"
    >
      <svg viewBox="0 0 16 16" className="w-full h-full text-text-muted/40">
        <path d="M13 3L3 13M13 8.5L8.5 13M13 13L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// Shared overlay + panel shell for the app's modal dialogs. Handles everything
// that used to be copy-pasted (or, worse, re-wired) per modal: the portal,
// the `floating` variant that pop-out windows use (FloatApp mounts the same
// modal component with floating=true, which fills the pop-out's own OS window
// instead), and - for the normal in-app case - drag-to-move/drag-to-resize.
//
// Non-floating no longer shows a full-screen backdrop - it docks into the
// sandbox notch's dropdown instead. Opening a modal docks it and expands the
// notch; unmounting it (the real "close", e.g. the X button) undocks it.
// Collapsing the notch just hides the dropdown - the modal stays mounted, so
// its state (scroll position, form input, drag/resize size, in-flight
// progress) survives being reopened.
//
// `panelClassName` is the modal's own visual/default-size classes (border,
// radius, shadow, bg, and its *default* width/height before the user ever
// drags/resizes it - e.g. 'border rounded-2xl shadow-2xl w-full max-w-lg
// h-[640px]'). Once dragged or resized, ModalOverlay switches the panel to
// `position: fixed` with an explicit pixel box and those default-size classes
// stop applying (inline style wins) - the panel keeps growing/shrinking from
// wherever the user left it instead of snapping back to its own max-width.
//
// `children` is a render prop so the caller can mark its own header/hero as
// the drag handle (dragging from anywhere in the body would break e.g.
// SongInfoModal's select-to-copy text) while the drag mechanism itself lives
// here, in one place, instead of being re-derived per modal.
export function ModalOverlay({
  onClose,
  floating = false,
  standalone = false,
  zIndexClassName,
  panelClassName,
  minWidth = 360,
  minHeight = 320,
  dragY = 0,
  dragging = false,
  children,
}: {
  onClose: () => void
  floating?: boolean
  /** Skips the sandbox entirely - a plain centered, backdropped overlay like
   * every modal used to be, not draggable/resizable/lockable and not
   * collapsible from the notch. For modals that must always stay visible and
   * on top regardless of sandbox state - e.g. UserAuthModal, since login
   * shouldn't disappear into a dropdown the user can collapse or that other
   * docked panels can stack over. */
  standalone?: boolean
  /** Full Tailwind class, e.g. 'z-50' or 'z-[160]' - kept as one literal so Tailwind's scanner can find it. */
  zIndexClassName: string
  /** Panel's own border/radius/shadow/bg + default (pre-drag/resize) size classes. */
  panelClassName: string
  minWidth?: number
  minHeight?: number
  /** Live offset (px) from a caller's own swipe-to-dismiss gesture (e.g.
   *  useDragToDismiss), for the plain-backdrop (non-docked) case only. The
   *  panel translates with it while the backdrop fades out in proportion -
   *  so dragging down actually uncovers the app behind instead of leaving a
   *  dimmed rectangle trailing the panel down the screen. */
  dragY?: number
  dragging?: boolean
  children: (drag: {
    onHandleMouseDown: (e: ReactMouseEvent) => void
    locked: boolean
    toggleLock: () => void
    /** False when this panel isn't actually docked in the sandbox (floating
     *  pop-out, standalone modal, or the user turned docking off in
     *  Settings) - locking only means something when something else could
     *  cover this panel, so callers should hide their LockToggle button
     *  entirely rather than show one that's always unlocked and does nothing. */
    canLock: boolean
  }) => ReactNode
}): JSX.Element | null {
  const id = useId()
  const dock = useSandboxStore((s) => s.dock)
  const undock = useSandboxStore((s) => s.undock)
  const bringToFront = useSandboxStore((s) => s.bringToFront)
  const toggleLockStore = useSandboxStore((s) => s.toggleLock)
  const baseZ = useSandboxStore((s) => s.panelZ[id]) ?? 0
  const locked = useSandboxStore((s) => s.lockedIds.has(id))
  const sandboxEnabled = useSandboxStore((s) => s.sandboxEnabled)
  const z = locked ? LOCK_TIER + baseZ : baseZ
  const toggleLock = (): void => toggleLockStore(id)
  // Either this specific modal opts out (standalone) or the user turned the
  // whole feature off in Settings - either way it falls back to the plain
  // backdrop below instead of docking into the notch.
  const dockingOff = standalone || !sandboxEnabled

  // Only the dockingOff branch below paints its own fixed inset-0 bg-black/60
  // backdrop - the docked (sandbox) path has no full-screen scrim of its own,
  // and a floating pop-out is a real OS window with its own chrome, nothing
  // shared to tint. Same Safari-samples-the-scrim-pixel issue as
  // MediaLightbox/mobile Sheet: dim the meta tag to match while this backdrop
  // is up, then hand it back to the real theme.
  useEffect(() => {
    if (floating || !dockingOff) return
    dimThemeColorMeta(0.6)
    return () => syncThemeColorMeta()
  }, [floating, dockingOff])

  const [rect, setRect] = useState<Rect | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; base: Rect } | null>(null)

  const currentRect = (): Rect | null => {
    if (rect) return rect
    const r = panelRef.current?.getBoundingClientRect()
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
  }

  // Modals dock physically under the sandbox pill (that's where their portal
  // target lives), but should still *open* centered in the viewport rather
  // than tucked up there. Runs once per mount, synchronously before the
  // browser paints (useLayoutEffect, not useEffect) so the panel's default
  // CSS-driven position under the pill is never actually visible - it
  // measures its own natural size there, then immediately switches to the
  // same position:fixed mechanism drag/resize already use, centered.
  //
  // dock(id) lives in this same effect (not a separate useEffect) so the
  // store update - which flips the slot from invisible to visible - commits
  // synchronously in the same pre-paint flush as the centering. Splitting
  // them used to leave a window where the panel could paint once before
  // dock() (a plain useEffect, not guaranteed to run before paint) landed;
  // the panel used to paper over that by forcing itself permanently
  // `visible`, which also defeated the notch's collapse-to-hide behavior -
  // a collapsed sandbox still showed its docked panels, just uninteractive
  // (pointer-events-none, inherited from the slot, isn't overridden by a
  // child the way `visible` overrides `invisible`). Doing dock() here
  // instead removes the need for that override entirely.
  useLayoutEffect(() => {
    if (floating || dockingOff) return
    dock(id)
    const r = panelRef.current?.getBoundingClientRect()
    if (r) {
      setRect({
        left: clamp((window.innerWidth - r.width) / 2, 0, window.innerWidth - r.width),
        top: clamp((window.innerHeight - r.height) / 2, 0, window.innerHeight - r.height),
        width: r.width, height: r.height,
      })
    }
    return () => undock(id)
    // Deliberately once-per-mount only (plus whenever dockingOff itself
    // flips, e.g. the user toggling the sandbox off in Settings - that
    // re-runs the cleanup, undocking this panel, without re-centering it)
    // - re-centering on every render would fight the user dragging it away
    // from the middle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating, dockingOff])

  // Keeps this panel available as a snap target for everyone else, and drops
  // it once it's no longer explicitly positioned (never dragged, or closed).
  useEffect(() => {
    if (rect) panelRects.set(id, rect)
    else panelRects.delete(id)
    return () => { panelRects.delete(id) }
  }, [id, rect])

  useEffect(() => {
    if (floating || dockingOff) return
    const onMove = (e: MouseEvent): void => {
      if (!drag.current) return
      const { mode, startX, startY, base } = drag.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const { x: xTargets, y: yTargets } = snapTargets(id)
      if (mode === 'move') {
        const left = clamp(snapAxis(base.left + dx, base.width, xTargets), 0, window.innerWidth - base.width)
        const top = clamp(snapAxis(base.top + dy, base.height, yTargets), 0, window.innerHeight - base.height)
        setRect({ left, top, width: base.width, height: base.height })
      } else {
        const rawRight = clamp(base.left + base.width + dx, base.left + minWidth, window.innerWidth)
        const rawBottom = clamp(base.top + base.height + dy, base.top + minHeight, window.innerHeight)
        const right = snapEdge(rawRight, xTargets)
        const bottom = snapEdge(rawBottom, yTargets)
        setRect({
          left: base.left, top: base.top,
          width: clamp(right - base.left, minWidth, window.innerWidth - base.left),
          height: clamp(bottom - base.top, minHeight, window.innerHeight - base.top),
        })
      }
    }
    const onUp = (): void => { drag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [floating, dockingOff, minWidth, minHeight, id])

  const onHandleMouseDown = (e: ReactMouseEvent): void => {
    // Let the handle's own buttons/links work normally instead of starting a drag.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    const base = currentRect()
    if (!base) return
    e.preventDefault()
    bringToFront(id)
    drag.current = { mode: 'move', startX: e.clientX, startY: e.clientY, base }
  }

  const onResizeHandleMouseDown = (e: ReactMouseEvent): void => {
    const base = currentRect()
    if (!base) return
    e.preventDefault()
    e.stopPropagation()
    bringToFront(id)
    drag.current = { mode: 'resize', startX: e.clientX, startY: e.clientY, base }
  }

  if (floating) {
    // Locking doesn't apply to a real pop-out window - it's already its own
    // OS window, nothing docked in the sandbox can cover it.
    return createPortal(
      <div className={`fixed inset-0 ${zIndexClassName} flex`}>
        {children({ onHandleMouseDown: () => {}, locked: false, toggleLock: () => {}, canLock: false })}
      </div>,
      document.body,
    )
  }

  if (dockingOff) {
    // Same shape the pre-sandbox ModalOverlay always rendered: its own
    // full-screen backdrop, portalled straight to body rather than into the
    // (collapsible, coverable) sandbox slot - so it can't be hidden by
    // collapsing the notch or buried under another docked panel. No
    // drag/resize/lock either, since nothing else can ever cover it to
    // begin with. Reached either because this modal opted out (standalone)
    // or the user turned the sandbox off in Settings.
    return createPortal(
      <div
        className={`fixed inset-0 ${zIndexClassName} flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:px-4`}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        // Fades out (rather than translating) as the panel is dragged, so the
        // app behind is revealed cleanly instead of a dimmed rectangle just
        // sliding down with it and hovering above the panel.
        style={{
          opacity: dragY ? Math.max(1 - dragY / 240, 0) : 1,
          transition: dragging ? 'none' : 'opacity 0.25s ease-out',
        }}
      >
        <div
          className={`relative flex flex-col overflow-hidden ${panelClassName}`}
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragging ? 'none' : 'transform 0.25s ease-out',
          }}
        >
          {children({ onHandleMouseDown: () => {}, locked: false, toggleLock: () => {}, canLock: false })}
        </div>
      </div>,
      document.body,
    )
  }

  if (!sandboxSlotRef.current) return null
  const panelStyle: CSSProperties = rect
    ? { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, maxWidth: 'none', maxHeight: 'none', margin: 0 }
    : {}
  return createPortal(
    // z here (inline, overriding zIndexClassName's static value) is what
    // makes "the last-moved/resized panel comes to the front" work when
    // multiple docked modals overlap - each panel's own tier class would
    // otherwise always win regardless of interaction order. `relative` is
    // required too - z-index does nothing on a statically positioned element.
    <div className={`relative ${zIndexClassName}`} style={{ zIndex: z }} data-modal-id={id}>
      {/* panelClassName stays applied even after a drag/resize - its size
          classes (w-full max-w-*, h-[...]) just lose to panelStyle's explicit
          width/height/maxWidth/maxHeight via inline-style specificity, while
          its border/radius/shadow/bg/overflow-hidden keep applying either way. */}
      <div ref={panelRef} className={`relative flex flex-col overflow-hidden ${panelClassName}`} style={panelStyle}>
        {children({ onHandleMouseDown, locked, toggleLock, canLock: true })}
        <ResizeHandle onMouseDown={onResizeHandleMouseDown} />
      </div>
    </div>,
    sandboxSlotRef.current,
  )
}
