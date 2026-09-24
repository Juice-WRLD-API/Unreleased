// Embedded cover art for donor audio files, without downloading the whole
// file. MP3 art lives in the ID3v2 tag at the very start of the file, and the
// tag's 10-byte header says exactly how long it is - so two small Range
// requests (header, then the tag itself) are enough, even for a 100MB file.
// The download route supports Range and needs the auth header, which is why
// this can't just be an <img src>.
//
// MP3 (ID3v2) only. FLAC/M4A/OGG keep their art elsewhere in the container;
// those files get null here and fall back to the generic tile.
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js'
import { routeUrl } from './juicewrldApi'
import { authHeaders } from './apiClient'
import { getToken } from './userApi'
import { extensionOf } from './donorFilesApi'

const MAX_TAG_BYTES = 8 * 1024 * 1024 // guard against a corrupt size field
const MAX_CACHED = 64

// file_id -> object URL, or null for "looked, has no art" so it isn't re-fetched.
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()
const listeners = new Set<() => void>()

const downloadUrl = (fileId: string): string => routeUrl(`/accounts/donor/files/${fileId}/download/`)

async function fetchRange(fileId: string, start: number, end: number): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl(fileId), {
    headers: { ...authHeaders(getToken()), Range: `bytes=${start}-${end}` },
  })
  if (!res.ok) throw new Error(`Range fetch failed (${res.status})`)
  const buf = await res.arrayBuffer()
  // A server that ignores Range answers 200 with the whole file - still usable,
  // just trim it so we don't hold 100MB for a thumbnail.
  return buf.byteLength > end - start + 1 ? buf.slice(start, end + 1) : buf
}

function readPicture(blob: Blob): Promise<{ format: string; data: number[] } | null> {
  return new Promise((resolve) => {
    jsmediatags.read(blob, {
      onSuccess: ({ tags }) => resolve(tags.picture ?? null),
      onError: () => resolve(null),
    })
  })
}

async function extract(fileId: string): Promise<string | null> {
  const header = new Uint8Array(await fetchRange(fileId, 0, 9))
  // "ID3" magic
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return null
  // Synchsafe size (7 bits per byte), excluding the 10-byte header.
  const size = ((header[6] & 0x7f) << 21) | ((header[7] & 0x7f) << 14) | ((header[8] & 0x7f) << 7) | (header[9] & 0x7f)
  if (size <= 0 || size > MAX_TAG_BYTES) return null
  const tag = await fetchRange(fileId, 0, size + 9)
  const pic = await readPicture(new Blob([tag], { type: 'audio/mpeg' }))
  if (!pic) return null
  return URL.createObjectURL(new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' }))
}

export function hasEmbeddedArtSupport(filename: string): boolean {
  return extensionOf(filename) === 'mp3'
}

/** undefined = not looked up yet; null = no art. */
export function cachedDonorCover(fileId: string): string | null | undefined {
  return cache.has(fileId) ? cache.get(fileId)! : undefined
}

/** `filename` lets non-MP3s skip the request entirely; without it the ID3
 *  magic check still rejects them after one 10-byte fetch. */
export function ensureDonorCover(fileId: string, filename?: string): Promise<string | null> {
  if (cache.has(fileId)) return Promise.resolve(cache.get(fileId)!)
  if (filename && !hasEmbeddedArtSupport(filename)) { cache.set(fileId, null); return Promise.resolve(null) }
  const inFlight = pending.get(fileId)
  if (inFlight) return inFlight
  const p = extract(fileId)
    .catch(() => null)
    .then((url) => {
      cache.set(fileId, url)
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value as string
        const old = cache.get(oldest)
        if (old) URL.revokeObjectURL(old)
        cache.delete(oldest)
      }
      listeners.forEach((l) => l())
      return url
    })
    .finally(() => { pending.delete(fileId) })
  pending.set(fileId, p)
  return p
}

/** Notified whenever a lookup finishes, so already-built Tracks can pick art up. */
export function onDonorCoverLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Forget a file's art (deleted, or retagged with a new cover). */
export function forgetDonorCover(fileId: string): void {
  const url = cache.get(fileId)
  if (url) URL.revokeObjectURL(url)
  cache.delete(fileId)
}

export function clearDonorCoverCache(): void {
  for (const url of cache.values()) if (url) URL.revokeObjectURL(url)
  cache.clear()
}
