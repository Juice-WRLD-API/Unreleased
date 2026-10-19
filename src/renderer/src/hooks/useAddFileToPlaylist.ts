// "Add to playlist" done state, shared by ApiFilesView.desktop.tsx and
// .mobile.tsx - identical logic in both. Server playlists are keyed by
// numeric Tracker song id, so this only ever runs for audio files that
// resolved to a Tracker match (see useTrackerMatches) - the action stays
// hidden otherwise. Optimistic: the row ticks immediately and unticks (with
// a toast, via addSongsInBackground) if the request fails.
import { useState } from 'react'
import { addSongsInBackground } from '../lib/optimisticPlaylist'

export function useAddFileToPlaylist(): {
  playlistDoneId: number | null
  addToPlaylist: (playlistId: number, songId: number) => void
  resetPlaylistDone: () => void
} {
  const [playlistDoneId, setPlaylistDoneId] = useState<number | null>(null)

  const addToPlaylist = (playlistId: number, songId: number): void => {
    setPlaylistDoneId(playlistId)
    void addSongsInBackground(playlistId, [songId]).then(failed => {
      if (failed.length) setPlaylistDoneId(prev => (prev === playlistId ? null : prev))
    })
  }

  return { playlistDoneId, addToPlaylist, resetPlaylistDone: () => setPlaylistDoneId(null) }
}
