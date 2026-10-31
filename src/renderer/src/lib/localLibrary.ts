// On-device library backed by the iOS LocalLibrary Capacitor plugin.
// Files are opened in place using security-scoped bookmarks.

import type { LibraryTrack, LocalPlaylist } from '../types'
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface ScanProgress {
  /** Audio files discovered so far. */
  found: number
  /** Of those, how many needed their tags read (the rest were unchanged). */
  parsed: number
}

interface LocalLibraryPlugin {
  writeTags(opts: { uri: string; changes: LocalTagChanges }): Promise<{ track: LibraryTrack }>
  pickFolder(): Promise<{ uri?: string; name?: string; canceled?: boolean }>
  pickFiles(): Promise<{ uris?: string[]; canceled?: boolean }>
  releaseSource(opts: { uri: string }): Promise<void>
  sourceLabel(opts: { uri: string }): Promise<{ value: string }>
  scan(opts: { sources: string[]; known: { id: string; fileSize: number; lastModified: number }[] }): Promise<{ tracks: ScannedRow[] }>
  getArt(opts: { uri: string }): Promise<{ art: string | null }>
  saveLibrary(opts: { json: string }): Promise<void>
  loadLibrary(): Promise<{ json: string | null }>
  savePlaylists(opts: { json: string }): Promise<void>
  loadPlaylists(): Promise<{ json: string | null }>
  addListener(event: 'scanProgress', fn: (p: ScanProgress) => void): Promise<{ remove: () => void }>
}

export type LocalTagChanges = Partial<Record<'title' | 'artist' | 'album' | 'albumArtist' | 'composer' | 'genre' | 'year' | 'trackNumber' | 'discNumber', string>>

export async function writeLocalTags(uri: string, changes: LocalTagChanges): Promise<LibraryTrack> {
  const p = plugin()
  if (!p) throw new Error('Local tag editing requires the iOS app.')
  return (await p.writeTags({ uri, changes })).track
}

const nativeLibrary = registerPlugin<LocalLibraryPlugin>('LocalLibrary')

function plugin(): LocalLibraryPlugin | null {
  return localLibraryAvailable() ? nativeLibrary : null
}

export function localLibraryAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalLibrary')
}

