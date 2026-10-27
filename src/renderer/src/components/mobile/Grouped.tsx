import { ElementType, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// ─── Inset-grouped lists ──────────────────────────────────────────────────────
// iOS's grouped table: related rows in one rounded card, hairlines between
// them inset to where the text starts, a small caption above the group and an
// optional note under it. Settings is built from these, and Home's entry
// points (radio, Liked Songs, tools) use the same card.

/** One group. `header` is the caption above, `footer` the note below. */
export function GroupedSection({ header, footer, children, className = '' }: {
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={className}>
      {header && <h3 className="px-4 pb-1.5 text-footnote font-medium text-text-secondary">{header}</h3>}
      <div className="rounded-[20px] bg-[var(--grouped)] px-4 overflow-hidden">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-footnote text-text-muted">{footer}</p>}
    </section>
  )
}

/** Width of an IconBadge plus the gap after it - where a row's hairline
 *  starts. Set as --row-inset on rows that lead with a badge. */
export const BADGE_ROW_INSET = '41px'

/** The colored rounded-square icon at the start of a grouped row. A fixed
 *  color with a white glyph reads in every skin. */
export function IconBadge({ icon: Icon, color, size = 29 }: { icon: ElementType; color: string; size?: number }): JSX.Element {
  return (
    <span
      className="rounded-[7px] flex items-center justify-center shrink-0"
      style={{ backgroundColor: color, width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.6)} className="text-white" strokeWidth={2.25} />
    </span>
  )
}

/** A tappable grouped row: badge, label (with an optional second line),
 *  trailing detail and a chevron. `chevron={false}` for rows that act in place
 *  rather than open something. */
export function GroupedRow({ icon, iconColor, label, sub, detail, chevron = true, danger, onClick, leading }: {
  icon?: ElementType
  iconColor?: string
  label: ReactNode
  sub?: ReactNode
  detail?: ReactNode
  chevron?: boolean
  danger?: boolean
  onClick?: () => void
  /** Custom leading content in place of a badge (an avatar, a swatch). The
   *  hairline still starts at BADGE_ROW_INSET, so keep it badge-sized. */
  leading?: ReactNode
}): JSX.Element {
  const hasLead = !!icon || !!leading
  return (
    <button
      onClick={onClick}
      className="grouped-row -mx-4 px-4 w-[calc(100%+2rem)] flex items-center gap-3 min-h-[44px] py-2.5 text-left transition-colors active:bg-[var(--fill)]"
      style={hasLead ? { ['--row-inset' as string]: BADGE_ROW_INSET } : undefined}
    >
      {leading ?? (icon && <IconBadge icon={icon} color={iconColor ?? 'var(--accent)'} />)}
      <span className="flex-1 min-w-0">
        <span className={`block text-body truncate ${danger ? 'text-red-500' : 'text-text-primary'}`}>{label}</span>
        {sub && <span className="block text-footnote text-text-secondary">{sub}</span>}
      </span>
      {detail != null && <span className="shrink-0 text-body text-text-muted truncate max-w-[45%]">{detail}</span>}
      {chevron && <ChevronRight size={18} strokeWidth={2.5} className="shrink-0 text-text-muted opacity-60 -mr-1" />}
    </button>
  )
}
