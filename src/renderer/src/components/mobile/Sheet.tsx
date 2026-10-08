import { ElementType, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { registerBackHandler } from '../../lib/backHandlers'
import { useDragToDismiss } from '../../hooks/useDragToDismiss'
import { dimThemeColorMeta, syncThemeColorMeta } from '../../lib/themeEffects'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

// ─── Bottom sheet ─────────────────────────────────────────────────────────────
// The mobile stand-in for every pointer-anchored popup the desktop UI used:
// context menus, pickers, confirmations. A phone has no cursor to anchor to and
// no comfortable reach at the top of the screen, so actions come up from the
// bottom edge instead, inside thumb range, with a scrim that doubles as the
// dismiss target.
//
// Mount it only while open (`{open && <Sheet …/>}`) - it owns its own exit
// animation and calls `onClose` after it finishes, so the caller never has to
// track a closing state.

// Kept in sync with the .animate-sheet-out duration in index.css.
const EXIT_MS = 200

interface SheetProps {
  onClose: () => void
  /** Small title above the content. Omit for a bare action list. */
  title?: string
  /** Rich header (e.g. a file's thumbnail + name) rendered under the title. */
  header?: ReactNode
  children: ReactNode
}

export function Sheet({ onClose, title, header, children }: SheetProps): JSX.Element {
  const [closing, setClosing] = useState(false)
  // Dropped once the entrance animation finishes: an `animation-fill-mode:
  // both` transform outranks the inline one the drag writes, so the sheet
  // would be undraggable for as long as the class stayed on.
  const [entered, setEntered] = useState(false)
  const closingRef = useRef(false)
  // onClose is typically an inline arrow, so read it through a ref rather than
  // making every callback below depend on its identity.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(() => closeRef.current(), EXIT_MS)
  }, [])

  // Android hardware back dismisses the sheet rather than navigating away.
  // Registered here (not via useBackToClose) so the press animates out through
  // the same path as a tap on the scrim.
  useEffect(() => registerBackHandler(() => { requestClose(); return true }), [requestClose])

  // The scrim below is `fixed inset-0`, same as MediaLightbox's backdrop -
  // Safari's toolbar tinting samples it directly rather than reading the
  // app's theme-color intent, so left alone every sheet (context menus
  // included) reads as a hard black status bar instead of the scrim's actual
  // 50% dim. Match it for as long as the scrim is on screen, then hand the
  // meta tag back to the real theme.
  useEffect(() => {
    dimThemeColorMeta(0.5)
    return () => syncThemeColorMeta()
  }, [])

  useEscapeToClose(requestClose)

  // Swipe the grabber/header down to dismiss - the gesture people already
  // expect from a sheet. Upward drag is rubber-banded rather than blocked so
  // the sheet still feels attached to the finger.
  const { style: dragStyle, handlers: dragHandlers } = useDragToDismiss(requestClose, {
    threshold: 90,
    rubberBand: true,
    transition: 'transform 220ms cubic-bezier(0.16,1,0.3,1)',
  })

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[80] bg-black/50 ${closing ? 'animate-scrim-out' : 'animate-scrim-in'}`}
        onClick={requestClose}
        onContextMenu={(e) => { e.preventDefault(); requestClose() }}
      />
      <div
        className={`fixed z-[81] left-0 right-0 bottom-0 flex flex-col max-h-[82svh] bg-surface rounded-t-[22px] border-t border-[var(--border)] shadow-2xl ${
          closing ? 'animate-sheet-out' : entered ? '' : 'animate-sheet-in'
        }`}
        style={dragStyle}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntered(true) }}
      >
        <div className="shrink-0 pt-3 pb-1 touch-none" {...dragHandlers}>
          <div className="mx-auto w-9 h-1 rounded-full bg-[var(--text-muted)] opacity-40" />
          {title && <h3 className="px-5 pt-3 text-text-primary font-semibold text-[15px]">{title}</h3>}
          {header}
        </div>
        <div
          className="overflow-y-auto overscroll-contain py-1"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}

interface SheetItemProps {
  icon?: ElementType
  label: ReactNode
  /** Second line, for state a label alone can't carry ("12 songs"). */
  sub?: string
  trailing?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Accent-tinted - the currently-applied option in a picker. */
  active?: boolean
  danger?: boolean
}

// One action row. 52px tall with generous horizontal padding: comfortably over
// the 48dp touch-target floor without the list feeling airy.
export function SheetItem({
  icon: Icon, label, sub, trailing, onClick, disabled, active, danger,
}: SheetItemProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3.5 px-5 py-3.5 text-left transition-colors disabled:opacity-40 active:bg-surface-overlay ${
        active ? 'text-accent' : danger ? 'text-red-400' : 'text-text-primary'
      }`}
    >
      {Icon && <Icon size={19} className={`shrink-0 ${active ? 'text-accent' : danger ? 'text-red-400' : 'text-text-muted'}`} />}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] truncate">{label}</span>
        {sub && <span className="block text-xs text-text-muted truncate mt-0.5">{sub}</span>}
      </span>
      {trailing}
    </button>
  )
}

/** Hairline divider between groups of SheetItems. */
export function SheetDivider(): JSX.Element {
  return <div className="h-px bg-[var(--border)] my-1.5 mx-5" />
}
