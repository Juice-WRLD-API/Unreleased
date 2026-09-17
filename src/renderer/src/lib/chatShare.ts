import { JWAPI_BASE } from './juicewrldApi'
import type { Track } from '../types'

// A song share rides in a chat message's plain `content` (or, for DMs, the
// text that gets E2E-encrypted into it) - there's no separate embed/attachment
// schema on the backend, so the whole payload is inlined behind this prefix
// and MessageBody swaps it for a card instead of rendering it as markdown.
//
// Because that content is just chat text, ANY chat member can hand-craft a
// message with this prefix - decodeSongShare is untrusted input, not a value
// this app produced. A forged payload must not be able to make MessageBody
// render arbitrary attacker-controlled UI as if it were a real song card, or
// point playback (an <audio> src, fetched automatically) at an arbitrary
// origin. So every field is re-validated on decode, independent of whatever
// encodeSongShare puts in: streamUrl is pinned to JWAPI_BASE (the only origin
// a real song ever streams from), imageUrl is limited to http(s)/data image
// URLs, and the text/number fields get type and length bounds.
export const SONG_SHARE_PREFIX = 'unreleased:song:'
const MAX_SHARE_CONTENT_LENGTH = 4000
const MAX_TEXT_FIELD_LENGTH = 300

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

function isSafeText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_FIELD_LENGTH
}

// Only the API's own file endpoint ever legitimately backs a song stream -
// anchoring on it keeps a forged share from pointing playback (which fetches
// automatically once the card renders) at an attacker-controlled origin.
function isTrustedStreamUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_FIELD_LENGTH && value.startsWith(`${JWAPI_BASE}/`)
}

// Covers can legitimately come from a wider set of hosts than streams (user
// cover overrides, era art, etc.), so this only blocks dangerous schemes
// (javascript:, file:, blob: pointing at a URL the recipient never created)
// rather than pinning to one origin.
function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_FIELD_LENGTH) return false
  return /^https:\/\//.test(value) || /^http:\/\//.test(value) || /^data:image\//.test(value)
}

export function decodeSongShare(content: string): SharedSongPayload | null {
  if (!content.startsWith(SONG_SHARE_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(SONG_SHARE_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!Number.isInteger(p.songId) || (p.songId as number) <= 0) return null
  if (!isSafeText(p.title) || !isSafeText(p.artist)) return null
  if (!isTrustedStreamUrl(p.streamUrl)) return null
  if (p.imageUrl !== undefined && !isSafeImageUrl(p.imageUrl)) return null
  if (p.duration !== undefined && (typeof p.duration !== 'number' || !Number.isFinite(p.duration) || p.duration < 0)) return null

  return {
    songId: p.songId as number,
    title: p.title as string,
    artist: p.artist as string,
    imageUrl: p.imageUrl as string | undefined,
    streamUrl: p.streamUrl as string,
    duration: p.duration as number | undefined,
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
