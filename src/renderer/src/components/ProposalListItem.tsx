import { Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { SongEditProposal } from '../lib/userApi'
import { STATUS_STYLES, formatDate, changeTypeLabel } from '../lib/proposalSearch'

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

  const actionBtnCls = isMobile
    ? 'w-8 h-8 flex items-center justify-center rounded-lg text-text-muted transition-colors disabled:opacity-40'
    : 'p-1.5 rounded-lg text-text-muted transition-all disabled:opacity-40'

  return (
    <div className={`flex items-stretch gap-0 rounded-xl overflow-hidden bg-surface/60 border border-[var(--border)] transition-colors ${isMobile ? '' : 'hover:border-accent/30 group'}`}>
      <div className={`w-1 shrink-0 ${s.bar}`} />
      <div className={`flex items-center flex-1 min-w-0 py-3 ${isMobile ? 'gap-2 px-3' : 'gap-3 px-3.5'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary text-sm font-medium truncate">{p.title || `Song #${p.song}`}</p>
          <p className="text-text-muted text-xs mt-0.5">{changeTypeLabel(p.change_type)} · {formatDate(p.created_at)}</p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{s.label}</span>
        {p.status === 'pending' && (
          <div className={`flex items-center gap-0.5 shrink-0 ${isMobile ? '' : 'md:opacity-0 md:group-hover:opacity-100 transition-opacity'}`}>
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
  )
}
