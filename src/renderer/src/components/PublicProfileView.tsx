import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2, User, ChevronLeft, ShieldCheck, Wrench, Play, Music2, History, ListMusic, Lock,
  BarChart3, MoreHorizontal, ListEnd, Link as LinkIcon, Folder, MessageCircle,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { useChatStore } from '../store/chatStore'
import { getPublicProfile, liteSongToTrack, getPublicPlaylist, trackIdToSongId } from '../lib/userApi'
import type { PublicProfile, PlaylistSummary, PlaylistDetail } from '../lib/userApi'
import { getSongsByIds, songToTrack, buildImageUrl } from '../lib/juicewrldApi'
import { Track } from '../types'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { useCanEdit } from '../hooks/useChannelRoles'
import { shareOrigin } from '../lib/platform'
import { playlistKey, parsePlaylistKey, folderOfPlaylist, allFolderedKeys } from '../lib/playlistFolders'
import {
  prefsFromEvents, joinPlayedSongs, buildListeningStats, formatListeningTime, type ListeningStats,
} from '../lib/listeningStats'
import { resolveStatsSongs, statsSongToTrack } from '../lib/statsCatalog'

// Recent plays render actual track info, but the profile payload only carries
// {song, played_at} - resolving every row would mean one fetch per play, so
// this caps how many of the newest rows we bother resolving.
const RECENT_PLAYS_DISPLAY_LIMIT = 10

// How many of the profile owner's top songs the compact Wrapped teaser shows -
// the full breakdown lives behind "View full Wrapped" for the owner's own page.
const WRAPPED_TOP_SONGS = 5

interface PlaylistMenuState { playlist: PlaylistSummary; x: number; y: number }

