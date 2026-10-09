import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ElementType, ReactNode, RefObject } from 'react'
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useEscapeToClose } from '../hooks/useEscapeToClose'
import { placeFlyout } from '../lib/menuFlyout'
import { ClampedMenu } from './ClampedMenu'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'

// One menu for the whole app: callers describe the items as data and this
// renders them as a pointer- or button-anchored ClampedMenu on desktop or a
// bottom Sheet on touch, so every menu dismisses, flips and navigates the same
// way.
//
// An item opens a further level in two ways, to any depth - a flyout beside its
// parent on desktop, a drill-down sheet page on touch:
//   children  - a list of entries (items and dividers), which may nest again
//   panel     - arbitrary content, mounted only while open (so it can lazy-load)
// A caller can also swap the whole menu for a `page` (a "pick one" step that
// follows an async action) or a free-form `body` (an inline rename field).

export interface ContextMenuItem {
  label: string
  icon?: ElementType
  /** Runs after the menu closes (unless `keepOpen`). Omit when `children`/`panel` is set. */
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  /** Accent-tinted - a toggle that's currently on (Like). */
  active?: boolean
  /** Check mark: on the right, or in a left column when the menu has `checkColumn`. */
  checked?: boolean
  /** Swaps the icon for a spinner. */
  loading?: boolean
  /** Extra right-aligned content (a count, a status spinner). */
  trailing?: ReactNode
  /** Keyboard shortcut chips, one per key. */
  kbd?: string[]
  /** Hairline above this row. */
  separatorBefore?: boolean
  children?: ContextMenuEntry[]
  /** Shown instead of the list when `children` is empty. */
  childrenEmpty?: string
  /** Extra content under the flyout's list (a "new playlist" field). */
  childrenFooter?: ReactNode
  /** Free-form next level. Only mounted while open. */
  panel?: (ctx: ContextMenuPanelCtx) => ReactNode
  /** Leave the menu open after selecting - for toggles and copy-confirmations. */
  keepOpen?: boolean
}
/** Rows inside a `children` list are ordinary items. */
export type ContextMenuSubItem = ContextMenuItem

export interface ContextMenuPanelCtx { close: () => void; mobile: boolean }

// Falsy entries are skipped so callers can write `cond && {...}` inline.
export type ContextMenuEntry = ContextMenuItem | 'divider' | false | null | undefined

export interface ContextMenuPage {
  title: string
  onBack: () => void
  items: ContextMenuItem[]
  /** Line above the rows ("Multiple matches found - pick one:"). */
  note?: string
  /** Shown when `items` is empty. */
  empty?: string
}

export interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  items: ContextMenuEntry[]
  /** Small heading above the items (a post or song title). */
  title?: string
  /** Muted second line under the title (an artist). */
  subtitle?: string
  className?: string
  /** Rich content above the items (a reaction row). Gets the close callback. */
  header?: (close: () => void) => ReactNode
  /** Replaces the items entirely - an inline rename field, say. */
  body?: ReactNode
  /** Replaces the items with a titled list that has a Back row. */
  page?: ContextMenuPage | null
  /** Content under the items (a "new playlist" field). */
  footer?: ReactNode
  /** Opened from a button: drop below it, flip above when there's no room. */
  anchor?: { top: number; bottom: number }
  /** Clicks inside this element don't count as "outside" - the opening button,
   *  which toggles the menu itself. */
  ignoreRef?: RefObject<HTMLElement>
  /** Stacking base; flyouts stack above it, one step per level. */
  zIndex?: number
  /** Classes for flyouts (width, mostly). */
  flyoutClassName?: string
  /** Entry animation on the menu and its flyouts. */
  popAnimation?: boolean
  /** Reserve a left column for check marks instead of showing them on the right:
   *  `true` in every flyout, `'auto'` in any level (the root too) that has a
   *  checkable row. */
  checkColumn?: boolean | 'auto'
  /** Tighter rows in flyouts - for long, dense menus. */
  compact?: boolean
}

// Drops falsy entries plus dividers that would sit first, last or doubled up
// once the conditional items around them are gone.
function normalize(entries: ContextMenuEntry[] | undefined): (ContextMenuItem | 'divider')[] {
  const out: (ContextMenuItem | 'divider')[] = []
  for (const e of entries ?? []) {
    if (!e) continue
    if (e === 'divider' && (out.length === 0 || out[out.length - 1] === 'divider')) continue
    out.push(e)
  }
  if (out[out.length - 1] === 'divider') out.pop()
  return out
}

