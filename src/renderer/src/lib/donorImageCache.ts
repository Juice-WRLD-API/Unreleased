// Bounded in-memory cache of donor image blob URLs, shared by DonorFiles' row
// thumbnails and its "preview" panel (see components/DonorFiles.tsx) so the
// same file is only ever fetched once. Own-file downloads need the auth
// header, so a plain <img src> can't point at the API directly.
//
// Mirrors lib/donorPlayback's cache, but with a bigger cap - thumbnails for
// every visible row can pile up fast, and unlike audio (one playing at a
// time) there's no natural "only keep a couple" rule here. Donor images can
// still be up to 100MB each, so this stays bounded rather than unbounded.
import { fetchDonorFileBlob } from './donorFilesApi'

const MAX_CACHED = 24

const cache = new Map<string, string>() // file_id -> object URL, oldest first
const pending = new Map<string, Promise<string>>()

export function cachedDonorImageUrl(fileId: string): string | null {
  const url = cache.get(fileId)
  if (!url) return null
  // Touch so the most recently viewed thumbnails are the last to be evicted.
  cache.delete(fileId)
  cache.set(fileId, url)
  return url
}

export function ensureDonorImageUrl(fileId: string): Promise<string> {
  const hit = cachedDonorImageUrl(fileId)
  if (hit) return Promise.resolve(hit)
  const inFlight = pending.get(fileId)
  if (inFlight) return inFlight
  const p = fetchDonorFileBlob(fileId)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      cache.set(fileId, url)
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value as string
        URL.revokeObjectURL(cache.get(oldest)!)
        cache.delete(oldest)
      }
      return url
    })
    .finally(() => { pending.delete(fileId) })
  pending.set(fileId, p)
  return p
}

/** Drop everything held in memory (sign-out). */
export function clearDonorImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}
