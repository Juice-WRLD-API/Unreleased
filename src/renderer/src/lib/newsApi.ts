// News feed data layer. `/news/` is live on the backend - `NEWS_ENABLED` is
// kept as a kill switch (reads fall back to an empty state and mutations
// throw a clear "not available" error) rather than removed outright.
import { routeUrl } from './juicewrldApi'
import { apiRequest, authedRequest, authHeaders } from './apiClient'
import { cacheGet } from './apiCache'
import { getToken } from './userApi'
import { getMediaType } from './fileTypes'

// Flip to true once the API exposes /news/. Everything below already speaks the
// intended contract, so no other change should be needed.
export const NEWS_ENABLED = true

const NEWS_BASE = routeUrl('/news')

function assertEnabled(): void {
  if (!NEWS_ENABLED) throw new Error('News is not available yet')
}

// Authed request for editor/admin mutations - mirrors userApi's private
// `request` helper (Token scheme) so news writes carry the same credentials as
// the rest of the app.
function authed<T>(url: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, options, getToken())
}

// ─── Channels ─────────────────────────────────────────────────────────────────
// The feed is split into channels - each is its own stream the user tabs
// between. `id` is the stable slug sent to the API as `?channel=`. Admins can
// create/rename/delete them; NEWS_CHANNELS below is only the offline fallback
// used before the channels endpoint responds. The client-side "All" pseudo-tab
// (ALL_CHANNEL) is never part of this list - it just omits the filter.

export interface NewsChannel {
  id: string
  label: string
  // Optional one-liner shown under the channel in the manager.
  description?: string | null
}

export const ALL_CHANNEL = 'all'
export const DEFAULT_NEWS_CHANNEL = ALL_CHANNEL

// Fallback channel set - matches what the backend should seed. Real channels
// only; the view prepends the "All" tab itself.
export const NEWS_CHANNELS: NewsChannel[] = [
  { id: 'announcements', label: 'Announcements' },
  { id: 'releases', label: 'Releases' },
  { id: 'leaks', label: 'Leaks' },
  { id: 'community', label: 'Community' },
]

export interface ChannelInput {
  label: string
  description?: string | null
}

// The channel list. Falls back to NEWS_CHANNELS while the feature is off so the
// tab bar always has something to render.
export async function fetchChannels(): Promise<NewsChannel[]> {
  if (!NEWS_ENABLED) return NEWS_CHANNELS
  const res = await apiRequest<{ results: NewsChannel[] } | NewsChannel[]>(`${NEWS_BASE}/channels/`, {
    cacheKey: 'news:channels',
  })
  return Array.isArray(res) ? res : res.results
}

// Admin only. The backend assigns the slug id from the label.
export async function createChannel(input: ChannelInput): Promise<NewsChannel> {
  assertEnabled()
  return authed<NewsChannel>(`${NEWS_BASE}/channels/`, { method: 'POST', body: JSON.stringify(input) })
}

export async function updateChannel(id: string, input: Partial<ChannelInput>): Promise<NewsChannel> {
  assertEnabled()
  return authed<NewsChannel>(`${NEWS_BASE}/channels/${id}/`, { method: 'PATCH', body: JSON.stringify(input) })
}

export async function deleteChannel(id: string): Promise<void> {
  assertEnabled()
  return authed<void>(`${NEWS_BASE}/channels/${id}/`, { method: 'DELETE' })
}

// ─── Attachments ──────────────────────────────────────────────────────────────
// Files attached to a post. On an existing item these come back hosted (`url`);
// when composing, new files ride along in the create/update payload as base64
// `data` and the backend persists them, returning the hosted form next read.

export interface NewsAttachment {
  id?: number
  name: string
  url: string
  mime: string
  size: number // bytes
}

// Client-side cap, checked before upload. Keep in sync with the backend's limit.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB

export function isImageAttachment(a: { mime: string; name?: string }): boolean {
  if (a.mime.startsWith('image/')) return true
  if (a.name) return getMediaType(a.name) === 'image'
  return false
}

export function isAudioAttachment(a: { mime: string; name?: string }): boolean {
  if (a.mime.startsWith('audio/')) return true
  if (a.name) return getMediaType(a.name) === 'audio'
  return false
}

export function ensureHttpsMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('http://juicewrldapi.com')) {
    return `https://${url.slice('http://'.length)}`
  }
  return url
}

export function buildNewsAttachmentStreamUrl(attachment: NewsAttachment, download = false): string {
  if (attachment.id != null) {
    const name = encodeURIComponent(attachment.name || 'file')
    const base = `${NEWS_BASE}/attachments/${attachment.id}/stream/${name}`
    return download ? `${base}?download=1` : base
  }
  return ensureHttpsMediaUrl(attachment.url) ?? attachment.url
}

