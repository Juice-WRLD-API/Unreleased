import { relativeTime } from '../../components/adminShared'
import { deleteMyNode, fetchMyNodes, isNodeOnline, unlinkMyNode, updateMyNodeLocation, type CdnNodeLocationPatch } from '../cdnAccountApi'
import { formatBytes } from '../format'
import { loadLinkPreview } from '../linkPreview'
import { appendPlay } from '../profilePushApi'
import { useStore } from '../../store/useStore'
import { completeSongs, songFromArg } from './player'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand } from './types'

// Small account-side integrations: your CDN nodes, link previews, and pushing
// local profile data to the account.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

async function nodeFrom(arg: string): Promise<{ node_id: string; name: string }> {
  const nodes = await fetchMyNodes()
  const q = arg.trim().toLowerCase()
  if (!q) fail('say which node (nodes)')
  const hits = nodes.filter((n) => n.node_id.toLowerCase().startsWith(q) || n.name.toLowerCase() === q || n.name.toLowerCase().includes(q))
  return hits.length === 1 ? hits[0] : fail(hits.length ? `${hits.length} nodes match "${arg.trim()}" - be more specific` : `no node matches "${arg.trim()}" (nodes)`)
}

export const INTEGRATION_COMMANDS: TermCommand[] = [
  {
    name: 'nodes', group: 'Account', usage: 'nodes [ls] · locate <node> [--city c] [--country cc] [--lat n] [--lon n] · unlink <node> · rm <node>',
    description: 'The CDN nodes linked to your account (the admin roster is `cdn`): where they are, whether they are online and synced; set a location, unlink or delete one',
    covers: ['cdnAccountApi.fetchMyNodes', 'cdnAccountApi.updateMyNodeLocation', 'cdnAccountApi.unlinkMyNode', 'cdnAccountApi.deleteMyNode'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'locate', 'unlink', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      if (!st().account) fail('sign in first (login)')
      const { rest, bool, value } = parseArgs(args, ['city', 'country', 'lat', 'lon'])
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      if (sub === 'ls' || sub === 'list') {
        const nodes = await fetchMyNodes()
        if (asJson(ctx, bool.has('json'), nodes)) return
        ctx.print(nodes.length ? table(nodes.map((n) => [n.name, isNodeOnline(n) ? 'online' : 'offline', n.status ?? '', [n.city, n.country_code].filter(Boolean).join(', '), n.current_storage_bytes !== undefined ? formatBytes(n.current_storage_bytes) : '', n.last_heartbeat ? relativeTime(n.last_heartbeat) : ''])) : 'no nodes linked to your account', nodes.length ? 'plain' : 'dim')
      } else if (sub === 'locate') {
        const n = await nodeFrom(rest.join(' '))
        const patch: CdnNodeLocationPatch = {}
        if (value.has('city')) patch.city = value.get('city')
        if (value.has('country')) patch.country_code = (value.get('country') as string).toUpperCase()
        if (value.has('lat')) patch.latitude = Number(value.get('lat'))
        if (value.has('lon')) patch.longitude = Number(value.get('lon'))
        if (Object.keys(patch).length === 0) fail('give --city, --country, --lat or --lon')
        if ((patch.latitude !== undefined && !Number.isFinite(patch.latitude)) || (patch.longitude !== undefined && !Number.isFinite(patch.longitude))) fail('--lat and --lon must be numbers')
        await updateMyNodeLocation(n.node_id, patch)
        ctx.print(`updated the location of ${n.name}`, 'ok')
      } else if (sub === 'unlink' || sub === 'rm') {
        const n = await nodeFrom(rest.join(' '))
        const text = sub === 'unlink' ? `Unlink ${n.name} from your account? It keeps running, unowned.` : `Delete ${n.name}? Its file list and history go with it.`
        if (!confirmAction(ctx, text, bool.has('y'))) return
        if (sub === 'unlink') await unlinkMyNode(n.node_id)
        else await deleteMyNode(n.node_id)
        ctx.print(`${sub === 'unlink' ? 'unlinked' : 'deleted'} ${n.name}`, 'ok')
      } else fail('usage: nodes [ls | locate | unlink | rm]')
    },
  },
  {
    name: 'unfurl', group: 'Content', usage: 'unfurl <url>', description: 'The link preview (title, description, image) the chat would show for an address',
    covers: ['linkPreview.loadLinkPreview'],
    run: async (args, ctx) => {
      const url = args.trim()
      if (!/^https?:\/\//i.test(url)) fail('usage: unfurl <http(s) url>')
      const p = await loadLinkPreview(url)
      ctx.print(p ? JSON.stringify(p, null, 2) : 'no preview for that address', p ? 'plain' : 'dim')
    },
  },
  {
    name: 'sync', group: 'Account', usage: 'sync · play <song>',
    description: 'sync pushes this device’s song overrides, play history, playlist folders and settings to your account now. `sync play <song>` records one listen on your profile',
    covers: ['profilePushApi.pushProfile', 'profilePushApi.appendPlay'],
    complete: (before, partial) => (before.length === 0 ? ['play'].filter((v) => v.startsWith(partial.toLowerCase())) : before[0] === 'play' ? completeSongs(before.slice(1), partial) : []),
    run: async (args, ctx) => {
      if (!st().account) fail('sign in first (login)')
      const [sub = '', ...more] = args.trim().split(/\s+/).filter(Boolean)
      if (!sub) {
        st()._scheduleProfilePush(['songPrefs', 'listeningPlays', 'folders', 'userSettings'])
        ctx.print('pushing your profile (it goes out in a moment)', 'ok')
      } else if (sub.toLowerCase() === 'play') {
        const song = await songFromArg(more.join(' '))
        await appendPlay({ song: song.id, played_at: new Date().toISOString() })
        ctx.print(`recorded a listen of ${song.name}`, 'ok')
      } else fail('usage: sync [play <song>]')
    },
  },
]
