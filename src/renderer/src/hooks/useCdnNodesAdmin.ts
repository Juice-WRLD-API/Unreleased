// Shared data/logic for the CDN nodes admin tab. Desktop and mobile wrap this
// hook in their own layouts - keep behavior here, JSX in them.
import { useCallback, useMemo, useState } from 'react'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'
import * as cdnAdminApi from '../lib/cdnAdminApi'
import type { CdnAdminNode, CdnAdminStats, CdnNodePatch } from '../lib/cdnAdminApi'
import { DEFAULT_TRUST_SCORE } from '../lib/cdnAdminApi'
import { isNodeOnline, type CdnOwnedNode } from '../lib/cdnAccountApi'
import { buildHaystack, matchesHaystack } from '../components/adminShared'
import { errorMessage } from '../lib/format'

export type CdnNodeFilter = 'all' | 'pending' | 'online' | 'offline' | 'disabled'

/** One bucket per node, so the filter counts add up to the total. A node the
 *  server auto-disabled lands in "disabled", not "pending", even though the
 *  server's own pending_nodes stat counts it (it only checks is_approved).
 *  Takes the owner-side shape too (Settings > My CDN nodes), whose flags may
 *  be missing - `status` stands in for them then. */
export function cdnNodeBucket(n: CdnOwnedNode): Exclude<CdnNodeFilter, 'all'> {
  if (n.is_active === false || n.status === 'disabled') return 'disabled'
  if (n.is_approved === false || (n.is_approved === undefined && n.status === 'pending')) return 'pending'
  return isNodeOnline(n) ? 'online' : 'offline'
}

