import { useMemo, useRef } from 'react'
import { CATEGORY_LABELS, parseDuration, OMIT_BULK } from './juicewrldApi'
import type { JWApiSong } from './juicewrldApi'
import { eraLabel } from './eras'
import { formatDuration } from './format'

// ─── Customizable Tracker fields ──────────────────────────────────────────────
// The Detailed view's metadata grid and the List view's columns used to be a
// hardcoded set. Users can now hide fields, add others back, or swap one slot
// for a different field. Every displayable song field lives in this catalog;
// the per-view layouts are just ordered lists of its keys (persisted in the
// store), so a layout saved by an older/newer build with a key this build
// doesn't know is filtered out rather than crashing - see sanitizeFieldKeys.

export type TrackerFieldKey =
  | 'artist' | 'era' | 'category' | 'length'
  | 'producers' | 'engineers' | 'recording_locations' | 'record_dates'
  | 'leak_type' | 'date_leaked' | 'bitrate' | 'release_date' | 'preview_date'
  | 'dates' | 'file_names' | 'original_key' | 'session_titles' | 'alt_titles'
  | 'session_tracking' | 'instrumentals' | 'instrumental_names'
  | 'additional_information' | 'notes' | 'bpm' | 'musical_key' | 'album'

export interface TrackerField {
  key: TrackerFieldKey
  label: string
  /** Plain-text value for a song ('' when the song has none). */
  get: (song: JWApiSong, fullEraNames: boolean) => string
}

const str = (v: string | number | null | undefined): string => (v == null ? '' : String(v).trim())

export const TRACKER_FIELDS: TrackerField[] = [
  { key: 'artist', label: 'Artist', get: (s) => s.credited_artists || 'Juice WRLD' },
  { key: 'era', label: 'Era', get: (s, full) => (s.era?.name ? eraLabel(s.era.name, full) : '') },
  { key: 'category', label: 'Category', get: (s) => CATEGORY_LABELS[s.category] ?? s.category },
  { key: 'length', label: 'Time', get: (s) => formatDuration(parseDuration(s.length), '') },
  { key: 'producers', label: 'Producers', get: (s) => str(s.producers) },
  { key: 'engineers', label: 'Engineers', get: (s) => str(s.engineers) },
  { key: 'recording_locations', label: 'Recording Locations', get: (s) => str(s.recording_locations) },
  { key: 'record_dates', label: 'Record Dates', get: (s) => str(s.record_dates) },
  { key: 'leak_type', label: 'Leak Type', get: (s) => str(s.leak_type) },
  { key: 'date_leaked', label: 'Date Leaked', get: (s) => str(s.date_leaked) },
  { key: 'bitrate', label: 'Bitrate', get: (s) => str(s.bitrate) },
  { key: 'release_date', label: 'Release Date', get: (s) => str(s.release_date) },
  { key: 'preview_date', label: 'Preview Date', get: (s) => str(s.preview_date) },
  { key: 'dates', label: 'Dates', get: (s) => str(s.dates) },
  { key: 'file_names', label: 'File Names', get: (s) => str(s.file_names) },
  // `original_key` is the source-JSON key (a name), not a musical key.
  { key: 'original_key', label: 'Original Name', get: (s) => str(s.original_key) },
  { key: 'session_titles', label: 'Session Titles', get: (s) => str(s.session_titles) },
  { key: 'alt_titles', label: 'Alt Titles', get: (s) => (s.track_titles ?? []).join(' · ') },
  { key: 'session_tracking', label: 'Session Tracking', get: (s) => str(s.session_tracking) },
  { key: 'instrumentals', label: 'Instrumentals', get: (s) => str(s.instrumentals) },
  { key: 'instrumental_names', label: 'Instrumental Names', get: (s) => str(s.instrumental_names) },
  { key: 'additional_information', label: 'Additional Info', get: (s) => str(s.additional_information) },
  { key: 'notes', label: 'Notes', get: (s) => str(s.notes) },
  { key: 'bpm', label: 'BPM', get: (s) => str(s.bpm) },
  { key: 'musical_key', label: 'Key', get: (s) => str(s.key) },
  { key: 'album', label: 'Album', get: (s) => str(s.album) },
]

export const TRACKER_FIELD_MAP = new Map(TRACKER_FIELDS.map((f) => [f.key, f]))

/** The Detailed view's original fixed grid, in its original order. */
export const DEFAULT_DETAIL_FIELDS: TrackerFieldKey[] = [
  'producers', 'engineers', 'recording_locations', 'record_dates',
  'leak_type', 'date_leaked', 'bitrate', 'release_date',
  'file_names', 'original_key', 'session_titles', 'alt_titles',
]
/** The phone Detailed view's original 2-column subset. */
export const DEFAULT_MOBILE_DETAIL_FIELDS: TrackerFieldKey[] = [
  'producers', 'engineers', 'record_dates', 'leak_type', 'bitrate', 'original_key',
]
/** The List view's original columns (Title is fixed and not part of this). */
export const DEFAULT_LIST_COLUMNS: TrackerFieldKey[] = ['artist', 'era', 'category', 'length']

