// Optimistic playlist actions (see lib/appToast).
//
// addSongsInBackground is the background half of a multi-song "Add to
// playlist": the caller
// has already closed its menu / select mode as if the add succeeded; this
// sends the requests, refreshes the playlist summaries, toasts if any failed,
// and resolves to the song ids that didn't make it so the caller can roll
// back whatever it marked locally.
import * as userApi from './userApi'
import { showAppToast } from './appToast'
import { useStore } from '../store/useStore'

export async function addSongsInBackground(playlistId: number, songIds: number[]): Promise<number[]> {
  const results = await Promise.allSettled(songIds.map(id => userApi.addToPlaylist(playlistId, id)))
  const failed = songIds.filter((_, i) => results[i].status === 'rejected')
  void useStore.getState().refreshPlaylists()
  if (failed.length) {
    const name = useStore.getState().playlists.find(p => p.id === playlistId)?.name ?? 'playlist'
    showAppToast(failed.length === songIds.length
      ? `Couldn't add to "${name}"`
      : `${failed.length} of ${songIds.length} songs couldn't be added to "${name}"`)
  }
  return failed
}

// "Add all to playlist": copies every song in playlist `srcId` into
// `targetId` through addSongsInBackground, so failures toast (and offline
// playlists auto-download) the same as any other add. Shared by the playlist
// context menus and the multi-select bulk action.
export async function addPlaylistInBackground(srcId: number, targetId: number): Promise<void> {
  let src: Awaited<ReturnType<typeof userApi.getPlaylist>>
  try { src = await userApi.getPlaylist(srcId) } catch {
    showAppToast("Couldn't read that playlist")
    return
  }
  const ids = src.items.map(item => item.song.id)
  if (ids.length) await addSongsInBackground(targetId, ids)
}

// Flip a playlist's public flag in the store's summaries right away, then
// PATCH it; on failure flip it back and toast. Resolves to the flag the
// playlist ended up with.
export async function setPlaylistPublic(id: number, isPublic: boolean): Promise<boolean> {
  const patch = (value: boolean): void => {
    useStore.setState(s => ({ playlists: s.playlists.map(p => (p.id === id ? { ...p, is_public: value } : p)) }))
  }
  patch(isPublic)
  try {
    await userApi.updatePlaylist(id, { is_public: isPublic })
    void useStore.getState().refreshPlaylists()
    return isPublic
  } catch {
    patch(!isPublic)
    showAppToast(isPublic ? "Couldn't make the playlist public" : "Couldn't make the playlist private")
    return !isPublic
  }
}
