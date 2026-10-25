import { loadAllSongs, normalizeForSearch, type JWApiSong } from './juicewrldApi'
import { MIN_PLAUSIBLE_RECORD_YEAR } from './apiTrackerShared'

// "On this day": what happened in the catalogue on one calendar day in past
// years - songs recorded, first previewed, surfaced or released that day.
//
// The five date fields are free text, one or more labelled dates each:
// "Recorded\nAugust 1-2, 2016.", "Juice's Vocals\nMay 5, 2018.\nFile
// Exported\nJune 24, 2021.", "Surfaced January 25th 2026". Every exact date is
// read together with the words in front of it, and those words decide what
// kind of event it was; the field's own meaning only fills in when there are
// none. Dates without a day ("July [?], 2016") are skipped rather than guessed.

export type DayEventKind = 'recorded' | 'previewed' | 'surfaced' | 'released'

/** Order within a year: a song's life, studio to release. */
export const DAY_EVENT_KINDS: DayEventKind[] = ['recorded', 'previewed', 'surfaced', 'released']

export const DAY_EVENT_LABELS: Record<DayEventKind, string> = {
  recorded: 'Recorded', previewed: 'Previewed', surfaced: 'Surfaced', released: 'Released',
}

export interface SongDate {
  kind: DayEventKind
  year: number
  /** 1-12 */
  month: number
  day: number
  /** The words in front of the date, e.g. "Juice's Vocals". May be empty. */
  label: string
}

const DATE_FIELDS: { get: (s: JWApiSong) => string | null | undefined; kind: DayEventKind | null }[] = [
  { get: (s) => s.record_dates, kind: 'recorded' },
  { get: (s) => s.preview_date, kind: 'previewed' },
  { get: (s) => s.date_leaked, kind: 'surfaced' },
  { get: (s) => s.release_date, kind: 'released' },
  // Mixed notes ("Reissued …", "Resurfaced …"): only a label says what each is.
  { get: (s) => s.dates, kind: null },
]

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH = `(${MONTHS.join('|')})`
const ORD = '(?:st|nd|rd|th)?'
// [Month D - ]Month D[-D][,] YYYY. The leading "Month D -" is a range that
// crosses into the next month ("March 31 - April 1, 2018").
const DATE_RE = new RegExp(`(?:${MONTH}\\s+(\\d{1,2})${ORD}\\s*-\\s*)?${MONTH}\\s+(\\d{1,2})${ORD}(?:\\s*-\\s*(\\d{1,2})${ORD})?(?:,\\s*|\\s+)(\\d{4})`, 'gi')
// Sessions run a day or two. A longer range is a vague span, not session days.
const MAX_RANGE_DAYS = 7
const DAY_MS = 86_400_000

function kindOf(label: string, fallback: DayEventKind | null): DayEventKind | null {
  const l = label.toLowerCase()
  if (l.includes('export')) return null // a file bounced later, not a moment in the song's story
  if (l.includes('faced')) return 'surfaced' // surfaced, resurfaced, and the odd "resufaced"
  if (/teas|teax|preview/.test(l)) return 'previewed'
  if (/releas|reissu/.test(l)) return 'released'
  if (l.includes('record')) return 'recorded'
  return fallback
}

const cleanLabel = (s: string): string => s
  .replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '')
  .replace(/\s*(?:recorded\s+)?on$/i, '')
  .replace(/\s+/g, ' ')

const datesCache = new WeakMap<JWApiSong, SongDate[]>()

