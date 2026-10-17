import { useEffect, useMemo, useState } from 'react'
import { Ban, Loader2, MoreHorizontal, MoreVertical, Play, Star } from 'lucide-react'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { Track } from '../types'
import { CATEGORY_COLORS, CATEGORY_LABELS, getSongsByIds, songToTrack } from '../lib/juicewrldApi'
import type { SongVersionMeta } from '../lib/versionsApi'
import { formatDuration } from '../lib/format'
import { eraLabel } from '../lib/eras'
import { useStore } from '../store/useStore'
import { useVersionPrefToggles } from '../hooks/useVersionPrefToggles'
import { prefLabel } from '../lib/versionPrefs'
import { hasPlayableSessionEdit } from '../lib/sessionEditsApi'

interface VersionEntry { meta: SongVersionMeta; track: Track; inPlaylist: boolean }

/** The versions of one song, shown under its row in Playlists' compact view
 *  when the row's arrow is opened - every version in the group, not just the
 *  ones this playlist holds, each with a prefer (star) and exclude (ban)
 *  toggle. Those feed compact view's per-song shuffle and every other play of
 *  the song (see lib/versionPrefs).
 *
 *  Versions outside the playlist are fetched only once the row is opened, the
 *  same lazy pattern ChangeVersionPanel uses. Versions with no file are
 *  skipped - there's nothing to play or prefer - except recording sessions
 *  with a session edit, which play that and are starred under "Session". */
