import { useEffect, useState } from 'react'

// Keeps something rendered for `exitMs` after `show` goes false, so it can play
// an exit animation instead of vanishing on the spot. `exiting` is true for
// exactly that window - swap to the exit animation class while it is. Showing
// again mid-exit just cancels the unmount.
export function usePresence(show: boolean, exitMs: number): { mounted: boolean; exiting: boolean } {
  const [mounted, setMounted] = useState(show)
  useEffect(() => {
    if (show) { setMounted(true); return }
    const t = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(t)
  }, [show, exitMs])
  return { mounted: show || mounted, exiting: !show && mounted }
}

// The keyed version, for "which one is open" state (one open panel among
// many): the value `current` just moved away from, held for `exitMs` so its
// panel can animate shut. `snapshot` is whatever that panel was showing,
// captured in the same render the change lands in - before effects have moved
// shared state (a track list, say) over to the new value. Opening another
// value doesn't cut a closing one short; moving off a second one does.
export function useClosingValue<K, S>(current: K | null, snapshot: S, exitMs: number): { key: K; snapshot: S } | null {
  const [prev, setPrev] = useState(current)
  const [closing, setClosing] = useState<{ key: K; snapshot: S } | null>(null)
  if (current !== prev) {
    setPrev(current)
    if (prev != null) setClosing({ key: prev, snapshot })
  }
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(() => setClosing(null), exitMs)
    return () => window.clearTimeout(t)
  }, [closing, exitMs])
  return closing
}
