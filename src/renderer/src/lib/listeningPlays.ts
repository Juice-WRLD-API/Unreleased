// Timestamped play history - one row per credited play, kept alongside the
// aggregate per-song counts in lib/songPrefs (which predate this and stay the
// source of truth for all-time numbers).
//
// The whole array is PATCHed to the profile blob on every play (there's no
// append endpoint), and it also lives in localStorage, so the cap is a payload
// budget, not a storage one: at ~45 bytes a row, 2000 rows is ~90 KB per push.
// lib/songPrefs caps at 500 for the same reason. Raising this raises the cost
// of every single credited play.
export interface ListeningPlayEvent {
  song: number
  played_at: string
}

export const SERVER_LISTENING_PLAYS_LIMIT = 2000

export function normalizeListeningPlayEvent(raw: unknown): ListeningPlayEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const song = Number(row.song)
  const played_at = typeof row.played_at === 'string' ? row.played_at.trim() : ''
  if (!Number.isFinite(song) || song <= 0 || !played_at) return null
  return { song, played_at }
}

/** Sort key - parsed, not the raw string. Local rows are always
 *  `toISOString()` (UTC, milliseconds), but rows coming back from the server
 *  may be rendered in another shape ("+00:00" instead of "Z", microseconds),
 *  and lexical order across mixed shapes is wrong. */
function timeOf(event: ListeningPlayEvent): number {
  const ts = Date.parse(event.played_at)
  return Number.isFinite(ts) ? ts : 0
}

function newestFirst(a: ListeningPlayEvent, b: ListeningPlayEvent): number {
  return timeOf(b) - timeOf(a)
}

export function capListeningPlays(events: ListeningPlayEvent[], max = SERVER_LISTENING_PLAYS_LIMIT): ListeningPlayEvent[] {
  if (events.length <= max) return events
  return [...events].sort(newestFirst).slice(0, max)
}

/** Union of this device's rows and the profile's, newest first. Dedupes on
 *  (song, parsed timestamp) rather than the literal string - see timeOf: a
 *  server that reformats timestamps would otherwise duplicate the entire
 *  history on every login until the cap swallowed it. */
export function mergeListeningPlays(local: ListeningPlayEvent[], server: ListeningPlayEvent[]): ListeningPlayEvent[] {
  const seen = new Set<string>()
  const out: ListeningPlayEvent[] = []
  for (const event of [...local, ...server].sort(newestFirst)) {
    const key = `${event.song}\0${timeOf(event)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(event)
  }
  return capListeningPlays(out)
}

export function appendListeningPlay(events: ListeningPlayEvent[], songId: number, at = new Date()): ListeningPlayEvent[] {
  const next = [{ song: songId, played_at: at.toISOString() }, ...events]
  return capListeningPlays(next)
}

export function filterListeningPlaysByDays(events: ListeningPlayEvent[], days: number): ListeningPlayEvent[] {
  if (days <= 0) return events
  const cutoff = Date.now() - days * 86400000
  return events.filter((event) => {
    const ts = Date.parse(event.played_at)
    return Number.isFinite(ts) && ts >= cutoff
  })
}

export function playcountsFromEvents(events: ListeningPlayEvent[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const event of events) {
    counts.set(event.song, (counts.get(event.song) ?? 0) + 1)
  }
  return counts
}

export function sortListeningPlays(events: ListeningPlayEvent[]): ListeningPlayEvent[] {
  return [...events].sort(newestFirst)
}

/** Epoch ms of the oldest logged play - the point before which a period view
 *  has nothing to say. null when the log is empty.
 *
 *  Two separate things move this forward: the log only exists from the build
 *  that shipped it, and the cap evicts the oldest rows once a heavy listener
 *  passes SERVER_LISTENING_PLAYS_LIMIT. Callers don't need to tell those
 *  apart - either way, a window that starts earlier than this is incomplete
 *  and has to be labelled as such. */
export function listeningPlaysCoverageStart(events: ListeningPlayEvent[]): number | null {
  let oldest: number | null = null
  for (const event of events) {
    const ts = Date.parse(event.played_at)
    if (!Number.isFinite(ts)) continue
    if (oldest === null || ts < oldest) oldest = ts
  }
  return oldest
}

/** Whether the log actually reaches back far enough to answer a window of
 *  `days`. `days <= 0` means "all time", which the aggregate counters always
 *  cover. */
export function coversPeriod(events: ListeningPlayEvent[], days: number): boolean {
  if (days <= 0) return true
  const start = listeningPlaysCoverageStart(events)
  return start !== null && start <= Date.now() - days * 86400000
}