/** Every exact date in a song's date fields, one per day (a range gives each of its days). */
export function songDates(song: JWApiSong): SongDate[] {
  const hit = datesCache.get(song)
  if (hit) return hit
  const out: SongDate[] = []
  for (const field of DATE_FIELDS) {
    const text = field.get(song)
    if (!text || text === 'null') continue
    let last = 0
    for (const m of text.matchAll(DATE_RE)) {
      const label = cleanLabel(text.slice(last, m.index))
      last = (m.index ?? 0) + m[0].length
      const kind = kindOf(label, field.kind)
      const year = Number(m[6])
      if (!kind || year < MIN_PLAUSIBLE_RECORD_YEAR) continue
      const endMonth = MONTHS.indexOf(m[3].toLowerCase())
      const startMonth = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : endMonth
      const startDay = Number(m[1] ? m[2] : m[4])
      const endDay = Number(m[1] ? m[4] : (m[5] ?? m[4]))
      const start = new Date(year, startMonth, startDay)
      const end = new Date(year, endMonth, endDay)
      // Date rolls "February 30" over into March - a typo, not a day.
      if (start.getDate() !== startDay || end.getDate() !== endDay) continue
      const span = Math.round((end.getTime() - start.getTime()) / DAY_MS)
      if (span < 0 || span >= MAX_RANGE_DAYS) continue
      for (let i = 0; i <= span; i++) {
        const d = new Date(year, startMonth, startDay + i)
        out.push({ kind, year, month: d.getMonth() + 1, day: d.getDate(), label })
      }
    }
  }
  datesCache.set(song, out)
  return out
}

export interface DayEntry {
  kind: DayEventKind
  /** The song's name without its version tag: versions of one song share an entry. */
  title: string
  /** Every row with this event that day (versions of the song, its session),
   *  ones with audio first - `songs[0]` is the one an entry plays. */
  songs: JWApiSong[]
  /** The words in front of each date, e.g. "Juice's Vocals". */
  labels: string[]
}

export interface DayYear {
  year: number
  entries: DayEntry[]
}

const VERSION_TAG = /\s*[([]v\d+[)\]]\s*$/i
export const baseTitle = (name: string): string => name.replace(VERSION_TAG, '').trim() || name

export const hasAudio = (song: JWApiSong): boolean => !!song.path
const isSession = (song: JWApiSong): boolean => song.category === 'recording_session'

const songOrder = (a: JWApiSong, b: JWApiSong): number =>
  Number(hasAudio(b)) - Number(hasAudio(a))
  || Number(isSession(a)) - Number(isSession(b))
  || a.name.localeCompare(b.name, undefined, { numeric: true })

/** What happened on `month`/`day` (month 1-12) in each past year, newest year first. */
export function eventsOnDay(songs: JWApiSong[], month: number, day: number, now = new Date()): DayYear[] {
  const entries = new Map<string, DayEntry & { year: number }>()
  for (const song of songs) {
    for (const d of songDates(song)) {
      if (d.month !== month || d.day !== day || new Date(d.year, month - 1, day) > now) continue
      const title = baseTitle(song.name)
      const key = `${d.year}|${d.kind}|${normalizeForSearch(title)}`
      let entry = entries.get(key)
      if (!entry) entries.set(key, entry = { year: d.year, kind: d.kind, title, songs: [], labels: [] })
      if (!entry.songs.includes(song)) entry.songs.push(song)
      if (d.label && !entry.labels.includes(d.label)) entry.labels.push(d.label)
    }
  }
  const years = new Map<number, DayEntry[]>()
  for (const { year, ...entry } of entries.values()) {
    entry.songs.sort(songOrder)
    if (!years.has(year)) years.set(year, [])
    years.get(year)!.push(entry)
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({
      year,
      entries: list.sort((a, b) => DAY_EVENT_KINDS.indexOf(a.kind) - DAY_EVENT_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title)),
    }))
}

/** The day as a queue: each entry's song with audio, oldest year first, each song once. */
export function dayQueue(years: DayYear[]): JWApiSong[] {
  const seen = new Set<number>()
  const out: JWApiSong[] = []
  for (const { entries } of [...years].reverse()) {
    for (const { songs: [song] } of entries) {
      if (hasAudio(song) && !seen.has(song.id)) { seen.add(song.id); out.push(song) }
    }
  }
  return out
}

