import { Loader2, Music, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SharedSongPayload } from '../../lib/chatShare'
import { formatDuration } from '../../lib/format'
import { getSongById, songToTrack } from '../../lib/juicewrldApi'
import { useStore } from '../../store/useStore'
import type { Track } from '../../types'

// The message only ever carries a songId (see chatShare.ts) - the real title,
// art and stream URL always come from a fresh lookup here, never from
// whatever text the sender's message contained.
export default function SongShareCard({ song }: { song: SharedSongPayload }): JSX.Element {
  const [track, setTrack] = useState<Track | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTrack(null)
    setFailed(false)
    getSongById(song.songId)
      .then((s) => { if (!cancelled) setTrack(songToTrack(s)) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [song.songId])

  const play = (): void => {
    if (!track) return
    useStore.getState().playTrack(track, [track])
  }

  if (failed) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-sm text-text-muted">
        <Music size={16} /> Song unavailable
      </div>
    )
  }

  return (
    <button
      onClick={play}
      disabled={!track}
      className="group flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-left hover:bg-surface-raised transition-colors disabled:opacity-70"
    >
      <span className="relative w-11 h-11 rounded-lg overflow-hidden bg-surface-highest shrink-0 flex items-center justify-center">
        {!track ? (
          <Loader2 size={16} className="text-text-muted animate-spin" />
        ) : (
          <>
            {track.imageUrl && <img src={track.imageUrl} alt="" className="w-full h-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
              <Play size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity fill-current" />
            </span>
          </>
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary truncate">{track ? (track.apiTitle || track.title) : 'Loading...'}</span>
        <span className="block text-xs text-text-muted truncate">{track?.artist}</span>
      </span>
      {!!track?.duration && <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(track.duration)}</span>}
    </button>
  )
}
