// Builds ZIP archives in the browser now that backend ZIP jobs are disabled
// (see ZIP_OPERATIONS_ENABLED in juicewrldApi.ts). Every file is fetched from
// its stream URL (the API sends Access-Control-Allow-Origin) and fed into
// client-zip, which stores entries uncompressed - audio is already
// compressed, so deflating it again would burn CPU for nothing.
//
// Where the File System Access API exists (Chromium desktop, Electron) the
// archive streams straight to disk, so memory stays flat however big it
// gets. Elsewhere (Firefox, Safari, mobile) it streams through the service
// worker (public/sw.js) as a normal browser download, which is just as flat.
// Only if neither is available is it assembled in memory, cut into parts of at
// most MEMORY_ZIP_LIMIT ("Name (part 2).zip"), each saved as soon as it fills.
//
// Two-step API because showSaveFilePicker needs transient user activation:
// call openZipTarget() first thing in the click handler, before any await
// (listing a folder, fetching a playlist), then writeZip() once the file
// list is known.
import { downloadZip } from 'client-zip'
import cdnService from './cdn'
import { embedForDownload, embedSafe } from './downloadEmbed'
import { triggerDownload } from './apiFilesShared'
import { errorMessage } from './format'
import { showAppToast } from './appToast'
import { runLog } from './runLog'
import { useStore } from '../store/useStore'
import { isMobileViewport } from '../hooks/useIsMobile'

export interface ZipItem {
  /** Path inside the archive - may contain '/' for subfolders. */
  name: string
  url: string
  /** Library path to try the distributed CDN with first (primary channel only). */
  cdnPath?: string
  size?: number | null
  /** The song this file is, for the "Add song info to downloads" setting. */
  songId?: number | null
}

export interface ZipProgress { done: number; total: number }
export interface ZipResult { saved: number; failed: number; cancelled?: boolean; /** ZIPs saved, when split into parts. */ parts?: number }

export type ZipTarget =
  | { kind: 'disk'; handle: FileSystemFileHandle; filename: string }
  | { kind: 'stream'; filename: string }
  | { kind: 'memory'; filename: string }

// Largest in-memory ZIP part - well under what a desktop tab can hold, and
// mobile Safari tends to kill tabs not far past it.
const MEMORY_ZIP_LIMIT = 1024 * 1024 * 1024
// Files fetched ahead of the one being written. Keeps the pipe full without
// hammering the API with a whole folder's worth of requests at once.
const PREFETCH = 3

type SavePicker = (opts: {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/** Resolves to where the ZIP should go, or null if the user cancelled the
 *  save dialog. Must be called before the handler's first await. */
export async function openZipTarget(baseName: string): Promise<ZipTarget | null> {
  const filename = `${sanitizeName(baseName) || 'download'}.zip`
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  if (!picker) return fallbackTarget(filename)
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    })
    return { kind: 'disk', handle, filename: handle.name }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    // SecurityError (activation lapsed) or anything else - use the fallback.
    return fallbackTarget(filename)
  }
}

function fallbackTarget(filename: string): ZipTarget {
  const controlled = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller
  return { kind: controlled ? 'stream' : 'memory', filename }
}

/** Opens a download served by the service worker and returns a sink that
 *  feeds it. Rejects if the worker doesn't pick the request up (not
 *  controlling the page yet, or an older worker without the handler). */
async function openStreamSink(filename: string): Promise<WritableStream<Uint8Array>> {
  const sw = navigator.serviceWorker?.controller
  if (!sw) throw new Error('No service worker')
  const id = crypto.randomUUID()
  const { port1, port2 } = new MessageChannel()
  let waiter: { resolve: () => void; reject: (e: unknown) => void } | null = null
  let cancelled = false
  let onStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { onStarted = resolve })
  port1.onmessage = ({ data }) => {
    if (data.type === 'started') onStarted()
    else if (data.type === 'ack') { waiter?.resolve(); waiter = null }
    else if (data.type === 'cancel') {
      // The user cancelled in the browser's download UI.
      cancelled = true
      waiter?.reject(new DOMException('Cancelled', 'AbortError'))
      waiter = null
    }
  }
  sw.postMessage({ type: 'zip-open', id, filename }, [port2])

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.src = `/__zip-download/${id}`
  document.body.appendChild(frame)
  const dispose = (): void => { port1.close(); setTimeout(() => frame.remove(), 5000) }

  const ok = await Promise.race([started.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))])
  if (!ok) { dispose(); throw new Error('Service worker did not respond') }

  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (cancelled) throw new DOMException('Cancelled', 'AbortError')
      // Copy: the transfer detaches the buffer, and chunks can be views into
      // a larger one the zipper still uses.
      const copy = chunk.slice().buffer
      return new Promise<void>((resolve, reject) => {
        waiter = { resolve, reject }
        port1.postMessage({ type: 'chunk', chunk: copy }, [copy])
      })
    },
    close() { port1.postMessage({ type: 'end' }); dispose() },
    abort() { port1.postMessage({ type: 'abort' }); dispose() },
  })
}

