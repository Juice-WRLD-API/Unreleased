import { useStore, StagedFileChange } from '../store/useStore'
import * as userApi from './userApi'
import { COMP_UPLOADS_CHANGED, queueCompUploads } from './compUploads'
import { errorMessage } from './format'

// Submits the file changes the Files tab staged by drag-and-drop (see the
// store's stagedFileChanges). Moves and new folders carry no file body - a move
// is two paths - so they go out inline when the user hits Propose. Staged
// uploads do carry one, so Propose hands those to lib/compUploads' background
// queue instead, where they get progress, chunking and cancel like any upload.

export function stagedChangeLabel(change: StagedFileChange): string {
  const name = basename(change.path)
  if (change.changeType === 'create_folder') return `New folder "${name}"`
  if (change.changeType === 'upload') return `Upload ${name}`
  return `Move ${name}`
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// Folders before the moves that land in them: a reviewer applying the batch in
// order shouldn't hit a move whose destination folder doesn't exist yet.
const ORDER: Record<StagedFileChange['changeType'], number> = {
  create_folder: 0, move_folder: 1, move: 2, upload: 3,
}

function buildForm(change: StagedFileChange): FormData {
  const form = new FormData()
  form.append('file_path', change.path)
  if (change.destination) form.append('destination_path', change.destination)
  form.append('change_type', change.changeType)
  form.append('contributor_notes', change.notes ?? '')
  if (change.changeType === 'upload') {
    form.append('is_new_leak', change.isNewLeak ? 'true' : 'false')
    if (change.file) form.append('file', change.file)
  }
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

  // Uploads go last and in one hand-off, so the background queue starts only
  // once the folders/moves they may depend on have been proposed.
  const uploads = batch.filter(c => c.changeType === 'upload')
  for (const change of batch) {
    if (change.changeType === 'upload') continue
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

  if (uploads.length > 0) {
    queueCompUploads(uploads.map(c => ({ label: c.path, form: buildForm(c), bytes: c.file?.size })))
    for (const c of uploads) unstageFileChange(c.id)
    proposed += uploads.length
  }

  if (proposed > uploads.length) window.dispatchEvent(new CustomEvent(COMP_UPLOADS_CHANGED))
  return { proposed, failed }
}
