import { useStore, IS_FLOAT_WINDOW } from '../store/useStore'
import {
  useCatalogSync, saveCatalogSyncSettings, DEFAULT_BYTES_PER_SECOND,
  type CatalogSyncCategory, type CatalogSyncCategoryStat, type CatalogSyncPhase,
} from '../store/catalogSyncStore'
import { fetchCatalogWithLyrics, fetchSongUncached, loadAllSongs, songToTrack, type JWApiSong } from './juicewrldApi'
import { resolveSongFile } from './sessionEditsApi'
import { loadRecentTracks } from './recentTracks'
import { errorMessage } from './format'
import { ls } from './persist'
import { IS_ELECTRON, runWhenIdle } from './platform'
import type { OfflineTrackMeta } from '../types'

// Sync (Home → Tools, desktop only): while it's on, every released and
// unreleased song with audio is kept on this computer. It rides on the
// offline library the playlist downloads use - same files, same lookup in the
// Player - as one more entry, SYNC_KEY, whose song list is the whole chosen
// catalogue. A pass saves that list before downloading anything, so the
// prune every playlist sync runs (offline-set-playlist) can't delete a synced
// song, and the save itself drops what has left the catalogue or belongs to
// a category the user turned off (unless an offline playlist still has it).
//
// A pass reads the bulk catalogue, saves the list, then downloads what's
// missing or whose audio changed, a few at a time: liked songs first, then
// recently played, then the rest in catalogue order. Passes run at startup,
// every half hour, when the connection comes back, and on demand. Only the
// main window runs them; pop-outs share the files but not this state.

const SYNC_KEY = 'catalog-sync'
const SYNC_NAME = 'Sync'
/** The categories and song count the saved list last had (see pass). */
const REGISTERED_KEY = 'catalogSync:registered'
const PARALLEL = 3
const RECHECK_MS = 30 * 60_000
const RETRY_MS = 2 * 60_000
const START_DELAY_MS = 8000
/** How often in-flight progress reaches the store. */
const PROGRESS_MS = 300
/** How long finished songs wait to be written into the main store together. */
const LIBRARY_MS = 2500
/** Stop before the drive is completely full. */
const MIN_FREE_BYTES = 512 * 1024 * 1024
const DISK_CHECK_EVERY = 20
const FAILURE_STREAK = 8
/** From this many songs to get, a pass reads the whole catalogue with lyrics
 *  once (~13 MB) instead of looking each song up. */
const BULK_LOOKUP_MIN = 25
const RECENT_MAX = 8
const AUDIO_PATH = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const electron = (): any => (window as any).electron
const st = (): ReturnType<typeof useCatalogSync.getState> => useCatalogSync.getState()

interface Plan {
  /** The chosen songs by track id ("jw-123"). */
  songs: Map<string, JWApiSong>
  seconds: Map<string, number>
  /** Size on disk of every offline track, synced or not. */
  sizes: Record<string, number>
  /** Chosen songs whose audio is on disk and current. */
  onDisk: Map<string, number>
  /** Chosen songs to download, or to refresh because their name changed. */
  needed: JWApiSong[]
  stats: Partial<Record<CatalogSyncCategory, CatalogSyncCategoryStat>>
}

let plan: Plan | null = null
let queue: JWApiSong[] = []
// Bumped by everything that stops a pass (pause, off, losing the connection,
// a category change); a worker from an older pass stops at its next song.
let epoch = 0
let currentPass: Promise<void> | null = null
let passQueued = false
// Aborts the running pass's requests when it stops.
let passController: AbortController | null = null
// The full rows (lyrics included) of the songs this pass still has to get,
// when it read them in bulk; each is dropped once used.
let fullRows: Map<number, JWApiSong> | null = null
let recheckTimer: number | undefined
let downloadsSinceDiskCheck = 0
let consecutiveFailures = 0

// In-flight progress per track id, written by every chunk event and handed to
// the store on a timer - a few parallel downloads otherwise re-render the
// dialog hundreds of times a second.
const progress = new Map<string, { received: number; total: number }>()
let pendingBytes = 0
let lastProgressAt = 0
let progressTimer: number | undefined

// Finished songs not yet in the main store's offlineTracks. Written together:
// views like the Tracker re-render on every offlineTracks change.
let pendingTracks: Record<string, OfflineTrackMeta> = {}
let libraryTimer: number | undefined

