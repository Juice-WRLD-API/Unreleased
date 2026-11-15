// Offline playlist downloads for the installed iPhone/iPad app.
//
// A downloaded playlist keeps every track it can (catalogue songs, comp files,
// the owner's donor uploads) as a file in IndexedDB (offlineStore), plays them
// from there with no network (offlinePlayback), and opens with no network from
// the copy of its detail saved alongside.
//
// iOS gives web apps no background downloads: the page is suspended as soon
// as it's hidden. So tracks are fetched one at a time and each is saved the
// moment it arrives, and a download that's cut off (app hidden, signal lost)
// stops where it is and carries on from the next missing track when the app
// is back on screen and online.
//
// Only offered in the installed app: Safari wipes a tab's storage after a
// week without a visit, which would quietly empty the downloads.

import type { Track } from '../types'
import * as userApi from './userApi'
import type { PlaylistDetail } from './userApi'
import { playlistItemsToTracks, isServerFileTrack } from './playlistItems'
import { donorFileIdFromTrackId } from './donorPlayback'
import { fetchDonorFileBlob } from './donorFilesApi'
import { resolveTrackFile } from './sessionEditsApi'
import { isSessionEditPlaceholder } from './sessionEditLinksMirror'
import { playlistCoverUrl, sizedCoverUrl, smallCoverUrl } from './juicewrldApi'
import { IS_IOS, isStandalonePWA, runWhenIdle } from './platform'
import * as db from './offlineStore'
import { clearOfflinePlaybackCache, forgetOfflineUrl } from './offlinePlayback'
import { runLog } from './runLog'
import { COMMIT_HASH } from './appVersion'
import {
  addOfflineTrackIds, dropOfflinePlaylist, patchOfflinePlaylist, removeOfflineTrackIds, useOfflineStore,
} from '../store/useOfflineStore'

// Testing on a desktop browser: localStorage['unreleased:offlineDownloads'] = '1'.
const FORCE_KEY = 'unreleased:offlineDownloads'

/** Whether this device offers offline downloads at all. */
export function offlineSupported(): boolean {
  if (typeof indexedDB === 'undefined' || typeof window === 'undefined') return false
  try { if (localStorage.getItem(FORCE_KEY) === '1') return true } catch { /* storage blocked */ }
  return IS_IOS && isStandalonePWA()
}

/** iOS Safari in a tab: could download once installed. */
export function offlineNeedsInstall(): boolean {
  return IS_IOS && !offlineSupported()
}

// ── Which tracks a playlist can keep ────────────────────────────────────────

function isDownloadable(t: Track): boolean {
  return !!donorFileIdFromTrackId(t.id) || isServerFileTrack(t)
}

function downloadableTracks(detail: PlaylistDetail): { tracks: Track[]; skipped: number } {
  const all = playlistItemsToTracks(detail.items)
  const seen = new Set<string>()
  const tracks: Track[] = []
  let skipped = 0
  for (const t of all) {
    if (!isDownloadable(t)) { skipped++; continue }
    if (seen.has(t.id)) continue
    seen.add(t.id)
    tracks.push(t)
  }
  return { tracks, skipped }
}

function coverUrlsFor(detail: PlaylistDetail, tracks: Track[]): string[] {
  const urls = new Set<string>()
  const own = playlistCoverUrl(detail)
  if (own) urls.add(own)
  for (const t of tracks) {
    const small = smallCoverUrl(t.imageUrl)
    const card = sizedCoverUrl(t.imageUrl, 600)
    if (small) urls.add(small)
    if (card) urls.add(card)
  }
  return [...urls]
}

// Safari only plays a blob URL whose blob names a type it knows - there's no
// file extension to sniff. Servers often send these as octet-stream.
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', aiff: 'audio/aiff', aif: 'audio/aiff',
}

function withAudioType(blob: Blob, name: string): Blob {
  const type = blob.type.split(';')[0].trim()
  if (type.startsWith('audio/')) return blob
  const ext = name.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
  return new Blob([blob], { type: AUDIO_TYPES[ext] ?? 'audio/mpeg' })
}

