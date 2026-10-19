// Field-qualified search syntax for the Tracker's search box, e.g.
// `artists:"Juice WRLD" love` — matches songs whose credited_artists field
// contains "Juice WRLD" AND whose free text (title/artist/producer/etc.)
// contains "love". Field tokens are stripped out of the query before it's
// sent to the API's `searchall` param (which has no concept of per-field
// search); the remaining free text still goes through the normal
// server-side search, while field filters are applied client-side — see
// ApiTrackerView's fetchAllMode, which this pushes field-filtered queries
// into (same as sort/multi-category search already does).
import { JWApiSong } from './juicewrldApi'
import { displaySongName } from './songPrefs'

export interface FieldFilter { field: string; label: string; value: string }

interface FieldDef {
  /** Every alias that resolves to this field, e.g. "artist" and "artists". */
  keys: string[]
  /** Canonical key shown in the info popover and used as the token's field name. */
  label: string
  get: (s: JWApiSong) => string
  /** Optional /songs/ fields `get` reads, so a bulk fetch with ?omit= keeps them. */
  api?: string[]
}

const FIELD_DEFS: FieldDef[] = [
  { keys: ['title', 'name', 'song'],                       label: 'title',      get: (s) => [displaySongName(s), s.name, ...(s.track_titles ?? [])].join(' ') },
  { keys: ['artist', 'artists'],                            label: 'artists',    get: (s) => s.credited_artists },
  { keys: ['producer', 'producers'],                        label: 'producers',  get: (s) => s.producers, api: ['producers'] },
  { keys: ['engineer', 'engineers'],                        label: 'engineers',  get: (s) => s.engineers ?? '', api: ['engineers'] },
  { keys: ['era'],                                          label: 'era',        get: (s) => s.era?.name ?? '' },
  { keys: ['category', 'cat'],                              label: 'category',   get: (s) => s.category },
  { keys: ['location', 'locations', 'studio'],              label: 'location',   get: (s) => s.recording_locations ?? '', api: ['recording_locations'] },
  { keys: ['date', 'dates', 'recorddate', 'recorddates'],   label: 'date',       get: (s) => s.record_dates ?? '', api: ['record_dates'] },
  { keys: ['leak', 'leaktype'],                             label: 'leak',       get: (s) => s.leak_type ?? '', api: ['leak_type'] },
  { keys: ['dateleaked'],                                   label: 'dateleaked', get: (s) => s.date_leaked ?? '', api: ['date_leaked'] },
  { keys: ['bitrate'],                                      label: 'bitrate',    get: (s) => s.bitrate ?? '', api: ['bitrate'] },
  { keys: ['release', 'releasedate'],                       label: 'release',    get: (s) => s.release_date ?? '', api: ['release_date'] },
  { keys: ['files', 'filenames', 'file'],                   label: 'files',      get: (s) => s.file_names ?? '', api: ['file_names'] },
  { keys: ['session', 'sessiontitle', 'sessiontitles'],     label: 'session',    get: (s) => s.session_titles ?? '', api: ['session_titles'] },
  { keys: ['notes'],                                        label: 'notes',      get: (s) => s.notes ?? '' },
  { keys: ['info', 'additional', 'additionalinfo'],         label: 'info',       get: (s) => s.additional_information ?? '', api: ['additional_information'] },
  { keys: ['instrumental', 'instrumentals'],                label: 'instrumental', get: (s) => [s.instrumentals, s.instrumental_names].filter(Boolean).join(' '), api: ['instrumentals', 'instrumental_names'] },
  { keys: ['album'],                                        label: 'album',      get: (s) => s.album ?? '' },
  { keys: ['key', 'originalkey'],                           label: 'key',        get: (s) => s.original_key ?? '', api: ['original_key'] },
]

const FIELD_LOOKUP = new Map<string, FieldDef>()
for (const def of FIELD_DEFS) for (const k of def.keys) FIELD_LOOKUP.set(k, def)

