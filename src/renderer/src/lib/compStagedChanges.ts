import { useStore, StagedFileChange } from '../store/useStore'
import * as userApi from './userApi'
import { COMP_UPLOADS_CHANGED, queueCompUploads } from './compUploads'
import { errorMessage } from './format'
import { apiFetch, listFilesRecursive, listSubtree, parseBrowseEntries, type JWApiBrowseResponse, type JWApiFileEntry } from './juicewrldApi'

// Submits the file changes the Files tab staged by drag-and-drop (see the
// store's stagedFileChanges). Moves and new folders carry no file body - a move
// is two paths - so they go out inline when the user hits Propose. Staged
// uploads do carry one, so Propose hands those to lib/compUploads' background
// queue instead, where they get progress, chunking and cancel like any upload.

export function stagedChangeLabel(change: StagedFileChange): string {
  const name = basename(change.path)
  if (change.changeType === 'create_folder') return `New folder “${name}”`
  if (change.changeType === 'upload') return `Upload ${name}`
  return `Move ${name}`
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/** Which of a drop's paths (relative to `folder`) already hold a file in the
 *  comp. The server refuses an upload onto an occupied path, but only after the
 *  whole body has gone up - so dropping an entire comp would re-send every file
 *  just to have most of them bounced. Lookups are scoped to the top-level
 *  entries of the drop: loose files check `folder`'s own listing, each dropped
 *  folder checks its subtree. A lookup that fails flags nothing, since the
 *  server still turns duplicates away. Returns full channel-relative paths. */
export async function existingCompPaths(folder: string, relPaths: string[], channel?: string): Promise<Set<string>> {
  const join = (rel: string): string => (folder ? `${folder}/${rel}` : rel)
  const topFolders = new Set<string>()
  let looseFiles = false
  for (const rel of relPaths) {
    const slash = rel.indexOf('/')
    if (slash < 0) looseFiles = true
    else topFolders.add(rel.slice(0, slash))
  }

  const lookups = [...topFolders].map(async (top) => {
    // list-all answers from the server's cached index (up to a few minutes
    // stale); null means that index is still building, so walk it by hand.
    const path = join(top)
    return (await listSubtree(path, channel)) ?? await listFilesRecursive(path, channel)
  })
  if (looseFiles) {
    lookups.push(apiFetch<JWApiBrowseResponse>('/files/browse/', { path: folder || undefined, channel }).then(parseBrowseEntries))
  }

  const found = new Set<string>()
  for (const entries of await Promise.all(lookups.map((p) => p.catch((): JWApiFileEntry[] => [])))) {
    for (const e of entries) if (e.type === 'file') found.add(e.path)
  }
  return found
}

export interface DropPlan {
  /** Where each dropped file lands, channel-relative, in input order. */
  paths: string[]
  /** Which of `paths` already hold a file in the comp. */
  existing: Set<string>
  /** Set when the drop was one folder whose contents match the target's own,
   *  so its contents were merged in rather than nested under this name. */
  mergedFolder?: string
}

/** Resolves where a drop's files land and which are already there. Dragging a
 *  comp's own top folder (or "Era 1" onto "Era 1") would otherwise nest it
 *  under its name and upload a second copy of everything, so a lone folder
 *  whose contents mostly line up with `folder` itself is merged into it. A
 *  handful of matches isn't enough to tell, so small drops stay nested. */
export async function planDroppedUploads(folder: string, relPaths: string[], channel?: string): Promise<DropPlan> {
  const join = (rel: string): string => (folder ? `${folder}/${rel}` : rel)
  const nestedPaths = relPaths.map(join)
  const top = relPaths[0]?.split('/')[0]
  if (!top || !relPaths.every(r => r.startsWith(`${top}/`))) return { paths: nestedPaths, existing: await existingCompPaths(folder, relPaths, channel) }

  const inner = relPaths.map(r => r.slice(top.length + 1))
  const innerPaths = inner.map(join)
  const [nestedFound, innerFound] = await Promise.all([
    existingCompPaths(folder, relPaths, channel),
    existingCompPaths(folder, inner, channel),
  ])
  const hits = (paths: string[], found: Set<string>): number => paths.filter(p => found.has(p)).length
  const innerHits = hits(innerPaths, innerFound)
  if (innerHits >= 3 && innerHits * 2 > relPaths.length && innerHits > hits(nestedPaths, nestedFound)) {
    return { paths: innerPaths, existing: innerFound, mergedFolder: top }
  }
  return { paths: nestedPaths, existing: nestedFound }
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
