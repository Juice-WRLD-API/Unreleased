// Synced playlists hold four kinds of entry (see userApi PlaylistItemSource):
// catalogue songs, files from any comp channel, the owner's donor uploads, and
// files from a device's local library. Everything that reads a playlist goes
// through here to turn entries into Tracks, and everything that adds to one
// goes through trackToPlaylistEntry, so the two directions agree on ids: an
// entry's Track id is the same id the Track it was added from had.
import type { LibraryTrack, Track } from '../types'
import type { PlaylistEntryInput, PlaylistItemEntry, PlaylistItemSource } from './userApi'
import { liteSongToTrack, trackIdToSongId } from './userApi'
import { apiFileIdToRef, apiFilePathToTrack } from './juicewrldApi'
import { donorFileIdFromTrackId, donorFileToTrack } from './donorPlayback'
import { libraryTrackToTrack } from './fileTypes'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { useStore } from '../store/useStore'

/** The server's limit on local_id. A longer library id can't be stored. */
const LOCAL_ID_MAX = 255

export const PRIVATE_SOURCES: readonly PlaylistItemSource[] = ['donor', 'local']

export function itemSource(item: PlaylistItemEntry): PlaylistItemSource {
  return item.source ?? 'song'
}

// A comp entry carries its channel's slug even for the primary tree, but a
// primary file's Track id has no channel (see apiFileTrackId), so drop it there
// to keep ids matching likes, the queue and the Files tab. Until the channel
// list loads, only the default primary slug is known to be primary.
function trackChannelFor(slug: string | null | undefined): string | undefined {
  if (!slug) return undefined
  const channels = useStore.getState().channels
  const primary = channels.length ? isPrimaryChannelSlug(channels, slug) : slug === 'comp'
  return primary ? undefined : slug
}

// An entry this device can't play: a local file added on another device, or a
// song/donor file that's since gone. Kept in the list so it can be removed.
function unavailableTrack(id: string, title: string, artist: string): Track {
  return {
    id, path: '', title, artist, album: '', albumArtist: '', year: null,
    trackNumber: null, duration: 0, genre: '', hasAlbumArt: false,
  }
}

function itemToTrack(item: PlaylistItemEntry, library: Map<string, LibraryTrack> | null): Track {
  switch (itemSource(item)) {
    case 'comp': {
      const track = apiFilePathToTrack(item.filepath ?? '', undefined, trackChannelFor(item.channel))
      return item.title ? { ...track, title: item.title } : track
    }
    case 'donor':
      return item.donor_file
        ? donorFileToTrack(item.donor_file)
        : unavailableTrack(`playlist-item-${item.id}`, item.title || 'Deleted file', 'My files')
    case 'local': {
      const id = item.local_id ?? ''
      const found = library?.get(id)
      return found ? libraryTrackToTrack(found) : unavailableTrack(id || `playlist-item-${item.id}`, item.title || 'Local file', 'Not on this device')
    }
    default:
      return item.song ? liteSongToTrack(item.song) : unavailableTrack(`playlist-item-${item.id}`, item.title || 'Removed song', '')
  }
}

/** One Track per entry, in the same order (index i is items[i]). */
export function playlistItemsToTracks(items: PlaylistItemEntry[] | null | undefined): Track[] {
  const list = items ?? []
  const library = list.some(it => itemSource(it) === 'local')
    ? new Map(useStore.getState().libraryTracks.map(t => [t.id, t]))
    : null
  return list.map(it => itemToTrack(it, library))
}

/** Catalogue song ids in the playlist, for membership checks and offline
 *  downloads (which only cover songs). */
export function playlistSongIds(items: PlaylistItemEntry[] | null | undefined): number[] {
  const ids: number[] = []
  for (const it of items ?? []) if (it.song) ids.push(it.song.id)
  return ids
}

/** The Track id each entry renders as, for "is this track already in it". */
export function playlistTrackIds(items: PlaylistItemEntry[]): Set<string> {
  return new Set(playlistItemsToTracks(items).map(t => t.id))
}

/** What to POST to add this track, or null when it can't go in a synced
 *  playlist (an offline-only or otherwise unknown track). */
export function trackToPlaylistEntry(track: Track): PlaylistEntryInput | null {
  const songId = trackIdToSongId(track.id)
  if (songId != null) return { song_id: songId }
  const ref = apiFileIdToRef(track.id)
  if (ref) return { source: 'comp', path: ref.path, ...(ref.channel ? { channel: ref.channel } : {}) }
  const fileId = donorFileIdFromTrackId(track.id)
  if (fileId) return { source: 'donor', file_id: fileId }
  if (track.id.startsWith('local-') && track.id.length <= LOCAL_ID_MAX) {
    return { source: 'local', local_id: track.id, title: track.title.slice(0, 255) }
  }
  return null
}

/** The body that re-adds an existing entry, for copying between playlists. */
export function playlistItemToEntry(item: PlaylistItemEntry): PlaylistEntryInput | null {
  switch (itemSource(item)) {
    case 'comp':
      return item.filepath ? { source: 'comp', path: item.filepath, ...(item.channel ? { channel: item.channel } : {}), ...(item.title ? { title: item.title } : {}) } : null
    case 'donor':
      return item.donor_file ? { source: 'donor', file_id: item.donor_file.file_id, ...(item.title ? { title: item.title } : {}) } : null
    case 'local':
      return item.local_id ? { source: 'local', local_id: item.local_id, ...(item.title ? { title: item.title } : {}) } : null
    default:
      return item.song ? { song_id: item.song.id } : null
  }
}

export function isPrivateEntry(entry: PlaylistEntryInput): boolean {
  return entry.source === 'donor' || entry.source === 'local'
}

/** For a list that only has Tracks (selection, queue): the entry each one
 *  came from, matched by Track id. */
export function playlistItemsByTrackId(items: PlaylistItemEntry[]): Map<string, PlaylistItemEntry> {
  const tracks = playlistItemsToTracks(items)
  return new Map(tracks.map((t, i) => [t.id, items[i]]))
}

/** Tracks that point at a server file anyone can fetch by URL: what ZIP and
 *  M3U exports can carry. Donor files need the owner's token and local files
 *  are already on the owner's disk. */
export function isServerFileTrack(t: Track): boolean {
  return !!t.path && !t.id.startsWith('donor-file-') && !t.id.startsWith('local-')
}
