// Presentational pieces shared by the CDN nodes admin tab and the donor's own
// "My CDN nodes" panel - the parts that read the same in both places.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDown, Ban, Check, ChevronDown, ChevronRight, Loader2, Minus, Rss, Shield, ShieldAlert, ShieldCheck, ShieldOff, Trash2, UserPlus, Wrench, Undo2 } from 'lucide-react'
import type { CdnAdminNode, CdnAdminStats, CdnNodeEvent, CdnNodeEventType } from '../lib/cdnAdminApi'
import { wasAutoDisabled, VIOLATION_LIMIT, DEFAULT_TRUST_SCORE, fetchNodeEvents } from '../lib/cdnAdminApi'
import { nodeSyncState, type CdnOwnedNode } from '../lib/cdnAccountApi'
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

const SYNC_STYLE = {
  current: { badge: 'bg-emerald-500', Icon: Check },
  behind: { badge: 'bg-amber-500', Icon: ArrowDown },
  never: { badge: 'bg-zinc-500', Icon: Minus },
} as const

function syncTitle(n: CdnOwnedNode, latest: number): string {
  const state = nodeSyncState(n, latest)
  if (state === 'current') return `Up to date with the latest library changes (manifest v${latest})`
  if (state === 'behind') return `Behind: synced v${n.synced_manifest_version}, latest is v${latest}. The node catches up on its next sync.`
  return `Hasn't finished a sync yet (latest is v${latest})`
}

/** Whether the node has synced the newest master manifest, i.e. picked up
 *  every approved proposal that changed the library. Renders nothing until
 *  the server reports the node's synced version. Clicking re-fetches. */
export function CdnSyncBadge({ node, latest = node.manifest_version, onRefresh, busy }: {
  node: CdnOwnedNode
  latest?: number
  onRefresh?: () => void
  busy?: boolean
}): JSX.Element | null {
  const state = nodeSyncState(node, latest)
  if (!state || !latest) return null
  const { badge, Icon } = SYNC_STYLE[state]
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={!onRefresh || busy}
      title={syncTitle(node, latest)}
      aria-label={syncTitle(node, latest)}
      className="relative w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary disabled:hover:bg-transparent disabled:cursor-default"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Rss size={15} />}
      <span className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full flex items-center justify-center ring-2 ring-[var(--surface)] ${badge}`}>
        <Icon size={8} strokeWidth={3.5} className="text-white" />
      </span>
    </button>
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
export function CdnNodeActions({ node, busy, sizing, onApprove, onRevoke, onSetActive, onResetTrust, onRestore, onDelete }: {
  node: CdnAdminNode
  busy: boolean
  sizing: string
  onApprove: () => void
  onRevoke: () => void
  onSetActive: (active: boolean) => void
  onResetTrust: () => void
  onRestore: () => void
  onDelete: () => void
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
  actions.push({ label: 'Delete', tone: 'bad', run: onDelete })
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

export function nodeLocation(n: Pick<CdnOwnedNode, 'city' | 'country_code' | 'latitude' | 'longitude'>): string {
  const place = [n.city, n.country_code].filter(Boolean).join(', ')
  if (place) return place
  return n.latitude != null && n.longitude != null ? `${n.latitude.toFixed(2)}, ${n.longitude.toFixed(2)}` : '—'
}

export function countryFlag(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return ''
  const [a, b] = code.toUpperCase()
  return String.fromCodePoint(0x1f1e6 + a.charCodeAt(0) - 65, 0x1f1e6 + b.charCodeAt(0) - 65)
}

function flagSvgUrl(code: string): string | null {
  if (!/^[a-z]{2}$/i.test(code)) return null
  const [a, b] = code.toUpperCase()
  const cp1 = (0x1f1e6 + a.charCodeAt(0) - 65).toString(16)
  const cp2 = (0x1f1e6 + b.charCodeAt(0) - 65).toString(16)
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp1}-${cp2}.svg`
}

