import { useStore, StagedFileChange } from '../store/useStore'
import * as userApi from './userApi'
import { COMP_UPLOADS_CHANGED } from './compUploads'
import { apiFetch, parseBrowseEntries, JWApiBrowseResponse } from './juicewrldApi'

// Submits the file changes the Files tab staged by drag-and-drop (see the
// store's stagedFileChanges). These carry no file body — a move is two paths —
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

/** Whether `folder` exists in the tree right now. A folder only becomes real
 *  once its create_folder proposal is approved, and the API refuses a move
 *  into a path that isn't there — so this is what decides when the moves that
 *  were bundled behind a new folder can finally go out. */
async function folderExists(folder: string, channel: string): Promise<boolean> {
  const parent = folder.split('/').filter(Boolean).slice(0, -1).join('/')
  const params: Record<string, string> = {}
  if (parent) params.path = parent
  if (channel) params.channel = channel
  try {
    const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', params)
    return parseBrowseEntries(data).some(e => e.type === 'directory' && e.path === folder)
  } catch {
    // Can't tell — treat as missing rather than firing a move that would only
    // come back as "no active file exists at this path".
    return false
  }
}

/** Proposes every staged change, folder creations first. Each one that lands is
 *  dropped from the queue; failures stay queued carrying the error so they can
 *  be retried without re-dragging everything. Moves waiting on a folder that
 *  doesn't exist yet are held back untouched and reported as `held` — running
 *  this again after the folder's proposal is approved sends them. */
export async function proposeStagedChanges(): Promise<{ proposed: number; failed: number; held: number }> {
  const { stagedFileChanges, updateStagedFileChange, unstageFileChange } = useStore.getState()
  const batch = [...stagedFileChanges].sort((a, b) => ORDER[a.changeType] - ORDER[b.changeType])
  let proposed = 0
  let failed = 0
  let held = 0

  // Folders proposed in this very batch can't be approved yet, so anything
  // waiting on one is held without spending a lookup on it.
  const proposedThisRun = new Set<string>()
  const existsCache = new Map<string, boolean>()

  for (const change of batch) {
    if (change.awaitingFolder) {
      const key = `${change.channel}/${change.awaitingFolder}`
      let ready = !proposedThisRun.has(key)
      if (ready) {
        const cached = existsCache.get(key)
        ready = cached ?? await folderExists(change.awaitingFolder, change.channel)
        existsCache.set(key, ready)
      }
      if (!ready) { held++; continue }
      // The folder is real now, so this is an ordinary move from here on.
      updateStagedFileChange(change.id, { awaitingFolder: undefined })
    }

    updateStagedFileChange(change.id, { error: undefined })
    try {
      await userApi.createCompProposal(buildForm(change))
      unstageFileChange(change.id)
      if (change.changeType === 'create_folder') proposedThisRun.add(`${change.channel}/${change.path}`)
      proposed++
    } catch (e) {
      updateStagedFileChange(change.id, { error: e instanceof Error ? e.message : 'Could not propose this change' })
      failed++
    }
  }

  if (proposed > 0) window.dispatchEvent(new CustomEvent(COMP_UPLOADS_CHANGED))
  return { proposed, failed, held }
}
