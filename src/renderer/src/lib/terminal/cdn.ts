import { relativeTime } from '../../components/adminShared'
import { formatBytes } from '../format'
import {
  DEFAULT_TRUST_SCORE, deleteCdnNode, fetchCdnNodes, fetchCdnStats, fetchNodeEvents, updateCdnNode, wasAutoDisabled,
  type CdnAdminNode, type CdnNodeEventType,
} from '../cdnAdminApi'
import { confirmAction, fail, parseArgs, profileLink, type TermCommand, type TermCtx } from './types'

// The Admin page's CDN nodes tab (lib/cdnAdminApi.ts on the site): the roster
// of volunteer nodes, approvals and CDN-wide stats under /cdn/admin/. Nodes
// register anonymously and serve nothing until approved. Disabling keeps a
// node's history; deleting wipes it. Same endpoints and rules as the site.

const ACTIONS = ['approve', 'revoke', 'enable', 'disable', 'reset', 'restore', 'delete'] as const
type Action = typeof ACTIONS[number]

type CdnNode = CdnAdminNode
const autoDisabled = wasAutoDisabled
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const mbps = (v: number | null | undefined): string => (v ? `${Math.round(v * 10) / 10} Mbps` : '—')

function state(n: CdnNode): string {
  if (!n.is_approved) return autoDisabled(n) ? 'auto-disabled' : 'pending'
  if (!n.is_active) return 'disabled'
  return n.online ? 'online' : 'offline'
}

