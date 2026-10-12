import { useSyncExternalStore } from 'react'

// Whether the terminal page covers the whole window (`full`). It outlives the
// page: closing the terminal drops out of fullscreen, but the flag stays so the
// next open comes back fullscreen. Only `full` (or Esc) clears it.
let on = false
const listeners = new Set<() => void>()

/** Browser (real) fullscreen, matched to `want`. Needs a user gesture to enter:
 *  the command's keypress, or the shortcut that reopens the page. Failures
 *  (iframe, denied, unsupported) just leave the in-page version. */
export function syncBrowserFullscreen(want: boolean): void {
  try {
    if (want && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
    else if (!want && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  } catch { /* in-page fullscreen still applies */ }
}

export function setTermFullscreen(next: boolean): void {
  if (next === on) return
  on = next
  listeners.forEach((l) => l())
  syncBrowserFullscreen(next)
}

export const getTermFullscreen = (): boolean => on

export function useTermFullscreen(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getTermFullscreen,
  )
}
