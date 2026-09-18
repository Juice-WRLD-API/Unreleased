import type { JWApiSong } from './juicewrldApi'

// Pure logic shared by ApiTrackerView.desktop.tsx and ApiTrackerView.mobile.tsx -
// verified byte-identical between the two before being pulled out here. The
// mobile view is a deliberate phone-first rewrite (different sort options,
// its own filter-sheet UI, no localStorage restore for category/era filters),
// so only the parts that were genuinely the same logic live here - the
// surrounding data-fetch/state wiring stays local to each view.

export type Category = 'released' | 'unreleased' | 'unsurfaced' | 'recording_session' | ''
export type ViewMode = 'list' | 'detail' | 'grid'
export type TrackerTab = 'songs' | 'lyrics' | 'calendar' | 'producers'
export const TRACKER_TABS: TrackerTab[] = ['songs', 'lyrics', 'calendar', 'producers']
export function isTrackerTab(v: string): v is TrackerTab {
  return (TRACKER_TABS as string[]).includes(v)
}

export const PAGE_SIZE = 50
export const LS_TRACKER_SEARCH = 'api-tracker:search'

// record_dates is free-text and occasionally yields a technically-valid but
// implausible match (e.g. a stray "1/2/03" fragment that isn't really a
// date). Juice WRLD's earliest known recordings are from the mid-2010s, so
// anything before this is almost certainly a parsing false-positive rather
// than a real recording date - treat it as invalid.
export const MIN_PLAUSIBLE_RECORD_YEAR = 2010

// The `q` URL param takes priority over the saved localStorage query so that
// following/reloading a link with a search in it (or navigating back to one)
// shows that search rather than whatever was last typed.
export function getInitialSearch(): string {
  if (window.location.protocol !== 'file:') {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) return q
  }
  return localStorage.getItem(LS_TRACKER_SEARCH) || ''
}

// ─── Era color palette (Calendar tab) ─────────────────────────────────────────
// Eras are dynamic (fetched from the API, not a fixed enum), so colors are
// assigned by index rather than hardcoded per name - same era always gets the
// same color as long as `eras` keeps returning them in the same order.
// Written as literal class names (not template-built) so Tailwind's static
// scanner picks them all up.
export interface EraColor { text: string; bg: string; border: string; dot: string }
export const ERA_COLOR_PALETTE: EraColor[] = [
  { text: 'text-rose-400',     bg: 'bg-rose-400/10',     border: 'border-rose-400/25',     dot: 'bg-rose-400' },
  { text: 'text-orange-400',   bg: 'bg-orange-400/10',   border: 'border-orange-400/25',   dot: 'bg-orange-400' },
  { text: 'text-amber-400',    bg: 'bg-amber-400/10',    border: 'border-amber-400/25',    dot: 'bg-amber-400' },
  { text: 'text-lime-400',     bg: 'bg-lime-400/10',     border: 'border-lime-400/25',      dot: 'bg-lime-400' },
  { text: 'text-emerald-400',  bg: 'bg-emerald-400/10',  border: 'border-emerald-400/25',  dot: 'bg-emerald-400' },
  { text: 'text-teal-400',     bg: 'bg-teal-400/10',     border: 'border-teal-400/25',     dot: 'bg-teal-400' },
  { text: 'text-cyan-400',     bg: 'bg-cyan-400/10',     border: 'border-cyan-400/25',     dot: 'bg-cyan-400' },
  { text: 'text-blue-400',     bg: 'bg-blue-400/10',     border: 'border-blue-400/25',     dot: 'bg-blue-400' },
  { text: 'text-indigo-400',   bg: 'bg-indigo-400/10',   border: 'border-indigo-400/25',   dot: 'bg-indigo-400' },
  { text: 'text-violet-400',   bg: 'bg-violet-400/10',   border: 'border-violet-400/25',   dot: 'bg-violet-400' },
  { text: 'text-fuchsia-400',  bg: 'bg-fuchsia-400/10',  border: 'border-fuchsia-400/25',  dot: 'bg-fuchsia-400' },
  { text: 'text-pink-400',     bg: 'bg-pink-400/10',     border: 'border-pink-400/25',     dot: 'bg-pink-400' },
]
export const DEFAULT_ERA_COLOR: EraColor = { text: 'text-text-muted', bg: 'bg-surface-overlay', border: 'border-[var(--border)]', dot: 'bg-text-muted' }

