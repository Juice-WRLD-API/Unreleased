import { useEffect, useState } from 'react'
import { Track, ViewType } from '../types'
import { JWAPI_BASE, buildStreamUrl, buildImageUrl, parseDuration, resolvePrefCoverUrl } from './juicewrldApi'
import type { JWApiSong } from './juicewrldApi'
import { peekSongPref } from './songPrefs'
import type { SongPreference } from './songPrefs'
import { peekRotatedCover } from './coverRotation'
import { peekEraCover } from './eraCovers'
import type { ListeningPlayEvent } from './listeningPlays'
import type { ServerPlaylistFolder } from './playlistFolders'
import { apiRequest, cacheDelete } from './apiClient'
import { cacheSet } from './apiCache'

const ACCOUNT_BASE = `${JWAPI_BASE}/accounts`
const LIBRARY_BASE = `${JWAPI_BASE}/library`
const TOKEN_KEY = 'unreleased:authToken'

export interface AccountUser {
  id: number
  display_name: string
  discord_id: string
  discord_username: string
  discord_avatar: string
  avatar?: string
  bio?: string
  public_play_history?: boolean
  public_playlists?: boolean
  public_now_playing?: boolean
  now_playing?: NowPlayingState | Record<string, never>
  is_editor: boolean
  is_contributor: boolean
  // Optional: the API only started returning this with the manager role, so
  // older responses and anything replayed from cache simply omit it.
  is_manager?: boolean
  // Grants News write access (create/edit-own/delete-own posts) - separate
  // from is_editor. Admins can write News regardless of this flag.
  is_news?: boolean
  is_administrator: boolean
  otp_enabled: boolean
  // JSON blobs stored on the profile and PATCHable through this same route -
  // per-song preferences and playlist folders (see lib/preferencesApi and
  // lib/foldersApi). Optional so cached/older responses stay assignable.
  user_preferences?: SongPreference[]
  listening_plays?: ListeningPlayEvent[]
  playlist_folders?: ServerPlaylistFolder[]
  // Channel ids the user follows for news notifications (see lib/newsNotifications).
  news_subscriptions?: string[]
  memberships?: ChannelMembership[]
}

export interface NowPlayingState {
  song: number
  path: string
  position: number
  updated_at: string
}

export interface ChannelMembership {
  channel_slug: string
  channel_name: string
  is_primary?: boolean
  is_editor: boolean
  is_contributor: boolean
  is_manager: boolean
  auto_approve_proposals?: boolean
  auto_approve_comp_proposals?: boolean
}

export function channelMembership(
  account: AccountUser | null,
  slug: string | null | undefined,
): ChannelMembership | null {
  if (!account || !slug) return null
  const found = account.memberships?.find((m) => m.channel_slug === slug)
  if (found) return found
  if (account.is_administrator) {
    return {
      channel_slug: slug,
      channel_name: slug,
      is_editor: true,
      is_contributor: true,
      is_manager: true,
    }
  }
  return null
}

// The global is_editor/is_contributor/is_manager booleans are an unscoped
// grant that predates per-channel memberships - but the backend only ever
// honours it on the *primary* channel (legacy accounts never got a membership
// row, so their global flag has to keep covering the one channel that existed
// before channels did). On any other channel, the global flag alone isn't
// enough - the account needs an explicit membership row for that channel, or
// admin. `isPrimary` defaults true so call sites that can't yet determine it
// (e.g. before the channel list has loaded) keep the old, safe behavior.
export function isChannelEditor(account: AccountUser | null, slug: string | null | undefined, isPrimary = true): boolean {
  if (account?.is_administrator) return true
  if (account?.is_editor && isPrimary) return true
  return !!channelMembership(account, slug)?.is_editor
}

export function isChannelContributor(account: AccountUser | null, slug: string | null | undefined, isPrimary = true): boolean {
  if (!CONTRIBUTOR_ENABLED) return false
  if (account?.is_administrator) return true
  if (account?.is_contributor && isPrimary) return true
  return !!channelMembership(account, slug)?.is_contributor
}

export function isChannelManager(account: AccountUser | null, slug: string | null | undefined, isPrimary = true): boolean {
  if (account?.is_administrator) return true
  if (account?.is_manager && isPrimary) return true
  return !!channelMembership(account, slug)?.is_manager
}

export interface ApiSongLite {
  id: number
  public_id: number | null
  name: string
  track_titles: string[]
  path: string
  length: string
  credited_artists: string
  category: string
  image_url: string | null
  era: { id: number; name: string } | null
  album?: string | null
}

export interface FavoriteEntry {
  id: number
  song: ApiSongLite
  created_at: string
}

export interface PlaylistSummary {
  id: number
  name: string
  description: string | null
  track_count: number
  is_public: boolean
  cover_image_url?: string | null
  cover_image?: string | null
  created_at: string
  updated_at: string
}

