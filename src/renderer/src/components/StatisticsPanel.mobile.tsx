import { BarChart3 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/juicewrldApi'
import { useStatisticsData } from '../hooks/useStatisticsData'
import { CATEGORY_ORDER, EraTimeline, CategoryCard, Bar, TopSongRow, RecentPlayRow } from '../lib/statisticsShared'
import SongContextMenu from './SongContextMenu'

// The mobile Statistics tab of the Tracker (same slot as Overview/Credits).
// Data comes from hooks/useStatisticsData, rows/bars from lib/statisticsShared.
// Header and tab pills belong to ApiTrackerView.mobile - this is just the body.

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="text-text-primary text-[15px] font-bold px-4 mb-2.5">{children}</h2>
}

export default function StatisticsPanelMobile({ onOpenEra }: { onOpenEra: (eraName: string) => void }): JSX.Element {
  const {
    canEdit, playTrack, playNext,
    stats, playStats, songMap, playById, ctxMenu, setCtxMenu, openContextMenu,
    eraRows, maxEraCount, timelineRows, timelineStart, timelineEnd,
    topEraRows, maxTopEraPlays, maxTopSongPlays, loading,
  } = useStatisticsData()

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-3 pb-6">
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
                <p className="text-text-primary text-xl font-bold tabular-nums leading-tight truncate">{(stats?.total_songs ?? 0).toLocaleString()}</p>
                <p className="text-text-muted text-xs truncate">songs in catalog</p>
              </div>
              {playStats && (
                <>
                  <div className="w-px h-9 bg-[var(--border)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-xl font-bold tabular-nums leading-tight truncate">{playStats.total_plays.toLocaleString()}</p>
                    <p className="text-text-muted text-xs truncate">total plays</p>
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
                  <EraTimeline rows={timelineRows} start={timelineStart} end={timelineEnd} onSelect={onOpenEra} />
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
