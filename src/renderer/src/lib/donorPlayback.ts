// Playing donor cloud files. The own-file download route needs the auth
// header, so an <audio> can't stream it by URL: a donor Track carries a
// `donor://<file_id>` marker in streamUrl, and the Player swaps that for a blob
// URL fetched with the token. Blobs are big (up to 100 MB), so only a few are
// held at a time - current, next, and one spare.
import type { Track } from '../types'
import type { DonorFile } from './donorFilesApi'
import { fetchDonorFileBlob, extensionOf } from './donorFilesApi'
import { cachedDonorCover } from './donorCoverArt'

const SCHEME = 'donor://'
const MAX_CACHED = 3
const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma']

const cache = new Map<string, string>() // file_id -> object URL, oldest first
const pending = new Map<string, Promise<string>>()

export const donorTrackId = (fileId: string): string => `donor-file-${fileId}`

export function isDonorStreamUrl(url: string | undefined): url is string {
  return !!url && url.startsWith(SCHEME)
}

export function donorFileIdFromUrl(url: string): string {
  return url.slice(SCHEME.length)
}

/** The object URL for a `donor://` marker, or null when it isn't fetched yet. */
export function cachedDonorUrl(streamUrl: string): string | null {
  const id = donorFileIdFromUrl(streamUrl)
  const url = cache.get(id)
  if (!url) return null
  // Touch so the track being played never counts as the oldest entry.
  cache.delete(id)
  cache.set(id, url)
  return url
}

export function ensureDonorUrl(streamUrl: string): Promise<string> {
  const id = donorFileIdFromUrl(streamUrl)
  const hit = cachedDonorUrl(streamUrl)
  if (hit) return Promise.resolve(hit)
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const p = fetchDonorFileBlob(id)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      cache.set(id, url)
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value as string
        URL.revokeObjectURL(cache.get(oldest)!)
        cache.delete(oldest)
      }
      return url
    })
    .finally(() => { pending.delete(id) })
  pending.set(id, p)
  return p
}

/** Drop everything held in memory (sign-out). */
export function donorFileIdFromTrackId(trackId: string): string | null {
  return trackId.startsWith('donor-file-') ? trackId.slice('donor-file-'.length) : null
}

export function clearDonorPlaybackCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}

export function donorFileToTrack(f: DonorFile): Track {
  // Embedded MP3 art, when the row tile has already looked it up. The Player
  // also looks it up itself for a donor track that starts without one.
  const cover = cachedDonorCover(f.file_id)
  return {
    ...(cover ? { imageUrl: cover } : {}),
    id: donorTrackId(f.file_id),
    path: `${SCHEME}${f.file_id}`,
    streamUrl: `${SCHEME}${f.file_id}`,
    title: f.filename.replace(/\.[^.]+$/, ''),
    artist: 'My files',
    album: '',
    albumArtist: '',
    year: null,
    trackNumber: null,
    duration: 0,
    genre: '',
    hasAlbumArt: false,
  }
}

/** Audio files only - images can't go in a playlist. */
export function isDonorAudio(f: Pick<DonorFile, 'filename' | 'mime_type'>): boolean {
  return f.mime_type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(extensionOf(f.filename))
}
