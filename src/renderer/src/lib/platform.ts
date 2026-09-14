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

// Coarse "is this a phone/tablet" check - used to gate mobile-only UI.
export const IS_MOBILE = IS_IOS || IS_ANDROID

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

/** Origin to build shareable/absolute links against. */
export function shareOrigin(): string {
  return window.location.origin
}

// True when the page is running as an installed PWA (launched from the home
// screen / app icon) rather than in a browser tab.
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