export interface PlaylistItemEntry {
  id: number
  song: ApiSongLite
  position: number
  added_at: string
}

export interface PlaylistDetail {
  id: number
  name: string
  description: string | null
  is_public: boolean
  cover_image_url?: string | null
  cover_image?: string | null
  items: PlaylistItemEntry[]
  created_at: string
  updated_at: string
}

export interface PublicProfile {
  id: number
  username: string
  display_name: string
  avatar: string
  bio: string
  is_editor: boolean
  is_contributor: boolean
  public_play_history: boolean
  public_playlists: boolean
  public_now_playing: boolean
  play_history?: ListeningPlayEvent[]
  playlists?: PlaylistSummary[]
}

export interface NowPlayingResponse {
  now_playing: NowPlayingState | null
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

// `cacheKey` opts a GET call into the offline fallback cache - pass it only
// for idempotent reads whose staleness is acceptable (playlists, favorites,
// profile). Mutations don't pass one, so they always hit the network and
// fail loudly if offline rather than silently no-op against stale data.
async function request<T>(url: string, options: RequestInit = {}, auth = true, cacheKey?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Token ${token}`
  }
  return apiRequest<T>(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
    cacheKey,
  })
}

// Applies per-song overrides for the same reason songToTrack does - a track
// reached through a playlist or the favorites list has to show the user's
// custom name and cover just like one reached through the Tracker.
export function liteSongToTrack(song: ApiSongLite): Track {
  const apiTitle = song.name
  const apiImageUrl = buildImageUrl(song.image_url)
  const pref = peekSongPref(song.id)
  // Same precedence as songToTrack: user cover, then a rotated suggestion,
  // then an era cover override (unreleased songs only).
  const coverUrl = resolvePrefCoverUrl(pref?.cover_url)
    ?? peekRotatedCover(song.id)
    ?? (song.category !== 'released' ? resolvePrefCoverUrl(peekEraCover(song.era?.name)) : undefined)
  return {
    id: `jw-${song.id}`,
    path: song.path,
    streamUrl: buildStreamUrl(song.path),
    imageUrl: coverUrl ?? apiImageUrl,
    title: pref?.name || apiTitle,
    apiTitle,
    apiImageUrl,
    artist: song.credited_artists || 'Juice WRLD',
    album: song.album || song.era?.name || '',
    era: song.era?.name || undefined,
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: parseDuration(song.length),
    genre: song.category,
    hasAlbumArt: !!song.image_url || !!coverUrl,
  }
}

export function trackIdToSongId(trackId: string): number | null {
  const match = trackId.match(/^jw-(\d+)$/)
  return match ? Number(match[1]) : null
}


export function discordRedirectUri(): string {
  // In Electron (file:// protocol) always use the production callback URL,
  // which is the registered Discord redirect URI
  if (window.location.protocol === 'file:') {
    return 'https://player.juicewrldapi.com/auth/discord/callback'
  }
  return `${window.location.origin}/auth/discord/callback`
}

export async function getDiscordAuthUrl(redirectUri: string): Promise<{ authorize_url: string; state: string }> {
  const url = new URL(`${ACCOUNT_BASE}/auth/discord/url/`)
  url.searchParams.set('redirect_uri', redirectUri)
  return request(url.toString(), { method: 'GET' }, false)
}

export async function exchangeDiscord(
  code: string,
  state: string,
  redirectUri: string,
): Promise<{ token: string; user: AccountUser }> {
  return request(`${ACCOUNT_BASE}/auth/discord/exchange/`, {
    method: 'POST',
    body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
  }, false)
}

export async function registerAccount(payload: {
  username: string
  password: string
  display_name?: string
}): Promise<{ token: string; user: AccountUser }> {
  return request(`${ACCOUNT_BASE}/auth/register/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, false)
}

