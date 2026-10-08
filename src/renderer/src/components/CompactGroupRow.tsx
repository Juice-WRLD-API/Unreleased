import { useState, memo } from 'react'
import { ChevronUp, ChevronDown, Layers, Play } from 'lucide-react'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { Track } from '../types'
import { clickable } from '../lib/a11y'

/** Tracks which compact-view groups are expanded - shared so the Tracker and
 *  Playlists don't each carry their own copy of this Set-toggle boilerplate. */
export function useExpandedGroups(): { expanded: Set<number>; toggle: (groupId: number) => void; clear: () => void } {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (groupId: number): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const clear = (): void => setExpanded(new Set())
  return { expanded, toggle, clear }
}

/** Collapsed row representing a version group - cover art of one member,
 *  the shared title, and a member count. Expanding it is the caller's job
 *  (each view renders its own member rows below, since Tracker/Playlists
 *  have different row layouts). */
export const CompactGroupRow = memo(function CompactGroupRow({
  coverTrack, title, count, expanded, onToggle, onContextMenu, onPlay, index,
  categoryLabel, categoryClassName,
}: {
  coverTrack: Track
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  /** Right-click (or long-press) the whole group - e.g. to act on all its
   *  versions at once. Left-click still expands/collapses. */
  onContextMenu?: (e: React.MouseEvent) => void
  /** Optional play button for the group (plays its members starting from the
   *  cover track). Omitted by callers that don't need it, so this stays a
   *  plain button-less row for them. */
  onPlay?: () => void
  /** Optional 1-based row number, shown left of the cover art (swaps for the
   *  play button on hover) so compact view's groups line up with the # column
   *  in the list/grid header. Omitted by callers that don't need it. */
  index?: number
  /** Optional category badge for the group as a whole (the Tracker's compact
   *  view only - Playlists doesn't pass these, so the badge is omitted
   *  there). */
  categoryLabel?: string
  categoryClassName?: string
}): JSX.Element {
  // Playlists' list-view rows use a fixed 40px (2.5rem) cover on every
  // breakpoint - the Tracker's own rows use a 36px cover that shrinks further
  // on desktop (36 → effectively smaller via the md:w-9/h-9 wrapper), which is
  // what this component matched by default. Without this, a Playlists compact
  // row's cover (and therefore the whole row) rendered visibly smaller than
  // the same song's row in normal/grid view. Keyed off `index` for the same
  // reason as the spacer above: only Playlists passes it.
  const isPlaylists = index !== undefined
  const coverSize = isPlaylists ? 40 : 36
  const coverBoxClass = isPlaylists ? 'w-10 h-10' : 'w-10 h-10 md:w-9 md:h-9'
  return (
    <div
      {...clickable(onToggle)}
      onContextMenu={onContextMenu}
      className="group w-full flex items-center gap-3 px-3 py-2.5 md:py-2 active:bg-surface-overlay md:hover:bg-surface-overlay rounded-lg transition-colors text-left cursor-pointer"
    >
      {/* # stays put - it used to swap for the play button on hover, but
          since this row is flex (not the fixed-column grid the list view
          uses), that swap made the number vanish and the cover jump left.
          The play button now overlays the cover art instead, matching how
          the grid view's tiles already do it.

          The leading blank spacer + the # column's width (w-7, not w-4) only
          render when `index` is passed (Playlists) - they exist purely to
          match Playlists' list-view row, which has a drag-handle column
          (1rem) before its 1.75rem # column. Tracker never passes `index`,
          so its rows (which have no such drag column) render exactly as
          before. */}
      {index !== undefined && (
        <>
          <span className="w-4 shrink-0" />
          <span className="w-7 shrink-0 text-center text-xs text-text-muted tabular-nums">{index}</span>
        </>
      )}
      <div className={`relative shrink-0 ${coverBoxClass} rounded overflow-hidden bg-surface-overlay`}>
        <AlbumArtThumbnail track={coverTrack} size={coverSize} shimmer={false} eager />
        {onPlay && (
          // Always visible on mobile - this is a touch surface, and hover
          // never fires there. Desktop keeps the hover-reveal.
          <div className="absolute inset-0 bg-black/30 md:bg-black/0 md:group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <button
              onClick={e => { e.stopPropagation(); onPlay() }}
              className="text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              title="Play"
            >
              <Play size={14} fill="currentColor" />
            </button>
          </div>
        )}
      </div>
      <span className="flex-1 min-w-0 text-text-primary text-sm font-medium truncate" title={title}>{title}</span>
      {categoryLabel && (
        <span className={`hidden md:block text-xs px-1.5 py-0.5 rounded border shrink-0 w-24 text-center ${categoryClassName ?? 'text-text-muted bg-surface border-[var(--border)]'}`}>
          {categoryLabel}
        </span>
      )}
      {/* Fixed width so the category badges (and the count itself) line up
          in a column regardless of how wide "N versions" renders. */}
      <span className="text-text-muted text-xs shrink-0 w-20 text-right">{count} version{count === 1 ? '' : 's'}</span>
      {expanded ? <ChevronUp size={14} className="text-text-muted shrink-0" /> : <ChevronDown size={14} className="text-text-muted shrink-0" />}
    </div>
  )
}, (prev, next) =>
  // Compare by value, not reference - callers pass a freshly-built coverTrack
  // and inline onToggle/onContextMenu closures every render, so without this
  // every group header re-rendered whenever anything in the parent changed
  // (e.g. toggling a selection), freezing large compact lists. The closures
  // capture only stable state setters + this group's own id, so ignoring their
  // identity is safe.
  prev.coverTrack.id === next.coverTrack.id &&
  prev.title === next.title &&
  prev.count === next.count &&
  prev.expanded === next.expanded &&
  prev.index === next.index &&
  prev.categoryLabel === next.categoryLabel &&
  prev.categoryClassName === next.categoryClassName
)

/** Empty-state icon for compact view - re-exported so callers don't need
 *  their own lucide-react import just for this one icon. */
export { Layers as CompactEmptyIcon }
