// "Add to playlist" busy/done state, shared by ApiFilesView.desktop.tsx and
// .mobile.tsx - identical logic in both. Server playlists are keyed by
// numeric Tracker song id, so this only ever runs for audio files that
// resolved to a Tracker match (see useTrackerMatches) - the action stays
// hidden otherwise.
import { useState } from 'react'
import * as userApi from '../lib/userApi'

export function useAddFileToPlaylist(refreshPlaylists: () => Promise<void>): {
  playlistBusyId: number | null
  playlistDoneId: number | null
  addToPlaylist: (playlistId: number, songId: number) => Promise<void>
  resetPlaylistDone: () => void
} {
  const [playlistBusyId, setPlaylistBusyId] = useState<number | null>(null)
  const [playlistDoneId, setPlaylistDoneId] = useState<number | null>(null)

  const addToPlaylist = async (playlistId: number, songId: number): Promise<void> => {
    setPlaylistBusyId(playlistId)
    try {
      await userApi.addToPlaylist(playlistId, songId)
      setPlaylistDoneId(playlistId)
      await refreshPlaylists()
    } catch {} finally { setPlaylistBusyId(null) }
  }

  return { playlistBusyId, playlistDoneId, addToPlaylist, resetPlaylistDone: () => setPlaylistDoneId(null) }
}