interface WriteZipOpts {
  signal?: AbortSignal
  onProgress?: (p: ZipProgress) => void
  onBytes?: (bytes: number) => void
  /** A memory target filled one part and started part `part` (2, 3...). */
  onPart?: (part: number) => void
}

/** Fetches every item into one ZIP (several, for a big memory target) and
 *  saves it to `target`. Items that fail to fetch are left out and counted
 *  in `failed`. Throws AbortError if `signal` fires. */
export async function writeZip(target: ZipTarget, items: ZipItem[], opts: WriteZipOpts = {}): Promise<ZipResult> {
  const { signal, onProgress, onBytes } = opts
  let sink: WritableStream<Uint8Array> | null = null
  if (target.kind === 'stream') {
    try { sink = await openStreamSink(target.filename) } catch { target = { kind: 'memory', filename: target.filename } }
  }

  const result: ZipResult = { saved: 0, failed: 0 }
  const total = items.length
  onProgress?.({ done: 0, total })
  const entries = zipEntries(dedupeNames(items), result, (done) => onProgress?.({ done, total }), signal)
  if (target.kind === 'memory') return writeMemoryParts(target.filename, entries, result, opts)
  const zip = downloadZip(entries).body
  if (!zip) throw new Error('ZIP stream unavailable')

  let bytes = 0
  const body = zip.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      onBytes?.(bytes)
      controller.enqueue(chunk)
    },
  }))

  // On failure or abort pipeTo aborts the writable, which discards the
  // partial file.
  const dest = sink ?? await (target as Extract<ZipTarget, { kind: 'disk' }>).handle.createWritable()
  await body.pipeTo(dest, { signal })
  return result
}

/** The in-memory target: files are collected as Blobs and zipped a part at a
 *  time, each part saved once the next file wouldn't fit. A lone file over
 *  the limit is saved by itself, unzipped. One part keeps the plain name. */
