// Generic Web Notification permission helpers shared by the news and chat
// notification modules. Delivery uses the Web Notifications API, which the
// Electron renderer maps to native OS notifications, so no IPC is needed.

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied'
}

// Asks the OS/browser for permission if we don't have it yet. Returns whether
// notifications are usable afterwards.
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

// Focuses the app window - the native OS window in Electron, or just the tab
// on the web.
export function focusAppWindow(): void {
  const el = (window as unknown as { electron?: { focusMainWindow?: () => void } }).electron
  el?.focusMainWindow?.()
  window.focus()
}