const hasNext = (it: ContextMenuItem | 'divider' | undefined): boolean =>
  !!it && it !== 'divider' && !!(it.children || it.panel)

interface Pt { x: number; y: number }

// Point-in-triangle by edge sign - used for the safe-triangle below.
function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const side = (p1: Pt, p2: Pt, p3: Pt): number => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

// How long the pointer may sit still inside the safe-triangle before the menu
// stops waiting for it to reach the flyout and switches to the row under it.
const SAFE_TRIANGLE_STALL_MS = 150
// Used to predict, before a flyout exists, which side it will open on.
const EST_FLYOUT_W = 240

// Everything a level needs from the menu that owns it.
interface Cfg {
  select: (it: ContextMenuItem) => void
  onClose: () => void
  menuId: string
  z: number
  flyoutClassName: string
  pop: boolean
  checkColumn: boolean | 'auto'
  compact: boolean
}

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function ContextMenu({
  x, y, onClose, items: rawItems, title, subtitle, className = '', header, body, page, footer,
  anchor, ignoreRef, zIndex = 50, flyoutClassName = 'min-w-[160px] max-w-[260px]', popAnimation = false, checkColumn = false, compact = false,
}: ContextMenuProps): JSX.Element {
  const isMobile = useIsMobile()
  const items = normalize(rawItems)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  // Touch: the index path of the item whose next level is showing.
  const [trail, setTrail] = useState<number[]>([])
  // Only here to re-render the levels (so flyouts re-place) when the menu
  // settles into its clamped position.
  const [, setMenuPos] = useState({ left: x, top: y })

  useEscapeToClose(onClose, !isMobile)

  useEffect(() => {
    if (isMobile) return
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Element && (!!t.closest(`[data-ctx-menu="${menuId}"]`) || !!ignoreRef?.current?.contains(t))
    const onDown = (e: MouseEvent): void => { if (!inside(e.target)) onClose() }
    const onScroll = (e: Event): void => { if (!inside(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [isMobile, onClose, menuId, ignoreRef])

  const select = (it: ContextMenuItem): void => {
    if (!it.keepOpen) onClose()
    it.onSelect?.()
  }

  const cfg: Cfg = { select, onClose, menuId, z: zIndex, flyoutClassName, pop: popAnimation, checkColumn, compact }

  // ── Touch: bottom sheet ────────────────────────────────────────────────────
  if (isMobile) {
    // Walk the trail down to the level being shown.
    let level = items
    const parents: ContextMenuItem[] = []
    for (const idx of trail) {
      const node = level[idx]
      if (!node || node === 'divider') break
      parents.push(node)
      level = normalize(node.children)
    }
    const current = parents[parents.length - 1]
    const back = (): void => setTrail(t => t.slice(0, -1))

    const rows = (list: (ContextMenuItem | 'divider')[]): ReactNode =>
      list.map((it, i) => it === 'divider'
        ? <SheetDivider key={i} />
        : (
          <div key={i}>
            {it.separatorBefore && <SheetDivider />}
            <SheetItem
              icon={it.loading ? Loader2 : it.icon}
              label={it.label}
              danger={it.danger}
              active={it.active || it.checked}
              disabled={it.disabled}
              trailing={hasNext(it)
                ? <ChevronRight size={16} className="text-text-muted" />
                : it.checked ? <Check size={16} className="text-accent" /> : it.trailing}
              onClick={() => (hasNext(it) ? setTrail(t => [...t, i]) : select(it))}
            />
          </div>
        ))

    if (page) {
      return (
        <Sheet onClose={onClose} title={page.title}>
          <SheetItem icon={ChevronLeft} label="Back" onClick={page.onBack} />
          <SheetDivider />
          {page.note && <p className="px-5 pb-1 text-xs text-text-muted">{page.note}</p>}
          {page.items.length === 0 && page.empty && <p className="px-5 py-6 text-sm text-text-muted text-center">{page.empty}</p>}
          {rows(page.items)}
        </Sheet>
      )
    }
    if (current) {
      const kids = normalize(current.children)
      return (
        <Sheet onClose={onClose} title={current.label}>
          <SheetItem icon={ChevronLeft} label="Back" onClick={back} />
          <SheetDivider />
          {current.panel
            ? current.panel({ close: onClose, mobile: true })
            : (
              <>
                {kids.length === 0 && current.childrenEmpty && <p className="px-5 py-3 text-sm text-text-muted">{current.childrenEmpty}</p>}
                {rows(kids)}
                {current.childrenFooter && <><SheetDivider /><div className="px-5 py-2">{current.childrenFooter}</div></>}
              </>
            )}
        </Sheet>
      )
    }
    return (
      <Sheet
        onClose={onClose}
        title={title}
        header={(subtitle || header) && (
          <>
            {subtitle && <p className="px-5 pt-0.5 pb-2 text-xs text-text-muted truncate">{subtitle}</p>}
            {header?.(onClose)}
          </>
        )}
      >
        {body ?? rows(items)}
        {footer && <><SheetDivider /><div className="px-5 py-2">{footer}</div></>}
      </Sheet>
    )
  }

  // ── Desktop: anchored menu ─────────────────────────────────────────────────
  return createPortal(
    <ClampedMenu
      ref={menuRef}
      x={x}
      y={y}
      anchor={anchor}
      zIndex={zIndex}
      role="menu"
      data-ctx-menu={menuId}
      className={`min-w-[200px] max-w-[260px] ${popAnimation ? 'animate-menu-pop' : ''} ${className}`}
      onPositioned={setMenuPos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && (subtitle
        ? (
          <div className="px-3 py-2 border-b border-[var(--border)] mb-1">
            <p className="text-text-primary text-xs font-semibold truncate" title={title}>{title}</p>
            <p className="text-text-muted text-[10px] truncate">{subtitle}</p>
          </div>
        )
        : <p className="px-3 pt-1.5 pb-1 text-[11px] text-text-muted truncate" title={title}>{title}</p>)}
      {!page && header?.(onClose)}

      {page ? (
        <>
          <button onClick={page.onBack} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary transition-colors">
            <ChevronLeft size={12} /> Back
          </button>
          {page.note && <p className="px-3 pb-1 text-[10px] text-text-muted">{page.note}</p>}
          {page.items.length === 0 && page.empty && <p className="px-3 py-3 text-xs text-text-muted">{page.empty}</p>}
          <div className="max-h-44 overflow-y-auto">
            {page.items.map((c, i) => (
              <Row key={i} it={c} depth={1} cfg={cfg} leftward={false} column={false} open={false} onClick={() => select(c)} />
            ))}
          </div>
        </>
      ) : body ?? (
        <ItemList entries={items} containerRef={menuRef} depth={0} cfg={cfg} />
      )}
      {!page && !body && footer && <div className="px-2 py-1 mt-1 border-t border-[var(--border)]">{footer}</div>}
    </ClampedMenu>,
    document.body,
  )
}

// ── One level of rows, plus the flyout of whichever row is open ──────────────
// Recursive: a flyout's list is another ItemList, so menus nest to any depth.
function ItemList({ entries, containerRef, depth, cfg, onLeave, focusFirst }: {
  entries: (ContextMenuItem | 'divider')[]
  /** The element this level lives in - what its flyout is placed beside. */
  containerRef: RefObject<HTMLElement>
  depth: number
  cfg: Cfg
  /** ArrowLeft inside a flyout: close it and hand focus back to its row. */
  onLeave?: () => void
  focusFirst?: boolean
}): JSX.Element {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const flyoutRef = useRef<HTMLDivElement>(null)
  // Safe-triangle state: where the pointer last was while still on the row that
  // owns the open flyout, and the row switch being held back until it settles.
  const aimRef = useRef<Pt | null>(null)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [viaKey, setViaKey] = useState(false)
  // Whether this level's flyouts will open to its left (no room on the right),
  // so chevrons can point the way the flyout actually goes.
  const [leftward, setLeftward] = useState(false)

  const cancelPending = (): void => {
    if (pendingRef.current) { clearTimeout(pendingRef.current); pendingRef.current = null }
  }
  useEffect(() => cancelPending, [])

  useLayoutEffect(() => {
    const r = containerRef.current?.getBoundingClientRect()
    if (r) setLeftward(r.right + 4 + EST_FLYOUT_W > window.innerWidth - 8)
  })

  useEffect(() => {
    if (focusFirst) rowRefs.current.find(r => r && !r.disabled)?.focus()
  }, [focusFirst])

  // Hover handling with a safe-triangle: moving from "Add to playlist" toward
  // its flyout cuts across the rows below it, and switching to each one as the
  // pointer passes would close the flyout before it arrives. While the pointer
  // is inside the triangle (where it last was on the owning row -> the
  // flyout's near edge) the current flyout stays open; leaving the triangle, or
  // stopping in it for SAFE_TRIANGLE_STALL_MS, switches to the row underneath.
  const onRowsMouseMove = (e: React.MouseEvent): void => {
    const t = e.target as Node
    const hit = rowRefs.current.findIndex(r => r?.contains(t))
    if (hit < 0) return
    const pt = { x: e.clientX, y: e.clientY }
    const target = hasNext(entries[hit]) ? hit : null
    if (hit === openSub) { aimRef.current = pt; cancelPending(); return }
    if (target === openSub) { cancelPending(); return }

    const fly = flyoutRef.current?.getBoundingClientRect()
    const menu = containerRef.current?.getBoundingClientRect()
    const aim = aimRef.current
    if (openSub !== null && fly && menu && aim) {
      const edgeX = fly.left >= menu.right - 1 ? fly.left : fly.right
      if (inTriangle(pt, aim, { x: edgeX, y: fly.top }, { x: edgeX, y: fly.bottom })) {
        cancelPending()
        pendingRef.current = setTimeout(() => { pendingRef.current = null; setViaKey(false); setOpenSub(target) }, SAFE_TRIANGLE_STALL_MS)
        return
      }
    }
    cancelPending()
    setViaKey(false)
    setOpenSub(target)
  }

  // Arrow keys move focus between rows; Right opens a flyout, Left closes it.
  // Handled keys are stopped so only the innermost level reacts.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    const rows = rowRefs.current.filter((r): r is HTMLButtonElement => !!r && !r.disabled)
    const cur = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); e.stopPropagation(); rows[(cur + 1) % rows.length].focus() }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); e.stopPropagation(); rows[(cur - 1 + rows.length) % rows.length].focus() }
    else if (e.key === 'ArrowRight' && cur >= 0) {
      const idx = rowRefs.current.indexOf(rows[cur])
      if (hasNext(entries[idx])) { e.preventDefault(); e.stopPropagation(); setViaKey(true); setOpenSub(idx) }
    } else if (e.key === 'ArrowLeft' && onLeave) { e.preventDefault(); e.stopPropagation(); onLeave() }
  }

  const column = cfg.checkColumn === true
    ? depth > 0
    : cfg.checkColumn === 'auto' && entries.some(e => e !== 'divider' && e.checked !== undefined)
  const open = openSub !== null ? entries[openSub] : undefined
  const openItem = open && open !== 'divider' && hasNext(open) ? open : null
  const kids = openItem ? normalize(openItem.children) : []

  return (
    <div className="contents" onKeyDown={onKeyDown}>
      {/* The flyout is a sibling of this wrapper (and portalled), so moving the
          pointer into it doesn't count as leaving the trigger row. */}
      <div onMouseMove={onRowsMouseMove}>
        {entries.map((it, i) => it === 'divider'
          ? <div key={i} className="my-1 border-t border-[var(--border)]" />
          : (
            <Row
              key={i}
              it={it}
              depth={depth}
              cfg={cfg}
              leftward={leftward}
              column={column}
              open={openSub === i}
              refCb={(el) => { rowRefs.current[i] = el }}
              onClick={() => (hasNext(it) ? (setViaKey(false), setOpenSub(v => (v === i ? null : i))) : cfg.select(it))}
            />
          ))}
      </div>

      {openItem && openSub !== null && (
        <Flyout
          rowEl={rowRefs.current[openSub]}
          parentRef={containerRef}
          innerRef={flyoutRef}
          z={cfg.z + depth + 1}
          menuId={cfg.menuId}
          className={`${cfg.flyoutClassName} ${cfg.pop ? 'animate-menu-pop' : ''}`}
          onEnter={() => { aimRef.current = null; cancelPending() }}
        >
          {openItem.panel
            ? openItem.panel({ close: cfg.onClose, mobile: false })
            : (
              <>
                {kids.length === 0 && openItem.childrenEmpty && (
                  <p className="px-3 py-1.5 text-[11px] text-text-muted">{openItem.childrenEmpty}</p>
                )}
                <ItemList
                  entries={kids}
                  containerRef={flyoutRef}
                  depth={depth + 1}
                  cfg={cfg}
                  focusFirst={viaKey}
                  onLeave={() => { const i = openSub; setOpenSub(null); setViaKey(false); rowRefs.current[i]?.focus() }}
                />
                {openItem.childrenFooter && (
                  <div className={`px-2 py-1 ${kids.length ? 'mt-1 border-t border-[var(--border)]' : ''}`}>{openItem.childrenFooter}</div>
                )}
              </>
            )}
        </Flyout>
      )}
    </div>
  )
}

