import { useEffect, useMemo, useReducer, useState } from 'react'
import { ChevronLeft, BarChart3, Play, Radio, Music2, Mic2, CalendarDays, Users } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import {
  apiFetch, apiPeek, getSongById, songToTrack,
  CATEGORY_LABELS, CATEGORY_COLORS,
  type JWApiStats, type JWApiPlaysStats, type JWApiTopSong, type JWApiRecentPlay,
} from '../lib/juicewrldApi'
import { resolveStatsSongs, statsSongToTrack, type StatsSong } from '../lib/statsCatalog'
import { loadEraFullNames, eraLabel, listEras } from '../lib/eras'
import { useCanEdit } from '../hooks/useChannelRoles'
import { relativeTime } from './adminShared'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongContextMenu, { type SongContextMenuState } from './SongContextMenu'

// Catalog-wide numbers from GET /stats/ and GET /plays/stats/ - everyone sees
// the same thing here, unlike StatsView ("Your Wrapped"), which is personal
// listening history built from this user's own play log. Reached from Home's
// hero stat row (see HomeView.desktop/.mobile) and by direct URL; not a
// persistent nav tab, so it behaves like Docs/News: a pushed page with a back
// chevron rather than a bottom-nav destination.
//
// /stats/ counts catalog rows (how many songs exist); /plays/stats/ counts
// plays across every listener (how much they've been played) - two different
// endpoints, shown as two different sections below.

const CATEGORY_ORDER: (keyof JWApiStats['category_stats'])[] = [
  'released', 'unreleased', 'unsurfaced', 'recording_session',
]

// top_songs/recent_plays come back with only a name/title, era abbreviation
// and category - no cover art, no stream path. Resolving up to ~100 ids
// (50 top songs + 50 recent plays, often overlapping) one at a time would be
// the exact "hundreds of requests" problem this API is otherwise good about
// avoiding, so this goes through lib/statsCatalog's resolveStatsSongs
// instead - the same bulk-catalog-page-once cache the personal Wrapped page
// uses, so a visit there often leaves this warm already.
//
// Both lists render their full data (up to 50 rows, the API's own cap) inside
// a fixed-height scroll area sized to ~15 rows - same visible count, same
// max-height, so the two sit at equal height side by side instead of one
// stopping short or growing to chase the other's content.
const LIST_MAX_HEIGHT = 'max-h-[720px]'

// ─── Era timeline ───────────────────────────────────────────────────────────
// time_frame is free text — "(Month Year-Month Year)" or "(Month Year-Present)"
// — not two structured date fields, so this parses it defensively: any era
// that fails to parse is just left off the timeline rather than crashing or
// distorting the scale. `now` also clamps a bad far-future end date (the live
// data has had at least one) so one bad row can't blow out the whole axis.
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

function parseMonthYear(s: string): Date | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  if (month === undefined) return null
  return new Date(Number(m[2]), month, 1)
}

function parseTimeFrame(timeFrame: string | undefined, now: Date): { start: Date; end: Date } | null {
  const m = timeFrame?.trim().match(/^\(([^-]+)-(.+)\)$/)
  if (!m) return null
  const start = parseMonthYear(m[1])
  if (!start) return null
  const endRaw = m[2].trim()
  const end = endRaw.toLowerCase() === 'present' ? now : parseMonthYear(endRaw)
  if (!end) return null
  // Push to the end of that month so a single-month range still gets a
  // sliver of width instead of collapsing to zero.
  const endOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0)
  const clampedEnd = endOfMonth > now ? now : endOfMonth
  return clampedEnd > start ? { start, end: clampedEnd } : null
}

const monthYearLabel = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

// Golden-angle hue steps give N well-spread, non-repeating colors without a
// hand-picked palette — needed here since the era count is open-ended (34
// today, whatever the API adds later).
const eraColor = (i: number): string => `hsl(${Math.round((i * 137.508) % 360)}, 62%, 52%)`

interface TimelineRow { key: string; label: string; count: number; start: Date; end: Date }