async function writeMemoryParts(
  filename: string,
  entries: AsyncGenerator<{ name: string; input: Response | Blob; url: string }>,
  result: ZipResult,
  opts: WriteZipOpts
): Promise<ZipResult> {
  const { onBytes, onPart } = opts
  const stem = filename.replace(/\.zip$/i, '')
  let part: { name: string; input: Blob }[] = []
  let partBytes = 0
  let parts = 0
  let bytes = 0

  const flush = async (last: boolean): Promise<void> => {
    if (part.length === 0) return
    parts++
    const zip = await downloadZip(part).blob()
    part = []
    partBytes = 0
    saveBlob(zip, last && parts === 1 ? filename : `${stem} (part ${parts}).zip`)
    if (!last) onPart?.(parts + 1)
  }

  for await (const { name, input, url } of entries) {
    const baseName = name.split('/').pop() || name
    const length = input instanceof Blob ? input.size : Number(input.headers.get('content-length')) || 0
    if (length > MEMORY_ZIP_LIMIT) {
      // Too big for any part: let the browser download it straight from the
      // server rather than pulling it into memory first.
      if (input instanceof Blob) saveBlob(input, baseName)
      else { void input.body?.cancel(); triggerDownload(url, baseName) }
      bytes += length
      onBytes?.(bytes)
      continue
    }
    const blob = input instanceof Blob ? input : await input.blob()
    bytes += blob.size
    onBytes?.(bytes)
    if (partBytes + blob.size > MEMORY_ZIP_LIMIT) await flush(false)
    part.push({ name, input: blob })
    partBytes += blob.size
  }
  await flush(true)
  return parts > 1 ? { ...result, parts } : result
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const zipAborts = new Map<string, AbortController>()

export function isZipTaskId(id: string): boolean {
  return id.startsWith('zip-')
}

export function cancelZipTask(id: string): void {
  zipAborts.get(id)?.abort()
}

/** The usual entry point for a bulk "Download": writeZip, tracked as a task
 *  in the Downloads panel (progress, size, speed, cancel). A cancelled ZIP
 *  resolves with `cancelled: true` rather than throwing. */
export async function saveItems(
  target: ZipTarget,
  items: ZipItem[],
  onProgress?: (p: ZipProgress) => void
): Promise<ZipResult> {
  const id = `zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ctrl = new AbortController()
  zipAborts.set(id, ctrl)
  const { addDownload, updateDownload, setShowDownloadManager } = useStore.getState()

  // The archive is barely bigger than its files (stored, not deflated), so
  // their summed size is a good enough total when every size is known.
  const knownTotal = items.every((i) => i.size != null)
    ? items.reduce((sum, i) => sum + (i.size ?? 0), 0) || undefined
    : undefined
  const fileCount = items.length
  let done = 0
  let bytes = 0
  let part = 1
  let sample = { bytes: 0, time: Date.now() }
  let lastPush = 0
  const push = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastPush < 250) return
    lastPush = now
    let speedBps: number | undefined
    const dt = (now - sample.time) / 1000
    if (dt >= 0.4) {
      speedBps = Math.max(0, (bytes - sample.bytes) / dt)
      sample = { bytes, time: now }
    }
    const fraction = knownTotal ? bytes / knownTotal : done / fileCount
    updateDownload(id, {
      percent: Math.min(99, Math.round(fraction * 100)),
      received: bytes,
      bytesReceived: bytes,
      detail: `${done} / ${fileCount} file${fileCount === 1 ? '' : 's'}${part > 1 ? ` · part ${part}` : ''}`,
      ...(speedBps !== undefined ? { speedBps } : {}),
    })
  }

  addDownload({
    id, filename: target.filename, type: 'zip', state: 'downloading',
    percent: 0, received: 0, total: knownTotal, detail: `0 / ${fileCount} file${fileCount === 1 ? '' : 's'}`,
  })
  // The panel is anchored to the desktop sidebar; mobile views show their
  // own inline progress instead.
  if (!isMobileViewport()) setShowDownloadManager(true)

  try {
    const result = await writeZip(target, items, {
      signal: ctrl.signal,
      onProgress: (p) => { done = p.done; onProgress?.(p); push() },
      onBytes: (b) => { bytes = b; push() },
      onPart: (n) => {
        // The panel is easy to miss, and mobile never opens it.
        if (n === 2) showAppToast('This ZIP is over 1 GB, so it will download in parts', { tone: 'info' })
        part = n
        push(true)
      },
    })
    updateDownload(id, {
      state: result.saved > 0 ? 'done' : 'error',
      percent: 100,
      speedBps: undefined,
      detail: `${result.saved} file${result.saved === 1 ? '' : 's'}${result.parts ? ` in ${result.parts} ZIPs` : ''}${result.failed ? ` · ${result.failed} failed` : ''}`,
      error: result.saved > 0 ? undefined : 'No files could be downloaded',
    })
    return result
  } catch (err) {
    if (ctrl.signal.aborted) {
      updateDownload(id, { state: 'cancelled', speedBps: undefined, error: 'Cancelled' })
      return { saved: 0, failed: 0, cancelled: true }
    }
    updateDownload(id, { state: 'error', speedBps: undefined, error: errorMessage(err, 'ZIP failed') })
    throw err
  } finally {
    zipAborts.delete(id)
  }
}

async function* zipEntries(
  items: ZipItem[],
  result: ZipResult,
  onDone: (done: number) => void,
  signal?: AbortSignal
): AsyncGenerator<{ name: string; input: Response | Blob; url: string; lastModified?: Date }> {
  const pending = items.map(() => null as Promise<Response | Blob | null> | null)
  const start = (i: number): void => {
    if (i < items.length && !pending[i]) pending[i] = fetchItem(items[i], signal)
  }
  for (let i = 0; i < Math.min(PREFETCH, items.length); i++) start(i)

  for (let i = 0; i < items.length; i++) {
    signal?.throwIfAborted()
    start(i)
    const input = await pending[i]
    pending[i] = null
    start(i + PREFETCH)
    if (input) {
      result.saved++
      yield { name: items[i].name, input, url: items[i].url }
    } else {
      result.failed++
    }
    onDone(i + 1)
  }
}

async function fetchItem(item: ZipItem, signal?: AbortSignal): Promise<Response | Blob | null> {
  const embedPromise = embedForDownload(item.songId, item.name)
  const input = await fetchItemRaw(item, signal)
  const embed = await embedPromise
  if (!input || !embed) return input
  try {
    const blob = input instanceof Blob ? input : await input.blob()
    return await embedSafe(blob, embed)
  } catch {
    return null
  }
}

async function fetchItemRaw(item: ZipItem, signal?: AbortSignal): Promise<Response | Blob | null> {
  if (item.cdnPath) {
    const cdn = await cdnService.tryDownload(item.cdnPath).catch(() => null)
    if (cdn) return cdn.blob
  }
  const opened = await openZipItem(item, signal)
  return opened ? resumableZipBody(item, opened, signal) : null
}

// A connection can stop sending partway through a file without ever failing:
// no error, no close. Nothing timed that out, so one stalled file left a
// many-GB ZIP sitting at the same percent for good, and one that did fail
// threw the whole archive away. Now a file whose bytes stop for STALL_MS while
// the ZIP waits on it, or whose connection drops, picks up where it stopped.
const STALL_MS = 30_000
// No response headers by now counts as a failed request.
const HEADERS_TIMEOUT_MS = 60_000
// Tries for a file's first request (network errors, 5xx, 429)...
const OPEN_ATTEMPTS = 3
// ...and times one file may resume before the ZIP gives up on it.
const MAX_RESUMES = 5

interface OpenedItem { res: Response; request: AbortController }

function logZip(message: string): void {
  console.warn(`[zip] ${message}`)
  runLog('zip', message)
}

/** An AbortController of its own that also follows `signal` (the user's
 *  cancel), so one stalled request can be dropped without the rest. */
function linkedAbort(signal?: AbortSignal): AbortController {
  const ctrl = new AbortController()
  if (signal?.aborted) ctrl.abort(signal.reason)
  else signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true })
  return ctrl
}

/** Waits before another try: longer each time, and for as long as the
 *  device is offline. Rejects if `signal` fires. */
async function zipRetryPause(attempt: number, signal?: AbortSignal): Promise<void> {
  const wait = (ms: number | null): Promise<void> => new Promise((resolve, reject) => {
    const done = (): void => { clearTimeout(timer); window.removeEventListener('online', done); signal?.removeEventListener('abort', stop); resolve() }
    const stop = (): void => { clearTimeout(timer); window.removeEventListener('online', done); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
    const timer = ms == null ? undefined : setTimeout(done, ms)
    if (ms == null) window.addEventListener('online', done)
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
  })
  if (navigator.onLine === false) await wait(null)
  await wait(Math.min(2000 * 2 ** (attempt - 1), 20_000))
}

/** The item's request, retried a few times on a network error, 5xx or 429.
 *  Null when the server says no (4xx) or every try failed. */
async function openZipItem(item: ZipItem, signal?: AbortSignal, headers?: Record<string, string>): Promise<OpenedItem | null> {
  for (let attempt = 1; ; attempt++) {
    const request = linkedAbort(signal)
    const timer = setTimeout(() => request.abort(new DOMException('No response', 'TimeoutError')), HEADERS_TIMEOUT_MS)
    let failure: string
    try {
      const res = await fetch(item.url, { credentials: 'omit', signal: request.signal, headers })
      if (res.ok) return { res, request }
      void res.body?.cancel().catch(() => {})
      failure = `HTTP ${res.status}`
      if (res.status < 500 && res.status !== 429) { logZip(`"${item.name}": ${failure}, left out`); return null }
    } catch (e) {
      if (signal?.aborted) return null
      failure = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    } finally {
      clearTimeout(timer)
    }
    if (attempt >= OPEN_ATTEMPTS) { logZip(`"${item.name}": ${failure} after ${attempt} tries, left out`); return null }
    logZip(`"${item.name}": ${failure}, trying again (${attempt}/${OPEN_ATTEMPTS})`)
    try { await zipRetryPause(attempt, signal) } catch { return null }
  }
}

/** The response with a body that resumes after a stall or a dropped
 *  connection: a Range request for the rest, checked to be the same file
 *  (size and ETag) so the bytes join up. client-zip reads the body, size and
 *  date off the Response, so the stand-in carries the same headers. */
function resumableZipBody(item: ZipItem, opened: OpenedItem, signal?: AbortSignal): Response {
  const first = opened.res
  if (!first.body) return first
  const total = Number(first.headers.get('content-length')) || 0
  const etag = first.headers.get('etag')
  let request = opened.request
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = first.body.getReader()
  let received = 0
  let resumes = 0
  let failure = ''
  let waiting = false
  let lastByteAt = Date.now()
  // Started on the first read, and judged only while the ZIP is waiting on
  // this file: a prefetched file sits unread until its turn, which isn't a stall.
  let watchdog: ReturnType<typeof setInterval> | null = null
  const finish = (): void => { if (watchdog) clearInterval(watchdog) }

  const giveUp = (why: string): Error => {
    finish()
    logZip(`"${item.name}": giving up at ${received} of ${total || '?'} bytes, ${why}`)
    return new Error(`Couldn't download "${item.name.split('/').pop()}": ${why}`)
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      watchdog ??= setInterval(() => {
        if (waiting && Date.now() - lastByteAt > STALL_MS) request.abort(new DOMException(`no data for ${STALL_MS / 1000}s`, 'TimeoutError'))
      }, 5000)
      for (;;) {
        if (reader) {
          try {
            waiting = true
            lastByteAt = Date.now()
            const { done, value } = await reader.read()
            waiting = false
            if (done) {
              if (total && received < total) throw new Error(`the connection closed at ${received} of ${total} bytes`)
              finish()
              controller.close()
              return
            }
            received += value.byteLength
            controller.enqueue(value)
            return
          } catch (e) {
            waiting = false
            if (signal?.aborted) { finish(); throw signal.reason ?? e }
            const reason = request.signal.reason
            failure = reason instanceof DOMException && reason.name === 'TimeoutError' ? reason.message
              : e instanceof Error ? e.message : String(e)
          }
          reader.cancel().catch(() => {})
          reader = null
        }
        if (!total || ++resumes > MAX_RESUMES) throw giveUp(total ? `the connection kept dropping (${failure})` : failure)
        logZip(`"${item.name}": ${failure} at ${received} of ${total} bytes, resuming (${resumes}/${MAX_RESUMES})`)
        try { await zipRetryPause(resumes, signal) } catch (e) { finish(); throw e }
        const next = await openZipItem(item, signal, { Range: `bytes=${received}-` })
        if (signal?.aborted) { finish(); throw signal.reason }
        if (!next) { failure = 'the server would not resume'; continue }
        const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(next.res.headers.get('content-range') ?? '')
        const sameFile = next.res.status === 206 && range && Number(range[1]) === received && Number(range[2]) === total
          && (!etag || !next.res.headers.get('etag') || next.res.headers.get('etag') === etag)
        if (!sameFile || !next.res.body) {
          next.request.abort()
          throw giveUp(`the server sent the file again from another point or as another version (HTTP ${next.res.status})`)
        }
        request = next.request
        reader = next.res.body.getReader()
      }
    },
    cancel(reason) {
      finish()
      void reader?.cancel(reason).catch(() => {})
    },
  })
  return new Response(body, { status: first.status, headers: first.headers })
}

/** Two selected folders can both hold "Untitled.mp3" - suffix repeats the
 *  way a file manager would ("Untitled (2).mp3") instead of letting the
 *  later entry shadow the earlier one inside the archive. */
function dedupeNames(items: ZipItem[]): ZipItem[] {
  const seen = new Set<string>()
  return items.map((item) => {
    let name = item.name
    const dot = name.lastIndexOf('.')
    const stem = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name
    const ext = name.slice(stem.length)
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`
    seen.add(name.toLowerCase())
    return name === item.name ? item : { ...item, name }
  })
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}
