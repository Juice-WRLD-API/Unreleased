import { Track } from '../types'
import { apiRequest } from './apiClient'
import { cacheGet } from './apiCache'
import { peekSongPref } from './songPrefs'
import { peekRotatedCover } from './coverRotation'
import { peekEraCover } from './eraCovers'
import { createTtlCache } from './ttlCache'
import { peekSessionEditOverride } from './sessionEditOverrides'
import { peekActiveChannel } from './activeChannelState'
import { peekSessionEditLink } from './sessionEditLinksMirror'

export const DEFAULT_JWAPI_BASE = 'https://juicewrldapi.com/juicewrld'

const API_BASE_OVERRIDE_KEY = 'jwapi_base_override'

function readApiBaseOverride(): string | null {
  try {
    const raw = localStorage.getItem(API_BASE_OVERRIDE_KEY)
    return raw ? raw.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

// Every lib/*Api.ts file builds its own `${JWAPI_BASE}/...` constants at
// import time, so this only takes effect on next load - setApiBaseOverride
// reloads the app for that reason.
export const JWAPI_BASE = readApiBaseOverride() ?? DEFAULT_JWAPI_BASE

export function getApiBaseOverride(): string | null {
  return readApiBaseOverride()
}

export function setApiBaseOverride(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(API_BASE_OVERRIDE_KEY, url.trim().replace(/\/+$/, ''))
    } else {
      localStorage.removeItem(API_BASE_OVERRIDE_KEY)
    }
  } catch {}
  location.reload()
}

/** The one host everything the API serves lives on - its endpoints under
 *  JWAPI_BASE, and the site's own static cover images under /assets/, which
 *  a song's `image_url` points at (see buildImageUrl). */
export const JWAPI_HOST = new URL(JWAPI_BASE).hostname

// Backend zip endpoints are temporarily disabled - flip this back to true to restore
// the ZIP download UI (playlist/song/file-browser download-as-ZIP buttons and menu items).
export const ZIP_OPERATIONS_ENABLED = false

// ─── API Types ────────────────────────────────────────────────────────────────

export interface JWApiEra {
  id: number
  name: string
  description?: string
  time_frame?: string
}

export interface JWApiSong {
  id: number
  public_id?: number | null
  name: string
  original_key?: string | null
  track_titles: string[]
  path: string
  length: string                     // "3:59"
  credited_artists: string
  producers: string
  engineers?: string | null
  recording_locations?: string | null
  record_dates?: string | null
  bitrate?: string | null
  bpm?: number | null
  key?: string | null
  additional_information?: string | null
  file_names?: string | null
  instrumentals?: string | null
  instrumental_names?: string | null
  preview_date?: string | null
  release_date?: string | null
  dates?: string | null
  session_titles?: string | null
  session_tracking?: string | null
  notes?: string | null
  snippets?: unknown[]
  era: JWApiEra | null
  image_url: string | null           // relative, e.g. "/assets/youtube.webp"
  category: 'released' | 'unreleased' | 'unsurfaced' | 'recording_session'
  lyrics: string | null
  synced_lyrics: string | null
  leak_type: string | null
  date_leaked: string | null
  album?: string | null
}

export interface JWApiPaginatedResponse {
  count: number
  next: string | null
  previous: string | null
  results: JWApiSong[]
}

export interface JWApiStats {
  total_songs: number
  category_stats: {
    released: number
    unreleased: number
    unsurfaced: number
    recording_session: number
  }
  era_stats: Record<string, number>
}

// ─── Site-wide play stats (GET /plays/stats/) ──────────────────────────────────
// Distinct from JWApiStats (GET /stats/) above: that one counts catalog rows,
// this one counts plays across every listener. top_albums is documented but
// comes back empty in practice - typed loosely since its shape is unverified.

export interface JWApiPlaysCategoryCount {
  category: JWApiSong['category']
  count: number
}

export interface JWApiTopSong {
  id: number
  public_id: number
  name: string
  era_name: string | null
  category: JWApiSong['category']
  play_count: number
}

