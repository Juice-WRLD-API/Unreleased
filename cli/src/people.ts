import { apiFetch, isAbortError } from './api'
import { fail, isAdmin, type Command } from './command'
import { getToken } from './config'
import { channelList } from './files'
import { myPlaylists } from './library'
import { searchSongs, getSong } from './songs'
import type { Shell } from './shell'

// `user` and `lookup` from the site terminal (lib/terminal/users.ts, index.ts).
// The site finds people by name through the chat member lists it already has,
// plus the admin account list; the CLI has no chat, so names go through the
// admin list (administrators only) and anyone can be looked up by id.

interface AdminUser {
  user_id: number
  username: string
  is_active: boolean
  role: string
  contributor_enabled: boolean
  manager_enabled?: boolean
  news_enabled?: boolean
  discord_username: string
  otp_enabled: boolean
  auto_approve_proposals: boolean
  auto_approve_comp_proposals: boolean
  date_joined: string
  last_login: string | null
  proposal_count: number
  approved_count: number
  comp_proposal_count: number
  comp_approved_count: number
}

interface PublicProfile {
  id: number
  username: string
  display_name: string
  bio: string
  is_editor: boolean
  is_contributor: boolean
  is_donor: boolean
  public_playlists: boolean
  public_now_playing: boolean
  playlists?: { name: string; track_count: number }[]
}

interface DirUser { id: number; username: string; display: string; discord: string; role: string }

const norm = (s: string): string => s.toLowerCase()

const ADMIN_TTL_MS = 5 * 60_000
let adminUsers: { at: number; list: AdminUser[] } | null = null

async function directory(): Promise<DirUser[]> {
  if (!adminUsers || Date.now() - adminUsers.at > ADMIN_TTL_MS) {
    adminUsers = { at: Date.now(), list: await apiFetch<AdminUser[]>('/accounts/admin/users/') }
  }
  return adminUsers.list.map((u) => ({ id: u.user_id, username: u.username, display: '', discord: u.discord_username ?? '', role: u.role }))
}

