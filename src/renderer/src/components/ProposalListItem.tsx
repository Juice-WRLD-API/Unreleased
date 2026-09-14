import { useState } from 'react'
import { Loader2, Pencil, RefreshCw, Trash2, ChevronDown, ChevronUp, MessageSquare, Check, AlertCircle } from 'lucide-react'
import * as userApi from '../lib/userApi'
import type { SongEditProposal } from '../lib/userApi'
import { STATUS_STYLES, formatDate, changeTypeLabel } from '../lib/proposalSearch'
import { ProposalDiff } from './adminShared'

// "My proposals" row - extracted from the filteredProposals.map(...) block
// duplicated in EditorProfileView.desktop.tsx/.mobile.tsx. The two were
// layout-identical; the only real differences were hover-reveal actions vs
// always-visible touch actions, and hover: vs active: button states, both
// handled here via `variant` rather than forking the file.
export interface ProposalListItemProps {
  proposal: SongEditProposal
  onEdit: (p: SongEditProposal) => void
  onResubmit: (p: SongEditProposal) => void
  onDelete: (id: number) => void
  resubmittingId: number | null
  deletingId: number | null
  variant?: 'desktop' | 'mobile'
}

export default function ProposalListItem({
  proposal: p, onEdit, onResubmit, onDelete, resubmittingId, deletingId, variant = 'desktop',
}: ProposalListItemProps): JSX.Element {
  const isMobile = variant === 'mobile'
  const s = STATUS_STYLES[p.status]
  const busy = resubmittingId === p.id || deletingId === p.id
  const iconSize = isMobile ? 13 : 12

  // A decided proposal (approved/rejected/reversed) has no edit UI of its
  // own - this is the only way to see what it actually changed. Pending
  // proposals skip this: their data is already on screen via the Edit
  // button, and it's still a live draft rather than a settled diff.
  const viewable = p.status !== 'pending'
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<SongEditProposal | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const toggleExpanded = (): void => {
    if (!viewable) return
    const next = !expanded
    setExpanded(next)
    if (next && !detail && !detailLoading) {
      setDetailLoading(true)
      setDetailError(null)
      userApi.getProposal(p.id)
        .then(setDetail)
        .catch((e) => setDetailError(e instanceof Error ? e.message : 'Failed to load proposal'))
        .finally(() => setDetailLoading(false))
    }
  }

  const actionBtnCls = isMobile
    ? 'w-8 h-8 flex items-center justify-center rounded-lg text-text-muted transition-colors disabled:opacity-40'
    : 'p-1.5 rounded-lg text-text-muted transition-all disabled:opacity-40'

  return (
    <div className={`rounded-xl overflow-hidden bg-surface/60 border border-[var(--border)] transition-colors ${isMobile ? '' : 'hover:border-accent/30 group'}`}>
      <div className="flex items-stretch gap-0">
        <div className={`w-1 shrink-0 ${s.bar}`} />
        <div
          role={viewable ? 'button' : undefined}
          onClick={toggleExpanded}
          className={`flex items-center flex-1 min-w-0 py-3 ${isMobile ? 'gap-2 px-3' : 'gap-3 px-3.5'} ${viewable ? 'cursor-pointer' : ''}`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-text-primary text-sm font-medium truncate">{p.title || `Song #${p.song}`}</p>
            <p className="text-text-muted text-xs mt-0.5">{changeTypeLabel(p.change_type)} · {formatDate(p.created_at)}</p>
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{s.label}</span>
          {viewable && (
            expanded ? <ChevronUp size={14} className="shrink-0 text-text-muted" /> : <ChevronDown size={14} className="shrink-0 text-text-muted" />
          )}
          {p.status === 'pending' && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`flex items-center gap-0.5 shrink-0 ${isMobile ? '' : 'md:opacity-0 md:group-hover:opacity-100 transition-opacity'}`}
            >
              <button
                onClick={() => onEdit(p)}
                title="Edit proposal"
                className={`${actionBtnCls} ${isMobile ? 'active:text-text-primary active:bg-surface-raised' : 'hover:text-text-primary hover:bg-surface-raised'}`}
              >
                <Pencil size={iconSize} />
              </button>
              <button
                onClick={() => onResubmit(p)}
                disabled={busy}
                title="Resubmit proposal (withdraws and re-submits fresh)"
                className={`${actionBtnCls} ${isMobile ? 'active:text-accent active:bg-accent/10' : 'hover:text-accent hover:bg-accent/10'}`}
              >
                {resubmittingId === p.id ? <Loader2 size={iconSize} className="animate-spin" /> : <RefreshCw size={iconSize} />}
              </button>
              <button
                onClick={() => onDelete(p.id)}
                disabled={busy}
                title="Withdraw proposal"
                className={`${actionBtnCls} ${isMobile ? 'active:text-red-400 active:bg-red-500/10' : 'hover:text-red-400 hover:bg-red-500/10'}`}
              >
                {deletingId === p.id ? <Loader2 size={iconSize} className="animate-spin" /> : <Trash2 size={iconSize} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && viewable && (
        <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
          {detailLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="animate-spin text-text-muted" />
            </div>
          ) : detailError ? (
            <p className="flex items-center gap-1.5 px-4 py-3 text-[11px] text-red-400">
              <AlertCircle size={12} /> {detailError}
            </p>
          ) : (
            <>
              {(p.reviewer_username || p.review_notes) && (
                <p className="flex items-start gap-1.5 px-4 pt-3 text-[11px] text-text-muted italic">
                  <Check size={11} className="shrink-0 mt-0.5" />
                  {p.reviewer_username ? `${p.reviewer_username}: ` : ''}{p.review_notes || '(no review notes)'}
                </p>
              )}
              {p.editor_notes && (
                <p className="flex items-start gap-1.5 px-4 pt-2 text-[11px] text-text-muted italic">
                  <MessageSquare size={11} className="shrink-0 mt-0.5" />
                  {p.editor_notes}
                </p>
              )}
              <ProposalDiff proposal={detail ?? p} stacked={isMobile} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
