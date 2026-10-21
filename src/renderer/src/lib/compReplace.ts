// Replacing a channel's whole comp from a local folder (Admin → Replace comp,
// and the `comp-replace` terminal command). The folder is compared with the
// live comp so unchanged files are reused by path instead of uploaded again,
// then the new files are staged and the server swaps the comp in one step.
import { stageCompFiles } from './compChunkedUpload'
import { listSubtree } from './juicewrldApi'
import { adminReplaceComp, type CompReplaceFile, type CompReplaceResult } from './userApi'

// The server's ALLOWED_EXTENSIONS. A stage request with one bad file is
// refused whole, so anything else in the folder is left out up front.
const COMP_EXTENSIONS = new Set(['.mp3', '.zip', '.wav', '.mp4', '.m4a', '.mov', '.txt', '.caf', '.mkv', '.flac', '.aiff', '.aif', '.opus', '.png', '.jpg', '.jpeg', '.webp'])

export interface LocalCompFile {
  /** Path inside the new comp, relative to its root. */
  path: string
  file: File
}

export interface CompReplacePlan {
  /** Every entry the new comp will hold, in the order sent. */
  reuse: { path: string; from: string }[]
  upload: LocalCompFile[]
  added: string[]
  changed: string[]
  moved: { from: string; to: string }[]
  removed: string[]
  unchanged: number
  skipped: { path: string; reason: string }[]
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** A folder pick (<input webkitdirectory>) as comp paths. The picked folder is
 *  the comp root, so its own name is dropped. Hidden files and types the comp
 *  doesn't take are skipped with a reason. */
export function localCompFiles(files: ArrayLike<File>): { files: LocalCompFile[]; skipped: { path: string; reason: string }[] } {
  const out: LocalCompFile[] = []
  const skipped: { path: string; reason: string }[] = []
  for (const file of Array.from(files)) {
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/')
    const path = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel
    if (path.split('/').some((part) => part.startsWith('.')) || /^(thumbs\.db|desktop\.ini)$/i.test(file.name)) {
      skipped.push({ path, reason: 'hidden or system file' })
    } else if (!COMP_EXTENSIONS.has(extension(path))) {
      skipped.push({ path, reason: `${extension(path) || 'no extension'} isn't allowed in the comp` })
    } else {
      out.push({ path, file })
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return { files: out, skipped }
}

/** The live comp's files, path → size. Throws while the server is still
 *  building its index, since an empty answer then would plan a full re-upload. */
export async function loadLiveComp(channel?: string): Promise<Map<string, number | null>> {
  const items = await listSubtree('', channel)
  if (items === null) throw new Error('The server is still indexing this comp. Try again in a minute.')
  return new Map(items.filter((i) => i.type === 'file').map((i) => [i.path, i.size ?? null]))
}

/** Which local files can reuse a live one and which need uploading. The file
 *  index has no hashes, so "unchanged" means same path and same size; a file
 *  whose path is new but whose name and size match exactly one file leaving
 *  the comp is treated as moved. `reuploadAll` turns both off. */
export function planCompReplace(local: LocalCompFile[], live: Map<string, number | null>, opts: {
  reuploadAll?: boolean
  skipped?: { path: string; reason: string }[]
} = {}): CompReplacePlan {
  const plan: CompReplacePlan = { reuse: [], upload: [], added: [], changed: [], moved: [], removed: [], unchanged: 0, skipped: opts.skipped ?? [] }
  const newPaths = new Set(local.map((f) => f.path))
  const leaving = [...live.keys()].filter((p) => !newPaths.has(p))
  const byNameSize = new Map<string, string[]>()
  for (const p of leaving) {
    const key = `${p.slice(p.lastIndexOf('/') + 1)}\u0000${live.get(p)}`
    byNameSize.set(key, [...(byNameSize.get(key) ?? []), p])
  }
  const movedFrom = new Set<string>()
  for (const f of local) {
    const liveSize = live.get(f.path)
    if (live.has(f.path)) {
      if (!opts.reuploadAll && liveSize === f.file.size) {
        plan.reuse.push({ path: f.path, from: f.path })
        plan.unchanged++
      } else {
        plan.upload.push(f)
        plan.changed.push(f.path)
      }
      continue
    }
    const candidates = opts.reuploadAll ? undefined : byNameSize.get(`${f.file.name}\u0000${f.file.size}`)
    if (candidates?.length === 1 && !movedFrom.has(candidates[0])) {
      movedFrom.add(candidates[0])
      plan.reuse.push({ path: f.path, from: candidates[0] })
      plan.moved.push({ from: candidates[0], to: f.path })
    } else {
      plan.upload.push(f)
      plan.added.push(f.path)
    }
  }
  plan.removed = leaving.filter((p) => !movedFrom.has(p)).sort()
  return plan
}

export type CompReplacePhase = 'uploading' | 'swapping'

/** Stages the plan's uploads, then asks the server to swap the comp. Abort
 *  only stops the uploads: once the swap request is sent the server finishes
 *  it even if the connection drops. */
export function runCompReplace(plan: CompReplacePlan, opts: {
  channel?: string
  notes?: string
  onPhase?: (phase: CompReplacePhase) => void
  onProgress?: (sent: number, total: number) => void
}): { promise: Promise<CompReplaceResult>; abort: () => void } {
  if (plan.reuse.length + plan.upload.length === 0) throw new Error('The new comp has no files.')
  const staging = stageCompFiles(plan.upload.map((f) => f.file), opts.channel, { onProgress: opts.onProgress })
  const promise = (async () => {
    opts.onPhase?.('uploading')
    const ids = await staging.promise
    const files: CompReplaceFile[] = [
      ...plan.reuse.map((r) => ({ file_path: r.path, from_path: r.from })),
      ...plan.upload.map((f, i) => ({ file_path: f.path, upload_id: ids[i] })),
    ]
    opts.onPhase?.('swapping')
    return adminReplaceComp({ channel: opts.channel, files, notes: opts.notes || undefined })
  })()
  return { promise, abort: staging.abort }
}