// A fixed panel beside its parent level, level with the row that opened it.
// Portalled to the body so no ancestor's overflow or transform (the parent's
// entry animation, say) can clip or offset it; `data-ctx-menu` is what keeps
// clicks inside it from counting as "outside" the menu.
function Flyout({ rowEl, parentRef, innerRef, z, menuId, className, onEnter, children }: {
  rowEl: HTMLElement | null
  parentRef: RefObject<HTMLElement>
  innerRef: RefObject<HTMLDivElement>
  z: number
  menuId: string
  className: string
  onEnter: () => void
  children: ReactNode
}): JSX.Element {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const place = (): void => {
    const sub = innerRef.current, parent = parentRef.current
    if (!rowEl || !sub || !parent) return
    const { top, left } = placeFlyout(rowEl, parent, sub)
    setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }
  const placeRef = useRef(place)
  placeRef.current = place

  // After every render (the parent may have moved) and whenever the flyout's
  // own size changes (a list that finishes loading, a row that appears).
  useLayoutEffect(() => { place() })
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => placeRef.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [innerRef])

  return createPortal(
    <div
      ref={innerRef}
      role="menu"
      data-ctx-menu={menuId}
      onClick={e => e.stopPropagation()}
      onMouseEnter={onEnter}
      style={{ position: 'fixed', zIndex: z, top: pos.top, left: pos.left, maxHeight: 'calc(100vh - 16px)', ...NO_DRAG }}
      className={`overflow-y-auto overflow-x-hidden bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}

function Row({ it, depth, cfg, leftward, column, open, refCb, onClick }: {
  it: ContextMenuItem
  depth: number
  cfg: Cfg
  leftward: boolean
  /** Reserve the left check column. */
  column: boolean
  open: boolean
  refCb?: (el: HTMLButtonElement | null) => void
  onClick: () => void
}): JSX.Element {
  const next = hasNext(it)
  const Icon = it.loading ? Loader2 : it.icon
  const dense = cfg.compact && depth > 0
  return (
    <>
      {it.separatorBefore && <div className="my-1 border-t border-[var(--border)]" />}
      <button
        ref={refCb}
        role="menuitem"
        disabled={it.disabled}
        onClick={onClick}
        title={depth > 0 ? it.label : undefined}
        className={`w-full flex items-center gap-2.5 px-3 ${dense ? 'py-1.5' : 'py-2'} text-left text-sm transition-colors hover:bg-surface-overlay focus:bg-surface-overlay focus:outline-none disabled:opacity-40 disabled:pointer-events-none ${
          open ? 'bg-surface-overlay' : ''
        } ${it.danger ? 'text-red-400' : it.active ? 'text-accent' : 'text-text-primary'}`}
      >
        {next && leftward && <ChevronLeft size={13} className="text-text-muted shrink-0" />}
        {column && (
          <span className="w-3.5 shrink-0 flex items-center justify-center">
            {it.checked && <Check size={12} className="text-accent" />}
          </span>
        )}
        {Icon && (
          <Icon
            size={14}
            className={`shrink-0 ${it.loading ? 'animate-spin ' : ''}${it.danger ? '' : it.active || (it.checked && !column) ? 'text-accent' : 'text-text-muted'}`}
          />
        )}
        <span className="flex-1 truncate">{it.label}</span>
        {(it.trailing || it.kbd?.length) ? (
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {it.trailing}
            {it.kbd?.map((t, ti) => (
              <kbd
                key={ti}
                className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-text-muted text-[10px] font-semibold leading-none border border-[var(--border)] tabular-nums"
              >
                {t}
              </kbd>
            ))}
          </span>
        ) : null}
        {next && !leftward && <ChevronRight size={13} className="text-text-muted shrink-0" />}
        {!next && it.checked && !column && <Check size={13} className="text-accent shrink-0" />}
      </button>
    </>
  )
}

/** A ContextMenu that opens from a button: drops below it, flips above when
 *  there's no room (the usual case for an action bar at the bottom), and
 *  treats clicks on the button as its own toggle rather than "outside". Render
 *  it only while open. */
export function AnchoredContextMenu({ anchorRef, ...props }: Omit<ContextMenuProps, 'x' | 'y' | 'anchor' | 'ignoreRef'> & {
  anchorRef: RefObject<HTMLElement>
}): JSX.Element | null {
  const r = anchorRef.current?.getBoundingClientRect()
  if (!r) return null
  return <ContextMenu {...props} x={r.left} y={r.bottom + 2} anchor={{ top: r.top, bottom: r.bottom }} ignoreRef={anchorRef} />
}