// Caps keep rows a sane height (detail grids) or the title column readable
// (list columns) - beyond these the layout stops working, not just looks busy.
export const MAX_DETAIL_FIELDS = 16
export const MAX_MOBILE_DETAIL_FIELDS = 10
export const MAX_LIST_COLUMNS = 6

export function sanitizeFieldKeys(keys: unknown, fallback: TrackerFieldKey[], max: number): TrackerFieldKey[] {
  if (!Array.isArray(keys)) return fallback
  const out: TrackerFieldKey[] = []
  for (const k of keys) {
    if (typeof k === 'string' && TRACKER_FIELD_MAP.has(k as TrackerFieldKey) && !out.includes(k as TrackerFieldKey)) {
      out.push(k as TrackerFieldKey)
    }
  }
  return out.slice(0, max)
}

/** Fields not currently in `keys`, in catalog order - the "add"/"replace with" choices. */
export function unusedFields(keys: TrackerFieldKey[]): TrackerField[] {
  return TRACKER_FIELDS.filter((f) => !keys.includes(f.key))
}

export function replaceField(keys: TrackerFieldKey[], index: number, next: TrackerFieldKey): TrackerFieldKey[] {
  if (keys.includes(next)) return keys
  return keys.map((k, i) => (i === index ? next : k))
}

export function removeField(keys: TrackerFieldKey[], index: number): TrackerFieldKey[] {
  return keys.filter((_, i) => i !== index)
}

/** Inserts `next` right after `index` (-1 appends at the end). */
export function insertField(keys: TrackerFieldKey[], index: number, next: TrackerFieldKey): TrackerFieldKey[] {
  if (keys.includes(next)) return keys
  const at = index < 0 ? keys.length : index + 1
  return [...keys.slice(0, at), next, ...keys.slice(at)]
}

/** Moves the field at `from` into slot `to` (drag-and-drop semantics: the
 *  dragged field lands where the drop target was, neighbours shift over). */
export function reorderField(keys: TrackerFieldKey[], from: number, to: number): TrackerFieldKey[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return keys
  const out = [...keys]
  const [k] = out.splice(from, 1)
  out.splice(to, 0, k)
  return out
}

// ─── Bulk-fetch field trimming ────────────────────────────────────────────────
// The Tracker's whole-catalogue fetches (sort/filter mode, select-all) can drop
// every display-only field the current view doesn't show, on top of OMIT_BULK.
// The core fields rows, sorting, playback and session-edit linking need (id,
// name, path, image_url, category, era, credited_artists, length, album,
// track_titles, ...) are never in this list, so they're always fetched.
// `notes` isn't here because the API doesn't return it on song rows at all.
export const OPTIONAL_SONG_FIELDS = [
  'producers', 'engineers', 'recording_locations', 'record_dates', 'leak_type',
  'date_leaked', 'bitrate', 'release_date', 'preview_date', 'dates', 'file_names',
  'original_key', 'session_titles', 'session_tracking', 'instrumentals',
  'instrumental_names', 'additional_information', 'bpm', 'key',
] as const

/** The optional API field(s) behind each Tracker field ([] = always fetched). */
const FIELD_API_KEYS: Record<TrackerFieldKey, string[]> = {
  artist: [], era: [], category: [], length: [], alt_titles: [], album: [],
  producers: ['producers'], engineers: ['engineers'], recording_locations: ['recording_locations'],
  record_dates: ['record_dates'], leak_type: ['leak_type'], date_leaked: ['date_leaked'],
  bitrate: ['bitrate'], release_date: ['release_date'], preview_date: ['preview_date'],
  dates: ['dates'], file_names: ['file_names'], original_key: ['original_key'],
  session_titles: ['session_titles'], session_tracking: ['session_tracking'],
  instrumentals: ['instrumentals'], instrumental_names: ['instrumental_names'],
  additional_information: ['additional_information'], notes: [], bpm: ['bpm'], musical_key: ['key'],
}

export function apiFieldsFor(keys: TrackerFieldKey[]): string[] {
  return keys.flatMap((k) => FIELD_API_KEYS[k] ?? [])
}

/** The `omit` value for a Tracker bulk fetch that has to carry `needed`.
 *  The kept set only ever grows for the life of the view: switching to a
 *  layout that shows fewer fields keeps what's already loaded instead of
 *  refetching, so only showing a field the last fetch dropped changes the
 *  value (and with it, triggers a refetch). */
export function useTrackerOmit(needed: string[]): string {
  const keep = useRef(new Set<string>())
  const key = [...new Set(needed)].sort().join(',')
  return useMemo(() => {
    for (const f of needed) keep.current.add(f)
    return [OMIT_BULK, ...OPTIONAL_SONG_FIELDS.filter((f) => !keep.current.has(f))].join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
