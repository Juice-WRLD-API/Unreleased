import { useEffect, useState } from 'react'
import { Loader2, User, ChevronLeft, ShieldCheck, Wrench, Play, Music2, History, ListMusic, Lock } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { getPublicProfile, liteSongToTrack, getPublicPlaylist } from '../lib/userApi'
import type { PublicProfile, PlaylistSummary, PlaylistDetail } from '../lib/userApi'
import { getSongsByIds, songToTrack } from '../lib/juicewrldApi'
import { Track } from '../types'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'

// Recent plays render actual track info, but the profile payload only carries
// {song, played_at} - resolving every row would mean one fetch per play, so
// this caps how many of the newest rows we bother resolving.
const RECENT_PLAYS_DISPLAY_LIMIT = 10

export default function PublicProfileView(): JSX.Element {
  const { playTrack, playCollection, setActiveView } = useStorePick('playTrack', 'playCollection', 'setActiveView')
  const userId = Number(window.location.pathname.split('/u/')[1]?.split('/')[0] ?? '')

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

  const [expandedPlaylistId, setExpandedPlaylistId] = useState<number | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<PlaylistDetail | null>(null)
  const [expandedLoading, setExpandedLoading] = useState(false)

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
        <div>
          <h1 className="text-text-primary text-2xl font-bold">{profile.display_name}</h1>
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
                >
                  <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-surface-overlay shrink-0 flex items-center justify-center">
                    <AlbumArtThumbnail track={t} fill className="w-full h-full" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play size={12} fill="white" className="text-white ml-0.5" />
                    </div>
                  </div>
                  <span className="text-text-primary text-sm flex-1 truncate" title={t.title}>{t.title}</span>
                </div>
              ))}
            </div>
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
            <div className="space-y-2">
              {profile.playlists.map(p => (
                <div key={p.id}>
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
                    onClick={() => toggleExpandPlaylist(p)}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-overlay shrink-0 flex items-center justify-center">
                      {p.cover_image_url
                        ? <img src={p.cover_image_url} alt="" className="w-full h-full object-cover" />
                        : <Music2 size={16} className="text-text-muted opacity-40" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">{p.name}</p>
                      <p className="text-text-muted text-xs">{p.track_count} tracks</p>
                    </div>
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
                              >
                                <span className="text-text-primary text-sm flex-1 truncate" title={t.title}>{t.title}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
