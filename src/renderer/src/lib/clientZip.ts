// Builds ZIP archives in the browser now that backend ZIP jobs are disabled
// (see ZIP_OPERATIONS_ENABLED in juicewrldApi.ts). Every file is fetched from
// its stream URL (the API sends Access-Control-Allow-Origin) and fed into
// client-zip, which stores entries uncompressed - audio is already
// compressed, so deflating it again would burn CPU for nothing.
//
// Where the File System Access API exists (Chromium desktop, Electron) the
// archive streams straight to disk, so memory stays flat however big it
// gets. Elsewhere it's assembled in memory as a Blob, capped at
// MEMORY_ZIP_LIMIT; past that the caller gets ZipTooLargeError and should
// fall back to downloading files one at a time.
//
// Two-step API because showSaveFilePicker needs transient user activation:
// call openZipTarget() first thing in the click handler, before any await
// (listing a folder, fetching a playlist), then writeZip() once the file
// list is known.
import { downloadZip } from 'client-zip'
import cdnService from './cdn'
import { triggerDownload } from './apiFilesShared'
import { errorMessage } from './format'
import { useStore } from '../store/useStore'
import { isMobileViewport } from '../hooks/useIsMobile'

export interface ZipItem {
  /** Path inside the archive - may contain '/' for subfolders. */
  name: string
  url: string
  /** Library path to try the distributed CDN with first (primary channel only). */
  cdnPath?: string
  size?: number | null
}

export interface ZipProgress { done: number; total: number }
export interface ZipResult { saved: number; failed: number; cancelled?: boolean }

export type ZipTarget =
  | { kind: 'disk'; handle: FileSystemFileHandle; filename: string }
  | { kind: 'memory'; filename: string }

export class ZipTooLargeError extends Error {
  constructor() { super('ZIP too large to build in memory') }
}

// In-memory fallback ceiling - well under what a desktop tab can hold, and
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
  if (!picker) return { kind: 'memory', filename }
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    })
    return { kind: 'disk', handle, filename: handle.name }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    // SecurityError (activation lapsed) or anything else - memory still works.
    return { kind: 'memory', filename }
  }
}

/** Fetches every item into one ZIP and saves it to `target`. Items that fail
 *  to fetch are left out and counted in `failed`. Throws ZipTooLargeError
 *  (before writing anything, when sizes are known up front) if a memory
 *  target would exceed the cap, and AbortError if `signal` fires. */
export async function writeZip(
  target: ZipTarget,
  items: ZipItem[],
  opts: { signal?: AbortSignal; onProgress?: (p: ZipProgress) => void; onBytes?: (bytes: number) => void } = {}
): Promise<ZipResult> {
  const { signal, onProgress, onBytes } = opts
  if (target.kind === 'memory') {
    const known = items.reduce((sum, i) => sum + (i.size ?? 0), 0)
    if (known > MEMORY_ZIP_LIMIT) throw new ZipTooLargeError()
  }

  const result: ZipResult = { saved: 0, failed: 0 }
  const total = items.length
  onProgress?.({ done: 0, total })
  const entries = zipEntries(dedupeNames(items), result, (done) => onProgress?.({ done, total }), signal)
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

  if (target.kind === 'disk') {
    // On failure or abort pipeTo aborts the writable, which discards the
    // partial file.
    await body.pipeTo(await target.handle.createWritable(), { signal })
    return result
  }

  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new DOMException('Cancelled', 'AbortError')
    }
    const { done, value } = await reader.read()
    if (done) break
    if (bytes > MEMORY_ZIP_LIMIT) {
      await reader.cancel()
      throw new ZipTooLargeError()
    }
    chunks.push(value)
  }
  const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/zip' }))
  triggerDownload(url, target.filename)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return result
}

const zipAborts = new Map<string, AbortController>()

export function isZipTaskId(id: string): boolean {
  return id.startsWith('zip-')
}

export function cancelZipTask(id: string): void {
  zipAborts.get(id)?.abort()
}

/** The usual entry point for a bulk "Download": writeZip, tracked as a task
 *  in the Downloads panel (progress, size, speed, cancel), falling back to
 *  individual downloads when an in-memory ZIP would be too large. A
 *  cancelled ZIP resolves with `cancelled: true` rather than throwing. */
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
      detail: `${done} / ${fileCount} file${fileCount === 1 ? '' : 's'}`,
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
    })
    updateDownload(id, {
      state: result.saved > 0 ? 'done' : 'error',
      percent: 100,
      speedBps: undefined,
      detail: `${result.saved} file${result.saved === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} failed` : ''}`,
      error: result.saved > 0 ? undefined : 'No files could be downloaded',
    })
    return result
  } catch (err) {
    if (err instanceof ZipTooLargeError) {
      updateDownload(id, { state: 'downloading', percent: 0, speedBps: undefined, detail: 'Too big to zip here - downloading files separately' })
      await downloadItemsIndividually(items)
      updateDownload(id, { state: 'done', percent: 100, detail: `${fileCount} separate download${fileCount === 1 ? '' : 's'}` })
      return { saved: fileCount, failed: 0 }
    }
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

/** The per-file fallback - what every bulk download did before client-side
 *  ZIPs. Spaced out so Chrome doesn't block it as a download flood. */
export async function downloadItemsIndividually(items: ZipItem[]): Promise<void> {
  for (const item of items) {
    triggerDownload(item.url, item.name.split('/').pop() || item.name)
    await new Promise((r) => setTimeout(r, 350))
  }
}

async function* zipEntries(
  items: ZipItem[],
  result: ZipResult,
  onDone: (done: number) => void,
  signal?: AbortSignal
): AsyncGenerator<{ name: string; input: Response | Blob; lastModified?: Date }> {
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
      yield { name: items[i].name, input }
    } else {
      result.failed++
    }
    onDone(i + 1)
  }
}

async function fetchItem(item: ZipItem, signal?: AbortSignal): Promise<Response | Blob | null> {
  if (item.cdnPath) {
    const cdn = await cdnService.tryDownload(item.cdnPath).catch(() => null)
    if (cdn) return cdn.blob
  }
  try {
    const res = await fetch(item.url, { credentials: 'omit', signal })
    return res.ok ? res : null
  } catch {
    return null
  }
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
