import { Clock, Folder, Music2 } from 'lucide-react'
import type { CompFileProposal } from '../lib/userApi'
import type { PendingGhost } from '../hooks/usePendingCompGhosts'
import { pendingChangeLabel } from '../hooks/usePendingCompGhosts'
import { relativeTime } from './adminShared'

// A pending comp proposal drawn in the Files listing as a faded, dashed
// placeholder - it isn't on the server yet, so it can't be opened, played or
// selected. See usePendingCompGhosts.

function ghostTitle(g: PendingGhost): string {
  const what = g.count > 1
    ? `${g.count} of your pending proposals land here`
    : `Your ${pendingChangeLabel(g.proposal).toLowerCase()} - proposed ${relativeTime(g.proposal.created_at)}`
  return `${what}. It will appear for real once a reviewer approves it.`
}

export function PendingGhostItem({ ghost, variant, mobile = false }: {
  ghost: PendingGhost
  variant: 'row' | 'tile'
  mobile?: boolean
}): JSX.Element {
  const isDir = ghost.type === 'directory'
  const Icon = isDir ? Folder : Music2
  const label = ghost.count > 1 ? `${ghost.count} pending` : 'Pending'

  if (variant === 'tile') {
    return (
      <div
        title={ghostTitle(ghost)}
        className={`flex flex-col overflow-hidden border border-dashed border-[var(--border)] opacity-60 select-none ${mobile ? 'rounded-2xl' : 'rounded-xl'}`}
      >
        <div className="w-full aspect-square flex items-center justify-center bg-surface-overlay/40">
          <Icon size={mobile ? 36 : 40} className="text-text-muted" />
        </div>
        <div className="px-2.5 py-1.5 min-w-0">
          <p className={`${mobile ? 'text-[13px]' : 'text-xs'} font-medium italic text-text-secondary truncate`}>{ghost.name}</p>
          <p className="flex items-center gap-1 text-[10px] text-text-muted mt-0.5"><Clock size={9} /> {label}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      title={ghostTitle(ghost)}
      className={`flex items-center gap-3 border border-dashed border-[var(--border)] opacity-60 select-none ${
        mobile ? 'pl-4 pr-4 py-2 rounded-2xl my-0.5' : 'px-3 py-2 rounded-lg'
      }`}
    >
      <div className={`shrink-0 flex items-center justify-center ${mobile ? 'w-12 h-12 rounded-xl bg-surface-overlay/40' : 'w-9 h-9'}`}>
        <Icon size={mobile ? 22 : 18} className="text-text-muted" />
      </div>
      <span className={`flex-1 min-w-0 truncate italic text-text-secondary ${mobile ? 'text-[15px]' : 'text-sm'}`}>{ghost.name}</span>
      <PendingChip label={label} />
    </div>
  )
}

/** Marker on a real row that one of the user's pending proposals would
 *  replace, delete, or move. */
export function PendingMarker({ proposal }: { proposal: CompFileProposal }): JSX.Element {
  const dest = proposal.destination_path ? ` to ${proposal.destination_path}` : ''
  return (
    <span title={`${pendingChangeLabel(proposal)}${dest} - waiting for review`}>
      <PendingChip label={pendingChangeLabel(proposal).replace(' pending', '')} />
    </span>
  )
}

function PendingChip({ label }: { label: string }): JSX.Element {
  return (
    <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-text-muted bg-surface-overlay px-1.5 py-0.5 rounded-md not-italic">
      <Clock size={9} /> {label}
    </span>
  )
}
