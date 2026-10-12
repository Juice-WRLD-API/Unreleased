// Aggregation behind the Wrapped / listening-stats page.
//
// The only listening data the app keeps is lib/songPrefs' per-song `playcount`
// - a running total with no timestamps, so everything here is necessarily
// all-time. There is no play log to slice by year or month; if period-bounded
// stats are ever wanted, a timestamped event log has to be recorded first.
//
// Deliberately pure: lib/statsCatalog owns resolving ids to song metadata,
// this module just joins those against the prefs and ranks them. That keeps
// the (fiddly) share/percentage math testable without a network or a store.

import { parseDuration, CATEGORY_LABELS } from './juicewrldApi'
import { SongPreference } from './songPrefs'
import type { StatsSong } from './statsCatalog'
import {
  ListeningPlayEvent, filterListeningPlaysByDays, playcountsFromEvents,
  listeningPlaysCoverageStart, coversPeriod,
} from './listeningPlays'

export type ListeningPeriod = 'all' | '7' | '30'

/** One played song, joined with how many times this user played it. */
export interface PlayedSong {
  song: StatsSong
  playcount: number
  /** playcount × the song's own length. 0 when the API has no length. */
  seconds: number
}

/** A row in one of the breakdown lists (eras, categories, producers…). */
export interface RankedEntry {
  /** Stable identity for React keys - the raw value before display mapping. */
  key: string
  label: string
  plays: number
  /** How many distinct songs contributed, so "1 song, 40 plays" is visible. */
  songs: number
  /** Share of the list's total plays, 0–1. */
  share: number
}

export interface ListeningStats {
  /** Every played song, most-played first. */
  played: PlayedSong[]
  totalPlays: number
  distinctSongs: number
  totalSeconds: number
  eras: RankedEntry[]
  categories: RankedEntry[]
  producers: RankedEntry[]
  /** Credited artists other than Juice WRLD himself - i.e. features. */
  collaborators: RankedEntry[]
}

// Credit strings are free text ("Nick Mira, Sidepce & Charlie Handsome"), so
// split on the separators that actually appear and leave everything else
// intact - an aggressive split would shred names that legitimately contain
// "x" or "and".
const CREDIT_SEPARATORS = /\s*(?:,|&|\/|;)\s*/
const CREDIT_PREFIX = /^(?:feat\.?|ft\.?|featuring|prod\.?(?:\s+by)?)\s+/i

/** "Nick Mira, Sidepce" → ["Nick Mira", "Sidepce"]. Empty for null/blank. */
export function splitCredits(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(CREDIT_SEPARATORS)) {
    const name = part.replace(CREDIT_PREFIX, '').trim()
    if (!name) continue
    // Within a single song, "Nick Mira & Nick Mira" shouldn't double-count.
    const dedupe = name.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push(name)
  }
  return out
}

const JUICE = /^juice\s*wrld$/i

/** Aggregates plays by an arbitrary key extracted per song. `keyOf` returns
 *  zero or more keys - a song with three producers counts once for each. */
function rank(
  played: PlayedSong[],
  keyOf: (song: StatsSong) => { key: string; label: string }[],
): RankedEntry[] {
  const acc = new Map<string, { label: string; plays: number; songs: number }>()
  let total = 0
  for (const { song, playcount } of played) {
    for (const { key, label } of keyOf(song)) {
      const cur = acc.get(key)
      if (cur) {
        cur.plays += playcount
        cur.songs += 1
      } else {
        acc.set(key, { label, plays: playcount, songs: 1 })
      }
      total += playcount
    }
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, label: v.label, plays: v.plays, songs: v.songs, share: total > 0 ? v.plays / total : 0 }))
    // Alphabetical tie-break keeps the order stable across renders when two
    // entries have identical play counts.
    .sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label))
}

export function buildListeningStats(played: PlayedSong[]): ListeningStats {
  let totalPlays = 0
  let totalSeconds = 0
  for (const p of played) {
    totalPlays += p.playcount
    totalSeconds += p.seconds
  }

  return {
    played,
    totalPlays,
    distinctSongs: played.length,
    totalSeconds,
    eras: rank(played, (s) => (s.era?.name ? [{ key: s.era.name, label: s.era.name }] : [])),
    categories: rank(played, (s) => (s.category ? [{ key: s.category, label: CATEGORY_LABELS[s.category] ?? s.category }] : [])),
    producers: rank(played, (s) => splitCredits(s.producers).map((n) => ({ key: n.toLowerCase(), label: n }))),
    collaborators: rank(played, (s) =>
      splitCredits(s.credited_artists)
        .filter((n) => !JUICE.test(n))
        .map((n) => ({ key: n.toLowerCase(), label: n })),
    ),
  }
}

/** Joins fetched songs onto their play counts, dropping ids whose song
 *  couldn't be loaded (deleted upstream, or the request failed). */
export function joinPlayedSongs(
  prefs: SongPreference[],
  songs: Map<number, StatsSong>,
): PlayedSong[] {
  const out: PlayedSong[] = []
  for (const p of prefs) {
    const song = songs.get(p.song)
    if (!song) continue
    out.push({ song, playcount: p.playcount, seconds: parseDuration(song.length) * p.playcount })
  }
  return out.sort((a, b) => b.playcount - a.playcount)
}

/** Days in a period, or 0 for "all time". */
export function periodDays(period: ListeningPeriod): number {
  return period === 'all' ? 0 : Number(period)
}

/** Whether the timestamped log actually reaches back far enough to cover the
 *  selected period - it starts later than "all time" implies and gets evicted
 *  from the back once it hits its cap, so a window can ask for more history
 *  than exists. The caller gets `complete: false` plus the date the log
 *  actually starts, and labels the period accordingly rather than silently
 *  under-reporting. */
export interface PeriodCoverage {
  complete: boolean
  start: number | null
}

export function periodCoverage(events: ListeningPlayEvent[], period: ListeningPeriod): PeriodCoverage {
  return {
    complete: coversPeriod(events, periodDays(period)),
    start: listeningPlaysCoverageStart(events),
  }
}

export function prefsFromEvents(events: ListeningPlayEvent[]): SongPreference[] {
  const counts = playcountsFromEvents(events)
  return [...counts.entries()]
    .map(([song, playcount]) => ({
      song,
      playcount,
      name: null,
      cover_url: null,
      default_version: null,
      excluded_versions: [],
    }))
    .sort((a, b) => b.playcount - a.playcount)
}

export function eventsForPeriod(events: ListeningPlayEvent[], period: ListeningPeriod): ListeningPlayEvent[] {
  if (period === 'all') return events
  return filterListeningPlaysByDays(events, Number(period))
}

export function prefsForPeriod(
  events: ListeningPlayEvent[],
  period: ListeningPeriod,
): SongPreference[] {
  return prefsFromEvents(eventsForPeriod(events, period))
}

/** Seconds → "3 days 4 hr" / "6 hr 12 min" / "45 min". Distinct from
 *  format.ts' formatTotalDuration, which stops at hours - a heavy listener's
 *  all-time total runs to hundreds of hours, where days read better. */
export function formatListeningTime(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return '0 min'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ${hours} hr`
  if (hours > 0) return `${hours} hr ${mins} min`
  return `${mins} min`
}
