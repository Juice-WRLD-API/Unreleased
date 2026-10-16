// "Add to playlist" done state, shared by ApiFilesView.desktop.tsx and
// .mobile.tsx - identical logic in both. Server playlists are keyed by
// numeric Tracker song id, so this only ever runs for audio files that
// resolved to a Tracker match (see useTrackerMatches) - the action stays
// hidden otherwise. Optimistic: the row ticks immediately and unticks (with
// a toast) if the request fails.
import { useState } from 'react'
import * as userApi from '../lib/userApi'
import { showAppToast } from '../lib/appToast'

export function useAddFileToPlaylist(refreshPlaylists: () => Promise<void>): {
  playlistDoneId: number | null
  addToPlaylist: (playlistId: number, songId: number) => void
  resetPlaylistDone: () => void
} {
  const [playlistDoneId, setPlaylistDoneId] = useState<number | null>(null)

  const addToPlaylist = (playlistId: number, songId: number): void => {
    setPlaylistDoneId(playlistId)
    userApi.addToPlaylist(playlistId, songId)
      .then(() => refreshPlaylists())
      .catch(() => {
        setPlaylistDoneId(prev => (prev === playlistId ? null : prev))
        showAppToast("Couldn't add to playlist")
      })
  }

  return { playlistDoneId, addToPlaylist, resetPlaylistDone: () => setPlaylistDoneId(null) }
}
