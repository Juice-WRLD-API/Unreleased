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

// Same "prefix + JSON in plain chat text" scheme as song shares, and the same
// untrusted-input rules apply on decode - any chat member could hand-craft
// this text, and imageUrl is the only field here that names a URL, so it gets
// the same scheme/host restriction as a song's cover.
export const PLAYLIST_SHARE_PREFIX = 'unreleased:playlist:'

export interface SharedPlaylistPayload {
  playlistId: number
  name: string
  imageUrl?: string
  trackCount?: number
}

export function encodePlaylistShare(playlist: { id: number; name: string; cover_image_url?: string | null; cover_image?: string | null; track_count?: number }): string {
  const payload: SharedPlaylistPayload = {
    playlistId: playlist.id,
    name: playlist.name,
    imageUrl: playlist.cover_image_url || playlist.cover_image || undefined,
    trackCount: playlist.track_count,
  }
  return `${PLAYLIST_SHARE_PREFIX}${JSON.stringify(payload)}`
}

export function decodePlaylistShare(content: string): SharedPlaylistPayload | null {
  if (!content.startsWith(PLAYLIST_SHARE_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(PLAYLIST_SHARE_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!Number.isInteger(p.playlistId) || (p.playlistId as number) <= 0) return null
  if (!isSafeText(p.name)) return null
  if (p.imageUrl !== undefined && !isSafeImageUrl(p.imageUrl)) return null
  if (p.trackCount !== undefined && (typeof p.trackCount !== 'number' || !Number.isFinite(p.trackCount) || p.trackCount < 0)) return null

  return {
    playlistId: p.playlistId as number,
    name: p.name as string,
    imageUrl: p.imageUrl as string | undefined,
    trackCount: p.trackCount as number | undefined,
  }
}

// Same "prefix + JSON in plain chat text" scheme as song/playlist shares, and
// the same untrusted-input rules apply on decode - any chat member could
// hand-craft this text, so postId/title/summary/imageUrl are all re-validated
// independent of whatever encodeNewsShare puts in.
export const NEWS_SHARE_PREFIX = 'unreleased:news:'

export interface SharedNewsPayload {
  postId: number
  title: string
  summary?: string
  imageUrl?: string
}

export function encodeNewsShare(item: { id: number; title: string; summary?: string | null; image_url?: string | null }): string {
  const payload: SharedNewsPayload = {
    postId: item.id,
    title: item.title,
    summary: item.summary || undefined,
    imageUrl: item.image_url || undefined,
  }
  return `${NEWS_SHARE_PREFIX}${JSON.stringify(payload)}`
}

export function decodeNewsShare(content: string): SharedNewsPayload | null {
  if (!content.startsWith(NEWS_SHARE_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(NEWS_SHARE_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!Number.isInteger(p.postId) || (p.postId as number) <= 0) return null
  if (!isSafeText(p.title)) return null
  if (p.summary !== undefined && !isSafeText(p.summary)) return null
  if (p.imageUrl !== undefined && !isSafeImageUrl(p.imageUrl)) return null

  return {
    postId: p.postId as number,
    title: p.title as string,
    summary: p.summary as string | undefined,
    imageUrl: p.imageUrl as string | undefined,
  }
}

// Plain-text summary for surfaces that can't render the rich card (notification
// banners, OS notifications) - falls through the three share types before
// treating the content as a regular message.
export function shareSummaryText(content: string): string | null {
  const song = decodeSongShare(content)
  if (song) return `Shared a song: ${song.title} - ${song.artist}`
  const playlist = decodePlaylistShare(content)
  if (playlist) return `Shared a playlist: ${playlist.name}`
  const news = decodeNewsShare(content)
  if (news) return `Shared a news post: ${news.title}`
  return null
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
