// Desktop notifications for new chat messages. Delivery uses the Web
// Notifications API (see lib/notifications), same as News. Firing is
// event-driven off the chat socket (see chatStore's bumpUnread) rather than
// polled, since chat already pushes messages in real time.

import { notificationsSupported, focusAppWindow } from './notifications'

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
}

// Fires a single OS notification for a new chat message. Clicking it focuses
// the app (in Electron) and routes to the room via the callback.
export function fireChatNotification(payload: ChatNotificationPayload): void {
  if (!chatNotificationsEnabled() || !notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const n = new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? undefined,
      tag: `chat-${payload.id}`, // dedupes if the same event somehow fires twice
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