// A compact-view group bundles several versions of one song, each of which
// can sit in a different category - the group as a whole is labeled by
// whichever category ranks highest here (a released version anywhere in the
// group makes the whole group "Released", even if other versions are
// unreleased/session/unsurfaced; same logic cascades down the list).
export const GROUP_CATEGORY_PRIORITY: Category[] = ['released', 'unreleased', 'recording_session', 'unsurfaced']
export function groupCategory(members: { item: JWApiSong }[]): Category {
  const present = new Set(members.map(m => m.item.category as Category))
  return GROUP_CATEGORY_PRIORITY.find(c => present.has(c)) ?? 'unsurfaced'
}

export const SNIPPET_CONTEXT_CHARS = 70
// Finds where `query` occurs in `lyrics` and returns the surrounding text
// split into before/match/after so the caller can highlight just the match.
// The API's lyrics search may be more lenient than a plain substring match
// (e.g. punctuation/case normalization), so this falls back to locating just
// the first query word if the full phrase isn't found verbatim - better to
// show an approximate snippet than none at all.
export function getLyricSnippet(lyrics: string | null, query: string): { before: string; match: string; after: string } | null {
  const q = query.trim()
  if (!lyrics || !q) return null
  const lower = lyrics.toLowerCase()
  let idx = lower.indexOf(q.toLowerCase())
  let matchLen = q.length
  if (idx === -1) {
    const firstWord = q.split(/\s+/)[0]
    idx = firstWord ? lower.indexOf(firstWord.toLowerCase()) : -1
    matchLen = firstWord.length
  }
  if (idx === -1) return null
  const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS)
  const end = Math.min(lyrics.length, idx + matchLen + SNIPPET_CONTEXT_CHARS)
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
  return {
    before: (start > 0 ? '…' : '') + clean(lyrics.slice(start, idx)),
    match: lyrics.slice(idx, idx + matchLen),
    after: clean(lyrics.slice(idx + matchLen, end)) + (end < lyrics.length ? '…' : ''),
  }
}

// ─── Recording-date parsing (Calendar tab) ────────────────────────────────────
// `record_dates` is free-text (e.g. "5/5/18", "May 5, 2018", sometimes several
// dates for one song, sometimes just a year/season with no day at all) -
// there's no structured date field to key a calendar off of. These helpers
// pull out every exact (year, month, day) triple found in the text and
// silently drop anything too vague to place on a specific day, rather than
// guessing.
export const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}
const MONTH_NAME_RE = new RegExp(
  `\\b(${Object.keys(MONTH_MAP).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'
)

export function normalizeYear(y: number): number {
  if (y >= 100) return y
  return y <= 30 ? 2000 + y : 1900 + y
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (y < MIN_PLAUSIBLE_RECORD_YEAR || y > new Date().getFullYear()) return false
  if (m < 0 || m > 11 || d < 1 || d > 31) return false
  const dt = new Date(y, m, d)
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d
}

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function extractDateKeys(text: string | null | undefined): string[] {
  if (!text) return []
  const keys = new Set<string>()

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const y = +m[1], mo = +m[2] - 1, d = +m[3]
    if (isValidYMD(y, mo, d)) keys.add(dateKey(y, mo, d))
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const mo = +m[1] - 1, d = +m[2], y = normalizeYear(+m[3])
    if (isValidYMD(y, mo, d)) keys.add(dateKey(y, mo, d))
  }
  for (const m of text.matchAll(MONTH_NAME_RE)) {
    const mo = MONTH_MAP[m[1].toLowerCase()]
    const d = +m[2], y = +m[3]
    if (mo !== undefined && isValidYMD(y, mo, d)) keys.add(dateKey(y, mo, d))
  }

  return [...keys]
}

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// One 7-wide grid of the given month, padded with nulls so every week is a
// full row (including leading/trailing days from adjacent months).
export function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const startDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
