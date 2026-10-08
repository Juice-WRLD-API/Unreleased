import { relativeTime } from '../../components/adminShared'
import { conversationTitle, displayName, roomKey, useChatStore } from '../../store/chatStore'
import {
  addMember, CHAT_PERMISSIONS, createChannel, createConversation, createRole, createServer, deleteChannel, deleteConversation, deleteOverride, deleteRole,
  deleteServer, discoverServers, fetchAttachmentBytes, fetchPermissionMap, getChannel, getConversation, getMessage, getPresence, getServer, joinServer, leaveServer, listBans, listConversations,
  listMembers, listOverrides, listRoles, listServers, listThread, markChannelRead, markDmRead, setMemberRoles, updateChannel, updateConversation, updateMember,
  updateRole, updateServer, upsertOverride, type ChatMessage, type ChatPermissionName,
} from '../chatApi'
import { splitForwardRef } from '../chatForwardRef'
import { splitReplyRef } from '../chatReplyRef'
import { formatBytes } from '../format'
import { decryptAttachment, decryptAttachmentMeta } from '../chatE2E'
import { pickLocalFile, saveBlob } from './pick'
import { resolveUser, directory } from './users'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, parseBool, table, type TermCommand, type TermCtx } from './types'

// The staff chat's management side - what the chat UI's modals and side panels
// do: servers, members, roles, rooms and their permission overrides, group
// chats and the actions on one message. Message text is end-to-end encrypted
// in DMs, so anything that sends or edits goes through the chat store (which
// seals it) rather than the raw endpoints. Needs chat access; the API decides
// what each account may do.
const cs = (): ReturnType<typeof useChatStore.getState> => useChatStore.getState()
const refresh = (): Promise<void> => cs().refreshLists()
const onOff = (v: string | undefined, name: string): boolean | undefined => (v === undefined ? undefined : parseBool(v) ?? fail(`--${name} takes on or off`))
const defined = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

// A server is an id, a name, or (no argument) the one the terminal is in.
function serverOf(arg: string | undefined): number {
  const s = cs()
  const q = (arg ?? '').trim().toLowerCase()
  if (!q) return s.activeServerId ?? fail('say which server (id or name), or open one first')
  if (/^\d+$/.test(q)) return Number(q)
  const hits = s.servers.filter((x) => x.name.toLowerCase() === q || x.slug === q || x.name.toLowerCase().includes(q))
  return hits.length === 1 ? hits[0].id : fail(hits.length ? `"${arg}" matches ${hits.map((h) => h.name).join(', ')}` : `no server "${arg}" (server ls)`)
}

const userId = async (arg: string | undefined): Promise<number> => (await resolveUser(arg ?? '')).id

const PERM_NAMES = Object.keys(CHAT_PERMISSIONS) as ChatPermissionName[]
function parsePerms(text: string): number {
  if (/^\d+$/.test(text.trim())) return Number(text)
  let mask = 0
  for (const w of text.split(/[,\s|]+/).filter(Boolean)) {
    const name = PERM_NAMES.find((n) => n === w.toLowerCase().replace(/-/g, '_')) ?? fail(`unknown permission "${w}" (perms lists them)`)
    mask |= CHAT_PERMISSIONS[name]
  }
  return mask
}
const permNames = (mask: number): string => PERM_NAMES.filter((n) => (mask & CHAT_PERMISSIONS[n]) !== 0).join(', ') || '-'

const complete = (subs: string[]) => (before: string[], partial: string): string[] => (before.length === 0 ? subs.filter((s) => s.startsWith(partial.toLowerCase())) : [])

