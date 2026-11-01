// Shared constants/helpers for the comp (recording session) file-proposal
// review queue - desktop and mobile CompProposalsTab both consume these.
import type { AccountUser, CompFileProposal } from './userApi'

export const FOLDER_LEVEL_TYPES = new Set(['create_folder', 'rename_folder', 'move_folder', 'delete_folder'])
export const DESTINATION_TYPES = new Set(['move', 'rename_folder', 'move_folder'])

const TAG_LABELS: Record<string, string> = {
  title: 'Title', artist: 'Artist', album: 'Album', album_artist: 'Album artist', genre: 'Genre',
  year: 'Year', track: 'Track', composer: 'Composer', comment: 'Comment', cover: 'Cover',
}

export interface TagChangeRow { key: string; label: string; from: string; to: string }

/** What a retag proposal changes, tag by tag: the file's value when it was
 *  proposed (original_snapshot.tags) and the one it writes. A staged image is
 *  a new cover. Empty for every other change type. */
export function compTagChangeRows(p: CompFileProposal): TagChangeRow[] {
  if (p.change_type !== 'retag') return []
  const before = (p.original_snapshot?.tags ?? {}) as Record<string, unknown>
  const rows: TagChangeRow[] = Object.entries(p.tag_changes ?? {}).map(([key, value]) => ({
    key,
    label: TAG_LABELS[key] ?? key,
    from: key === 'cover' ? (before.has_cover ? 'cover' : '') : String(before[key] ?? ''),
    to: key === 'cover' ? '' : value ?? '',
  }))
  if (p.staging_filename) rows.push({ key: 'cover', label: 'Cover', from: before.has_cover ? 'cover' : '', to: 'new cover' })
  return rows
}

/** delete_folder is gated beyond the normal per-tab role check the rest of
 *  this queue relies on: only a full administrator may approve it, and
 *  never the admin who filed it. Wording matches the backend's 403 `detail`
 *  strings verbatim so the client-side gate and the defense-in-depth server
 *  error read as the same restriction. */
export function compApproveBlockedReason(
  p: CompFileProposal | null,
  account: Pick<AccountUser, 'is_administrator' | 'id'> | null | undefined,
): string | null {
  if (!p || p.change_type !== 'delete_folder') return null
  if (!account?.is_administrator) return 'Folder deletions require administrator approval'
  if (account.id === p.contributor_id) return 'Folder deletions must be approved by a different administrator'
  return null
}