export function FlagIcon({ code, size = 18 }: { code: string; size?: number }): JSX.Element {
  const url = flagSvgUrl(code)
  if (!url) return <span style={{ fontSize: size }}>🌐</span>
  return (
    <img
      src={url}
      alt={code}
      width={size}
      height={size}
      className="inline-block shrink-0"
      style={{ verticalAlign: 'middle' }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

let regionNames: Intl.DisplayNames | null | undefined
function countryName(code: string): string {
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(undefined, { type: 'region' }) } catch { regionNames = null }
  }
  try { return regionNames?.of(code.toUpperCase()) ?? code } catch { return code }
}

/** Where the network is: nodes per country, biggest first, with how many of
 *  them are up. Nodes that never reported a country are left out. */
export function CdnCountryChips({ nodes, limit = 10 }: { nodes: CdnOwnedNode[]; limit?: number }): JSX.Element | null {
  const rows = useMemo(() => {
    const m = new Map<string, { total: number; online: number }>()
    for (const n of nodes) {
      const code = (n.country_code ?? '').trim().toUpperCase()
      if (!code) continue
      const r = m.get(code) ?? { total: 0, online: 0 }
      r.total++
      if (cdnNodeBucket(n) === 'online') r.online++
      m.set(code, r)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
  }, [nodes])
  if (rows.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mr-1">{rows.length} {rows.length === 1 ? 'country' : 'countries'}</span>
      {rows.slice(0, limit).map(([code, r]) => (
        <span key={code} title={`${countryName(code)}: ${r.total} node${r.total === 1 ? '' : 's'}, ${r.online} online`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-overlay border border-[var(--border)] text-[11px] text-text-secondary">
          <span>{countryFlag(code) || '🌐'}</span>
          <span className="font-medium text-text-primary">{code}</span>
          <span className="tabular-nums text-text-muted">{r.total}</span>
        </span>
      ))}
      {rows.length > limit && <span className="text-[11px] text-text-muted">+{rows.length - limit} more</span>}
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
        <Fact label="To listeners" value={node.observed_download_speed_mbps ? formatMbps(node.observed_download_speed_mbps) : '—'} />
        <Fact label="Served" value={formatBytes(node.total_bytes_served)} />
        <Fact label="Requests" value={node.total_requests.toLocaleString()} />
        <Fact label="Trust" value={String(Math.round(node.trust_score))} />
        <Fact label="Violations" value={String(node.hash_violations)} />
        <Fact label="Owner" value={node.owner_username || 'Unclaimed'} copy={node.owner_username || undefined} />
        <Fact label="Region" value={node.region || '—'} />
        <Fact label="Location" value={nodeLocation(node)} />
        <Fact label="Tunnel" value={node.tunnel_hostname ? `${node.tunnel_hostname}${node.serve_ready ? '' : ' (not ready)'}` : '—'} copy={node.tunnel_hostname || undefined} />
        <Fact label="Address" value={node.ip_address ? (node.port ? `${node.ip_address}:${node.port}` : node.ip_address) : '—'} copy={node.ip_address ?? undefined} />
        <Fact label="Last heartbeat" value={relativeTime(node.last_heartbeat)} />
        <Fact label="Registered" value={shortDate(node.created_at)} />
        <Fact label="Visibility" value={node.is_public ? 'Public' : 'Private'} />
        {node.synced_manifest_version !== undefined && (
          <Fact label="Synced manifest" value={node.synced_manifest_version == null ? 'Never' : `v${node.synced_manifest_version}`} />
        )}
        {node.public_base_url && <Fact label="Base URL" value={node.public_base_url} copy={node.public_base_url} />}
        <Fact label="Node ID" value={node.node_id} copy={node.node_id} />
      </div>
    </div>
  )
}


const EVENT_META: Record<CdnNodeEventType, { label: string; Icon: typeof Shield; tone: 'green' | 'red' | 'neutral' }> = {
  registered:       { label: 'Registered',      Icon: UserPlus,    tone: 'neutral' },
  approved:         { label: 'Approved',         Icon: ShieldCheck, tone: 'green' },
  revoked:          { label: 'Revoked',          Icon: ShieldOff,   tone: 'red' },
  enabled:          { label: 'Enabled',          Icon: Check,       tone: 'green' },
  disabled:         { label: 'Disabled',         Icon: Ban,         tone: 'red' },
  trust_reset:      { label: 'Trust Reset',      Icon: Shield,      tone: 'green' },
  violation:        { label: 'Hash Violation',   Icon: ShieldAlert, tone: 'red' },
  auto_disabled:    { label: 'Auto-Disabled',    Icon: ShieldOff,   tone: 'red' },
  deleted:          { label: 'Deleted',          Icon: Trash2,      tone: 'red' },
  restored:         { label: 'Restored',         Icon: Undo2,       tone: 'green' },
  settings_changed: { label: 'Settings Changed', Icon: Wrench,      tone: 'neutral' },
}

const TONE_CLASSES = {
  green:   { dot: 'bg-emerald-400', icon: 'text-emerald-400', line: 'bg-emerald-500/20' },
  red:     { dot: 'bg-red-400',     icon: 'text-red-400',     line: 'bg-red-500/20' },
  neutral: { dot: 'bg-zinc-500',    icon: 'text-zinc-400',    line: 'bg-zinc-500/20' },
} as const

function EventDetailRow({ label, before, after }: { label: string; before: unknown; after: unknown }): JSX.Element {
  const fmt = (v: unknown): string => (v == null ? '—' : String(v))
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="text-text-muted font-medium w-28 shrink-0 truncate">{label}</span>
      <span className="text-red-400 line-through">{fmt(before)}</span>
      <span className="text-text-muted">→</span>
      <span className="text-emerald-400">{fmt(after)}</span>
    </div>
  )
}

function EventDetailBlock({ detail, eventType }: { detail: Record<string, unknown>; eventType: CdnNodeEventType }): JSX.Element | null {
  if (!detail || Object.keys(detail).length === 0) return null
  const diffKeys = Object.keys(detail).filter((k) => {
    const v = detail[k]
    return v != null && typeof v === 'object' && 'before' in (v as Record<string, unknown>) && 'after' in (v as Record<string, unknown>)
  })
  const plainKeys = Object.keys(detail).filter((k) => !diffKeys.includes(k))
  return (
    <div className="mt-1.5 space-y-0.5">
      {diffKeys.map((k) => {
        const d = detail[k] as { before: unknown; after: unknown }
        return <EventDetailRow key={k} label={k} before={d.before} after={d.after} />
      })}
      {plainKeys.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          {plainKeys.map((k) => (
            <span key={k}><span className="font-medium">{k}:</span> {String(detail[k])}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function EventRow({ event }: { event: CdnNodeEvent }): JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = EVENT_META[event.event_type] ?? EVENT_META.settings_changed
  const tone = TONE_CLASSES[meta.tone]
  const hasDetail = event.detail && Object.keys(event.detail).length > 0
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${tone.line}`}>
          <meta.Icon size={12} className={tone.icon} />
        </div>
        <div className={`flex-1 w-px mt-1 ${tone.line}`} />
      </div>
      <div className="flex-1 min-w-0 -mt-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">{meta.label}</span>
          {hasDetail && (
            <button onClick={() => setOpen(!open)} className="text-text-muted hover:text-text-primary transition-colors">
              <Chevron size={12} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[10px] text-text-muted mt-0.5">
          <span>{relativeTime(event.created_at)}</span>
          {event.actor_username && <span>by {event.actor_username}</span>}
          {event.actor_ip && <span>{event.actor_ip}</span>}
        </div>
        {open && hasDetail && <EventDetailBlock detail={event.detail} eventType={event.event_type} />}
      </div>
    </div>
  )
}

const ALL_EVENT_TYPES: CdnNodeEventType[] = [
  'registered', 'approved', 'revoked', 'enabled', 'disabled',
  'trust_reset', 'violation', 'auto_disabled', 'deleted', 'restored', 'settings_changed',
]

export function CdnNodeEventHistory({ nodeId }: { nodeId: string }): JSX.Element {
  const [events, setEvents] = useState<CdnNodeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [total, setTotal] = useState(0)
  const [activeFilters, setActiveFilters] = useState<CdnNodeEventType[]>([])

  const load = useCallback((p: number, filters: CdnNodeEventType[], append: boolean) => {
    setLoading(true)
    setError(null)
    fetchNodeEvents(nodeId, p, filters.length ? filters : undefined)
      .then((res) => {
        setEvents((prev) => append ? [...prev, ...res.events] : res.events)
        setHasNext(res.has_next)
        setTotal(res.count)
        setPage(p)
      })
      .catch(() => setError('Failed to load events'))
      .finally(() => setLoading(false))
  }, [nodeId])

  useEffect(() => { load(1, activeFilters, false) }, [load, nodeId])

  const toggleFilter = useCallback((t: CdnNodeEventType) => {
    setActiveFilters((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
      load(1, next, false)
      return next
    })
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Event History</h3>
        {total > 0 && <span className="text-[10px] text-text-muted tabular-nums">{total} event{total === 1 ? '' : 's'}</span>}
      </div>

      <div className="flex flex-wrap gap-1">
        {ALL_EVENT_TYPES.map((t) => {
          const meta = EVENT_META[t]
          const active = activeFilters.includes(t)
          return (
            <button key={t} onClick={() => toggleFilter(t)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
              }`}>
              {meta.label}
            </button>
          )
        })}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {error}</p>
      )}

      {!loading && events.length === 0 && (
        <p className="text-xs text-text-muted py-4 text-center">No events recorded</p>
      )}

      <div className="pl-1">
        {events.map((e) => <EventRow key={e.id} event={e} />)}
      </div>

      {hasNext && (
        <button onClick={() => load(page + 1, activeFilters, true)} disabled={loading}
          className="w-full text-center text-xs text-accent hover:text-accent/80 py-2 disabled:opacity-40">
          {loading ? <Loader2 size={14} className="inline animate-spin" /> : 'Load more'}
        </button>
      )}

      {loading && events.length === 0 && (
        <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-text-muted" /></div>
      )}
    </div>
  )
}
