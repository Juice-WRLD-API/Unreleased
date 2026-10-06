import { useMemo } from 'react'
import { ChevronLeft, ExternalLink, Search, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { TABS, TabPanel } from './docs/content'
import { DocsPrimitivesProvider } from './docs/primitivesContext'
import { Code, Section, Endpoint, MethodPath } from './docs/primitives.desktop'
import { useDocsSearch } from '../hooks/useDocsSearch'

export default function DocsPage(): JSX.Element {
  const { activeTab, setActiveTab, rawQuery, setRawQuery, query, register, hitsByTab, totalHits } = useDocsSearch()
  const { setActiveView } = useStorePick('setActiveView')

  const primitives = useMemo(() => ({ Code, Section, Endpoint, MethodPath }), [])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0 border-b border-[var(--border)]">
        <div className="flex items-baseline gap-3 mb-4">
          <button
            onClick={() => setActiveView('wrld')}
            title="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0 self-center"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">API Docs</h1>
          <span className="text-xs text-text-muted font-mono">juicewrldapi.com</span>
          <a
            href="https://juicewrldapi.com/api-docs"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-accent transition-colors"
          >
            Open live docs <ExternalLink size={11} />
          </a>
        </div>
        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setRawQuery('') }}
            placeholder="Search all docs: endpoints, fields, params…"
            className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl pl-9 pr-16 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
          {rawQuery && (
            <>
              <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[10px] text-text-muted tabular-nums">
                {totalHits}
              </span>
              <button
                onClick={() => setRawQuery('')}
                title="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-0 scrollbar-none">
          {TABS.map(tab => {
            const hits = hitsByTab.get(tab.id) ?? 0
            const dimmed = !!query && hits === 0
            return (
              <button
                key={tab.id}
                // Clicking a tab while searching jumps to that category's
                // results instead of clearing the query - every matching tab
                // stays rendered (stacked, filtered by `visible` below), so
                // this just scrolls the target section into view.
                onClick={() => {
                  setActiveTab(tab.id)
                  if (query && hits > 0) {
                    document.getElementById(`docs-panel-${tab.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  !query && activeTab === tab.id
                    ? 'text-accent border-accent'
                    : `border-transparent hover:text-text-primary ${dimmed ? 'text-text-muted/40' : 'text-text-muted'}`
                }`}
              >
                {tab.label}
                {!!query && hits > 0 && (
                  <span className="text-[10px] tabular-nums bg-accent/15 text-accent rounded px-1 py-0.5">{hits}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
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
