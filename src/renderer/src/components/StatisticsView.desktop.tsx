import { BarChart3, Music2, Mic2, CalendarDays, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/juicewrldApi'
import { useStatisticsData } from '../hooks/useStatisticsData'
import {
  CATEGORY_ORDER, LIST_MAX_HEIGHT_DESKTOP,
  EraTimeline, CategoryCard, Bar, TopSongRow, RecentPlayRow,
} from '../lib/statisticsShared'
import SongContextMenu from './SongContextMenu'

// Both top_songs and recent_plays lists render their full data (up to 50
// rows, the API's own cap) inside a fixed-height scroll area sized to ~15
// rows - same visible count, same max-height, so the two sit at equal height
// side by side instead of one stopping short or growing to chase the other's
// content.
const tabBtn = (icon: React.ReactNode, label: string, onClick: () => void, active = false): JSX.Element => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors shrink-0 ${
      active ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'
    }`}
  >
    {icon} {label}
  </button>
)

export default function StatisticsViewDesktop(): JSX.Element {
  const {
    canEdit, playTrack, playNext, openEraInTracker, openTrackerTab,
    stats, playStats, songMap, playById, ctxMenu, setCtxMenu, openContextMenu,
    eraRows, maxEraCount, timelineRows, timelineStart, timelineEnd,
    topEraRows, maxTopEraPlays, maxTopSongPlays, loading,
  } = useStatisticsData()

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex-shrink-0 px-4 md:px-5 pt-4 md:pt-5 pb-3 border-b border-[var(--border)]">
        <h1 className="text-text-primary text-xl font-bold mb-1">Statistics</h1>

        <div className="flex items-center gap-0.5 bg-surface-overlay rounded-md p-0.5 overflow-x-auto no-scrollbar w-fit max-w-full">
          {tabBtn(<Music2 size={11} />, 'Songs', () => openTrackerTab('songs'))}
          {tabBtn(<Mic2 size={11} />, 'Lyrics', () => openTrackerTab('lyrics'))}
          {tabBtn(<CalendarDays size={11} />, 'Overview', () => openTrackerTab('calendar'))}
          {tabBtn(<Users size={11} />, 'Producers', () => openTrackerTab('producers'))}
          {tabBtn(<BarChart3 size={11} />, 'Statistics', () => undefined, true)}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[1600px] mx-auto space-y-5 md:space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-surface-raised animate-pulse rounded-xl" />
              <div className="h-32 bg-surface-raised animate-pulse rounded-xl" />
              <div className="h-64 bg-surface-raised animate-pulse rounded-xl" />
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="flex items-center gap-4 md:gap-6 flex-wrap">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center shrink-0">
                    <BarChart3 size={24} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-text-primary text-2xl md:text-3xl font-bold tabular-nums">{(stats?.total_songs ?? 0).toLocaleString()}</p>
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
              <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
                {/* Top songs */}
                {playStats && playStats.top_songs.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-2 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1 px-2">
                      Most played songs
                    </p>
                    <div className={`space-y-0.5 ${LIST_MAX_HEIGHT_DESKTOP} overflow-y-auto`}>
                      {playStats.top_songs.map((song, i) => (
                        <TopSongRow
                          key={song.id} song={song} cover={songMap.get(song.id)} rank={i + 1} max={maxTopSongPlays}
                          onPlay={playById} onContextMenu={openContextMenu} isMobile={false}
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
                    <div className={`space-y-0.5 ${LIST_MAX_HEIGHT_DESKTOP} overflow-y-auto`}>
                      {playStats.recent_plays.map((play) => (
                        <RecentPlayRow
                          key={play.id} play={play} cover={songMap.get(play.song_id)}
                          onPlay={playById} onContextMenu={openContextMenu} isMobile={false}
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
