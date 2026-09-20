import { useEffect, useState, useCallback, useMemo } from 'react'
import { Heart, Play, Loader2, MoreHorizontal } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import { Track, LibraryTrack } from '../types'
import { libraryTrackToTrack } from '../lib/fileTypes'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { apiFileIdToPath, apiFilePathToTrack } from '../lib/juicewrldApi'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { formatDuration } from '../lib/format'
import { clickable } from '../lib/a11y'

export default function LikedSongsView(): JSX.Element {
  const { account, playTrack, playCollection, playNext, toggleLike, setShowUserAuth, setActiveView, setPendingEditorSongId, libraryTracks, likedTrackIds } = useStorePick('account', 'playTrack', 'playCollection', 'playNext', 'toggleLike', 'setShowUserAuth', 'setActiveView', 'setPendingEditorSongId', 'libraryTracks', 'likedTrackIds')
  const canEdit = useCanEdit()
  const [apiTracks, setApiTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)

  const load = useCallback(async () => {
    if (!account) { setLoading(false); return }
    setLoading(true)
    try {
      const favorites = await userApi.getFavorites()
      setApiTracks(favorites.map((f) => userApi.liteSongToTrack(f.song)))
    } catch {
      setApiTracks([])
    } finally {
      setLoading(false)
    }
  }, [account])

  useEffect(() => { load() }, [load])

  // Global infoSongId (not local state) so the info panel survives switching
  // to another tab, which unmounts this view.
  const openSongInfo = (songId: number): void => {
    useStore.getState().setInfoSongId(songId)
  }

  // Local-file likes live in the store (libraryTracks/likedTrackIds), so
  // unliking one just needs toggleLike - the `visible` list above recomputes
  // from the store automatically. API favorites were snapshotted into
  // apiTracks at load time, though, so those need an explicit local removal
  // too or they'd linger until the next full reload.
  const removeLiked = (track: Track): void => {
    if (userApi.trackIdToSongId(track.id) != null) {
      setApiTracks(prev => prev.filter(t => t.id !== track.id))
    }
    toggleLike(track.id)
  }

  // Liked local files never go through the API (toggleLike stores them purely
  // in localStorage for ids that don't resolve to a numeric song id), so they
  // have to be pulled in from the scanned library here rather than getFavorites().
  const localLikedTracks = useMemo(() => {
    const liked = new Set(likedTrackIds)
    return libraryTracks.filter((t) => liked.has(t.id)).map(libraryTrackToTrack)
  }, [libraryTracks, likedTrackIds])

  // Liked files from the API file browser (ApiFilesView) also skip the
  // favorites API - same as local files, their id just encodes the path
  // instead of pointing at a scanned library entry, so rebuild the track
  // straight from the id rather than needing the folder they came from.
  const likedApiFileTracks = useMemo(() => likedTrackIds
    .map((id) => { const path = apiFileIdToPath(id); return path ? apiFilePathToTrack(path) : null })
    .filter((t): t is Track => t != null), [likedTrackIds])

  const visible = [...apiTracks, ...localLikedTracks, ...likedApiFileTracks]

  if (!account && localLikedTracks.length === 0 && likedApiFileTracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <Heart size={40} className="text-text-muted mb-4" />
        <h2 className="text-text-primary text-lg font-semibold mb-1">Liked Songs</h2>
        <p className="text-text-muted text-sm mb-5 max-w-xs">Log in to save your favorite tracks and access them on any device.</p>
        <button
          onClick={() => setShowUserAuth(true)}
          className="px-5 py-2.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent text-sm font-semibold transition-colors"
        >
          Log in
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-5 pt-5 pb-8">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center shrink-0">
            <Heart size={32} className="text-accent" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <h1 className="text-text-primary text-2xl font-bold">Liked Songs</h1>
            <p className="text-text-muted text-sm mt-1">{visible.length} {visible.length === 1 ? 'track' : 'tracks'}</p>
          </div>
          {visible.length > 0 && (
            <button
              onClick={() => playCollection(visible)}
              className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-black text-sm font-semibold hover:scale-105 transition-transform"
            >
              <Play size={16} fill="currentColor" /> Play
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-text-muted h-40 justify-center">
            <Loader2 size={18} className="animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-text-muted text-sm">No liked songs yet. Tap the heart on any track to save it here.</p>
        ) : (
          <div className="space-y-0.5">
            {visible.map((track, i) => {
              const songId = userApi.trackIdToSongId(track.id)
              return (
                <div
                  key={track.id}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors"
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                >
                  <span className="w-6 text-center text-xs text-text-muted tabular-nums shrink-0 hidden md:block">{i + 1}</span>
                  <button onClick={() => playTrack(track, visible)} className="relative shrink-0" aria-label={`Play ${track.title}`}>
                    <AlbumArtThumbnail track={track} size={40} className="rounded-md" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 md:group-hover:opacity-100 rounded-md transition-opacity">
                      <Play size={16} className="text-white" fill="currentColor" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1 cursor-pointer" {...clickable(() => playTrack(track, visible))}>
                    <p className="text-text-primary text-sm font-medium truncate" title={track.title}>{track.title}</p>
                    <p className="text-text-muted text-xs truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
                  </div>
                  <span className="text-text-muted text-xs tabular-nums shrink-0 hidden sm:block">{formatDuration(track.duration, '')}</span>
                  {/* Was opacity-0 group-hover:opacity-100 with no touch
                      equivalent - invisible and undiscoverable on mobile. */}
                  <button
                    onClick={e => { e.stopPropagation(); setCtxMenu(prev => prev?.track.id === track.id ? null : { track, songId, x: e.clientX, y: e.clientY }) }}
                    className="text-text-muted hover:text-text-primary opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0 w-11 h-11 md:w-auto md:h-auto flex items-center justify-center md:p-1.5"
                    aria-label="More options"
                  >
                    <MoreHorizontal size={18} className="md:w-4 md:h-4" />
                  </button>
                  <button
                    onClick={() => removeLiked(track)}
                    className="text-accent shrink-0 w-11 h-11 md:w-auto md:h-auto flex items-center justify-center md:p-1.5"
                    aria-label="Remove from Liked Songs"
                  >
                    <Heart size={18} className="md:w-4 md:h-4" fill="currentColor" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>

    {ctxMenu && (
      <SongContextMenu
        state={ctxMenu}
        onClose={() => setCtxMenu(null)}
        canEdit={canEdit}
        onInfo={() => ctxMenu.songId != null && openSongInfo(ctxMenu.songId)}
        onPlay={() => playTrack(ctxMenu.track, visible)}
        onPlayNext={() => playNext(ctxMenu.track)}
        removeAction={{ label: 'Unlike', onClick: () => removeLiked(ctxMenu.track) }}
      />
    )}
    </>
  )
}
