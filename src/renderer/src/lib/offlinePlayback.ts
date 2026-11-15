// Playing downloaded tracks. The Player asks synchronously what URL a track
// plays from, but the files live in IndexedDB, which only answers
// asynchronously - so, like donor files (donorPlayback), a downloaded track
// resolves to a blob URL once it has been read, and the Player waits for that
// read before loading it. The upcoming track is read ahead of time (see the
// Player's prefetch), so on a normal advance the URL is already there.
// Only a few files are held as blob URLs at once: current, next, one spare.
import { useOfflineStore } from '../store/useOfflineStore'
import { getAudio } from './offlineStore'

const MAX_CACHED = 3

const cache = new Map<string, string>() // track id -> object URL, oldest first
const pending = new Map<string, Promise<string>>()
// Tracks whose saved file wouldn't read back this session: they stream like
// any other track instead of failing again on every play.
const broken = new Set<string>()

/** True when this track has a saved file to play. */
export function isOfflineTrack(trackId: string): boolean {
  return useOfflineStore.getState().trackIds.has(trackId) && !broken.has(trackId)
}

/** The blob URL for a downloaded track, or null when it hasn't been read yet. */
export function cachedOfflineUrl(trackId: string): string | null {
  const url = cache.get(trackId)
  if (!url) return null
  // Touch, so the track that's playing never counts as the oldest.
  cache.delete(trackId)
  cache.set(trackId, url)
  return url
}

export function getOfflineBlob(trackId: string): Promise<Blob | null> {
  return getAudio(trackId)
}

export function ensureOfflineUrl(trackId: string): Promise<string> {
  const hit = cachedOfflineUrl(trackId)
  if (hit) return Promise.resolve(hit)
  const inFlight = pending.get(trackId)
  if (inFlight) return inFlight
  const p = getAudio(trackId)
    .then((blob) => {
      if (!blob) throw new Error('no saved file')
      const url = URL.createObjectURL(blob)
      cache.set(trackId, url)
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value as string
        URL.revokeObjectURL(cache.get(oldest)!)
        cache.delete(oldest)
      }
      return url
    })
    .catch((err) => {
      broken.add(trackId)
      throw err
    })
    .finally(() => { pending.delete(trackId) })
  pending.set(trackId, p)
  return p
}

/** The saved copy wouldn't play: stream this track from now on, this session. */
export function markOfflineBroken(trackId: string): void {
  forgetOfflineUrl(trackId)
  broken.add(trackId)
}

/** Forget a track's blob URL (its file was deleted). */
export function forgetOfflineUrl(trackId: string): void {
  const url = cache.get(trackId)
  if (url) URL.revokeObjectURL(url)
  cache.delete(trackId)
  broken.delete(trackId)
}

export function clearOfflinePlaybackCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
  broken.clear()
}
