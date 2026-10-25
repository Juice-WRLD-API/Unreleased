import { useEffect, useState } from 'react'

// How long a list keeps its `rows-cascade` class (index.css): enough for the
// staggered entrance of its first rows to finish.
const CASCADE_MS = 700

// Whether a list's rows should be cascading in right now: briefly true when
// the list first has rows to show, and again when `key` switches it to a
// different set (another playlist). Never because more rows mounted later -
// scrolling a windowed list, the next page loading, a row added - so the
// stagger plays on arriving at a list, not while using it. Put the returned
// flag on the rows' direct parent as `rows-cascade`.
export function useCascade(ready: boolean, key: unknown = null): boolean {
  const [shownFor, setShownFor] = useState<{ key: unknown } | null>(null)
  const [on, setOn] = useState(false)
  // Decided during render (not in an effect) so the class is there on the
  // very commit the rows mount in - they never paint once un-animated.
  if (ready && (!shownFor || shownFor.key !== key)) {
    setShownFor({ key })
    setOn(true)
  }
  useEffect(() => {
    if (!on) return
    const t = window.setTimeout(() => setOn(false), CASCADE_MS)
    return () => window.clearTimeout(t)
  }, [on, shownFor])
  return on
}
