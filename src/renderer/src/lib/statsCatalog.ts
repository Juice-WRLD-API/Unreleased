// Song metadata resolution for the Wrapped page (components/StatsView).
//
// A song-preference row is just {song id, playcount} - no title, no length, no
// era - so the page has to resolve every played id to a song before it can
// rank anything. Doing that one id at a time for every played song used to
// mean hundreds of requests on open, and worse, they didn't stick: apiCache
// holds ~300 entries for the entire app, so a few hundred played songs evict
// each other (and everything else) and the next visit refetches the lot. A
// small number of unknown ids still goes straight through individual
// requests (getSongsByIds, juicewrldApi.ts).
//
// For a genuinely large unknown set this instead mirrors lib/heardle's pool
// cache: page the catalogue in bulk, slim each row down to the fields the
// page actually uses, and keep that in localStorage for a day. ~25 requests
// once, then none. Deliberately NOT routed through apiFetch for the same
// reason heardle isn't - a page of full song objects is ~0.5MB, and caching
// those raw would blow the offline cache out.

import { apiRequest } from './apiClient'
import { JWAPI_BASE, getSongsByIds, songToTrack, loadAllSongs } from './juicewrldApi'
import type { JWApiSong, JWApiPaginatedResponse } from './juicewrldApi'
import type { Track } from '../types'

/** A song trimmed to what the stats page reads. Full rows are ~3.3KB each
 *  (lyrics, session tracking, notes) - ~16MB of localStorage for the whole
 *  catalogue. Slimmed it's ~290 bytes a row, ~1.4MB for all ~2.5k songs. */
export interface StatsSong {
  id: number
  name: string
  path: string
  length: string
  credited_artists: string
  producers: string
  category: JWApiSong['category']
  image_url: string | null
  album?: string | null
  /** Era trimmed to what's displayed/grouped on - the API's own row also
   *  carries a description and time frame the page never shows. */
  era: { id: number; name: string } | null
}

export function slimSong(song: JWApiSong): StatsSong {
  return {
    id: song.id,
    name: song.name,
    path: song.path,
    length: song.length,
    credited_artists: song.credited_artists,
    producers: song.producers,
    category: song.category,
    image_url: song.image_url,
    album: song.album ?? null,
    era: song.era ? { id: song.era.id, name: song.era.name } : null,
  }
}

/** Builds the playable Track for a slim row. Goes through songToTrack rather
 *  than assembling a Track here so the per-song name/cover overrides (and the
 *  stream URL) resolve exactly the way they do everywhere else - the fields it
 *  reads are all present above; the rest are metadata this page never shows. */
export function statsSongToTrack(s: StatsSong): Track {
  return songToTrack({
    ...s,
    // songToTrack's display title comes from `name` alone (see its own
    // comment) - this only exists to satisfy JWApiSong's shape.
    track_titles: [],
    era: s.era,
    album: s.album ?? null,
    lyrics: null,
    synced_lyrics: null,
    leak_type: null,
    date_leaked: null,
  })
}

// ─── Catalogue cache ─────────────────────────────────────────────────────────

const LS_KEY = 'unreleased:stats:catalog:v1'
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 100
// The catalogue is ~2.5k songs; this is headroom, not a target. It exists so a
// malformed `next` can't spin the loop forever.
const MAX_PAGES = 40
// Pages requested at once. High enough to collapse the ~28-page crawl into a
// few round trips, low enough not to open a connection per page against an
// API the rest of the app is also using.
const PAGE_CONCURRENCY = 6

// Below this many unknown ids, fetching them individually (getSongsByIds -
// there's no real batch-by-id endpoint any more, see its comment in
// juicewrldApi.ts) is cheaper than paging the whole catalogue - a user who's
// played a handful of songs shouldn't pull 2.5k rows to learn about six of
// them. Above it, ~25 requests for the whole catalogue beats firing that many
// individual song requests at once.
const PER_ID_THRESHOLD = 40

interface CachedCatalog { ts: number; songs: StatsSong[] }

let memoryCatalog: Map<number, StatsSong> | null = null

function readCache(): { songs: StatsSong[]; stale: boolean } | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedCatalog
    if (!parsed?.songs?.length) return null
    return { songs: parsed.songs, stale: Date.now() - parsed.ts >= CATALOG_TTL_MS }
  } catch {
    return null
  }
}

function writeCache(songs: StatsSong[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), songs } as CachedCatalog))
  } catch {
    // Quota - the page still works from the in-memory copy this session.
  }
}

async function fetchPage(page: number): Promise<JWApiPaginatedResponse> {
  return apiRequest<JWApiPaginatedResponse>(
    `${JWAPI_BASE}/songs/?page=${page}&page_size=${PAGE_SIZE}`,
  )
}

/** Pages the catalogue. Page 1 carries `count`, so every remaining page is
 *  known up front and they go out in parallel (capped at PAGE_CONCURRENCY)
 *  rather than awaiting one at a time - the serial version spent ~20s of
 *  wall clock on ~28 round trips that don't depend on each other. */
