import { apiFetch } from './juicewrldApi'

// The DJ publishes its own library snapshot to /radio/library/, keyed by a hash
// of each file path. That id is the only thing `propose_queue` can resolve - a
// numeric /songs/ id looks similar but never matches.
export interface RadioLibraryTrack {
  id: string
  title: string
  artist: string
  era: string
}

interface RadioLibraryResponse {
  eras?: { name?: string; tracks?: { id?: string; title?: string; artist?: string }[] }[]
}

const CACHE_TTL_MS = 5 * 60 * 1000

let cache: RadioLibraryTrack[] | null = null
let cachedAt = 0
let inFlight: Promise<RadioLibraryTrack[]> | null = null

export async function fetchRadioLibrary(): Promise<RadioLibraryTrack[]> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      // Through apiFetch rather than a bare fetch: it revalidates against the
      // HTTP cache (this snapshot is ~95KB) and writes to the offline cache, so
      // suggestions still work on a cold, offline start.
      const data = await apiFetch<RadioLibraryResponse>('/radio/library/')
      const flat: RadioLibraryTrack[] = []
      for (const era of data.eras ?? []) {
        for (const track of era.tracks ?? []) {
          if (!track.id) continue
          flat.push({
            id: String(track.id),
            title: track.title ?? '',
            artist: track.artist ?? '',
            era: era.name ?? '',
          })
        }
      }
      cache = flat
      cachedAt = Date.now()
      return flat
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export async function searchRadioLibrary(query: string, limit = 5): Promise<RadioLibraryTrack[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const tracks = await fetchRadioLibrary()
  const results: RadioLibraryTrack[] = []
  for (const track of tracks) {
    if (
      track.title.toLowerCase().includes(needle) ||
      track.artist.toLowerCase().includes(needle)
    ) {
      results.push(track)
      if (results.length >= limit) break
    }
  }
  return results
}