function EraTimeline({ rows, start, end, onSelect }: {
  rows: TimelineRow[]
  start: Date
  end: Date
  onSelect: (eraName: string) => void
}): JSX.Element {
  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden">
        {rows.map((r, i) => {
          const ms = r.end.getTime() - r.start.getTime()
          const shareOfSpan = (ms / (end.getTime() - start.getTime())) * 100
          return (
            <button
              key={r.key}
              onClick={() => onSelect(r.key)}
              // flexGrow proportional to duration (not a % width) so tiny
              // segments still get their minWidth floor without the row's
              // total overflowing past 100% — flexbox reflows the rest to
              // make room instead.
              className="h-full flex items-center justify-center overflow-hidden shrink-0 transition-[filter] hover:brightness-110"
              style={{ flexGrow: ms, flexBasis: 0, minWidth: '6px', backgroundColor: eraColor(i) }}
              title={`${r.label} — ${monthYearLabel(r.start)} to ${monthYearLabel(r.end)} — ${r.count.toLocaleString()} songs — view in Tracker`}
            >
              {shareOfSpan > 3 && (
                <span className="text-[10px] font-semibold text-white truncate px-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                  {r.key}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-muted mt-1.5">
        <span>{monthYearLabel(start)}</span>
        <span>Present</span>
      </div>
    </div>
  )
}

function CategoryCard({ label, songCount, catalogTotal, playCount, playsTotal, colorClass }: {
  label: string
  songCount: number
  catalogTotal: number
  playCount: number
  playsTotal: number
  colorClass: string
}): JSX.Element {
  const songPct = catalogTotal > 0 ? Math.round((songCount / catalogTotal) * 100) : 0
  const playPct = playsTotal > 0 ? Math.round((playCount / playsTotal) * 100) : 0
  return (
    <div className={`rounded-xl border px-4 py-3.5 text-center ${colorClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80 mb-1.5">{label}</p>
      <div className="flex items-end justify-center gap-4">
        <div>
          <p className="text-2xl font-bold tabular-nums">{songCount.toLocaleString()}</p>
          <p className="text-xs opacity-70 mt-0.5">{songPct}% of catalog</p>
        </div>
        <div className="pl-4 border-l border-current/15">
          <p className="text-2xl font-bold tabular-nums">{playCount.toLocaleString()}</p>
          <p className="text-xs opacity-70 mt-0.5">{playPct}% of plays</p>
        </div>
      </div>
    </div>
  )
}

function Bar({ label, count, max }: { label: string; count: number; max: number }): JSX.Element {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-text-primary text-xs font-medium truncate flex-1 min-w-0" title={label}>{label}</span>
        <span className="text-text-muted text-[10px] tabular-nums shrink-0">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${max > 0 ? Math.max(2, (count / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  )
}

function CategoryBadge({ category }: { category: string }): JSX.Element {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border shrink-0 ${CATEGORY_COLORS[category] ?? 'text-text-muted bg-surface-raised border-[var(--border)]'}`}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  )
}

// Both top_songs and recent_plays rows carry a song id but no playable track.
// `songs` is the bulk-resolved map (see resolveStatsSongs above) - used when
// it already has the row's song (the common case once it's loaded), falling
// back to a one-off fetch for anything it doesn't (map still loading, or an
// id resolveStatsSongs couldn't find).
function usePlaySongById(songs: Map<number, StatsSong>): (id: number) => void {
  const { playTrack } = useStorePick('playTrack')
  return (id: number) => {
    const cached = songs.get(id)
    if (cached) { playTrack(statsSongToTrack(cached)); return }
    getSongById(id).then((song) => playTrack(songToTrack(song))).catch(() => undefined)
  }
}

function RowThumb({ cover, fallback }: { cover?: StatsSong; fallback: React.ReactNode }): JSX.Element {
  return (
    <span className="relative w-8 h-8 rounded-md overflow-hidden bg-surface-raised flex items-center justify-center shrink-0">
      {cover ? (
        <>
          <AlbumArtThumbnail track={statsSongToTrack(cover)} size={32} className="rounded-md" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={14} className="text-white" fill="currentColor" />
          </span>
        </>
      ) : fallback}
    </span>
  )
}

function TopSongRow({ song, cover, rank, max, onPlay, onContextMenu }: {
  song: JWApiTopSong
  cover?: StatsSong
  rank: number
  max: number
  onPlay: (id: number) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <button
      onClick={() => onPlay(song.id)}
      onContextMenu={(e) => onContextMenu(song.id, cover, e)}
      className="group w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors text-left"
    >
      <span className="w-5 text-text-muted text-xs tabular-nums text-right shrink-0">{rank}</span>
      <RowThumb
        cover={cover}
        fallback={
          <>
            <Music2 size={14} className="text-text-muted group-hover:opacity-0 transition-opacity" />
            <Play size={14} className="text-text-primary absolute opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" />
          </>
        }
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium truncate" title={song.name}>{song.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {song.era_name && <span className="text-text-muted text-[11px] truncate">{song.era_name}</span>}
          <CategoryBadge category={song.category} />
        </div>
      </div>
      <div className="w-24 shrink-0 hidden sm:block">
        <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${max > 0 ? Math.max(2, (song.play_count / max) * 100) : 0}%` }}
          />
        </div>
      </div>
      <span className="text-text-muted text-xs tabular-nums shrink-0 w-16 text-right">
        {song.play_count.toLocaleString()}
      </span>
    </button>
  )
}

function RecentPlayRow({ play, cover, onPlay, onContextMenu }: {
  play: JWApiRecentPlay
  cover?: StatsSong
  onPlay: (id: number) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <button
      onClick={() => onPlay(play.song_id)}
      onContextMenu={(e) => onContextMenu(play.song_id, cover, e)}
      className="group w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors text-left"
    >
      <RowThumb
        cover={cover}
        fallback={play.source === 'radio'
          ? <Radio size={13} className="text-text-muted" />
          : <Music2 size={13} className="text-text-muted" />}
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium truncate" title={play.title}>{play.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {play.era_name && <span className="text-text-muted text-[11px] truncate">{play.era_name}</span>}
          <CategoryBadge category={play.category} />
        </div>
      </div>
      <span
        className="text-text-muted text-[11px] tabular-nums shrink-0"
        title={new Date(play.played_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      >
        {relativeTime(play.played_at)}
      </span>
    </button>
  )
}

export default function StatisticsView(): JSX.Element {
  const { setActiveView, previousView, playTrack, playNext, setApiTrackerEra } = useStorePick(
    'setActiveView', 'previousView', 'playTrack', 'playNext', 'setApiTrackerEra',
  )
  const backView = previousView && previousView !== 'statistics' ? previousView : 'home'
  const canEdit = useCanEdit()

  // Consumed by ApiTrackerView on mount (see its own effect reading
  // apiTrackerEra/setApiTrackerEra) — the same deep-link slot other flows
  // already had ready-made in the store, just previously unused.
  const openEraInTracker = (eraName: string): void => {
    setApiTrackerEra(eraName)
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

  const playById = usePlaySongById(songMap)

  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)
  // Same cover-lookup-first, fetch-on-miss split as usePlaySongById - a right
  // click needs a full Track synchronously if it can, but falls back to
  // resolving just that one song rather than doing nothing while songMap is
  // still loading.
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView(backView)}
            title="Back"
            aria-label="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">Statistics</h1>
          <span className="text-xs text-text-muted font-mono">juicewrldapi.com</span>
        </div>

        <div className="flex items-center gap-0.5 mt-2.5 w-fit bg-surface-overlay rounded-md p-0.5">
          <button
            onClick={() => setActiveView('api-tracker')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors text-text-muted hover:text-text-secondary"
          >
            <Music2 size={11} /> Songs
          </button>
          <button
            onClick={() => setActiveView('api-tracker')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors text-text-muted hover:text-text-secondary"
          >
            <Mic2 size={11} /> Lyrics
          </button>
          <button
            onClick={() => setActiveView('api-tracker')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors text-text-muted hover:text-text-secondary"
          >
            <CalendarDays size={11} /> Overview
          </button>
          <button
            onClick={() => setActiveView('api-tracker')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors text-text-muted hover:text-text-secondary"
          >
            <Users size={11} /> Producers
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors bg-surface-raised text-text-primary"
          >
            <BarChart3 size={11} /> Statistics
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1600px] mx-auto space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-surface-raised animate-pulse rounded-xl" />
              <div className="h-32 bg-surface-raised animate-pulse rounded-xl" />
              <div className="h-64 bg-surface-raised animate-pulse rounded-xl" />
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center shrink-0">
                    <BarChart3 size={28} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-text-primary text-3xl font-bold tabular-nums">{(stats?.total_songs ?? 0).toLocaleString()}</p>
                    <p className="text-text-muted text-sm">songs in the catalog</p>
                  </div>
                </div>
                {playStats && (
                  <>
                    <div className="w-px h-12 bg-[var(--border)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-text-primary text-3xl font-bold tabular-nums">{playStats.total_plays.toLocaleString()}</p>
                      <p className="text-text-muted text-sm">plays across every listener</p>
                    </div>
                  </>
                )}
              </div>

              {/* Category breakdown - catalog size and plays, one card per
                  category rather than two separately-ordered rows. */}
              {stats && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2.5">By category</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {CATEGORY_ORDER.map((key) => (
                      <CategoryCard
                        key={key}
                        label={CATEGORY_LABELS[key]}
                        songCount={stats.category_stats[key]}
                        catalogTotal={stats.total_songs}
                        playCount={playStats?.category_breakdown.find((r) => r.category === key)?.count ?? 0}
                        playsTotal={playStats?.total_plays ?? 0}
                        colorClass={CATEGORY_COLORS[key]}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {timelineRows.length > 0 && timelineStart && timelineEnd && (
                <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                    Timeline ({timelineRows.length} eras)
                  </p>
                  <EraTimeline rows={timelineRows} start={timelineStart} end={timelineEnd} onSelect={openEraInTracker} />
                </div>
              )}

              {/* Below here, the page has room to spare in a narrow single
                  column - two lg-width columns instead pair related sections
                  (song lists together, era charts together) so there's less
                  to scroll through on a wide window. */}
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Top songs */}
                {playStats && playStats.top_songs.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-2 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1 px-2">
                      Most played songs
                    </p>
                    <div className={`space-y-0.5 ${LIST_MAX_HEIGHT} overflow-y-auto`}>
                      {playStats.top_songs.map((song, i) => (
                        <TopSongRow
                          key={song.id} song={song} cover={songMap.get(song.id)} rank={i + 1} max={maxTopSongPlays}
                          onPlay={playById} onContextMenu={openContextMenu}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent activity */}
                {playStats && playStats.recent_plays.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-2 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1 px-2">
                      Recent activity
                    </p>
                    <div className={`space-y-0.5 ${LIST_MAX_HEIGHT} overflow-y-auto`}>
                      {playStats.recent_plays.map((play) => (
                        <RecentPlayRow
                          key={play.id} play={play} cover={songMap.get(play.song_id)}
                          onPlay={playById} onContextMenu={openContextMenu}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Top eras by plays */}
                {topEraRows.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                      Most played eras
                    </p>
                    <div className="space-y-2.5">
                      {topEraRows.map((row) => (
                        <Bar key={row.id} label={row.name} count={row.play_count} max={maxTopEraPlays} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Catalog size by era */}
                {eraRows.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                      Catalog by era ({eraRows.length})
                    </p>
                    <div className="space-y-2.5">
                      {eraRows.map((row) => (
                        <Bar key={row.key} label={row.label} count={row.count} max={maxEraCount} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {ctxMenu && (
        <SongContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          canEdit={canEdit}
          onInfo={() => ctxMenu.songId != null && useStore.getState().setInfoSongId(ctxMenu.songId)}
          onPlay={() => playTrack(ctxMenu.track)}
          onPlayNext={() => playNext(ctxMenu.track)}
        />
      )}
    </div>
  )
}
