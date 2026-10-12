import { useStore } from '../store/useStore'
import { toStreamUrl } from './localLibrary'
import { IS_NATIVE_APP } from './platform'

export const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.opus', '.wma', '.alac', '.caf', '.aiff', '.aif'])
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'])
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'])
// Plain-text formats the in-app viewer can render. Deliberately conservative:
// anything not listed here falls through to 'other' and is left to download /
// the system app rather than being decoded as text.
export const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.log', '.json', '.xml', '.csv', '.tsv',
  '.yml', '.yaml', '.ini', '.cfg', '.conf', '.nfo', '.srt', '.vtt', '.lrc',
  '.html', '.htm', '.css', '.js', '.ts', '.py', '.sh', '.bat', '.sql',
])

export type FileMediaType = 'audio' | 'image' | 'video' | 'text' | 'folder' | 'other'

export function getFileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function getMediaType(name: string): FileMediaType {
  const ext = getFileExt(name)
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

// Capacitor proxies content/file URIs through its local server. Desktop's
// custom protocol remains the fallback for non-native builds.
export function toFileUrl(absPath: string): string {
  if (IS_NATIVE_APP) return toStreamUrl(absPath)
  const url = new URL('local-media://play/')
  url.searchParams.set('p', absPath)
  return url.toString()
}

// Converts a scanned library file into the queue/player Track shape - the
// single conversion every local-file play path goes through. Cover art lives in
// the store's libraryArt map (not on the track), so seed the queue thumbnail
// from there if it's already been read; covers read later stream in via
// applyLibraryArt's queue fan-out.
export function libraryTrackToTrack(t: import('../types').LibraryTrack): import('../types').Track {
  const offline = useStore.getState().offlineTracks[t.id]
  const art = useStore.getState().libraryArt[t.id] ?? offline?.imageUrl
  return {
    id: t.id,
    path: offline?.path ?? t.filePath,
    streamUrl: toFileUrl(t.filePath),
    imageUrl: art || '',
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist,
    year: t.year,
    trackNumber: t.trackNumber,
    duration: t.duration,
    genre: t.genre,
    hasAlbumArt: t.hasAlbumArt,
  }
}

export function offlineTrackToLibraryTrack(id: string, t: import('../types').OfflineTrackMeta): import('../types').LibraryTrack {
  return {
    id, filePath: t.localPath, ext: t.ext, title: t.title, artist: t.artist,
    album: t.album, albumArtist: t.artist, year: null, trackNumber: null,
    discNumber: null, composer: '', genre: '', duration: t.duration, bitrate: null,
    sampleRate: null, fileSize: 0, lastModified: t.downloadedAt,
    hasAlbumArt: !!t.imageUrl, addedAt: t.downloadedAt,
  }
}
