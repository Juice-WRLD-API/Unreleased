import { useStore, StagedFileChange } from '../store/useStore'
import * as userApi from './userApi'
import { COMP_UPLOADS_CHANGED } from './compUploads'
import { errorMessage } from './format'

// Submits the file changes the Files tab staged by drag-and-drop (see the
// store's stagedFileChanges). These carry no file body - a move is two paths -
// so unlike lib/compUploads there's no progress to report and no chunking:
// the whole batch goes out inline when the user hits Propose.

export function stagedChangeLabel(change: StagedFileChange): string {
  const name = basename(change.path)
  if (change.changeType === 'create_folder') return `New folder “${name}”`
  return `Move ${name}`
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// Folders before the moves that land in them: a reviewer applying the batch in
// order shouldn't hit a move whose destination folder doesn't exist yet.
const ORDER: Record<StagedFileChange['changeType'], number> = {
  create_folder: 0, move_folder: 1, move: 2,
}

function buildForm(change: StagedFileChange): FormData {
  const form = new FormData()
  form.append('file_path', change.path)
  if (change.destination) form.append('destination_path', change.destination)
  form.append('change_type', change.changeType)
  form.append('contributor_notes', '')
  if (change.channel) form.append('channel', change.channel)
  return form
}

/** Proposes every staged change, folder creations first. Each one that lands is
 *  dropped from the queue; failures stay queued carrying the error so they can
 *  be retried without re-dragging everything. */
export async function proposeStagedChanges(): Promise<{ proposed: number; failed: number }> {
  const { stagedFileChanges, updateStagedFileChange, unstageFileChange } = useStore.getState()
  const batch = [...stagedFileChanges].sort((a, b) => ORDER[a.changeType] - ORDER[b.changeType])
  let proposed = 0
  let failed = 0

  for (const change of batch) {
    updateStagedFileChange(change.id, { error: undefined })
    try {
      await userApi.createCompProposal(buildForm(change))
      unstageFileChange(change.id)
      proposed++
    } catch (e) {
      updateStagedFileChange(change.id, { error: errorMessage(e, 'Could not propose this change') })
      failed++
    }
  }

  if (proposed > 0) window.dispatchEvent(new CustomEvent(COMP_UPLOADS_CHANGED))
  return { proposed, failed }
}