// Uploads one file and returns its hosted attachment record. Attachments go
// through a dedicated multipart endpoint (not inline in the post JSON) so a
// 25 MB file doesn't get base64-inflated into the request body. The post is
// then created/edited referencing the returned `url`s. Editor+.
export async function uploadAttachment(file: File): Promise<NewsAttachment> {
  assertEnabled()
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`)
  }
  const form = new FormData()
  form.append('file', file)
  // Note: no Content-Type header - the browser sets the multipart boundary.
  return apiRequest<NewsAttachment>(`${NEWS_BASE}/uploads/`, {
    method: 'POST',
    headers: authHeaders(getToken()),
    body: form,
  })
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  id: number
  title: string
  // Short plain-text teaser shown in the list.
  summary: string
  // Full article body (markdown/plain text) - shown when an item is opened.
  body: string
  // Optional lead image.
  image_url: string | null
  // Which channel this item belongs to (a channel id, never ALL_CHANNEL).
  channel: string
  // Freeform label, e.g. "Release", "Leak", "Announcement".
  category: string | null
  // Marks a hero/pinned story at the top of the feed.
  featured: boolean
  author: string | null
  // Account id of the poster - used to gate edit/delete: editors may only
  // modify their own posts, admins may modify any (see NewsView).
  author_id: number | null
  attachments: NewsAttachment[]
  published_at: string // ISO timestamp
}

export interface NewsItemInput {
  title: string
  summary?: string
  body: string
  channel: string
  category?: string | null
  featured?: boolean
  // Cover image: a base64 data URL for a newly-picked image, an existing hosted
  // URL to keep, or null to remove. (Small + pre-compressed, so it rides inline
  // - unlike attachments, which upload separately.)
  image_url?: string | null
  // The full desired attachment set as hosted references (upload files first via
  // uploadAttachment, then pass what they return here).
  attachments?: NewsAttachment[]
}

export type NewsSort = 'newest' | 'oldest'

export interface NewsListResponse {
  results: NewsItem[]
  count: number
  next: string | null
}

export interface FetchNewsParams {
  // A channel id, or ALL_CHANNEL/undefined for the unfiltered feed.
  channel?: string
  // Feed order by publish date. Defaults to 'newest'.
  sort?: NewsSort
  page?: number
  pageSize?: number
}

function newsListQuery(params: FetchNewsParams): string {
  const qs = new URLSearchParams()
  if (params.channel && params.channel !== ALL_CHANNEL) qs.set('channel', params.channel)
  // DRF-style ordering: '-published_at' newest first, 'published_at' oldest.
  if (params.sort) qs.set('ordering', params.sort === 'oldest' ? 'published_at' : '-published_at')
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  return qs.toString()
}

// Paginated news list. Returns an empty page while the feature is disabled so
// callers can render unconditionally without special-casing the pre-launch
// state themselves.
export async function fetchNews(params: FetchNewsParams = {}): Promise<NewsListResponse> {
  if (!NEWS_ENABLED) return { results: [], count: 0, next: null }

  const query = newsListQuery(params)
  return apiRequest<NewsListResponse>(`${NEWS_BASE}/${query ? `?${query}` : ''}`, {
    cacheKey: `news:list:${query}`,
  })
}

// Synchronous read of the last cached fetchNews response for the same
// params, or undefined. Lets NewsView render instantly on mount/channel
// switch instead of flashing a spinner while the network round-trip that
// fetchNews will do anyway is still in flight - stale-while-revalidate, same
// pattern as apiPeek in juicewrldApi.ts.
export function peekNews(params: FetchNewsParams = {}): NewsListResponse | undefined {
  if (!NEWS_ENABLED) return undefined
  return cacheGet<NewsListResponse>(`news:list:${newsListQuery(params)}`)
}

// Single article by id. Kept alongside the list for when a detail route lands.
export async function fetchNewsItem(id: number): Promise<NewsItem> {
  assertEnabled()
  return apiRequest<NewsItem>(`${NEWS_BASE}/${id}/`, { cacheKey: `news:item:${id}` })
}

// Editor+ - create a post. `author` is filled server-side from the token.
export async function createNewsItem(input: NewsItemInput): Promise<NewsItem> {
  assertEnabled()
  return authed<NewsItem>(`${NEWS_BASE}/`, { method: 'POST', body: JSON.stringify(input) })
}

// Editor+ - edit an existing post.
export async function updateNewsItem(id: number, input: Partial<NewsItemInput>): Promise<NewsItem> {
  assertEnabled()
  return authed<NewsItem>(`${NEWS_BASE}/${id}/`, { method: 'PATCH', body: JSON.stringify(input) })
}

// Editor+ - delete a post.
export async function deleteNewsItem(id: number): Promise<void> {
  assertEnabled()
  return authed<void>(`${NEWS_BASE}/${id}/`, { method: 'DELETE' })
}
