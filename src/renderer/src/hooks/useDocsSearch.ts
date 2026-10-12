// Shared search/tab state for DocsPage. Desktop and mobile wrap this in
// their own JSX/chrome - keep behavior here, layout in them.
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import type { TabId } from '../components/docs/content'

export function useDocsSearch(): {
  activeTab: TabId
  setActiveTab: (t: TabId) => void
  rawQuery: string
  setRawQuery: (q: string) => void
  query: string
  register: (id: string, tab: string, title: string, text: string) => void
  hitsByTab: Map<string, number>
  totalHits: number
} {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [rawQuery, setRawQuery] = useState('')

  // Sections self-report their text on mount. The registry is a ref (identity
  // must stay stable so `register` doesn't retrigger every Section's effect);
  // the counter bumps state so match counts recompute once entries land.
  const registry = useRef(new Map<string, { tab: string; title: string; text: string }>())
  const [indexVersion, bumpIndex] = useReducer((n: number) => n + 1, 0)
  const register = useCallback((id: string, tab: string, title: string, text: string) => {
    const prev = registry.current.get(id)
    if (prev && prev.text === text && prev.title === title) return
    registry.current.set(id, { tab, title, text })
    bumpIndex()
  }, [])

  const query = rawQuery.trim().toLowerCase()

  const hitsByTab = useMemo(() => {
    const counts = new Map<string, number>()
    if (!query) return counts
    for (const e of registry.current.values()) {
      if (e.title.toLowerCase().includes(query) || e.text.includes(query)) {
        counts.set(e.tab, (counts.get(e.tab) ?? 0) + 1)
      }
    }
    return counts
    // indexVersion is the signal that registry.current changed - it has no
    // other use here, hence the explicit reference.
  }, [query, indexVersion])

  const totalHits = useMemo(
    () => [...hitsByTab.values()].reduce((a, b) => a + b, 0),
    [hitsByTab]
  )

  return { activeTab, setActiveTab, rawQuery, setRawQuery, query, register, hitsByTab, totalHits }
}
