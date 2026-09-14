import { Loader2, X } from 'lucide-react'
import type { CompFileProposal } from '../lib/userApi'
import { compChangeTypeLabel } from '../lib/userApi'
import { StatusChip, relativeTime } from './adminShared'

// A contributor's own comp proposals, with the status filter above them.
// Three pages show this exact list - the submit page, the contributor profile,
// and the editor profile's Comp tab - so it lives here rather than being
// hand-rolled (and drifting) in each of them.

export type CompFilterTab = 'all' | 'pending' | 'approved' | 'rejected'

export const COMP_FILTERS: CompFilterTab[] = ['all', 'pending', 'approved', 'rejected']

export function filterCompProposals(proposals: CompFileProposal[], filter: CompFilterTab): CompFileProposal[] {
  return filter === 'all' ? proposals : proposals.filter((p) => p.status === filter)
}

/** Searchable text for a comp proposal - both paths, the contributor's own
 *  note, and the change type as it reads on screen ("rename folder", not
 *  "rename_folder"), so a query matches whatever the proposal actually
 *  touches. Mirrors proposalSearchText in lib/proposalSearch.ts for song
 *  proposals. */
export function compProposalSearchText(p: CompFileProposal): string {
  return [p.file_path, p.destination_path, p.contributor_notes, compChangeTypeLabel(p.change_type)]
    .filter(Boolean).join(' ').toLowerCase()
}

export function CompFilterBar({ filter, setFilter, counts, size = 'sm' }: {
  filter: CompFilterTab
  setFilter: (f: CompFilterTab) => void
  /** Optional per-tab counts (e.g. from filterCompProposals(all, tab).length)
   *  - shown next to each tab's label like the song-proposal filter tabs do.
   *  Omit to render the bar without counts (unchanged for other callers). */
  counts?: Partial<Record<CompFilterTab, number>>
  /** 'sm' (default, unchanged) matches this bar's original compact sizing.
   *  'md' matches the song-proposal filter tabs' text-sm/font-medium sizing -
   *  use it wherever this bar sits directly next to those tabs (e.g. the
   *  merged Proposals/Comp tile in EditorProfileView), so the two don't read
   *  as two different scales of control. */
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <div className="flex gap-2 flex-wrap">
      {COMP_FILTERS.map((key) => {
        const count = counts?.[key]
        const active = filter === key
        return (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex items-center gap-1 rounded-lg capitalize transition-colors ${
              size === 'md' ? 'px-2.5 py-1 text-sm font-medium' : 'px-3 py-1 text-xs font-semibold'
            } ${active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}>
            {key}
            {!!count && (
              <span className={`text-[10px] tabular-nums ${active ? 'text-accent/70' : 'text-text-muted'}`}>{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function CompProposalList({ proposals, loading, onSelect, onWithdraw, withdrawingId, empty = 'No comp proposals yet.' }: {
  proposals: CompFileProposal[]
  loading?: boolean
  /** Clicking a row - omit to render the rows as plain, unclickable cards. */
  onSelect?: (proposal: CompFileProposal) => void
  /** Omit to hide the withdraw control (profile views are read-only). */
  onWithdraw?: (id: number) => void
  withdrawingId?: number | null
  empty?: string
}): JSX.Element {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-text-muted" /></div>
  if (proposals.length === 0) return <p className="text-sm text-text-muted text-center py-12">{empty}</p>

  return (
    <div className="space-y-2 max-w-2xl">
      {proposals.map((p) => {
        const affectedFiles = Array.isArray(p.original_snapshot?.files)
          ? (p.original_snapshot.files as string[])
          : null

        const body = (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusChip status={p.status} />
              <span className="text-[10px] uppercase font-bold text-text-muted bg-surface-overlay px-1.5 py-0.5 rounded">{compChangeTypeLabel(p.change_type)}</span>
            </div>
            <p className="text-sm font-mono text-text-primary truncate">{p.file_path}</p>
            {(p.change_type === 'move' || p.change_type === 'rename_folder' || p.change_type === 'move_folder') && p.destination_path && (
              <p className="text-xs font-mono text-text-muted truncate mt-0.5">→ {p.destination_path}</p>
            )}
            {affectedFiles && (
              <p className="text-[11px] text-text-muted mt-0.5">({affectedFiles.length} file{affectedFiles.length === 1 ? '' : 's'})</p>
            )}
            <p className="text-[11px] text-text-muted mt-1">
              {relativeTime(p.created_at)}{p.edit_count ? ` · ${p.edit_count} edit(s)` : ''}
            </p>
          </>
        )

        return (
          <div key={p.id} className="rounded-xl border border-[var(--border)] bg-surface-raised/40 flex items-start">
            {onSelect ? (
              <button onClick={() => onSelect(p)} className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-surface-raised transition-colors rounded-xl">
                {body}
              </button>
            ) : (
              <div className="flex-1 min-w-0 px-4 py-3">{body}</div>
            )}
            {onWithdraw && p.status === 'pending' && (
              <button onClick={() => onWithdraw(p.id)} disabled={withdrawingId === p.id}
                title="Withdraw this proposal"
                className="p-2 m-2 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
                {withdrawingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
