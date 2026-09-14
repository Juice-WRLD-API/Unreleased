import { useEffect, useMemo, useReducer, useState } from 'react'
import { ChevronLeft, BarChart3 } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { apiFetch, apiPeek, CATEGORY_LABELS, CATEGORY_COLORS, type JWApiStats } from '../lib/juicewrldApi'
import { loadEraFullNames, eraLabel, listEras } from '../lib/eras'

// Catalog-wide numbers from GET /stats/ — everyone sees the same thing here,
// unlike StatsView ("Your Wrapped"), which is personal listening history.
// Reached from Home's hero stat row (see HomeView.desktop/.mobile) and by
// direct URL; not a persistent nav tab, so it behaves like Docs/News: a
// pushed page with a back chevron rather than a bottom-nav destination.

const CATEGORY_ORDER: (keyof JWApiStats['category_stats'])[] = [
  'released', 'unreleased', 'unsurfaced', 'recording_session',
]

function CategoryCard({ label, count, total, colorClass }: {
  label: string
  count: number
  total: number
  colorClass: string
}): JSX.Element {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${colorClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80 mb-1.5">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{count.toLocaleString()}</p>
      <p className="text-xs opacity-70 mt-0.5">{pct}% of catalog</p>
    </div>
  )
}

function EraBar({ label, count, max }: { label: string; count: number; max: number }): JSX.Element {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-text-primary text-xs font-medium truncate flex-1 min-w-0" title={label}>{label}</span>
        <span className="text-text-muted text-[10px] tabular-nums shrink-0">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${max > 0 ? Math.max(2, (count / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  )
}

export default function StatisticsView(): JSX.Element {
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')
  const backView = previousView && previousView !== 'statistics' ? previousView : 'home'

  const [stats, setStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setStats).catch(() => undefined)
  }, [])

  // listEras()/eraLabel() read a module-level cache that fills in
  // asynchronously — this just forces a re-render once loadEraFullNames
  // resolves so the era list and full-name labels appear without a reload.
  const [, bumpEras] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    loadEraFullNames().then(bumpEras).catch(() => undefined)
  }, [])

  const eraRows = useMemo(() => {
    if (!stats) return []
    const known = listEras()
    const seen = new Set(known.map((e) => e.name))
    const rows = known.map((e) => ({
      key: e.name,
      label: eraLabel(e.name, true),
      count: stats.era_stats[e.name] ?? 0,
    }))
    // Defensive: an era_stats key with no matching /eras/ row (shouldn't
    // normally happen) still gets a bar rather than silently vanishing.
    for (const [name, count] of Object.entries(stats.era_stats)) {
      if (!seen.has(name)) rows.push({ key: name, label: name, count })
    }
    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)
  }, [stats])

  const maxEraCount = eraRows[0]?.count ?? 0

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView(backView)}
            title="Back"
            aria-label="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">Statistics</h1>
          <span className="text-xs text-text-muted font-mono">juicewrldapi.com</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {!stats ? (
            <div className="space-y-4">
              <div className="h-24 bg-surface-raised animate-pulse rounded-xl" />
              <div className="h-32 bg-surface-raised animate-pulse rounded-xl" />
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center shrink-0">
                  <BarChart3 size={28} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-text-primary text-3xl font-bold tabular-nums">{stats.total_songs.toLocaleString()}</p>
                  <p className="text-text-muted text-sm">songs in the catalog</p>
                </div>
              </div>

              {/* Category breakdown */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2.5">By category</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {CATEGORY_ORDER.map((key) => (
                    <CategoryCard
                      key={key}
                      label={CATEGORY_LABELS[key]}
                      count={stats.category_stats[key]}
                      total={stats.total_songs}
                      colorClass={CATEGORY_COLORS[key]}
                    />
                  ))}
                </div>
              </div>

              {/* Era breakdown */}
              <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                  By era ({eraRows.length})
                </p>
                {eraRows.length === 0 ? (
                  <p className="text-text-muted text-xs">No era data yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {eraRows.map((row) => (
                      <EraBar key={row.key} label={row.label} count={row.count} max={maxEraCount} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