/** Best matches first: id, exact username, exact other name, prefix, substring. */
function matchUsers(list: DirUser[], query: string): DirUser[] {
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

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

const roleBits = (u: AdminUser): string[] => [
  ...(u.role === 'administrator' ? ['administrator'] : []),
  ...(u.role === 'editor' ? ['editor'] : []),
  ...(u.contributor_enabled ? ['contributor'] : []),
  ...(u.manager_enabled ? ['manager'] : []),
  ...(u.news_enabled ? ['news'] : []),
]

async function describeUser(id: number, admin: boolean): Promise<string> {
  const [profile, adminRow] = await Promise.allSettled([
    apiFetch<PublicProfile>(`/accounts/profile/${id}/`),
    admin ? apiFetch<AdminUser>(`/accounts/admin/users/${id}/`) : Promise.reject(new Error('admin only')),
  ])
  for (const r of [profile, adminRow]) if (r.status === 'rejected' && isAbortError(r.reason)) throw r.reason
  const p = profile.status === 'fulfilled' ? profile.value : null
  const a = adminRow.status === 'fulfilled' ? adminRow.value : null
  if (!p && !a) fail(`no user with id ${id}`)
  const name = p?.username ?? a!.username
  const shown = p?.display_name
  const lines = [`${name}${shown && shown !== name ? ` (${shown})` : ''}   #${id}`]
  const roles = a ? roleBits(a) : [p?.is_editor ? 'editor' : '', p?.is_contributor ? 'contributor' : ''].filter(Boolean)
  lines.push(`roles: ${roles.length ? roles.join(', ') : 'standard user'}${p?.is_donor ? ' · donor' : ''}${a && !a.is_active ? ' · ACCOUNT DISABLED' : ''}`)
  if (a) {
    lines.push(`joined ${new Date(a.date_joined).toLocaleDateString()} · last login ${relativeTime(a.last_login)}${a.otp_enabled ? ' · 2FA on' : ''}`)
    lines.push(`edits ${a.proposal_count} (${a.approved_count} approved) · comp ${a.comp_proposal_count} (${a.comp_approved_count} approved)${a.auto_approve_proposals || a.auto_approve_comp_proposals ? ` · auto-approve ${[a.auto_approve_proposals ? 'edits' : '', a.auto_approve_comp_proposals ? 'comp' : ''].filter(Boolean).join('+')}` : ''}`)
  }
  if (p?.bio) lines.push(`bio: ${p.bio.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (p?.public_playlists && p.playlists?.length) {
    lines.push(`public playlists: ${p.playlists.slice(0, 8).map((x) => `${x.name} (${x.track_count})`).join(', ')}${p.playlists.length > 8 ? ', …' : ''}`)
  }
  if (p?.public_now_playing) {
    const np = (await apiFetch<{ now_playing: { song: number } | null }>(`/accounts/profile/${id}/np/`).catch(() => null))?.now_playing
    if (np) lines.push(`listening to: ${(await getSong(np.song).catch(() => null))?.name ?? `song #${np.song}`}`)
  }
  return lines.join('\n')
}

const section = (title: string, rows: string[], total = rows.length): string =>
  rows.length ? `${title}\n${rows.map((r) => `  ${r}`).join('\n')}${total > rows.length ? `\n  … ${total - rows.length} more` : ''}` : ''

async function user(args: string, sh: Shell): Promise<void> {
  const q = args.trim().replace(/^@/, '')
  if (!q) fail('usage: user <id | name>')
  const admin = await isAdmin()
  if (/^\d+$/.test(q) && !admin) { sh.print(await describeUser(Number(q), false)); return }
  if (!admin) fail(`user ${q}: looking people up by name needs an administrator account - use their id (user 123)`)
  const hits = matchUsers(await directory(), q)
  if (hits.length === 0) {
    if (/^\d+$/.test(q)) { sh.print(await describeUser(Number(q), true)); return }
    fail(`no user matching "${q}"`)
  }
  const exact = String(hits[0].id) === q || norm(hits[0].username) === norm(q)
  if (hits.length === 1 || exact) { sh.print(await describeUser(hits[0].id, true)); return }
  sh.print(`${hits.slice(0, 25).map((u) => `${String(u.id).padEnd(7)}${u.username.padEnd(22)}${u.discord.padEnd(22)}${u.role}`).join('\n')}\n${hits.length} matches${hits.length > 25 ? ' (showing 25)' : ''} · user <exact name or id> for details`)
}

async function lookup(args: string, sh: Shell): Promise<void> {
  const q = args.trim()
  if (!q) fail('usage: lookup <text>')
  const ql = norm(q)
  const admin = await isAdmin()
  const [songs, playlists, channels, people] = await Promise.all([
    searchSongs(q, 5),
    getToken() ? myPlaylists().catch(() => []) : Promise.resolve([]),
    channelList().catch(() => []),
    admin ? directory().then((d) => matchUsers(d, q)).catch(() => []) : Promise.resolve([]),
  ])
  const pls = playlists.filter((p) => norm(p.name).includes(ql))
  const chans = channels.filter((c) => norm(c.slug).includes(ql) || norm(c.name).includes(ql))
  const commands = sh.commandList().filter((c) => c.name.includes(ql) || c.aliases?.some((a) => a.includes(ql)) || norm(c.description).includes(ql))
  const out = [
    section('People', people.slice(0, 8).map((u) => `${u.username}  #${u.id}   → user ${u.username}`), people.length),
    section('Songs', songs.map((s) => `${s.name}  (${s.era?.name ?? s.category})   → song ${s.name}`)),
    section('Playlists', pls.slice(0, 8).map((p) => `${p.name}  (${p.track_count})   → playlist show ${p.name}`), pls.length),
    section('Channels', chans.map((c) => `${c.slug}  (${c.name})   → cd /${c.slug}`)),
    section('Commands', commands.slice(0, 8).map((c) => `${c.usage}  - ${c.description}`), commands.length),
  ].filter(Boolean)
  sh.print(out.length ? out.join('\n') : `nothing matches "${q}"`, out.length ? 'plain' : 'dim')
}

export const PEOPLE_COMMANDS: Command[] = [
  {
    name: 'user', aliases: ['whois', 'u'], group: 'People', usage: 'user <id | name>',
    description: 'Look someone up: profile, roles, public playlists, what they are listening to. By name needs an administrator account (it searches the account list); anyone can look up an id',
    run: user,
  },
  {
    name: 'lookup', aliases: ['search-all', 'whatis'], group: 'People', usage: 'lookup <text>',
    description: 'Search songs, your playlists, channels, commands and (for administrators) people at once',
    run: lookup,
  },
]