export async function passwordLogin(payload: {
  username: string
  password: string
}): Promise<{ token: string; user: AccountUser }> {
  return request(`${ACCOUNT_BASE}/auth/login/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, false)
}

export async function logout(): Promise<void> {
  try {
    await request(`${ACCOUNT_BASE}/logout/`, { method: 'POST' })
  } catch {}
  clearToken()
}

export async function getMe(): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  return request(url, { method: 'GET' }, true, url)
}

export async function updateDisplayName(displayName: string): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  })
  cacheSet(url, result)
  return result
}

export async function updateAvatar(base64: string): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify({ avatar: base64 }),
  })
  cacheSet(url, result)
  return result
}

export async function removeAvatar(): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify({ avatar: '' }),
  })
  cacheSet(url, result)
  return result
}

export async function updateBio(bio: string): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify({ bio }),
  })
  cacheSet(url, result)
  return result
}

export async function updatePrivacySettings(payload: {
  public_play_history?: boolean
  public_playlists?: boolean
  public_now_playing?: boolean
}): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  cacheSet(url, result)
  return result
}

export async function updateNowPlaying(
  nowPlaying: { song: number; path?: string; position?: number } | null,
): Promise<AccountUser> {
  const url = `${ACCOUNT_BASE}/account/me/`
  const result = await request<AccountUser>(url, {
    method: 'PATCH',
    body: JSON.stringify({ now_playing: nowPlaying ?? {} }),
  })
  cacheSet(url, result)
  return result
}

export async function getPublicProfile(userId: number): Promise<PublicProfile> {
  const url = `${ACCOUNT_BASE}/profile/${userId}/`
  return request(url, { method: 'GET' }, false, url)
}

export async function getNowPlaying(userId: number): Promise<NowPlayingResponse> {
  const url = `${ACCOUNT_BASE}/profile/${userId}/np/`
  return request(url, { method: 'GET' }, false)
}

// There's no bulk "now playing for these users" endpoint yet (unlike chat
// presence, which is one /presence/ call + socket events) - this polls
// /np/ per id instead. Keep `ids` scoped to what's actually visible (a
// people picker's filtered list, an online-members section) rather than an
// entire directory, since every id here is its own request on every tick.
const NOW_PLAYING_LIST_POLL_MS = 25_000

export function useNowPlayingByIds(ids: number[]): Record<number, NowPlayingState | null> {
  const key = [...new Set(ids)].sort((a, b) => a - b).join(',')
  const [map, setMap] = useState<Record<number, NowPlayingState | null>>({})

  useEffect(() => {
    const list = key ? key.split(',').map(Number) : []
    if (list.length === 0) { setMap({}); return }
    let cancelled = false
    const poll = (): void => {
      Promise.all(list.map((id) =>
        getNowPlaying(id).then((r) => [id, r.now_playing] as const).catch(() => [id, null] as const)
      )).then((entries) => { if (!cancelled) setMap(Object.fromEntries(entries)) })
    }
    poll()
    const timer = setInterval(poll, NOW_PLAYING_LIST_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [key])

  return map
}

export async function getFavorites(): Promise<FavoriteEntry[]> {
  const url = `${LIBRARY_BASE}/favorites/`
  return request(url, { method: 'GET' }, true, url)
}

export async function addFavorite(songId: number): Promise<FavoriteEntry> {
  return request(`${LIBRARY_BASE}/favorites/`, {
    method: 'POST',
    body: JSON.stringify({ song_id: songId }),
  })
}

export async function removeFavorite(songId: number): Promise<void> {
  return request(`${LIBRARY_BASE}/favorites/${songId}/`, { method: 'DELETE' })
}

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  const url = `${LIBRARY_BASE}/playlists/?omit_cover_image=true`
  return request(url, { method: 'GET' }, true, url)
}

type PlaylistCoverEntry = { cover_image_url?: string | null; cover_image?: string | null; trackImages: string[] }

// In-memory cache so re-opening a playlist (or re-rendering the playlists
// grid after switching tabs) shows its cover instantly instead of re-hitting
// the API every time - covers rarely change, so a session-lifetime cache is
// safe as long as uploads/removals below keep it in sync.
const playlistCoverCache = new Map<number, PlaylistCoverEntry>()

/** Synchronous cache read, so callers can render a cached cover immediately
 *  (no loading flash) before deciding whether to also call getPlaylistCover. */
export function peekPlaylistCover(id: number): PlaylistCoverEntry | undefined {
  return playlistCoverCache.get(id)
}

/** Fetch just the cover fields (+ first 4 track image URLs) for a single playlist. */
export async function getPlaylistCover(id: number): Promise<PlaylistCoverEntry> {
  const cached = playlistCoverCache.get(id)
  if (cached) return cached
  // getPlaylist's cached detail carries the same cover fields this needs -
  // reuse it instead of firing a second near-duplicate /playlists/{id}/
  // request for the same playlist (prefetchPlaylistDetails calls both back
  // to back for every playlist on startup, which used to double the network
  // traffic for no benefit). Only skipped if that cache entry came back from
  // the omit_cover_image=true fetch and genuinely lacks the fields.
  const peeked = peekPlaylistDetail(id)
  const d = peeked && ('cover_image_url' in peeked || 'cover_image' in peeked)
    ? peeked
    : await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/`)
  const trackImages = (d.items ?? []).slice(0, 4).map(it => buildImageUrl(it.song.image_url)).filter(Boolean) as string[]
  // cover_image_url/cover_image can be a site-relative pointer (the same
  // "/assets/x.jpg" shape a song's image_url uses, e.g. for era-linked
  // covers) rather than an absolute URL - resolve it here so every caller
  // gets a directly loadable src instead of each having to know the shape.
  const entry: PlaylistCoverEntry = {
    cover_image_url: buildImageUrl(d.cover_image_url) ?? null,
    cover_image: buildImageUrl(d.cover_image) ?? null,
    trackImages,
  }
  playlistCoverCache.set(id, entry)
  return entry
}