// The display snapshot a song is saved with: the same one the store's
// offlineMetaFor builds for playlist downloads (the name and cover the user
// sees, lyrics for playing with no network).
function offlineMeta(song: JWApiSong): Omit<OfflineTrackMeta, 'path' | 'localPath' | 'ext' | 'downloadedAt'> {
  const track = songToTrack(song)
  return {
    title: track.title,
    artist: song.credited_artists || 'Juice WRLD',
    album: song.album || song.era?.name || '',
    imageUrl: track.imageUrl ?? null,
    lyrics: song.lyrics || null,
    syncedLyrics: song.synced_lyrics || null,
    duration: track.duration,
  }
}

const isSyncCategory = (category: string): category is CatalogSyncCategory =>
  category === 'released' || category === 'unreleased'

async function buildPlan(): Promise<Plan> {
  const songs = await loadAllSongs()
  if (!songs.length) throw new Error('The catalogue came back empty')
  const chosen = new Set(st().settings.categories)
  const plan: Plan = { songs: new Map(), seconds: new Map(), sizes: {}, onDisk: new Map(), needed: [], stats: {} }
  for (const song of songs) {
    if (!isSyncCategory(song.category) || !AUDIO_PATH.test(song.path || '')) continue
    const seconds = songToTrack(song).duration || 0
    const stat = plan.stats[song.category] ?? (plan.stats[song.category] = { songs: 0, seconds: 0 })
    stat.songs++
    stat.seconds += seconds
    if (!chosen.has(song.category)) continue
    const id = `jw-${song.id}`
    plan.songs.set(id, song)
    plan.seconds.set(id, seconds)
  }
  plan.sizes = (await electron()?.offlineGetTrackSizes?.()) ?? {}
  const tracks = useStore.getState().offlineTracks
  for (const [id, song] of plan.songs) {
    const entry = tracks[id]
    const size = plan.sizes[id]
    if (entry && size && entry.path === song.path) {
      plan.onDisk.set(id, size)
      // Renamed on the site: the audio stays, the saved name catches up.
      if (entry.title !== songToTrack(song).title) plan.needed.push(song)
    } else {
      plan.needed.push(song)
    }
  }
  return plan
}

function recount(): void {
  if (!plan) return
  let have = 0
  let bytes = 0
  let haveSeconds = 0
  let remainingSeconds = 0
  for (const id of plan.songs.keys()) {
    const size = plan.onDisk.get(id)
    const seconds = plan.seconds.get(id) ?? 0
    if (size) { have++; bytes += size; haveSeconds += seconds } else remainingSeconds += seconds
  }
  // Real sizes once there are enough of them; 320 kbps until then.
  const bytesPerSecond = have >= 10 && haveSeconds > 0 ? bytes / haveSeconds : DEFAULT_BYTES_PER_SECOND
  useCatalogSync.setState({ target: plan.songs.size, have, bytes, remainingSeconds, bytesPerSecond, categoryStats: plan.stats })
}

function setPhase(phase: CatalogSyncPhase, extra: Partial<ReturnType<typeof st>> = {}): void {
  useCatalogSync.setState({ phase, ...extra })
}

