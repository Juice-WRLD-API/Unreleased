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

export interface ZipItem {
  /** Path inside the archive - may contain '/' for subfolders. */
  name: string
  url: string
  /** Library path to try the distributed CDN with first (primary channel only). */
  cdnPath?: string
  size?: number | null
}

export interface ZipProgress { done: number; total: number }
export interface ZipResult { saved: number; failed: number }

export type ZipTarget =
  | { kind: 'disk'; handle: FileSystemFileHandle }
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
    return { kind: 'disk', handle }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    // SecurityError (activation lapsed) or anything else - memory still works.
    return { kind: 'memory', filename }
  }
}

/** Fetches every item into one ZIP and saves it to `target`. Items that fail
 *  to fetch are left out and counted in `failed`. Throws ZipTooLargeError
 *  (before writing anything, when sizes are known up front) if a memory
 *  target would exceed the cap. */
export async function writeZip(
  target: ZipTarget,
  items: ZipItem[],
  onProgress?: (p: ZipProgress) => void
): Promise<ZipResult> {
  if (target.kind === 'memory') {
    const known = items.reduce((sum, i) => sum + (i.size ?? 0), 0)
    if (known > MEMORY_ZIP_LIMIT) throw new ZipTooLargeError()
  }

  const result: ZipResult = { saved: 0, failed: 0 }
  const total = items.length
  onProgress?.({ done: 0, total })
  const entries = zipEntries(dedupeNames(items), result, (done) => onProgress?.({ done, total }))
  const body = downloadZip(entries).body
  if (!body) throw new Error('ZIP stream unavailable')

  if (target.kind === 'disk') {
    // On failure pipeTo aborts the writable, which discards the partial file.
    await body.pipeTo(await target.handle.createWritable())
    return result
  }

  const chunks: Uint8Array[] = []
  let bytes = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
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

/** writeZip, falling back to individual downloads when an in-memory ZIP
 *  would be too large. The usual entry point for a bulk "Download". */
export async function saveItems(
  target: ZipTarget,
  items: ZipItem[],
  onProgress?: (p: ZipProgress) => void
): Promise<ZipResult> {
  try {
    return await writeZip(target, items, onProgress)
  } catch (err) {
    if (!(err instanceof ZipTooLargeError)) throw err
    await downloadItemsIndividually(items)
    return { saved: items.length, failed: 0 }
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
  onDone: (done: number) => void
): AsyncGenerator<{ name: string; input: Response | Blob; lastModified?: Date }> {
  const pending = items.map(() => null as Promise<Response | Blob | null> | null)
  const start = (i: number): void => {
    if (i < items.length && !pending[i]) pending[i] = fetchItem(items[i])
  }
  for (let i = 0; i < Math.min(PREFETCH, items.length); i++) start(i)

  for (let i = 0; i < items.length; i++) {
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

async function fetchItem(item: ZipItem): Promise<Response | Blob | null> {
  if (item.cdnPath) {
    const cdn = await cdnService.tryDownload(item.cdnPath).catch(() => null)
    if (cdn) return cdn.blob
  }
  try {
    const res = await fetch(item.url, { credentials: 'omit' })
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
