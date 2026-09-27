import { ArrowLeft, BarChart3, Music2, Mic2, CalendarDays, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/juicewrldApi'
import { useStatisticsData } from '../hooks/useStatisticsData'
import { CATEGORY_ORDER, EraTimeline, CategoryCard, Bar, TopSongRow, RecentPlayRow } from '../lib/statisticsShared'
import SongContextMenu from './SongContextMenu'

// The mobile Statistics screen. Same data as the desktop layout
// (hooks/useStatisticsData) and the same row/bar building blocks
// (lib/statisticsShared) - laid out to match the rest of the mobile shell
// (HomeView.mobile, ApiTrackerView.mobile) instead of just narrowing the
// desktop grid: a back-header, pill tabs instead of the compact tab strip,
// and Section-style labels instead of dense bordered cards.

const TABS = [
  { key: 'songs', label: 'Songs', icon: Music2 },
  { key: 'lyrics', label: 'Lyrics', icon: Mic2 },
  { key: 'calendar', label: 'Overview', icon: CalendarDays },
  { key: 'producers', label: 'Producers', icon: Users },
] as const

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="text-text-primary text-[15px] font-bold px-4 mb-2.5">{children}</h2>
}

export default function StatisticsViewMobile(): JSX.Element {
  const {
    canEdit, playTrack, playNext, openEraInTracker, openTrackerTab,
    stats, playStats, songMap, playById, ctxMenu, setCtxMenu, openContextMenu,
    eraRows, maxEraCount, timelineRows, timelineStart, timelineEnd,
    topEraRows, maxTopEraPlays, maxTopSongPlays, loading,
  } = useStatisticsData()

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header - no top padding of its own: the shell already absorbs the
          status-bar inset before this mounts. */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2 pb-2">
        <button
          onClick={() => window.history.back()}
          aria-label="Back"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
        ><ArrowLeft size={20} /></button>
        <h1 className="flex-1 min-w-0 px-0.5 text-text-primary text-[20px] font-bold leading-tight truncate">Statistics</h1>
      </div>

      {/* Tab pills - same shape as the Tracker's own tab bar, so jumping
          between the two feels like one screen rather than a hop out to a
          different page style. */}
      <div className="shrink-0 flex items-center gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => openTrackerTab(key)}
            className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium bg-surface-overlay text-text-secondary active:bg-surface-highest transition-colors"
          >
            <Icon size={14} />{label}
          </button>
        ))}
        <button className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium bg-accent text-white transition-colors">
          <BarChart3 size={14} />Statistics
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {loading ? (
          <div className="px-4 space-y-3">
            <div className="h-20 bg-surface-raised animate-pulse rounded-xl" />
            <div className="h-28 bg-surface-raised animate-pulse rounded-xl" />
            <div className="h-56 bg-surface-raised animate-pulse rounded-xl" />
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="flex items-center gap-3 px-4 mb-6">
              <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center">
                <BarChart3 size={20} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-2xl font-bold tabular-nums leading-tight">{(stats?.total_songs ?? 0).toLocaleString()}</p>
                <p className="text-text-muted text-xs">songs in the catalog</p>
              </div>
              {playStats && (
                <>
                  <div className="w-px h-9 bg-[var(--border)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-2xl font-bold tabular-nums leading-tight">{playStats.total_plays.toLocaleString()}</p>
                    <p className="text-text-muted text-xs">plays, every listener</p>
                  </div>
                </>
              )}
            </div>

            {/* Category breakdown */}
            {stats && (
              <section className="mb-6">
                <SectionLabel>By category</SectionLabel>
                <div className="grid grid-cols-2 gap-2.5 px-4">
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
              </section>
            )}

            {/* Timeline */}
            {timelineRows.length > 0 && timelineStart && timelineEnd && (
              <section className="mb-6">
                <SectionLabel>Timeline · {timelineRows.length} eras</SectionLabel>
                <div className="px-4">
                  <EraTimeline rows={timelineRows} start={timelineStart} end={timelineEnd} onSelect={openEraInTracker} />
                </div>
              </section>
            )}

            {/* Top songs */}
            {playStats && playStats.top_songs.length > 0 && (
              <section className="mb-6">
                <SectionLabel>Most played songs</SectionLabel>
                <div className="px-2">
                  {playStats.top_songs.map((song, i) => (
                    <TopSongRow
                      key={song.id} song={song} cover={songMap.get(song.id)} rank={i + 1} max={maxTopSongPlays}
                      onPlay={playById} onContextMenu={openContextMenu} isMobile
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recent activity */}
            {playStats && playStats.recent_plays.length > 0 && (
              <section className="mb-6">
                <SectionLabel>Recent activity</SectionLabel>
                <div className="px-2">
                  {playStats.recent_plays.map((play) => (
                    <RecentPlayRow
                      key={play.id} play={play} cover={songMap.get(play.song_id)}
                      onPlay={playById} onContextMenu={openContextMenu} isMobile
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Top eras by plays */}
            {topEraRows.length > 0 && (
              <section className="mb-6">
                <SectionLabel>Most played eras</SectionLabel>
                <div className="space-y-2.5 px-4">
                  {topEraRows.map((row) => (
                    <Bar key={row.id} label={row.name} count={row.play_count} max={maxTopEraPlays} />
                  ))}
                </div>
              </section>
            )}

            {/* Catalog size by era */}
            {eraRows.length > 0 && (
              <section className="mb-2">
                <SectionLabel>Catalog by era · {eraRows.length}</SectionLabel>
                <div className="space-y-2.5 px-4">
                  {eraRows.map((row) => (
                    <Bar key={row.key} label={row.label} count={row.count} max={maxEraCount} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
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
