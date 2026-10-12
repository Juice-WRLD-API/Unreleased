// Shared platform / environment detection. One source of truth so the audio
// code (background-audio guard) and the PWA install prompt agree on what "iOS"
// means, etc.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

// iOS / iPadOS - every browser there is WebKit. iPadOS 13+ reports a desktop
// ("MacIntel") UA, so the touch-point check is what distinguishes it from a
// real Mac (Electron desktop = MacIntel, 0 touch points → NOT flagged).
export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1))

export const IS_ANDROID = /Android/i.test(ua)

// WebKit ignores element volume on iOS. Crossfade must use a hard cut there
// or both slots would play at full volume; hide controls that cannot work.
export const CAN_SET_VOLUME = (() => {
  if (typeof document === 'undefined') return true
  try {
    const audio = document.createElement('audio')
    audio.volume = 0.5
    return audio.volume === 0.5
  } catch {
    return false
  }
})()

// Coarse "is this a phone/tablet" check - used to gate mobile-only UI.
export const IS_MOBILE = IS_IOS || IS_ANDROID

// True inside the Capacitor native wrap (not a browser tab on an Android
// phone, which IS_ANDROID also matches). The WebView serves the bundle from
// https://localhost, so anything that needs a real public URL or keys off
// "installed app vs browser tab" checks this.
export const IS_NATIVE_APP =
  typeof window !== 'undefined' &&
  !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

// The deployed site - what share links and OAuth callbacks point at from the
// native app, where window.location.origin is the WebView's https://localhost.
export const PUBLIC_ORIGIN = 'https://player.juicewrldapi.com'

/** Runs `fn` once the browser is idle, or after `timeoutMs` at the latest.
 *  Returns a canceller.
 *
 *  For background warm-up work only. Anything scheduled here gives up its
 *  slice of the startup network/CPU budget to whatever the user is actually
 *  looking at - the point is that a prefetch must never race the visible
 *  view's own first request. requestIdleCallback isn't in Safari <16.4, hence
 *  the timeout fallback. */
export function runWhenIdle(fn: () => void, timeoutMs = 2000): () => void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: timeoutMs })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, timeoutMs)
  return () => clearTimeout(id)
}

/** Origin to build shareable/absolute links against. In the native app
 *  `window.location.origin` is the WebView's https://localhost, which nobody
 *  else can open - links point at the deployed site there instead. */
export function shareOrigin(): string {
  return IS_NATIVE_APP ? PUBLIC_ORIGIN : window.location.origin
}

/** Public, shareable URL for a news post's /news/<id> page. */
export function newsShareUrl(id: number | string): string {
  return `${shareOrigin()}/news/${id}`
}

/** Public, shareable URL for a single song's /track/<id> page. */
export function trackShareUrl(songId: number): string {
  return `${shareOrigin()}/track/${songId}`
}

// True when the page is running as an installed PWA (launched from the home
// screen / app icon) rather than in a browser tab.
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  // The native app is the installed app: it lands on Home like one, and has
  // nothing to "install" (see InstallPrompt).
  if (IS_NATIVE_APP) return true
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