export interface JWApiTopEra {
  id: number
  name: string
  play_count: number
}

export interface JWApiRecentPlay {
  id: number
  song_id: number
  public_id: number
  title: string
  era_name: string | null
  category: JWApiSong['category']
  album_name: string | null
  source: string
  played_at: string
}

export interface JWApiPlaysStats {
  total_plays: number
  total_songs_with_plays: number
  total_albums_with_plays: number
  total_eras_with_plays: number
  category_breakdown: JWApiPlaysCategoryCount[]
  top_songs: JWApiTopSong[]
  top_albums: unknown[]
  top_eras: JWApiTopEra[]
  recent_plays: JWApiRecentPlay[]
}

export interface JWApiRadioResponse {
  title: string
  path: string
  song: JWApiSong
  size: number
  hash: string
}

export interface JWApiFileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number | null
  modified?: string | null
  duration?: string | null
}

// /files/browse/ may return { items: [...] } or a flat array
export type JWApiBrowseResponse = JWApiFileEntry[] | { items: JWApiFileEntry[]; current_path?: string }

/** Normalizes a /files/browse/ response to a flat entry array - shared by
 *  every view that hits that endpoint (ApiFilesView, CoverPickerModal). */
export function parseBrowseEntries(data: JWApiBrowseResponse): JWApiFileEntry[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) return data.items
  return []
}

/** Recursively walks a folder via repeated /files/browse/ calls and returns
 *  every file (not directory) entry underneath it, subfolders included. Used
 *  to expand a folder into an individual-file download list now that backend
 *  ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED) - the API has no
 *  recursive-listing endpoint of its own. */
export async function listFilesRecursive(path: string, channel?: string): Promise<JWApiFileEntry[]> {
  const params: Record<string, string> = {}
  if (path) params.path = path
  if (channel) params.channel = channel
  const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', params)
  const entries = parseBrowseEntries(data)
  const files: JWApiFileEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'file') files.push(entry)
    else files.push(...await listFilesRecursive(entry.path, channel))
  }
  return files
}

/** Strips trailing qualifiers ("(feat. X)", "[Prod. Y]") from a song title so
 *  a /files/browse/ search hits the file tree's naming - folders/images are
 *  rarely filed under the full bracketed title. Same idea as
 *  findSessionZips' strip() below, shared with CoverPickerModal and
 *  SongPrefsSection's inline cover search. */
