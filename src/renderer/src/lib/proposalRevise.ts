// Pure constants/helpers shared by AdminPage's proposals tab and revise
// panel (desktop + mobile) - no React state here, just data shaping.
import type { ProposalStatus, SongEditProposal } from './userApi'

export const TEXTAREA_FIELDS = new Set(['lyrics', 'synced_lyrics', 'notes', 'additional_information', 'description'])
export const ALL_SONG_FIELDS = [
  'name', 'track_titles', 'credited_artists', 'producers', 'engineers',
  'recording_locations', 'record_dates', 'length', 'bitrate', 'additional_information',
  'file_names', 'instrumentals', 'instrumental_names', 'preview_date', 'release_date',
  'dates', 'session_titles', 'session_tracking', 'lyrics', 'synced_lyrics',
  'album', 'date_leaked', 'leak_type',
]

export type ProposalSort = 'date' | 'user'

export function sortProposals(rows: SongEditProposal[], sortBy: ProposalSort): SongEditProposal[] {
  if (sortBy === 'date') return rows
  return [...rows].sort((a, b) => {
    const byUser = a.editor_username.localeCompare(b.editor_username, undefined, { sensitivity: 'base' })
    if (byUser === 0 && a.editor_id !== b.editor_id) return a.editor_id - b.editor_id
    if (byUser !== 0) return byUser
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

/** How many proposal rows to mount at once (see `shown` in ProposalsTab). */
export const PROPOSAL_PAGE = 400

export const PROPOSAL_FILTERS: { id: ProposalStatus | ''; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'reversed', label: 'Reversed' },
  { id: '', label: 'All' },
]

export const PROPOSAL_SORTS: { id: ProposalSort; label: string }[] = [
  { id: 'date', label: 'Newest' },
  { id: 'user', label: 'User' },
]
