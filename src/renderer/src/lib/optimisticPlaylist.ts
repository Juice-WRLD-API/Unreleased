// Optimistic playlist actions (see lib/appToast).
//
// addSongsInBackground is the background half of a multi-song "Add to
// playlist": the caller
// has already closed its menu / select mode as if the add succeeded; this
// sends the requests, refreshes the playlist summaries, auto-downloads the
// added songs if the playlist is kept offline, toasts if any failed,
// and resolves to the song ids that didn't make it so the caller can roll
// back whatever it marked locally.
import * as userApi from './userApi'
import type { PlaylistEntryInput } from './userApi'
import { showAppToast } from './appToast'
import { useStore } from '../store/useStore'
import { isPrivateEntry, playlistItemToEntry, trackToPlaylistEntry } from './playlistItems'
import type { Track } from '../types'

export async function addSongsInBackground(playlistId: number, songIds: number[]): Promise<number[]> {
  const results = await Promise.allSettled(songIds.map(id => userApi.addToPlaylist(playlistId, id)))
  const failed = songIds.filter((_, i) => results[i].status === 'rejected')
  void useStore.getState().refreshPlaylists()
  const added = songIds.filter((_, i) => results[i].status === 'fulfilled')
  if (added.length) void useStore.getState().autoDownloadIfOffline(playlistId, added)
  if (failed.length) {
    const name = useStore.getState().playlists.find(p => p.id === playlistId)?.name ?? 'playlist'
    showAppToast(failed.length === songIds.length
      ? `Couldn't add to "${name}"`
      : `${failed.length} of ${songIds.length} songs couldn't be added to "${name}"`)
  }
  return failed
}

// The same for entries of any source (comp, donor and local files as well as
// songs). Sent one at a time so they land in order. Donor and local files
// can't go in a public playlist, so those are left out up front with a toast
// rather than sent to fail. Resolves to the entries that didn't make it.
export async function addEntriesInBackground(playlistId: number, entries: PlaylistEntryInput[]): Promise<PlaylistEntryInput[]> {
  const playlist = useStore.getState().playlists.find(p => p.id === playlistId)
  const name = playlist?.name ?? 'playlist'
  const blocked = playlist?.is_public ? entries.filter(isPrivateEntry) : []
  const toSend = blocked.length ? entries.filter(e => !isPrivateEntry(e)) : entries
  const failed: PlaylistEntryInput[] = [...blocked]
  for (const entry of toSend) {
    try { await userApi.addPlaylistEntry(playlistId, entry) } catch { failed.push(entry) }
  }
  void useStore.getState().refreshPlaylists()
  const addedSongs = toSend
    .filter(e => !failed.includes(e) && 'song_id' in e)
    .map(e => (e as { song_id: number }).song_id)
  if (addedSongs.length) void useStore.getState().autoDownloadIfOffline(playlistId, addedSongs)
  if (blocked.length) {
    showAppToast(`"${name}" is public, so your own and local files can't go in it`)
  } else if (failed.length) {
    showAppToast(failed.length === entries.length
      ? `Couldn't add to "${name}"`
      : `${failed.length} of ${entries.length} tracks couldn't be added to "${name}"`)
  }
  return failed
}

/** addEntriesInBackground for Tracks. Resolves to the tracks that weren't
 *  added, including any that can't go in a synced playlist at all. */
export async function addTracksInBackground(playlistId: number, tracks: Track[]): Promise<Track[]> {
  const pairs = tracks.map(t => ({ t, e: trackToPlaylistEntry(t) }))
  const sendable = pairs.filter((p): p is { t: Track; e: PlaylistEntryInput } => p.e != null)
  // Plain songs keep the parallel path above.
  if (sendable.every(p => 'song_id' in p.e)) {
    const ids = sendable.map(p => (p.e as { song_id: number }).song_id)
    const failedIds = new Set(ids.length ? await addSongsInBackground(playlistId, ids) : [])
    return pairs.filter(p => !p.e || failedIds.has((p.e as { song_id: number }).song_id)).map(p => p.t)
  }
  const failed = new Set(await addEntriesInBackground(playlistId, sendable.map(p => p.e)))
  return pairs.filter(p => !p.e || failed.has(p.e)).map(p => p.t)
}

// "Add all to playlist": copies every entry in playlist `srcId` into
// `targetId` through addEntriesInBackground, so failures toast (and offline
// playlists auto-download) the same as any other add. Shared by the playlist
// context menus and the multi-select bulk action.
export async function addPlaylistInBackground(srcId: number, targetId: number): Promise<void> {
  let src: Awaited<ReturnType<typeof userApi.getPlaylist>>
  try { src = await userApi.getPlaylist(srcId) } catch {
    showAppToast("Couldn't read that playlist")
    return
  }
  const entries = src.items.map(playlistItemToEntry).filter((e): e is PlaylistEntryInput => e != null)
  if (!entries.length) return
  if (entries.every(e => 'song_id' in e)) await addSongsInBackground(targetId, entries.map(e => (e as { song_id: number }).song_id))
  else await addEntriesInBackground(targetId, entries)
}

export const PRIVATE_PLAYLIST_REASON = "Playlists with your own or local files can't be public"

// Flip a playlist's public flag in the store's summaries right away, then
// PATCH it; on failure flip it back and toast. Resolves to the flag the
// playlist ended up with.
export async function setPlaylistPublic(id: number, isPublic: boolean): Promise<boolean> {
  if (isPublic && useStore.getState().playlists.find(p => p.id === id)?.can_be_public === false) {
    showAppToast(PRIVATE_PLAYLIST_REASON)
    return false
  }
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