// Trimmed, read-only playlist menu for a public profile - unlike
// PlaylistContextMenu (rename/delete/toggle-public), every playlist here
// might belong to someone else, so only actions that work against the public
// endpoint and don't assume ownership are offered.
function PlaylistQuickMenu({ state, onClose, onOpenInLibrary }: {
  state: PlaylistMenuState
  onClose: () => void
  onOpenInLibrary?: () => void
}): JSX.Element {
  const { playCollection, addToQueue } = useStorePick('playCollection', 'addToQueue')
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const MENU_W = 200
  const [pos, setPos] = useState(() => ({
    left: Math.max(8, Math.min(state.x, window.innerWidth - MENU_W - 8)),
    top: Math.max(8, Math.min(state.y, window.innerHeight - 180 - 8)),
  }))

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const top = Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8))
    const left = Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8))
    setPos((prev) => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [state.x, state.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadTracks = async (): Promise<Track[]> => {
    const d = await getPublicPlaylist(state.playlist.id)
    return d.items.map((i) => liteSongToTrack(i.song))
  }

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${state.playlist.id}&view=shared`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 w-[200px]"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={async () => { const t = await loadTracks(); if (t.length) playCollection(t); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <Play size={14} className="text-text-muted" /> Play all
        </button>
        <button
          onClick={async () => { const t = await loadTracks(); t.forEach((tr) => addToQueue(tr)); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ListEnd size={14} className="text-text-muted" /> Add all to queue
        </button>
        <button
          onClick={copyLink}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <LinkIcon size={14} className="text-text-muted" /> {copied ? 'Link copied!' : 'Copy link'}
        </button>
        {onOpenInLibrary && (
          <>
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              onClick={onOpenInLibrary}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
            >
              <ListMusic size={14} className="text-text-muted" /> Open in your library
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}

export default function PublicProfileView(): JSX.Element {
  const {
    playTrack, playCollection, playNext, addToQueue, setActiveView, account, playlistFolders, setPendingPlaylistId,
  } = useStorePick(
    'playTrack', 'playCollection', 'playNext', 'addToQueue', 'setActiveView', 'account', 'playlistFolders', 'setPendingPlaylistId',
  )
  const canEdit = useCanEdit()
  const startDm = useChatStore((s) => s.startDm)
  const userId = Number(window.location.pathname.split('/u/')[1]?.split('/')[0] ?? '')

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

  const [wrappedStats, setWrappedStats] = useState<ListeningStats | null>(null)
  const [wrappedLoading, setWrappedLoading] = useState(false)

  const [expandedPlaylistId, setExpandedPlaylistId] = useState<number | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<PlaylistDetail | null>(null)
  const [expandedLoading, setExpandedLoading] = useState(false)

  const [trackMenu, setTrackMenu] = useState<SongContextMenuState | null>(null)
  const [playlistMenu, setPlaylistMenu] = useState<PlaylistMenuState | null>(null)

  const isOwnProfile = !!account && !!profile && account.id === profile.id

  useEffect(() => {
    if (!Number.isFinite(userId) || userId <= 0) { setNotFound(true); setLoading(false); return }
    getPublicProfile(userId)
      .then(setProfile)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => {
    const plays = profile?.play_history
    if (!plays || plays.length === 0) { setRecentTracks([]); return }
    const newest = [...plays]
      .sort((a, b) => Date.parse(b.played_at) - Date.parse(a.played_at))
      .slice(0, RECENT_PLAYS_DISPLAY_LIMIT)
    setRecentLoading(true)
    getSongsByIds(newest.map(p => p.song))
      .then(songs => {
        const byId = new Map(songs.map(s => [s.id, s]))
        const tracks = newest.map(p => byId.get(p.song)).filter((s): s is NonNullable<typeof s> => !!s).map(songToTrack)
        setRecentTracks(tracks)
      })
      .catch(() => setRecentTracks([]))
      .finally(() => setRecentLoading(false))
  }, [profile])

  // Compact "Wrapped" teaser - built entirely from the same timestamped
  // play_history the "Recently played" section uses, all-time (the profile
  // payload carries no period info). The full per-period breakdown stays
  // behind StatsView, which only ever reads the *viewer's own* local log.
  useEffect(() => {
    const plays = profile?.play_history
    if (!plays || plays.length === 0) { setWrappedStats(null); return }
    const prefs = prefsFromEvents(plays)
    const ids = prefs.map((p) => p.song)
    let cancelled = false
    setWrappedLoading(true)
    resolveStatsSongs(ids, () => {}, () => cancelled)
      .then((songs) => {
        if (cancelled) return
        setWrappedStats(buildListeningStats(joinPlayedSongs(prefs, songs)))
      })
      .catch(() => { if (!cancelled) setWrappedStats(null) })
      .finally(() => { if (!cancelled) setWrappedLoading(false) })
    return () => { cancelled = true }
  }, [profile])

  function toggleExpandPlaylist(playlist: PlaylistSummary): void {
    if (expandedPlaylistId === playlist.id) { setExpandedPlaylistId(null); setExpandedDetail(null); return }
    setExpandedPlaylistId(playlist.id)
    setExpandedDetail(null)
    setExpandedLoading(true)
    getPublicPlaylist(playlist.id)
      .then(setExpandedDetail)
      .catch(() => setExpandedDetail(null))
      .finally(() => setExpandedLoading(false))
  }

  function openSongInfo(songId: number): void {
    useStore.getState().setInfoSongId(songId)
  }

  async function messageUser(): Promise<void> {
    if (!profile || messaging) return
    setMessaging(true)
    try {
      await startDm([profile.id])
      setActiveView('chat')
    } catch {
      setMessaging(false)
    }
  }

  function openTrackMenu(e: React.MouseEvent, track: Track): void {
    e.preventDefault()
    e.stopPropagation()
    const songId = trackIdToSongId(track.id)
    setTrackMenu((prev) => (prev?.track.id === track.id ? null : { track, songId, x: e.clientX, y: e.clientY }))
  }

  // Folders are a per-account, local/synced grouping blob (see
  // lib/playlistFolders) - the public profile endpoint never returns them, so
  // they can only be reconstructed here when the viewer IS the profile owner
  // (their own store already holds the same folders that produced this list).
  // For anyone else's profile there's no folder data to show, so it stays flat.
  const folderGroups = useMemo(() => {
    const playlists = profile?.playlists ?? []
    if (!isOwnProfile || playlists.length === 0) return { folders: [], ungrouped: playlists }
    const byId = new Map(playlists.map((p) => [p.id, p]))
    const folders = playlistFolders
      .map((folder) => ({
        folder,
        playlists: folder.playlistKeys
          .map((k) => {
            const parsed = parsePlaylistKey(k)
            return parsed?.kind === 'api' ? byId.get(Number(parsed.id)) : undefined
          })
          .filter((p): p is PlaylistSummary => !!p),
      }))
      .filter((g) => g.playlists.length > 0)
    const foldered = allFolderedKeys(playlistFolders)
    const ungrouped = playlists.filter((p) => !foldered.has(playlistKey('api', p.id)))
    return { folders, ungrouped }
  }, [isOwnProfile, profile?.playlists, playlistFolders])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-5 py-6 animate-pulse">
        <div className="h-5 w-20 rounded bg-surface-overlay mb-4" />
        <div className="flex items-center gap-4 mb-2">
          <div className="w-16 h-16 rounded-full bg-surface-overlay shrink-0" />
          <div className="space-y-2">
            <div className="h-6 w-40 rounded bg-surface-overlay" />
            <div className="h-4 w-24 rounded-full bg-surface-overlay" />
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-4 w-32 rounded bg-surface-overlay" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="w-9 h-9 rounded-lg bg-surface-overlay shrink-0" />
              <div className="h-4 flex-1 max-w-[220px] rounded bg-surface-overlay" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (notFound || !profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <User size={40} className="opacity-20" />
        <p className="text-sm">Profile not found.</p>
        <button
          onClick={() => setActiveView('wrld')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors mt-1"
        >
          <ChevronLeft size={15} /> Back to app
        </button>
      </div>
    )
  }

  const expandedTracks = expandedDetail ? expandedDetail.items.map(i => liteSongToTrack(i.song)) : []
  const wrappedTopTracks = wrappedStats ? wrappedStats.played.slice(0, WRAPPED_TOP_SONGS).map((p) => statsSongToTrack(p.song)) : []

  function renderPlaylistRow(p: PlaylistSummary): JSX.Element {
    const coverUrl = buildImageUrl(p.cover_image_url)
    return (
      <div key={p.id}>
        <div
          className="group flex items-center gap-3 px-3 py-2.5 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
          onClick={() => toggleExpandPlaylist(p)}
          onContextMenu={(e) => { e.preventDefault(); setPlaylistMenu({ playlist: p, x: e.clientX, y: e.clientY }) }}
        >
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-overlay shrink-0 flex items-center justify-center">
            {coverUrl
              ? <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              : <Music2 size={16} className="text-text-muted opacity-40" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary text-sm font-medium truncate">{p.name}</p>
            <p className="text-text-muted text-xs">{p.track_count} tracks</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setPlaylistMenu((prev) => prev?.playlist.id === p.id ? null : { playlist: p, x: e.clientX, y: e.clientY }) }}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors shrink-0"
            title="More options"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        {expandedPlaylistId === p.id && (
          <div className="pl-6 pr-2 py-1">
            {expandedLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm py-2"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : expandedTracks.length === 0 ? (
              <p className="text-text-muted text-sm py-2">Empty playlist.</p>
            ) : (
              <>
                <button
                  onClick={() => playCollection(expandedTracks)}
                  className="flex items-center gap-2 mb-2 mt-1 px-4 py-1.5 rounded-full bg-accent text-black text-xs font-bold hover:scale-105 active:scale-95 transition-transform"
                >
                  <Play size={13} fill="currentColor" /> Play all
                </button>
                <div className="space-y-0.5">
                  {expandedTracks.map((t, i) => (
                    <div
                      key={`${t.id}-${i}`}
                      className="group flex items-center gap-3 px-2 py-1.5 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
                      onClick={() => playTrack(t, expandedTracks)}
                      onContextMenu={(e) => openTrackMenu(e, t)}
                    >
                      <AlbumArtThumbnail track={t} size={28} className="rounded-md" />
                      <span className="text-text-primary text-sm flex-1 truncate" title={t.title}>{t.title}</span>
                      <button
                        onClick={(e) => openTrackMenu(e, t)}
                        className="p-1 text-text-muted hover:text-text-primary transition-colors shrink-0"
                        title="More options"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-5 py-6">
      <button
        onClick={() => setActiveView('wrld')}
        className="flex items-center gap-1.5 self-start text-text-muted hover:text-text-primary text-sm transition-colors mb-4"
      >
        <ChevronLeft size={15} /> Back to app
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <div className="w-16 h-16 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-[var(--border)]">
          {profile.avatar
            ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
            : <User size={26} className="text-text-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-text-primary text-2xl font-bold truncate">{profile.display_name}</h1>
          {(profile.is_editor || profile.is_contributor) && (
            <div className="flex items-center gap-2 mt-1">
              {profile.is_editor && (
                <span className="flex items-center gap-1 text-xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                  <ShieldCheck size={12} /> Editor
                </span>
              )}
              {profile.is_contributor && (
                <span className="flex items-center gap-1 text-xs font-semibold text-text-secondary bg-surface-overlay px-2 py-0.5 rounded-full">
                  <Wrench size={12} /> Contributor
                </span>
              )}
            </div>
          )}
        </div>
        {!isOwnProfile && (
          <button
            onClick={() => void messageUser()}
            disabled={messaging}
            className="flex items-center gap-1.5 shrink-0 px-3.5 py-2 rounded-full bg-accent text-black text-sm font-bold hover:scale-105 active:scale-95 transition-transform disabled:opacity-60 disabled:pointer-events-none"
          >
            {messaging ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />}
            Message
          </button>
        )}
      </div>

      {profile.bio && (
        <p className="text-text-secondary text-sm leading-relaxed mt-3 mb-2 max-w-xl whitespace-pre-wrap">{profile.bio}</p>
      )}

      {!profile.public_play_history && !profile.public_playlists && (
        <div className="flex flex-col items-center justify-center gap-2 text-text-muted mt-16">
          <Lock size={28} className="opacity-30" />
          <p className="text-sm">This profile is private.</p>
        </div>
      )}

      {/* Recently played */}
      {profile.public_play_history && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-bold uppercase tracking-wide mb-3">
            <History size={15} /> Recently played
          </h2>
          {recentLoading ? (
            <div className="flex items-center gap-2 text-text-muted text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : recentTracks.length === 0 ? (
            <p className="text-text-muted text-sm">No plays yet.</p>
          ) : (
            <div className="space-y-0.5">
              {recentTracks.map((t, i) => (
                <div
                  key={`${t.id}-${i}`}
                  className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
                  onClick={() => playTrack(t, recentTracks)}
                  onContextMenu={(e) => openTrackMenu(e, t)}
                >
                  <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-surface-overlay shrink-0 flex items-center justify-center">
                    <AlbumArtThumbnail track={t} fill className="w-full h-full" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play size={12} fill="white" className="text-white ml-0.5" />
                    </div>
                  </div>
                  <span className="text-text-primary text-sm flex-1 truncate" title={t.title}>{t.title}</span>
                  <button
                    onClick={(e) => openTrackMenu(e, t)}
                    className="p-1.5 text-text-muted hover:text-text-primary transition-colors shrink-0"
                    title="More options"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wrapped */}
      {profile.public_play_history && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-text-primary text-sm font-bold uppercase tracking-wide">
              <BarChart3 size={15} /> Wrapped
            </h2>
            {isOwnProfile && (
              <button
                onClick={() => setActiveView('stats')}
                className="text-accent hover:underline text-xs font-medium"
              >
                View full Wrapped →
              </button>
            )}
          </div>
          {wrappedLoading ? (
            <div className="flex items-center gap-2 text-text-muted text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : !wrappedStats || wrappedStats.played.length === 0 ? (
            <p className="text-text-muted text-sm">Not enough listening data yet.</p>
          ) : (
            <>
              <div className="flex gap-3 mb-3">
                <div className="flex-1 rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-3.5 py-2.5">
                  <p className="text-text-muted text-[10px] font-semibold uppercase tracking-widest mb-1">Total plays</p>
                  <p className="text-text-primary text-lg font-bold tabular-nums">{wrappedStats.totalPlays.toLocaleString()}</p>
                </div>
                <div className="flex-1 rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-3.5 py-2.5">
                  <p className="text-text-muted text-[10px] font-semibold uppercase tracking-widest mb-1">Listening time</p>
                  <p className="text-text-primary text-lg font-bold tabular-nums">{formatListeningTime(wrappedStats.totalSeconds)}</p>
                </div>
              </div>
              <div className="space-y-0.5">
                {wrappedStats.played.slice(0, WRAPPED_TOP_SONGS).map((played, i) => {
                  const t = wrappedTopTracks[i]
                  return (
                    <div
                      key={`${played.song.id}-${i}`}
                      className="group flex items-center gap-3 px-2 py-1.5 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
                      onClick={() => playTrack(t, wrappedTopTracks)}
                      onContextMenu={(e) => openTrackMenu(e, t)}
                    >
                      <span className="text-text-muted text-xs tabular-nums w-4 text-center shrink-0">{i + 1}</span>
                      <AlbumArtThumbnail track={t} size={32} className="rounded-md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm truncate" title={t.title}>{t.title}</p>
                      </div>
                      <span className="text-text-muted text-xs tabular-nums shrink-0">{played.playcount.toLocaleString()} plays</span>
                      <button
                        onClick={(e) => openTrackMenu(e, t)}
                        className="p-1 text-text-muted hover:text-text-primary transition-colors shrink-0"
                        title="More options"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Public playlists */}
      {profile.public_playlists && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-bold uppercase tracking-wide mb-3">
            <ListMusic size={15} /> Playlists
          </h2>
          {!profile.playlists || profile.playlists.length === 0 ? (
            <p className="text-text-muted text-sm">No public playlists.</p>
          ) : (
            <div className="space-y-4">
              {folderGroups.folders.map(({ folder, playlists }) => (
                <div key={folder.id}>
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <Folder size={13} className="text-text-muted" />
                    <span className="text-text-secondary text-xs font-semibold">{folder.name}</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l border-[var(--border)]/60 ml-1.5">
                    {playlists.map((p) => renderPlaylistRow(p))}
                  </div>
                </div>
              ))}
              <div className="space-y-2">
                {folderGroups.ungrouped.map((p) => renderPlaylistRow(p))}
              </div>
            </div>
          )}
        </div>
      )}

      {trackMenu && (
        <SongContextMenu
          state={trackMenu}
          onClose={() => setTrackMenu(null)}
          canEdit={canEdit}
          onInfo={() => trackMenu.songId != null && openSongInfo(trackMenu.songId)}
          onPlay={() => playTrack(trackMenu.track)}
          onPlayNext={() => playNext(trackMenu.track)}
          onAddToQueue={() => addToQueue(trackMenu.track)}
        />
      )}

      {playlistMenu && (
        <PlaylistQuickMenu
          state={playlistMenu}
          onClose={() => setPlaylistMenu(null)}
          onOpenInLibrary={isOwnProfile ? () => {
            setPendingPlaylistId(playlistMenu.playlist.id)
            setActiveView('playlists')
            setPlaylistMenu(null)
          } : undefined}
        />
      )}
    </div>
  )
}
