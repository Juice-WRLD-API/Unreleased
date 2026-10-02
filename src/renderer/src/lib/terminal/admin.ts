import { relativeTime } from '../../components/adminShared'
import { useChatStore } from '../../store/chatStore'
import { listSiteModeration } from '../chatApi'
import {
  adminCompProposalCounts, adminListApplications, adminListCompProposals, adminListProposals, adminListUsers,
  adminProposalCounts, adminReverseCompProposal, adminReverseProposal, adminReviewApplication, adminReviewCompProposal,
  adminReviewProposal, type ApplicationStatus, type ProposalStatus,
} from '../userApi'
import { fail, type TermCommand } from './types'

// The Admin page's review queues, user list and site moderation list, as
// commands. They call the same endpoints the Admin page does and need the same
// standing, so a non-admin account just gets the API's own refusal.
const PROPOSAL_STATUSES: ProposalStatus[] = ['pending', 'approved', 'rejected', 'reversed']
const APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'approved', 'rejected']
const USER_ROLES = ['administrator', 'editor', 'contributor', 'manager', 'applicant']
const LIMIT = 50

type Kind = 'song' | 'comp' | 'app'
const KINDS: Kind[] = ['song', 'comp', 'app']

const oneLine = (s: string | null | undefined, max = 70): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function statusArg(arg: string, allowed: readonly string[], fallback: string): string {
  const word = arg.trim().toLowerCase()
  if (!word) return fallback
  const hit = allowed.find((a) => a.startsWith(word))
  return hit ?? fail(`status must be one of: ${allowed.join(', ')}`)
}

// "approve 12", "approve comp 12 looks good" - the kind is optional (song edit
// proposals are the common case), then the id, then a free-text note.
function parseReviewArgs(args: string, usage: string): { kind: Kind; id: number; notes: string } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  let kind: Kind = 'song'
  const k = words[0]?.toLowerCase()
  if (k && (KINDS as string[]).includes(k)) { kind = k as Kind; words.shift() } else if (k === 'application' || k === 'applications') { kind = 'app'; words.shift() } else if (k === 'songs') words.shift()
  const id = Number(words.shift())
  if (!Number.isInteger(id) || id < 1) fail(`usage: ${usage}`)
  return { kind, id, notes: words.join(' ') }
}

async function review(kind: Kind, id: number, action: 'approve' | 'reject', notes: string): Promise<string> {
  const review_notes = notes || undefined
  if (kind === 'song') { const r = await adminReviewProposal(id, { action, review_notes }); return `song proposal #${id} ${r.status}: ${oneLine(r.title)}` }
  if (kind === 'comp') { const r = await adminReviewCompProposal(id, { action, review_notes }); return `comp proposal #${id} ${r.status}: ${oneLine(r.file_path)}` }
  const r = await adminReviewApplication(id, { action, review_notes })
  return `application #${id} ${r.status}: ${oneLine(r.display_name || r.username)}`
}

