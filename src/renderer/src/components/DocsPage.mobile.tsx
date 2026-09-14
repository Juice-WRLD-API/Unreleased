import { useState, useRef, useReducer, useCallback, useMemo } from 'react'
import { ChevronLeft, ExternalLink, Search, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { TABS, TabPanel, type TabId } from './docs/content'
import { DocsPrimitivesProvider } from './docs/primitivesContext'
import { Code, Section, Endpoint, MethodPath } from './docs/primitives.mobile'

export default function DocsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [rawQuery, setRawQuery] = useState('')
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')

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

  // Wherever this was opened from (Settings, most likely) is where "back"
  // should return to - matching the app's other pushed pages (EditorPage,
  // LocalEditorPage) rather than a hardcoded destination.
  const backView = previousView && previousView !== 'docs' ? previousView : 'wrld'

  const primitives = useMemo(() => ({ Code, Section, Endpoint, MethodPath }), [])

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* App bar - same shape as the other pushed pages' */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2">
        <button
          onClick={() => setActiveView(backView)}
          aria-label="Back"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 px-0.5">
          <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">API Docs</h1>
          <p className="text-text-muted text-xs font-mono truncate">juicewrldapi.com</p>
        </div>
        <a
          href="https://juicewrldapi.com/api-docs"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open live docs"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
        >
          <ExternalLink size={18} />
        </a>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-1 pb-6">
        {/* Search */}
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setRawQuery('') }}
            placeholder="Search endpoints, fields, params…"
            className="w-full bg-[var(--surface-overlay)] rounded-xl pl-10 pr-16 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none transition-colors"
          />
          {rawQuery && (
            <>
              <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[10px] text-text-muted tabular-nums">
                {totalHits}
              </span>
              <button
                onClick={() => setRawQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-text-muted active:bg-surface-raised transition-colors"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {/* Tabs - a horizontally scrollable chip row rather than an
            underline tab bar (underlines read as desktop chrome and give no
            touch feedback of their own). */}
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-none">
          {TABS.map(tab => {
            const hits = hitsByTab.get(tab.id) ?? 0
            const dimmed = !!query && hits === 0
            const active = !query && activeTab === tab.id
            return (
              <button
                key={tab.id}
                // Tapping a tab while searching jumps to that category's
                // results instead of clearing the query - every matching tab
                // stays rendered (stacked, filtered by `visible` below), so
                // this just scrolls the target section into view.
                onClick={() => {
                  setActiveTab(tab.id)
                  if (query && hits > 0) {
                    document.getElementById(`docs-panel-${tab.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }}
                className={`shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                  active ? 'bg-accent text-white'
                    : dimmed ? 'bg-[var(--surface-overlay)] text-text-muted/40'
                    : 'bg-[var(--surface-overlay)] text-text-secondary active:bg-[var(--surface-raised)]'
                }`}
              >
                {tab.label}
                {!!query && hits > 0 && (
                  <span className="text-[10px] tabular-nums bg-black/15 rounded px-1 py-0.5">{hits}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="space-y-3">
          {query && totalHits === 0 && (
            <div className="text-center py-16">
              <Search size={28} className="mx-auto text-text-muted mb-3 opacity-40" />
              <p className="text-sm text-text-secondary">No matches for &ldquo;{rawQuery.trim()}&rdquo;</p>
              <p className="text-xs text-text-muted mt-1">Try an endpoint path, a field name, or a parameter.</p>
            </div>
          )}
          <DocsPrimitivesProvider value={primitives}>
            {TABS.map(tab => (
              <TabPanel
                key={tab.id}
                tab={tab}
                query={query}
                register={register}
                visible={query ? (hitsByTab.get(tab.id) ?? 0) > 0 : activeTab === tab.id}
                showLabel={!!query}
              />
            ))}
          </DocsPrimitivesProvider>
        </div>
      </div>
    </div>
  )
}
