import { useEffect, useMemo, useReducer, useState } from 'react'
import { useStorePick } from '../store/useStore'
import {
  apiFetch, apiPeek, getSongById, songToTrack,
  type JWApiStats, type JWApiPlaysStats,
} from '../lib/juicewrldApi'
import { resolveStatsSongs, statsSongToTrack, type StatsSong } from '../lib/statsCatalog'
import { loadEraFullNames, eraLabel, listEras } from '../lib/eras'
import { useCanEdit } from './useChannelRoles'
import { parseTimeFrame, type TimelineRow } from '../lib/statisticsShared'
import type { SongContextMenuState } from '../components/SongContextMenu'

// Catalog-wide numbers from GET /stats/ and GET /plays/stats/ - everyone sees
// the same thing here, unlike StatsView ("Your Wrapped"), which is personal
// listening history built from this user's own play log. Reached from Home's
// hero stat row (see HomeView.desktop/.mobile), the Tracker's tab bar, and by
// direct URL; not a persistent bottom-nav destination.
//
// /stats/ counts catalog rows (how many songs exist); /plays/stats/ counts
// plays across every listener (how much they've been played) - two different
// endpoints, shown as two different sections below.
//
// Shared by StatisticsView.desktop/.mobile so the two layouts can't drift on
// what the data means or how it's derived, only on how it's arranged.
export function useStatisticsData() {
  const { setActiveView, playTrack, playNext, setApiTrackerEra, setApiTrackerTab } = useStorePick(
    'setActiveView', 'playTrack', 'playNext', 'setApiTrackerEra', 'setApiTrackerTab',
  )
  const canEdit = useCanEdit()

  // Consumed by ApiTrackerView on mount (see its own effect reading
  // apiTrackerEra/setApiTrackerEra) — the same deep-link slot other flows
  // already had ready-made in the store, just previously unused.
  const openEraInTracker = (eraName: string): void => {
    setApiTrackerEra(eraName)
    setActiveView('api-tracker')
  }

  // Tab bar deep-links into the Tracker's own tab of the same name
  // (ApiTrackerView reads apiTrackerTab once on mount) rather than always
  // landing on Songs.
  const openTrackerTab = (tab: string): void => {
    setApiTrackerTab(tab)
    setActiveView('api-tracker')
  }

  const [stats, setStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setStats).catch(() => undefined)
  }, [])

  const [playStats, setPlayStats] = useState<JWApiPlaysStats | null>(() => apiPeek<JWApiPlaysStats>('/plays/stats/') ?? null)
  useEffect(() => {
    apiFetch<JWApiPlaysStats>('/plays/stats/').then(setPlayStats).catch(() => undefined)
  }, [])

  // Cover art (and everything else needed to play) for the songs named in
  // top_songs/recent_plays, resolved in bulk once both lists are known.
  const [songMap, setSongMap] = useState<Map<number, StatsSong>>(() => new Map())
  useEffect(() => {
    if (!playStats) return
    const ids = new Set<number>()
    for (const s of playStats.top_songs) ids.add(s.id)
    for (const p of playStats.recent_plays) ids.add(p.song_id)
    if (ids.size === 0) return
    let cancelled = false
    resolveStatsSongs([...ids], () => undefined, () => cancelled)
      .then((map) => { if (!cancelled) setSongMap(map) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [playStats])

  const playById = (id: number): void => {
    const cached = songMap.get(id)
    if (cached) { playTrack(statsSongToTrack(cached)); return }
    getSongById(id).then((song) => playTrack(songToTrack(song))).catch(() => undefined)
  }

  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)
  // Same cover-lookup-first, fetch-on-miss split as playById - a right click
  // (or a mobile "more" tap) needs a full Track synchronously if it can, but
  // falls back to resolving just that one song rather than doing nothing
  // while songMap is still loading.
  const openContextMenu = (id: number, cover: StatsSong | undefined, e: React.MouseEvent): void => {
    e.preventDefault()
    const { clientX: x, clientY: y } = e
    if (cover) { setCtxMenu({ track: statsSongToTrack(cover), songId: id, x, y }); return }
    getSongById(id).then((song) => setCtxMenu({ track: songToTrack(song), songId: id, x, y })).catch(() => undefined)
  }

  // listEras()/eraLabel() read a module-level cache that fills in
  // asynchronously - this bumps a version number (not just a dummy re-render
  // trigger) so the useMemos below that depend on it actually recompute once
  // loadEraFullNames resolves, instead of being stuck with abbreviations from
  // whatever was cached at first render.
  const [eraNamesVersion, bumpEras] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    loadEraFullNames().then(bumpEras).catch(() => undefined)
  }, [])

  const eraRows = useMemo(() => {
    if (!stats) return []
    const known = listEras()
    const seen = new Set(known.map((e) => e.name))
    const rows = known.map((e) => ({
      key: e.name,
      label: eraLabel(e.name, true),
      count: stats.era_stats[e.name] ?? 0,
    }))
    // Defensive: an era_stats key with no matching /eras/ row (shouldn't
    // normally happen) still gets a bar rather than silently vanishing.
    for (const [name, count] of Object.entries(stats.era_stats)) {
      if (!seen.has(name)) rows.push({ key: name, label: name, count })
    }
    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)
  }, [stats, eraNamesVersion])
  const maxEraCount = eraRows[0]?.count ?? 0

  // One long line of every era with a parseable time_frame and at least one
  // song, ordered chronologically by start date. `now` is captured once per
  // mount rather than recomputed on every render — the axis doesn't need
  // live-clock precision, just a stable "today" to clamp against.
  const [now] = useState(() => new Date())
  const timelineRows = useMemo((): TimelineRow[] => {
    if (!stats) return []
    return listEras()
      .map((e): TimelineRow | null => {
        const count = stats.era_stats[e.name] ?? 0
        if (count === 0) return null
        const range = parseTimeFrame(e.time_frame, now)
        if (!range) return null
        return { key: e.name, label: eraLabel(e.name, true), count, ...range }
      })
      .filter((r): r is TimelineRow => r !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [stats, eraNamesVersion, now])
  const timelineStart = timelineRows[0]?.start ?? null
  const timelineEnd = useMemo(
    () => timelineRows.reduce<Date | null>((max, r) => (!max || r.end > max ? r.end : max), null),
    [timelineRows],
  )

  const topEraRows = useMemo(
    () => [...(playStats?.top_eras ?? [])].sort((a, b) => b.play_count - a.play_count),
    [playStats],
  )
  const maxTopEraPlays = topEraRows[0]?.play_count ?? 0

  const maxTopSongPlays = playStats?.top_songs[0]?.play_count ?? 0

  const loading = !stats && !playStats

  return {
    canEdit, playTrack, playNext,
    openEraInTracker, openTrackerTab,
    stats, playStats, songMap, playById,
    ctxMenu, setCtxMenu, openContextMenu,
    eraRows, maxEraCount,
    timelineRows, timelineStart, timelineEnd,
    topEraRows, maxTopEraPlays, maxTopSongPlays,
    loading,
  }
}
