// Bounded in-memory cache of cover art submission images as blob URLs. Only
// approved covers are public; the rest need the auth header, so a plain
// <img src> can't load them (see coverArtApi.fetchCoverArtImage). Shared by
// My cover art and the review queue, so flipping between rows doesn't fetch
// the same image again. Mirrors lib/donorImageCache.
import { fetchCoverArtImage } from './coverArtApi'

const MAX_CACHED = 24

const cache = new Map<number, string>() // submission id -> object URL, oldest first
const pending = new Map<number, Promise<string>>()

export function cachedCoverArtImageUrl(id: number): string | null {
  const url = cache.get(id)
  if (!url) return null
  cache.delete(id)
  cache.set(id, url)
  return url
}

export function ensureCoverArtImageUrl(id: number): Promise<string> {
  const hit = cachedCoverArtImageUrl(id)
  if (hit) return Promise.resolve(hit)
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const p = fetchCoverArtImage(id)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      cache.set(id, url)
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value as number
        URL.revokeObjectURL(cache.get(oldest)!)
        cache.delete(oldest)
      }
      return url
    })
    .finally(() => { pending.delete(id) })
  pending.set(id, p)
  return p
}

/** Forget one image (a withdrawn submission). */
export function dropCoverArtImage(id: number): void {
  const url = cache.get(id)
  if (url) URL.revokeObjectURL(url)
  cache.delete(id)
}

/** Drop everything held in memory (sign-out). */
export function clearCoverArtImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}
