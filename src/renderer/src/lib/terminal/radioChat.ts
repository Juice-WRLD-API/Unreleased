import {
  banRadioChatAuthor, deleteRadioChatMessage, fetchRadioChat, fetchRadioChatBans, liftRadioChatBan,
  setRadioChatState,
} from '../radioChatApi'
import type { RadioChatMessage } from '../radioChatApi'
import { sayOnceRadioChat } from '../radioChatSocket'
import { asJson, fail, idArg, parseArgs, table, type TermCommand } from './types'

// The 999 FM live chat (WRLD → 999 FM → Chat). `fmchat` reads and posts, as
// the panel does; `fmmod` is the admin side: the killswitch, deleting lines
// and banning their authors.

const line = (m: RadioChatMessage): string =>
  `#${m.id}  ${m.name}${m.verified ? ' ✓' : ''}${m.role === 'admin' || m.role === 'mod' ? ` [${m.role}]` : ''}: ${m.text}`

export const RADIO_CHAT_COMMANDS: TermCommand[] = [
  {
    name: 'fmchat', group: 'Content', usage: 'fmchat [--limit n] [--json] | fmchat say <text>',
    description: 'The 999 FM live chat: the latest lines, or post one (as your account when signed in)',
    // `say` opens the chat socket and, signed in, trades a ticket first.
    covers: ['radioChatApi.fetchRadioChat', 'radioChatApi.fetchRadioChatTicket'],
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['limit'])
      if (rest[0]?.toLowerCase() === 'say') {
        const text = args.replace(/^\s*say\s+/i, '').trim()
        if (!text) fail('usage: fmchat say <text>')
        const res = await sayOnceRadioChat(text)
        if (!res.ok) return fail(res.error)
        ctx.print(line(res.message), 'ok')
        return
      }
      if (rest.length) fail('usage: fmchat [--limit n] [--json] | fmchat say <text>')
      const snap = await fetchRadioChat(ctx.signal)
      if (asJson(ctx, bool.has('json'), snap)) return
      if (!snap.enabled) {
        ctx.print(`chat is off${snap.reason ? `: ${snap.reason}` : ''}`, 'dim')
        return
      }
      if (snap.guests_enabled === false) ctx.print('only signed-in listeners can chat right now', 'dim')
      const limit = value.has('limit') ? idArg(value.get('limit'), 'fmchat --limit <n>') : 20
      const rows = snap.messages.slice(-limit)
      ctx.print(rows.length ? rows.map(line).join('\n') : 'no one has said anything yet', rows.length ? 'plain' : 'dim')
    },
  },
  {
    name: 'fmmod', group: 'Admin',
    usage: 'fmmod off [reason] [--clear] | on | guests off|on | clear | delete <id> | ban <id> [minutes] [--reason r] [--keep] | bans | unban <banId>',
    description: '999 FM chat moderation: the killswitch for everyone (off/on) or guests only (guests off/on: listeners without an account), clearing, deleting lines, bans. Ban minutes 0 = until lifted; --keep leaves their lines up',
    covers: [
      'radioChatApi.setRadioChatState', 'radioChatApi.deleteRadioChatMessage', 'radioChatApi.banRadioChatAuthor',
      'radioChatApi.fetchRadioChatBans', 'radioChatApi.liftRadioChatBan',
    ],
    complete: (before, partial) => (before.length === 0 ? ['off', 'on', 'guests', 'clear', 'delete', 'ban', 'bans', 'unban'].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['reason'])
      const [sub = '', ...more] = rest
      switch (sub.toLowerCase()) {
        case 'off': {
          const s = await setRadioChatState({ enabled: false, reason: more.join(' ') || value.get('reason') || '', clear: bool.has('clear') || undefined })
          ctx.print(`chat is off${s.reason ? ` (${s.reason})` : ''}${s.cleared ? `, ${s.cleared} line${s.cleared === 1 ? '' : 's'} cleared` : ''}`, 'ok')
          return
        }
        case 'on':
          await setRadioChatState({ enabled: true })
          ctx.print('chat is on', 'ok')
          return
        case 'guests': {
          const on = more[0]?.toLowerCase() === 'on' ? true : more[0]?.toLowerCase() === 'off' ? false : fail('usage: fmmod guests off|on')
          await setRadioChatState({ guests: on })
          ctx.print(on ? 'guests can chat again' : 'guests are off: only signed-in listeners can chat', 'ok')
          return
        }
        case 'clear': {
          const s = await setRadioChatState({ clear: true })
          ctx.print(`${s.cleared} line${s.cleared === 1 ? '' : 's'} cleared`, 'ok')
          return
        }
        case 'delete':
          await deleteRadioChatMessage(idArg(more[0], 'fmmod delete <id>'))
          ctx.print('deleted', 'ok')
          return
        case 'ban': {
          const id = idArg(more[0], 'fmmod ban <id> [minutes]')
          const minutes = more[1] === undefined ? undefined : Number(more[1])
          if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) fail('minutes is a whole number (0 = until lifted)')
          const b = await banRadioChatAuthor(id, { minutes, reason: value.get('reason'), purge: !bool.has('keep') })
          ctx.print(`banned ${b.name || `#${id}'s author`} ${b.expires_at ? `until ${new Date(b.expires_at).toLocaleString()}` : 'until lifted'} (ban #${b.id})${b.hidden ? `, ${b.hidden} line${b.hidden === 1 ? '' : 's'} hidden` : ''}`, 'ok')
          return
        }
        case 'bans': {
          const bans = await fetchRadioChatBans(ctx.signal)
          if (asJson(ctx, bool.has('json'), bans)) return
          ctx.print(bans.length
            ? table(bans.map((b) => [`#${b.id}`, b.name || '-', b.expires_at ? `until ${new Date(b.expires_at).toLocaleString()}` : 'until lifted', b.created_by ?? '', b.reason]))
            : 'no one is banned', bans.length ? 'plain' : 'dim')
          return
        }
        case 'unban':
          await liftRadioChatBan(idArg(more[0], 'fmmod unban <banId>'))
          ctx.print('ban lifted', 'ok')
          return
        default:
          fail('usage: fmmod off [reason] [--clear] | on | guests off|on | clear | delete <id> | ban <id> [minutes] | bans | unban <banId>')
      }
    },
  },
]