async function fetchCatalog(onPage?: (page: number, total: number) => void): Promise<StatsSong[]> {
  const first = await fetchPage(1)
  const count = first.count ?? 0
  // `count` is the total row count, so the page total is only known after
  // the first response - before that the caller shows an indeterminate bar.
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(count / PAGE_SIZE)))

  // Indexed by page so out-of-order completions still concatenate in
  // catalogue order - the stats page ranks by playcount, but a stable order
  // keeps the cached blob diffable between runs.
  const pages: StatsSong[][] = [(first.results ?? []).map(slimSong)]
  let done = 1
  onPage?.(done, totalPages)

  const rest: number[] = []
  for (let page = 2; page <= totalPages; page++) rest.push(page)

  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= rest.length) return
      const page = rest[i]
      const data = await fetchPage(page)
      pages[page - 1] = (data.results ?? []).map(slimSong)
      done++
      onPage?.(done, totalPages)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, rest.length) }, worker),
  )

  return pages.flat()
}

/** The whole catalogue keyed by song id - memoised for the session, cached on
 *  disk for a day. A stale cache is still returned on a network failure. */
export async function loadCatalog(onPage?: (page: number, total: number) => void): Promise<Map<number, StatsSong>> {
  if (memoryCatalog) return memoryCatalog

  const cached = readCache()
  if (cached && !cached.stale) {
    memoryCatalog = new Map(cached.songs.map((s) => [s.id, s]))
    return memoryCatalog
  }

  let songs: StatsSong[]
  try {
    // Several other views (home, tracker sort mode, field suggestions) pull
    // the whole catalogue through loadAllSongs. When one of them already has
    // it in flight or cached, slimming that costs nothing and skips the page
    // crawl entirely - only fall back to paging when nobody has it, since
    // *starting* an all=true fetch here would pull the lyrics this page
    // throws away.
    // A warm fetch that turns out to have failed falls back to paging rather
    // than failing this page with it - it belongs to whoever started it.
    const warm = loadAllSongs.peek()
    songs = warm
      ? await warm.then((all) => all.map(slimSong), () => fetchCatalog(onPage))
      : await fetchCatalog(onPage)
  } catch (err) {
    // A day-old catalogue beats an empty page; song metadata barely moves.
    if (cached) {
      memoryCatalog = new Map(cached.songs.map((s) => [s.id, s]))
      return memoryCatalog
    }
    throw err
  }
  memoryCatalog = new Map(songs.map((s) => [s.id, s]))
  writeCache(songs)
  return memoryCatalog
}

/** What the view is currently waiting on, so it can label the progress line. */
export type ResolvePhase = 'catalog' | 'songs'

export interface ResolveProgress {
  phase: ResolvePhase
  done: number
  /** 0 while a total isn't known yet (first catalogue page in flight). */
  total: number
}

/**
 * Resolves played song ids to their metadata, choosing the cheaper route:
 * a handful of unknown ids are fetched individually, a large number pulls the
 * paged catalogue once and serves every future visit from cache.
 *
 * `isCancelled` is checked between steps so navigating away stops the work
 * instead of finishing a catalogue crawl into a dead component.
 */
export async function resolveStatsSongs(
  ids: number[],
  onProgress: (p: ResolveProgress) => void,
  isCancelled: () => boolean,
): Promise<Map<number, StatsSong>> {
  const out = new Map<number, StatsSong>()
  if (ids.length === 0) return out

  // The session/disk catalogue answers everything at zero cost when it's warm.
  const cached = memoryCatalog ?? (() => {
    const disk = readCache()
    if (disk && !disk.stale) {
      memoryCatalog = new Map(disk.songs.map((s) => [s.id, s]))
      return memoryCatalog
    }
    return null
  })()

  const missing: number[] = []
  for (const id of ids) {
    const hit = cached?.get(id)
    if (hit) out.set(id, hit)
    else missing.push(id)
  }
  if (missing.length === 0) return out

  if (missing.length > PER_ID_THRESHOLD) {
    onProgress({ phase: 'catalog', done: 0, total: 0 })
    const catalog = await loadCatalog((page, total) => {
      if (!isCancelled()) onProgress({ phase: 'catalog', done: page, total })
    })
    if (isCancelled()) return out
    for (const id of ids) {
      const song = catalog.get(id)
      if (song) out.set(id, song)
    }
    return out
  }

  // Few enough (≤ PER_ID_THRESHOLD) to ask for directly - one batched
  // /songs/?ids=... request (chunked only if that ever changes to exceed the
  // endpoint's own per-request cap) instead of one /songs/{id}/ call per id.
  onProgress({ phase: 'songs', done: 0, total: missing.length })
  const results = await getSongsByIds(missing)
  if (isCancelled()) return out
  for (const song of results) out.set(song.id, slimSong(song))
  onProgress({ phase: 'songs', done: missing.length, total: missing.length })
  return out
}