const serverCommand: TermCommand = {
  name: 'server', aliases: ['srv'], group: 'People', chat: true,
  usage: 'server [ls] · show [id] · discover · join <id> · leave <id> · new <name> [--desc d] [--public on|off] · edit <id> [--name n] [--desc d] [--public on|off] · rm <id>',
  description: 'Chat servers: list yours, find and join public ones, create, edit, leave or delete one',
  covers: ['chatApi.listServers', 'chatApi.getServer', 'chatApi.discoverServers', 'chatApi.joinServer', 'chatApi.leaveServer', 'chatApi.createServer', 'chatApi.updateServer', 'chatApi.deleteServer'],
  complete: complete(['ls', 'show', 'discover', 'join', 'leave', 'new', 'edit', 'rm']),
  run: async (args, ctx) => {
    const { rest, bool, value } = parseArgs(args, ['name', 'desc', 'public'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    if (sub === 'ls' || sub === 'list') {
      const list = await listServers()
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(list.length ? table(list.map((s) => [`#${s.id}`, s.name, s.my_role, `${s.member_count} members`, `${s.channels.length} rooms`])) : 'you are in no servers', list.length ? 'plain' : 'dim')
    } else if (sub === 'show') {
      const s = await getServer(serverOf(rest[0]))
      if (asJson(ctx, bool.has('json'), s)) return
      ctx.print([`${s.name}  (#${s.id}, ${s.is_public ? 'public' : 'private'}, you are ${s.my_role})`, s.description, `members ${s.member_count}`, `roles   ${s.roles.map((r) => r.name).join(', ') || '-'}`, ...s.channels.map((c) => `  #${c.name.padEnd(20)}#${c.id}${c.category ? `  [${c.category}]` : ''}${c.is_private ? '  private' : ''}`)].filter(Boolean).join('\n'))
    } else if (sub === 'discover') {
      const list = await discoverServers()
      ctx.print(list.length ? table(list.map((s) => [`#${s.id}`, s.name, `${s.member_count} members`, s.is_member ? 'joined' : '', s.description])) : 'no public servers', list.length ? 'plain' : 'dim')
    } else if (sub === 'join') {
      const s = await joinServer(idArg(rest[0], 'server join <id>'))
      await refresh()
      ctx.print(`joined ${s.name}`, 'ok')
    } else if (sub === 'leave') {
      const id = serverOf(rest[0])
      if (!confirmAction(ctx, `Leave server #${id}?`, bool.has('y'))) return
      await leaveServer(id)
      await refresh()
      ctx.print(`left server #${id}`, 'ok')
    } else if (sub === 'new') {
      const name = value.get('name') ?? rest.join(' ')
      if (!name) fail('usage: server new <name> [--desc d] [--public on|off]')
      const s = await createServer({ name, description: value.get('desc'), is_public: onOff(value.get('public'), 'public') })
      await refresh()
      ctx.print(`created server #${s.id} ${s.name}`, 'ok')
    } else if (sub === 'edit') {
      const patch = defined({ name: value.get('name'), description: value.get('desc'), is_public: onOff(value.get('public'), 'public') })
      if (Object.keys(patch).length === 0) fail('nothing to change - give --name, --desc or --public')
      const s = await updateServer(serverOf(rest[0]), patch)
      await refresh()
      ctx.print(`updated ${s.name}`, 'ok')
    } else if (sub === 'rm' || sub === 'delete') {
      const id = serverOf(rest[0])
      if (!confirmAction(ctx, `Delete server #${id} and everything in it? This can't be undone.`, bool.has('y'))) return
      await deleteServer(id)
      await refresh()
      ctx.print(`deleted server #${id}`, 'ok')
    } else fail('usage: server [ls | show | discover | join | leave | new | edit | rm]')
  },
}

const memberCommand: TermCommand = {
  name: 'member', aliases: ['members'], group: 'People', chat: true,
  usage: 'member [ls [server]] · bans [server] · add <server> <user> [--admin] · set <server> <user> [--role admin|member] [--muted on|off] · roles <server> <user> <roleId…>  (kick, ban, timeout: the chat commands)',
  description: 'The members of a chat server: list, add, change a member’s role or mute, or assign custom roles',
  covers: ['chatApi.listMembers', 'chatApi.listBans', 'chatApi.addMember', 'chatApi.updateMember', 'chatApi.setMemberRoles'],
  complete: complete(['ls', 'bans', 'add', 'set', 'roles']),
  run: async (args, ctx) => {
    const { rest, bool, value } = parseArgs(args, ['role', 'muted'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    if (sub === 'ls' || sub === 'list') {
      const list = await listMembers(serverOf(rest[0]))
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(table(list.map((m) => [`#${m.user.id}`, displayName(m.user), m.server_role, m.roles.map((r) => r.name).join(', '), m.muted ? 'muted' : '', m.timeout_until ? `timeout until ${relativeTime(m.timeout_until)}` : ''])))
    } else if (sub === 'bans') {
      const list = await listBans(serverOf(rest[0]))
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(list.length ? table(list.map((b) => [`#${b.user.id}`, displayName(b.user), b.banned_by ? `by ${displayName(b.banned_by)}` : '', relativeTime(b.created_at), b.reason])) : 'no bans', list.length ? 'plain' : 'dim')
    } else if (sub === 'add') {
      const server = serverOf(rest[0])
      const m = await addMember(server, await userId(rest[1]), bool.has('admin') ? 'admin' : 'member')
      ctx.print(`added ${displayName(m.user)} as ${m.server_role}`, 'ok')
    } else if (sub === 'set') {
      const role = value.get('role')
      if (role !== undefined && role !== 'admin' && role !== 'member') fail('--role is admin or member')
      const patch = defined({ server_role: role as 'admin' | 'member' | undefined, muted: onOff(value.get('muted'), 'muted') })
      if (Object.keys(patch).length === 0) fail('nothing to change - give --role or --muted')
      const m = await updateMember(serverOf(rest[0]), await userId(rest[1]), patch)
      ctx.print(`${displayName(m.user)}: ${m.server_role}${m.muted ? ', muted' : ''}`, 'ok')
    } else if (sub === 'roles') {
      const ids = rest.slice(2).join(' ').split(/[,\s]+/).filter(Boolean).map((w) => idArg(w, 'member roles <server> <user> <roleId…>'))
      const m = await setMemberRoles(serverOf(rest[0]), await userId(rest[1]), ids)
      ctx.print(`${displayName(m.user)} now has: ${m.roles.map((r) => r.name).join(', ') || 'no custom roles'}`, 'ok')
    } else fail('usage: member [ls | bans | add | set | roles]')
  },
}

const roleCommand: TermCommand = {
  name: 'chatrole', group: 'People', chat: true,
  usage: 'chatrole [ls [server]] · new <server> <name> [--color #hex] [--pos n] [--perms a,b|N] · edit <server> <roleId> [--name n] [--color c] [--pos n] [--perms …] · rm <server> <roleId> · perms',
  description: 'Custom roles on a chat server and the permission bits they carry (perms lists the names). The admin chat command /role is for site-wide roles',
  covers: ['chatApi.listRoles', 'chatApi.createRole', 'chatApi.updateRole', 'chatApi.deleteRole', 'chatApi.fetchPermissionMap'],
  complete: complete(['ls', 'new', 'edit', 'rm', 'perms']),
  run: async (args, ctx) => {
    const { rest, bool, value } = parseArgs(args, ['name', 'color', 'pos', 'perms'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    if (sub === 'perms') {
      const map = await fetchPermissionMap()
      ctx.print(table(Object.entries(map).map(([n, bit]) => [n, String(bit)])))
    } else if (sub === 'ls' || sub === 'list') {
      const list = await listRoles(serverOf(rest[0]))
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(table(list.map((r) => [`#${r.id}`, r.name, r.color, `pos ${r.position}`, r.is_default ? 'default' : '', permNames(r.permissions)])))
    } else if (sub === 'new') {
      const server = serverOf(rest[0])
      const name = value.get('name') ?? rest.slice(1).join(' ')
      if (!name) fail('usage: chatrole new <server> <name> [--color #hex] [--pos n] [--perms …]')
      const r = await createRole(server, { name, color: value.get('color') ?? '#99aab5', position: Number(value.get('pos') ?? 0) || 0, permissions: parsePerms(value.get('perms') ?? '') })
      ctx.print(`created role #${r.id} ${r.name} (${permNames(r.permissions)})`, 'ok')
    } else if (sub === 'edit') {
      const patch = defined({ name: value.get('name'), color: value.get('color'), position: value.has('pos') ? Number(value.get('pos')) : undefined, permissions: value.has('perms') ? parsePerms(value.get('perms') as string) : undefined })
      if (Object.keys(patch).length === 0) fail('nothing to change - give --name, --color, --pos or --perms')
      const r = await updateRole(serverOf(rest[0]), idArg(rest[1], 'chatrole edit <server> <roleId> …'), patch)
      ctx.print(`updated ${r.name} (${permNames(r.permissions)})`, 'ok')
    } else if (sub === 'rm' || sub === 'delete') {
      const server = serverOf(rest[0])
      const id = idArg(rest[1], 'chatrole rm <server> <roleId>')
      if (!confirmAction(ctx, `Delete role #${id}?`, bool.has('y'))) return
      await deleteRole(server, id)
      ctx.print(`deleted role #${id}`, 'ok')
    } else fail('usage: chatrole [ls | new | edit | rm | perms]')
  },
}

const roomCommand: TermCommand = {
  name: 'room', group: 'People', chat: true,
  usage: 'room show <id> · new <server> <name> [--topic t] [--category c] [--private on|off] [--pos n] · edit <id> [same flags] · rm <id> · read [id] · overrides <id> · override <id> (--role r | --member user) [--allow a,b] [--deny a,b] · unoverride <id> <overrideId>',
  description: 'Chat rooms (channels) and their permission overrides: create, edit, delete, mark read, and set who can see or write in one',
  covers: ['chatApi.getChannel', 'chatApi.createChannel', 'chatApi.updateChannel', 'chatApi.deleteChannel', 'chatApi.markChannelRead', 'chatApi.markDmRead', 'chatApi.listOverrides', 'chatApi.upsertOverride', 'chatApi.deleteOverride'],
  complete: complete(['show', 'new', 'edit', 'rm', 'read', 'overrides', 'override', 'unoverride']),
  run: async (args, ctx) => {
    const { rest, bool, value } = parseArgs(args, ['topic', 'category', 'private', 'pos', 'name', 'role', 'member', 'allow', 'deny'])
    const sub = (rest.shift() ?? '').toLowerCase()
    const fields = defined({ topic: value.get('topic'), category: value.get('category'), is_private: onOff(value.get('private'), 'private'), position: value.has('pos') ? Number(value.get('pos')) : undefined })
    if (sub === 'show') {
      const c = await getChannel(idArg(rest[0], 'room show <id>'))
      if (asJson(ctx, bool.has('json'), c)) return
      ctx.print(`#${c.name}  (id ${c.id}, server ${c.server}${c.category ? `, ${c.category}` : ''}${c.is_private ? ', private' : ''})${c.topic ? `\n${c.topic}` : ''}`)
    } else if (sub === 'new') {
      const server = serverOf(rest[0])
      const name = value.get('name') ?? rest.slice(1).join(' ')
      if (!name) fail('usage: room new <server> <name> [--topic t] [--category c] [--private on|off]')
      const c = await createChannel(server, { name, ...fields })
      await refresh()
      ctx.print(`created #${c.name} (id ${c.id})`, 'ok')
    } else if (sub === 'edit') {
      const patch = defined({ name: value.get('name'), ...fields })
      if (Object.keys(patch).length === 0) fail('nothing to change - give --name, --topic, --category, --private or --pos')
      const c = await updateChannel(idArg(rest[0], 'room edit <id> …'), patch)
      await refresh()
      ctx.print(`updated #${c.name}`, 'ok')
    } else if (sub === 'rm' || sub === 'delete') {
      const id = idArg(rest[0], 'room rm <id>')
      if (!confirmAction(ctx, `Delete room #${id} and its messages? This can't be undone.`, bool.has('y'))) return
      await deleteChannel(id)
      await refresh()
      ctx.print(`deleted room #${id}`, 'ok')
    } else if (sub === 'read') {
      // No id: the room the terminal is attached to.
      const id = rest[0] ? idArg(rest[0], 'room read [id]') : ctx.room.id
      if (!rest[0] && ctx.room.kind !== 'channel') await markDmRead(id)
      else await markChannelRead(id)
      ctx.print('marked read', 'ok')
    } else if (sub === 'overrides') {
      const list = await listOverrides(idArg(rest[0], 'room overrides <id>'))
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(list.length ? table(list.map((o) => [`#${o.id}`, o.role !== null ? `role ${o.role}` : `member ${o.member}`, `allow: ${permNames(o.allow)}`, `deny: ${permNames(o.deny)}`])) : 'no overrides', list.length ? 'plain' : 'dim')
    } else if (sub === 'override') {
      const id = idArg(rest[0], 'room override <id> (--role r | --member user) …')
      const role = value.has('role') ? idArg(value.get('role'), 'room override <id> --role <roleId>') : undefined
      const member = value.has('member') ? await userId(value.get('member')) : undefined
      if ((role === undefined) === (member === undefined)) fail('give --role <roleId> or --member <user> (one of them)')
      const o = await upsertOverride(id, { ...(role !== undefined ? { role } : { member }), allow: parsePerms(value.get('allow') ?? ''), deny: parsePerms(value.get('deny') ?? '') })
      ctx.print(`override #${o.id}: allow ${permNames(o.allow)} · deny ${permNames(o.deny)}`, 'ok')
    } else if (sub === 'unoverride') {
      const id = idArg(rest[0], 'room unoverride <id> <overrideId>')
      await deleteOverride(id, idArg(rest[1], 'room unoverride <id> <overrideId>'))
      ctx.print('override removed', 'ok')
    } else fail('usage: room [show | new | edit | rm | read | overrides | override | unoverride]')
  },
}

const convoCommand: TermCommand = {
  name: 'convo', aliases: ['chats'], group: 'People', chat: true,
  usage: 'convo [ls] · show <id> · new <user…> [--name n] · rename <id> <name> · add <id> <user…> · remove <id> <user…> · rm <id>',
  description: 'Direct messages and group chats: list, start one with several people, rename, add or remove people, delete (dm <user> opens one)',
  covers: ['chatApi.listConversations', 'chatApi.getConversation', 'chatApi.createConversation', 'chatApi.updateConversation', 'chatApi.deleteConversation'],
  complete: complete(['ls', 'show', 'new', 'rename', 'add', 'remove', 'rm']),
  run: async (args, ctx) => {
    const { rest, bool, value } = parseArgs(args, ['name'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    const me = cs().meId
    const users = (words: string[]): Promise<number[]> => Promise.all(words.map(userId))
    if (sub === 'ls' || sub === 'list') {
      const list = await listConversations()
      if (asJson(ctx, bool.has('json'), list)) return
      ctx.print(list.length ? table(list.map((c) => [`#${c.id}`, conversationTitle(c, me), c.is_group ? `group of ${c.participants.length}` : 'dm', relativeTime(c.updated_at)])) : 'no conversations', list.length ? 'plain' : 'dim')
    } else if (sub === 'show') {
      const c = await getConversation(idArg(rest[0], 'convo show <id>'))
      ctx.print(`${conversationTitle(c, me)}  (#${c.id}${c.is_group ? ', group' : ''})\n${c.participants.map((p) => `  ${displayName(p.user)}${p.muted ? ' (muted)' : ''}`).join('\n')}`)
    } else if (sub === 'new') {
      if (rest.length === 0) fail('usage: convo new <user…> [--name n]')
      const ids = await users(rest)
      const c = await createConversation({ participant_ids: ids, is_group: ids.length > 1, name: value.get('name') })
      await refresh()
      ctx.print(`started #${c.id} ${conversationTitle(c, me)}`, 'ok')
    } else if (sub === 'rename') {
      const c = await updateConversation(idArg(rest[0], 'convo rename <id> <name>'), { name: rest.slice(1).join(' ') || fail('usage: convo rename <id> <name>') })
      await refresh()
      ctx.print(`renamed to ${c.name}`, 'ok')
    } else if (sub === 'add' || sub === 'remove') {
      const id = idArg(rest[0], `convo ${sub} <id> <user…>`)
      const ids = await users(rest.slice(1))
      if (ids.length === 0) fail(`usage: convo ${sub} <id> <user…>`)
      await updateConversation(id, sub === 'add' ? { add_participant_ids: ids } : { remove_participant_ids: ids })
      await refresh()
      ctx.print(`${sub === 'add' ? 'added' : 'removed'} ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`, 'ok')
    } else if (sub === 'rm' || sub === 'delete') {
      const id = idArg(rest[0], 'convo rm <id>')
      if (!confirmAction(ctx, `Delete conversation #${id}?`, bool.has('y'))) return
      await deleteConversation(id)
      await refresh()
      ctx.print(`deleted #${id}`, 'ok')
    } else fail('usage: convo [ls | show | new | rename | add | remove | rm]')
  },
}

// The message in this room's loaded history, or fetched by id when it isn't.
async function messageById(id: number, ctx: TermCtx): Promise<ChatMessage> {
  const loaded = cs().rooms[roomKey(ctx.room)]?.items.find((m) => m.id === id)
  return loaded ?? (await getMessage(id))
}

const bodyOf = (m: ChatMessage): string => {
  const raw = m.is_encrypted ? (() => { const p = cs().plain[m.id]; return p && 'text' in p ? p.text : '[encrypted - key not available]' })() : m.content
  return splitForwardRef(splitReplyRef(raw).body).body.replace(/\s+/g, ' ').trim()
}

const msgCommand: TermCommand = {
  name: 'msg', group: 'People', chat: true,
  usage: 'msg show <id> · thread <id> · pin <id> · unpin <id> · react <id> <emoji> · unreact <id> <emoji> · edit <id> -- <text> · rm <id> [--purge]',
  description: 'Act on one message by id (ids show in `log -v`/the chat): read it or its thread, pin, react, edit your own, delete',
  covers: ['chatApi.getMessage', 'chatApi.listThread', 'chatApi.pinMessage', 'chatApi.unpinMessage', 'chatApi.addReaction', 'chatApi.removeReaction', 'chatApi.editMessage', 'chatApi.deleteMessage'],
  complete: complete(['show', 'thread', 'pin', 'unpin', 'react', 'unreact', 'edit', 'rm']),
  run: async (args, ctx) => {
    const dash = args.split(/\s+--\s+/)
    const { rest, bool } = parseArgs(dash[0])
    const sub = (rest.shift() ?? '').toLowerCase()
    const id = idArg(rest[0], `msg ${sub || '<show|thread|pin|unpin|react|unreact|edit|rm>'} <id>`)
    const line = (m: ChatMessage): string => `#${m.id}  ${relativeTime(m.created_at)}  ${displayName(m.author)}: ${oneLine(bodyOf(m), 200)}${m.pinned ? '  📌' : ''}${m.reactions.length ? `  ${m.reactions.map((r) => `${r.emoji}${r.count}`).join(' ')}` : ''}`
    if (sub === 'show') {
      const m = await messageById(id, ctx)
      if (!asJson(ctx, bool.has('json'), m)) ctx.print(line(m))
    } else if (sub === 'thread') {
      const list = await listThread(id)
      ctx.print(list.length ? list.map(line).join('\n') : 'no replies', list.length ? 'plain' : 'dim')
    } else if (sub === 'pin' || sub === 'unpin') {
      const m = await messageById(id, ctx)
      if (m.pinned === (sub === 'pin')) { ctx.print(`#${id} is already ${sub === 'pin' ? 'pinned' : 'unpinned'}`, 'dim'); return }
      await cs().togglePin(m)
      ctx.print(`${sub === 'pin' ? 'pinned' : 'unpinned'} #${id}`, 'ok')
    } else if (sub === 'react' || sub === 'unreact') {
      const emoji = rest[1] ?? fail(`usage: msg ${sub} <id> <emoji>`)
      const m = await messageById(id, ctx)
      const had = m.reactions.some((r) => r.emoji === emoji && r.me)
      if (had === (sub === 'react')) { ctx.print(sub === 'react' ? 'you already reacted with that' : 'you haven’t reacted with that', 'dim'); return }
      await cs().toggleReaction(m, emoji)
      ctx.print(`${sub === 'react' ? 'reacted' : 'removed reaction'} ${emoji} on #${id}`, 'ok')
    } else if (sub === 'edit') {
      const text = dash.slice(1).join(' -- ').trim()
      if (!text) fail('usage: msg edit <id> -- <new text>')
      await cs().edit(await messageById(id, ctx), text)
      ctx.print(`edited #${id}`, 'ok')
    } else if (sub === 'rm' || sub === 'delete') {
      if (!confirmAction(ctx, `Delete message #${id}?`, bool.has('y'))) return
      await cs().remove(await messageById(id, ctx), { purge: bool.has('purge') })
      ctx.print(`deleted #${id}`, 'ok')
    } else fail('usage: msg [show | thread | pin | unpin | react | unreact | edit | rm] <id>')
  },
}

const attachCommand: TermCommand = {
  name: 'attach', group: 'People', chat: true, usage: 'attach [caption]',
  description: 'Send a file from this computer to the room the terminal is in (opens a file picker; encrypted in DMs)',
  covers: ['chatApi.uploadChatFile', 'chatApi.uploadChatFileChunked', 'chatE2E.uploadEncryptedFile', 'chatE2E.uploadEncryptedFileV2'],
  run: async (args, ctx) => {
    const file = await pickLocalFile('*/*')
    ctx.print(`sending ${file.name} (${formatBytes(file.size)})…`, 'dim')
    await cs().send(ctx.room, { text: args.trim(), files: [file] })
    ctx.print('sent', 'ok')
  },
}

const attachmentCommand: TermCommand = {
  name: 'attachment', aliases: ['files'], group: 'People', chat: true, usage: 'attachment <messageId> [n]',
  description: 'List the files on a message, or download the nth one to your computer (decrypted first in DMs)',
  covers: ['chatApi.fetchAttachmentBytes', 'chatE2E.decryptAttachment', 'chatE2E.decryptAttachmentMeta', 'chatE2E.decryptAttachmentMetaCached'],
  run: async (args, ctx) => {
    const { rest } = parseArgs(args)
    const msg = await messageById(idArg(rest[0], 'attachment <messageId> [n]'), ctx)
    if (msg.attachments.length === 0) { ctx.print('that message has no files', 'dim'); return }
    const meId = cs().meId ?? fail('chat is not connected yet')
    const names = await Promise.all(msg.attachments.map((a) => (a.key_version != null && msg.conversation ? decryptAttachmentMeta(meId, msg.conversation, a).catch(() => ({ name: a.name, mime: a.mime })) : Promise.resolve({ name: a.name, mime: a.mime }))))
    if (!rest[1]) {
      ctx.print(`${table(msg.attachments.map((a, i) => [String(i + 1), names[i].name, formatBytes(a.size), a.key_version != null ? 'encrypted' : '']))}\nattachment ${msg.id} <n> downloads one`)
      return
    }
    const n = idArg(rest[1], 'attachment <messageId> <n>')
    const att = msg.attachments[n - 1] ?? fail(`pick a file from 1 to ${msg.attachments.length}`)
    const blob = att.key_version != null && msg.conversation ? (await decryptAttachment(meId, msg.conversation, att)).blob : new Blob([(await fetchAttachmentBytes(att.id)) as Uint8Array<ArrayBuffer>], { type: att.mime })
    saveBlob(blob, names[n - 1].name)
    ctx.print(`saved ${names[n - 1].name} (${formatBytes(blob.size)}) to your downloads`, 'ok')
  },
}

const historyCommand: TermCommand = {
  name: 'history', group: 'People', chat: true, usage: 'history [pages]',
  description: 'Load older messages into this room (each page is the next batch back), then read them with log',
  covers: ['chatApi.listChannelMessages', 'chatApi.listDmMessages'],
  run: async (args, ctx) => {
    const pages = Math.min(20, Math.max(1, Number(args.trim()) || 1))
    const count = (): number => cs().rooms[roomKey(ctx.room)]?.items.length ?? 0
    const before = count()
    for (let i = 0; i < pages && !ctx.signal.aborted; i++) await cs().loadOlder(ctx.room)
    ctx.print(`${count() - before} older message${count() - before === 1 ? '' : 's'} loaded (${count()} in this room) - log 100 shows them`, count() > before ? 'ok' : 'dim')
  },
}

const presenceCommand: TermCommand = {
  name: 'online', group: 'People', chat: true, usage: 'online', description: 'Who is online in chat right now',
  covers: ['chatApi.getPresence'],
  run: async (_a, ctx) => {
    const ids = new Set(await getPresence())
    const names = (await directory()).filter((u) => ids.has(u.id)).map((u) => u.username)
    ctx.print(ids.size ? `${ids.size} online: ${names.join(', ')}${names.length < ids.size ? ` (+${ids.size - names.length} not in your directory)` : ''}` : 'nobody is online', ids.size ? 'plain' : 'dim')
  },
}

export const CHAT_MANAGE_COMMANDS: TermCommand[] = [serverCommand, memberCommand, roleCommand, roomCommand, convoCommand, msgCommand, attachCommand, attachmentCommand, historyCommand, presenceCommand]
