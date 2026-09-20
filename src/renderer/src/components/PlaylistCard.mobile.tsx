import { ReactNode } from 'react'
import { ChevronRight, Check, Circle, MoreVertical } from 'lucide-react'
import { useLongPress } from './mobile/useLongPress'
import { clickable } from '../lib/a11y'

// One playlist in the library - as a grid tile or a list row, since the library
// offers both. Presentational only: the caller owns the cover node and every
// handler, so the same component draws a synced playlist, a device-local one,
// and one nested inside a folder.
//
// Touch model matches the rest of the app: tap opens, long-press starts (or
// extends) a selection, and the "⋯" button opens the actions sheet. There is no
// hover-revealed play button any more - it had no touch equivalent, and "play
// without opening" now lives in that sheet.

export interface PlaylistCardProps {
  name: string
  subtitle: string
  cover: ReactNode
  /** Corner tag (e.g. "Offline", "Local"). Hidden while selecting. */
  badge?: ReactNode
  layout: 'grid' | 'list'
  selected: boolean
  selectMode: boolean
  onOpen: () => void
  onLongPress: () => void
  onMenu: () => void
}

/** Selection drawn ON the cover: a leading checkbox would shove the row
 *  sideways the moment select mode turns on, which happens mid-long-press. */
function SelectOverlay({ selected }: { selected: boolean }): JSX.Element {
  return (
    <div className={`absolute inset-0 flex items-center justify-center transition-colors ${selected ? 'bg-accent/75' : 'bg-black/45'}`}>
      {selected ? <Check size={22} className="text-white" strokeWidth={3} /> : <Circle size={20} className="text-white/85" />}
    </div>
  )
}

export default function PlaylistCard({
  name, subtitle, cover, badge, layout, selected, selectMode, onOpen, onLongPress, onMenu,
}: PlaylistCardProps): JSX.Element {
  const press = useLongPress({
    onTap: () => (selectMode ? onLongPress() : onOpen()),
    onLongPress,
  })

  if (layout === 'list') {
    return (
      <div
        className={`flex items-center gap-3 px-4 py-2 rounded-2xl transition-colors ${selected ? 'bg-accent/15' : 'active:bg-surface-overlay'}`}
        {...press}
      >
        <div className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-surface-overlay flex items-center justify-center">
          {cover}
          {selectMode && <SelectOverlay selected={selected} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary text-[15px] leading-snug truncate">{name}</p>
          <p className="text-text-muted text-xs truncate mt-0.5">{subtitle}</p>
        </div>
        {!selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onMenu() }}
            className="shrink-0 w-10 h-11 -mr-2 flex items-center justify-center text-text-muted active:text-accent"
            aria-label={`More options for ${name}`}
          >
            <MoreVertical size={18} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative text-left" {...press}>
      <div className={`relative aspect-square rounded-2xl overflow-hidden bg-surface-overlay flex items-center justify-center transition-opacity ${selected ? '' : 'active:opacity-70'}`}>
        {cover}
        {selectMode
          ? <SelectOverlay selected={selected} />
          : badge && <div className="absolute top-1.5 left-1.5">{badge}</div>}
      </div>
      <div className="flex items-start gap-1 pt-2">
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-[13px] font-medium truncate leading-tight">{name}</p>
          <p className="text-text-muted text-[11px] truncate mt-0.5">{subtitle}</p>
        </div>
        {!selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onMenu() }}
            className="shrink-0 w-7 h-7 -mt-0.5 -mr-1 flex items-center justify-center text-text-muted active:text-accent"
            aria-label={`More options for ${name}`}
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

/** A folder header row in the library list - same height and rhythm as a
 *  playlist row, with a disclosure chevron instead of cover art. */
export function FolderRow({ name, count, expanded, icon, onToggle, onMenu }: {
  name: string
  count: number
  expanded: boolean
  icon: ReactNode
  onToggle: () => void
  onMenu: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl active:bg-surface-overlay transition-colors" {...clickable(onToggle)}>
      <div className="w-14 h-14 shrink-0 rounded-xl bg-surface-overlay flex items-center justify-center text-accent">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-[15px] leading-snug truncate">{name}</p>
        <p className="text-text-muted text-xs truncate mt-0.5">
          {count} {count === 1 ? 'playlist' : 'playlists'}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onMenu() }}
        className="shrink-0 w-10 h-11 flex items-center justify-center text-text-muted active:text-accent"
        aria-label={`More options for ${name}`}
      >
        <MoreVertical size={18} />
      </button>
      <ChevronRight
        size={18}
        className={`shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
    </div>
  )
}
