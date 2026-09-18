// Shared constants/helpers for the comp (recording session) file-proposal
// review queue - desktop and mobile CompProposalsTab both consume these.
import type { AccountUser, CompFileProposal } from './userApi'

export const FOLDER_LEVEL_TYPES = new Set(['create_folder', 'rename_folder', 'move_folder', 'delete_folder'])
export const DESTINATION_TYPES = new Set(['move', 'rename_folder', 'move_folder'])

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
