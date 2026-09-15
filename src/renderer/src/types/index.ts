export interface Track {
  id: string
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  year: number | null
  trackNumber: number | null
  duration: number
  genre: string
  hasAlbumArt: boolean
  // API-sourced tracks
  streamUrl?: string  // if set, Player streams this URL instead of the local `path` (via toFileUrl)
  imageUrl?: string   // if set, AlbumArtThumbnail uses this instead of getAlbumArt IPC
  era?: string        // API era abbreviation (e.g. "WOD") - shown on Discord RPC instead of album
  // The song's own title and cover as the API returns them. `title`/`imageUrl`
  // above may be a user's per-song override (see lib/songPrefs), and a Track
  // outlives the conversion that built it - it sits in the queue until the
  // user moves on - so the originals are kept here to let an override be
  // applied, changed, or removed in place without refetching the song. Only
  // set for API-sourced tracks; treat an absent value as "same as title".
  apiTitle?: string
  apiImageUrl?: string
}

export interface FullTrack extends Track {
  albumArt: string | null
  lyrics: string | null
  syncedLyrics: string | null
  // True for the brief window between a track change and the /songs/ fetch
  // resolving: lyrics are null but not yet confirmed absent, so WRLD's
  // layout should hold its current arrangement rather than read this as a
  // lyrics-less song. See Player's metadata-load effect.
  lyricsPending?: boolean
  producer: string | null
  notes: string | null
  ext: string
  error?: string
  // File technical info
  sampleRate?: number
  bitrate?: number
  bitsPerSample?: number
  channels?: number
  fileSize?: number
}


export interface LibraryTrack {
  id: string                  // 'local-' + filePath
  filePath: string
  ext: string                 // 'mp3', 'flac', etc.
  title: string
  artist: string
  album: string
  albumArtist: string
  year: number | null
  trackNumber: number | null
  discNumber: number | null
  composer: string
  genre: string
  duration: number
  bitrate: number | null
  sampleRate: number | null
  fileSize: number
  lastModified: number
  hasAlbumArt: boolean
  addedAt: number
  // Cover art is NOT stored here - it lives in the store's `libraryArt` map
  // (keyed by track id) so a streaming cover never mutates this list. This
  // optional field is only a transient seed some callers still read; treat the
  // map as the source of truth.
  albumArt?: string | null    // base64 data URL
}

export interface LocalPlaylist {
  id: string
  name: string
  trackIds: string[]          // LibraryTrack ids
  createdAt: number
  coverImage?: string | null  // base64 data URL or null
}

// A playlist for signed-out users - stored in localStorage, not tied to an
// account or to local-file scanning (unlike LocalPlaylist). Tracks are
// embedded directly rather than referenced by id, since a guest playlist can
// hold synced-catalog tracks a LibraryTrack lookup couldn't resolve.
export interface GuestPlaylist {
  id: string
  name: string
  tracks: Track[]
  createdAt: number
}

// A live pointer to someone else's synced playlist, saved from a share link
// without cloning its songs - opening it always re-fetches the owner's
// current playlist (see PlaylistsView's shared-view load path), so edits the
// owner makes later show up here too. Local-only: the account profile has no
// field for this yet, so unlike an owned playlist it doesn't sync across
// devices. name/trackCount/coverUrl are a display cache, refreshed
// opportunistically whenever this playlist is opened - never authoritative,
// just enough for the grid card to render before that fetch resolves.
export interface FollowedPlaylist {
  id: number
  name: string
  trackCount: number
  coverUrl: string | null
  followedAt: number
}

// ─── Offline playlist sync (Electron only) ─────────────────────────────────
// A downloaded API song, kept fully playable without network - the audio
// file plus a snapshot of the song's own metadata at download time.
export interface OfflineTrackMeta {
  path: string                // API song.path - changing this means the audio itself changed
  title: string
  artist: string
  album: string
  imageUrl: string | null
  lyrics: string | null
  syncedLyrics: string | null
  duration: number
  localPath: string
  ext: string
  downloadedAt: number
}

export interface OfflinePlaylistEntry {
  songIds: string[]           // track ids, e.g. "jw-123"
  name: string
  updatedAt: number
}

export interface SyncedLyricLine {
  time: number // seconds
  text: string
}

export type ViewType = 'home' | 'api-tracker' | 'api-files' | 'editor' | 'admin' | 'contributor' | 'contributor-profile' | 'liked' | 'playlists' | 'shared-playlist' | 'editor-profile' | 'docs' | 'wrld' | 'albums-admin' | 'news' | 'heardle' | 'wordle' | 'tierlist' | 'stats' | 'statistics' | 'download' | 'thanks' | 'settings' | 'not-found'
