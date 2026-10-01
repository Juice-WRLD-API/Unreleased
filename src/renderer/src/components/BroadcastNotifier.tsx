import { useEffect } from 'react'
import { subscribeNotifications } from '../lib/notificationSocket'
import { showNotificationBanner } from '../lib/chatNotifications'
import { notificationsSupported, focusAppWindow, playNotificationSound } from '../lib/notifications'
import { BROADCAST_LEVELS, type BroadcastFrame } from '../lib/broadcastApi'

// Broadcasts are rarer and more important than a chat ping, so the banner
// stays up longer than the default.
const BROADCAST_BANNER_MS = 15_000

const LEVEL_LABEL: Record<string, string> = {
  info: 'Announcement',
  success: 'Announcement',
  warning: 'Warning',
  error: 'Important',
}

let nextId = 1

// Headless - mounted once in the main window (App), next to NewsNotifier.
// Shows admin broadcasts as an in-app banner (always) and an OS notification
// (when permission was granted). Deliberately ignores the news/chat enable
// toggles: an admin message isn't something a user subscribed to.
export default function BroadcastNotifier(): JSX.Element | null {
  useEffect(() => subscribeNotifications((frame) => {
    if (frame.type !== 'broadcast' || frame.action !== 'message') return
    const f = frame as unknown as BroadcastFrame
    const message = typeof f.message === 'string' ? f.message.trim() : ''
    if (!message) return
    const level = BROADCAST_LEVELS.includes(f.level) ? f.level : 'info'
    const title = (typeof f.title === 'string' && f.title.trim()) || LEVEL_LABEL[level]

    showNotificationBanner({
      id: -nextId++,
      title,
      body: message,
      onOpen: focusAppWindow,
      autoDismissMs: BROADCAST_BANNER_MS,
      level,
    })
    if (!notificationsSupported() || Notification.permission !== 'granted') return
    playNotificationSound()
    try {
      const n = new Notification(title, { body: message, tag: `broadcast-${f.sent_at}` })
      n.onclick = () => { focusAppWindow(); n.close() }
    } catch {}
  }), [])

  return null
}