export default function CompactVersionRows({
  versions, playlistTracks, layout, gridCols, selectMode, rowHeight, onPlay, onMenu,
}: {
  versions: SongVersionMeta[]
  /** songId → this playlist's own Track for it. */
  playlistTracks: Map<number, Track>
  layout: 'desktop' | 'mobile'
  /** Desktop only - the list's grid template, so these line up with it. */
  gridCols?: string
  selectMode?: boolean
  rowHeight: number
  onPlay: (track: Track, inPlaylist: boolean) => void
  onMenu: (track: Track, songId: number, e: React.MouseEvent) => void
}): JSX.Element {
  const fullEraNames = useStore(s => s.fullEraNames)
  const [fetched, setFetched] = useState<Map<number, Track> | null>(null)

  const missingIds = useMemo(
    () => versions.map(v => v.songId).filter(id => !playlistTracks.has(id)),
    [versions, playlistTracks]
  )
  useEffect(() => {
    if (missingIds.length === 0) { setFetched(new Map()); return }
    let cancelled = false
    getSongsByIds(missingIds)
      .then(songs => Promise.all(songs.map(async s =>
        s.path || (s.category === 'recording_session' && await hasPlayableSessionEdit(s.id)) ? s : null)))
      .then(songs => {
        if (!cancelled) setFetched(new Map(songs.filter(s => !!s).map(s => [s!.id, songToTrack(s!)])))
      })
      .catch(() => { if (!cancelled) setFetched(new Map()) })
    return () => { cancelled = true }
  }, [missingIds])

  const entries = useMemo(() => {
    const out: VersionEntry[] = []
    for (const meta of versions) {
      const own = playlistTracks.get(meta.songId)
      const track = own ?? fetched?.get(meta.songId)
      if (track) out.push({ meta, track, inPlaylist: !!own })
    }
    return out
  }, [versions, playlistTracks, fetched])

  const members = useMemo(() => versions.map(v => ({ songId: v.songId, version: prefLabel(v) })), [versions])
  const { isPreferred, isExcluded, togglePreferred, toggleExcluded } = useVersionPrefToggles(members)

  const mobile = layout === 'mobile'
  const toggles = (meta: SongVersionMeta): JSX.Element | null => {
    const version = prefLabel(meta)
    if (!version) return null
    const preferred = isPreferred(version)
    const excluded = isExcluded(version)
    const btn = mobile ? 'w-9 h-9 rounded-full' : 'w-7 h-7 rounded-md hover:bg-surface-overlay transition-colors'
    const icon = mobile ? 16 : 13
    return (
      <>
        <button
          onClick={e => { e.stopPropagation(); togglePreferred({ songId: meta.songId, version }) }}
          title={preferred ? 'Preferred - click to unset' : `Prefer "${version}" (several preferred = one picked at random)`}
          aria-pressed={preferred}
          className={`${btn} shrink-0 flex items-center justify-center ${preferred ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
        >
          <Star size={icon} fill={preferred ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); toggleExcluded({ songId: meta.songId, version }) }}
          title={excluded ? 'Excluded - click to allow again' : `Never auto-pick "${version}"`}
          aria-pressed={excluded}
          className={`${btn} shrink-0 flex items-center justify-center ${excluded ? 'text-red-400' : 'text-text-muted hover:text-text-primary'}`}
        >
          <Ban size={icon} />
        </button>
      </>
    )
  }

  const loadingRow = fetched === null && (
    <div className="flex items-center gap-1.5 px-4 text-xs text-text-muted" style={{ height: rowHeight }}>
      <Loader2 size={12} className="animate-spin" /> Loading other versions…
    </div>
  )

  const subtitle = ({ meta, track, inPlaylist }: VersionEntry): JSX.Element => (
    <p className="text-text-muted text-xs truncate flex items-center gap-1">
      <span className="truncate">{[prefLabel(meta), track.artist, track.album].filter(Boolean).join(' · ')}</span>
      {!inPlaylist && <span className="shrink-0 px-1 rounded border border-[var(--border)] text-[10px]">Not in playlist</span>}
    </p>
  )

  if (mobile) {
    return (
      <div className="ml-6 border-l border-[var(--border)]">
        {entries.map(entry => {
          const { meta, track, inPlaylist } = entry
          const dim = isExcluded(prefLabel(meta))
          return (
            <div
              key={meta.songId}
              onClick={() => onPlay(track, inPlaylist)}
              className={`flex items-center gap-3 pl-3 pr-2 rounded-2xl active:bg-surface-overlay ${dim ? 'opacity-50' : ''}`}
              style={{ height: rowHeight }}
            >
              <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-surface-overlay">
                <AlbumArtThumbnail track={track} size={40} className="rounded-lg" shimmer={false} eager />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] leading-snug truncate text-text-primary">{track.title}</p>
                {subtitle(entry)}
              </div>
              {toggles(meta)}
              <button
                onClick={e => { e.stopPropagation(); onMenu(track, meta.songId, e) }}
                className="shrink-0 w-9 h-11 flex items-center justify-center text-text-muted active:text-accent"
                aria-label="More options"
              >
                <MoreVertical size={18} />
              </button>
            </div>
          )
        })}
        {loadingRow}
      </div>
    )
  }

  return (
    <div className="bg-surface-overlay/40 rounded-lg">
      {entries.map(entry => {
        const { meta, track, inPlaylist } = entry
        const dim = isExcluded(prefLabel(meta))
        return (
          <div
            key={meta.songId}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(track, meta.songId, e) }}
            onDoubleClick={() => onPlay(track, inPlaylist)}
            className="group grid items-center gap-3 px-4 rounded-lg hover:bg-surface-raised transition-colors cursor-default select-none"
            style={{ gridTemplateColumns: gridCols, height: rowHeight }}
          >
            {selectMode && <span />}
            <span />
            <button
              className="flex items-center justify-center text-text-muted group-hover:text-text-primary"
              onClick={e => { e.stopPropagation(); onPlay(track, inPlaylist) }}
              title="Play this version"
            >
              <Play size={12} fill="currentColor" className="opacity-40 group-hover:opacity-100" />
            </button>
            <AlbumArtThumbnail track={track} size={40} className={`rounded-md ${dim ? 'opacity-50' : ''}`} shimmer={false} eager />
            <div className="min-w-0 flex items-center gap-1">
              <div className={`min-w-0 flex-1 ${dim ? 'opacity-50' : ''}`}>
                <p className="text-text-primary text-sm font-medium truncate" title={track.title}>{track.title}</p>
                {subtitle(entry)}
              </div>
              {toggles(meta)}
            </div>
            <span className="text-text-muted text-xs truncate" title={track.era || undefined}>{track.era ? eraLabel(track.era, fullEraNames) : '—'}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border text-center truncate ${CATEGORY_COLORS[track.genre] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}>
              {CATEGORY_LABELS[track.genre] ?? (track.genre || '—')}
            </span>
            <span className="text-text-muted text-xs tabular-nums text-center">{formatDuration(track.duration, '--:--')}</span>
            <div className="flex items-center justify-end">
              <button
                onClick={e => { e.stopPropagation(); onMenu(track, meta.songId, e) }}
                className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-overlay transition-colors opacity-0 group-hover:opacity-100"
                title="More options"
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>
        )
      })}
      {loadingRow}
    </div>
  )
}