async function fetchTrackFile(t: Track, signal: AbortSignal): Promise<{ blob: Blob; path: string }> {
  const fileId = donorFileIdFromTrackId(t.id)
  if (fileId) {
    const blob = await fetchDonorFileBlob(fileId)
    return { blob: withAudioType(blob, t.title), path: t.path }
  }
  const file = await resolveTrackFile(t)
  const res = await fetch(file.url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { blob: withAudioType(await res.blob(), file.path), path: file.path }
}

function isQuotaError(err: unknown): boolean {
  const name = (err as DOMException | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

// A download that dies because the app went to the background or lost signal
// isn't a failure of that track - it waits and resumes.
function interrupted(): boolean {
  return document.visibilityState !== 'visible' || navigator.onLine === false
}

// ── Service worker ──────────────────────────────────────────────────────────

function tellServiceWorker(message: Record<string, unknown>): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {})
}

// Has the service worker keep every file of this build, so the app opens
// fully with no network (see precacheAssets in sw.js).
function precacheApp(): void {
  if (navigator.onLine === false) return
  tellServiceWorker({ type: 'precache', commit: COMMIT_HASH })
}

// The service worker only routes images through its saved-cover fallback
// while covers exist; this has it check again.
function coversChanged(): void {
  tellServiceWorker({ type: 'covers-changed' })
}

// ── The queue ───────────────────────────────────────────────────────────────

const queue: number[] = []
let running: { id: number; ctrl: AbortController } | null = null
let persistAsked = false

function enqueue(id: number, front = false): void {
  if (running?.id === id || queue.includes(id)) return
  if (front) queue.unshift(id)
  else queue.push(id)
  patchOfflinePlaylist(id, { status: 'queued', error: undefined })
  void runQueue()
}

async function runQueue(): Promise<void> {
  if (running) return
  while (queue.length) {
    if (interrupted()) return // resumed by the visibility/online listeners
    const id = queue.shift()!
    const ctrl = new AbortController()
    running = { id, ctrl }
    try {
      const outcome = await downloadJob(id, ctrl.signal)
      if (outcome === 'interrupted') { queue.unshift(id); running = null; return }
    } catch (err) {
      runLog('offline', `playlist ${id} download failed: ${String(err)}`)
      if (useOfflineStore.getState().playlists[id]) patchOfflinePlaylist(id, { status: 'error', error: 'Download failed' })
    } finally {
      if (running?.id === id) running = null
    }
  }
  void refreshOfflineUsage()
}

async function downloadJob(id: number, signal: AbortSignal): Promise<'done' | 'interrupted' | 'removed'> {
  const prev = await db.getPlaylistRecord(id)
  if (!prev) return 'removed'
  let detail: PlaylistDetail
  try {
    detail = await userApi.getPlaylist(id)
  } catch (err) {
    if (interrupted()) return 'interrupted'
    // Deleted on the server: onPlaylistGone removes the download.
    if (!(await db.getPlaylistRecord(id))) return 'removed'
    // Never fetched (the very first try failed): nothing to resume from.
    if (prev.detail == null) throw err
    detail = prev.detail as PlaylistDetail
    runLog('offline', `playlist ${id}: couldn't refresh (${String(err)}), resuming the saved copy`)
  }
  if (signal.aborted) return 'removed'

  const { tracks, skipped } = downloadableTracks(detail)
  const wanted = new Set(tracks.map((t) => t.id))
  // Tracks taken out of the playlist since it was downloaded.
  const gone = prev.trackIds.filter((t) => !wanted.has(t))
  if (gone.length) {
    const deleted = await db.releaseTracks(gone, id)
    deleted.forEach(forgetOfflineUrl)
    removeOfflineTrackIds(deleted)
  }
  const coverUrls = coverUrlsFor(detail, tracks)
  await db.putPlaylistRecord({ ...prev, name: detail.name, detail, trackIds: [...wanted], skipped, coverUrls, savedAt: Date.now() })

  const saved = new Map((await db.getTrackRecords()).map((r) => [r.id, r]))
  let done = 0
  let failed = 0
  patchOfflinePlaylist(id, { name: detail.name, status: 'downloading', total: tracks.length, done: 0, skipped, failed: 0, error: undefined })

  for (const t of tracks) {
    if (signal.aborted) return 'removed'
    const have = saved.get(t.id)
    // Already saved from this file (by this playlist or another).
    // (A donor file never changes under its id, and a session's file is only
    // known once looked up, so neither has a path worth comparing.)
    if (have && (have.path === t.path || !!donorFileIdFromTrackId(t.id) || isSessionEditPlaceholder(t.path))) {
      if (!have.playlists.includes(id)) await db.addTrackRef(t.id, id)
      done++
      patchOfflinePlaylist(id, { done })
      continue
    }
    if (interrupted()) { patchOfflinePlaylist(id, { status: 'queued' }); return 'interrupted' }
    try {
      const { blob, path } = await fetchTrackFile(t, signal)
      if (signal.aborted) return 'removed'
      await db.putTrack({ id: t.id, size: blob.size, path: t.path || path, title: t.title, savedAt: Date.now() }, blob, id)
      if (!persistAsked) {
        persistAsked = true
        // Asks the browser not to evict these under storage pressure.
        void navigator.storage?.persist?.().catch(() => false)
      }
      forgetOfflineUrl(t.id) // a re-download replaces any blob URL read from the old file
      addOfflineTrackIds([t.id])
      done++
      patchOfflinePlaylist(id, { done })
    } catch (err) {
      if (signal.aborted) return 'removed'
      if (isQuotaError(err)) {
        patchOfflinePlaylist(id, { status: 'error', error: 'Not enough storage on this device', failed: tracks.length - done })
        return 'done'
      }
      if (interrupted()) { patchOfflinePlaylist(id, { status: 'queued' }); return 'interrupted' }
      failed++
      patchOfflinePlaylist(id, { failed })
      runLog('offline', `couldn't download "${t.title}" (${t.id}): ${String(err)}`)
    }
  }

  // Covers last, best effort: the music matters more than the art.
  for (const url of coverUrls) {
    if (signal.aborted || interrupted()) break
    await db.saveCover(url).catch(() => {})
  }
  coversChanged()
  precacheApp()
  patchOfflinePlaylist(id, { status: failed ? 'partial' : 'done', failed })
  return 'done'
}

// ── Public actions ──────────────────────────────────────────────────────────

/** Starts (or resumes) downloading a playlist. */
export async function downloadPlaylist(id: number, name: string): Promise<void> {
  if (!offlineSupported()) return
  const existing = await db.getPlaylistRecord(id)
  if (!existing) {
    await db.putPlaylistRecord({ id, name, detail: null, trackIds: [], skipped: 0, coverUrls: [], savedAt: Date.now() })
  }
  patchOfflinePlaylist(id, { name })
  enqueue(id, true)
}

/** Removes a playlist's download, and every file no other download holds. */
export async function removeOfflinePlaylist(id: number): Promise<void> {
  const qi = queue.indexOf(id)
  if (qi >= 0) queue.splice(qi, 1)
  if (running?.id === id) running.ctrl.abort()
  const rec = await db.getPlaylistRecord(id)
  dropOfflinePlaylist(id)
  if (!rec) return
  await db.deletePlaylistRecord(id)
  const deleted = await db.releaseTracks(rec.trackIds, id)
  deleted.forEach(forgetOfflineUrl)
  removeOfflineTrackIds(deleted)
  const stillUsed = new Set((await db.getPlaylistRecords()).flatMap((r) => r.coverUrls))
  await db.deleteCovers(rec.coverUrls.filter((u) => !stillUsed.has(u))).catch(() => {})
  coversChanged()
  void refreshOfflineUsage()
}

/** Removes every download (Settings' "Remove all", and signing out). */
export async function removeAllOffline(): Promise<void> {
  queue.length = 0
  running?.ctrl.abort()
  clearOfflinePlaybackCache()
  useOfflineStore.setState({ playlists: {}, trackIds: new Set() })
  try { await db.clearOfflineStore() } catch (err) { runLog('offline', `couldn't clear downloads: ${String(err)}`) }
  coversChanged()
  void refreshOfflineUsage()
}

export async function refreshOfflineUsage(): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (est) useOfflineStore.setState({ usage: { used: est.usage ?? 0, quota: est.quota ?? 0 } })
  } catch { /* not available */ }
}