export async function createPlaylist(
  name: string,
  opts?: { description?: string | null; song_ids?: number[]; cover_image?: string | null; is_public?: boolean }
): Promise<PlaylistDetail> {
  return request(`${LIBRARY_BASE}/playlists/`, {
    method: 'POST',
    body: JSON.stringify({ name, ...opts }),
  })
}

// ── Image compression (canvas → JPEG, max 400px / ~200 KB) ─────────────────
export async function compressImageFile(file: File, maxDim = 400, maxKB = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      let q = 0.85
      let result = canvas.toDataURL('image/jpeg', q)
      while (result.length > maxKB * 1024 * 1.37 && q > 0.3) {
        q = Math.round((q - 0.1) * 10) / 10
        result = canvas.toDataURL('image/jpeg', q)
      }
      resolve(result)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
    img.src = url
  })
}

// In-memory cache of full playlist detail (tracks + metadata), keyed by id.
// Session-lifetime, same rationale as playlistCoverCache: reopening a
// playlist you've already viewed shows tracks instantly instead of a fresh
// network round trip every time. Callers do stale-while-revalidate (render
// cached, then quietly refetch) so a peek is never stale for long; mutations
// below also update/clear the entry so edits aren't lost behind the cache.
const playlistDetailCache = new Map<number, PlaylistDetail>()

/** Synchronous cache read for instant render before/instead of a network fetch. */
export function peekPlaylistDetail(id: number): PlaylistDetail | undefined {
  return playlistDetailCache.get(id)
}

// Cache key for a playlist's persisted detail response - kept in sync with
// mutations below so offline reads never show a stale-past-the-last-edit copy.
const playlistDetailUrl = (id: number): string => `${LIBRARY_BASE}/playlists/${id}/?omit_cover_image=true`

// Single request - tracks + cover in one response
export async function getPlaylist(id: number): Promise<PlaylistDetail> {
  const url = playlistDetailUrl(id)
  const result = await request<PlaylistDetail>(url, {}, true, url)
  playlistDetailCache.set(id, result)
  return result
}

export async function renamePlaylist(id: number, name: string): Promise<PlaylistDetail> {
  const result = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  playlistDetailCache.set(id, result)
  cacheSet(playlistDetailUrl(id), result)
  return result
}

export async function updatePlaylist(id: number, data: { name?: string; description?: string; is_public?: boolean }): Promise<PlaylistDetail> {
  const result = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  playlistDetailCache.set(id, result)
  cacheSet(playlistDetailUrl(id), result)
  return result
}

/** Fetch a public playlist without authentication. */
export async function getPublicPlaylist(id: number): Promise<PlaylistDetail> {
  const url = `${LIBRARY_BASE}/playlists/public/${id}/`
  const result = await request<PlaylistDetail>(url, {}, false, url)
  playlistDetailCache.set(id, result)
  return result
}

