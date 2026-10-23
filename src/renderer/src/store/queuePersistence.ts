import type { StoreApi } from 'zustand'
import type { Track } from '../types'
import type { QueueSlice } from './queueSlice'
import { ls } from '../lib/persist'

const SESSION_KEY = 'queue-session'
const POSITION_KEY = 'queue-position'
const SESSION_FIELDS = [
  'queue', 'queueIndex', 'currentTrack', 'queueFilter',
  'queueSource', 'queueSongPool', 'radioMode', 'radioNext', 'radioFilter', 'playHistory',
] as const
type QueueSession = Pick<QueueSlice, typeof SESSION_FIELDS[number] | 'currentTime' | 'progress'>

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const nonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
const stableUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && !/^(data|blob):/i.test(value) ? value : undefined

// Keep metadata small: local/donor artwork is reloaded by Player, and a
// FullTrack passed as a Track must not accidentally save lyrics or base64 art.
function savedTrack(value: unknown): Track | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id
    || typeof value.path !== 'string' || typeof value.title !== 'string') return null
  return {
    id: value.id, path: value.path, title: value.title,
    artist: text(value.artist), album: text(value.album), albumArtist: text(value.albumArtist),
    year: typeof value.year === 'number' ? value.year : null,
    trackNumber: typeof value.trackNumber === 'number' ? value.trackNumber : null,
    duration: nonNegative(value.duration), genre: text(value.genre), hasAlbumArt: value.hasAlbumArt === true,
    streamUrl: stableUrl(value.streamUrl), imageUrl: stableUrl(value.imageUrl),
    era: typeof value.era === 'string' ? value.era : undefined,
    apiTitle: typeof value.apiTitle === 'string' ? value.apiTitle : undefined,
    apiImageUrl: stableUrl(value.apiImageUrl),
  }
}

function filters(value: unknown): QueueSlice['radioFilter'] {
  if (!record(value)) return null
  return { category: text(value.category), era: text(value.era), search: text(value.search), total: nonNegative(value.total) }
}

function saveSession(state: QueueSlice): boolean {
  // Source order and compact-playlist pools often contain the same tracks as
  // the queue. Store each track once, preserving duplicate queue entries by id.
  const tracks = new Map<string, Track>()
  const add = (track: Track): string => {
    tracks.set(track.id, savedTrack(track)!)
    return track.id
  }
  const snapshot = {
    version: 1,
    queue: state.queue.map(add), queueIndex: state.queueIndex,
    queueSongPool: state.queueSongPool?.map(add) ?? null,
    playHistory: state.playHistory.map(add),
    radioNext: state.radioNext ? add(state.radioNext) : null,
    currentTrack: state.currentTrack ? add(state.currentTrack) : null,
    queueFilter: state.queueFilter, queueSource: state.queueSource,
    radioMode: state.radioMode, radioFilter: state.radioFilter,
  }
  return ls.trySet(SESSION_KEY, { ...snapshot, tracks: [...tracks.values()] })
}

export function loadQueueSession(): QueueSession | null {
  const saved = ls.get<unknown>(SESSION_KEY)
  if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.tracks) || !Array.isArray(saved.queue)) return null
  const tracks = new Map<string, Track>()
  for (const value of saved.tracks) {
    const track = savedTrack(value)
    if (track) tracks.set(track.id, track)
  }
  const list = (ids: unknown): Track[] => Array.isArray(ids)
    ? ids.flatMap((id) => typeof id === 'string' && tracks.has(id) ? [tracks.get(id)!] : []) : []
  const queue = list(saved.queue)
  // Don't silently shift the playing index when a snapshot has broken rows.
  if (queue.length !== saved.queue.length) return null
  const currentTrack = typeof saved.currentTrack === 'string' ? tracks.get(saved.currentTrack) ?? null : null
  const queueIndex = typeof saved.queueIndex === 'number' && Number.isInteger(saved.queueIndex)
    && saved.queueIndex >= -1 && saved.queueIndex < queue.length ? saved.queueIndex : -1
  if (saved.currentTrack != null && !currentTrack) return null
  if (currentTrack && (queueIndex < 0 || queue[queueIndex]?.id !== currentTrack.id)) return null
  const position = ls.get<unknown>(POSITION_KEY)
  const time = currentTrack && record(position) && position.trackId === currentTrack.id && position.queueIndex === queueIndex
    ? nonNegative(position.time) : 0
  const currentTime = currentTrack?.duration ? Math.min(time, currentTrack.duration) : time
  const filter = filters(saved.queueFilter)
  return {
    queue, queueIndex, currentTrack, currentTime,
    progress: currentTrack?.duration ? currentTime / currentTrack.duration : 0,
    queueSongPool: Array.isArray(saved.queueSongPool) ? list(saved.queueSongPool) : null,
    playHistory: list(saved.playHistory).slice(0, 100),
    queueSource: saved.queueSource === 'tracker' || saved.queueSource === 'playlist' ? saved.queueSource : null,
    queueFilter: filter && record(saved.queueFilter) ? {
      ...filter, page: Math.max(1, Math.floor(nonNegative(saved.queueFilter.page))), hasMore: saved.queueFilter.hasMore === true,
    } : null,
    radioMode: saved.radioMode === true && !!currentTrack,
    radioNext: typeof saved.radioNext === 'string' ? tracks.get(saved.radioNext) ?? null : null,
    radioFilter: filters(saved.radioFilter),
  }
}

export function clearQueueSession(): void {
  ls.remove(SESSION_KEY)
  ls.remove(POSITION_KEY)
}

// Only the main renderer installs this. Pop-outs share localStorage, but their
// queue is an incomplete display mirror and must never overwrite the session.
export function watchQueueSession(store: StoreApi<QueueSlice>): () => void {
  let lastPosition = 0
  const savePosition = (): void => {
    const state = store.getState()
    if (!state.rememberQueue) return
    ls.set(POSITION_KEY, { trackId: state.currentTrack?.id ?? null, queueIndex: state.queueIndex, time: state.currentTime })
    lastPosition = state.currentTime
  }
  const unsubscribe = store.subscribe((_state, prev) => {
    // Other queue subscribers can synchronously update history before us.
    const state = store.getState()
    if (!state.rememberQueue) {
      if (prev.rememberQueue) clearQueueSession()
      return
    }
    const changed = !prev.rememberQueue || SESSION_FIELDS.some((key) => state[key] !== prev[key])
    if (changed && !saveSession(state)) clearQueueSession()
    // Position gets its own tiny record so playback doesn't serialize a large
    // queue four times a second. Pausing and closing flush the latest time.
    if (changed || state.isPlaying !== prev.isPlaying || Math.abs(state.currentTime - lastPosition) >= 5
      || (!state.isPlaying && state.currentTime !== prev.currentTime)) savePosition()
  })
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') savePosition() }
  window.addEventListener('pagehide', savePosition)
  window.addEventListener('beforeunload', savePosition)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', savePosition)
    window.removeEventListener('beforeunload', savePosition)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
