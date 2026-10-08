import { ListMusic } from 'lucide-react'
import type { SharedPlaylistPayload } from '../../lib/chatShare'
import { useStore } from '../../store/useStore'

export default function PlaylistShareCard({ playlist }: { playlist: SharedPlaylistPayload }): JSX.Element {
  const open = (): void => {
    useStore.getState().setPendingPlaylistId(playlist.playlistId)
    useStore.getState().setActiveView('playlists')
  }
  return (
    <button
      onClick={open}
      className="group flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-left hover:bg-surface-raised transition-colors"
    >
      <span className="relative w-11 h-11 rounded-lg overflow-hidden bg-surface-highest shrink-0 flex items-center justify-center">
        {playlist.imageUrl ? <img src={playlist.imageUrl} alt="" className="w-full h-full object-cover" /> : <ListMusic size={18} className="text-text-muted" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary truncate">{playlist.name}</span>
        <span className="block text-xs text-text-muted truncate">
          {playlist.trackCount != null ? `${playlist.trackCount} track${playlist.trackCount === 1 ? '' : 's'}` : 'Playlist'}
        </span>
      </span>
    </button>
  )
}
