import { Loader2, AlertCircle, RefreshCw, Server, ChevronLeft } from 'lucide-react'
import type { CdnAdminNode } from '../lib/cdnAdminApi'
import { Empty, QueueSearch } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'
import { useCdnNodesAdmin, formatMbps } from '../hooks/useCdnNodesAdmin'
import { CdnBucketChip, CdnSyncBadge, CdnStatsStrip, CdnNodeNotices, CdnNodeFacts, CdnNodeActions } from './cdnNodesShared'

// Mobile layout for the CDN nodes admin tab - list, then a full-screen detail
// on tap (same pattern as EraTab.mobile). Behavior lives in useCdnNodesAdmin.

function NodeDetail({ node, latestManifest, onRefresh, busy, actionError, onBack, actions }: {
  node: CdnAdminNode
  latestManifest?: number
  onRefresh: () => void
  busy: boolean
  actionError: string | null
  onBack: () => void
  actions: Omit<Parameters<typeof CdnNodeActions>[0], 'node' | 'busy' | 'sizing'>
}): JSX.Element {
  useBackToClose(onBack, true)

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={onBack} title="Back" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-text-primary truncate">{node.name}</p>
          <p className="text-[11px] text-text-muted truncate">{node.owner_username || 'Unclaimed'}{node.region ? ` · ${node.region}` : ''}</p>
        </div>
        <div className="shrink-0 pr-2 flex items-center gap-1">
          <CdnSyncBadge node={node} latest={node.manifest_version ?? latestManifest} onRefresh={onRefresh} />
          <CdnBucketChip node={node} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <CdnNodeNotices node={node} />
        <CdnNodeActions node={node} busy={busy} sizing="h-10 px-4 text-sm" {...actions} />
        {actionError && (
          <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {actionError}</p>
        )}
        <hr className="border-[var(--border)]" />
        <CdnNodeFacts node={node} columns="grid-cols-2" />
      </div>
    </div>
  )
}

export default function CdnNodesTab(): JSX.Element {
  const {
    nodes, stats, loading, error, reload,
    filter, setFilter, filters, search, setSearch, visible,
    setSelectedId, selected,
    busyId, actionError,
    approve, revoke, setActive, resetTrust, restore, remove,
  } = useCdnNodesAdmin()

  if (loading && nodes.length === 0) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  if (selected) {
    return (
      <NodeDetail
        key={selected.node_id}
        node={selected}
        latestManifest={stats?.manifest_version}
        onRefresh={reload}
        busy={busyId === selected.node_id}
        actionError={actionError}
        onBack={() => setSelectedId(null)}
        actions={{
          onApprove: () => approve(selected),
          onRevoke: () => revoke(selected),
          onSetActive: (active) => setActive(selected, active),
          onResetTrust: () => resetTrust(selected),
          onRestore: () => restore(selected),
          onDelete: () => remove(selected),
        }}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
          <Server size={12} /> CDN nodes
        </p>
        <button onClick={reload} disabled={loading} title="Refresh"
          className="w-9 h-9 flex items-center justify-center rounded-full text-accent active:bg-surface-overlay disabled:opacity-40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {stats && <div className="p-3"><CdnStatsStrip stats={stats} columns="grid-cols-2" /></div>}

        <div className="px-3 pb-2 space-y-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {filters.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted active:bg-surface-overlay'
                }`}>
                {f.label}
                <span className={`text-[10px] px-1 rounded-full ${filter === f.id ? 'bg-accent/20' : 'bg-surface-raised'}`}>{f.count}</span>
              </button>
            ))}
          </div>
          <QueueSearch value={search} onChange={setSearch} placeholder="Search nodes…" matches={visible.length} total={nodes.length} />
        </div>

        {visible.length === 0 && <div className="py-10"><Empty label={nodes.length === 0 ? 'No nodes registered' : 'No nodes'} /></div>}
        {visible.map((n) => (
          <button key={n.node_id} onClick={() => setSelectedId(n.node_id)}
            className="w-full text-left px-4 py-3 border-t border-[var(--border)] active:bg-surface-raised transition-colors">
            <div className="flex items-center gap-2">
              <Server size={13} className="text-text-muted shrink-0" />
              <span className="text-sm font-semibold text-text-primary truncate flex-1">{n.name}</span>
              <CdnBucketChip node={n} />
            </div>
            <p className="text-[11px] text-text-muted mt-0.5 truncate pl-5">
              {[n.owner_username || 'unclaimed', n.region, formatMbps(n.upload_speed_mbps) + ' up'].filter(Boolean).join(' · ')}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