export function cleanTitleForSearch(title: string): string {
  return title.replace(/\s*[[(].*$/, '').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Filters /files/browse/ search results down to entries whose path contains
 *  the query as a whole word - the API's `search` param is a plain substring
 *  match, so a short title like "Rental" also turns up unrelated files like
 *  "Parental Advisory.png" (which literally contains "rental"). Shared by
 *  CoverPickerModal and SongPrefsSection's inline cover search. */
export function filterSearchResults(entries: JWApiFileEntry[], term: string): JWApiFileEntry[] {
  const t = term.trim()
  if (!t) return entries
  const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i')
  return entries.filter((e) => re.test(e.path))
}

// ─── Fetch util ───────────────────────────────────────────────────────────────

// Builds the same URL/cache key apiFetch uses, so apiPeek below can read the
// exact entry apiFetch wrote for a given path+params.
function apiUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(JWAPI_BASE + path)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

export async function apiFetch<T>(
  path: string,
  params: Record<string, string | number | null | undefined> = {}
): Promise<T> {
  const cacheKey = apiUrl(path, params)
  return apiRequest<T>(cacheKey, {
    // 'no-cache', not 'no-store': both guarantee the response is revalidated
    // with the server on every call (never a silently stale read), but
    // no-cache lets an unchanged response come back as a 304 against the HTTP
    // cache instead of re-downloading the body. Matters most for the song
    // pages, which are hundreds of KB each. If the API sends no validators
    // this degrades to exactly the old behaviour.
    cache: 'no-cache',
    cacheKey,
    parseError: async (res) => `JW API error ${res.status}`,
  })
}

export const loadAllSongs = createTtlCache(5 * 60_000, () => apiFetch<JWApiSong[]>('/songs/', { all: 'true' }))

// Shared TTL + in-flight cache for single-song lookups by id. Player's lyrics
// fetch and RadioFmPlayer's now-playing match both resolve the full song
// object for whatever's currently playing, and often for the same song at
// once (e.g. the FM-matched track happens to be the one already queued).
// apiFetch's own dedup only collapses requests that overlap in time - once
// the first settles, a second caller a moment later still hits the network.
// Routing both through this cache instead lets that second caller reuse the
// still-fresh result.
const SONG_BY_ID_TTL_MS = 60_000
const songByIdCache = new Map<number, { promise: Promise<JWApiSong>; ts: number }>()

export function getSongById(id: number): Promise<JWApiSong> {
  const now = Date.now()
  const cached = songByIdCache.get(id)
  if (cached && now - cached.ts < SONG_BY_ID_TTL_MS) return cached.promise
  const entry = { promise: apiFetch<JWApiSong>(`/songs/${id}/`), ts: now }
  songByIdCache.set(id, entry)
  entry.promise.catch(() => { if (songByIdCache.get(id) === entry) songByIdCache.delete(id) })
  return entry.promise
}

// ─── Batch fetch (GET /songs/?ids=...) ─────────────────────────────────────
// The docs page (and this comment, formerly) claimed `ids=` filters by
// internal `id` and replies with CSV. Neither is true any more: live probes
// against the API show `ids=` actually filters by `public_id`, replies with
// the normal JSON envelope, and caps `results` at a default page size - and
// most songs in this catalogue (anything unreleased) have no `public_id` at
// all, so the "batch" path silently resolved nothing for them. See
// project_jwa_api_docs_drift in memory: the docs page is hand-written and
// drifts from the live API.
//
// Until the API grows a real batch-by-id endpoint, this just fans out to the
// single-song endpoint (GET /songs/{id}/, confirmed still keyed by internal
// id) in parallel and drops ids that don't exist - same contract callers
// already relied on (no error, no null placeholder).
export async function getSongsByIds(ids: number[]): Promise<JWApiSong[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const results = await Promise.all(unique.map((id) => getSongById(id).catch(() => null)))
  return results.filter((s): s is JWApiSong => s !== null)
}

// Synchronous read of the offline cache for a path+params - returns the last
// successful apiFetch response for that exact key, or undefined. Lets views do
// stale-while-revalidate: render the cached copy instantly on mount, then let
// their normal apiFetch refresh it in the background.
export function apiPeek<T>(
  path: string,
  params: Record<string, string | number | null | undefined> = {}
): T | undefined {
  return cacheGet<T>(apiUrl(path, params))
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function buildStreamUrl(path: string, channel?: string): string {
  const c = channel ? `&channel=${encodeURIComponent(channel)}` : ''
  return `${JWAPI_BASE}/files/download/?path=${encodeURIComponent(path)}${c}`
}

export interface JWApiChannel {
  slug: string
  name: string
  description?: string
  is_primary?: boolean
}

export async function fetchChannels(): Promise<JWApiChannel[]> {
  try {
    const data = await apiFetch<{ channels: JWApiChannel[] }>('/files/channels/')
    return data?.channels ?? []
  } catch {
    return []
  }
}

// The API serves cover art at full size - /files/cover-art/ hands back the art
// embedded in an audio file, and /files/download/ hands back a standalone
// image file whole. Most of these are a modest ~1MB 600x600 PNG, but some
// source files carry cover art at absurd resolutions (20MB+ isn't
// hypothetical) - either is overkill for a 36px list row, and it adds up fast
// when a virtualized list paints dozens at once. `small=1` asks for a
// degraded ~128px JPEG instead (a few KB, same image): plenty for anything
// drawn at thumbnail size, and a good first paint for anything bigger.
const SMALL_COVER_PARAM = 'small=1'

// Every "full" (non-thumbnail) cover-art request is still capped at this px
// size rather than asking for the raw embedded original - the API re-encodes
// down to a JPEG at this resolution, which keeps even a 20MB source well
// under a few hundred KB. Matches the documented max for the sibling
// /files/image-thumbnail/ endpoint (same underlying resize path).
const FULL_COVER_SIZE = 1024

// Endpoints that honour `small`. /files/download/ only degrades when the path is
// an image - for audio the API ignores the param - so it's matched by extension
// rather than blanket-applied, keeping stream URLs untouched.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|heic|tiff?)(&|$)/i

function degradable(url: string): boolean {
  if (url.includes(SMALL_COVER_PARAM)) return false
  if (url.includes('/files/cover-art/')) return true
  return url.includes('/files/download/') && IMAGE_EXT.test(url)
}

export function buildCoverArtUrl(path: string, small = false, channel?: string): string {
  const url = new URL(`${JWAPI_BASE}/files/cover-art/`)
  url.searchParams.set('path', path)
  if (channel) url.searchParams.set('channel', channel)
  // size and small both degrade the same embedded original - size wins when
  // both are passed (per the API), so only ever send one of the two.
  if (small) url.searchParams.set('small', '1')
  else url.searchParams.set('size', String(FULL_COVER_SIZE))
  return url.toString()
}

/** Rewrites an already-built cover URL to the API's degraded variant.
 *
 *  Most cover URLs in the app arrive as opaque strings (a Track's imageUrl, a
 *  preference's resolved cover, a song's `image_url`) with no path to rebuild
 *  from, so degrading happens at the point of render rather than at the source.
 *  Anything the API can't degrade - a site asset, a data/blob URL, a local
 *  file's extracted art, an audio stream URL - passes through untouched. */
export function smallCoverUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (!degradable(url)) return url
  try {
    // buildCoverArtUrl's "full" variant already carries `size=1024` - size
    // wins over small on the API side, so that has to come out first or this
    // would silently stay at 1024px instead of actually degrading.
    const u = new URL(url)
    u.searchParams.delete('size')
    u.searchParams.set('small', '1')
    return u.toString()
  } catch {
    return `${url}&${SMALL_COVER_PARAM}`
  }
}

/** True when `url` has a cheaper degraded variant worth loading first - the
 *  signal ProgressiveCover uses to decide whether a two-step load buys anything. */
export function hasSmallCoverVariant(url: string | null | undefined): boolean {
  return !!url && degradable(url)
}

// ─── API file → track (for liking raw file-browser entries) ───────────────────
//
// Files browsed in ApiFilesView don't correspond to a numeric song id, so they
// can't go through the favorites API - they're liked purely locally, the same
// way locally-scanned library tracks are. The path is encoded directly into the
// track id so a liked entry can be reconstructed (e.g. in LikedSongsView)
// without re-fetching the folder it came from.
const API_FILE_ID_PREFIX = 'jw-file-'

// Each non-primary channel has its own file tree and those trees reuse the same
// paths ("Session Edits/..." exists in several), so the id has to carry the
// channel too - rebuilt from the path alone, a Legacy file streams against the
// primary tree and 404s. "//" can't occur in a browse path (no empty segments,
// never a leading slash), so it can't be forged by a real path. An id with no
// channel predates this and means the primary tree, which /files/ serves by
// default - leaving those untouched keeps likes made before this fix working.
const API_FILE_CHANNEL_SEP = '//'

/** The file a `jw-file-` track id points at: a path, plus the channel whose
 *  tree to resolve it against (absent for the primary one). */
export interface ApiFileRef {
  path: string
  channel?: string
}

export function apiFileTrackId(path: string, channel?: string): string {
  const prefix = channel ? `${channel}${API_FILE_CHANNEL_SEP}` : ''
  return `${API_FILE_ID_PREFIX}${prefix}${path}`
}

export function apiFileIdToRef(trackId: string): ApiFileRef | null {
  if (!trackId.startsWith(API_FILE_ID_PREFIX)) return null
  const rest = trackId.slice(API_FILE_ID_PREFIX.length)
  const sep = rest.indexOf(API_FILE_CHANNEL_SEP)
  if (sep <= 0) return { path: rest }
  const channel = rest.slice(0, sep)
  if (!/^[A-Za-z0-9_-]+$/.test(channel)) return { path: rest }
  return { path: rest.slice(sep + API_FILE_CHANNEL_SEP.length), channel }
}

export function apiFileRefToTrack(ref: ApiFileRef): Track {
  return apiFilePathToTrack(ref.path, undefined, ref.channel)
}

export function apiFilePathToTrack(path: string, name?: string, channel?: string): Track {
  const fileName = name ?? path.split('/').pop() ?? path
  const title = fileName.replace(/\.[^.]+$/, '')
  const slashIdx = path.lastIndexOf('/')
  const parent = slashIdx > 0 ? path.slice(0, slashIdx) : ''
  const album = parent.split('/').pop() ?? ''
  return {
    id: apiFileTrackId(path, channel),
    path,
    streamUrl: buildStreamUrl(path, channel),
    imageUrl: buildCoverArtUrl(path, false, channel),
    title,
    artist: 'Juice WRLD',
    album,
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: 0,
    genre: '',
    hasAlbumArt: true,
  }
}

// ─── Recording session ZIP lookup ──────────────────────────────────────────────
//
// "recording_session" songs have no `path` - the actual Pro Tools/Logic
// project is a pre-built .zip sitting elsewhere in the file tree (under
// "Studio Sessions/..."), not a single streamable audio file. There's no
// field on the song object that points at it directly, so this falls back to
// /files/browse/'s recursive `search` param (matched against the song's
// name/original_key) and picks out the .zip results.
export async function findSessionZips(song: JWApiSong): Promise<JWApiFileEntry[]> {
  const term = song.original_key || song.name
  if (!term) return []
  const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', { search: term })
  const entries = Array.isArray(data) ? data : (data?.items ?? [])
  const zips = entries.filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.zip'))
  if (zips.length <= 1) return zips

  // Same search term can turn up session zips for unrelated songs that
  // happen to share a prefix (e.g. "Money Hunt" vs "Money Hunt (with Dripface
  // Hottie)") - only auto-pick when exactly one candidate's name (stripped of
  // extension and any trailing parenthetical/bracket qualifier) matches the
  // song title exactly; otherwise let the caller show all candidates.
  const strip = (name: string): string => name.replace(/\.[^.]+$/, '').replace(/\s*[[(].*$/, '').trim().toLowerCase()
  const target = term.trim().toLowerCase()
  const exact = zips.filter(z => strip(z.name) === target)
  return exact.length === 1 ? exact : zips
}

export function buildImageUrl(imageUrl: string | null | undefined): string | undefined {
  // Songs with no cover set sometimes come back from the API with
  // `image_url` as the literal string "null" rather than JSON null (see
  // project_jwa_api_docs_drift) - falls through the falsy check below and
  // gets built into a real-looking but bogus "/null" URL otherwise, which the
  // API resolves to a placeholder that visibly reads "null".
  if (!imageUrl || imageUrl === 'null') return undefined
  if (imageUrl.startsWith('http') || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl
  // Relative path - ensure single leading slash
  const rel = imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl
  return `https://${JWAPI_HOST}${rel}`
}

/** Resolves a preference's `cover_url` - a user's chosen cover, pointing into
 *  the API's own storage - to a loadable URL.
 *
 *  Three forms are accepted, because a cover can plausibly be picked from
 *  either place the app already shows images from: an absolute/data URL passes
 *  through; a leading-slash path is a site-relative asset, the same shape a
 *  song's own `image_url` uses ("/assets/youtube.webp"); anything else is
 *  treated as a path into the file storage ApiFilesView browses and goes
 *  through the cover-art endpoint. Worth re-checking against the real column
 *  once /library/preferences/ ships - this is the one place that has to know. */
export function resolvePrefCoverUrl(coverUrl: string | null | undefined): string | undefined {
  if (!coverUrl) return undefined
  if (/^(https?:|data:|blob:)/.test(coverUrl)) return coverUrl
  if (coverUrl.startsWith('/')) return buildImageUrl(coverUrl)
  return buildCoverArtUrl(coverUrl)
}

// Discord's classic (local IPC) Rich Presence only reliably applies a
// `large_url` up to roughly this many characters - longer ones get silently
// ignored, leaving the static fallback logo. There's no way to shorten the
// query path itself, since /files/cover-art/ needs the song's exact path to
// resolve the file, so this gates whether we send the per-track cover at all
// rather than sending a truncated (and broken) one.
const DISCORD_RPC_URL_LIMIT = 256

/** Cover art URL for Discord RPC: prefers the curated `image_url`, and falls
 *  back to the file's own cover art by path - but only when that URL fits
 *  under Discord's length limit. Returns undefined (static logo) otherwise.
 *
 *  `path` must be a path into the API's file storage. Callers holding a
 *  locally-scanned track must pass null for it: a filesystem path would build
 *  a /files/cover-art/ URL the API can't resolve, and Discord shows an empty
 *  image slot (not the fallback logo) when the URL it was handed 404s. Use
 *  matchLocalSongCover below for those instead. */
export function discordCoverUrl(
  imageUrl: string | null | undefined,
  path: string | null | undefined
): string | undefined {
  const curated = buildImageUrl(imageUrl)
  if (curated) return curated
  if (!path) return undefined
  const url = buildCoverArtUrl(path)
  return url.length <= DISCORD_RPC_URL_LIMIT ? url : undefined
}

// ─── Local file → API song cover match ────────────────────────────────────────
//
// Discord resolves an activity's image server-side, through its own media
// proxy, so it can only ever display a publicly-reachable URL - a local file's
// embedded art (a base64 data URI on this machine) can't be handed to it at
// all. Since this library is Juice WRLD material, the way to give local files
// real cover art is to recognise which song the file *is* and borrow that
// song's hosted cover.

/** Reduces a title to a comparable core so a local file's tag/filename lines
 *  up with the API's song name: drops a file extension (titles that fell back
 *  to the filename) and a leading track number, then flattens
 *  punctuation/spacing to single spaces between lowercase alphanumerics. */
export function normalizeSongTitle(title: string): string {
  return stripFileTitleCruft(title)
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

/** As above, but also drops bracketed qualifiers ("(feat. X)", "[Prod. Y]",
 *  "(v1)"). Local tags and the API disagree constantly about these, so a loose
 *  comparison catches far more real matches - at the cost of collapsing a
 *  song's versions together, which is why it's only the fallback. */
function normalizeSongTitleLoose(title: string): string {
  return normalizeSongTitle(stripFileTitleCruft(title).replace(/[[(][^)\]]*[)\]]/g, ' '))
}

/** Drops the two things a local title picks up from being a file - a trailing
 *  extension (when the title fell back to the filename) and a leading track
 *  number ("01. ", "03 - ") - without touching the title itself. Applied
 *  before the API search too, so those artifacts don't end up in the query. */
function stripFileTitleCruft(title: string): string {
  return title
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^\s*\d{1,3}\s*[-._)]\s+/, '')
}

// Matches are memoized by normalized title, misses included - a local track
// that isn't in the API would otherwise re-search every time it plays, and the
// answer doesn't change within a session.
const localCoverMatches = new Map<string, LocalSongCover | null>()

export interface LocalSongCover {
  imageUrl: string
  era: string | null
}

/** Finds the API song a locally-scanned file corresponds to and returns its
 *  hosted cover (plus era, which Discord shows as the image tooltip), or null
 *  when there's no confident match.
 *
 *  Deliberately strict: a wrong cover on someone's status is worse than the
 *  fallback logo, so a candidate only counts when its name - or one of its
 *  `track_titles` aliases - normalizes to exactly the same string as the local
 *  title. The API's `search` is a loose substring match, so its top hit alone
 *  is not evidence of anything. An exact match is preferred over a loose one
 *  so a plain "Lucid Dreams" doesn't take the cover of the first alternate
 *  version the search happens to return. Artist is intentionally not compared:
 *  local tags are inconsistent ("Juice WRLD", "juicewrld", empty) while the
 *  whole library is one artist, so it would only cost matches. */
export async function matchLocalSongCover(title: string | null | undefined): Promise<LocalSongCover | null> {
  const wanted = normalizeSongTitle(title ?? '')
  if (!wanted) return null
  const cached = localCoverMatches.get(wanted)
  if (cached !== undefined) return cached

  const search = cleanTitleForSearch(stripFileTitleCruft(title ?? ''))
  if (!search) return null

  let result: LocalSongCover | null = null
  try {
    const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search, page_size: 10 })
    const results = data.results ?? []
    const namesOf = (s: JWApiSong): string[] => [s.name, ...(s.track_titles ?? [])]
    const wantedLoose = normalizeSongTitleLoose(title ?? '')
    const song =
      results.find((s) => namesOf(s).some((n) => normalizeSongTitle(n) === wanted)) ??
      results.find((s) => namesOf(s).some((n) => normalizeSongTitleLoose(n) === wantedLoose))
    if (song) {
      // Same order of preference as discordCoverUrl: the curated image, then
      // the song file's own embedded art via the API's cover-art endpoint.
      const curated = buildImageUrl(song.image_url)
      const byPath = song.path ? buildCoverArtUrl(song.path) : undefined
      const url = curated ?? (byPath && byPath.length <= DISCORD_RPC_URL_LIMIT ? byPath : undefined)
      if (url) result = { imageUrl: url, era: song.era?.name ?? null }
    }
  } catch {
    // Offline or API down - no cover this time. Not cached, so a later play
    // of the same track can still resolve it.
    return null
  }

  localCoverMatches.set(wanted, result)
  return result
}

/** Resolves a free-text song title (e.g. a line from an imported list) to the
 *  API song it names, or null when the API has nothing that matches. Uses the
 *  same strict exact→loose comparison as matchLocalSongCover: the API's
 *  `search` is a loose substring match, so its top hit is not proof of
 *  anything - a candidate only counts when its name or one of its
 *  `track_titles` aliases normalizes to the same string. Returning null (rather
 *  than a wrong guess) is what lets the importer report "not in the API".
 *
 *  'unsurfaced' and 'recording_session' songs are never returned - same
 *  exclusion as handleImportPlaylist/handleAddAllTo elsewhere in the app, since
 *  those categories aren't meant to be dropped into a normal playlist. A title
 *  that only matches one of those reports as "not found" rather than adding it. */
export async function resolveTitleToSong(title: string): Promise<JWApiSong | null> {
  const raw = (title ?? '').trim()
  const wanted = normalizeSongTitle(raw)
  if (!wanted) return null
  const search = cleanTitleForSearch(stripFileTitleCruft(raw))
  if (!search) return null
  try {
    const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search, page_size: 10 })
    const results = (data.results ?? []).filter((s) => !['unsurfaced', 'recording_session'].includes(s.category))
    const namesOf = (s: JWApiSong): string[] => [s.name, ...(s.track_titles ?? [])]
    const wantedLoose = normalizeSongTitleLoose(raw)
    return (
      results.find((s) => namesOf(s).some((n) => normalizeSongTitle(n) === wanted)) ??
      results.find((s) => namesOf(s).some((n) => normalizeSongTitleLoose(n) === wantedLoose)) ??
      null
    )
  } catch {
    return null
  }
}

