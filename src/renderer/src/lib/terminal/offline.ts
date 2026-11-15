import { useStore } from '../../store/useStore'
import { useOfflineStore, type OfflinePlaylistState } from '../../store/useOfflineStore'
import {
  downloadPlaylist, offlineBytes, offlineNeedsInstall, offlineSupported, refreshOfflineUsage, removeAllOffline, removeOfflinePlaylist, syncOfflinePlaylists,
} from '../offlineDownloads'
import { formatBytes } from '../format'
import { confirmAction, fail, type TermCommand } from './types'

// The terminal side of offline playlist downloads (Playlists → ⋯ → Download,
// and Settings → Playback → Downloads). Same functions the screens call.

const SUBCOMMANDS = ['list', 'add', 'remove', 'sync', 'usage', 'clear'] as const

function status(p: OfflinePlaylistState): string {
  switch (p.status) {
    case 'queued': return p.done ? `paused at ${p.done}/${p.total}` : 'waiting'
    case 'downloading': return `downloading ${p.done}/${p.total}`
    case 'done': return `${p.done}/${p.total}${p.skipped ? ` (${p.skipped} can't be downloaded)` : ''}`
    case 'partial': return `${p.done}/${p.total}${p.failed ? `, ${p.failed} failed` : ''}`
    case 'error': return p.error ?? 'failed'
  }
}

/** One of your synced playlists, by id or (part of) its name. */
function pickPlaylist(arg: string): { id: number; name: string } {
  const q = arg.trim().replace(/^#/, '').toLowerCase()
  if (!q) fail('say which playlist (see: playlist)')
  const all = useStore.getState().playlists
  const byId = /^\d+$/.test(q) ? all.find((p) => p.id === Number(q)) : undefined
  if (byId) return byId
  const exact = all.filter((p) => p.name.toLowerCase() === q)
  const hits = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(q))
  if (hits.length === 0) fail(`no playlist matches "${arg.trim()}"`)
  if (hits.length > 1) fail(`"${arg.trim()}" matches ${hits.length} playlists: ${hits.slice(0, 5).map((p) => p.name).join(', ')}`)
  return hits[0]
}

export const OFFLINE_COMMANDS: TermCommand[] = [
  {
    name: 'offline', aliases: ['downloads'], group: 'Library',
    covers: [
      'offlineDownloads.downloadPlaylist', 'offlineDownloads.removeOfflinePlaylist', 'offlineDownloads.removeAllOffline',
      'offlineDownloads.syncOfflinePlaylists', 'offlineDownloads.offlineBytes',
    ],
    usage: 'offline [list]  ·  offline add|remove <playlist>  ·  offline sync  ·  offline usage  ·  offline clear [-y]',
    description: 'Playlists downloaded to play with no connection (installed iOS app): list them, download or remove one, bring them up to date, see the space used, or remove them all',
    complete: (before, partial) => {
      if (before.length === 0) return SUBCOMMANDS.filter((s) => s.startsWith(partial.toLowerCase()))
      if (before[0] === 'add' || before[0] === 'remove') {
        return useStore.getState().playlists.map((p) => p.name).filter((n) => n.toLowerCase().startsWith(partial.toLowerCase()))
      }
      return []
    },
    run: async (args, ctx) => {
      if (!offlineSupported()) {
        fail(offlineNeedsInstall()
          ? 'offline downloads need the installed app - add this site to your Home Screen first'
          : 'offline downloads are only in the installed iPhone/iPad app')
      }
      const words = args.trim().split(/\s+/).filter(Boolean)
      const sub = (words.shift() ?? 'list').toLowerCase()
      const rest = words.filter((w) => w !== '-y').join(' ')
      switch (sub) {
        case 'list': {
          const list = Object.values(useOfflineStore.getState().playlists).sort((a, b) => a.name.localeCompare(b.name))
          if (!list.length) { ctx.print('nothing downloaded - try: offline add <playlist>', 'dim'); return }
          ctx.print(list.map((p) => `${p.name.slice(0, 30).padEnd(32)}${status(p)}`).join('\n'))
          return
        }
        case 'add': {
          if (!useStore.getState().account) fail('sign in first')
          const p = pickPlaylist(rest)
          await downloadPlaylist(p.id, p.name)
          ctx.print(`downloading ${p.name} - see: offline list`, 'ok')
          return
        }
        case 'remove': {
          const p = pickPlaylist(rest)
          if (!useOfflineStore.getState().playlists[p.id]) fail(`${p.name} isn't downloaded`)
          await removeOfflinePlaylist(p.id)
          ctx.print(`removed the download of ${p.name}`, 'ok')
          return
        }
        case 'sync':
          syncOfflinePlaylists()
          ctx.print('checking every download for new and removed songs', 'ok')
          return
        case 'usage': {
          await refreshOfflineUsage()
          const bytes = await offlineBytes()
          const { usage, trackIds } = useOfflineStore.getState()
          ctx.print([
            `${formatBytes(bytes)} in ${trackIds.size} ${trackIds.size === 1 ? 'song' : 'songs'}`,
            ...(usage && usage.quota > 0 ? [`${formatBytes(usage.used)} used by this app of ${formatBytes(usage.quota)} allowed`] : []),
          ].join('\n'))
          return
        }
        case 'clear':
          if (!confirmAction(ctx, 'Remove every downloaded playlist from this device?', words.includes('-y'))) return
          await removeAllOffline()
          ctx.print('removed all downloads', 'ok')
          return
        default:
          fail(`unknown: offline ${sub} (try: ${SUBCOMMANDS.join(', ')})`)
      }
    },
  },
]
