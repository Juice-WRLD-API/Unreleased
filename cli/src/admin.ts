import { apiFetch } from './api'
import { fail, needAdmin, plural, type Command } from './command'
import type { Shell } from './shell'

// The Admin page's review queues, user list and site moderation list, as in
// the site terminal (lib/terminal/admin.ts). Same endpoints, same standing: an
// account that isn't an administrator is told so up front, and the API refuses
// anything else it isn't allowed. Undoing a change (reverse, siteunban) asks
// first, or takes -y.

type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'reversed'
type ApplicationStatus = 'pending' | 'approved' | 'rejected'

const PROPOSAL_STATUSES: ProposalStatus[] = ['pending', 'approved', 'rejected', 'reversed']
const APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'approved', 'rejected']
const USER_ROLES = ['administrator', 'editor', 'contributor', 'manager', 'applicant']
const LIMIT = 50

type Kind = 'song' | 'comp' | 'app'
const KINDS: Kind[] = ['song', 'comp', 'app']

interface SongEditProposal {
  id: number
  editor_username: string
  change_type: string
  title: string
  proposed_data: Record<string, unknown>
  editor_notes: string
  status: ProposalStatus
  reviewer_username: string | null
  review_notes: string
  created_at: string
}

interface CompFileProposal {
  id: number
  contributor_username: string
  file_path: string
  destination_path: string
  change_type: string
  contributor_notes: string
  status: ProposalStatus
  reviewer_username: string | null
  review_notes: string
  created_at: string
}

interface EditorApplication {
  id: number
  username: string
  discord_username: string
  display_name: string
  contact: string
  experience: string
  motivation: string
  areas: string
  application_type?: string
  status: ApplicationStatus
}

interface AdminUserRow {
  user_id: number
  username: string
  is_active: boolean
  role: string
  contributor_enabled: boolean
  manager_enabled?: boolean
  news_enabled?: boolean
  discord_username: string
  auto_approve_proposals: boolean
  auto_approve_comp_proposals: boolean
  last_login: string | null
}

interface SiteModeration {
  id: number
  user: { id: number; username: string; display_name?: string }
  action: string
  reason: string
  moderator: { id: number; username: string } | null
  expires_at: string | null
}

interface Counts { pending: number }

// ─── API ─────────────────────────────────────────────────────────────────────

const listProposals = (status?: ProposalStatus): Promise<SongEditProposal[]> => apiFetch('/accounts/admin/proposals/', { status })
const listComps = (status?: ProposalStatus): Promise<CompFileProposal[]> => apiFetch('/accounts/admin/comp-proposals/', { status })
const listApplications = (status?: ApplicationStatus): Promise<EditorApplication[]> => apiFetch('/accounts/admin/applications/', { status })
const listSiteModeration = async (): Promise<SiteModeration[]> =>
  (await apiFetch<{ results?: SiteModeration[] } | SiteModeration[]>('/chat/site-moderation/', { active: 'true' }).then((r) => (Array.isArray(r) ? r : r.results ?? [])))