/** One row per distinct field (not per alias) for the info popover, in the
 *  same order they're defined above. */
export const SEARCH_FIELD_HELP: { field: string; example: string }[] = FIELD_DEFS.map((d) => ({
  field: d.label,
  example: `${d.label}:"${{
    title: 'Lucid Dreams', artists: 'Juice WRLD', producers: 'Nick Mira', engineers: 'Max Lord',
    era: 'goodbye & good riddance', category: 'unreleased', location: 'Record One', date: '2018',
    leak: 'cdq', dateleaked: '2020', bitrate: '320', release: '2018', files: '.wav', session: 'juice1',
    notes: 'snippet', info: 'reference', instrumental: 'yes', album: 'Legends Never Die', key: 'lucid',
  }[d.label] ?? 'value'}"`,
}))

// Matches `field:"quoted value"`, `field:'quoted value'`, or `field:bareword`.
// Unrecognized field names are left untouched in the free text (so a plain
// "5:30" or similar doesn't get silently eaten).
const TOKEN_RE = /([a-zA-Z_]+):(?:"([^"]*)"|'([^']*)'|(\S+))/g

// `&`/`&&` between field tokens is purely cosmetic — filters are already
// ANDed together with no operator needed (`artists:"X" producers:"Y"` and
// `artists:"X" & producers:"Y"` behave identically) — so once field tokens
// are stripped out, any standalone `&`/`&&` left over is dropped too rather
// than leaking into the free-text search sent to the server. Only matches
// when it's its own token (surrounded by whitespace/string edges) so a
// legitimate search like "R&B" is untouched.
const AND_OPERATOR_RE = /(?:^|\s)&{1,2}(?=\s|$)/g

export interface ParsedSearch { freeText: string; filters: FieldFilter[] }

export function parseSearchQuery(raw: string): ParsedSearch {
  const filters: FieldFilter[] = []
  const freeText = raw
    .replace(TOKEN_RE, (match, rawField: string, dq?: string, sq?: string, plain?: string) => {
      const def = FIELD_LOOKUP.get(rawField.toLowerCase())
      if (!def) return match
      const value = (dq ?? sq ?? plain ?? '').trim()
      if (!value) return ''
      filters.push({ field: rawField.toLowerCase(), label: def.label, value })
      return ''
    })
    .replace(AND_OPERATOR_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { freeText, filters }
}

// Apostrophe-insensitive substring match, mirroring compactGroups.ts's
// filterCompactGroups so `artists:"wouldnt"` still matches "Wouldn't".
function normalize(s: string): string {
  return s.replace(/['’‘]/g, '').toLowerCase()
}

/** The same apostrophe-insensitive substring test field filters use, for
 *  callers matching against something other than a JWApiSong (999 FM's
 *  library tracks). */
export function textMatches(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle))
}

/** Optional /songs/ fields the given filters read - see useTrackerOmit. */
export function filterApiFields(filters: FieldFilter[]): string[] {
  return filters.flatMap(({ field }) => FIELD_LOOKUP.get(field)?.api ?? [])
}

export function matchesFieldFilters(song: JWApiSong, filters: FieldFilter[]): boolean {
  return filters.every(({ field, value }) => {
    const def = FIELD_LOOKUP.get(field)
    if (!def) return true
    return textMatches(def.get(song), value)
  })
}

// Id lookup over the /songs/ catalogue (loadAllSongs), rebuilt only when the
// catalogue itself is refetched - for lists whose rows carry a song id but
// not the fields filters read (playlists, the queue, the tier list).
let byIdIndex: { list: JWApiSong[]; byId: Map<number, JWApiSong> } | null = null
export function songsById(list: JWApiSong[]): Map<number, JWApiSong> {
  if (byIdIndex?.list !== list) byIdIndex = { list, byId: new Map(list.map((s) => [s.id, s])) }
  return byIdIndex.byId
}
