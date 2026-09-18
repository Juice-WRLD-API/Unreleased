import { useStore } from '../store/useStore'
import { BarChart3, Play, Loader2, MoreHorizontal, Music2, Clock, ListMusic, Disc3, CalendarDays, Info } from 'lucide-react'
import { useCanEdit } from '../hooks/useChannelRoles'
import { formatListeningTime, type RankedEntry } from '../lib/listeningStats'
import { statsSongToTrack } from '../lib/statsCatalog'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongContextMenu from './SongContextMenu'
import { relativeTime } from './adminShared'
import { useStatsViewData, PERIOD_OPTIONS, PLAY_TOP_N, TOP_SONGS_COLLAPSED, TIMELINE_LIMIT } from '../hooks/useStatsViewData'

// "Your Wrapped" - a listening summary built entirely from lib/listeningPlays'
// timestamped events, rolled back up into playcounts for each period
// (including "all time", which is just every event the log still holds).
// Older plays that predate the log - or have since aged out of its cap -
// carry no timestamp, so they're excluded everywhere on this page rather than
// mixed in with numbers that can't be sliced by period. The log starts at
// whichever build first shipped it, so "all time" can still be a shorter
// window than the name implies; listeningStats' periodCoverage reports that,
// and the header below labels a short window "Since <date>" instead of
// quietly claiming more history than exists.
//
// Song metadata isn't stored alongside either - an event is just
// {song id, played_at} - so ids have to be resolved to songs before anything
// can be ranked. lib/statsCatalog owns that and picks the cheap route (a few
// per-id fetches, or one cached catalogue crawl); this file just renders.

function StatCard({ icon, value, label }: { icon: JSX.Element; value: string; label: string }): JSX.Element {
  return (
    <div className="flex-1 min-w-[140px] rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-text-muted mb-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-text-primary text-2xl font-bold tabular-nums truncate" title={value}>{value}</p>
    </div>
  )
}

