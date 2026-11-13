import type { ElementType, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// ── Flat row primitive — no card/box, just an icon + label on the left and
// a control on the right, separated by a hairline. Used inside each tab's
// content pane (macOS System Settings' detail-pane idiom, not the boxed
// inset-grouped list). The icon sits in a colored badge (iOS Settings-style)
// — a fixed color + white icon reads correctly in both themes, unlike the
// plain `text-muted` icon this replaced, which nearly disappeared in light
// mode. ──

/** A titled glass card of rows, iOS Settings' inset-grouped list on the glass
 *  chrome: a docked `.glass-pane`, so fields inside become plain fills of it.
 *  Rows draw their own hairlines; the last child's is dropped here. `flush`
 *  leaves out the side padding for rows that fill the card edge to edge. */
export function SettingsGroup({ title, footer, children, flush, action }: {
  title?: string
  footer?: ReactNode
  children: ReactNode
  flush?: boolean
  /** A small control on the title line, e.g. Reset. */
  action?: ReactNode
}): JSX.Element {
  return (
    <section className="mb-6 last:mb-0">
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 mb-1.5 px-4">
          {title && <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</h4>}
          {action}
        </div>
      )}
      <div className={`glass-pane rounded-2xl [&>*:last-child]:border-b-0 ${flush ? '' : 'px-4'}`}>{children}</div>
      {footer && <div className="text-text-muted text-[11px] leading-relaxed mt-1.5 px-4">{footer}</div>}
    </section>
  )
}

/** A row that opens something (a page, a view, a dialog), with a chevron.
 *  For `flush` groups: it fills the card edge to edge. */
export function SettingsLink({ icon: Icon, color, label, sub, onClick, tone }: {
  icon: ElementType
  color: string
  label: string
  sub?: string
  onClick: () => void
  tone?: 'danger'
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-[var(--border)] first:rounded-t-2xl last:rounded-b-2xl hover:bg-[var(--fill)] transition-colors"
    >
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
        <Icon size={15} className="text-white" strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${tone === 'danger' ? 'text-red-400' : 'text-text-primary'}`}>{label}</span>
        {sub && <span className="block text-text-muted text-[11px] truncate">{sub}</span>}
      </span>
      <ChevronRight size={16} className="text-text-muted shrink-0" />
    </button>
  )
}

/** The big title at the top of a Settings page. */
export function SettingsTitle({ children, action }: { children: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <h3 className="text-text-primary text-2xl font-bold tracking-tight">{children}</h3>
      {action}
    </div>
  )
}

export function Row({ icon: Icon, iconColor, label, sub, labelExtra, children }: {
  icon: ElementType
  iconColor: string
  label: string
  sub?: string
  // Rendered immediately after the label, on the left — for controls that
  // are conceptually part of the label (e.g. an on/off toggle right next
  // to "Crossfade"), as opposed to `children`, which sits at the row's
  // right edge (e.g. the crossfade duration slider).
  labelExtra?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
          <Icon size={13} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <p className="text-text-primary text-sm truncate">{label}</p>
          {sub && <p className="text-text-muted text-[11px] truncate">{sub}</p>}
        </div>
        {labelExtra}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ on, onClick, locked, lockedReason = 'Locked off while the Pill navigation style is selected' }: {
  on: boolean; onClick: () => void; locked?: boolean; lockedReason?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={locked}
      title={locked ? lockedReason : undefined}
      className={`relative w-10 h-5 rounded-full shrink-0 appearance-none border-0 p-0 leading-none bg-[var(--surface-overlay)] ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span aria-hidden="true" className={`absolute inset-0 rounded-full bg-accent control-motion ${on ? 'opacity-100' : 'opacity-0'}`} />
      {/* Vertically centered with inset-y-0 + my-auto (an auto-margin flex/
          block centering trick) instead of a manual top offset — a fixed
          `top-0.5` still relied on the button having zero padding/border to
          land exactly right, and browsers don't zero those out on <button>
          by default. auto-margin centering can't drift regardless of the
          button's own box model. No shadow on the knob either — its default
          downward offset (0 1px 3px) reads as visual weight sitting low,
          making it look off-center even when it's geometrically centered. */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0.5 my-auto w-4 h-4 rounded-full bg-white control-motion ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
