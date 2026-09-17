import type { Track } from '../types'

// A song share rides in a chat message's plain `content` (or, for DMs, the
// text that gets E2E-encrypted into it) - there's no separate embed/attachment
// schema on the backend, so the whole payload is inlined behind this prefix
// and MessageBody swaps it for a card instead of rendering it as markdown.
export const SONG_SHARE_PREFIX = 'unreleased:song:'

export interface SharedSongPayload {
  songId: number
  title: string
  artist: string
  imageUrl?: string
  streamUrl: string
  duration?: number
}

export function encodeSongShare(track: Track, songId: number): string {
  const payload: SharedSongPayload = {
    songId,
    title: track.apiTitle || track.title,
    artist: track.artist,
    imageUrl: track.apiImageUrl || track.imageUrl,
    streamUrl: track.streamUrl || '',
    duration: track.duration || undefined,
  }
  return `${SONG_SHARE_PREFIX}${JSON.stringify(payload)}`
}

export function decodeSongShare(content: string): SharedSongPayload | null {
  if (!content.startsWith(SONG_SHARE_PREFIX)) return null
  try {
    const payload = JSON.parse(content.slice(SONG_SHARE_PREFIX.length)) as SharedSongPayload
    if (!payload || typeof payload.title !== 'string' || typeof payload.streamUrl !== 'string') return null
    return payload
  } catch {
    return null
  }
}

export function songShareToTrack(payload: SharedSongPayload): Track {
  return {
    id: `jw-${payload.songId}`,
    path: payload.streamUrl,
    title: payload.title,
    artist: payload.artist,
    album: '',
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: payload.duration ?? 0,
    genre: '',
    hasAlbumArt: !!payload.imageUrl,
    streamUrl: payload.streamUrl,
    imageUrl: payload.imageUrl,
  }
}
