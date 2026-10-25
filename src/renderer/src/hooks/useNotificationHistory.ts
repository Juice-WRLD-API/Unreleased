import { useSyncExternalStore } from 'react'
import { getNotifications, subscribeNotificationHistory, unreadNotificationCount, type NotificationEntry } from '../lib/notificationHistory'

const subscribe = (onChange: () => void): (() => void) => subscribeNotificationHistory(onChange)

/** The notification area's entries, newest first (lib/notificationHistory). */
export function useNotificationHistory(): NotificationEntry[] {
  return useSyncExternalStore(subscribe, getNotifications)
}

/** How many arrived since the notification area was last opened - the badge. */
export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(subscribe, () => unreadNotificationCount())
}
