import { ReactNode } from 'react'
import { ChevronRight, Check, Circle, MoreHorizontal } from 'lucide-react'
import { useLongPress } from './mobile/useLongPress'
import { clickable } from '../lib/a11y'
import { ListRow, RowMenuButton } from './mobile/ListRow'

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
      <div className="h-16">
        <ListRow
          {...press}
          art={<div className="w-full h-full flex items-center justify-center">{cover}</div>}
          artOverlay={selectMode ? <SelectOverlay selected={selected} /> : undefined}
          title={name}
          subtitle={subtitle}
          selected={selected}
          trailing={selectMode
            ? <span className="w-2 shrink-0" />
            : <RowMenuButton onClick={() => onMenu()} label={`More options for ${name}`} />}
        />
      </div>
    )
  }

  return (
    <div className="relative text-left" {...press}>
      <div className={`relative aspect-square rounded-[10px] overflow-hidden bg-[var(--fill)] flex items-center justify-center transition-opacity ${selected ? '' : 'active:opacity-70'}`}>
        {cover}
        {selectMode
          ? <SelectOverlay selected={selected} />
          : badge && <div className="absolute top-1.5 left-1.5">{badge}</div>}
      </div>
      <div className="flex items-start gap-1 pt-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-footnote text-text-primary truncate">{name}</p>
          <p className="text-footnote text-text-secondary truncate">{subtitle}</p>
        </div>
        {!selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onMenu() }}
            className="shrink-0 w-8 h-8 -mr-1.5 flex items-center justify-center text-text-primary active:opacity-50"
            aria-label={`More options for ${name}`}
          >
            <MoreHorizontal size={18} />
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
    <div className="h-16">
      <ListRow
        {...clickable(onToggle)}
        art={<div className="w-full h-full flex items-center justify-center text-accent">{icon}</div>}
        title={name}
        subtitle={`${count} ${count === 1 ? 'playlist' : 'playlists'}`}
        trailing={<>
          <RowMenuButton onClick={() => onMenu()} label={`More options for ${name}`} />
          <ChevronRight
            size={18}
            strokeWidth={2.5}
            className={`shrink-0 mr-2 text-text-muted opacity-60 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </>}
      />
    </div>
  )
}
