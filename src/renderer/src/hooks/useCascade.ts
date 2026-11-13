import { useEffect, useRef, useState } from 'react'

// How long a list keeps its `rows-cascade` class (index.css): enough for the
// staggered entrance of its first rows to finish.
const CASCADE_MS = 700

// Whether a list's rows should be cascading in right now: briefly true when
// the list first has rows to show, and again when `key` switches it to a
// different set (another playlist). Never because more rows mounted later -
// scrolling a windowed list, the next page loading, a row added - so the
// stagger plays on arriving at a list, not while using it. Put the returned
// flag on the rows' direct parent as `rows-cascade`.
//
// `quietMs`: for a hook that lives in a whole view, how long after mount the
// view's own entrance (ViewFade's fade, or the browse-page swipe) is running.
// Rows arriving in that window don't cascade - a stagger inside the page's
// entrance reads as the rows lagging behind it.
export function useCascade(ready: boolean, key: unknown = null, quietMs = 0): boolean {
  const [shownFor, setShownFor] = useState<{ key: unknown } | null>(null)
  const [on, setOn] = useState(false)
  const mountedAt = useRef(0)
  if (!mountedAt.current) mountedAt.current = performance.now()
  // Decided during render (not in an effect) so the class is there on the
  // very commit the rows mount in - they never paint once un-animated.
  if (ready && (!shownFor || shownFor.key !== key)) {
    setShownFor({ key })
    if (performance.now() - mountedAt.current >= quietMs) setOn(true)
  }
  useEffect(() => {
    if (!on) return
    const t = window.setTimeout(() => setOn(false), CASCADE_MS)
    return () => window.clearTimeout(t)
  }, [on, shownFor])
  return on
}
