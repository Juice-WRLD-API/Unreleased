// Tracks which AdminPage tabs have ever been shown, so a switched-away tab
// stays mounted (just hidden) instead of tearing down and re-triggering
// every <img> in it on every switch. Identical in desktop + mobile.
import { useEffect, useState } from 'react'

export function useVisitedTabs<T>(tab: T): Set<T> {
  const [visited, setVisited] = useState<Set<T>>(() => new Set([tab]))
  useEffect(() => { setVisited(prev => prev.has(tab) ? prev : new Set(prev).add(tab)) }, [tab])
  return visited
}
