import { useStore } from '../store/useStore'
import { createCompProposalUpload } from './userApi'
import { COMP_CHUNK_THRESHOLD, createCompProposalChunked } from './compChunkedUpload'
import { errorMessage } from './format'

// Comp file proposals carry the actual file body - routinely a few hundred
// megabytes - and used to be awaited inside the Contributor page's submit
// handler, which meant leaving that page (or closing the window) killed the
// upload halfway. The queue lives here at module scope instead: submitting
// hands the jobs over and returns immediately, and progress shows up as a task
// in the Uploads panel like any other transfer.
//
// Uploads run one at a time, for the same reason the old batch loop did:
// twenty file bodies in flight at once is a good way to get rate-limited
// partway through with no idea which ones landed.

export interface CompUploadJob {
  /** Shown as the task's name in the Uploads panel. */
  label: string
  form: FormData
  /** Byte size, when known, so the row can show "12 MB / 300 MB" before the
   *  first progress event arrives. */
  bytes?: number
}

type QueuedJob = CompUploadJob & { id: string }

/** Fired on `window` after each proposal is accepted, so an open Contributor
 *  page can refresh its list without this module knowing anything about it. */
export const COMP_UPLOADS_CHANGED = 'comp-uploads-changed'

const queue: QueuedJob[] = []
const aborts = new Map<string, () => void>()
// Last (bytes, timestamp) sample per job, for the live speed readout.
const samples = new Map<string, { bytes: number; time: number }>()
let running = false

export function isCompUploadId(id: string): boolean {
  return id.startsWith('comp-upload-')
}

export function queueCompUploads(jobs: CompUploadJob[]): void {
  if (jobs.length === 0) return
  const { addUpload, setShowUploadManager } = useStore.getState()
  for (const job of jobs) {
    const id = `comp-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    queue.push({ ...job, id })
    addUpload({
      id, filename: job.label, type: 'upload', state: 'downloading',
      percent: 0, received: 0, total: job.bytes,
    })
  }
  setShowUploadManager(true)
  void run()
}

export function cancelCompUpload(id: string): void {
  const abort = aborts.get(id)
  if (abort) { abort(); return }
  // Not started yet - drop it from the queue and mark the row itself, since
  // there's no in-flight request whose rejection would do it.
  const i = queue.findIndex((j) => j.id === id)
  if (i >= 0) queue.splice(i, 1)
  useStore.getState().updateUpload(id, { state: 'cancelled', speedBps: undefined })
}

export function cancelAllCompUploads(): void {
  const ids = useStore.getState().uploads.filter((d) => d.type === 'upload' && d.state === 'downloading').map((d) => d.id)
  for (const id of ids) cancelCompUpload(id)
}

async function run(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      // Cancelled while it sat in the queue behind another upload.
      if (useStore.getState().uploads.find((d) => d.id === job.id)?.state === 'cancelled') continue
      await runOne(job)
    }
  } finally {
    running = false
    window.dispatchEvent(new CustomEvent(COMP_UPLOADS_CHANGED))
  }
}

function startUpload(job: QueuedJob): { promise: Promise<unknown>; abort: () => void } {
  const onProgress = (sent: number, total: number): void => {
    const now = Date.now()
    const prev = samples.get(job.id) ?? { bytes: 0, time: now }
    let speedBps: number | undefined
    const dt = (now - prev.time) / 1000
    if (dt >= 0.4) {
      speedBps = Math.max(0, (sent - prev.bytes) / dt)
      samples.set(job.id, { bytes: sent, time: now })
    }
    useStore.getState().updateUpload(job.id, {
      percent: total ? Math.round((sent / total) * 100) : 0,
      received: sent, total, bytesReceived: sent,
      ...(speedBps !== undefined ? { speedBps } : {}),
    })
  }
  const file = job.form.get('file')
  if ((job.bytes ?? 0) >= COMP_CHUNK_THRESHOLD && file instanceof File) {
    return createCompProposalChunked(file, {
      change_type: String(job.form.get('change_type') || 'upload'),
      file_path: String(job.form.get('file_path') || ''),
      destination_path: String(job.form.get('destination_path') || ''),
      contributor_notes: String(job.form.get('contributor_notes') || ''),
      channel: String(job.form.get('channel') || ''),
    }, { onProgress })
  }
  return createCompProposalUpload(job.form, { onProgress })
}

async function runOne(job: QueuedJob): Promise<void> {
  const { promise, abort } = startUpload(job)
  aborts.set(job.id, abort)
  try {
    await promise
    useStore.getState().updateUpload(job.id, { state: 'done', percent: 100, speedBps: undefined })
    window.dispatchEvent(new CustomEvent(COMP_UPLOADS_CHANGED))
  } catch (e) {
    const msg = errorMessage(e, 'Upload failed')
    useStore.getState().updateUpload(job.id, msg === 'cancelled'
      ? { state: 'cancelled', speedBps: undefined }
      : { state: 'error', error: msg, speedBps: undefined })
  } finally {
    aborts.delete(job.id)
    samples.delete(job.id)
  }
}
