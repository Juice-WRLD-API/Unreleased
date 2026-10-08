import { useEffect } from 'react'
import { Loader2, AlertCircle, RefreshCw, Server } from 'lucide-react'
import { Empty, QueueSearch } from './adminShared'
import { useCdnNodesAdmin, formatMbps } from '../hooks/useCdnNodesAdmin'
import { CdnBucketChip, CdnSyncBadge, CdnStatsStrip, CdnNodeNotices, CdnNodeFacts, CdnNodeActions } from './cdnNodesShared'

// Admin-only roster of distributed-CDN nodes (the volunteer machines running
// jwa-cdn-node). Nodes register anonymously and serve nothing until approved
// here; the server also pulls them on its own after repeated hash reports.
export default function CdnNodesTab(): JSX.Element {
  const {
    nodes, stats, loading, error, reload,
    filter, setFilter, filters, search, setSearch, visible,
    selectedId, setSelectedId, selected,
    busyId, actionError,
    approve, revoke, setActive, resetTrust, restore, remove,
  } = useCdnNodesAdmin()

  // Keep a valid selection as the filter/search narrows the roster.
  useEffect(() => {
    if (selectedId != null && visible.some((n) => n.node_id === selectedId)) return
    setSelectedId(visible[0]?.node_id ?? null)
  }, [visible, selectedId, setSelectedId])

  if (loading && nodes.length === 0) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-3 border-b border-[var(--border)] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {stats && <CdnStatsStrip stats={stats} columns="grid-cols-6" />}
        </div>
        <button onClick={reload} disabled={loading} title="Refresh"
          className="shrink-0 mt-2 text-accent hover:text-accent/80 transition-colors disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-[300px] shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
          <div className="shrink-0 flex flex-col gap-2 p-3 border-b border-[var(--border)]">
            <div className="flex flex-wrap gap-1">
              {filters.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                  }`}>
                  {f.label}
                  <span className={`text-[9px] px-1 rounded-full ${filter === f.id ? 'bg-accent/20' : 'bg-surface-raised'}`}>{f.count}</span>
                </button>
              ))}
            </div>
            <QueueSearch value={search} onChange={setSearch} placeholder="Search name, owner, region, IP…" matches={visible.length} total={nodes.length} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 && <Empty label={nodes.length === 0 ? 'No nodes registered' : 'No nodes'} />}
            {visible.map((n) => (
              <button key={n.node_id} onClick={() => setSelectedId(n.node_id)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors ${
                  selectedId === n.node_id ? 'bg-accent/10' : 'hover:bg-surface-raised'
                }`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <Server size={12} className="text-text-muted shrink-0" />
                  <span className="text-sm font-medium text-text-primary truncate flex-1">{n.name}</span>
                  <CdnBucketChip node={n} />
                </div>
                <p className="text-[10px] text-text-muted truncate pl-5">
                  {[n.owner_username || 'unclaimed', n.region, formatMbps(n.upload_speed_mbps) + ' up'].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? <Empty label="Select a node" /> : (
            <div className="max-w-2xl space-y-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-text-primary text-lg font-bold truncate">{selected.name}</h2>
                  <CdnBucketChip node={selected} />
                  <CdnSyncBadge node={selected} latest={selected.manifest_version ?? stats?.manifest_version} onRefresh={reload} busy={loading} />
                </div>
                <p className="text-text-muted text-xs mt-0.5 font-mono truncate">{selected.node_id}</p>
              </div>

              <CdnNodeNotices node={selected} />

              <CdnNodeActions
                node={selected}
                busy={busyId === selected.node_id}
                sizing="px-3 py-1.5 text-xs"
                onApprove={() => approve(selected)}
                onRevoke={() => revoke(selected)}
                onSetActive={(active) => setActive(selected, active)}
                onResetTrust={() => resetTrust(selected)}
                onRestore={() => restore(selected)}
                onDelete={() => remove(selected)}
              />
              {actionError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {actionError}</p>
              )}

              <hr className="border-[var(--border)]" />

              <CdnNodeFacts node={selected} columns="grid-cols-3" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
