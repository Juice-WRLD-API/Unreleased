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
}

export const getTermFullscreen = (): boolean => on

export function useTermFullscreen(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getTermFullscreen,
  )
}