export function yearsAgo(year: number, now = new Date()): string {
  const n = now.getFullYear() - year
  return n <= 0 ? 'today' : n === 1 ? 'a year ago today' : `${n} years ago today`
}

/** A year heading's "8 years ago". `isToday` false: a picked day earlier this year. */
export function yearsSince(year: number, isToday: boolean, now = new Date()): string {
  const n = now.getFullYear() - year
  if (n <= 0) return isToday ? 'today' : 'this year'
  return n === 1 ? '1 year ago' : `${n} years ago`
}

function titleList(titles: string[]): string {
  if (titles.length <= 3) return titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}` : titles[0]
  return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`
}

// "Herbo's Vocals" is someone else's part of the song; "Juice's Vocals",
// "Second Verse" and a bare "Recorded" are his.
const isJuicesPart = (label: string): boolean => !/\w['’]/.test(label) || /juice/i.test(label)

/** One sentence for the top of the card. Juice in the studio leads when he
 *  was there that day; otherwise the most recent year's news does. `isToday`
 *  false (a day picked from the calendar) says "in 2018" instead of "8 years
 *  ago today". */
export function dayHeadline(years: DayYear[], isToday = true, now = new Date()): string | null {
  const whenOf = (year: number): string => (isToday ? yearsAgo(year, now) : `in ${year}`)
  for (const { year, entries } of years) {
    const his = entries.filter((e) => e.kind === 'recorded' && (e.labels.length === 0 || e.labels.some(isJuicesPart)))
    if (his.length) {
      const when = whenOf(year)
      return `${when[0].toUpperCase()}${when.slice(1)}, Juice recorded ${titleList(his.map((e) => e.title))}.`
    }
  }
  const latest = years[0]
  if (!latest) return null
  const kind = (['released', 'surfaced', 'previewed', 'recorded'] as DayEventKind[]).find((k) => latest.entries.some((e) => e.kind === k))!
  const titles = latest.entries.filter((e) => e.kind === kind).map((e) => e.title)
  const when = whenOf(latest.year)
  const verb = { released: 'came out', surfaced: 'surfaced', previewed: titles.length > 1 ? 'were first previewed' : 'was first previewed', recorded: titles.length > 1 ? 'were recorded' : 'was recorded' }[kind]
  return `${titleList(titles)} ${verb} ${when}.`
}

/** A quiet line for the two days that are about him, not the music. */
export function dayNote(month: number, day: number): string | null {
  if (month === 12 && day === 2) return 'Juice WRLD was born on this day in 1998.'
  if (month === 12 && day === 8) return 'Juice WRLD passed away on this day in 2019.'
  return null
}

// ─── Loading ──────────────────────────────────────────────────────────────────
// The whole catalogue (~3.5 MB) is too big for the offline cache and too slow
// to wait for on the landing page, so the rows for today alone (a few KB, up
// to ~150 KB on the busiest day) are kept for the next visit to paint from.

const CACHE_KEY = 'unreleased:onthisday'
const pad = (n: number): string => String(n).padStart(2, '0')
const dayKey = (month: number, day: number): string => `${pad(month)}-${pad(day)}`

export function peekDaySongs(month: number, day: number): { songs: JWApiSong[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as { day: string; ts: number; songs: JWApiSong[] }
    return cached.day === dayKey(month, day) && Array.isArray(cached.songs) ? { songs: cached.songs, ts: cached.ts } : null
  } catch {
    return null
  }
}

/** The catalogue rows with something on `month`/`day`. Today's are kept for the next visit. */
export async function loadDaySongs(month: number, day: number, now = new Date()): Promise<JWApiSong[]> {
  const all = await loadAllSongs()
  const songs = all.filter((s) => songDates(s).some((d) => d.month === month && d.day === day))
  if (month === now.getMonth() + 1 && day === now.getDate()) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ day: dayKey(month, day), ts: Date.now(), songs })) } catch {}
  }
  return songs
}
