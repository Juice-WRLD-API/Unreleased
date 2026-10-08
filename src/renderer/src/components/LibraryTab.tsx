import { Music } from 'lucide-react'
import { useStore } from '../store/useStore'
import { LibraryTrack } from '../types'

/* ══════════════════════════════════════════════════════════════════════════════
   The Library tab itself was removed from the web build (local-folder scanning
   only ever worked through Electron's native fs APIs, which don't exist here -
   see the "Add responsive mobile web UI..." commit). AlbumArtThumb survives
   because PlaylistsView (desktop + mobile) still uses it to render local
   playlists' track thumbnails, keyed off the store's `libraryArt` map.
   ══════════════════════════════════════════════════════════════════════════════ */

function useTrackArt(track: LibraryTrack): string | null | undefined {
  return useStore((s) => s.libraryArt[track.id])
}

/** Small square thumbnail. Exported - PlaylistsView reuses it. */
export function AlbumArtThumb({ track, size = 48 }: { track: LibraryTrack; size?: number }): JSX.Element {
  const art = useTrackArt(track)
  // rem, not px, so the thumbnail scales with the app text-size setting (which
  // drives the root font-size) rather than staying pinned while its rem-sized
  // wrapper and neighbouring text grow around it. Identical at normal scale.
  const rem = `${size / 16}rem`
  if (art) return <img src={art} alt="" className="object-cover" style={{ width: rem, height: rem }} />
  return (
    <div className="flex items-center justify-center bg-surface-overlay text-text-muted" style={{ width: rem, height: rem }}>
      <Music size={`${(size * 0.4) / 16}rem`} />
    </div>
  )
}
