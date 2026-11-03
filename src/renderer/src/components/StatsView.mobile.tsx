import { useState } from 'react'
import { BarChart3, Play, Loader2, Clock, ListMusic, Disc3 } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { useCanEdit } from '../hooks/useChannelRoles'
import { apiFetch, JWApiSong } from '../lib/juicewrldApi'
import { formatListeningTime, type RankedEntry } from '../lib/listeningStats'
import { statsSongToTrack } from '../lib/statsCatalog'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongInfoModal from './SongInfoModal'
import SongContextMenu from './SongContextMenu'
import { relativeTime } from './adminShared'
import { useStatsViewData, PERIOD_OPTIONS, PLAY_TOP_N, TOP_SONGS_COLLAPSED, TIMELINE_LIMIT } from '../hooks/useStatsViewData'
import { clickable } from '../lib/a11y'
import { Segmented } from './mobile/Segmented'
import { CompactBar, LargeTitle, LARGE_TITLE_COLLAPSE, useScrolledPast } from './mobile/NavBar'
import { GroupedSection } from './mobile/Grouped'
import { ListRow, RowDuration, RowMenuButton } from './mobile/ListRow'

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
    <div className="rounded-[20px] bg-[var(--grouped)] px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-text-secondary mb-1">
        {icon}
        <span className="text-footnote font-medium truncate">{label}</span>
      </div>
      <p className="text-title2 text-text-primary tabular-nums truncate" title={value}>{value}</p>
    </div>
  )
}

