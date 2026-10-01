import type { ChangelogStatus } from './appVersion'
import { BROADCAST_LEVELS, type BroadcastLevel, type BroadcastMessage } from './broadcastApi'
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

// Cheap prefix test for callers that only need "is this a moderation card?"
// on every render (message grouping, row chrome) without paying for the JSON
// parse and field validation decodeModerationNotice does.
export function isModerationNotice(content: string): boolean {
  return content.startsWith(MODERATION_PREFIX)
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

// Second-person wording for the notification the target themselves gets.
// Derived separately rather than by patching the third-person verb: "had
// their timeout lifted" doesn't survive a pronoun swap.
export function moderationNoticeSelfText(payload: ModerationNoticePayload): string {
  const scope = payload.site ? ' site-wide' : ''
  switch (payload.action) {
    case 'mute': return `You were muted${scope}`
    case 'unmute': return `You were unmuted${scope}`
    case 'timeout': return payload.minutes
      ? `You were timed out${scope} for ${formatMinutes(payload.minutes)}`
      : `You were timed out${scope}`
    case 'untimeout': return `Your timeout was lifted${scope}`
    case 'kick': return 'You were removed from the server'
    case 'ban': return payload.minutes
      ? `You were banned${scope} for ${formatMinutes(payload.minutes)}`
      : `You were banned${scope}`
    case 'unban': return `You were unbanned${scope}`
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

// Backs /help, /theme (no args) and /feedback's confirmation. Unlike the
// shares above these never ride in an actual chat message's content - they
// only ever live in a client-side UiMessage (see chatStore's
// postLocalNotice), so there's no encode/decode round trip through the
// server or other clients to guard against: the payload always comes from
// our own code, never from typed/attacker-editable text.
export const LOCAL_NOTICE_PREFIX = 'unreleased:localnotice:'

export type LocalNoticePayload =
  | { kind: 'help' }
  | { kind: 'themeList' }
  | { kind: 'feedbackSent'; message: string }
  | { kind: 'broadcastHistory'; items: BroadcastMessage[]; total: number }
  | { kind: 'changelog'; status: ChangelogStatus }
  | { kind: 'npHistory'; items: { song: number; name: string; played_at: string }[]; total: number; capped: boolean; user?: string }
  | { kind: 'npNow'; user: string; song: number; name: string; updated_at: string }
  // A command's plain answer ("Muted X", "Theme set to Y") as a card.
  | { kind: 'result'; title: string; text: string }

export function encodeLocalNotice(payload: LocalNoticePayload): string {
  return `${LOCAL_NOTICE_PREFIX}${JSON.stringify(payload)}`
}

export function decodeLocalNotice(content: string): LocalNoticePayload | null {
  if (!content.startsWith(LOCAL_NOTICE_PREFIX)) return null
  try {
    return JSON.parse(content.slice(LOCAL_NOTICE_PREFIX.length)) as LocalNoticePayload
  } catch {
    return null
  }
}

// A command card posted to the room with `-s` (/help -s, /np -h -s, ...). It's
// the same card the sender would have seen privately, carried as a message so
// everyone renders it. Same "prefix + JSON in plain chat text" scheme as the
// shares above and the same rule on decode: any member could hand-craft this
// text, so every field is re-validated and clamped, and nothing here is trusted
// beyond "the author says so" - the card sits in the normal message frame.
// help/themeList carry no data at all; each client renders its own lists.
export const COMMAND_CARD_PREFIX = 'unreleased:cmdcard:'

export type SharedCommandCard = Exclude<LocalNoticePayload, { kind: 'feedbackSent' }>

const MAX_CARD_ITEMS = 25
const MAX_RESULT_TEXT = 1000

function clip(value: unknown, max = MAX_TEXT_FIELD_LENGTH): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value))
}

// Drops trailing list items until the JSON fits a message, so a long history
// degrades to a shorter one rather than failing to send.
export function encodeCommandCard(payload: LocalNoticePayload): string | null {
  const fits = (p: SharedCommandCard): string | null => {
    const out = `${COMMAND_CARD_PREFIX}${JSON.stringify(p)}`
    return out.length <= MAX_SHARE_CONTENT_LENGTH ? out : null
  }
  switch (payload.kind) {
    case 'help':
    case 'themeList':
      return fits(payload)
    case 'changelog':
      return fits({
        kind: 'changelog',
        status: {
          ...payload.status,
          tip: { ...payload.status.tip, message: payload.status.tip.message.slice(0, MAX_TEXT_FIELD_LENGTH) },
          needsReload: false,
        },
      })
    case 'broadcastHistory': {
      const items = payload.items.slice(0, MAX_CARD_ITEMS).map((b) => ({ ...b, message: b.message.slice(0, MAX_TEXT_FIELD_LENGTH) }))
      for (let n = items.length; n >= 0; n--) {
        const out = fits({ kind: 'broadcastHistory', items: items.slice(0, n), total: payload.total })
        if (out) return out
      }
      return null
    }
    case 'npHistory': {
      const items = payload.items.slice(0, MAX_CARD_ITEMS).map((p) => ({ ...p, name: p.name.slice(0, MAX_TEXT_FIELD_LENGTH) }))
      for (let n = items.length; n >= 0; n--) {
        const out = fits({ kind: 'npHistory', items: items.slice(0, n), total: payload.total, capped: payload.capped, user: payload.user })
        if (out) return out
      }
      return null
    }
    case 'result':
      return fits({ kind: 'result', title: payload.title.slice(0, 100), text: payload.text.slice(0, MAX_RESULT_TEXT) })
    case 'npNow':
      return fits({ ...payload, user: payload.user.slice(0, 100), name: payload.name.slice(0, MAX_TEXT_FIELD_LENGTH) })
    default:
      return null
  }
}

