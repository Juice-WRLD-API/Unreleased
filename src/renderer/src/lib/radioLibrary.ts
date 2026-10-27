import { apiFetch, loadAllSongs, normalizeSongTitle } from './juicewrldApi'
import { parseSearchQuery, matchesFieldFilters, textMatches } from './trackerSearch'
import type { FieldFilter } from './trackerSearch'

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

// Tracker field labels the library snapshot carries itself; every other
// field:"value" filter is resolved against the /songs/ catalogue instead.
const DIRECT_FIELDS: Record<string, (t: RadioLibraryTrack) => string> = {
  title: (t) => t.title,
  artists: (t) => t.artist,
  era: (t) => t.era,
}

// Strict and bracket-stripped forms, so "Lucid Dreams (v2)" on one side still
// meets "Lucid Dreams" on the other.
function titleKeys(title: string): string[] {
  const strict = normalizeSongTitle(title)
  const loose = normalizeSongTitle(title.replace(/[[(][^)\]]*[)\]]/g, ' '))
  return loose && loose !== strict ? [strict, loose] : [strict]
}

/** Titles of catalogue songs matching `filters` - the library has no producer,
 *  leak type, etc., so those filters match a library track by title instead. */
async function catalogTitlesMatching(filters: FieldFilter[]): Promise<Set<string>> {
  const titles = new Set<string>()
  for (const song of await loadAllSongs()) {
    if (!matchesFieldFilters(song, filters)) continue
    for (const name of [song.name, ...(song.track_titles ?? [])]) {
      if (name) for (const key of titleKeys(name)) titles.add(key)
    }
  }
  return titles
}

/** Searches the station's library with the Tracker's syntax (trackerSearch.ts):
 *  plain words match title/artist, `field:"value"` tokens filter by field. */
export async function searchRadioLibrary(query: string, limit = 5): Promise<RadioLibraryTrack[]> {
  const { freeText, filters } = parseSearchQuery(query)
  if (!freeText && !filters.length) return []
  const direct = filters.filter((f) => f.label in DIRECT_FIELDS)
  const viaCatalog = filters.filter((f) => !(f.label in DIRECT_FIELDS))
  const [tracks, catalogTitles] = await Promise.all([
    fetchRadioLibrary(),
    viaCatalog.length ? catalogTitlesMatching(viaCatalog) : Promise.resolve(null),
  ])
  const results: RadioLibraryTrack[] = []
  for (const track of tracks) {
    if (freeText && !textMatches(track.title, freeText) && !textMatches(track.artist, freeText)) continue
    if (!direct.every((f) => textMatches(DIRECT_FIELDS[f.label](track), f.value))) continue
    if (catalogTitles && !titleKeys(track.title).some((k) => catalogTitles.has(k))) continue
    results.push(track)
    if (results.length >= limit) break
  }
  return results
}
