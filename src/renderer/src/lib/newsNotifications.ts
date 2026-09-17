// News notifications: subscriptions, delivery, and new-post detection.
//
// Subscriptions live in localStorage (source of truth, works signed-out and
// offline) and are mirrored to the user profile's `news_subscriptions` blob
// once the backend supports it - same pattern as song prefs / playlist folders.
// Delivery uses the Web Notifications API, which the Electron renderer maps to
// native OS notifications, so no IPC is needed. Detection is a poll that diffs
// the latest feed against the highest post id we've already shown.
//
// All of it is inert until NEWS_ENABLED (see newsApi) - the poll returns nothing
// and the profile push no-ops, so this ships dormant with the rest of the
// prepared frontend.
import { JWAPI_BASE } from './juicewrldApi'
import { getToken } from './userApi'
import { apiRequest } from './apiClient'
import { fetchNews, NEWS_ENABLED, type NewsItem } from './newsApi'
import { notificationsSupported, notificationPermission, ensureNotifyPermission, focusAppWindow } from './notifications'

export { notificationsSupported, notificationPermission, ensureNotifyPermission }

const SUBS_KEY = 'unreleased:newsSubscriptions'
const ENABLED_KEY = 'unreleased:newsNotificationsEnabled'
const LAST_SEEN_KEY = 'unreleased:newsLastSeenId'
const ME_URL = `${JWAPI_BASE}/accounts/account/me/`

// ─── Subscriptions ────────────────────────────────────────────────────────────

export function getSubscriptions(): string[] {
  try {
    const raw = localStorage.getItem(SUBS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeSubscriptions(ids: string[]): void {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify([...new Set(ids)]))
  } catch {}
  // Best-effort profile sync - never blocks the local write.
  void pushSubscriptions()
}

export function isSubscribed(channelId: string): boolean {
  return getSubscriptions().includes(channelId)
}

export function setSubscribed(channelId: string, subscribed: boolean): string[] {
  const cur = getSubscriptions()
  const next = subscribed ? [...cur, channelId] : cur.filter((id) => id !== channelId)
  writeSubscriptions(next)
  return getSubscriptions()
}

// Union the profile's copy into the local set on login, so a subscription made
// on another device shows up here. Local-only ids are kept (pushed back up).
export function mergeSubscriptionsFromProfile(remote: string[] | undefined): void {
  if (!remote || remote.length === 0) return
  writeSubscriptions([...getSubscriptions(), ...remote])
}

// Replaces the profile's `news_subscriptions` with this device's set. Gated:
// no-ops while the feature is off or signed out.
export async function pushSubscriptions(): Promise<void> {
  if (!NEWS_ENABLED) return
  const token = getToken()
  if (!token) return
  try {
    await apiRequest<unknown>(ME_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify({ news_subscriptions: getSubscriptions() }),
    })
  } catch {
    // A failed sync is non-fatal - localStorage already holds the truth.
  }
}

// ─── Master enable ────────────────────────────────────────────────────────────

export function notificationsEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY)
    return v === null ? true : v === 'true'
  } catch {
    return true
  }
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(on))
  } catch {}
}

// ─── Permission + delivery ────────────────────────────────────────────────────

// Fires a single OS notification for a post. Clicking it focuses the app (in
// Electron) and routes to News via the callback.
export function fireNewsNotification(item: NewsItem, onOpen: (item: NewsItem) => void): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const body = item.summary?.trim() || item.body?.trim().slice(0, 140) || ''
    const n = new Notification(item.title, {
      body,
      icon: item.image_url ?? undefined,
      tag: `news-${item.id}`, // dedupes if the same post somehow fires twice
    })
    n.onclick = () => {
      focusAppWindow()
      onOpen(item)
      n.close()
    }
  } catch {
    // Some environments throw on construction (e.g. permission race) - ignore.
  }
}

// ─── New-post detection ───────────────────────────────────────────────────────

function getLastSeenId(): number | null {
  try {
    const v = localStorage.getItem(LAST_SEEN_KEY)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
}

function setLastSeenId(id: number): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(id))
  } catch {}
}

// Polls the latest feed and returns posts in subscribed channels that are newer
// than anything we've shown before. Advances the high-water mark to the newest
// id seen (any channel) so nothing re-fires. On the very first run it just
// seeds the mark and returns nothing - we don't want to blast the whole backlog.
export async function checkForNewPosts(): Promise<NewsItem[]> {
  if (!NEWS_ENABLED || !notificationsEnabled()) return []
  const subs = getSubscriptions()
  if (subs.length === 0) return []

  let items: NewsItem[]
  try {
    const res = await fetchNews({ pageSize: 30 })
    items = res.results
  } catch {
    return []
  }
  if (items.length === 0) return []

  const maxId = items.reduce((m, i) => Math.max(m, i.id), 0)
  const lastSeen = getLastSeenId()
  setLastSeenId(maxId)

  // First run: seed the baseline silently.
  if (lastSeen === null) return []

  return items
    .filter((i) => i.id > lastSeen && subs.includes(i.channel))
    .sort((a, b) => a.id - b.id) // oldest-first so notifications arrive in order
}
