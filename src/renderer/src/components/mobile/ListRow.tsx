import { HTMLAttributes, MouseEvent, ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

// ─── Song / playlist row ──────────────────────────────────────────────────────
// The one list row the mobile song lists share (Library tracks, Tracker
// results, playlists in list mode), Apple Music-style: 48px artwork, the title
// in body size, a secondary line, and a hairline under the text rather than
// card-like rounded rows. Presentational only - callers keep their own press
// handling (long-press, select mode) and pass it through as div props. Fills
// the height its virtual row gives it.

interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  art: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** The row of whatever is playing: title in the accent. */
  current?: boolean
  selected?: boolean
  /** Dim the artwork - a row that can't be played. */
  dimArt?: boolean
  /** Laid over the artwork (a select-mode check). */
  artOverlay?: ReactNode
  /** A chart position between the artwork and the title, as Apple Music's
   *  charts number their rows. */
  rank?: number
  trailing?: ReactNode
}

export function ListRow({
  art, title, subtitle, current, selected, dimArt, artOverlay, rank, trailing, className = '', ...rest
}: ListRowProps): JSX.Element {
  return (
    <div
      className={`list-row relative flex items-center gap-3 pl-4 pr-2 h-full transition-colors ${
        selected ? 'bg-accent/15' : 'active:bg-[var(--fill)]'
      } ${className}`}
      {...rest}
    >
      <div className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-[var(--fill)] ${dimArt ? 'opacity-60' : ''}`}>
        {art}
        {artOverlay}
      </div>
      {rank != null && <span className="shrink-0 min-w-[1.25rem] text-center text-headline text-text-primary tabular-nums">{rank}</span>}
      <div className="flex-1 min-w-0">
        <p className={`text-body truncate ${current ? 'text-accent font-semibold' : 'text-text-primary'}`}>{title}</p>
        {subtitle && <p className="text-subhead text-text-secondary truncate">{subtitle}</p>}
      </div>
      {trailing}
    </div>
  )
}

/** The trailing ⋯ that opens a row's menu. */
export function RowMenuButton({ onClick, label = 'More options' }: {
  onClick: (e: MouseEvent) => void
  label?: string
}): JSX.Element {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      className="shrink-0 w-10 h-11 flex items-center justify-center text-text-primary active:opacity-50"
      aria-label={label}
    >
      <MoreHorizontal size={20} />
    </button>
  )
}

/** A row's duration, in the secondary tone. */
export function RowDuration({ children }: { children: ReactNode }): JSX.Element {
  return <span className="shrink-0 text-footnote text-text-muted tabular-nums">{children}</span>
}
