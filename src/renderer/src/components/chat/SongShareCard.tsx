import { Play } from 'lucide-react'
import type { SharedSongPayload } from '../../lib/chatShare'
import { songShareToTrack } from '../../lib/chatShare'
import { formatDuration } from '../../lib/format'
import { useStore } from '../../store/useStore'

export default function SongShareCard({ song }: { song: SharedSongPayload }): JSX.Element {
  const play = (): void => {
    const track = songShareToTrack(song)
    useStore.getState().playTrack(track, [track])
  }
  return (
    <button
      onClick={play}
      className="group flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-left hover:bg-surface-raised transition-colors"
    >
      <span className="relative w-11 h-11 rounded-lg overflow-hidden bg-surface-highest shrink-0">
        {song.imageUrl && <img src={song.imageUrl} alt="" className="w-full h-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
          <Play size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity fill-current" />
        </span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary truncate">{song.title}</span>
        <span className="block text-xs text-text-muted truncate">{song.artist}</span>
      </span>
      {!!song.duration && <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(song.duration)}</span>}
    </button>
  )
}
