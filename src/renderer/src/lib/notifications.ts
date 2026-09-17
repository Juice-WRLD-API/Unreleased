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

// ─── Notification chime ───────────────────────────────────────────────────────
// A short two-tone chime synthesized via Web Audio, rather than a bundled audio
// file - OS notification sounds aren't reliably audible from the Electron
// renderer, so we play our own on top of the native notification.

let sharedAudioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
    .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctor()
  }
  return sharedAudioCtx
}

export function playNotificationSound(): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    const notes: Array<{ freq: number; start: number; duration: number }> = [
      { freq: 880, start: 0, duration: 0.12 },
      { freq: 1318.5, start: 0.09, duration: 0.18 },
    ]

    for (const { freq, start, duration } of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = now + start
      const t1 = t0 + duration
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(0.2, t0 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t1 + 0.02)
    }
  } catch {
    // Audio can fail to init in some environments (no user gesture yet, etc).
  }
}
