import { useEffect, useMemo, useState } from 'react'
import { apiPeek, type JWApiPlaysStats } from '../lib/juicewrldApi'
import { fetchSongChart, type ChartRange, type ChartSort, type SongChart, type ChartSong } from '../lib/songChartsApi'
import { resolveStatsSongs, statsSongToTrack, type StatsSong } from '../lib/statsCatalog'
import type { Track } from '../types'

// The "Most played songs" chart on the Statistics tab: one range/sort/era
// combination at a time from /plays/top-songs/. A server without that
// endpoint gets `legacy`: /plays/stats/'s all-time top 50, plays only.

const lengthSeconds = (length: string | null | undefined): number => {
  const parts = (length ?? '').trim().split(':').map(Number)
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((s, n) => s * 60 + n, 0)
}

function legacyChart(playStats: JWApiPlaysStats, era: string, songs: Map<number, StatsSong>): SongChart {
  const rows = playStats.top_songs.filter((s) => !era || s.era_name === era)
  return {
    range: 'all', days: null, sort: 'plays', era: era || null, since: null,
    totals: {
      plays: rows.reduce((n, s) => n + s.play_count, 0),
      minutes: Math.round(rows.reduce((n, s) => n + s.play_count * lengthSeconds(songs.get(s.id)?.length), 0) / 60),
      listeners: 0,
      songs: rows.length,
    },
    songs: rows.map((s, i): ChartSong => {
      const full = songs.get(s.id)
      return {
        id: s.id, public_id: s.public_id, name: s.name, era_name: s.era_name ?? '', category: s.category,
        image_url: full?.image_url ?? null, length: full?.length ?? '', producers: full?.producers ?? '',
        has_audio: full ? !!full.path : true, snippet_count: 0, version_count: 0,
        plays: s.play_count, minutes: Math.round(s.play_count * lengthSeconds(full?.length) / 60),
        listeners: 0, likes: 0, rank: i + 1, previous_rank: null,
      }
    }),
  }
}

export function useSongChart(playStats: JWApiPlaysStats | null) {
  const [range, setRange] = useState<ChartRange>('7d')
  const [sort, setSort] = useState<ChartSort>('plays')
  const [era, setEra] = useState('')
  const query = { range, sort, era: era || undefined }

  const [chart, setChart] = useState<SongChart | null>(() => apiPeek<SongChart>('/plays/top-songs/', { range, sort, era: query.era }) ?? null)
  const [legacy, setLegacy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (legacy) return
    const ac = new AbortController()
    const cached = apiPeek<SongChart>('/plays/top-songs/', { range, sort, era: era || undefined })
    if (cached) setChart(cached)
    setLoading(true)
    fetchSongChart({ range, sort, era }, ac.signal)
      .then((c) => { setChart(c); setLoading(false) })
      .catch(() => {
        if (ac.signal.aborted) return
        // Older server (no endpoint) or the request failed outright: show the
        // all-time list /plays/stats/ already has.
        setLegacy(true)
        setLoading(false)
      })
    return () => ac.abort()
  }, [range, sort, era, legacy])

  // Playable rows. The chart carries ids, not paths, so resolve them through
  // the stats catalogue (one cached bulk load, shared with the rest of the tab).
  const [songs, setSongs] = useState<Map<number, StatsSong>>(() => new Map())
  const ids = useMemo(() => {
    if (legacy) return playStats?.top_songs.map((s) => s.id) ?? []
    return chart?.songs.map((s) => s.id) ?? []
  }, [legacy, chart, playStats])
  useEffect(() => {
    const missing = ids.filter((id) => !songs.has(id))
    if (missing.length === 0) return
    let cancelled = false
    resolveStatsSongs(missing, () => undefined, () => cancelled)
      .then((map) => { if (!cancelled && map.size) setSongs((prev) => new Map([...prev, ...map])) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [ids])

  const shown = useMemo(() => {
    if (legacy) return playStats ? legacyChart(playStats, era, songs) : null
    return chart
  }, [legacy, playStats, era, songs, chart])

  /** The chart's songs that can play, in chart order. */
  const tracks = useMemo((): Track[] => {
    const out: Track[] = []
    for (const s of shown?.songs ?? []) {
      const full = songs.get(s.id)
      if (full?.path) out.push(statsSongToTrack(full))
    }
    return out
  }, [shown, songs])

  return {
    range: legacy ? 'all' as ChartRange : range, setRange,
    sort: legacy ? 'plays' as ChartSort : sort, setSort,
    era, setEra,
    chart: shown, songs, tracks, legacy,
    loading: loading && !shown,
    refreshing: loading && !!shown,
  }
}
