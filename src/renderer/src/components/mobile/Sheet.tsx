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
  // 40% dim. Match it for as long as the scrim is on screen, then hand the
  // meta tag back to the real theme.
  useEffect(() => {
    dimThemeColorMeta(0.4)
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
    // Slide out from where the finger let go, not from the resting spot.
    holdOnDismiss: true,
  })

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[80] bg-black/40 ${closing ? 'animate-scrim-out' : 'animate-scrim-in'}`}
        onClick={requestClose}
        onContextMenu={(e) => { e.preventDefault(); requestClose() }}
      />
      {/* iOS 26's floating sheet: inset from the screen edges on every side,
          its corners following the phone's, frosted over the page. */}
      <div
        className={`fixed z-[81] inset-x-2 bottom-2 flex flex-col max-h-[82svh] glass-thick rounded-[32px] overflow-hidden ${
          closing ? 'animate-sheet-out' : entered ? '' : 'animate-sheet-in'
        }`}
        style={dragStyle}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntered(true) }}
      >
        <div className="shrink-0 pt-2 pb-1 touch-none" {...dragHandlers}>
          <div className="mx-auto w-9 h-[5px] rounded-full bg-[var(--fill-strong)]" />
          {title && <h3 className="px-5 pt-2.5 pb-1 text-center text-headline text-text-primary truncate">{title}</h3>}
          {header}
        </div>
        <div
          className="overflow-y-auto overscroll-contain py-1"
          // The sheet already sits 8px off the bottom edge, so only the part
          // of the home-indicator inset past that needs clearing.
          style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px) - 0.5rem, 0px) + 0.5rem)' }}
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
  /** A ready-made icon element, for callers holding one rather than a
   *  component (nav items). Takes the same slot as `icon`. */
  glyph?: ReactNode
  label: ReactNode
  /** Second line, for state a label alone can't carry ("12 songs"). */
  sub?: string
  trailing?: ReactNode
  onClick?: () => void
  /** Fires before the click - e.g. to warm a lazy view's chunk. */
  onPointerDown?: () => void
  disabled?: boolean
  /** Accent-tinted - the currently-applied option in a picker. */
  active?: boolean
  danger?: boolean
}

// One action row, iOS menu-style: body-size label, the icon in the label's
// own color, hairlines between neighbouring rows starting at the text. At
// least 52px tall - comfortably over the 48dp touch-target floor.
export function SheetItem({
  icon: Icon, glyph, label, sub, trailing, onClick, onPointerDown, disabled, active, danger,
}: SheetItemProps): JSX.Element {
  const tone = active ? 'text-accent' : danger ? 'text-red-500' : 'text-text-primary'
  const hasIcon = !!Icon || !!glyph
  return (
    <button
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      className={`sheet-item w-full flex items-center gap-3.5 px-5 min-h-[52px] py-3 text-left transition-colors disabled:opacity-40 active:bg-[var(--fill)] ${tone}`}
      // Icon (20px) + gap (14px) past the 20px padding.
      style={hasIcon ? { ['--row-inset' as string]: '54px' } : undefined}
    >
      {Icon && <Icon size={20} className="shrink-0" />}
      {glyph && <span className="shrink-0 w-5 h-5 flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5 [&_img]:w-5 [&_img]:h-5">{glyph}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-body truncate">{label}</span>
        {sub && <span className="block text-footnote text-text-secondary truncate">{sub}</span>}
      </span>
      {trailing}
    </button>
  )
}

/** The gap between groups of SheetItems - a band, as in iOS menus, rather
 *  than one more hairline. */
export function SheetDivider(): JSX.Element {
  return <div className="h-2 bg-[var(--fill)]" />
}