export const ADMIN_COMMANDS: TermCommand[] = [
  {
    name: 'pending', group: 'Admin', usage: 'pending', description: 'How much is waiting in each review queue',
    run: async (_a, ctx) => {
      const [song, comp, apps, mods] = await Promise.allSettled([
        adminProposalCounts(), adminCompProposalCounts(), adminListApplications('pending'), listSiteModeration({ activeOnly: true }),
      ])
      const n = <T,>(r: PromiseSettledResult<T>, pick: (v: T) => number): string => (r.status === 'fulfilled' ? String(pick(r.value)) : '?')
      ctx.print([
        `song proposals    ${n(song, (v) => v.pending)} pending`,
        `comp proposals    ${n(comp, (v) => v.pending)} pending`,
        `applications      ${n(apps, (v) => v.length)} pending`,
        `site actions      ${n(mods, (v) => v.length)} active`,
      ].join('\n'))
    },
  },
  {
    name: 'proposals', group: 'Admin', usage: 'proposals [pending|approved|rejected|reversed]', description: 'List song edit proposals (default: pending)',
    complete: (before, partial) => (before.length === 0 ? PROPOSAL_STATUSES.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const status = statusArg(args, PROPOSAL_STATUSES, 'pending') as ProposalStatus
      const list = await adminListProposals(status)
      if (list.length === 0) { ctx.print(`no ${status} song proposals`, 'dim'); return }
      const rows = list.slice(0, LIMIT).map((p) => `#${String(p.id).padEnd(6)}${p.change_type.padEnd(8)}${oneLine(p.title, 46).padEnd(48)}${p.editor_username}  ${relativeTime(p.created_at)}`)
      ctx.print(`${rows.join('\n')}${list.length > LIMIT ? `\n… ${list.length - LIMIT} more` : ''}\n${list.length} ${status} · inspect <id> · approve <id> · reject <id> [note]`)
    },
  },
  {
    name: 'comps', group: 'Admin', usage: 'comps [pending|approved|rejected|reversed]', description: 'List comp file proposals (default: pending)',
    complete: (before, partial) => (before.length === 0 ? PROPOSAL_STATUSES.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const status = statusArg(args, PROPOSAL_STATUSES, 'pending') as ProposalStatus
      const list = await adminListCompProposals(status)
      if (list.length === 0) { ctx.print(`no ${status} comp proposals`, 'dim'); return }
      const rows = list.slice(0, LIMIT).map((p) => `#${String(p.id).padEnd(6)}${String(p.change_type).padEnd(10)}${oneLine(p.file_path, 46).padEnd(48)}${p.contributor_username}  ${relativeTime(p.created_at)}`)
      ctx.print(`${rows.join('\n')}${list.length > LIMIT ? `\n… ${list.length - LIMIT} more` : ''}\n${list.length} ${status} · inspect comp <id> · approve comp <id> · reject comp <id> [note]`)
    },
  },
  {
    name: 'applications', aliases: ['apps'], group: 'Admin', usage: 'applications [pending|approved|rejected]', description: 'List editor and contributor applications (default: pending)',
    complete: (before, partial) => (before.length === 0 ? APPLICATION_STATUSES.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const status = statusArg(args, APPLICATION_STATUSES, 'pending') as ApplicationStatus
      const list = await adminListApplications(status)
      if (list.length === 0) { ctx.print(`no ${status} applications`, 'dim'); return }
      ctx.print(`${list.slice(0, LIMIT).map((a) => `#${String(a.id).padEnd(6)}${String(a.application_type ?? 'editor').padEnd(13)}${oneLine(a.display_name || a.username, 28).padEnd(30)}${a.discord_username || ''}`).join('\n')}\n${list.length} ${status} · inspect app <id> · approve app <id> · reject app <id> [note]`)
    },
  },
  {
    name: 'inspect', group: 'Admin', usage: 'inspect [song|comp|app] <id>', description: 'Show one proposal or application in full',
    complete: (before, partial) => (before.length === 0 ? KINDS.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { kind, id } = parseReviewArgs(args, 'inspect [song|comp|app] <id>')
      if (kind === 'song') {
        const p = (await adminListProposals()).find((x) => x.id === id) ?? (await Promise.all(PROPOSAL_STATUSES.slice(1).map((s) => adminListProposals(s)))).flat().find((x) => x.id === id) ?? fail(`no song proposal #${id}`)
        ctx.print([
          `#${p.id} ${p.change_type} · ${p.status} · ${p.title}`,
          `by ${p.editor_username}, ${relativeTime(p.created_at)}${p.reviewer_username ? ` · reviewed by ${p.reviewer_username}` : ''}`,
          ...(p.editor_notes ? [`notes: ${oneLine(p.editor_notes, 300)}`] : []),
          ...(p.review_notes ? [`review: ${oneLine(p.review_notes, 300)}`] : []),
          `changes: ${oneLine(JSON.stringify(p.proposed_data), 600)}`,
        ].join('\n'))
      } else if (kind === 'comp') {
        const p = (await Promise.all(PROPOSAL_STATUSES.map((s) => adminListCompProposals(s)))).flat().find((x) => x.id === id) ?? fail(`no comp proposal #${id}`)
        ctx.print([
          `#${p.id} ${p.change_type} · ${p.status}`,
          `${p.file_path}${p.destination_path ? ` → ${p.destination_path}` : ''}`,
          `by ${p.contributor_username}, ${relativeTime(p.created_at)}${p.reviewer_username ? ` · reviewed by ${p.reviewer_username}` : ''}`,
          ...(p.contributor_notes ? [`notes: ${oneLine(p.contributor_notes, 300)}`] : []),
          ...(p.review_notes ? [`review: ${oneLine(p.review_notes, 300)}`] : []),
        ].join('\n'))
      } else {
        const a = (await Promise.all(APPLICATION_STATUSES.map((s) => adminListApplications(s)))).flat().find((x) => x.id === id) ?? fail(`no application #${id}`)
        ctx.print([
          `#${a.id} ${a.application_type ?? 'editor'} · ${a.status}`,
          `${a.display_name || a.username} (${a.username})${a.discord_username ? ` · discord ${a.discord_username}` : ''}${a.contact ? ` · ${a.contact}` : ''}`,
          `areas: ${oneLine(a.areas, 200)}`,
          `experience: ${oneLine(a.experience, 300)}`,
          `motivation: ${oneLine(a.motivation, 300)}`,
        ].join('\n'))
      }
    },
  },
  {
    name: 'approve', group: 'Admin', usage: 'approve [song|comp|app] <id> [note]', description: 'Approve a proposal or application',
    complete: (before, partial) => (before.length === 0 ? KINDS.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => { const r = parseReviewArgs(args, 'approve [song|comp|app] <id> [note]'); ctx.print(await review(r.kind, r.id, 'approve', r.notes), 'ok') },
  },
  {
    name: 'reject', group: 'Admin', usage: 'reject [song|comp|app] <id> [note]', description: 'Reject a proposal or application, optionally saying why',
    complete: (before, partial) => (before.length === 0 ? KINDS.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => { const r = parseReviewArgs(args, 'reject [song|comp|app] <id> [note]'); ctx.print(await review(r.kind, r.id, 'reject', r.notes), 'ok') },
  },
  {
    name: 'reverse', group: 'Admin', usage: 'reverse [song|comp] <id>', description: 'Undo an approved proposal',
    complete: (before, partial) => (before.length === 0 ? ['song', 'comp'].filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { kind, id } = parseReviewArgs(args, 'reverse [song|comp] <id>')
      if (kind === 'app') fail('applications can’t be reversed')
      if (!window.confirm(`Reverse ${kind} proposal #${id}? This undoes the change it made.`)) { ctx.print('cancelled', 'dim'); return }
      if (kind === 'song') await adminReverseProposal(id)
      else await adminReverseCompProposal(id)
      ctx.print(`${kind} proposal #${id} reversed`, 'ok')
    },
  },
  {
    name: 'users', group: 'Admin', usage: 'users [role] [filter]', description: 'List accounts, optionally by role (administrator, editor, contributor, manager, applicant) and a name filter. See one with: role @user',
    complete: (before, partial) => (before.length === 0 ? USER_ROLES.filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const role = USER_ROLES.includes(words[0]?.toLowerCase()) ? words.shift()!.toLowerCase() : undefined
      const filter = words.join(' ').toLowerCase()
      let list = await adminListUsers(role)
      if (filter) list = list.filter((u) => u.username.toLowerCase().includes(filter) || u.discord_username?.toLowerCase().includes(filter))
      if (list.length === 0) { ctx.print('no matching users', 'dim'); return }
      list = [...list].sort((a, b) => a.username.localeCompare(b.username))
      const flags = (u: (typeof list)[number]): string => [
        u.contributor_enabled ? 'contrib' : '', u.manager_enabled ? 'mgr' : '', u.news_enabled ? 'news' : '',
        u.auto_approve_proposals ? 'auto-edits' : '', u.auto_approve_comp_proposals ? 'auto-comp' : '', u.is_active ? '' : 'DISABLED',
      ].filter(Boolean).join(',')
      ctx.print(`${list.slice(0, LIMIT).map((u) => `${String(u.user_id).padEnd(7)}${u.username.padEnd(22)}${u.role.padEnd(13)}${relativeTime(u.last_login).padEnd(12)}${flags(u)}`).join('\n')}\n${list.length > LIMIT ? `… ${list.length - LIMIT} more · ` : ''}${list.length} user${list.length === 1 ? '' : 's'}`)
    },
  },
  {
    name: 'sitebans', aliases: ['modlog'], group: 'Admin', usage: 'sitebans', description: 'Active site-wide bans, mutes and timeouts. Lift one with: siteunban @user',
    run: async (_a, ctx) => {
      const active = await listSiteModeration({ activeOnly: true })
      if (active.length === 0) { ctx.print('no active site-wide actions', 'dim'); return }
      const me = useChatStore.getState().me
      ctx.print(active.map((r) => `${r.action.padEnd(8)}${(r.user.display_name || r.user.username).padEnd(22)}${r.expires_at ? `until ${new Date(r.expires_at).toLocaleString()}` : 'until revoked'}${r.reason ? `  - ${oneLine(r.reason, 60)}` : ''}${r.moderator && r.moderator.id !== me?.id ? `  (by ${r.moderator.username})` : ''}`).join('\n'))
    },
  },
]