function BarList({ title, entries, empty }: { title: string; entries: RankedEntry[]; empty: string }): JSX.Element {
  // Bars are scaled against the top entry, not the total - otherwise a long
  // tail of small shares renders as a row of invisible slivers.
  const max = entries[0]?.plays ?? 0
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">{title}</p>
      {entries.length === 0 ? (
        <p className="text-text-muted text-xs">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {entries.slice(0, 6).map((e) => (
            <div key={e.key}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-text-primary text-xs font-medium truncate flex-1 min-w-0" title={e.label}>{e.label}</span>
                <span className="text-text-muted text-[10px] tabular-nums shrink-0">
                  {e.plays.toLocaleString()} {e.plays === 1 ? 'play' : 'plays'} · {Math.round(e.share * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${max > 0 ? Math.max(2, (e.plays / max) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StatsView(): JSX.Element {
  const {
    account, playTrack, playCollection, playNext,
    period, setPeriod, songs, loading, progress, expanded, setExpanded,
    ctxMenu, setCtxMenu, prefs, periodEvents, periodLabel,
    stats, topTracks, visible, topPlays, nothingEverPlayed,
  } = useStatsViewData()
  const canEdit = useCanEdit()

  // Global infoSongId (not local state) so the info panel survives switching
  // to another tab, which unmounts this view. GlobalSongInfoHost does its own
  // fetch by id, so no need to resolve the song here first.
  const openSongInfo = (songId: number): void => {
    useStore.getState().setInfoSongId(songId)
  }

  if (nothingEverPlayed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <BarChart3 size={40} className="text-text-muted mb-4" />
        <h2 className="text-text-primary text-lg font-semibold mb-1">Nothing to wrap yet</h2>
        <p className="text-text-muted text-sm max-w-sm leading-relaxed">
          Play some songs and they'll show up here. A song counts once you've listened
          to 30 seconds of it (or half of it, if it's shorter than a minute).
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="px-5 pt-5 pb-8">
          {/* ── Hero ── */}
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center shrink-0">
              <BarChart3 size={32} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-text-primary text-2xl font-bold">Your Wrapped</h1>
                <span className="px-2 py-0.5 rounded-full bg-surface-raised text-text-muted text-[10px] font-semibold uppercase tracking-widest shrink-0">
                  {periodLabel}
                </span>
              </div>
              <p className="text-text-muted text-sm mt-1">
                {stats.distinctSongs.toLocaleString()} {stats.distinctSongs === 1 ? 'song' : 'songs'} · {stats.totalPlays.toLocaleString()} {stats.totalPlays === 1 ? 'play' : 'plays'}
              </p>
            </div>
            {topTracks.length > 0 && (
              <button
                onClick={() => playCollection(topTracks.slice(0, PLAY_TOP_N))}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-black text-sm font-semibold hover:scale-105 transition-transform shrink-0"
                title={`Play your top ${Math.min(PLAY_TOP_N, topTracks.length)} songs`}
              >
                <Play size={16} fill="currentColor" /> Play top songs
              </button>
            )}
          </div>

          <div className="flex gap-2 mb-5 flex-wrap">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { setPeriod(opt.id); setExpanded(false) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  period === opt.id ? 'bg-accent text-black' : 'bg-surface-overlay text-text-muted hover:text-text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-xs mb-4">
              <Loader2 size={13} className="animate-spin" />
              {progress?.phase === 'songs' ? (
                <span>Loading song details… {progress.done}/{progress.total}</span>
              ) : progress?.phase === 'catalog' && progress.total > 0 ? (
                <span>Loading song catalogue… {progress.done}/{progress.total}</span>
              ) : (
                <span>Loading…</span>
              )}
            </div>
          )}

          {/* ── Headline numbers ── */}
          <div className="flex flex-wrap gap-3 mb-3">
            <StatCard icon={<Play size={12} fill="currentColor" />} value={stats.totalPlays.toLocaleString()} label="Total plays" />
            <StatCard icon={<ListMusic size={12} />} value={stats.distinctSongs.toLocaleString()} label="Songs played" />
            <StatCard icon={<Clock size={12} />} value={formatListeningTime(stats.totalSeconds)} label="Time listened" />
            <StatCard icon={<Disc3 size={12} />} value={stats.eras[0]?.label ?? '—'} label="Top era" />
          </div>

          {/* ── Breakdowns ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            <BarList title="Top eras" entries={stats.eras} empty="No era data on your played songs." />
            <BarList title="By category" entries={stats.categories} empty="No category data." />
            <BarList title="Top producers" entries={stats.producers} empty="No producer credits on your played songs." />
            <BarList title="Top features" entries={stats.collaborators} empty="No features on your played songs." />
          </div>

          {/* ── Top songs + Listening timeline ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start mb-6">
          <div>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-text-primary text-sm font-semibold">Top songs</h2>
            {stats.played.length > TOP_SONGS_COLLAPSED && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-accent hover:text-accent/80 text-xs font-semibold transition-colors"
              >
                {expanded ? 'Show less' : `Show all ${stats.played.length}`}
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {visible.map((entry, i) => {
              const track = topTracks[i]
              const songId = entry.song.id
              return (
                <div
                  key={songId}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors"
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                >
                  <span className="w-6 text-center text-xs text-text-muted tabular-nums shrink-0">{i + 1}</span>
                  <button onClick={() => playTrack(track, topTracks)} className="relative shrink-0">
                    <AlbumArtThumbnail track={track} size={40} className="rounded-md" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 rounded-md transition-opacity">
                      <Play size={16} className="text-white" fill="currentColor" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => playTrack(track, topTracks)}>
                    <p className="text-text-primary text-sm font-medium truncate" title={track.title}>{track.title}</p>
                    <p className="text-text-muted text-xs truncate">
                      {track.artist}{entry.song.era?.name ? ` · ${entry.song.era.name}` : ''}
                    </p>
                  </div>
                  {/* Per-song share bar, scaled against the most-played song. */}
                  <div className="hidden sm:block w-24 shrink-0">
                    <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${topPlays > 0 ? Math.max(3, (entry.playcount / topPlays) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-text-secondary text-xs tabular-nums shrink-0 w-16 text-right">
                    {entry.playcount.toLocaleString()} {entry.playcount === 1 ? 'play' : 'plays'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setCtxMenu((prev) => prev?.track.id === track.id ? null : { track, songId, x: e.clientX, y: e.clientY }) }}
                    className="p-1.5 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    title="More options"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Songs whose metadata couldn't be resolved still hold play counts,
              so say so rather than silently under-reporting the totals. */}
          {!loading && stats.played.length < prefs.length && (
            <p className="text-text-muted text-xs mt-4">
              {prefs.length - stats.played.length} played {prefs.length - stats.played.length === 1 ? 'song' : 'songs'} couldn't be loaded and {prefs.length - stats.played.length === 1 ? 'is' : 'are'} not counted above.
            </p>
          )}
          </div>

          {periodEvents.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays size={14} className="text-text-muted" />
                <h2 className="text-text-primary text-sm font-semibold">Listening timeline</h2>
              </div>
              <div className="space-y-0.5">
                {periodEvents.slice(0, TIMELINE_LIMIT).map((event, index) => {
                  const song = songs.get(event.song)
                  const track = song ? statsSongToTrack(song) : null
                  const title = song?.name ?? `Song #${event.song}`
                  return (
                    <div
                      key={`${event.song}-${event.played_at}-${index}`}
                      className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors"
                      onContextMenu={(e) => { if (track) { e.preventDefault(); setCtxMenu({ track, songId: event.song, x: e.clientX, y: e.clientY }) } }}
                    >
                      {track ? (
                        <button onClick={() => playTrack(track)} className="relative shrink-0">
                          <AlbumArtThumbnail track={track} size={40} className="rounded-md" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 rounded-md transition-opacity">
                            <Play size={16} className="text-white" fill="currentColor" />
                          </span>
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-surface-raised shrink-0" />
                      )}
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => track && playTrack(track)}>
                        <p className="text-text-primary text-sm font-medium truncate" title={title}>{title}</p>
                        <p className="text-text-muted text-xs truncate">
                          {track?.artist ?? ''}{song?.era?.name ? ` · ${song.era.name}` : ''}
                        </p>
                      </div>
                      <span className="text-text-muted text-[11px] tabular-nums shrink-0">{relativeTime(event.played_at)}</span>
                      <span
                        className="p-1 text-text-muted/70 hover:text-text-primary shrink-0 cursor-help"
                        title={new Date(event.played_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      >
                        <Info size={14} />
                      </span>
                      {track && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setCtxMenu((prev) => prev?.songId === event.song ? null : { track, songId: event.song, x: e.clientX, y: e.clientY }) }}
                          className="p-1.5 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                          title="More options"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          </div>

          <div className="mt-6 pt-4 border-t border-[var(--border)] space-y-1.5">
            <p className="text-text-muted text-[11px] leading-relaxed flex items-start gap-1.5">
              <Music2 size={12} className="mt-0.5 shrink-0 opacity-60" />
              <span>
                A play counts once you've listened to 30 seconds of a song (or half of it, if it's
                shorter than a minute). Skipping through a queue doesn't count. Downloaded songs
                count the same as streamed ones - local files you imported yourself aren't tracked.
                All time counts every play ever. The 7- and 30-day views read from the
                timestamped history, which starts later and holds a bounded number of plays -
                the line under the period buttons says exactly how much it covers.
              </span>
            </p>
            {!account && (
              <p className="text-text-muted/70 text-[11px] leading-relaxed">
                These stats are saved on this device. Log in to sync them across devices.
              </p>
            )}
          </div>
        </div>
      </div>

      {ctxMenu && (
        <SongContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          canEdit={canEdit}
          onInfo={() => ctxMenu.songId != null && openSongInfo(ctxMenu.songId)}
          onPlay={() => playTrack(ctxMenu.track, topTracks)}
          onPlayNext={() => playNext(ctxMenu.track)}
        />
      )}
    </>
  )
}