export const CDN_BUCKET_STYLE: Record<Exclude<CdnNodeFilter, 'all'>, { label: string; text: string; bg: string; dot: string }> = {
  pending:  { label: 'pending',  text: 'text-amber-400',   bg: 'bg-amber-500/10',   dot: 'bg-amber-400' },
  online:   { label: 'online',   text: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' },
  offline:  { label: 'offline',  text: 'text-zinc-400',    bg: 'bg-zinc-500/10',    dot: 'bg-zinc-500' },
  disabled: { label: 'disabled', text: 'text-red-400',     bg: 'bg-red-500/10',     dot: 'bg-red-400' },
}

export function formatMbps(v: number): string {
  if (!v) return '—'
  return v >= 100 ? `${Math.round(v)} Mbps` : `${v.toFixed(1)} Mbps`
}

export function useCdnNodesAdmin(): {
  nodes: CdnAdminNode[]
  stats: CdnAdminStats | null
  loading: boolean
  error: string | null
  reload: () => void
  filter: CdnNodeFilter
  setFilter: (f: CdnNodeFilter) => void
  filters: { id: CdnNodeFilter; label: string; count: number }[]
  search: string
  setSearch: (v: string) => void
  visible: CdnAdminNode[]
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  selected: CdnAdminNode | null
  busyId: string | null
  actionError: string | null
  approve: (n: CdnAdminNode) => Promise<void>
  revoke: (n: CdnAdminNode) => Promise<void>
  setActive: (n: CdnAdminNode, active: boolean) => Promise<void>
  resetTrust: (n: CdnAdminNode) => Promise<void>
  restore: (n: CdnAdminNode) => Promise<void>
  remove: (n: CdnAdminNode) => Promise<void>
} {
  const [nodes, setNodes] = useState<CdnAdminNode[]>([])
  const [stats, setStats] = useState<CdnAdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Pending first: approving new registrations is the main reason to be here.
  const [filter, setFilter] = useState<CdnNodeFilter>('pending')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([cdnAdminApi.fetchCdnNodes(), cdnAdminApi.fetchCdnStats()])
      .then(([list, s]) => {
        setNodes(list)
        setStats(s)
        // Land on "all" rather than an empty pending list once nothing's waiting.
        setFilter((f) => (f === 'pending' && !list.some((n) => cdnNodeBucket(n) === 'pending') ? 'all' : f))
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load CDN nodes')))
      .finally(() => setLoading(false))
  }, [])

  useStrictModeSafeEffect(() => { reload() }, [reload])

  const haystacks = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of nodes) m.set(n.node_id, buildHaystack(n.name, n.node_id, n.region, n.owner_username, n.ip_address))
    return m
  }, [nodes])

  const filters = useMemo(() => {
    const count = (b: CdnNodeFilter): number => b === 'all' ? nodes.length : nodes.filter((n) => cdnNodeBucket(n) === b).length
    return (['pending', 'online', 'offline', 'disabled', 'all'] as const).map((id) => ({
      id, label: id === 'all' ? 'All' : CDN_BUCKET_STYLE[id].label[0].toUpperCase() + CDN_BUCKET_STYLE[id].label.slice(1), count: count(id),
    }))
  }, [nodes])

  const visible = useMemo(
    () => nodes.filter((n) => (filter === 'all' || cdnNodeBucket(n) === filter) && matchesHaystack(search, haystacks.get(n.node_id))),
    [nodes, filter, search, haystacks],
  )

  const selected = nodes.find((n) => n.node_id === selectedId) ?? null

  const patch = useCallback(async (n: CdnAdminNode, body: CdnNodePatch) => {
    setBusyId(n.node_id)
    setActionError(null)
    try {
      const updated = await cdnAdminApi.updateCdnNode(n.node_id, body)
      setNodes((prev) => prev.map((x) => x.node_id === updated.node_id ? updated : x))
      // Counts in the stats strip depend on approval/active state - refetch
      // just those rather than the whole roster.
      cdnAdminApi.fetchCdnStats().then(setStats).catch(() => {})
    } catch (e) {
      setActionError(errorMessage(e, 'Could not update the node'))
    } finally {
      setBusyId(null)
    }
  }, [])

  const approve = useCallback((n: CdnAdminNode) => patch(n, { is_approved: true }), [patch])

  const revoke = useCallback(async (n: CdnAdminNode) => {
    if (!confirm(`Revoke approval for "${n.name}"? It stops receiving listeners until approved again.`)) return
    await patch(n, { is_approved: false })
  }, [patch])

  const setActive = useCallback(async (n: CdnAdminNode, active: boolean) => {
    if (!active && !confirm(`Disable "${n.name}"? The node is told to deactivate and its API key stops working until re-enabled.`)) return
    await patch(n, { is_active: active })
  }, [patch])

  const resetTrust = useCallback(
    (n: CdnAdminNode) => patch(n, { trust_score: DEFAULT_TRUST_SCORE, hash_violations: 0 }),
    [patch],
  )

  // Both halves at once - see wasAutoDisabled for why flipping only the
  // flags back would just get the node disabled again on the next report.
  const restore = useCallback(
    (n: CdnAdminNode) => patch(n, { is_approved: true, is_active: true, trust_score: DEFAULT_TRUST_SCORE, hash_violations: 0 }),
    [patch],
  )

  const remove = useCallback(async (n: CdnAdminNode) => {
    if (!confirm(`Permanently delete "${n.name}"? Its file list, speed samples, violations and download logs are wiped and its API key stops working. Disable it instead to keep the history.`)) return
    setBusyId(n.node_id)
    setActionError(null)
    try {
      await cdnAdminApi.deleteCdnNode(n.node_id)
      setNodes((prev) => prev.filter((x) => x.node_id !== n.node_id))
      setSelectedId((id) => (id === n.node_id ? null : id))
      cdnAdminApi.fetchCdnStats().then(setStats).catch(() => {})
    } catch (e) {
      setActionError(errorMessage(e, 'Could not delete the node'))
    } finally {
      setBusyId(null)
    }
  }, [])

  return {
    nodes, stats, loading, error, reload,
    filter, setFilter, filters, search, setSearch, visible,
    selectedId, setSelectedId, selected,
    busyId, actionError,
    approve, revoke, setActive, resetTrust, restore, remove,
  }
}