/** A node by node id (or the start of one), or by name. */
function pick(nodes: CdnNode[], arg: string): CdnNode {
  const q = arg.trim().replace(/^#/, '').toLowerCase()
  if (!q) fail('say which node (see: cdn)')
  const exact = nodes.filter((n) => n.node_id.toLowerCase() === q || n.name.toLowerCase() === q)
  const hits = exact.length ? exact : nodes.filter((n) => n.node_id.toLowerCase().startsWith(q) || n.name.toLowerCase().includes(q))
  if (hits.length === 0) fail(`no node matches "${arg.trim()}" (see: cdn)`)
  if (hits.length > 1) fail(`"${arg.trim()}" matches ${hits.length} nodes: ${hits.slice(0, 5).map((n) => n.name || n.node_id.slice(0, 8)).join(', ')}`)
  return hits[0]
}

function describeNode(n: CdnNode, latest?: number): string {
  const pct = n.max_storage_bytes > 0 ? ` of ${formatBytes(n.max_storage_bytes)} (${Math.min(100, Math.round((n.current_storage_bytes / n.max_storage_bytes) * 100))}%)` : ''
  const newest = n.manifest_version ?? latest
  const synced = n.synced_manifest_version === undefined ? ''
    : `\nsynced manifest  ${n.synced_manifest_version == null ? 'never' : `v${n.synced_manifest_version}`}${newest != null ? ` (latest v${newest})` : ''}`
  const notes: string[] = []
  if (!n.is_approved && autoDisabled(n)) notes.push('pulled for hash violations - restore it to reset trust and violations too')
  else if (!n.is_approved) notes.push('waiting for approval - it serves nothing until approved')
  else if (!n.is_active) notes.push('switched off by an admin')
  return [
    `${n.name || n.node_id} · ${state(n)}`,
    `node id          ${n.node_id}`,
    `owner            ${n.owner_username ? (n.owner != null ? profileLink(n.owner, n.owner_username) : n.owner_username) : 'unclaimed'}`,
    `region           ${n.region || '—'} · ${n.is_public ? 'public' : 'private'}`,
    `address          ${n.ip_address ? (n.port ? `${n.ip_address}:${n.port}` : n.ip_address) : '—'}${n.public_base_url ? `  ${n.public_base_url}` : ''}`,
    `storage          ${formatBytes(n.current_storage_bytes)}${pct} · ${n.file_count.toLocaleString()} files`,
    `speed            up ${mbps(n.upload_speed_mbps)} · down ${mbps(n.download_speed_mbps)} · to listeners ${mbps(n.observed_download_speed_mbps)}`,
    `served           ${formatBytes(n.total_bytes_served)} in ${n.total_requests.toLocaleString()} requests`,
    `trust            ${Math.round(n.trust_score)} · ${plural(n.hash_violations, 'violation')}`,
    `heartbeat        ${relativeTime(n.last_heartbeat)} · registered ${new Date(n.created_at).toLocaleDateString()}${synced}`,
    ...notes.map((t) => `! ${t}`),
  ].join('\n')
}

async function act(action: Action, n: CdnNode, ctx: TermCtx, yes: boolean): Promise<void> {
  const name = n.name || n.node_id
  switch (action) {
    case 'approve':
      if (n.is_approved) fail(`${name} is already approved`)
      if (autoDisabled(n)) fail(`${name} was pulled for hash violations - use: cdn restore ${name}`)
      await updateCdnNode(n.node_id, { is_approved: true }); break
    case 'revoke':
      if (!n.is_approved) fail(`${name} isn't approved`)
      await updateCdnNode(n.node_id, { is_approved: false }); break
    case 'enable':
      if (n.is_active) fail(`${name} is already enabled`)
      if (autoDisabled(n)) fail(`${name} was pulled for hash violations - use: cdn restore ${name}`)
      await updateCdnNode(n.node_id, { is_active: true }); break
    case 'disable':
      if (!n.is_active) fail(`${name} is already disabled`)
      await updateCdnNode(n.node_id, { is_active: false }); break
    case 'reset':
      if (n.hash_violations === 0 && n.trust_score >= DEFAULT_TRUST_SCORE) fail(`${name} has nothing to reset`)
      await updateCdnNode(n.node_id, { trust_score: DEFAULT_TRUST_SCORE, hash_violations: 0 }); break
    case 'restore':
      // The site's "Restore node": back on and approved, trust and violations reset.
      await updateCdnNode(n.node_id, { is_approved: true, is_active: true, trust_score: DEFAULT_TRUST_SCORE, hash_violations: 0 }); break
    case 'delete':
      if (!confirmAction(ctx, `Permanently delete ${name}? Its file list, history and API key go with it.`, yes)) return
      await deleteCdnNode(n.node_id)
      ctx.print(`deleted ${name}`, 'ok')
      return
  }
  ctx.print(`${action} ${name}: done`, 'ok')
}

export const CDN_COMMANDS: TermCommand[] = [
  {
    name: 'cdn', group: 'Admin',
    covers: ['cdnAdminApi.fetchNodeEvents'],
    usage: 'cdn events <node> [--page N] [--type registered,violation]  ·  cdn [<node>]  ·  cdn approve|revoke|enable|disable|reset|restore|delete <node> [-y]',
    description: 'The CDN node roster and stats; one node in full; or approve, revoke, enable, disable, reset trust, restore or delete a node (a node is its id, the start of it, or its name)',
    complete: (before, partial) => (before.length === 0 ? ['events', ...ACTIONS].filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const parsed = parseArgs(args, ['page', 'type'])
      if (parsed.rest[0]?.toLowerCase() === 'events') {
        const nodeArg = parsed.rest.slice(1).join(' ')
        if (!nodeArg) fail('usage: cdn events <node> [--page N] [--type registered,violation]')
        const page = Number(parsed.value.get('page') ?? 1)
        if (!Number.isInteger(page) || page < 1) fail('--page must be a positive integer')
        const types = parsed.value.get('type')?.split(',').map(t => t.trim()).filter(Boolean) as CdnNodeEventType[] | undefined
        const node = pick(await fetchCdnNodes(), nodeArg)
        const result = await fetchNodeEvents(node.node_id, page, types)
        const rows = result.events.map(event => [event.created_at, event.event_type,
          event.actor_username ?? 'system', event.actor_ip ?? '', JSON.stringify(event.detail)].filter(Boolean).join(' · '))
        ctx.print([
          node.name || node.node_id,
          result.count + ' events · page ' + result.page + (result.has_next ? ' · more available (--page ' + (result.page + 1) + ')' : ''),
          ...(rows.length ? rows : ['no events recorded']),
        ].join('\n'))
        return
      }
      const words = args.trim().split(/\s+/).filter((w) => w && w.toLowerCase() !== '-y')
      const first = words[0]?.toLowerCase()
      if (first && (ACTIONS as readonly string[]).includes(first)) {
        words.shift()
        const nodes = await fetchCdnNodes()
        await act(first as Action, pick(nodes, words.join(' ')), ctx, parsed.bool.has('y'))
        return
      }
      const [stats, nodes] = await Promise.all([fetchCdnStats(), fetchCdnNodes()])
      if (words.length) { ctx.print(describeNode(pick(nodes, words.join(' ')), stats.manifest_version)); return }
      const lines = [
        `${plural(stats.total_nodes, 'node')} · ${stats.online_nodes} online · ${stats.pending_nodes} awaiting approval · ${formatBytes(stats.total_bytes_served)} served in ${stats.total_requests.toLocaleString()} requests`,
        `master copy: ${stats.master_files.toLocaleString()} files, ${formatBytes(stats.master_bytes)} · manifest v${stats.manifest_version}`,
      ]
      if (nodes.length === 0) { ctx.print([...lines, '', 'no nodes registered'].join('\n')); return }
      const order = ['pending', 'auto-disabled', 'online', 'offline', 'disabled']
      const sorted = [...nodes].sort((a, b) => order.indexOf(state(a)) - order.indexOf(state(b)) || (a.name || a.node_id).localeCompare(b.name || b.node_id))
      const rows = sorted.map((n) => {
        const s = state(n)
        return `${(n.name || n.node_id.slice(0, 8)).slice(0, 24).padEnd(26)}${s.padEnd(15)}${(n.owner_username || 'unclaimed').slice(0, 16).padEnd(18)}${formatBytes(n.current_storage_bytes).padEnd(11)}${formatBytes(n.total_bytes_served).padEnd(11)}trust ${String(Math.round(n.trust_score)).padEnd(5)}${relativeTime(n.last_heartbeat)}`
      })
      ctx.print([...lines, '', ...rows].join('\n'))
    },
  },
]
