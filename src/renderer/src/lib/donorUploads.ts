// Donor file uploads, queued the same way comp proposal uploads are (see
// lib/compUploads): the transfer lives at module scope instead of inside the
// component that started it, so navigating away from Settings/Files doesn't
// kill an upload in progress, and it shows up as a row in the Uploads panel
// like every other transfer.
import { useStore } from '../store/useStore'
import { authHeaders } from './apiClient'
import { getToken } from './userApi'
import { JWAPI_BASE } from './juicewrldApi'
import { errorMessage } from './format'
import type { DonorFile, DonorQuota } from './donorFilesApi'

const BASE = `${JWAPI_BASE}/accounts/donor`

/** Fired on `window` after each file finishes uploading, with the new file +
 *  quota in `detail` - lets any open donor-files UI update without polling. */
export const DONOR_UPLOADS_CHANGED = 'donor-uploads-changed'

export function isDonorUploadId(id: string): boolean {
  return id.startsWith('donor-upload-')
}

interface QueuedDonorUpload {
  id: string
  file: File
}

const queue: QueuedDonorUpload[] = []
const aborts = new Map<string, () => void>()
// Last (bytes, timestamp) sample per job, for the live speed readout.
const samples = new Map<string, { bytes: number; time: number }>()
let running = false

/** Queues already-validated files for upload and opens the Uploads panel.
 *  Callers (DonorFiles) run type/size/quota checks up front so a bad pick
 *  never occupies a manager row. */
export function queueDonorUploads(files: File[]): void {
  if (files.length === 0) return
  const { addUpload, setShowUploadManager } = useStore.getState()
  for (const file of files) {
    const id = `donor-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    queue.push({ id, file })
    addUpload({ id, filename: file.name, type: 'upload', state: 'downloading', percent: 0, received: 0, total: file.size })
  }
  setShowUploadManager(true)
  void run()
}

export function cancelDonorUpload(id: string): void {
  const abort = aborts.get(id)
  if (abort) { abort(); return }
  // Not started yet - drop it from the queue and mark the row itself, since
  // there's no in-flight request whose abort would do it.
  const i = queue.findIndex((j) => j.id === id)
  if (i >= 0) queue.splice(i, 1)
  useStore.getState().updateUpload(id, { state: 'cancelled', speedBps: undefined })
}

export function cancelAllDonorUploads(): void {
  const ids = useStore.getState().uploads.filter((d) => isDonorUploadId(d.id) && d.state === 'downloading').map((d) => d.id)
  for (const id of ids) cancelDonorUpload(id)
}

async function run(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      if (useStore.getState().uploads.find((d) => d.id === job.id)?.state === 'cancelled') continue
      await runOne(job)
    }
  } finally {
    running = false
  }
}

function startXhrUpload(job: QueuedDonorUpload): { promise: Promise<{ file: DonorFile; quota: DonorQuota }>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<{ file: DonorFile; quota: DonorQuota }>((resolve, reject) => {
    const body = new FormData()
    body.append('file', job.file)
    xhr.open('POST', `${BASE}/files/upload/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      const now = Date.now()
      const prev = samples.get(job.id) ?? { bytes: 0, time: now }
      let speedBps: number | undefined
      const dt = (now - prev.time) / 1000
      if (dt >= 0.4) {
        speedBps = Math.max(0, (e.loaded - prev.bytes) / dt)
        samples.set(job.id, { bytes: e.loaded, time: now })
      }
      useStore.getState().updateUpload(job.id, {
        percent: e.total ? Math.round((e.loaded / e.total) * 100) : 0,
        received: e.loaded, total: e.total, bytesReceived: e.loaded,
        ...(speedBps !== undefined ? { speedBps } : {}),
      })
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('cancelled'))
    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = undefined }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as { file: DonorFile; quota: DonorQuota }); return }
      const d = data as { detail?: string; error?: string } | undefined
      reject(new Error(xhr.status === 429
        ? 'Upload limit reached (60 per hour). Try again later.'
        : d?.detail || d?.error || `Upload failed (${xhr.status})`))
    }
    xhr.send(body)
  })
  return { promise, abort: () => xhr.abort() }
}

async function runOne(job: QueuedDonorUpload): Promise<void> {
  const { promise, abort } = startXhrUpload(job)
  aborts.set(job.id, abort)
  try {
    const res = await promise
    useStore.getState().updateUpload(job.id, { state: 'done', percent: 100, speedBps: undefined })
    const s = useStore.getState()
    s.setDonorFiles([res.file, ...(s.donorFiles ?? [])])
    window.dispatchEvent(new CustomEvent(DONOR_UPLOADS_CHANGED, { detail: res }))
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
