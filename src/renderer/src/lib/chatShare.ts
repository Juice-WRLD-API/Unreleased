import { isColor, SKIN_OPTIONAL_VAR_KEYS, SKIN_VAR_META, type Skin, type SkinVars } from './skins'

// A song share rides in a chat message's plain `content` (or, for DMs, the
// text that gets E2E-encrypted into it) - there's no separate embed/attachment
// schema on the backend, so the whole payload is inlined behind this prefix
// and MessageBody swaps it for a card instead of rendering it as markdown.
//
// The message carries only the song's id - never its title, art, or stream
// URL. Those used to ride along in the message text, which meant any chat
// member could hand-craft a "/song" message with fabricated info (wrong
// title, a spoofed cover, even a stream URL pointed elsewhere) since chat
// content is untrusted input, not something only this app produces. Card
// components look the real song up by id (SongShareCard, SongInfoCard), so
// what's shown always matches the actual library entry, never whatever text
// someone typed.
export const SONG_SHARE_PREFIX = 'unreleased:song:'
const MAX_SHARE_CONTENT_LENGTH = 4000
const MAX_TEXT_FIELD_LENGTH = 300

export interface SharedSongPayload {
  songId: number
}

export function encodeSongShare(songId: number): string {
  return `${SONG_SHARE_PREFIX}${songId}`
}

function isSafeText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_FIELD_LENGTH
}

// Covers can legitimately come from a wider set of hosts than streams (user
// cover overrides, era art, etc.), so this only blocks dangerous schemes
// (javascript:, file:, blob: pointing at a URL the recipient never created)
// rather than pinning to one origin.
function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_FIELD_LENGTH) return false
  return /^https:\/\//.test(value) || /^http:\/\//.test(value) || /^data:image\//.test(value)
}

function parseSongId(rest: string): number | null {
  if (!/^\d+$/.test(rest)) return null
  const songId = Number(rest)
  return Number.isInteger(songId) && songId > 0 ? songId : null
}

export function decodeSongShare(content: string): SharedSongPayload | null {
  if (!content.startsWith(SONG_SHARE_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  const songId = parseSongId(content.slice(SONG_SHARE_PREFIX.length))
  return songId === null ? null : { songId }
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

// Same "id only, looked up fresh" scheme as SONG_SHARE_PREFIX above - this one
// backs /info's card. It deliberately carries no streamUrl even indirectly:
// unlike /song, this card is read-only metadata, not something that plays
// audio.
export const SONG_INFO_PREFIX = 'unreleased:info:'

export interface SharedSongInfoPayload {
  songId: number
}

export function encodeSongInfoShare(songId: number): string {
  return `${SONG_INFO_PREFIX}${songId}`
}

export function decodeSongInfoShare(content: string): SharedSongInfoPayload | null {
  if (!content.startsWith(SONG_INFO_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  const songId = parseSongId(content.slice(SONG_INFO_PREFIX.length))
  return songId === null ? null : { songId }
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

// Moderation notice, posted into the channel by whoever took the action so the
// room can see what happened. Same "prefix + JSON in plain chat text" scheme as
// the shares above, which means the same caveat applies with more force: this
// is an ordinary message anyone could hand-craft, not a server-issued system
// event. The card is deliberately rendered inside the normal message frame,
// author and all, so it always reads as "<author> says this happened" rather
// than as something the server is vouching for.
export const MODERATION_PREFIX = 'unreleased:mod:'

export type ModerationNoticeAction = 'mute' | 'unmute' | 'timeout' | 'untimeout' | 'kick' | 'ban' | 'unban'

const MODERATION_ACTIONS: ModerationNoticeAction[] = ['mute', 'unmute', 'timeout', 'untimeout', 'kick', 'ban', 'unban']

export interface ModerationNoticePayload {
  action: ModerationNoticeAction
  userId: number
  // Target's display name as it read when the action was taken - the card
  // shows this rather than re-resolving, since a kicked or banned user is no
  // longer in the member list to look up.
  name: string
  // Minutes, for a timeout or a temporary site-wide action.
  minutes?: number
  reason?: string
  // The site-wide variant of the same action, which covers every server and DMs.
  site?: boolean
}

export function encodeModerationNotice(payload: ModerationNoticePayload): string {
  return `${MODERATION_PREFIX}${JSON.stringify({
    action: payload.action,
    userId: payload.userId,
    name: payload.name.slice(0, MAX_TEXT_FIELD_LENGTH),
    minutes: payload.minutes,
    reason: payload.reason ? payload.reason.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined,
    site: payload.site || undefined,
  })}`
}

export function decodeModerationNotice(content: string): ModerationNoticePayload | null {
  if (!content.startsWith(MODERATION_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(MODERATION_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!MODERATION_ACTIONS.includes(p.action as ModerationNoticeAction)) return null
  if (!Number.isInteger(p.userId) || (p.userId as number) <= 0) return null
  if (!isSafeText(p.name)) return null
  if (p.minutes !== undefined && (!Number.isInteger(p.minutes) || (p.minutes as number) <= 0)) return null
  if (p.reason !== undefined && !isSafeText(p.reason)) return null
  if (p.site !== undefined && typeof p.site !== 'boolean') return null

  return {
    action: p.action as ModerationNoticeAction,
    userId: p.userId as number,
    name: p.name as string,
    minutes: p.minutes as number | undefined,
    reason: p.reason as string | undefined,
    site: p.site as boolean | undefined,
  }
}

// "Timed out for 10 minutes" / "Banned" - the verb phrase both the card and the
// plain-text summary below build their sentence from.
export function moderationNoticeVerb(payload: ModerationNoticePayload): string {
  const scope = payload.site ? ' site-wide' : ''
  switch (payload.action) {
    case 'mute': return `was muted${scope}`
    case 'unmute': return `was unmuted${scope}`
    case 'timeout': return payload.minutes
      ? `was timed out${scope} for ${formatMinutes(payload.minutes)}`
      : `was timed out${scope}`
    case 'untimeout': return `had their timeout lifted${scope}`
    case 'kick': return 'was kicked from the server'
    case 'ban': return payload.minutes
      ? `was banned${scope} for ${formatMinutes(payload.minutes)}`
      : `was banned${scope}`
    case 'unban': return `was unbanned${scope}`
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  if (minutes < 1440) {
    const h = Math.round((minutes / 60) * 10) / 10
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = Math.round((minutes / 1440) * 10) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}

// Marker for /help's command list card. Unlike the shares above this never
// rides in an actual chat message's content - it only ever lives in a
// client-side UiMessage (see chatStore's postLocalNotice), so there's no
// encode/decode round trip through the server or other clients to guard.
export const LOCAL_HELP_MARKER = 'unreleased:localhelp'

// Plain-text summary for surfaces that can't render the rich card (notification
// banners, OS notifications) - falls through the three share types before
// treating the content as a regular message.
export function shareSummaryText(content: string): string | null {
  if (decodeSongShare(content)) return 'Shared a song'
  const playlist = decodePlaylistShare(content)
  if (playlist) return `Shared a playlist: ${playlist.name}`
  const news = decodeNewsShare(content)
  if (news) return `Shared a news post: ${news.title}`
  if (decodeSongInfoShare(content)) return 'Shared song info'
  const theme = decodeThemeShare(content)
  if (theme) return `Shared a theme: ${theme.name}`
  const moderation = decodeModerationNotice(content)
  if (moderation) return `${moderation.name} ${moderationNoticeVerb(moderation)}`
  return null
}
