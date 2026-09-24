import { useCallback, useEffect, useState } from 'react'
import { Loader2, Server, Trash2, Unlink } from 'lucide-react'
import * as api from '../lib/cdnAccountApi'
import type { CdnOwnedNode } from '../lib/cdnAccountApi'
import { VIOLATION_LIMIT } from '../lib/cdnAdminApi'
import { formatBytes, errorMessage } from '../lib/format'
import { relativeTime } from './adminShared'
import { CdnBucketChip, CdnSyncBadge } from './cdnNodesShared'
import { formatMbps } from '../hooks/useCdnNodesAdmin'

type NodeAction = 'unlink' | 'delete'

function statsLine(n: CdnOwnedNode): string {
  const parts: string[] = []
  if (n.current_storage_bytes != null) {
    parts.push(n.max_storage_bytes ? `${formatBytes(n.current_storage_bytes)} of ${formatBytes(n.max_storage_bytes)}` : formatBytes(n.current_storage_bytes))
  }
  if (n.file_count != null) parts.push(`${n.file_count.toLocaleString()} files`)
  if (n.total_bytes_served) parts.push(`${formatBytes(n.total_bytes_served)} served`)
  if (n.upload_speed_mbps) parts.push(`${formatMbps(n.upload_speed_mbps)} up`)
  if (n.observed_download_speed_mbps) parts.push(`${formatMbps(n.observed_download_speed_mbps)} to listeners`)
  if (n.last_heartbeat !== undefined) parts.push(`seen ${relativeTime(n.last_heartbeat)}`)
  return parts.join(' · ')
}

// Settings > Account: the CDN nodes linked to this account. Read-only apart
// from unlinking and deleting - a node's name, storage and channels live in the node app,
// which pushes them to the server on every save there and never reads them
// back, so editing them here would just be overwritten.
export default function MyCdnNodes(): JSX.Element {
  const [nodes, setNodes] = useState<CdnOwnedNode[] | null>(null)
  const [confirming, setConfirming] = useState<{ id: string; action: NodeAction } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setNodes(await api.fetchMyNodes())
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your nodes'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const refresh = (): void => {
    setRefreshing(true)
    void load().finally(() => setRefreshing(false))
  }

  const run = async (node: CdnOwnedNode, action: NodeAction): Promise<void> => {
    setBusy(node.node_id)
    try {
      await (action === 'delete' ? api.deleteMyNode(node.node_id) : api.unlinkMyNode(node.node_id))
      setConfirming(null)
      setNodes((prev) => prev?.filter((n) => n.node_id !== node.node_id) ?? prev)
    } catch (err) {
      setError(errorMessage(err, action === 'delete' ? 'Could not delete the node' : 'Could not unlink the node'))
    } finally {
      setBusy(null)
    }
  }

  if (!nodes) {
    return error
      ? <p className="text-red-400 text-[11px] py-2">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading nodes…</div>
  }

  return (
    <div>
      {nodes.length === 0 && <p className="text-text-muted text-xs py-3">No nodes linked to this account.</p>}
      {nodes.map((n) => {
        const line = statsLine(n)
        return (
          <div key={n.node_id} className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#475569]">
                <Server size={13} className="text-white" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p className="text-text-primary text-sm truncate flex items-center gap-2">
                  <span className="truncate">{n.name || 'Unnamed node'}</span>
                  <CdnBucketChip node={n} />
                  {n.is_public === false && <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Private</span>}
                </p>
                {line && <p className="text-text-muted text-[11px] truncate">{line}</p>}
                {(n.hash_violations ?? 0) > 0 && (
                  <p className="text-amber-400 text-[11px]">
                    {n.hash_violations} of {VIOLATION_LIMIT} bad-file reports from listeners before the server disables it. The node re-checks its files on its own.
                  </p>
                )}
              </div>
            </div>
            {confirming?.id === n.node_id ? (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-muted">{confirming.action === 'delete' ? 'Delete for good?' : 'Unlink?'}</span>
                <button onClick={() => setConfirming(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button
                  onClick={() => void run(n, confirming.action)}
                  disabled={busy === n.node_id}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                >
                  {busy === n.node_id && <Loader2 size={11} className="animate-spin" />}{confirming.action === 'delete' ? 'Delete' : 'Unlink'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 shrink-0">
                <CdnSyncBadge node={n} onRefresh={refresh} busy={refreshing} />
                <button
                  onClick={() => setConfirming({ id: n.node_id, action: 'unlink' })}
                  title="Unlink from your account"
                  aria-label="Unlink from your account"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary"
                >
                  <Unlink size={15} />
                </button>
                <button
                  onClick={() => setConfirming({ id: n.node_id, action: 'delete' })}
                  title="Delete node"
                  aria-label="Delete node"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-red-400"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        )
      })}
      <p className="text-text-muted text-[11px] pt-2">
        To link a node, open the CDN node app, go to Setup &gt; Account and paste your auth token from this page.
        Unlinking only removes the node from your account. It keeps serving and can be re-linked with its API key.
        Deleting removes it from the network for good, with its stats and history, and its API key stops working.
      </p>
      {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
    </div>
  )
}
