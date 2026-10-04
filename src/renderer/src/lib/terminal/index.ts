import { searchSongs } from '../juicewrldApi'
import { useChatStore, conversationTitle } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { canRun, chatCommandsFor } from './access'
import { ADMIN_COMMANDS } from './admin'
import { CDN_COMMANDS } from './cdn'
import { APP_COMMANDS } from './app'
import { FUN_COMMANDS } from './fun'
import { LIBRARY_COMMANDS } from './library'
import { PLAYER_COMMANDS } from './player'
import { SETTINGS_COMMANDS, searchSettings } from './settings'
import type { TermCommand, TermGroup } from './types'
import { directory, matchUsers, USER_COMMANDS } from './users'

export type { TermCommand, TermCtx, TermGroup, TermScreen, TermTone } from './types'
export { canRun, chatCommandsFor, moderationChatCommandsFor, plainChatCommandsFor, termAccess, termUserName, type TermAccess } from './access'
export { juicesayText } from './fun'
export { directory, directorySync, resolveHandles } from './users'

const norm = (s: string): string => s.toLowerCase()
const section = (title: string, rows: string[], total = rows.length): string =>
  rows.length ? `${title}\n${rows.map((r) => `  ${r}`).join('\n')}${total > rows.length ? `\n  … ${total - rows.length} more` : ''}` : ''

// One search across everything the terminal can name, so you don't have to know
// which command owns the thing you're after.
const LOOKUP: TermCommand = {
  name: 'lookup', aliases: ['search-all', 'whatis'], group: 'People', usage: 'lookup <text>',
  description: 'Search people, rooms, playlists, settings, commands and songs at once',
  run: async (args, ctx) => {
    const q = args.trim()
    if (!q) throw new Error('usage: lookup <text>')
    const cs = useChatStore.getState()
    const ql = norm(q)

    const [people, songs] = await Promise.all([directory(), searchSongs(q, 5).catch(() => [])])
    const users = matchUsers(people, q)
    const rooms = [
      ...cs.servers.flatMap((srv) => srv.channels.filter((c) => norm(c.name).includes(ql) || norm(srv.name).includes(ql)).map((c) => `#${c.name.replace(/\s+/g, '-')}  in ${srv.name}   → room ${srv.id === cs.activeServerId ? '' : `${srv.name.toLowerCase().replace(/\s+/g, '-')}/`}${c.name.toLowerCase().replace(/\s+/g, '-')}`)),
      ...cs.conversations.filter((c) => norm(conversationTitle(c, cs.meId)).includes(ql)).map((c) => `@${conversationTitle(c, cs.meId)}   → room @${conversationTitle(c, cs.meId).toLowerCase().replace(/\s+/g, '-')}`),
    ]
    const playlists = useStore.getState().playlists.filter((p) => norm(p.name).includes(ql)).map((p) => `${p.name}  (${p.track_count})   → playlist play ${p.name}`)
    const settings = searchSettings(q).map((s) => `${s.key} = ${s.value}   → set ${s.key} <value>`)
    const all = [...FUN_COMMANDS, ...PLAYER_COMMANDS, ...LIBRARY_COMMANDS, ...SETTINGS_COMMANDS, ...ADMIN_COMMANDS, ...CDN_COMMANDS, ...APP_COMMANDS, ...USER_COMMANDS, LOOKUP].filter((c) => canRun(c))
    const commands = [
      ...chatCommandsFor().filter((c) => c.name.includes(ql) || norm(c.description).includes(ql)).map((c) => `${c.usage}  - ${c.description}`),
      ...all.filter((c) => c.name.includes(ql) || c.aliases?.some((a) => a.includes(ql)) || norm(c.description).includes(ql)).map((c) => `${c.usage}  - ${c.description}`),
    ]

    const out = [
      section('People', users.slice(0, 8).map((u) => `${u.username}${u.display && u.display !== u.username ? ` (${u.display})` : ''}  #${u.id}   → user ${u.username}`), users.length),
      section('Rooms', rooms.slice(0, 8), rooms.length),
      section('Playlists', playlists.slice(0, 8), playlists.length),
      section('Songs', songs.map((s, i) => `${s.name}  (${s.era?.name ?? s.category})   → find ${s.name}`).slice(0, 5)),
      section('Settings', settings.slice(0, 8), settings.length),
      section('Commands', commands.slice(0, 8), commands.length),
    ].filter(Boolean)
    ctx.print(out.length ? out.join('\n') : `nothing matches "${q}"`, out.length ? 'plain' : 'dim')
  },
}

// Everything the terminal can do beyond the chat slash commands and its own
// shell builtins (cd, ls, get, ...). The terminal looks a typed word up here
// before handing it to the chat command runner.
export const TERM_COMMANDS: TermCommand[] = [
  ...USER_COMMANDS,
  LOOKUP,
  ...PLAYER_COMMANDS,
  ...LIBRARY_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...ADMIN_COMMANDS,
  ...CDN_COMMANDS,
  ...APP_COMMANDS,
  ...FUN_COMMANDS,
]

export const TERM_GROUPS: TermGroup[] = ['People', 'Player', 'Library', 'Navigation', 'Settings', 'Admin', 'App', 'Fun']

/** A command by name or alias - only one this account can run. */
export function findTermCommand(word: string): TermCommand | null {
  const name = word.trim().replace(/^\//, '').toLowerCase()
  if (!name) return null
  const command = TERM_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name))
  return command && canRun(command) ? command : null
}
