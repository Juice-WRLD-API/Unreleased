import { useSyncExternalStore } from 'react'

// Whether the terminal page covers the whole window (`full`). Session-only: the
// page clears it when it unmounts, so leaving the terminal never strands the
// next visit in a fullscreen the user has forgotten about.
let on = false
const listeners = new Set<() => void>()

export function setTermFullscreen(next: boolean): void {
  if (next === on) return
  on = next
  listeners.forEach((l) => l())
  // Browser fullscreen too. Called from the command's run(), still inside the
  // keypress that submitted it, which is what lets requestFullscreen through.
  // Failures (iframe, denied, unsupported) just leave the in-page version.
  try {
    if (next && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
    else if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  } catch { /* in-page fullscreen still applies */ }
}

export const getTermFullscreen = (): boolean => on

export function useTermFullscreen(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getTermFullscreen,
  )
}