function BarList({ title, entries, empty }: { title: string; entries: RankedEntry[]; empty: string }): JSX.Element {
  // Bars are scaled against the top entry, not the total - otherwise a long
  // tail of small shares renders as a row of invisible slivers.
  const max = entries[0]?.plays ?? 0
  return (
    <GroupedSection header={title}>
      <div className="py-3.5">
        {entries.length === 0 ? (
          <p className="text-subhead text-text-secondary">{empty}</p>
        ) : (
          <div className="space-y-3">
            {entries.slice(0, 6).map((e) => (
              <div key={e.key}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-subhead text-text-primary truncate flex-1 min-w-0" title={e.label}>{e.label}</span>
                  <span className="text-footnote text-text-muted tabular-nums shrink-0">
                    {e.plays.toLocaleString()} {e.plays === 1 ? 'play' : 'plays'} · {Math.round(e.share * 100)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--fill)] overflow-hidden">
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
    </GroupedSection>
  )
}

export default function StatsView(): JSX.Element {
  const { setActiveView, setPendingEditorSongId } = useStorePick('setActiveView', 'setPendingEditorSongId')
  const {
    account, playTrack, playCollection, playNext,
    period, setPeriod, songs, loading, progress, expanded, setExpanded,
    ctxMenu, setCtxMenu, prefs, periodEvents, periodLabel,
    stats, topTracks, visible, topPlays, nothingEverPlayed,
  } = useStatsViewData()
  const canEdit = useCanEdit()
  const [infoSong, setInfoSong] = useState<JWApiSong | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const collapsed = useScrolledPast(scrollEl, LARGE_TITLE_COLLAPSE)

  const openSongInfo = async (songId: number): Promise<void> => {
    try { setInfoSong(await apiFetch<JWApiSong>(`/songs/${songId}/`)) } catch {}
  }

  if (nothingEverPlayed) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <LargeTitle title="Wrapped" />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 pb-dock">
          <BarChart3 size={44} strokeWidth={1.75} className="text-text-muted mb-4" />
          <h2 className="text-title3 text-text-primary mb-1">Nothing to wrap yet</h2>
          <p className="text-subhead text-text-secondary max-w-sm">
            Play some songs and they'll show up here. A song counts once you've listened
            to 30 seconds of it (or half of it, if it's shorter than a minute).
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        <CompactBar title="Wrapped" shown={collapsed} />
        <div ref={setScrollEl} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-dock">
          <LargeTitle
            title="Wrapped"
            subtitle={`${periodLabel} · ${stats.distinctSongs.toLocaleString()} ${stats.distinctSongs === 1 ? 'song' : 'songs'} · ${stats.totalPlays.toLocaleString()} ${stats.totalPlays === 1 ? 'play' : 'plays'}`}
          />

          <div className="px-4 pt-1">
            {/* ── Period switcher ── */}
            <Segmented
              value={period}
              options={PERIOD_OPTIONS.map((opt) => ({ value: opt.id, label: opt.label }))}
              onChange={(id) => { setPeriod(id); setExpanded(false) }}
            />

            {loading && (
              <div className="flex items-center gap-2 text-footnote text-text-secondary mt-3">
                <Loader2 size={14} className="animate-spin" />
                {progress?.phase === 'songs' ? (
                  <span>Loading song details… {progress.done}/{progress.total}</span>
                ) : progress?.phase === 'catalog' && progress.total > 0 ? (
                  <span>Loading song catalogue… {progress.done}/{progress.total}</span>
                ) : (
                  <span>Loading…</span>
                )}
              </div>
            )}

            {topTracks.length > 0 && (
              <button
                onClick={() => playCollection(topTracks.slice(0, PLAY_TOP_N))}
                className="mt-4 w-full h-12 flex items-center justify-center gap-2 rounded-full bg-[var(--fill)] text-accent text-headline active:bg-[var(--fill-strong)] transition-colors"
              >
                <Play size={18} fill="currentColor" strokeWidth={0} /> Play top {Math.min(PLAY_TOP_N, topTracks.length)}
              </button>
            )}

            {/* ── Headline numbers ── */}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <StatCard icon={<Play size={13} fill="currentColor" strokeWidth={0} />} value={stats.totalPlays.toLocaleString()} label="Total plays" />
              <StatCard icon={<ListMusic size={13} />} value={stats.distinctSongs.toLocaleString()} label="Songs played" />
              <StatCard icon={<Clock size={13} />} value={formatListeningTime(stats.totalSeconds)} label="Time listened" />
              <StatCard icon={<Disc3 size={13} />} value={stats.eras[0]?.label ?? '—'} label="Top era" />
            </div>

            {/* ── Breakdowns ── */}
            <div className="space-y-6 mt-7">
              <BarList title="Top eras" entries={stats.eras} empty="No era data on your played songs." />
              <BarList title="By category" entries={stats.categories} empty="No category data." />
              <BarList title="Top producers" entries={stats.producers} empty="No producer credits on your played songs." />
              <BarList title="Top features" entries={stats.collaborators} empty="No features on your played songs." />
            </div>
          </div>

          {/* ── Top songs ── */}
          <div className="flex items-baseline justify-between gap-3 px-4 mt-8 mb-1">
            <h2 className="text-title2 text-text-primary">Top songs</h2>
            {stats.played.length > TOP_SONGS_COLLAPSED && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-body text-accent active:opacity-60 transition-opacity"
              >
                {expanded ? 'Show less' : `Show all ${stats.played.length}`}
              </button>
            )}
          </div>

          {visible.map((entry, i) => {
            const track = topTracks[i]
            const songId = entry.song.id
            return (
              <div key={songId} className="h-16">
                <ListRow
                  art={<AlbumArtThumbnail track={track} size={48} />}
                  rank={i + 1}
                  title={track.title}
                  subtitle={`${track.artist}${entry.song.era?.name ? ` · ${entry.song.era.name}` : ''}`}
                  trailing={
                    <>
                      <RowDuration>{entry.playcount.toLocaleString()}</RowDuration>
                      <RowMenuButton
                        onClick={(e) => setCtxMenu((prev) => prev?.track.id === track.id ? null : { track, songId, x: e.clientX, y: e.clientY })}
                      />
                    </>
                  }
                  {...clickable(() => playTrack(track, topTracks))}
                />
              </div>
            )
          })}

          {/* Songs whose metadata couldn't be resolved still hold play counts,
              so say so rather than silently under-reporting the totals. */}
          {!loading && stats.played.length < prefs.length && (
            <p className="text-footnote text-text-muted mt-2 px-4">
              {prefs.length - stats.played.length} played {prefs.length - stats.played.length === 1 ? 'song' : 'songs'} couldn't be loaded and {prefs.length - stats.played.length === 1 ? 'is' : 'are'} not counted above.
            </p>
          )}

          {periodEvents.length > 0 && (
            <>
              <h2 className="text-title2 text-text-primary px-4 mt-8 mb-1">Listening timeline</h2>
              {periodEvents.slice(0, TIMELINE_LIMIT).map((event, index) => {
                const song = songs.get(event.song)
                const track = song ? statsSongToTrack(song) : null
                const title = song?.name ?? `Song #${event.song}`
                return (
                  <div key={`${event.song}-${event.played_at}-${index}`} className="h-16">
                    <ListRow
                      art={track ? <AlbumArtThumbnail track={track} size={48} /> : null}
                      title={title}
                      subtitle={`${track?.artist ?? ''}${song?.era?.name ? ` · ${song.era.name}` : ''}`}
                      trailing={
                        <>
                          <RowDuration>{relativeTime(event.played_at)}</RowDuration>
                          {track ? (
                            <RowMenuButton
                              onClick={(e) => setCtxMenu((prev) => prev?.songId === event.song ? null : { track, songId: event.song, x: e.clientX, y: e.clientY })}
                            />
                          ) : <span className="w-2 shrink-0" />}
                        </>
                      }
                      {...clickable(() => track && playTrack(track, [track]))}
                    />
                  </div>
                )
              })}
            </>
          )}

          <div className="px-4 mt-8 space-y-2">
            <p className="text-footnote text-text-muted">
              A play counts once you've listened to 30 seconds of a song (or half of it, if it's
              shorter than a minute). Skipping through a queue doesn't count. Downloaded songs
              count the same as streamed ones - local files you imported yourself aren't tracked.
              All time counts every play ever. The 7- and 30-day views read from the
              timestamped history, which starts later and holds a bounded number of plays -
              the line under the title says exactly how much it covers.
            </p>
            {!account && (
              <p className="text-footnote text-text-muted">
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
      <SongInfoModal
        song={infoSong}
        onClose={() => setInfoSong(null)}
        onEdit={canEdit ? (songId) => { setInfoSong(null); setPendingEditorSongId(songId); setActiveView('editor') } : undefined}
      />
    </>
  )
}
