import { JWAPI_BASE } from './juicewrldApi'
import { isColor, SKIN_OPTIONAL_VAR_KEYS, SKIN_VAR_META, type Skin, type SkinVars } from './skins'
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

// Same "prefix + JSON in plain chat text" scheme as the other shares above -
// this one backs /info's card. It deliberately carries no streamUrl: unlike
// /song, this card is read-only metadata, not something that plays audio, so
// it doesn't need the stream-origin pinning that makes SongShareCard safe to
// auto-wire into an <audio> element.
export const SONG_INFO_PREFIX = 'unreleased:info:'

const CATEGORY_KEYS = new Set(['released', 'unreleased', 'unsurfaced', 'recording_session'])

export interface SharedSongInfoPayload {
  songId: number
  title: string
  category: string
  length: string
  era?: string
  artists?: string
  producers?: string
  releaseDate?: string
  leakedDate?: string
  imageUrl?: string
}

export function encodeSongInfoShare(song: {
  id: number
  name: string
  era?: { name: string } | null
  category: string
  length: string
  credited_artists?: string | null
  producers?: string | null
  release_date?: string | null
  date_leaked?: string | null
}, imageUrl?: string): string {
  const payload: SharedSongInfoPayload = {
    songId: song.id,
    title: song.name,
    category: song.category,
    length: song.length,
    era: song.era?.name || undefined,
    artists: song.credited_artists || undefined,
    producers: song.producers || undefined,
    releaseDate: song.release_date || undefined,
    leakedDate: song.date_leaked || undefined,
    imageUrl,
  }
  return `${SONG_INFO_PREFIX}${JSON.stringify(payload)}`
}

export function decodeSongInfoShare(content: string): SharedSongInfoPayload | null {
  if (!content.startsWith(SONG_INFO_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(SONG_INFO_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!Number.isInteger(p.songId) || (p.songId as number) <= 0) return null
  if (!isSafeText(p.title) || !isSafeText(p.length)) return null
  if (typeof p.category !== 'string' || !CATEGORY_KEYS.has(p.category)) return null
  if (p.era !== undefined && !isSafeText(p.era)) return null
  if (p.artists !== undefined && !isSafeText(p.artists)) return null
  if (p.producers !== undefined && !isSafeText(p.producers)) return null
  if (p.releaseDate !== undefined && !isSafeText(p.releaseDate)) return null
  if (p.leakedDate !== undefined && !isSafeText(p.leakedDate)) return null
  if (p.imageUrl !== undefined && !isSafeImageUrl(p.imageUrl)) return null

  return {
    songId: p.songId as number,
    title: p.title as string,
    category: p.category as string,
    length: p.length as string,
    era: p.era as string | undefined,
    artists: p.artists as string | undefined,
    producers: p.producers as string | undefined,
    releaseDate: p.releaseDate as string | undefined,
    leakedDate: p.leakedDate as string | undefined,
    imageUrl: p.imageUrl as string | undefined,
  }
}

// Same "prefix + JSON in plain chat text" scheme as the other shares above -
// this one backs /sharetheme's card. It carries the full palette (not just an
// id) because a shared skin may be one the recipient has never seen - a
// built-in id could just be looked up, but a custom skin only exists in the
// sender's local store, so the whole vars object rides along and the card
// applies it as a brand-new custom skin on the recipient's side. Every color
// is re-validated with the same isColor check the skin-file importer uses,
// so a forged payload can't smuggle anything but a plausible CSS color into
// an inline style.
export const THEME_SHARE_PREFIX = 'unreleased:theme:'

export interface SharedThemePayload {
  name: string
  dark: boolean
  accent?: string
  vars: SkinVars
}

export function encodeThemeShare(skin: Skin): string {
  const payload: SharedThemePayload = {
    name: skin.name,
    dark: skin.dark,
    accent: skin.accent,
    vars: skin.vars,
  }
  return `${THEME_SHARE_PREFIX}${JSON.stringify(payload)}`
}

export function decodeThemeShare(content: string): SharedThemePayload | null {
  if (!content.startsWith(THEME_SHARE_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(THEME_SHARE_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!isSafeText(p.name)) return null
  if (typeof p.dark !== 'boolean') return null
  if (p.accent !== undefined && !isColor(p.accent)) return null
  if (!p.vars || typeof p.vars !== 'object') return null
  const rawVars = p.vars as Record<string, unknown>
  const vars = {} as SkinVars
  for (const { key } of SKIN_VAR_META) {
    const v = rawVars[key]
    if (!isColor(v)) return null
    vars[key] = v
  }
  for (const key of SKIN_OPTIONAL_VAR_KEYS) {
    const v = rawVars[key]
    if (isColor(v)) vars[key] = v
  }

  return {
    name: p.name as string,
    dark: p.dark,
    accent: p.accent as string | undefined,
    vars,
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
  const info = decodeSongInfoShare(content)
  if (info) return `Song info: ${info.title}`
  const theme = decodeThemeShare(content)
  if (theme) return `Shared a theme: ${theme.name}`
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
