// "Add to playlist" done state, shared by ApiFilesView.desktop.tsx and
// .mobile.tsx - identical logic in both. A file that resolved to a Tracker
// match (see useTrackerMatches) goes in as that song; any other audio file
// goes in as a comp-file entry pointing at its channel and path.
// Optimistic: the row ticks immediately and unticks (with a toast, via
// optimisticPlaylist) if the request fails.
import { useState } from 'react'
import { addEntriesInBackground, addSongsInBackground } from '../lib/optimisticPlaylist'

export function useAddFileToPlaylist(): {
  playlistDoneId: number | null
  addToPlaylist: (playlistId: number, target: { songId: number } | { path: string; channel?: string }) => void
  resetPlaylistDone: () => void
} {
  const [playlistDoneId, setPlaylistDoneId] = useState<number | null>(null)

  const addToPlaylist = (playlistId: number, target: { songId: number } | { path: string; channel?: string }): void => {
    setPlaylistDoneId(playlistId)
    const pending = 'songId' in target
      ? addSongsInBackground(playlistId, [target.songId])
      : addEntriesInBackground(playlistId, [{ source: 'comp', path: target.path, ...(target.channel ? { channel: target.channel } : {}) }])
    void pending.then(failed => {
      if (failed.length) setPlaylistDoneId(prev => (prev === playlistId ? null : prev))
    })
  }

  return { playlistDoneId, addToPlaylist, resetPlaylistDone: () => setPlaylistDoneId(null) }
}
