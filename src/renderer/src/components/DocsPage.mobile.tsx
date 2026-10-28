import { useMemo, useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { TABS, TabPanel } from './docs/content'
import { DocsPrimitivesProvider } from './docs/primitivesContext'
import { Code, Section, Endpoint, MethodPath } from './docs/primitives.mobile'
import { useDocsSearch } from '../hooks/useDocsSearch'
import { BackButton, BarButton, CompactBar, LargeTitle, LARGE_TITLE_COLLAPSE, useScrolledPast } from './mobile/NavBar'
import { SearchField } from './mobile/SearchField'

export default function DocsPage(): JSX.Element {
  const { activeTab, setActiveTab, rawQuery, setRawQuery, query, register, hitsByTab, totalHits } = useDocsSearch()
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const collapsed = useScrolledPast(scrollEl, LARGE_TITLE_COLLAPSE)

  // Wherever this was opened from (Settings, most likely) is where "back"
  // should return to - matching the app's other pushed pages (EditorPage,
  // LocalEditorPage) rather than a hardcoded destination.
  const backView = previousView && previousView !== 'docs' ? previousView : 'wrld'

  const primitives = useMemo(() => ({ Code, Section, Endpoint, MethodPath }), [])

  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0">
      {/* A pushed page: back and the live-docs link stay pinned in the bar,
          the title collapses into it on scroll. */}
      <CompactBar
        title="API Docs"
        shown={collapsed}
        leading={<BackButton onClick={() => setActiveView(backView)} />}
        trailing={
          <BarButton label="Open live docs" onClick={() => window.open('https://juicewrldapi.com/api-docs', '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={19} />
          </BarButton>
        }
      />

      <div ref={setScrollEl} className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-dock">
        <LargeTitle inset="bar" title="API Docs" subtitle="juicewrldapi.com" />

        <div className="px-4">
          <SearchField
            value={rawQuery}
            onChange={setRawQuery}
            onKeyDown={(e) => { if (e.key === 'Escape') setRawQuery('') }}
            placeholder="Endpoints, fields, params"
            trailing={rawQuery ? <span className="pr-2.5 text-footnote text-text-muted tabular-nums">{totalHits}</span> : undefined}
          />
        </div>

        {/* Tabs - a horizontally scrollable chip row, the selected one
            inverted like the Tracker's. */}
        <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-4 scrollbar-none">
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
                className={`shrink-0 flex items-center gap-1.5 h-8 px-3.5 rounded-full text-subhead font-medium transition-colors ${
                  active ? 'bg-text-primary text-surface'
                    : dimmed ? 'bg-[var(--fill)] text-text-muted/40'
                    : 'bg-[var(--fill)] text-text-primary active:bg-[var(--fill-strong)]'
                }`}
              >
                {tab.label}
                {!!query && hits > 0 && (
                  <span className="text-caption1 tabular-nums text-accent">{hits}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="px-4 space-y-3">
          {query && totalHits === 0 && (
            <div className="text-center py-16">
              <Search size={32} strokeWidth={1.75} className="mx-auto text-text-muted mb-3" />
              <p className="text-headline text-text-primary">No results for &ldquo;{rawQuery.trim()}&rdquo;</p>
              <p className="text-subhead text-text-secondary mt-1">Try an endpoint path, a field name, or a parameter.</p>
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
