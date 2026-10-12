import { useEffect } from 'react'
import { subscribeNotifications } from '../lib/notificationSocket'
import { showNotificationBanner } from '../lib/chatNotifications'
import { notificationsSupported, focusAppWindow, playNotificationSound } from '../lib/notifications'
import { BROADCAST_LEVELS, fetchRecentBroadcasts, type BroadcastLevel } from '../lib/broadcastApi'

// Broadcasts are rarer and more important than a chat ping, so the banner
// stays up longer than the default.
const BROADCAST_BANNER_MS = 15_000

// Catch-up can return up to 20 messages (a day's worth) - the banner only
// holds a few at once, so only surface the newest of them.
const CATCHUP_MAX = 3

const LAST_SEEN_KEY = 'unreleased:broadcastLastSeenId'

const LEVEL_LABEL: Record<BroadcastLevel, string> = {
  info: 'Announcement',
  success: 'Announcement',
  warning: 'Warning',
  error: 'Important',
}

let nextBannerId = 1

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

interface Incoming {
  id?: number
  title?: unknown
  message?: unknown
  level?: unknown
  sent_at?: unknown
}

// Raises the banner (and, for live pushes, an OS notification). Returns false
// when it was a duplicate or empty. A broadcast can arrive over both the
// socket and the catch-up list, so anything at or below the stored high-water
// id is dropped; frames without an id (older server) can't be deduped and
// always show.
function present(m: Incoming, opts: { os: boolean }): boolean {
  if (m.id != null) {
    const last = getLastSeenId()
    if (last !== null && m.id <= last) return false
    setLastSeenId(m.id)
  }
  const message = typeof m.message === 'string' ? m.message.trim() : ''
  if (!message) return false
  const level: BroadcastLevel = BROADCAST_LEVELS.includes(m.level as BroadcastLevel) ? (m.level as BroadcastLevel) : 'info'
  const title = (typeof m.title === 'string' && m.title.trim()) || LEVEL_LABEL[level]

  showNotificationBanner({
    id: -nextBannerId++,
    title,
    body: message,
    onOpen: focusAppWindow,
    autoDismissMs: BROADCAST_BANNER_MS,
    level,
  })
  if (opts.os && notificationsSupported() && Notification.permission === 'granted') {
    playNotificationSound()
    try {
      const n = new Notification(title, { body: message, tag: `broadcast-${m.id ?? String(m.sent_at)}` })
      n.onclick = () => { focusAppWindow(); n.close() }
    } catch {}
  }
  return true
}

async function catchUp(): Promise<void> {
  const last = getLastSeenId()
  let missed
  try {
    missed = await fetchRecentBroadcasts(last ?? undefined)
  } catch {
    return
  }
  if (missed.length === 0) return
  // Everything fetched counts as seen, even the older ones we skip showing.
  const newest = missed.reduce((m, b) => Math.max(m, b.id), 0)
  const shown = missed.slice(-CATCHUP_MAX)
  for (const b of shown) present(b, { os: false })
  if (newest > (getLastSeenId() ?? 0)) setLastSeenId(newest)
}

// Headless - mounted once in the main window (App), next to NewsNotifier.
// Shows admin broadcasts as an in-app banner (always) and an OS notification
// (live pushes only, when permission was granted). Deliberately ignores the
// news/chat enable toggles: an admin message isn't something a user
// subscribed to. Every (re)connect also fetches the public catch-up list, so
// a broadcast sent while the app was closed or offline still shows once.
export default function BroadcastNotifier(): JSX.Element | null {
  useEffect(() => subscribeNotifications(
    (frame) => {
      if (frame.type !== 'broadcast' || frame.action !== 'message') return
      present(frame as Incoming, { os: true })
    },
    () => { void catchUp() },
  ), [])

  return null
}
