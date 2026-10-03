import { useChatStore, conversationTitle } from '../../store/chatStore'
import { useStore, type SettingsTab } from '../../store/useStore'
import type { AdminTab } from '../../hooks/useAdminQueue'
import type { ViewType } from '../../types'
import { APP_VERSION } from '../appVersion'
import { cancelZipTask, isZipTaskId } from '../clientZip'
import { formatBytes } from '../format'
import { fail, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

// What `open <name>` can reach. The terminal is a page of its own, so going
// anywhere else leaves it (its scrollback and position are kept for when you
// come back); the overlays - queue, equalizer, diagnostics - open on top of it.
const VIEWS: Record<string, ViewType> = {
  home: 'home', tracker: 'api-tracker', songs: 'api-tracker', files: 'api-files', playlists: 'playlists', liked: 'liked',
  chat: 'chat', news: 'news', docs: 'docs', wrld: 'wrld', stats: 'stats', statistics: 'statistics', download: 'download',
  heardle: 'heardle', wordle: 'wordle', tierlist: 'tierlist', thanks: 'thanks', editor: 'editor', contributor: 'contributor',
  albums: 'albums-admin',
}
const SETTINGS_TABS: SettingsTab[] = ['account', 'appearance', 'preferences', 'playback', 'shortcuts', 'app', 'developer', 'feedback', 'about']
const ADMIN_TABS: AdminTab[] = ['proposals', 'comp-proposals', 'applications', 'reports', 'users', 'stats', 'security', 'channels', 'eras', 'cdn-nodes']
const OPEN_TARGETS = [...Object.keys(VIEWS), 'settings', 'profile', 'admin', 'queue', 'eq', 'diagnostics', 'user', 'song']

export const APP_COMMANDS: TermCommand[] = [
  {
    name: 'open', aliases: ['go', 'goto'], group: 'Navigation',
    usage: 'open <page> · open settings [tab] · open admin [tab] · open user <id> · open song <title> · open queue|eq|diagnostics',
    description: 'Go to any page, as if you had clicked it. The terminal keeps its place for when you return (Ctrl+` or the Terminal button)',
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return OPEN_TARGETS.filter((t) => t.startsWith(p))
      if (before.length === 1 && before[0].toLowerCase() === 'settings') return SETTINGS_TABS.filter((t) => t.startsWith(p))
      if (before.length === 1 && before[0].toLowerCase() === 'admin') return ADMIN_TABS.filter((t) => t.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const [target = '', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      const key = target.toLowerCase()
      if (!key) fail(`usage: open <${Object.keys(VIEWS).join('|')}|settings|admin|profile|queue|eq|diagnostics>`)
      const s = st()
      if (key === 'settings') {
        const tab = rest ? SETTINGS_TABS.find((t) => t.startsWith(rest.toLowerCase())) ?? fail(`settings tabs: ${SETTINGS_TABS.join(', ')}`) : undefined
        s.openSettings(tab)
        return
      }
      if (key === 'admin') {
        const tab = rest ? ADMIN_TABS.find((t) => t.startsWith(rest.toLowerCase())) ?? fail(`admin tabs: ${ADMIN_TABS.join(', ')}`) : null
        s.setActiveAdminTab(tab)
        s.setActiveView('admin')
        return
      }
      if (key === 'profile') { s.openProfile(); return }
      if (key === 'queue') { s.setShowQueue(true); ctx.print('queue panel opened', 'ok'); return }
      if (key === 'eq') { s.setShowEqPanel(true); ctx.print('equalizer opened', 'ok'); return }
      if (key === 'diagnostics' || key === 'diag') { s.setShowDiagnostics(true); ctx.print('diagnostics opened', 'ok'); return }
      if (key === 'user') {
        if (!/^\d+$/.test(rest)) fail('usage: open user <numeric id>')
        s.openPublicProfile(Number(rest))
        return
      }
      if (key === 'song') {
        if (!rest) fail('usage: open song <title>')
        const { resolveTitleToSong } = await import('../juicewrldApi')
        const song = (await resolveTitleToSong(rest)) ?? fail(`no song found for "${rest}"`)
        s.setInfoSongId(song.id)
        ctx.print(`showing ${song.name}`, 'ok')
        return
      }
      const view = VIEWS[key] ?? VIEWS[pickByName(Object.keys(VIEWS), (k) => k, key) ?? ''] ?? fail(`no page "${target}" (try: open home)`)
      s.setActiveView(view)
    },
  },
  {
    name: 'uploads', aliases: ['transfers'], group: 'App', usage: 'uploads [clear | cancel N]', description: 'Show uploads and ZIP downloads in progress; clear the finished ones or cancel a ZIP',
    complete: (before, partial) => (before.length === 0 ? ['clear', 'cancel'].filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const [sub = '', n = ''] = args.trim().split(/\s+/)
      const s = st()
      if (sub === 'clear') { s.clearCompletedUploads(); ctx.print('cleared finished transfers', 'ok'); return }
      if (sub === 'cancel') {
        const item = s.uploads[Number(n) - 1] ?? fail(`cancel which? 1-${s.uploads.length}`)
        if (!isZipTaskId(item.id)) fail('only ZIP downloads can be cancelled from here')
        cancelZipTask(item.id)
        ctx.print(`cancelling ${item.filename}`, 'ok')
        return
      }
      if (s.uploads.length === 0) { ctx.print('no transfers', 'dim'); return }
      ctx.print(s.uploads.map((u, i) => {
        const size = u.total ? `${formatBytes(u.bytesReceived ?? u.received ?? 0)} / ${formatBytes(u.total)}` : u.bytesReceived ? formatBytes(u.bytesReceived) : ''
        return `${String(i + 1).padStart(3)}  ${u.state.padEnd(11)}${String(u.percent).padStart(3)}%  ${u.filename}${u.detail ? `  ${u.detail}` : ''}${size ? `  ${size}` : ''}${u.error && u.state === 'error' ? `  (${u.error})` : ''}`
      }).join('\n'))
    },
  },
  {
    name: 'channel', group: 'App', usage: 'channel [slug]', description: 'List the Files tab channels, or switch the active one',
    complete: (before, partial) => (before.length === 0 ? st().channels.map((c) => c.slug).filter((c) => c.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      if (st().channels.length === 0) await st().loadChannels()
      const channels = st().channels
      const arg = args.trim()
      if (!arg) {
        ctx.print(channels.map((c) => `${c.slug === st().activeChannel ? '*' : ' '} ${c.slug.padEnd(18)}${c.name}${c.is_primary ? ' (primary)' : ''}`).join('\n') || 'no channels', 'plain')
        return
      }
      const match = pickByName(channels, (c) => c.slug, arg) ?? pickByName(channels, (c) => c.name, arg) ?? fail(`no channel "${arg}"`)
      st().setActiveChannel(match.slug)
      ctx.print(`files channel: ${match.slug}`, 'ok')
    },
  },
  {
    name: 'servers', group: 'App', usage: 'servers', description: 'List your chat servers with their channels and unread counts',
    run: (_a, ctx) => {
      const cs = useChatStore.getState()
      if (cs.servers.length === 0) { ctx.print('no servers', 'dim'); return }
      ctx.print(cs.servers.map((srv) => {
        const channels = srv.channels.map((c) => {
          const n = cs.unread[`c:${c.id}`] ?? 0
          return `${c.name.replace(/\s+/g, '-')}${n ? ` (${n})` : ''}`
        })
        return `${srv.name}${srv.id === cs.activeServerId ? ' *' : ''}\n  ${channels.join('  ') || '(no channels)'}`
      }).join('\n'))
    },
  },
  {
    name: 'dms', group: 'App', usage: 'dms', description: 'List your direct messages with unread counts',
    run: (_a, ctx) => {
      const cs = useChatStore.getState()
      if (cs.conversations.length === 0) { ctx.print('no conversations', 'dim'); return }
      ctx.print(cs.conversations.map((c) => {
        const n = cs.unread[`d:${c.id}`] ?? 0
        return `@${conversationTitle(c, cs.meId).replace(/\s+/g, '-')}${n ? `  (${n} unread)` : ''}`
      }).join('\n'))
    },
  },
  {
    name: 'unread', group: 'App', usage: 'unread', description: 'Total unread chat messages',
    run: (_a, ctx) => { const n = useChatStore.getState().totalUnread(); ctx.print(n ? `${n} unread message${n === 1 ? '' : 's'}` : 'all caught up', n ? 'plain' : 'dim') },
  },
  {
    name: 'logout', group: 'App', usage: 'logout', description: 'Sign out of your account',
    run: async (_a, ctx) => {
      if (!window.confirm('Sign out of your account?')) { ctx.print('cancelled', 'dim'); return }
      await st().logoutAccount()
      ctx.print('signed out', 'ok')
    },
  },
  {
    name: 'reload', group: 'App', usage: 'reload', description: 'Reload the app',
    run: () => { window.location.reload() },
  },
  {
    name: 'version', group: 'App', usage: 'version', description: 'The app version this build is running',
    run: (_a, ctx) => { ctx.print(`unreleased ${APP_VERSION}`) },
  },
  {
    name: 'history', group: 'App', usage: 'history [N]', description: 'The last commands you ran in this room’s terminal',
    run: (args, ctx) => {
      const all = (ctx.history()).slice(0, -1)
      const n = Math.max(1, Math.min(all.length, Number(args) || 25))
      const from = all.length - n
      ctx.print(all.slice(from).map((c, i) => `${String(from + i + 1).padStart(4)}  ${c}`).join('\n') || 'no history', all.length ? 'plain' : 'dim')
    },
  },
  {
    name: 'echo', group: 'App', usage: 'echo <text>', description: 'Print text',
    run: (args, ctx) => { ctx.print(args) },
  },
  {
    name: 'date', group: 'App', usage: 'date', description: 'The current date and time',
    run: (_a, ctx) => { ctx.print(new Date().toString()) },
  },
]