/** Fetch cover of a public playlist without authentication. */
export async function getPublicPlaylistCover(id: number): Promise<PlaylistCoverEntry> {
  const cached = playlistCoverCache.get(id)
  if (cached) return cached
  const d = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/public/${id}/`)
  const trackImages = (d.items ?? []).slice(0, 4).map(it => buildImageUrl(it.song.image_url)).filter(Boolean) as string[]
  const entry: PlaylistCoverEntry = { cover_image_url: d.cover_image_url, cover_image: d.cover_image, trackImages }
  playlistCoverCache.set(id, entry)
  return entry
}

export async function uploadPlaylistCover(id: number, file: File): Promise<PlaylistDetail> {
  // Compress to max 400px / 200 KB before encoding - prevents large covers in future
  const base64 = await compressImageFile(file).catch(() =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  )
  const result = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ cover_image: base64 }),
  })
  playlistCoverCache.set(id, {
    cover_image_url: result.cover_image_url,
    cover_image: result.cover_image,
    trackImages: playlistCoverCache.get(id)?.trackImages ?? [],
  })
  const cachedDetail = playlistDetailCache.get(id)
  if (cachedDetail) playlistDetailCache.set(id, { ...cachedDetail, cover_image_url: result.cover_image_url, cover_image: result.cover_image })
  return result
}

export async function removePlaylistCover(id: number): Promise<void> {
  await request(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ cover_image: '', cover_image_url: '' }),
  })
  playlistCoverCache.set(id, { cover_image_url: null, cover_image: null, trackImages: playlistCoverCache.get(id)?.trackImages ?? [] })
  const cachedDetail = playlistDetailCache.get(id)
  if (cachedDetail) playlistDetailCache.set(id, { ...cachedDetail, cover_image_url: null, cover_image: null })
}

export async function setPlaylistCoverBase64(id: number, b64: string): Promise<void> {
  await request(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ cover_image: b64 }),
  })
}

export async function reorderPlaylist(id: number, songIds: number[]): Promise<PlaylistDetail> {
  const result = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ order: songIds }),
  })
  playlistDetailCache.set(id, result)
  cacheSet(playlistDetailUrl(id), result)
  return result
}

export async function deletePlaylist(id: number): Promise<void> {
  await request(`${LIBRARY_BASE}/playlists/${id}/`, { method: 'DELETE' })
  playlistDetailCache.delete(id)
  playlistCoverCache.delete(id)
  cacheDelete(playlistDetailUrl(id))
}

export async function addToPlaylist(id: number, songId: number): Promise<PlaylistDetail> {
  const result = await request<PlaylistDetail>(`${LIBRARY_BASE}/playlists/${id}/items/`, {
    method: 'POST',
    body: JSON.stringify({ song_id: songId }),
  })
  playlistDetailCache.set(id, result)
  cacheSet(playlistDetailUrl(id), result)
  return result
}

export async function removeFromPlaylist(id: number, songId: number): Promise<void> {
  await request(`${LIBRARY_BASE}/playlists/${id}/items/${songId}/`, { method: 'DELETE' })
  const cached = playlistDetailCache.get(id)
  if (cached) {
    const updated = { ...cached, items: cached.items.filter(it => it.song.id !== songId) }
    playlistDetailCache.set(id, updated)
    cacheSet(playlistDetailUrl(id), updated)
  }
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'reversed'
export type CompProposalChangeType =
  | 'upload' | 'replace' | 'move' | 'delete' | 'create_folder'
  | 'rename_folder' | 'move_folder' | 'delete_folder'

// Only the underscored ones need spelling out; everything else reads fine as
// the raw enum. Lives here rather than in one of the review components because
// four separate places render this badge.
const COMP_CHANGE_LABELS: Record<string, string> = {
  create_folder: 'new folder',
  rename_folder: 'rename folder',
  move_folder: 'move folder',
  delete_folder: 'delete folder',
}

export function compChangeTypeLabel(type: string): string {
  return COMP_CHANGE_LABELS[type] ?? type
}

export interface CompFileProposal {
  id: number
  contributor_username: string
  contributor_id: number
  file_path: string
  destination_path: string
  change_type: CompProposalChangeType
  staging_filename: string
  original_snapshot: Record<string, unknown>
  contributor_notes: string
  status: ProposalStatus
  reviewer_username: string | null
  review_notes: string
  applied_commit_id: string
  edit_count: number
  last_edited_at: string | null
  created_at: string
  reviewed_at: string | null
}

export interface CompFileRevision {
  id: number
  filepath: string
  hash: string
  size: number
  archive_path: string
  proposal_id: number | null
  commit_id: string
  is_current: boolean
  created_at: string
}
export type ProposalChangeType = 'create' | 'update' | 'delete'

export interface EditorBadgeAward {
  slug: string
  name: string
  description: string
  icon: string
  category: string
  note: string
  awarded_at: string
  awarded_by_username: string | null
}

export interface SongEditProposal {
  id: number
  editor_username: string
  editor_id: number
  song: number | null
  song_public_id: number | null
  change_type: ProposalChangeType
  title: string
  proposed_data: Record<string, unknown>
  original_proposed_data: Record<string, unknown>
  applied_data: Record<string, unknown>
  revised_by_admin: boolean
  original_snapshot: Record<string, unknown>
  editor_notes: string
  status: ProposalStatus
  reviewer_username: string | null
  review_notes: string
  edit_count: number
  last_edited_at: string | null
  created_at: string
  reviewed_at: string | null
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'
export type ApplicationType = 'editor' | 'contributor'

export interface EditorApplication {
  id: number
  username: string
  discord_id: string
  discord_username: string
  discord_avatar: string
  display_name: string
  contact: string
  experience: string
  motivation: string
  areas: string
  // Optional on the way in: applications created before contributor
  // applications existed have no type, and neither do cached rows. Read it
  // through applicationType() rather than directly.
  application_type?: ApplicationType
  status: ApplicationStatus
  reviewer_username: string | null
  review_notes: string
  created_at: string
  reviewed_at: string | null
}

export interface AdminUser {
  user_id: number
  username: string
  is_active: boolean
  role: string
  contributor_enabled: boolean
  manager_enabled?: boolean
  discord_id: string
  discord_username: string
  discord_avatar: string
  otp_enabled: boolean
  auto_approve_proposals: boolean
  auto_approve_comp_proposals: boolean
  date_joined: string
  last_login: string | null
  proposal_count: number
  approved_count: number
  comp_proposal_count: number
  comp_approved_count: number
  badges: EditorBadgeAward[]
}

export interface OtpSetupPayload {
  otp_enabled: boolean
  account_label?: string
  otp_secret?: string
  provisioning_uri?: string
  qr_code?: string
}

/** Editor was the only kind of application until contributor applications
 *  shipped, so an untyped row is an editor row. */
export function applicationType(app: Pick<EditorApplication, 'application_type'> | null | undefined): ApplicationType {
  return app?.application_type === 'contributor' ? 'contributor' : 'editor'
}

/** The caller's application *of one kind*.
 *
 *  `type` is sent as a query param for a backend that can narrow, and the
 *  result is filtered client-side regardless - the endpoint historically
 *  returned "the" single application, and a page that blocks on the wrong kind
 *  strands the user (an editor rejection is not a reason to refuse a
 *  contributor application, and vice versa). Filtering here means the worst
 *  case is an apply form whose POST fails with the server's own message,
 *  rather than a dead end with no controls. */
export async function getMyApplication(type?: ApplicationType, channel?: string): Promise<{ application: EditorApplication | null }> {
  const url = new URL(`${ACCOUNT_BASE}/application/`)
  if (type) url.searchParams.set('type', type)
  if (channel) url.searchParams.set('channel', channel)
  const res = await request<{ application: EditorApplication | null }>(url.toString(), { method: 'GET' })
  if (type && res.application && applicationType(res.application) !== type) return { application: null }
  return res
}

export async function submitApplication(payload: {
  display_name?: string
  contact?: string
  experience?: string
  motivation: string
  areas?: string
  application_type?: ApplicationType
  channel?: string
}): Promise<EditorApplication> {
  return request(`${ACCOUNT_BASE}/application/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function myProposalsUrl(channel?: string): string {
  const url = new URL(`${ACCOUNT_BASE}/editor/proposals/`)
  if (channel) url.searchParams.set('channel', channel)
  return url.toString()
}

// Cached (offline-fallback) like the other "list my stuff" reads - this is
// the tab a signed-in editor lands on, and it shouldn't go blank just because
// the request raced a flaky connection.
export async function getMyProposals(channel?: string): Promise<SongEditProposal[]> {
  const url = myProposalsUrl(channel)
  return request(url, { method: 'GET' }, true, url)
}

export async function createProposal(payload: {
  song: number | null
  change_type: ProposalChangeType
  title?: string
  proposed_data: Record<string, unknown>
  editor_notes?: string
  channel?: string
}): Promise<SongEditProposal> {
  return request(`${ACCOUNT_BASE}/editor/proposals/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateProposal(id: number, payload: {
  title?: string
  proposed_data?: Record<string, unknown>
  editor_notes?: string
}): Promise<SongEditProposal> {
  return request(`${ACCOUNT_BASE}/editor/proposals/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function withdrawProposal(id: number): Promise<void> {
  await request(`${ACCOUNT_BASE}/editor/proposals/${id}/`, { method: 'DELETE' })
  // Otherwise a withdrawn proposal reappears if the list is next read while
  // offline (the cache still holds the pre-withdrawal response).
  cacheDelete(myProposalsUrl())
}

// Withdraws a proposal and immediately re-creates it with the same data -
// useful when a pending proposal is stuck/stale and needs a fresh review cycle.
export async function resubmitProposal(p: SongEditProposal): Promise<SongEditProposal> {
  await withdrawProposal(p.id)
  return createProposal({
    song: p.song,
    change_type: p.change_type,
    title: p.title,
    proposed_data: p.proposed_data,
    editor_notes: p.editor_notes,
  })
}

export async function getLeaderboard(): Promise<Array<{
  rank: number
  user_id: number
  username: string
  discord_username: string
  discord_avatar: string
  approved_count: number
  badges: EditorBadgeAward[]
}>> {
  return request(`${ACCOUNT_BASE}/editor/leaderboard/`, { method: 'GET' })
}


// Cached per status filter (each filter value is its own URL, so its own
// cache entry) - offline fallback only. Not actively invalidated by
// adminReviewProposal/adminReverseProposal: those change which filtered list
// an item belongs to, and a review queue is re-fetched right after acting on
// it anyway (see AdminPage), so the tiny staleness window only ever shows up
// if the connection drops between an action and that refetch.
export async function adminListProposals(statusFilter?: ProposalStatus, channel?: string): Promise<SongEditProposal[]> {
  const url = new URL(`${ACCOUNT_BASE}/admin/proposals/`)
  if (statusFilter) url.searchParams.set('status', statusFilter)
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'GET' }, true, url.toString())
}

export interface ProposalCounts { total: number; pending: number; approved: number; rejected: number; reversed: number }

export async function adminProposalCounts(channel?: string): Promise<ProposalCounts> {
  const url = new URL(`${ACCOUNT_BASE}/admin/proposals/`)
  url.searchParams.set('counts', '1')
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'GET' }, true, url.toString())
}