/** Capacitor serves granted file URLs to the WebView through its local server. */
export function toStreamUrl(uri: string): string {
  return Capacitor.convertFileSrc(uri)
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** Opens the system folder picker. Resolves null if the user backed out. */
export async function pickFolder(): Promise<string | null> {
  const p = plugin()
  if (!p) return null
  const res = await p.pickFolder()
  return res.canceled || !res.uri ? null : res.uri
}

/** Opens the system file picker (multi-select). Resolves [] if cancelled. */
export async function pickFiles(): Promise<string[]> {
  const p = plugin()
  if (!p) return []
  const res = await p.pickFiles()
  return res.canceled || !res.uris ? [] : res.uris
}

export async function releaseSource(uri: string): Promise<void> {
  await plugin()?.releaseSource({ uri }).catch(() => undefined)
}

/**
 * Display name for a source. Falls back to decoding the URI ourselves so the
 * folder list still reads sensibly on the web build (where there's no plugin)
 * and if the native call ever fails.
 */
export async function sourceLabel(uri: string): Promise<string> {
  const p = plugin()
  if (p) {
    try { return (await p.sourceLabel({ uri })).value || decodeSourceLabel(uri) } catch { /* fall through */ }
  }
  return decodeSourceLabel(uri)
}

/** Pure fallback for sourceLabel — "…/tree/primary%3AMusic%2FRare" → "Rare". */
export function decodeSourceLabel(uri: string): string {
  try {
    const tail = decodeURIComponent(uri.split('/').pop() ?? '')
    const afterColon = tail.includes(':') ? tail.slice(tail.lastIndexOf(':') + 1) : tail
    if (!afterColon) return 'Internal storage'
    return afterColon.includes('/') ? afterColon.slice(afterColon.lastIndexOf('/') + 1) : afterColon
  } catch {
    return uri
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/** A track, or a stand-in for one the native side didn't need to re-read. */
type ScannedRow = LibraryTrack | { id: string; unchanged: true }

/**
 * Rescans every source and returns the complete track list.
 *
 * Only id/size/mtime go down to the native side, and a file matching on all
 * three comes back as an `unchanged` stub rather than a full track — so an
 * untouched library costs a directory walk and nothing else, in either
 * tag-reading or bridge traffic. The stubs are resolved here against the
 * metadata we already hold, which is why `known` must be the *full* previous
 * track list and not a trimmed copy.
 */
export async function scanSources(
  sources: string[],
  known: LibraryTrack[],
): Promise<LibraryTrack[]> {
  const p = plugin()
  if (!p || sources.length === 0) return []
  const res = await p.scan({
    sources,
    known: known.map((t) => ({ id: t.id, fileSize: t.fileSize, lastModified: t.lastModified })),
  })
  const byId = new Map(known.map((t) => [t.id, t]))
  const out: LibraryTrack[] = []
  for (const row of res.tracks ?? []) {
    if ('unchanged' in row) {
      const prev = byId.get(row.id)
      // A stub with nothing to resolve to shouldn't happen (native only emits
      // one for an id it was given), but dropping it beats a blank row.
      if (prev) out.push(prev)
    } else {
      out.push(row)
    }
  }
  return out
}

/**
 * Subscribes to scan progress. Resolves an unsubscribe function once the
 * listener is actually attached on the native side — the caller MUST await
 * this before starting a scan. `scan()` spawns its walker thread the instant
 * the plugin method runs, and on a small/fast library that thread can finish
 * (emitting every progress event, including the final one) before the
 * addListener bridge round-trip here would otherwise have completed, so a
 * fire-and-forget registration silently misses the whole scan's progress.
 */
export async function onScanProgress(fn: (p: ScanProgress) => void): Promise<() => void> {
  const p = plugin()
  if (!p) return () => undefined
  try {
    const handle = await p.addListener('scanProgress', fn)
    return () => handle.remove()
  } catch {
    return () => undefined
  }
}

/** Embedded cover art for one track, or null when it has none. */
export async function readArt(uri: string): Promise<string | null> {
  const p = plugin()
  if (!p) return null
  try {
    return (await p.getArt({ uri })).art
  } catch {
    return null
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────
// Both blobs live in the app's private files dir rather than localStorage —
// a few thousand tracks would crowd out (or blow) the WebView's quota, taking
// the rest of the app's settings with it.

export interface StoredLibrary {
  tracks: LibraryTrack[]
  sources: string[]
  lastScanned: number | null
}

export async function saveLibrary(data: StoredLibrary): Promise<void> {
  await plugin()?.saveLibrary({ json: JSON.stringify(data) }).catch(() => undefined)
}

export async function loadLibrary(): Promise<StoredLibrary | null> {
  const p = plugin()
  if (!p) return null
  try {
    const { json } = await p.loadLibrary()
    if (!json) return null
    const parsed = JSON.parse(json) as StoredLibrary
    return Array.isArray(parsed?.tracks) ? parsed : null
  } catch {
    // A corrupt blob is treated as "no library" rather than a hard failure —
    // the next scan rewrites it.
    return null
  }
}

export async function savePlaylists(playlists: LocalPlaylist[]): Promise<void> {
  await plugin()?.savePlaylists({ json: JSON.stringify(playlists) }).catch(() => undefined)
}

export async function loadPlaylists(): Promise<LocalPlaylist[] | null> {
  const p = plugin()
  if (!p) return null
  try {
    const { json } = await p.loadPlaylists()
    if (!json) return null
    const parsed = JSON.parse(json) as LocalPlaylist[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