/** Free-text song search for the chat `/search` command: unlike
 *  resolveTitleToSong this doesn't require an exact (or loose-exact) name
 *  match - it returns the API's own loose-substring results as-is (same
 *  unsurfaced/recording_session exclusion), so the caller can present a
 *  handful of candidates for a person to pick from. */
export async function searchSongs(title: string, limit = 8): Promise<JWApiSong[]> {
  const raw = (title ?? '').trim()
  if (!raw) return []
  const search = cleanTitleForSearch(stripFileTitleCruft(raw)) || raw
  try {
    const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search, page_size: limit })
    return (data.results ?? []).filter((s) => !['unsurfaced', 'recording_session'].includes(s.category)).slice(0, limit)
  } catch {
    return []
  }
}

/** Picks the best cover URL from a playlist summary or detail object.
 *  cover_image may contain a base64 data URI; cover_image_url may be a relative path. */
export function playlistCoverUrl(p: { cover_image_url?: string | null; cover_image?: string | null }): string | undefined {
  return buildImageUrl(p.cover_image_url ?? p.cover_image ?? undefined)
}

// ─── Duration parse ───────────────────────────────────────────────────────────

/** "3:59" → 239 seconds. Returns 0 on invalid input. */
export function parseDuration(length: string | null | undefined): number {
  if (!length) return 0
  const parts = length.split(':').map(Number)
  if (parts.length === 2) {
    const [m, s] = parts
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s
  }
  if (parts.length === 3) {
    const [h, m, s] = parts
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s
  }
  return 0
}

