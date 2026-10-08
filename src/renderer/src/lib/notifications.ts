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
// Short chimes synthesized via Web Audio, rather than bundled audio files - OS
// notification sounds aren't reliably audible from the Electron renderer, so
// we play our own on top of the native notification. A handful of distinct
// tone sequences are offered as named "sounds" the user can pick in Settings.

export interface NotificationSoundNote {
  freq: number
  start: number
  duration: number
}

export interface NotificationSoundDef {
  id: string
  label: string
  notes: NotificationSoundNote[]
}

export const NOTIFICATION_SOUNDS: NotificationSoundDef[] = [
  {
    id: 'chime',
    label: 'Chime',
    notes: [
      { freq: 880, start: 0, duration: 0.12 },
      { freq: 1318.5, start: 0.09, duration: 0.18 },
    ],
  },
  {
    id: 'ping',
    label: 'Ping',
    notes: [
      { freq: 1568, start: 0, duration: 0.16 },
    ],
  },
  {
    id: 'pop',
    label: 'Pop',
    notes: [
      { freq: 523.25, start: 0, duration: 0.06 },
      { freq: 784, start: 0.05, duration: 0.09 },
    ],
  },
  {
    id: 'blip',
    label: 'Blip',
    notes: [
      { freq: 1046.5, start: 0, duration: 0.05 },
      { freq: 1046.5, start: 0.09, duration: 0.05 },
    ],
  },
  {
    id: 'rise',
    label: 'Rise',
    notes: [
      { freq: 659.25, start: 0, duration: 0.1 },
      { freq: 830.6, start: 0.07, duration: 0.1 },
      { freq: 1046.5, start: 0.14, duration: 0.16 },
    ],
  },
  {
    id: 'none',
    label: 'None',
    notes: [],
  },
]

const DEFAULT_SOUND_ID = 'chime'
const SOUND_KEY = 'unreleased:notificationSound'

export function getNotificationSoundId(): string {
  try {
    const v = localStorage.getItem(SOUND_KEY)
    return v && NOTIFICATION_SOUNDS.some((s) => s.id === v) ? v : DEFAULT_SOUND_ID
  } catch {
    return DEFAULT_SOUND_ID
  }
}

export function setNotificationSoundId(id: string): void {
  try {
    localStorage.setItem(SOUND_KEY, id)
  } catch {}
}

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

// Plays the given sound (by id), or the user's chosen sound when omitted -
// used both for live notifications and for the "preview" button in Settings.
export function playNotificationSound(soundId?: string): void {
  try {
    const def = NOTIFICATION_SOUNDS.find((s) => s.id === (soundId ?? getNotificationSoundId()))
    if (!def || def.notes.length === 0) return
    const ctx = getAudioContext()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    for (const { freq, start, duration } of def.notes) {
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
