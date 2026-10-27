// Desktop notifications for new chat messages. Delivery uses the Web
// Notifications API (see lib/notifications), same as News. Firing is
// event-driven off the chat socket (see chatStore's bumpUnread) rather than
// polled, since chat already pushes messages in real time.

import { notificationsSupported, focusAppWindow, playNotificationSound } from './notifications'
import { recordNotification, type NotificationKind, type NotificationTarget } from './notificationHistory'

export { notificationsSupported, notificationPermission, ensureNotifyPermission } from './notifications'

const ENABLED_KEY = 'unreleased:chatNotificationsEnabled'

export function chatNotificationsEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY)
    return v === null ? true : v === 'true'
  } catch {
    return true
  }
}

export function setChatNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(on))
  } catch {}
}

export interface ChatNotificationPayload {
  id: number
  title: string
  body: string
  icon?: string | null
  onOpen: () => void
  /** Banner lifetime; the toast default applies when omitted. */
  autoDismissMs?: number
  /** Tints the banner (admin broadcasts); plain toast when omitted. */
  level?: 'info' | 'success' | 'warning' | 'error'
  /** OS notification tag; defaults to `chat-<id>`. Also the entry's id in
   *  the notification area, so one event is never logged twice. */
  tag?: string
  /** Which source raised it, for the notification area. Defaults to chat. */
  kind?: NotificationKind
  /** Where the notification area's entry goes when clicked, since onOpen
   *  doesn't survive a reload. None: the entry just shows its full text. */
  target?: NotificationTarget
}

function record(payload: ChatNotificationPayload): void {
  const kind = payload.kind ?? 'chat'
  recordNotification({
    // Banner-only ids (broadcasts without a server id) are a per-session
    // counter, so they'd collide with last session's entries.
    id: payload.tag ?? (payload.id > 0 ? `${kind}-${payload.id}` : undefined),
    kind,
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    level: payload.level,
    target: payload.target,
  })
}

// In-app banner (Discord-style toast) subscribers - kept separate from the OS
// Notification API so the banner still shows even when OS permission was
// never granted, as long as the user hasn't turned chat notifications off.
type BannerListener = (payload: ChatNotificationPayload) => void
const bannerListeners = new Set<BannerListener>()

export function onChatNotificationBanner(listener: BannerListener): () => void {
  bannerListeners.add(listener)
  return () => bannerListeners.delete(listener)
}

/** Shows the in-app banner only (no sound, no OS notification) - for other
 *  notification sources such as news that reuse the same toast. */
export function showNotificationBanner(payload: ChatNotificationPayload): void {
  record(payload)
  for (const listener of bannerListeners) listener(payload)
}

// Fires a chat notification: plays the chime, shows the in-app banner, and -
// if the OS permission was granted - a native OS notification too. Clicking
// either focuses the app (in Electron) and routes to the room via the callback.
export function fireChatNotification(payload: ChatNotificationPayload): void {
  if (!chatNotificationsEnabled()) return
  playNotificationSound()
  record(payload)
  for (const listener of bannerListeners) listener(payload)

  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const n = new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? undefined,
      tag: payload.tag ?? `chat-${payload.id}`, // dedupes if the same event somehow fires twice
    })
    n.onclick = () => {
      focusAppWindow()
      payload.onOpen()
      n.close()
    }
  } catch {
    // Some environments throw on construction (e.g. permission race) - ignore.
  }
}
