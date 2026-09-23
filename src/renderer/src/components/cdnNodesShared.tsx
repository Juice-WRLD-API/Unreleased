// Presentational pieces shared by CdnNodesTab (desktop) and its mobile
// variant - the parts that read the same at either width. Buttons stay in
// each layout since their touch-target sizing differs.
import { AlertCircle, Loader2 } from 'lucide-react'
import type { CdnAdminNode, CdnAdminStats } from '../lib/cdnAdminApi'
import { wasAutoDisabled, VIOLATION_LIMIT, DEFAULT_TRUST_SCORE } from '../lib/cdnAdminApi'
import type { CdnOwnedNode } from '../lib/cdnAccountApi'
import { cdnNodeBucket, CDN_BUCKET_STYLE, formatMbps } from '../hooks/useCdnNodesAdmin'
import { formatBytes } from '../lib/format'
import { relativeTime, shortDate, CopyButton } from './adminShared'

export function CdnBucketChip({ node }: { node: CdnOwnedNode }): JSX.Element {
  const s = CDN_BUCKET_STYLE[cdnNodeBucket(node)]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function CdnStatsStrip({ stats, columns }: { stats: CdnAdminStats; columns: string }): JSX.Element {
  const items = [
    { label: 'Nodes', value: stats.total_nodes },
    { label: 'Online', value: stats.online_nodes },
    { label: 'Awaiting approval', value: stats.pending_nodes },
    { label: 'Served', value: formatBytes(stats.total_bytes_served) },
    { label: 'Requests', value: stats.total_requests.toLocaleString() },
    {
      label: stats.manifest_version ? `Manifest v${stats.manifest_version}` : 'Manifest',
      value: stats.manifest_version ? `${stats.master_files.toLocaleString()} files · ${formatBytes(stats.master_bytes)}` : 'Not generated',
    },
  ]
  return (
    <div className={`grid ${columns} gap-2`}>
      {items.map((m) => (
        <div key={m.label} className="bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 min-w-0">
          <p className="text-text-primary text-sm font-bold tabular-nums truncate">{m.value}</p>
          <p className="text-text-muted text-[10px] mt-0.5 truncate">{m.label}</p>
        </div>
      ))}
    </div>
  )
}

/** Warnings that change what the admin should do, above the actions. */
export function CdnNodeNotices({ node }: { node: CdnAdminNode }): JSX.Element | null {
  const notes: string[] = []
  if (!node.is_active && wasAutoDisabled(node)) {
    notes.push(`Disabled automatically after listener hash reports (trust ${Math.round(node.trust_score)}, ${node.hash_violations} violation${node.hash_violations === 1 ? '' : 's'}). Restoring also resets both, or the next report disables it again.`)
  } else if (node.hash_violations > 0) {
    notes.push(`${node.hash_violations} of ${VIOLATION_LIMIT} hash violations before the server disables it.`)
  }
  if (!node.is_public) notes.push('Private: the server never routes listeners to private nodes, so it serves nobody even when approved.')
  if (node.is_approved && node.is_active && !node.online) notes.push(`No heartbeat for over 5 minutes (last ${relativeTime(node.last_heartbeat)}).`)
  if (notes.length === 0) return null
  return (
    <div className="space-y-1.5">
      {notes.map((n) => (
        <p key={n} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {n}
        </p>
      ))}
    </div>
  )
}

const TONE = {
  good: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 active:bg-emerald-500/25',
  bad: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 active:bg-red-500/20',
  neutral: 'bg-surface-overlay text-text-secondary hover:bg-surface-raised active:bg-surface-raised border border-[var(--border)]',
} as const

/** Which actions make sense depends on how the node got into its state - an
 *  auto-disabled node needs the combined restore, an admin-disabled one just
 *  needs switching back on. `sizing` carries the per-platform button size. */
export function CdnNodeActions({ node, busy, sizing, onApprove, onRevoke, onSetActive, onResetTrust, onRestore }: {
  node: CdnAdminNode
  busy: boolean
  sizing: string
  onApprove: () => void
  onRevoke: () => void
  onSetActive: (active: boolean) => void
  onResetTrust: () => void
  onRestore: () => void
}): JSX.Element {
  const autoDisabled = !node.is_active && wasAutoDisabled(node)
  const actions: { label: string; tone: keyof typeof TONE; run: () => void }[] = []
  if (autoDisabled) {
    actions.push({ label: 'Restore node', tone: 'good', run: onRestore })
  } else {
    if (!node.is_approved) actions.push({ label: 'Approve', tone: 'good', run: onApprove })
    if (!node.is_active) actions.push({ label: 'Enable', tone: 'good', run: () => onSetActive(true) })
    if (node.is_approved) actions.push({ label: 'Revoke approval', tone: 'bad', run: onRevoke })
    if (node.is_active) actions.push({ label: 'Disable', tone: 'bad', run: () => onSetActive(false) })
    if (node.hash_violations > 0 || node.trust_score < DEFAULT_TRUST_SCORE) {
      actions.push({ label: 'Reset trust', tone: 'neutral', run: onResetTrust })
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) => (
        <button key={a.label} onClick={a.run} disabled={busy}
          className={`${sizing} rounded-lg font-semibold transition-colors disabled:opacity-40 ${TONE[a.tone]}`}>
          {a.label}
        </button>
      ))}
      {busy && <Loader2 size={14} className="animate-spin text-text-muted" />}
    </div>
  )
}

function Fact({ label, value, copy }: { label: string; value: string; copy?: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-0.5">{label}</p>
      <p className="text-xs text-text-primary truncate flex items-center gap-1" title={value}>
        <span className="truncate">{value}</span>
        {copy && <CopyButton text={copy} label={label.toLowerCase()} />}
      </p>
    </div>
  )
}

export function CdnNodeFacts({ node, columns }: { node: CdnAdminNode; columns: string }): JSX.Element {
  const used = node.current_storage_bytes
  const max = node.max_storage_bytes
  const pct = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between text-xs mb-1.5">
          <span className="text-text-muted">Storage</span>
          <span className="text-text-primary tabular-nums">
            {formatBytes(used)}{max > 0 ? ` of ${formatBytes(max)}` : ''} · {node.file_count.toLocaleString()} files
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={`grid ${columns} gap-x-4 gap-y-3`}>
        <Fact label="Upload" value={formatMbps(node.upload_speed_mbps)} />
        <Fact label="Download" value={formatMbps(node.download_speed_mbps)} />
        <Fact label="Served" value={formatBytes(node.total_bytes_served)} />
        <Fact label="Requests" value={node.total_requests.toLocaleString()} />
        <Fact label="Trust" value={String(Math.round(node.trust_score))} />
        <Fact label="Violations" value={String(node.hash_violations)} />
        <Fact label="Owner" value={node.owner_username || 'Unclaimed'} />
        <Fact label="Region" value={node.region || '—'} />
        <Fact label="Address" value={node.ip_address ? (node.port ? `${node.ip_address}:${node.port}` : node.ip_address) : '—'} copy={node.ip_address ?? undefined} />
        <Fact label="Last heartbeat" value={relativeTime(node.last_heartbeat)} />
        <Fact label="Registered" value={shortDate(node.created_at)} />
        <Fact label="Visibility" value={node.is_public ? 'Public' : 'Private'} />
        {node.public_base_url && <Fact label="Base URL" value={node.public_base_url} copy={node.public_base_url} />}
        <Fact label="Node ID" value={node.node_id} copy={node.node_id} />
      </div>
    </div>
  )
}
