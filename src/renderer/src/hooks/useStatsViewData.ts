// Shared data/logic for "Your Wrapped" (StatsView). Desktop and mobile wrap
// this in their own layout - see each file's header comment for how the
// underlying listening log works. The one thing that stays local per view is
// how "open song info" is implemented: desktop sets the global infoSongId,
// mobile fetches into its own SongInfoModal state.
import { useEffect, useMemo, useState } from 'react'
import { useStorePick } from '../store/useStore'
import {
  joinPlayedSongs, buildListeningStats,
  prefsForPeriod, eventsForPeriod, periodCoverage, type ListeningPeriod,
} from '../lib/listeningStats'
import { resolveStatsSongs, statsSongToTrack, type StatsSong, type ResolveProgress } from '../lib/statsCatalog'
import { sortListeningPlays } from '../lib/listeningPlays'
import { shortDate } from '../components/adminShared'
import type { SongContextMenuState } from '../components/SongContextMenu'

// Rows shown before "Show all" - a heavy listener can have hundreds.
export const TOP_SONGS_COLLAPSED = 25

// How many songs the header's Play button queues up.
export const PLAY_TOP_N = 50

// Rows in the recent-plays timeline. Also bounds how many extra song ids the
// timeline alone can drag into the metadata fetch (see idsKey).
export const TIMELINE_LIMIT = 40

export const PERIOD_OPTIONS: { id: ListeningPeriod; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '30', label: '30 days' },
  { id: '7', label: '7 days' },
]

export function useStatsViewData(): {
  listeningPlays: ReturnType<typeof useStorePick>['listeningPlays']
  account: ReturnType<typeof useStorePick>['account']
  playTrack: ReturnType<typeof useStorePick>['playTrack']
  playCollection: ReturnType<typeof useStorePick>['playCollection']
  playNext: ReturnType<typeof useStorePick>['playNext']
  period: ListeningPeriod
  setPeriod: (p: ListeningPeriod) => void
  songs: Map<number, StatsSong>
  loading: boolean
  progress: ResolveProgress | null
  expanded: boolean
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>
  ctxMenu: SongContextMenuState | null
  setCtxMenu: React.Dispatch<React.SetStateAction<SongContextMenuState | null>>
  prefs: ReturnType<typeof prefsForPeriod>
  periodEvents: ReturnType<typeof eventsForPeriod>
  periodLabel: string
  stats: ReturnType<typeof buildListeningStats>
  topTracks: ReturnType<typeof statsSongToTrack>[]
  visible: ReturnType<typeof buildListeningStats>['played']
  topPlays: number
  nothingEverPlayed: boolean
} {
  const { listeningPlays, account, playTrack, playCollection, playNext } = useStorePick(
    'listeningPlays', 'account', 'playTrack', 'playCollection', 'playNext')

  const [period, setPeriod] = useState<ListeningPeriod>('all')
  const [songs, setSongs] = useState<Map<number, StatsSong>>(new Map())
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<ResolveProgress | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)

  const prefs = useMemo(() => prefsForPeriod(listeningPlays, period), [listeningPlays, period])
  const periodEvents = useMemo(() => sortListeningPlays(eventsForPeriod(listeningPlays, period)), [listeningPlays, period])
  const coverage = useMemo(
    () => periodCoverage(listeningPlays, period),
    [listeningPlays, period],
  )
  const optionLabel = PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? 'All time'
  // A window the log can't fill is named for what it actually holds.
  const periodLabel = coverage.complete || coverage.start === null
    ? optionLabel
    : `Since ${shortDate(new Date(coverage.start).toISOString())}`

  // Only the *set* of played ids drives fetching. Crediting a play while this
  // page is open bumps a count (and the numbers below re-derive from it), but
  // it must not re-run a few hundred requests - the metadata didn't change.
  const idsKey = useMemo(() => {
    const ids = new Set<number>()
    for (const p of prefs) ids.add(p.song)
    for (const e of periodEvents.slice(0, TIMELINE_LIMIT)) ids.add(e.song)
    return [...ids].sort((a, b) => a - b).join(',')
  }, [prefs, periodEvents])

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',').map(Number) : []
    if (ids.length === 0) { setSongs(new Map()); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setProgress(null)

    resolveStatsSongs(
      ids,
      (p) => { if (!cancelled) setProgress(p) },
      () => cancelled,
    ).then((resolved) => {
      if (cancelled) return
      // One state update at the end rather than per response - incremental
      // ones would re-rank and re-render the whole page hundreds of times.
      setSongs(resolved)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [idsKey])

  const stats = useMemo(() => buildListeningStats(joinPlayedSongs(prefs, songs)), [prefs, songs])

  // Tracks are rebuilt from the API songs so personal name/cover overrides and
  // the correct stream URL come along (songToTrack applies both).
  const topTracks = useMemo(() => stats.played.map((p) => statsSongToTrack(p.song)), [stats.played])

  const visible = expanded ? stats.played : stats.played.slice(0, TOP_SONGS_COLLAPSED)
  const topPlays = stats.played[0]?.playcount ?? 0

  // Bail to the empty screen only when the user has never played anything.
  // A *period* with no plays still renders the full page (the period switcher
  // included) - otherwise picking "7 days" on a quiet week, or right after
  // upgrading to a build that has a play log at all, strands the user on a
  // dead-end screen with no way back to All time.
  const nothingEverPlayed = listeningPlays.length === 0

  return {
    listeningPlays, account, playTrack, playCollection, playNext,
    period, setPeriod, songs, loading, progress, expanded, setExpanded,
    ctxMenu, setCtxMenu, prefs, periodEvents, periodLabel,
    stats, topTracks, visible, topPlays, nothingEverPlayed,
  }
}
