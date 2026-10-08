// A short-lived message for playback problems that otherwise fail silently
// (the Player just stops). Rendered by components/PlaybackNotice.
import { useSyncExternalStore } from 'react'

const SHOW_MS = 4000

let notice: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function set(next: string | null): void {
  notice = next
  listeners.forEach((l) => l())
}

export function showPlaybackNotice(message: string): void {
  if (timer) clearTimeout(timer)
  set(message)
  timer = setTimeout(() => { timer = null; set(null) }, SHOW_MS)
}

export function usePlaybackNotice(): string | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => notice,
  )
}