export async function adminReviewProposal(id: number, payload: {
  action: 'approve' | 'reject' | 'revise'
  review_notes?: string
  revised_data?: Record<string, unknown>
  channel?: string
}): Promise<SongEditProposal> {
  return request(`${ACCOUNT_BASE}/admin/proposals/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminReverseProposal(id: number, channel?: string): Promise<SongEditProposal> {
  const url = new URL(`${ACCOUNT_BASE}/admin/proposals/${id}/reverse/`)
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'POST' })
}

export async function adminListApplications(statusFilter?: ApplicationStatus): Promise<EditorApplication[]> {
  const url = new URL(`${ACCOUNT_BASE}/admin/applications/`)
  if (statusFilter) url.searchParams.set('status', statusFilter)
  return request(url.toString(), { method: 'GET' })
}

export async function adminReviewApplication(id: number, payload: {
  action: 'approve' | 'reject'
  review_notes?: string
}): Promise<EditorApplication> {
  return request(`${ACCOUNT_BASE}/admin/applications/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminListUsers(roleFilter?: string): Promise<AdminUser[]> {
  const url = new URL(`${ACCOUNT_BASE}/admin/users/`)
  if (roleFilter) url.searchParams.set('role', roleFilter)
  return request(url.toString(), { method: 'GET' })
}

export async function adminUpdateUser(userId: number, payload: {
  role?: 'editor' | 'contributor' | 'manager' | 'applicant'
  contributor_enabled?: boolean
  manager_enabled?: boolean
  is_active?: boolean
  auto_approve_proposals?: boolean
  auto_approve_comp_proposals?: boolean
}): Promise<AdminUser> {
  return request(`${ACCOUNT_BASE}/admin/users/${userId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function getOtpSetup(): Promise<OtpSetupPayload> {
  return request(`${ACCOUNT_BASE}/otp/setup/`, { method: 'GET' })
}

export async function confirmOtpSetup(otpToken: string): Promise<{ otp_enabled: boolean }> {
  return request(`${ACCOUNT_BASE}/otp/setup/`, {
    method: 'POST',
    body: JSON.stringify({ otp_token: otpToken }),
  })
}

// Same path as request(), minus the JSON Content-Type - the browser has to set
// its own multipart boundary. Everything else (error parsing, offline cache
// fallback) comes from apiClient like every other call in this module.
// Comp-file contributions (proposals, the admin review queue, file history)
// hang off routes that are newer than the rest of this module. Everything the
// feature touches is gated on this one flag the way lib/newsApi gates `/news/`
// - flip it to false and the contributor role disappears from the UI instead
// of leading users to forms that fail on submit.
export const CONTRIBUTOR_ENABLED = true

export function isEditorAnywhere(account: AccountUser | null): boolean {
  if (!account) return false
  return !!account.is_editor || !!account.memberships?.some((m) => m.is_editor)
}

export function isManagerAnywhere(account: AccountUser | null): boolean {
  if (!account) return false
  return !!account.is_manager || !!account.memberships?.some((m) => m.is_manager)
}

export function isContributorAnywhere(account: AccountUser | null): boolean {
  if (!account || !CONTRIBUTOR_ENABLED) return false
  return !!account.is_contributor || !!account.memberships?.some((m) => m.is_contributor)
}

export function showStaffProfile(account: AccountUser | null): boolean {
  if (!account) return false
  return !!(account.is_administrator || isEditorAnywhere(account) || isManagerAnywhere(account) || isContributorAnywhere(account))
}

export function staffProfileView(account: AccountUser | null): ViewType {
  if (!account) return 'api-tracker'
  // Everyone with review duties lands on the editor profile - it's the personal
  // page (your own song edits, your own comp files) and it embeds the review
  // queue as a tab. Pointing managers straight at the review panel instead cost
  // them any way to reach their own proposals, since this is the single profile
  // entry in the sidebar and bottom bar. It also carries a Comp tab of its own,
  // so contributors who also hold one of these roles lose nothing here.
  if (account.is_administrator || isEditorAnywhere(account) || isManagerAnywhere(account)) return 'editor-profile'
  if (isContributorAnywhere(account)) return 'contributor-profile'
  return 'editor-profile'
}

export function staffProfileLabel(account: AccountUser | null): string {
  if (!account) return 'Profile'
  if (account.is_administrator) return 'Admin'
  const isContributor = isContributorAnywhere(account)
  const isEditor = isEditorAnywhere(account)
  const isManager = isManagerAnywhere(account)
  if (isEditor && isManager) return 'Staff'
  if (isManager) return 'Manager'
  if (isEditor && isContributor) return 'Staff'
  if (isEditor) return 'Editor'
  if (isContributor) return 'Contributor'
  return 'Profile'
}

function assertContributorApi(): void {
  if (!CONTRIBUTOR_ENABLED) throw new Error('Comp file contributions are not available yet')
}

async function multipartRequest<T>(url: string, form: FormData, method = 'POST'): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(url, { method, headers, body: form })
}

function myCompProposalsUrl(channel?: string): string {
  const url = new URL(`${ACCOUNT_BASE}/contributor/proposals/`)
  if (channel) url.searchParams.set('channel', channel)
  return url.toString()
}

export async function getMyCompProposals(channel?: string): Promise<CompFileProposal[]> {
  assertContributorApi()
  const url = myCompProposalsUrl(channel)
  return request(url, { method: 'GET' }, true, url)
}

export async function createCompProposal(form: FormData): Promise<CompFileProposal> {
  assertContributorApi()
  return multipartRequest(`${ACCOUNT_BASE}/contributor/proposals/`, form)
}

/** Same call as createCompProposal, but over XHR so the upload body's progress
 *  is observable - fetch() reports nothing until the whole request has been
 *  sent, which is useless for the multi-hundred-megabyte zips this endpoint
 *  takes. Returns an abort handle so a queued upload can be cancelled. */
export function createCompProposalUpload(form: FormData, opts: {
  onProgress?: (sent: number, total: number) => void
} = {}): { promise: Promise<CompFileProposal>; abort: () => void } {
  assertContributorApi()
  const xhr = new XMLHttpRequest()
  const promise = new Promise<CompFileProposal>((resolve, reject) => {
    xhr.open('POST', `${ACCOUNT_BASE}/contributor/proposals/`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as CompFileProposal) }
        catch { reject(new Error('Upload succeeded but the response was unreadable')) }
        return
      }
      // DRF answers with {"detail": …} or {"field": ["…"]} - surface whichever
      // is there rather than a bare status code.
      let msg = `Upload failed (HTTP ${xhr.status})`
      try {
        const body = JSON.parse(xhr.responseText)
        const first = body?.detail ?? Object.values(body ?? {})[0]
        if (first) msg = Array.isArray(first) ? String(first[0]) : String(first)
      } catch { /* keep the status-code message */ }
      reject(new Error(msg))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort  = () => reject(new Error('cancelled'))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

export async function updateCompProposal(id: number, form: FormData): Promise<CompFileProposal> {
  assertContributorApi()
  return multipartRequest(`${ACCOUNT_BASE}/contributor/proposals/${id}/`, form, 'PATCH')
}

export async function withdrawCompProposal(id: number): Promise<void> {
  assertContributorApi()
  await request(`${ACCOUNT_BASE}/contributor/proposals/${id}/`, { method: 'DELETE' })
  cacheDelete(myCompProposalsUrl())
}

// Same offline-fallback-only caching as adminListProposals above.
export async function adminListCompProposals(statusFilter?: ProposalStatus, channel?: string): Promise<CompFileProposal[]> {
  if (!CONTRIBUTOR_ENABLED) return []
  const url = new URL(`${ACCOUNT_BASE}/admin/comp-proposals/`)
  if (statusFilter) url.searchParams.set('status', statusFilter)
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'GET' }, true, url.toString())
}

export async function adminCompProposalCounts(channel?: string): Promise<ProposalCounts> {
  if (!CONTRIBUTOR_ENABLED) return { total: 0, pending: 0, approved: 0, rejected: 0, reversed: 0 }
  const url = new URL(`${ACCOUNT_BASE}/admin/comp-proposals/`)
  url.searchParams.set('counts', '1')
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'GET' }, true, url.toString())
}

export async function adminReviewCompProposal(id: number, payload: {
  action: 'approve' | 'reject'
  review_notes?: string
  channel?: string
}): Promise<CompFileProposal> {
  assertContributorApi()
  return request(`${ACCOUNT_BASE}/admin/comp-proposals/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminReverseCompProposal(id: number, channel?: string): Promise<CompFileProposal> {
  assertContributorApi()
  const url = new URL(`${ACCOUNT_BASE}/admin/comp-proposals/${id}/reverse/`)
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'POST' })
}

export function adminCompProposalStagingUrl(id: number, channel?: string): string {
  const url = new URL(`${ACCOUNT_BASE}/admin/comp-proposals/${id}/staging/`)
  if (channel) url.searchParams.set('channel', channel)
  return url.toString()
}

export async function adminCompFileHistory(filepath: string, channel?: string): Promise<{ filepath: string; revisions: CompFileRevision[] }> {
  assertContributorApi()
  const encoded = filepath.split('/').map(encodeURIComponent).join('/')
  const url = new URL(`${ACCOUNT_BASE}/admin/comp-files/${encoded}/history/`)
  if (channel) url.searchParams.set('channel', channel)
  return request(url.toString(), { method: 'GET' })
}
