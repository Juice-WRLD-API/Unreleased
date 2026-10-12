// Shared status/rank style tables and search/format helpers for
// EditorProfileView.desktop.tsx and .mobile.tsx - previously two private,
// byte-identical copies living in each file.
//
// Deliberately NOT merged with adminShared.tsx's STATUS_STYLE table yet
// (different shape, different consumers) - that consolidation is a later
// polish-pass task per the approved rewrite plan.
import type { ProposalStatus, SongEditProposal } from './userApi'

export const STATUS_STYLES: Record<ProposalStatus, { label: string; bar: string; badge: string }> = {
  pending:  { label: 'Pending',  bar: 'bg-yellow-400',  badge: 'bg-yellow-500/15 text-yellow-400' },
  approved: { label: 'Approved', bar: 'bg-green-400',   badge: 'bg-green-500/15 text-green-400' },
  rejected: { label: 'Rejected', bar: 'bg-red-400',     badge: 'bg-red-500/15 text-red-400' },
  reversed: { label: 'Reversed', bar: 'bg-surface-overlay', badge: 'bg-surface-overlay text-text-muted' },
}

export const RANK_STYLES: Record<number, { num: string; badge: string }> = {
  1: { num: 'text-yellow-400 font-black', badge: 'bg-yellow-500/15 ring-1 ring-yellow-500/30' },
  2: { num: 'text-slate-300 font-black',  badge: 'bg-slate-500/15 ring-1 ring-slate-400/30' },
  3: { num: 'text-amber-600 font-black',  badge: 'bg-amber-700/15 ring-1 ring-amber-600/30' },
}

export type ProposalFilterTab = 'all' | ProposalStatus

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function changeTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Searchable text for a proposal: its title, change type, notes, song id,
// and any string/number values in the proposed data (name, artists, album,
// producers, etc.) so a query matches whatever the proposal actually edits.
export function proposalSearchText(p: SongEditProposal): string {
  const dataVals = Object.values(p.proposed_data ?? {})
    .filter(v => typeof v === 'string' || typeof v === 'number')
    .join(' ')
  return [p.title, changeTypeLabel(p.change_type), p.editor_notes, p.song != null ? `song #${p.song}` : '', dataVals]
    .filter(Boolean).join(' ').toLowerCase()
}
