import { routeUrl } from './juicewrldApi'
import { CONTRIBUTOR_ENABLED, getToken } from './userApi'
import type { CompFileProposal } from './userApi'

const ACCOUNT_BASE = routeUrl('/accounts')
export const COMP_CHUNK_THRESHOLD = 16 * 1024 * 1024
const MAX_RETRIES = 3

export interface CompProposalChunkedMeta {
  change_type: string
  file_path: string
  destination_path?: string
  contributor_notes?: string
  is_new_leak?: boolean
  channel?: string
}

type AbortState = { aborted: boolean; xhr: XMLHttpRequest | null }

class HttpError extends Error {
  status?: number
}

function parseXhrError(xhr: XMLHttpRequest, fallback: string): string {
  try {
    const body = JSON.parse(xhr.responseText)
    const first = body?.detail ?? Object.values(body ?? {})[0]
    if (first) return Array.isArray(first) ? String(first[0]) : String(first)
  } catch {
    return fallback
  }
  return fallback
}

function sendXhr<T>(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit | null,
  signal: AbortState,
  onProgress?: (sent: number, total: number) => void,
  json = false,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'))
      return
    }
    const xhr = new XMLHttpRequest()
    signal.xhr = xhr
    xhr.open(method, url)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
    if (json) xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as T) }
        catch { reject(new Error('Upload succeeded but the response was unreadable')) }
        return
      }
      const err = new HttpError(parseXhrError(xhr, `Upload failed (HTTP ${xhr.status})`))
      err.status = xhr.status
      reject(err)
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('cancelled'))
    xhr.send(body)
  })
}

function sleep(ms: number, signal: AbortState): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (signal.aborted) {
        reject(new Error('cancelled'))
        return
      }
      if (Date.now() - started >= ms) {
        resolve()
        return
      }
      setTimeout(tick, 200)
    }
    tick()
  })
}

function retryable(err: unknown): boolean {
  if (!(err instanceof Error) || err.message === 'cancelled') return false
  if (!(err instanceof HttpError) || err.status === undefined) return true
  return err.status >= 500 || err.status === 429
}

async function withRetry<T>(run: () => Promise<T>, signal: AbortState): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new Error('cancelled')
    try {
      return await run()
    } catch (err) {
      last = err
      if (!retryable(err) || attempt === MAX_RETRIES) throw err
      await sleep(2000 * (2 ** attempt), signal)
    }
  }
  throw last instanceof Error ? last : new Error('Upload failed')
}

// init + every chunk, without upload/complete/: leaves a staged upload_id that
// a proposal (complete) or a comp replacement can then use.
async function sendChunks(file: File, channel: string | undefined, signal: AbortState,
  onProgress?: (sent: number, total: number) => void): Promise<string> {
  const init = await withRetry(
    () => sendXhr<{ upload_id: string; chunk_size: number; total_chunks: number }>(
      'POST',
      `${ACCOUNT_BASE}/contributor/proposals/upload/init/`,
      JSON.stringify({
        filename: file.name,
        total_size: file.size,
        ...(channel ? { channel } : {}),
      }),
      signal,
      undefined,
      true,
    ),
    signal,
  )
  const chunkSize = init.chunk_size || COMP_CHUNK_THRESHOLD
  const totalChunks = init.total_chunks || Math.max(1, Math.ceil(file.size / chunkSize))
  for (let i = 0; i < totalChunks; i++) {
    if (signal.aborted) throw new Error('cancelled')
    const start = i * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    const blob = file.slice(start, end)
    const form = new FormData()
    form.append('upload_id', init.upload_id)
    form.append('chunk_index', String(i))
    form.append('chunk', blob, `${file.name}.part.${i}`)
    if (channel) form.append('channel', channel)
    await withRetry(
      () => sendXhr(
        'POST',
        `${ACCOUNT_BASE}/contributor/proposals/upload/chunk/`,
        form,
        signal,
        (sent) => onProgress?.(start + sent, file.size),
      ),
      signal,
    )
    onProgress?.(end, file.size)
  }
  return init.upload_id
}

export function createCompProposalChunked(file: File, metadata: CompProposalChunkedMeta, opts: {
  onProgress?: (sent: number, total: number) => void
} = {}): { promise: Promise<CompFileProposal>; abort: () => void } {
  if (!CONTRIBUTOR_ENABLED) throw new Error('Comp file contributions are not available yet')
  const signal: AbortState = { aborted: false, xhr: null }
  const promise = (async () => {
    const uploadId = await sendChunks(file, metadata.channel, signal, opts.onProgress)
    return withRetry(
      () => sendXhr<CompFileProposal>(
        'POST',
        `${ACCOUNT_BASE}/contributor/proposals/upload/complete/`,
        JSON.stringify({
          upload_id: uploadId,
          change_type: metadata.change_type,
          file_path: metadata.file_path,
          destination_path: metadata.destination_path || '',
          contributor_notes: metadata.contributor_notes || '',
          is_new_leak: !!metadata.is_new_leak,
          ...(metadata.channel ? { channel: metadata.channel } : {}),
        }),
        signal,
        undefined,
        true,
      ),
      signal,
    )
  })()
  return {
    promise,
    abort: () => {
      signal.aborted = true
      signal.xhr?.abort()
    },
  }
}

// Per upload/stage/ request: Django takes at most 100 files, and the proxy in
// front of the API caps the body, so small files go up in groups under both.
const STAGE_MAX_FILES = 100
const STAGE_MAX_BYTES = 64 * 1024 * 1024

/** Stages every file and resolves their upload_ids in the same order. Files of
 *  16 MB and up go in chunks, the rest in groups through upload/stage/.
 *  Progress counts bytes across the whole set. */
export function stageCompFiles(files: File[], channel?: string, opts: {
  onProgress?: (sent: number, total: number) => void
} = {}): { promise: Promise<string[]>; abort: () => void } {
  const signal: AbortState = { aborted: false, xhr: null }
  const total = files.reduce((n, f) => n + f.size, 0)
  let done = 0
  const report = (inFlight: number): void => opts.onProgress?.(done + inFlight, total)

  const promise = (async () => {
    const ids: string[] = new Array(files.length)
    const small: number[] = []
    for (let i = 0; i < files.length; i++) {
      if (files[i].size < COMP_CHUNK_THRESHOLD) { small.push(i); continue }
      ids[i] = await sendChunks(files[i], channel, signal, (sent) => report(sent))
      done += files[i].size
      report(0)
    }
    let group: number[] = []
    let groupBytes = 0
    const flush = async (): Promise<void> => {
      if (group.length === 0) return
      const form = new FormData()
      for (const i of group) form.append('files', files[i], files[i].name)
      if (channel) form.append('channel', channel)
      const res = await withRetry(
        () => sendXhr<{ uploads: { upload_id: string }[] }>(
          'POST', `${ACCOUNT_BASE}/contributor/proposals/upload/stage/`, form, signal, (sent) => report(sent),
        ),
        signal,
      )
      group.forEach((fileIndex, k) => { ids[fileIndex] = res.uploads[k].upload_id })
      done += groupBytes
      report(0)
      group = []
      groupBytes = 0
    }
    for (const i of small) {
      if (group.length >= STAGE_MAX_FILES || (group.length > 0 && groupBytes + files[i].size > STAGE_MAX_BYTES)) await flush()
      group.push(i)
      groupBytes += files[i].size
    }
    await flush()
    return ids
  })()
  return {
    promise,
    abort: () => {
      signal.aborted = true
      signal.xhr?.abort()
    },
  }
}
