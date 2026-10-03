import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiFetch } from './api'
import { fail } from './command'
import { HOME_DIR } from './config'

// Songs from the API: search, title → song, and the full catalog for stats.
// The title helpers mirror the ones in the site's lib/juicewrldApi.ts (that
// module can't be compiled in - it pulls in the app's stores).

export interface Song {
  id: number
  name: string
  track_titles?: string[]
  path: string
  length: string
  credited_artists: string
  producers: string
  engineers?: string | null
  recording_locations?: string | null
  record_dates?: string | null
  release_date?: string | null
  preview_date?: string | null
  file_names?: string | null
  additional_information?: string | null
  category: string
  era: { name: string; time_frame?: string } | null
  image_url?: string | null
}

/** What a list row needs to point at a song (find, liked, playlist show). */
export interface SongRef { id: number; name: string }

/** Categories the site never offers in search or playlists. */
const HIDDEN = new Set(['unsurfaced', 'recording_session'])

export const cleanTitleForSearch = (title: string): string => title.replace(/\s*[[(].*$/, '').trim()

const stripFileTitleCruft = (title: string): string => title.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\s*\d{1,3}\s*[-._)]\s+/, '')

const normalizeSongTitle = (title: string): string => stripFileTitleCruft(title).replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()

const normalizeSongTitleLoose = (title: string): string => normalizeSongTitle(stripFileTitleCruft(title).replace(/[[(][^)\]]*[)\]]/g, ' '))

interface Page { results?: Song[] }

/** The API's loose search, minus the categories the site hides. Unlike the
 *  site's, a failed request throws, so "couldn't reach" isn't "no songs". */
export async function searchSongs(title: string, limit = 8): Promise<Song[]> {
  const raw = title.trim()
  if (!raw) return []
  const search = cleanTitleForSearch(stripFileTitleCruft(raw)) || raw
  const data = await apiFetch<Page>('/songs/', { search, page_size: limit })
  return (data.results ?? []).filter((s) => !HIDDEN.has(s.category)).slice(0, limit)
}

/** A title to the song it names - only on an exact (then loose) name match,
 *  since the search's top hit alone proves nothing. */
export async function resolveTitleToSong(title: string): Promise<Song | null> {
  const raw = title.trim()
  const wanted = normalizeSongTitle(raw)
  if (!wanted) return null
  const search = cleanTitleForSearch(stripFileTitleCruft(raw))
  if (!search) return null
  const data = await apiFetch<Page>('/songs/', { search, page_size: 10 })
  const results = (data.results ?? []).filter((s) => !HIDDEN.has(s.category))
  const namesOf = (s: Song): string[] => [s.name, ...(s.track_titles ?? [])]
  const wantedLoose = normalizeSongTitleLoose(raw)
  return (
    results.find((s) => namesOf(s).some((n) => normalizeSongTitle(n) === wanted)) ??
    results.find((s) => namesOf(s).some((n) => normalizeSongTitleLoose(n) === wantedLoose)) ??
    null
  )
}

export const getSong = (id: number): Promise<Song> => apiFetch<Song>(`/songs/${id}/`)

// The last numbered song list (find, liked, playlist show), so `song 3`,
// `like 3` or `playlist add Mix -- 3` can point at a row by number.
let lastList: SongRef[] = []
export function rememberList(songs: SongRef[]): void { lastList = songs.map((s) => ({ id: s.id, name: s.name })) }
export const hasList = (): boolean => lastList.length > 0

export async function songFromArg(arg: string): Promise<SongRef> {
  const typed = arg.trim()
  if (!typed) fail('name a song (a title, or a number from the last list)')
  const n = /^#?(\d+)$/.exec(typed)
  if (n && lastList.length > 0) return lastList[Number(n[1]) - 1] ?? fail(`pick a number from 1 to ${lastList.length}`)
  const song = await resolveTitleToSong(typed)
  if (song) return song
  // A bare number with no list to pick from is more likely a pick than a title.
  return fail(n ? `no numbered list to pick ${typed} from (run find, liked or playlist show first)` : `no song found for "${typed}" (try: find ${typed})`)
}

/** Tab: titles that start with what's typed (two letters or more). */
export async function completeTitles(typed: string): Promise<string[]> {
  const t = typed.trim().toLowerCase()
  if (t.length < 2 || /^\d+$/.test(t)) return []
  return (await searchSongs(t, 15)).map((s) => s.name).filter((n) => n.toLowerCase().startsWith(t))
}

// ─── The whole catalog (stats) ───────────────────────────────────────────────
// /songs/?all=true is ~11 MB, so a slim copy is kept on disk for a day.

export interface StatsSong {
  id: number
  name: string
  path: string
  length: string
  credited_artists: string
  producers: string
  category: string
  image_url: string | null
  era: { name: string } | null
}

const CATALOG_FILE = join(HOME_DIR, 'cache', 'catalog.json')
const CATALOG_TTL_MS = 24 * 60 * 60_000

export async function loadCatalog(fresh: boolean, onFetch: () => void): Promise<Map<number, StatsSong>> {
  if (!fresh && existsSync(CATALOG_FILE) && Date.now() - statSync(CATALOG_FILE).mtimeMs < CATALOG_TTL_MS) {
    try {
      const rows = JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as StatsSong[]
      return new Map(rows.map((s) => [s.id, s]))
    } catch { /* unreadable - fetch it again */ }
  }
  onFetch()
  const all = await apiFetch<Song[] | Page>('/songs/', { all: 'true' })
  const rows: StatsSong[] = (Array.isArray(all) ? all : all.results ?? []).map((s) => ({
    id: s.id, name: s.name, path: s.path, length: s.length, credited_artists: s.credited_artists,
    producers: s.producers, category: s.category, image_url: s.image_url ?? null, era: s.era ? { name: s.era.name } : null,
  }))
  try {
    mkdirSync(join(HOME_DIR, 'cache'), { recursive: true })
    writeFileSync(CATALOG_FILE, JSON.stringify(rows))
  } catch { /* still usable this time */ }
  return new Map(rows.map((s) => [s.id, s]))
}