/** Liked songs first, then recently played (most recent first), then the catalogue's own order. */
function prioritize(songs: JWApiSong[]): JWApiSong[] {
  const liked = new Set(useStore.getState().likedTrackIds)
  const recent = new Map(loadRecentTracks().map((t, i) => [t.id, i]))
  const rank = (song: JWApiSong): number => {
    const id = `jw-${song.id}`
    if (liked.has(id)) return -1_000_000
    return recent.get(id) ?? Number.MAX_SAFE_INTEGER
  }
  return songs
    .map((song, index) => ({ song, index, rank: rank(song) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.song)
}

function flushLibrary(): void {
  clearTimeout(libraryTimer)
  libraryTimer = undefined
  const batch = pendingTracks
  if (!Object.keys(batch).length) return
  pendingTracks = {}
  useStore.setState((s) => ({ offlineTracks: { ...s.offlineTracks, ...batch } }))
}

function flushProgress(): void {
  const now = performance.now()
  const seconds = (now - lastProgressAt) / 1000
  lastProgressAt = now
  const sample = seconds > 0 ? pendingBytes / seconds : 0
  pendingBytes = 0
  const s = st()
  useCatalogSync.setState({
    speedBps: progress.size ? (s.speedBps ? s.speedBps * 0.8 + sample * 0.2 : sample) : 0,
    active: s.active.map((a) => {
      const p = progress.get(`jw-${a.songId}`)
      return p && (p.received !== a.received || p.total !== a.total) ? { ...a, received: p.received, total: p.total } : a
    }),
  })
  if (!progress.size) {
    clearInterval(progressTimer)
    progressTimer = undefined
  }
}

function onProgress(d: { id: string; received?: number; total?: number }): void {
  const p = progress.get(d.id)
  if (!p) return
  const received = d.received || 0
  pendingBytes += Math.max(0, received - p.received)
  p.received = received
  if (d.total) p.total = d.total
}

function stop(phase: CatalogSyncPhase): void {
  epoch++
  queue = []
  passController?.abort()
  const ids = [...progress.keys()]
  if (ids.length) void electron()?.offlineCancelDownloads?.(ids)
  flushLibrary()
  setPhase(phase, { speedBps: 0 })
}

function scheduleRecheck(ms: number): void {
  clearTimeout(recheckTimer)
  const { enabled, paused } = st().settings
  if (enabled && !paused) recheckTimer = window.setTimeout(() => { void runPass() }, ms)
}

async function downloadOne(song: JWApiSong, run: number, signal: AbortSignal): Promise<void> {
  const el = electron()
  const id = `jw-${song.id}`
  const track = songToTrack(song)
  progress.set(id, { received: 0, total: 0 })
  useCatalogSync.setState((s) => ({ active: [...s.active, { songId: song.id, title: track.title, imageUrl: track.imageUrl ?? null, received: 0, total: 0 }] }))
  if (!progressTimer) {
    lastProgressAt = performance.now()
    progressTimer = window.setInterval(flushProgress, PROGRESS_MS)
  }
  try {
    // The planning catalogue leaves lyrics out; the saved copy carries them.
    const bulk = fullRows?.get(song.id)
    fullRows?.delete(song.id)
    const full = bulk ?? await fetchSongUncached(song.id, signal)
    if (run !== epoch) return
    const file = await resolveSongFile(full)
    const ext = (file.path.split('.').pop() || 'mp3').toLowerCase()
    const meta = offlineMeta(full)
    const result = await el.offlineDownloadTrack({ id, url: file.url, ext, path: file.path, meta })
    if (result?.cancelled) return
    if (result?.error) throw new Error(result.error)
    pendingTracks[id] = {
      ...meta, path: file.path, localPath: result.localPath, localImagePath: result.localImagePath ?? null,
      coverSourceUrl: result.coverSourceUrl ?? null, ext, downloadedAt: Date.now(),
    }
    if (!libraryTimer) libraryTimer = window.setTimeout(flushLibrary, LIBRARY_MS)
    plan?.onDisk.set(id, result.size || 1)
    if (plan) plan.sizes[id] = result.size || 1
    if (!result.skipped) {
      useCatalogSync.setState((s) => ({ recent: [{ songId: song.id, title: meta.title, imageUrl: meta.imageUrl, at: Date.now() }, ...s.recent].slice(0, RECENT_MAX) }))
      if (++downloadsSinceDiskCheck >= DISK_CHECK_EVERY) {
        downloadsSinceDiskCheck = 0
        void refreshCatalogSyncDisk()
      }
    }
    consecutiveFailures = 0
    recount()
  } catch (e) {
    if (run !== epoch) return
    if (!navigator.onLine) { stop('waiting'); return }
    useCatalogSync.setState((s) => ({ failures: [...s.failures, { songId: song.id, title: track.title, error: errorMessage(e, 'Download failed') }] }))
    // Every song failing in a row is the server, not the songs: stop instead
    // of running the whole catalogue into the failed list.
    if (++consecutiveFailures >= FAILURE_STREAK) {
      stop('error')
      setPhase('error', { error: 'The server isn’t sending songs right now. Sync will try again in a few minutes.' })
    }
  } finally {
    progress.delete(id)
    useCatalogSync.setState((s) => ({ active: s.active.filter((a) => a.songId !== song.id) }))
  }
}

async function worker(run: number, signal: AbortSignal): Promise<void> {
  while (run === epoch) {
    const free = st().diskFree
    if (free != null && free < MIN_FREE_BYTES) { stop('nospace'); return }
    const song = queue.shift()
    if (!song) return
    await downloadOne(song, run, signal)
  }
}

async function pass(): Promise<void> {
  const el = electron()
  const run = ++epoch
  const stale = (): boolean => run !== epoch
  let next = RECHECK_MS
  clearTimeout(recheckTimer)
  consecutiveFailures = 0
  try {
    if (!navigator.onLine) { setPhase('waiting'); next = RETRY_MS; return }
    setPhase('checking', { error: null })
    await useStore.getState().loadOfflineLibrary()
    let fresh: Plan
    try {
      fresh = await buildPlan()
    } catch (e) {
      if (stale()) return
      next = RETRY_MS
      setPhase(navigator.onLine ? 'error' : 'waiting', { error: errorMessage(e, 'Couldn’t read the catalogue') })
      return
    }
    if (stale()) return
    const ids = [...fresh.songs.keys()]
    // Saving the list deletes whatever it leaves out, so a catalogue that
    // comes back far smaller than last time, with the same categories
    // chosen, is taken for a server hiccup rather than mass removals.
    const categories = [...st().settings.categories].sort().join(',')
    const last = ls.get<{ categories: string; count: number }>(REGISTERED_KEY)
    if (last && last.categories === categories && ids.length < last.count * 0.5) {
      next = RETRY_MS
      setPhase('error', { error: 'The catalogue looks incomplete right now. Nothing was removed; Sync will try again soon.' })
      return
    }
    await el.offlineSetPlaylist(SYNC_KEY, ids, SYNC_NAME)
    ls.set(REGISTERED_KEY, { categories, count: ids.length })
    useStore.setState((s) => ({ offlinePlaylists: { ...s.offlinePlaylists, [SYNC_KEY]: { songIds: ids, name: SYNC_NAME, updatedAt: Date.now() } } }))
    // The save pruned songs no list wants any more.
    await useStore.getState().loadOfflineLibrary()
    if (stale()) return
    plan = fresh
    recount()
    await refreshCatalogSyncDisk()
    queue = prioritize(fresh.needed)
    useCatalogSync.setState({ failures: [] })
    if (queue.length) {
      setPhase('syncing')
      const controller = new AbortController()
      passController = controller
      if (queue.length >= BULK_LOOKUP_MIN) {
        try {
          const wanted = new Set(queue.map((s) => s.id))
          const rows = await fetchCatalogWithLyrics(controller.signal)
          fullRows = new Map(rows.filter((r) => wanted.has(r.id)).map((r) => [r.id, r]))
        } catch {
          // Each song is looked up on its own instead.
        }
        if (stale()) return
      }
      await Promise.all(Array.from({ length: PARALLEL }, () => worker(run, controller.signal)))
    }
    if (stale()) return
    flushLibrary()
    recount()
    void refreshCatalogSyncDisk()
    setPhase('idle', { lastCheckedAt: Date.now(), speedBps: 0 })
  } catch (e) {
    if (stale()) return
    next = RETRY_MS
    setPhase('error', { error: errorMessage(e, 'Sync stopped') })
  } finally {
    fullRows = null
    passController = null
    const phase = st().phase
    scheduleRecheck(phase === 'waiting' || phase === 'error' ? RETRY_MS : next)
  }
}

function runPass(): Promise<void> {
  if (!electron()?.offlineDownloadTrack || IS_FLOAT_WINDOW) return Promise.resolve()
  const { enabled, paused } = st().settings
  if (!enabled || paused) return Promise.resolve()
  if (currentPass) { passQueued = true; return currentPass }
  currentPass = pass().finally(() => {
    currentPass = null
    if (passQueued) { passQueued = false; void runPass() }
  })
  return currentPass
}

// ─── What the dialog, the Home card and the terminal call ───────────────────

/** Starts Sync for this window: the first pass shortly after startup, and
 *  the listeners that follow the connection and download progress. Returns
 *  the cleanup. */
export function initCatalogSync(): () => void {
  const el = electron()
  if (!IS_ELECTRON || !el?.offlineDownloadTrack || IS_FLOAT_WINDOW) return () => {}
  const offProgress = el.onOfflineDownloadProgress?.(onProgress)
  const onOnline = (): void => { if (st().phase === 'waiting') void runPass() }
  const onOffline = (): void => { if (st().phase === 'syncing' || st().phase === 'checking') stop('waiting') }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  const { enabled, paused } = st().settings
  let cancelIdle = (): void => {}
  let startTimer: number | undefined
  if (enabled) {
    setPhase(paused ? 'paused' : 'checking')
    // After the startup rush, so the visible view's own requests go first.
    // Paused, it only counts what's here, for the Home card.
    startTimer = window.setTimeout(() => {
      cancelIdle = runWhenIdle(() => { void (st().settings.paused ? previewCatalogSync() : runPass()) })
    }, START_DELAY_MS)
  }
  void refreshCatalogSyncDisk()
  return () => {
    offProgress?.()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    clearTimeout(startTimer)
    cancelIdle()
  }
}

/** Reads the catalogue and the library to show what Sync would keep and how
 *  much of it is already here, without downloading. A running pass already
 *  keeps these numbers current. */
export async function previewCatalogSync(): Promise<void> {
  void refreshCatalogSyncDisk()
  if (currentPass) return
  try {
    const fresh = await buildPlan()
    if (currentPass) return
    plan = fresh
    recount()
  } catch {
    // The dialog shows what it already has.
  }
}

export async function setCatalogSyncEnabled(on: boolean, opts: { removeFiles?: boolean } = {}): Promise<void> {
  if (on) {
    saveCatalogSyncSettings({ enabled: true, paused: false })
    await runPass()
    return
  }
  saveCatalogSyncSettings({ enabled: false, paused: false })
  clearTimeout(recheckTimer)
  stop('off')
  if (opts.removeFiles) await removeCatalogSyncFiles()
}

export function pauseCatalogSync(): void {
  if (!st().settings.enabled) return
  saveCatalogSyncSettings({ paused: true })
  clearTimeout(recheckTimer)
  stop('paused')
}

export async function resumeCatalogSync(): Promise<void> {
  if (!st().settings.enabled) return
  saveCatalogSyncSettings({ paused: false })
  await runPass()
}

/** Checks for new and changed songs now (resuming a paused Sync). */
export async function syncCatalogNow(): Promise<void> {
  if (st().settings.paused) saveCatalogSyncSettings({ paused: false })
  await runPass()
}

export async function retryCatalogSyncFailures(): Promise<void> {
  useCatalogSync.setState({ failures: [] })
  await runPass()
}

/** Which categories Sync keeps. Songs of a category turned off are removed
 *  on the next pass, unless an offline playlist has them too. */
export async function setCatalogSyncCategories(categories: CatalogSyncCategory[]): Promise<void> {
  saveCatalogSyncSettings({ categories })
  const { enabled, paused } = st().settings
  if (enabled && !paused) {
    stop('checking')
    await runPass()
  } else {
    await previewCatalogSync()
  }
}

/** The songs only Sync keeps on this computer - what turning it off with
 *  "remove" deletes. Songs an offline playlist also has stay. */
export function catalogSyncFootprint(): { songs: number; bytes: number } {
  const lists = useStore.getState().offlinePlaylists
  const mine = lists[SYNC_KEY]?.songIds ?? []
  const elsewhere = new Set(Object.entries(lists).filter(([key]) => key !== SYNC_KEY).flatMap(([, p]) => p.songIds))
  let songs = 0
  let bytes = 0
  for (const id of mine) {
    const size = plan?.sizes[id]
    if (size && !elsewhere.has(id)) { songs++; bytes += size }
  }
  return { songs, bytes }
}

/** Deletes the songs only Sync was keeping. Sync itself should be off. */
export async function removeCatalogSyncFiles(): Promise<void> {
  const el = electron()
  if (!el?.offlineRemovePlaylist) return
  // Let a stopping pass finish writing before its songs go.
  await currentPass?.catch(() => {})
  await el.offlineRemovePlaylist(SYNC_KEY)
  ls.remove(REGISTERED_KEY)
  useStore.setState((s) => {
    const next = { ...s.offlinePlaylists }
    delete next[SYNC_KEY]
    return { offlinePlaylists: next }
  })
  await useStore.getState().loadOfflineLibrary()
  useCatalogSync.setState({ recent: [], failures: [] })
  await previewCatalogSync()
}

export async function refreshCatalogSyncDisk(): Promise<void> {
  const r = await electron()?.offlineGetDiskSpace?.().catch(() => null)
  if (r) useCatalogSync.setState({ folder: r.path ?? null, diskFree: typeof r.free === 'number' ? r.free : null })
}

/** Moves the offline songs folder (every offline song, not only Sync's).
 *  Sync stops while the files move and picks up after. */
export async function moveOfflineFolder(folder: string): Promise<{ error?: string; failedCount?: number }> {
  const el = electron()
  if (!el?.offlineSetLibraryPath) return { error: 'Not available here' }
  const wasRunning = st().phase === 'syncing' || st().phase === 'checking'
  if (wasRunning) stop('checking')
  await currentPass?.catch(() => {})
  const result = await el.offlineSetLibraryPath(folder)
  await useStore.getState().loadOfflineLibrary()
  await refreshCatalogSyncDisk()
  if (wasRunning) void runPass()
  return result ?? {}
}