// ─── Convert API song to Track ────────────────────────────────────────────────

// A Track is what the app plays and displays, so this is where a user's
// per-song overrides get applied - every surface (queue, player, mini player,
// Discord RPC, lists built from Tracks) then picks them up for free. The
// canonical values stay on the Track as apiTitle/apiImageUrl.
//
// JWApiSong deliberately keeps the API's own data untouched: the editor views
// work from that shape, so an editor never sees another user's personal rename
// in a field they might propose upstream.
export function resolveSessionEditSource(song: { id: number; category: string; path: string; length: string }): { path: string; length: string; channel: string | undefined } {
  if (song.category !== 'recording_session') return { path: song.path, length: song.length, channel: undefined }
  const channel = peekActiveChannel()
  const override = peekSessionEditOverride(song.id, channel)
  if (override) return { path: override.path, length: override.duration ?? song.length, channel }
  if (song.path) return { path: song.path, length: song.length, channel }
  const link = peekSessionEditLink(song.id, channel)
  return link ? { path: link.path, length: link.duration ?? song.length, channel } : { path: song.path, length: song.length, channel: undefined }
}

export function songToTrack(song: JWApiSong): Track {
  const apiTitle = song.name
  const apiImageUrl = buildImageUrl(song.image_url)
  const pref = peekSongPref(song.id)
  // A user-set cover always wins; a rotated suggestion fills in next; an era
  // cover override fills in after that - and only for songs that aren't
  // released, since released songs have their own real art JWA already shows.
  const coverUrl = resolvePrefCoverUrl(pref?.cover_url)
    ?? peekRotatedCover(song.id)
    ?? (song.category !== 'released' ? resolvePrefCoverUrl(peekEraCover(song.era?.name)) : undefined)
  const { path: resolvedPath, length: resolvedLength, channel: streamChannel } = resolveSessionEditSource(song)
  return {
    id: `jw-${song.id}`,
    path: resolvedPath,
    streamUrl: buildStreamUrl(resolvedPath, streamChannel),
    imageUrl: coverUrl ?? apiImageUrl,
    title: pref?.name || apiTitle,
    apiTitle,
    apiImageUrl,
    artist: song.credited_artists || 'Juice WRLD',
    album: song.album || song.era?.name || '',
    era: song.era?.name || undefined,
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: parseDuration(resolvedLength),
    genre: song.category,
    hasAlbumArt: !!song.image_url || !!coverUrl,
  }
}

// ─── Category display ─────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<string, string> = {
  released: 'Released',
  unreleased: 'Unreleased',
  unsurfaced: 'Unsurfaced',
  recording_session: 'Session',
}

export const CATEGORY_COLORS: Record<string, string> = {
  released:          'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
  unreleased:        'text-blue-400   bg-blue-400/10   border-blue-400/25',
  unsurfaced:        'text-amber-400  bg-amber-400/10  border-amber-400/25',
  recording_session: 'text-purple-400 bg-purple-400/10 border-purple-400/25',
}
