import { CATEGORY_LABELS, parseDuration } from './juicewrldApi'
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

export function moveField(keys: TrackerFieldKey[], index: number, delta: -1 | 1): TrackerFieldKey[] {
  const to = index + delta
  if (to < 0 || to >= keys.length) return keys
  const out = [...keys]
  ;[out[index], out[to]] = [out[to], out[index]]
  return out
}
