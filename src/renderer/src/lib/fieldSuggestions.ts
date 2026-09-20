// Autocomplete for free-text song fields that are actually shared across many
// songs - album, credits, recording location, leak type. Same idea as
// versionsApi's title suggestions, but sourced from the song catalog itself
// rather than a dedicated table: there's no server-side "distinct values for
// field X" endpoint, so this fetches the whole catalog once (same `?all=true`
// bulk mode compactGroups.ts uses - the catalog is small enough, ~2500 songs,
// that this is simpler and cheaper than a search-as-you-type request per
// keystroke) and indexes it client-side.
//
// Matching is whole-field, not per-name - "Dominic Miller & Nick Mira" is one
// suggestion, not two. Splitting multi-credit fields into individual names
// would need a real delimiter convention this data doesn't consistently have
// (" & ", ", ", "/" all show up), and whole-field matching is what the
// version-title suggestions already do, so it stays consistent.
import { loadAllSongs, JWApiSong } from './juicewrldApi'

export type SuggestField =
  | 'album' | 'credited_artists' | 'producers' | 'engineers'
  | 'recording_locations' | 'leak_type'

// Built once per catalog fetch and reused across every field/query - indexing
// all six fields costs one pass over ~2500 songs, and repeating that per
// keystroke was the difference between instant and noticeably laggy.
let indexCache: { forCatalog: Promise<JWApiSong[]>; byField: Map<SuggestField, Map<string, number>> } | null = null

function buildIndex(catalog: JWApiSong[]): Map<SuggestField, Map<string, number>> {
  const fields: SuggestField[] = ['album', 'credited_artists', 'producers', 'engineers', 'recording_locations', 'leak_type']
  const byField = new Map<SuggestField, Map<string, number>>(fields.map(f => [f, new Map()]))
  for (const song of catalog) {
    for (const field of fields) {
      const raw = (song[field] as string | null | undefined)?.trim()
      if (!raw) continue
      const counts = byField.get(field)!
      counts.set(raw, (counts.get(raw) ?? 0) + 1)
    }
  }
  return byField
}

async function getIndex(): Promise<Map<SuggestField, Map<string, number>>> {
  // juicewrldApi's shared bulk-catalogue cache rather than a private copy -
  // this module used to keep its own identical 5-minute TTL cache of the same
  // ?all=true fetch, so opening an edit form after any view that had already
  // loaded the catalogue paid for it a second time.
  const catalogPromise = loadAllSongs()
  if (indexCache?.forCatalog !== catalogPromise) {
    indexCache = { forCatalog: catalogPromise, byField: buildIndex(await catalogPromise) }
  }
  return indexCache.byField
}

/** Distinct values already used for `field`, matching `query` (case-
 *  insensitive substring; empty query returns the most common values),
 *  ranked by how many songs use them. Excludes `exclude` (the field's current
 *  value) so a song doesn't suggest re-typing what's already there. */
export async function suggestFieldValues(
  field: SuggestField, query: string, exclude?: string, limit = 8,
): Promise<string[]> {
  try {
    const byField = await getIndex()
    const counts = byField.get(field)
    if (!counts) return []
    const q = query.trim().toLowerCase()
    const excl = exclude?.trim()
    let entries = [...counts.entries()].filter(([v]) => v !== excl)
    if (q) entries = entries.filter(([v]) => v.toLowerCase().includes(q))
    return entries
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([v]) => v)
  } catch {
    return []
  }
}
