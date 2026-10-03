import { relativeTime } from '../../components/adminShared'
import { mentionIdsIn } from '../../components/chat/people'
import { conversationTitle, displayName, roomKey, useChatStore } from '../../store/chatStore'
import { splitForwardRef } from '../chatForwardRef'
import { splitReplyRef } from '../chatReplyRef'
import { adminGetUser, adminListUsers, getNowPlaying, getPublicProfile, type AdminUser } from '../userApi'
import { getSongsByIds } from '../juicewrldApi'
import { termAccess } from './access'
import { fail, type TermCommand } from './types'

// A searchable list of everyone the terminal can name. The app has no public
// "find a user" endpoint, so this is the union of what chat already knows
// (members of your servers, DM participants) and, for administrators, the
// account list the Admin page uses - which covers people who have never been
// in a room with you. The account list is fetched once and kept for a few
// minutes.
export interface DirUser {
  id: number
  username: string
  display: string
  discord: string
  role: string
}

const ADMIN_TTL_MS = 5 * 60_000
let adminUsers: { at: number; list: AdminUser[] } | null = null
let adminInFlight: Promise<void> | null = null

function localUsers(): Map<number, DirUser> {
  const cs = useChatStore.getState()
  const out = new Map<number, DirUser>()
  const add = (u: { id: number; username: string; display_name: string; role: string }): void => {
    out.set(u.id, { id: u.id, username: u.username, display: u.display_name, discord: '', role: u.role })
  }
  for (const list of Object.values(cs.members)) for (const m of list) add(m.user)
  for (const c of cs.conversations) for (const p of c.participants) add(p.user)
  if (cs.me) add(cs.me)
  return out
}

/** Everyone known right now, without waiting on the network. */
export function directorySync(): DirUser[] {
  const out = localUsers()
  for (const u of adminUsers?.list ?? []) {
    const known = out.get(u.user_id)
    out.set(u.user_id, {
      id: u.user_id, username: u.username, display: known?.display ?? '',
      discord: u.discord_username ?? '', role: u.role || known?.role || '',
    })
  }
  return [...out.values()]
}

export async function directory(): Promise<DirUser[]> {
  if (useChatStore.getState().me?.role === 'administrator' && (!adminUsers || Date.now() - adminUsers.at > ADMIN_TTL_MS)) {
    adminInFlight ??= adminListUsers()
      .then((list) => { adminUsers = { at: Date.now(), list } })
      .catch(() => { adminUsers = { at: Date.now(), list: adminUsers?.list ?? [] } })
      .finally(() => { adminInFlight = null })
    await adminInFlight
  }
  return directorySync()
}

const norm = (s: string): string => s.toLowerCase()

/** Best matches first: exact name, then name prefix, then anywhere in the
 *  username / display name / Discord name. A bare number also matches that id. */