export function decodeCommandCard(content: string): SharedCommandCard | null {
  if (!content.startsWith(COMMAND_CARD_PREFIX) || content.length > MAX_SHARE_CONTENT_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(COMMAND_CARD_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  switch (p.kind) {
    case 'help':
    case 'themeList':
      return { kind: p.kind }
    case 'npHistory': {
      if (!Array.isArray(p.items) || p.items.length > MAX_CARD_ITEMS) return null
      const items: { song: number; name: string; played_at: string }[] = []
      for (const it of p.items as Record<string, unknown>[]) {
        const name = clip(it?.name)
        if (!it || !Number.isInteger(it.song) || (it.song as number) <= 0 || !name || !isIsoDate(it.played_at)) return null
        items.push({ song: it.song as number, name, played_at: it.played_at })
      }
      if (!Number.isInteger(p.total) || (p.total as number) < 0 || typeof p.capped !== 'boolean') return null
      if (p.user !== undefined && typeof p.user !== 'string') return null
      return { kind: 'npHistory', items, total: p.total as number, capped: p.capped, user: clip(p.user, 100) || undefined }
    }
    case 'result': {
      const title = clip(p.title, 100)
      const text = clip(p.text, MAX_RESULT_TEXT)
      return title && text ? { kind: 'result', title, text } : null
    }
    case 'npNow': {
      const user = clip(p.user, 100)
      const name = clip(p.name)
      if (!user || !name || !Number.isInteger(p.song) || (p.song as number) <= 0 || !isIsoDate(p.updated_at)) return null
      return { kind: 'npNow', user, song: p.song as number, name, updated_at: p.updated_at }
    }
    case 'broadcastHistory': {
      if (!Array.isArray(p.items) || p.items.length > MAX_CARD_ITEMS) return null
      const items: BroadcastMessage[] = []
      for (const it of p.items as Record<string, unknown>[]) {
        const message = clip(it?.message)
        const sender = clip(it?.sender)
        if (!it || !Number.isInteger(it.id) || !message || !sender || !isIsoDate(it.sent_at)) return null
        if (!BROADCAST_LEVELS.includes(it.level as BroadcastLevel)) return null
        if (it.title !== undefined && it.title !== null && typeof it.title !== 'string') return null
        items.push({
          id: it.id as number,
          title: clip(it.title) ?? '',
          message,
          level: it.level as BroadcastLevel,
          sender,
          sent_at: it.sent_at,
        })
      }
      if (!Number.isInteger(p.total) || (p.total as number) < 0) return null
      return { kind: 'broadcastHistory', items, total: p.total as number }
    }
    case 'changelog': {
      const st = p.status as Record<string, unknown> | undefined
      const tip = st?.tip as Record<string, unknown> | undefined
      if (!st || !tip) return null
      const branch = clip(st.branch, 100)
      const sha = typeof tip.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(tip.sha) ? tip.sha : null
      const message = clip(tip.message)
      const author = clip(tip.author)
      // The card links the commit, so it has to be a plain https URL.
      const url = typeof tip.url === 'string' && tip.url.length <= 300 && /^https:\/\//.test(tip.url) ? tip.url : null
      if (!branch || !sha || message === null || !author || !url || !isIsoDate(tip.date)) return null
      if (st.built !== 'live' && st.built !== 'building' && st.built !== 'unknown') return null
      return {
        kind: 'changelog',
        status: {
          branch,
          tip: { sha, message, author, date: tip.date, url },
          deployed: clip(st.deployed, 64),
          running: clip(st.running, 64) ?? 'unknown',
          built: st.built,
          needsReload: false,
        },
      }
    }
    default:
      return null
  }
}

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
  if (decodeCommandCard(content)) return 'Shared a command card'
  const theme = decodeThemeShare(content)
  if (theme) return `Shared a theme: ${theme.name}`
  // Moderation cards deliberately aren't summarized here: phrasing one
  // requires checking that its author could actually have taken the action,
  // which needs store state this module doesn't have. chatStore's
  // notifyNewMessage does that check and formats the text itself.
  return null
}
