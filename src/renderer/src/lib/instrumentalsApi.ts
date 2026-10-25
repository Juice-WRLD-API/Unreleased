import { apiFetch, cleanTitleForSearch, normalizeSongTitle, parseBrowseEntries, parseDuration, searchFiles, JWApiBrowseResponse, JWApiFileEntry } from './juicewrldApi'
import { getMediaType } from './fileTypes'
import { createTtlCache, type TtlCache } from './ttlCache'

// Instrumentals live in the file tree one folder per song, filed by era:
// "Instrumentals/9. Death Race For Love/Arctic Tundra/JUUL MANGO 5 new one.wav"
// (a few sit one level deeper, under "Instrumentals/Others/<album>/<song>/").
// The file names are whatever the producer called the beat, so the song is
// only ever identified by the folder a file sits in.

export interface Instrumental {
  name: string
  path: string
  /** The song folder's own name, e.g. "Arctic Tundra (feat. Juice WRLD) [v6]". */
  folder: string
  /** The folders between the root and the song folder, numbering dropped -
   *  "Death Race For Love", or "Others · Death Race For Love (TV Mix)". */
  era: string
  duration: number
}

export const INSTRUMENTALS_ROOT = 'Instrumentals'

const ROOT_PREFIX = `${INSTRUMENTALS_ROOT.toLowerCase()}/`

/** Folders are named with and without "(feat. X)", "(v2)", "[v6]" etc., so a
 *  song matches on its title up to the first bracket - titles with the same
 *  key share one list. */
export function instrumentalsKey(title: string): string {
  return normalizeSongTitle(cleanTitleForSearch(title))
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The song an Instrumentals file belongs to - its folder's name - or null
 *  for a path outside that tree. */
export function instrumentalSongTitle(path: string): string | null {
  if (!path.toLowerCase().startsWith(ROOT_PREFIX)) return null
  const segs = path.split('/')
  return segs.length >= 3 ? segs[segs.length - 2] : null
}

async function browse(path: string): Promise<JWApiFileEntry[]> {
  return parseBrowseEntries(await apiFetch<JWApiBrowseResponse>('/files/browse/', { path }))
}

async function fetchInstrumentals(title: string): Promise<Instrumental[]> {
  const term = cleanTitleForSearch(title)
  const want = instrumentalsKey(term)
  if (!want) return []
  // Searching inside the root keeps out the song's snippets, sessions, covers…
  const hits = await searchFiles(term, { path: INSTRUMENTALS_ROOT })
  const folders = new Set<string>()
  for (const e of hits) {
    if (!e.path.toLowerCase().startsWith(ROOT_PREFIX)) continue
    const folder = e.type === 'directory' ? e.path : parentPath(e.path)
    // Era folders ("Instrumentals/<era>") never hold files directly.
    if (folder.split('/').length < 3) continue
    if (instrumentalsKey(lastSegment(folder)) === want) folders.add(folder)
  }
  // Numbered era folders sort chronologically, "Others" after them.
  const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const lists = await Promise.all(sorted.map(async (folder) => {
    const name = lastSegment(folder)
    const era = folder.split('/').slice(1, -1).map((s) => s.replace(/^\d+\.\s*/, '')).join(' · ')
    const files = (await browse(folder)).filter((e) => e.type === 'file' && getMediaType(e.name) === 'audio')
    return files
      .map((f): Instrumental => ({
        name: f.name.replace(/\.[^.]+$/, ''),
        path: f.path,
        folder: name,
        era,
        duration: parseDuration(f.duration),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  }))
  return lists.flat()
}

const caches = new Map<string, TtlCache<Instrumental[]>>()

/** Every instrumental filed under a song's title (cached for 5 minutes). */
export function loadInstrumentals(title: string): Promise<Instrumental[]> {
  const key = instrumentalsKey(title)
  let cache = caches.get(key)
  if (!cache) {
    cache = createTtlCache(5 * 60_000, () => fetchInstrumentals(title))
    caches.set(key, cache)
  }
  return cache()
}