/** Bytes the downloaded files take, from the saved records. */
export async function offlineBytes(): Promise<number> {
  return (await db.getTrackRecords()).reduce((n, r) => n + r.size, 0)
}

/** Re-checks every downloaded playlist against the server: new tracks are
 *  downloaded, removed ones deleted, unfinished downloads carried on. */
export function syncOfflinePlaylists(): void {
  for (const id of Object.keys(useOfflineStore.getState().playlists)) enqueue(Number(id))
}

let started = false

/** Reads the saved downloads back into the UI state and, after startup has
 *  settled, brings them up to date. Safe to call more than once. */
export function startOfflineDownloads(): void {
  if (started || !offlineSupported()) return
  started = true
  void (async () => {
    try {
      const [playlists, tracks] = await Promise.all([db.getPlaylistRecords(), db.getTrackRecords()])
      // Files no download holds any more (a removal that raced a download
      // in progress): delete them.
      const ids = new Set(playlists.map((p) => p.id))
      const orphans = tracks.filter((t) => !t.playlists.some((p) => ids.has(p))).map((t) => t.id)
      if (orphans.length) await db.deleteTracks(orphans)
      const have = new Set(tracks.map((t) => t.id).filter((t) => !orphans.includes(t)))
      const states: Record<number, ReturnType<typeof useOfflineStore.getState>['playlists'][number]> = {}
      for (const p of playlists) {
        const done = p.trackIds.filter((t) => have.has(t)).length
        states[p.id] = {
          id: p.id, name: p.name, total: p.trackIds.length, done, skipped: p.skipped, failed: 0,
          status: p.detail != null && done === p.trackIds.length ? 'done' : 'partial',
        }
      }
      useOfflineStore.setState({ loaded: true, playlists: states, trackIds: have })
    } catch (err) {
      runLog('offline', `couldn't read saved downloads: ${String(err)}`)
      useOfflineStore.setState({ loaded: true })
      return
    }
    void refreshOfflineUsage()
    if (Object.keys(useOfflineStore.getState().playlists).length === 0) return
    // Not on the startup path: the visible view's own requests go first.
    runWhenIdle(() => {
      if (interrupted()) return
      precacheApp()
      syncOfflinePlaylists()
    }, 8000)
  })()

  const resume = (): void => { if (!interrupted() && queue.length) void runQueue() }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  userApi.onPlaylistGone((id) => { void removeOfflinePlaylist(id) })
}