const REVIEW_PATH: Record<Kind, string> = { song: 'proposals', comp: 'comp-proposals', app: 'applications' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const oneLine = (s: string | null | undefined, max = 70): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function statusArg<T extends string>(arg: string, allowed: readonly T[], fallback: T): T {
  const word = arg.trim().toLowerCase()
  if (!word) return fallback
  return allowed.find((a) => a.startsWith(word)) ?? fail(`status must be one of: ${allowed.join(', ')}`)
}

// "approve 12", "approve comp 12 looks good" - the kind is optional (song edit
// proposals are the common case), then the id, then a free-text note. -y is
// taken out first, for the commands that ask.
function parseReviewArgs(args: string, usage: string): { kind: Kind; id: number; notes: string; yes: boolean } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const yes = words[0] === '-y' ? (words.shift(), true) : false
  let kind: Kind = 'song'
  const k = words[0]?.toLowerCase()
  if (k && (KINDS as string[]).includes(k)) { kind = k as Kind; words.shift() } else if (k === 'application' || k === 'applications') { kind = 'app'; words.shift() } else if (k === 'songs') words.shift()
  const id = Number(words.shift()?.replace(/^#/, ''))
  if (!Number.isInteger(id) || id < 1) fail(`usage: ${usage}`)
  return { kind, id, notes: words.join(' '), yes }
}

async function confirm(sh: Shell, question: string, yes: boolean, cmd: string): Promise<boolean> {
  if (yes) return true
  if (!process.stdin.isTTY) fail(`${cmd}: add -y to do this without being asked`)
  const answer = await sh.ask(`${question} [y/N] `)
  if (/^y(es)?$/i.test(answer.trim())) return true
  sh.print('cancelled', 'dim')
  return false
}

async function review(kind: Kind, id: number, action: 'approve' | 'reject', notes: string): Promise<string> {
  const r = await apiFetch<SongEditProposal & CompFileProposal & EditorApplication>(`/accounts/admin/${REVIEW_PATH[kind]}/${id}/review/`, {}, {
    method: 'POST', body: { action, ...(notes ? { review_notes: notes } : {}) },
  })
  if (kind === 'song') return `song proposal #${id} ${r.status}: ${oneLine(r.title)}`
  if (kind === 'comp') return `comp proposal #${id} ${r.status}: ${oneLine(r.file_path)}`
  return `application #${id} ${r.status}: ${oneLine(r.display_name || r.username)}`
}

const kindComplete = (kinds: readonly string[]) => async (arg: string): Promise<string[]> =>
  (/\s/.test(arg.trim()) ? [] : kinds.filter((s) => s.startsWith(arg.trim().toLowerCase())))

const admin = (run: Command['run']): Command['run'] => async (args, sh) => { await needAdmin(); await run(args, sh) }

// ─── The commands ────────────────────────────────────────────────────────────

export const ADMIN_COMMANDS: Command[] = [
  {
    name: 'pending', group: 'Admin', usage: 'pending', description: 'How much is waiting in each review queue',
    run: admin(async (_a, sh) => {
      const [song, comp, apps, mods] = await Promise.allSettled([
        apiFetch<Counts>('/accounts/admin/proposals/', { counts: '1' }),
        apiFetch<Counts>('/accounts/admin/comp-proposals/', { counts: '1' }),
        listApplications('pending'),
        listSiteModeration(),
      ])
      for (const r of [song, comp, apps, mods]) if (r.status === 'rejected' && (r.reason as Error)?.name === 'AbortError') throw r.reason
      const n = <T,>(r: PromiseSettledResult<T>, pick: (v: T) => number): string => (r.status === 'fulfilled' ? String(pick(r.value)) : '?')
      sh.print([
        `song proposals    ${n(song, (v) => v.pending)} pending`,
        `comp proposals    ${n(comp, (v) => v.pending)} pending`,
        `applications      ${n(apps, (v) => v.length)} pending`,
        `site actions      ${n(mods, (v) => v.length)} active`,
      ].join('\n'))
    }),
  },
  {
    name: 'proposals', group: 'Admin', usage: 'proposals [pending|approved|rejected|reversed]', description: 'List song edit proposals (default: pending)',
    complete: kindComplete(PROPOSAL_STATUSES),
    run: admin(async (args, sh) => {
      const status = statusArg(args, PROPOSAL_STATUSES, 'pending')
      const list = await listProposals(status)
      if (list.length === 0) { sh.print(`no ${status} song proposals`, 'dim'); return }
      const rows = list.slice(0, LIMIT).map((p) => `#${String(p.id).padEnd(6)}${p.change_type.padEnd(8)}${oneLine(p.title, 46).padEnd(48)}${p.editor_username}  ${relativeTime(p.created_at)}`)
      sh.print(`${rows.join('\n')}${list.length > LIMIT ? `\n… ${list.length - LIMIT} more` : ''}\n${list.length} ${status} · inspect <id> · approve <id> · reject <id> [note]`)
    }),
  },
  {
    name: 'comps', group: 'Admin', usage: 'comps [pending|approved|rejected|reversed]', description: 'List comp file proposals (default: pending)',
    complete: kindComplete(PROPOSAL_STATUSES),
    run: admin(async (args, sh) => {
      const status = statusArg(args, PROPOSAL_STATUSES, 'pending')
      const list = await listComps(status)
      if (list.length === 0) { sh.print(`no ${status} comp proposals`, 'dim'); return }
      const rows = list.slice(0, LIMIT).map((p) => `#${String(p.id).padEnd(6)}${String(p.change_type).padEnd(10)}${oneLine(p.file_path, 46).padEnd(48)}${p.contributor_username}  ${relativeTime(p.created_at)}`)
      sh.print(`${rows.join('\n')}${list.length > LIMIT ? `\n… ${list.length - LIMIT} more` : ''}\n${list.length} ${status} · inspect comp <id> · approve comp <id> · reject comp <id> [note]`)
    }),
  },
  {
    name: 'applications', aliases: ['apps'], group: 'Admin', usage: 'applications [pending|approved|rejected]', description: 'List editor and contributor applications (default: pending)',
    complete: kindComplete(APPLICATION_STATUSES),
    run: admin(async (args, sh) => {
      const status = statusArg(args, APPLICATION_STATUSES, 'pending')
      const list = await listApplications(status)
      if (list.length === 0) { sh.print(`no ${status} applications`, 'dim'); return }
      sh.print(`${list.slice(0, LIMIT).map((a) => `#${String(a.id).padEnd(6)}${String(a.application_type ?? 'editor').padEnd(13)}${oneLine(a.display_name || a.username, 28).padEnd(30)}${a.discord_username || ''}`).join('\n')}\n${list.length} ${status} · inspect app <id> · approve app <id> · reject app <id> [note]`)
    }),
  },
  {
    name: 'inspect', group: 'Admin', usage: 'inspect [song|comp|app] <id>', description: 'Show one proposal or application in full',
    complete: kindComplete(KINDS),
    run: admin(async (args, sh) => {
      const { kind, id } = parseReviewArgs(args, 'inspect [song|comp|app] <id>')
      if (kind === 'song') {
        const p = (await listProposals()).find((x) => x.id === id)
          ?? (await Promise.all(PROPOSAL_STATUSES.slice(1).map((s) => listProposals(s)))).flat().find((x) => x.id === id)
          ?? fail(`no song proposal #${id}`)
        sh.print([
          `#${p.id} ${p.change_type} · ${p.status} · ${p.title}`,
          `by ${p.editor_username}, ${relativeTime(p.created_at)}${p.reviewer_username ? ` · reviewed by ${p.reviewer_username}` : ''}`,
          ...(p.editor_notes ? [`notes: ${oneLine(p.editor_notes, 300)}`] : []),
          ...(p.review_notes ? [`review: ${oneLine(p.review_notes, 300)}`] : []),
          'changes:',
          // A terminal has room for the whole change set, one field a line.
          ...Object.entries(p.proposed_data ?? {}).map(([k, v]) => `  ${k}: ${oneLine(typeof v === 'string' ? v : JSON.stringify(v), 200)}`),
        ].join('\n'))
      } else if (kind === 'comp') {
        const p = (await Promise.all(PROPOSAL_STATUSES.map((s) => listComps(s)))).flat().find((x) => x.id === id) ?? fail(`no comp proposal #${id}`)
        sh.print([
          `#${p.id} ${p.change_type} · ${p.status}`,
          `${p.file_path}${p.destination_path ? ` → ${p.destination_path}` : ''}`,
          `by ${p.contributor_username}, ${relativeTime(p.created_at)}${p.reviewer_username ? ` · reviewed by ${p.reviewer_username}` : ''}`,
          ...(p.contributor_notes ? [`notes: ${oneLine(p.contributor_notes, 300)}`] : []),
          ...(p.review_notes ? [`review: ${oneLine(p.review_notes, 300)}`] : []),
        ].join('\n'))
      } else {
        const a = (await Promise.all(APPLICATION_STATUSES.map((s) => listApplications(s)))).flat().find((x) => x.id === id) ?? fail(`no application #${id}`)
        sh.print([
          `#${a.id} ${a.application_type ?? 'editor'} · ${a.status}`,
          `${a.display_name || a.username} (${a.username})${a.discord_username ? ` · discord ${a.discord_username}` : ''}${a.contact ? ` · ${a.contact}` : ''}`,
          `areas: ${oneLine(a.areas, 200)}`,
          `experience: ${oneLine(a.experience, 300)}`,
          `motivation: ${oneLine(a.motivation, 300)}`,
        ].join('\n'))
      }
    }),
  },
  {
    name: 'approve', group: 'Admin', usage: 'approve [song|comp|app] <id> [note]', description: 'Approve a proposal or application',
    complete: kindComplete(KINDS),
    run: admin(async (args, sh) => { const r = parseReviewArgs(args, 'approve [song|comp|app] <id> [note]'); sh.print(await review(r.kind, r.id, 'approve', r.notes), 'ok') }),
  },
  {
    name: 'reject', group: 'Admin', usage: 'reject [song|comp|app] <id> [note]', description: 'Reject a proposal or application, optionally saying why',
    complete: kindComplete(KINDS),
    run: admin(async (args, sh) => { const r = parseReviewArgs(args, 'reject [song|comp|app] <id> [note]'); sh.print(await review(r.kind, r.id, 'reject', r.notes), 'ok') }),
  },
  {
    name: 'reverse', group: 'Admin', usage: 'reverse [-y] [song|comp] <id>', description: 'Undo an approved proposal (asks first unless -y)',
    complete: kindComplete(['song', 'comp']),
    run: admin(async (args, sh) => {
      const { kind, id, yes } = parseReviewArgs(args, 'reverse [-y] [song|comp] <id>')
      if (kind === 'app') fail('applications can’t be reversed')
      if (!(await confirm(sh, `Reverse ${kind} proposal #${id}? This undoes the change it made.`, yes, 'reverse'))) return
      await apiFetch(`/accounts/admin/${REVIEW_PATH[kind]}/${id}/reverse/`, {}, { method: 'POST' })
      sh.print(`${kind} proposal #${id} reversed`, 'ok')
    }),
  },
  {
    name: 'users', group: 'Admin', usage: 'users [role] [filter]', description: 'List accounts, optionally by role (administrator, editor, contributor, manager, applicant) and a name filter. See one with: user <name>',
    complete: kindComplete(USER_ROLES),
    run: admin(async (args, sh) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const role = USER_ROLES.includes(words[0]?.toLowerCase()) ? words.shift()!.toLowerCase() : undefined
      const filter = words.join(' ').toLowerCase()
      let list = await apiFetch<AdminUserRow[]>('/accounts/admin/users/', { role })
      if (filter) list = list.filter((u) => u.username.toLowerCase().includes(filter) || u.discord_username?.toLowerCase().includes(filter))
      if (list.length === 0) { sh.print('no matching users', 'dim'); return }
      list = [...list].sort((a, b) => a.username.localeCompare(b.username))
      const flags = (u: AdminUserRow): string => [
        u.contributor_enabled ? 'contrib' : '', u.manager_enabled ? 'mgr' : '', u.news_enabled ? 'news' : '',
        u.auto_approve_proposals ? 'auto-edits' : '', u.auto_approve_comp_proposals ? 'auto-comp' : '', u.is_active ? '' : 'DISABLED',
      ].filter(Boolean).join(',')
      sh.print(`${list.slice(0, LIMIT).map((u) => `${String(u.user_id).padEnd(7)}${u.username.padEnd(22)}${u.role.padEnd(15)}${relativeTime(u.last_login).padEnd(12)}${flags(u)}`).join('\n')}\n${list.length > LIMIT ? `… ${list.length - LIMIT} more · ` : ''}${plural(list.length, 'user')}`)
    }),
  },
  {
    name: 'sitebans', aliases: ['modlog'], group: 'Admin', usage: 'sitebans', description: 'Active site-wide bans, mutes and timeouts. Lift one with: siteunban <user>',
    run: admin(async (_a, sh) => {
      const active = await listSiteModeration()
      if (active.length === 0) { sh.print('no active site-wide actions', 'dim'); return }
      sh.print(active.map((r) => `#${String(r.id).padEnd(6)}${r.action.padEnd(8)}${(r.user.display_name || r.user.username).padEnd(22)}${r.expires_at ? `until ${new Date(r.expires_at).toLocaleString()}` : 'until revoked'}${r.reason ? `  - ${oneLine(r.reason, 60)}` : ''}${r.moderator ? `  (by ${r.moderator.username})` : ''}`).join('\n'))
    }),
  },
  {
    name: 'siteunban', aliases: ['siteunmute'], group: 'Admin', usage: 'siteunban [-y] <user | #id>',
    description: 'Lift a site-wide ban, mute or timeout: by username (every active one they have) or by the #id sitebans shows. Asks first unless -y',
    run: admin(async (args, sh) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const yes = words[0] === '-y' ? (words.shift(), true) : false
      const target = words.join(' ').replace(/^@/, '')
      if (!target) fail('usage: siteunban [-y] <user | #id>')
      const active = await listSiteModeration()
      const byId = /^#(\d+)$/.exec(target)
      const hits = byId
        ? active.filter((r) => r.id === Number(byId[1]))
        : active.filter((r) => r.user.username.toLowerCase() === target.toLowerCase() || String(r.user.id) === target)
      if (hits.length === 0) fail(`no active site-wide action ${byId ? `#${byId[1]}` : `for ${target}`} (see: sitebans)`)
      const what = hits.map((r) => `${r.action} on ${r.user.username}`).join(', ')
      if (!(await confirm(sh, `Lift ${what}?`, yes, 'siteunban'))) return
      for (const r of hits) await apiFetch(`/chat/site-moderation/${r.id}/`, {}, { method: 'DELETE' })
      sh.print(`lifted ${what}`, 'ok')
    }),
  },
]
