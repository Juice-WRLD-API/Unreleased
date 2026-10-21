import type { ElementType, ReactNode } from 'react'

// ── Flat row primitive — no card/box, just an icon + label on the left and
// a control on the right, separated by a hairline. Used inside each tab's
// content pane (macOS System Settings' detail-pane idiom, not the boxed
// inset-grouped list). The icon sits in a colored badge (iOS Settings-style)
// — a fixed color + white icon reads correctly in both themes, unlike the
// plain `text-muted` icon this replaced, which nearly disappeared in light
// mode. ──

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