export function matchUsers(list: DirUser[], query: string): DirUser[] {
  const q = norm(query.trim().replace(/^@/, ''))
  if (!q) return []
  const scored: { u: DirUser; score: number }[] = []
  for (const u of list) {
    const names = [u.username, u.display, u.discord].filter(Boolean).map(norm)
    let score = 0
    if (String(u.id) === q) score = 100
    else if (norm(u.username) === q) score = 90
    else if (names.some((n) => n === q)) score = 80
    else if (names.some((n) => n.startsWith(q))) score = 60
    else if (names.some((n) => n.includes(q))) score = 30
    if (score) scored.push({ u, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.u.username.localeCompare(b.u.username)).map((x) => x.u)
}

/** One person from what was typed: an id, an exact name, or an unambiguous
 *  fragment. Throws with the candidates when it could be several. */
export async function resolveUser(handle: string): Promise<DirUser> {
  const list = await directory()
  const q = handle.trim().replace(/^@/, '')
  if (!q) fail('name a user')
  const hits = matchUsers(list, q)
  const top = hits[0]
  if (top && (String(top.id) === q || norm(top.username) === norm(q))) return top
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) fail(`"${q}" could be: ${hits.slice(0, 6).map((u) => u.username).join(', ')}${hits.length > 6 ? ', …' : ''}`)
  if (/^\d+$/.test(q)) return { id: Number(q), username: `user #${q}`, display: '', discord: '', role: '' }
  return fail(`no user matching "${q}"`)
}

/** Rewrites `@name` tokens to something the chat commands accept. Those only
 *  look in the room you're in, so a person outside it becomes `@<id>` (every
 *  command takes an id); someone in the room keeps their exact username. A
 *  name that matches several people stops the command with the list. */
export async function resolveHandles(line: string, roomPeople: { username: string }[]): Promise<string> {
  if (!/(^|\s)@[^\s@]+/.test(line)) return line
  const inRoom = new Set(roomPeople.map((p) => norm(p.username)))
  const handles = [...line.matchAll(/(^|\s)@([^\s@]+)/g)].map((m) => m[2])
  const unresolved = handles.filter((h) => !inRoom.has(norm(h)) && !/^\d+$/.test(h) && norm(h) !== 'everyone')
  if (unresolved.length === 0) return line
  const list = await directory()
  let out = line
  for (const h of new Set(unresolved)) {
    const hits = matchUsers(list, h)
    const exact = hits.find((u) => norm(u.username) === norm(h))
    const pick = exact ?? (hits.length === 1 ? hits[0] : null)
    if (!pick) {
      if (hits.length > 1) fail(`@${h} could be: ${hits.slice(0, 6).map((u) => u.username).join(', ')}${hits.length > 6 ? ', …' : ''}`)
      continue
    }
    const token = inRoom.has(norm(pick.username)) ? pick.username : String(pick.id)
    out = out.replace(new RegExp(`(^|\\s)@${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), `$1@${token}`)
  }
  return out
}

const roleBits = (u: AdminUser): string[] => [
  ...(u.role === 'administrator' ? ['administrator'] : []),
  ...(u.role === 'editor' ? ['editor'] : []),
  ...(u.contributor_enabled ? ['contributor'] : []),
  ...(u.manager_enabled ? ['manager'] : []),
  ...(u.news_enabled ? ['news'] : []),
]

async function describeUser(u: DirUser): Promise<string> {
  const [profile, admin] = await Promise.allSettled([getPublicProfile(u.id), useChatStore.getState().me?.role === 'administrator' ? adminGetUser(u.id) : Promise.reject(new Error('admin only'))])
  const p = profile.status === 'fulfilled' ? profile.value : null
  const a = admin.status === 'fulfilled' ? admin.value : null
  if (!p && !a && !u.display && u.username.startsWith('user #')) fail(`no user with id ${u.id}`)
  const cs = useChatStore.getState()
  const name = p?.username ?? a?.username ?? u.username
  const shown = p?.display_name || u.display
  const lines = [`${name}${shown && shown !== name ? ` (${shown})` : ''}   #${u.id}`]

  const roles = a ? roleBits(a) : [p?.is_editor ? 'editor' : '', p?.is_contributor ? 'contributor' : ''].filter(Boolean)
  lines.push(`roles: ${roles.length ? roles.join(', ') : 'standard user'}${p?.is_donor ? ' · donor' : ''}${a && !a.is_active ? ' · ACCOUNT DISABLED' : ''}`)
  if (a) {
    lines.push(`joined ${new Date(a.date_joined).toLocaleDateString()} · last login ${relativeTime(a.last_login)}${a.otp_enabled ? ' · 2FA on' : ''}`)
    lines.push(`edits ${a.proposal_count} (${a.approved_count} approved) · comp ${a.comp_proposal_count} (${a.comp_approved_count} approved)${a.auto_approve_proposals || a.auto_approve_comp_proposals ? ` · auto-approve ${[a.auto_approve_proposals ? 'edits' : '', a.auto_approve_comp_proposals ? 'comp' : ''].filter(Boolean).join('+')}` : ''}`)
  }
  if (p?.bio) lines.push(`bio: ${p.bio.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (cs.presenceEnabled) lines.push(cs.online[u.id] ? 'online now' : 'offline')
  if (p?.public_now_playing) {
    const np = (await getNowPlaying(u.id).catch(() => null))?.now_playing
    if (np) {
      const [song] = await getSongsByIds([np.song]).catch(() => [])
      lines.push(`listening to: ${song?.name ?? `song #${np.song}`}`)
    }
  }
  const access = termAccess()
  lines.push(`→ ${[access.admin && `role @${name}`, access.chat && `seen @${name}`, access.chat && `dm ${name}`, access.admin && `siteban @${name}`, `open user ${u.id}`].filter(Boolean).join(' · ')}`)
  return lines.join('\n')
}

export const USER_COMMANDS: TermCommand[] = [
  {
    name: 'user', aliases: ['whois', 'u'], group: 'People', usage: 'user <name | id>',
    description: 'Look someone up by username, display name, Discord name or id: profile, roles, activity. Several matches are listed',
    complete: async (before, partial) => (before.length === 0 ? (await directory()).map((u) => u.username).filter((n) => norm(n).startsWith(norm(partial))) : []),
    run: async (args, ctx) => {
      const q = args.trim()
      if (!q) fail('usage: user <name | id>')
      const hits = matchUsers(await directory(), q)
      const exact = hits[0] && (String(hits[0].id) === q.replace(/^@/, '') || norm(hits[0].username) === norm(q.replace(/^@/, '')))
      if (hits.length === 0) {
        if (/^\d+$/.test(q)) { ctx.print(await describeUser({ id: Number(q), username: `user #${q}`, display: '', discord: '', role: '' })); return }
        fail(`no user matching "${q}"`)
      }
      if (hits.length === 1 || exact) { ctx.print(await describeUser(hits[0])); return }
      ctx.print(`${hits.slice(0, 25).map((u) => `${String(u.id).padEnd(7)}${u.username.padEnd(22)}${(u.display || u.discord).padEnd(22)}${u.role}`).join('\n')}\n${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > 25 ? ' (showing 25)' : ''} · user <exact name or id> for details`)
    },
  },
  {
    name: 'dm', group: 'People', chat: true, usage: 'dm <user> [message]', description: 'Open a direct message with someone, optionally sending a first message',
    complete: async (before, partial) => (before.length === 0 ? (await directory()).map((u) => u.username).filter((n) => norm(n).startsWith(norm(partial))) : []),
    run: async (args, ctx) => {
      const [who, ...rest] = args.trim().split(/\s+/)
      if (!who) fail('usage: dm <user> [message]')
      const target = await resolveUser(who)
      if (target.id === useChatStore.getState().meId) fail('that is you')
      const existing = useChatStore.getState().conversations.find((c) => !c.is_group && c.participants.some((p) => p.user.id === target.id))
      const conv = existing ?? await useChatStore.getState().startDm([target.id])
      useChatStore.getState().openRoom({ kind: 'conversation', id: conv.id })
      const text = rest.join(' ').trim()
      if (text) await useChatStore.getState().send({ kind: 'conversation', id: conv.id }, { text, files: [] })
      ctx.print(text ? `sent to ${target.username}` : `opened a DM with ${target.username}`, 'ok')
    },
  },
  {
    name: 'say', group: 'People', chat: true, usage: 'say <message>', description: 'Post a message to the room the terminal is in (plain text is never sent unless you say it)',
    run: async (args, ctx) => {
      const text = args.trim()
      if (!text) fail('usage: say <message>')
      await useChatStore.getState().send(ctx.room, { text, files: [], mentions: mentionIdsIn(text, ctx.people) })
      ctx.print('sent', 'ok')
    },
  },
  {
    name: 'log', aliases: ['messages', 'tail'], group: 'People', chat: true, usage: 'log [N] [@user]', description: 'Show the latest messages in this room (default 20), optionally only from one person',
    run: (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const countWord = words.find((w) => /^\d+$/.test(w))
      const count = Math.min(100, Math.max(1, Number(countWord) || 20))
      const who = words.find((w) => w.startsWith('@'))?.slice(1).toLowerCase()
      const cs = useChatStore.getState()
      const channelRoom = ctx.room.kind === 'channel' ? cs.servers.flatMap((s) => s.channels.map((c) => ({ s, c }))).find((x) => x.c.id === ctx.room.id) : undefined
      const conv = ctx.room.kind === 'channel' ? undefined : cs.conversations.find((c) => c.id === ctx.room.id)
      const roomName = channelRoom ? `#${channelRoom.c.name} (${channelRoom.s.name})` : conv ? `DM with ${conversationTitle(conv, cs.meId)}` : 'this room'
      const items = (cs.rooms[roomKey(ctx.room)]?.items ?? []).filter((m) => !m.deleted_at && !m.parent && (!who || m.author.username.toLowerCase() === who))
      if (items.length === 0) { ctx.print(who ? `no loaded messages from @${who} in ${roomName}` : `no messages loaded in ${roomName} yet`, 'dim'); return }
      const lines = items.slice(-count).map((m) => {
        const raw = m.is_encrypted ? (() => { const p = cs.plain[m.id]; return p && 'text' in p ? p.text : '[encrypted - key not available]' })() : m.content
        const body = splitForwardRef(splitReplyRef(raw).body).body.replace(/\s+/g, ' ').trim()
        const text = body.startsWith('unreleased:') ? '[shared card]' : body
        const at = new Date(m.created_at)
        const files = m.attachments.length ? ` [${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}]` : ''
        return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}  ${displayName(m.author)}: ${text}${files}`
      })
      ctx.print([`── ${roomName}${who ? ` · @${who}` : ''} · last ${lines.length} ──`, ...lines].join('\n'))
    },
  },
]
