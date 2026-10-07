import { relativeTime } from '../../components/adminShared'
import { fetchCompChanges, fetchTrackerChanges } from '../changesApi'
import { COMP_CHUNK_THRESHOLD, createCompProposalChunked } from '../compChunkedUpload'
import { loadSessionEditFiles, loadSessionEditLinks } from '../sessionEditsApi'
import { useStore } from '../../store/useStore'
import {
  adminCompFileHistory, adminFetchCompProposalStaging, compChangeTypeLabel, createCompProposal, createCompProposalUpload, createProposal,
  getLeaderboard, getMyApplication, getMyCompProposals, getMyProposals, resubmitProposal, submitApplication, updateCompProposal,
  updateProposal, withdrawCompProposal, withdrawProposal, type ApplicationType, type CompProposalChangeType, type ProposalChangeType,
} from '../userApi'
import { pickLocalFile, saveBlob } from './pick'
import { pageLines } from './more'
import { completeSongs, songFromArg } from './player'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, parseJsonArg, table, type TermCommand, type TermCtx } from './types'

// The editor and contributor side of the site: song-edit proposals, comp file
// proposals, applying for a role, the leaderboard, the change feeds and the
// session-edit index. The API decides who may do what; these only need sign-in.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const signedIn = (): void => { if (!st().account) fail('sign in first (login)') }
const BODY_HINT = 'JSON of the fields to change, e.g. {"name":"New title"} (field names are in the API docs, editor workflow)'

// Everything from the first "{" is a JSON body; what's before it is words and flags.
function splitBody(args: string): { head: string; body: Record<string, unknown> | null } {
  const at = args.indexOf('{')
  if (at < 0) return { head: args, body: null }
  const parsed = parseJsonArg(args.slice(at), BODY_HINT)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('the body must be a JSON object')
  return { head: args.slice(0, at), body: parsed as Record<string, unknown> }
}

const PROPOSAL_TYPES: ProposalChangeType[] = ['create', 'update', 'delete']
const COMP_TYPES: CompProposalChangeType[] = ['upload', 'replace', 'move', 'delete', 'create_folder', 'rename_folder', 'move_folder', 'delete_folder']
const NEEDS_FILE = new Set<CompProposalChangeType>(['upload', 'replace'])
const NEEDS_DESTINATION = new Set<CompProposalChangeType>(['move', 'rename_folder', 'move_folder'])

const proposalCommand: TermCommand = {
  name: 'proposal', aliases: ['edits'], group: 'Editor',
  usage: 'proposal [ls] · new <create|update|delete> [song] [{json}] [--title t] [--note n] · edit <id> [{json}] [--title t] [--note n] · withdraw <id> · resubmit <id>   (--channel c)',
  description: 'Your song-edit proposals: list, create, change, withdraw or resubmit one. The JSON body is the fields you propose, e.g. proposal new update <song> {"name":"New title"}',
  covers: ['userApi.getMyProposals', 'userApi.createProposal', 'userApi.updateProposal', 'userApi.withdrawProposal', 'userApi.resubmitProposal'],
  complete: (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return ['ls', 'new', 'edit', 'withdraw', 'resubmit'].filter((v) => v.startsWith(p))
    if (before[0] === 'new' && before.length === 1) return PROPOSAL_TYPES.filter((v) => v.startsWith(p))
    if (before[0] === 'new' && before[1] !== 'create') return completeSongs(before.slice(2), partial)
    return []
  },
  run: async (args, ctx) => {
    signedIn()
    const { head, body } = splitBody(args)
    const { rest, bool, value } = parseArgs(head, ['title', 'note', 'channel'])
    const channel = value.get('channel')
    const sub = (rest.shift() ?? 'ls').toLowerCase()

    if (sub === 'ls' || sub === 'list') {
      const list = await getMyProposals(channel)
      if (asJson(ctx, bool.has('json'), list)) return
      if (list.length === 0) { ctx.print('no proposals yet', 'dim'); return }
      ctx.print(`${table(list.map((p) => [`#${p.id}`, p.status, p.change_type, p.title, relativeTime(p.created_at)]))}\n${list.length} proposal${list.length === 1 ? '' : 's'}`)
    } else if (sub === 'new') {
      const type = (rest.shift() ?? '').toLowerCase() as ProposalChangeType
      if (!PROPOSAL_TYPES.includes(type)) fail('usage: proposal new <create|update|delete> [song] [{json}]')
      let song: number | null = null
      let title = value.get('title')
      if (type !== 'create') {
        if (rest.length === 0) fail(`usage: proposal new ${type} <song>${type === 'update' ? ' {json}' : ''}`)
        const s = await songFromArg(rest.join(' '))
        song = s.id
        title ??= s.name
      }
      if (type !== 'delete' && !body) fail(`usage: proposal new ${type}${type === 'update' ? ' <song>' : ''} {json}  - ${BODY_HINT}`)
      const made = await createProposal({ song, change_type: type, title, proposed_data: body ?? {}, editor_notes: value.get('note'), channel })
      ctx.print(`proposal #${made.id} sent (${made.status}): ${oneLine(made.title)}`, 'ok')
    } else if (sub === 'edit') {
      const id = idArg(rest[0], 'proposal edit <id> [{json}] [--title t] [--note n]')
      const patch = { title: value.get('title'), proposed_data: body ?? undefined, editor_notes: value.get('note') }
      if (patch.title === undefined && !patch.proposed_data && patch.editor_notes === undefined) fail('nothing to change - give a {json} body, --title or --note')
      const p = await updateProposal(id, patch)
      ctx.print(`proposal #${p.id} updated (${p.status}, edited ${p.edit_count}×)`, 'ok')
    } else if (sub === 'withdraw') {
      const id = idArg(rest[0], 'proposal withdraw <id>')
      if (!confirmAction(ctx, `Withdraw proposal #${id}?`, bool.has('y'))) return
      await withdrawProposal(id)
      ctx.print(`proposal #${id} withdrawn`, 'ok')
    } else if (sub === 'resubmit') {
      const id = idArg(rest[0], 'proposal resubmit <id>')
      const mine = (await getMyProposals(channel)).find((p) => p.id === id) ?? fail(`#${id} isn’t one of your proposals`)
      if (!confirmAction(ctx, `Withdraw #${id} and send it again as a new proposal?`, bool.has('y'))) return
      const made = await resubmitProposal(mine)
      ctx.print(`#${id} resubmitted as #${made.id}`, 'ok')
    } else fail('usage: proposal [ls | new | edit | withdraw | resubmit] …')
  },
}

// Prints upload progress a quarter at a time - a terminal can't redraw a bar.
function progressPrinter(ctx: TermCtx, label: string): (sent: number, total: number) => void {
  let shown = 0
  return (sent, total) => {
    const pct = total > 0 ? Math.floor((sent / total) * 4) * 25 : 0
    if (pct > shown && pct < 100) { shown = pct; ctx.print(`${label} ${pct}%`, 'dim') }
  }
}

const compCommand: TermCommand = {
  name: 'comp', group: 'Editor',
  usage: 'comp [ls] · new <type> <path> [--to dest] [--note n] · edit <id> [--path p] [--to dest] [--note n] [--file] · withdraw <id> · staging <id> · history <path>   (--channel c)',
  description: `Your comp file proposals (changes to the Files tab): types ${COMP_TYPES.join(', ')}. upload/replace open a file picker. staging and history are for reviewers`,
  covers: [
    'userApi.getMyCompProposals', 'userApi.createCompProposal', 'userApi.createCompProposalUpload', 'userApi.updateCompProposal', 'userApi.withdrawCompProposal',
    'userApi.adminFetchCompProposalStaging', 'userApi.adminCompFileHistory', 'compChunkedUpload.createCompProposalChunked',
  ],
  complete: (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return ['ls', 'new', 'edit', 'withdraw', 'staging', 'history'].filter((v) => v.startsWith(p))
    if (before[0] === 'new' && before.length === 1) return COMP_TYPES.filter((v) => v.startsWith(p))
    return []
  },
  run: async (args, ctx) => {
    signedIn()
    const { rest, bool, value } = parseArgs(args, ['to', 'note', 'channel', 'path'])
    const channel = value.get('channel')
    const sub = (rest.shift() ?? 'ls').toLowerCase()

    if (sub === 'ls' || sub === 'list') {
      const list = await getMyCompProposals(channel)
      if (asJson(ctx, bool.has('json'), list)) return
      if (list.length === 0) { ctx.print('no comp proposals yet', 'dim'); return }
      ctx.print(`${table(list.map((p) => [`#${p.id}`, p.status, compChangeTypeLabel(p.change_type), p.file_path, relativeTime(p.created_at)]))}\n${list.length} proposal${list.length === 1 ? '' : 's'}`)
    } else if (sub === 'new') {
      const type = (rest.shift() ?? '').toLowerCase() as CompProposalChangeType
      const path = rest.join(' ')
      if (!COMP_TYPES.includes(type) || !path) fail(`usage: comp new <${COMP_TYPES.join('|')}> <path> [--to dest] [--note n]`)
      const dest = value.get('to')
      if (NEEDS_DESTINATION.has(type) && !dest) fail(`${type} needs a destination: --to <path>`)
      const metadata = { change_type: type, file_path: path, destination_path: NEEDS_DESTINATION.has(type) ? dest : undefined, contributor_notes: value.get('note') ?? '', channel }
      if (NEEDS_FILE.has(type)) {
        const file = await pickLocalFile('*/*')
        ctx.print(`uploading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`, 'dim')
        const onProgress = progressPrinter(ctx, file.name)
        const form = new FormData()
        form.append('file_path', path)
        if (metadata.destination_path) form.append('destination_path', metadata.destination_path)
        form.append('change_type', type)
        form.append('contributor_notes', metadata.contributor_notes)
        form.append('file', file)
        if (channel) form.append('channel', channel)
        // Big files go up in chunks, small ones in one request - the same split the Files tab makes.
        const upload = file.size >= COMP_CHUNK_THRESHOLD ? createCompProposalChunked(file, metadata, { onProgress }) : createCompProposalUpload(form, { onProgress })
        ctx.signal.addEventListener('abort', upload.abort, { once: true })
        const made = await upload.promise
        ctx.print(`comp proposal #${made.id} sent (${made.status}): ${compChangeTypeLabel(made.change_type)} ${made.file_path}`, 'ok')
        return
      }
      const form = new FormData()
      form.append('file_path', path)
      if (metadata.destination_path) form.append('destination_path', metadata.destination_path)
      form.append('change_type', type)
      form.append('contributor_notes', metadata.contributor_notes)
      if (channel) form.append('channel', channel)
      const made = await createCompProposal(form)
      ctx.print(`comp proposal #${made.id} sent (${made.status}): ${compChangeTypeLabel(made.change_type)} ${made.file_path}`, 'ok')
    } else if (sub === 'edit') {
      const id = idArg(rest[0], 'comp edit <id> [--path p] [--to dest] [--note n] [--file]')
      const form = new FormData()
      if (value.has('path')) form.append('file_path', value.get('path') as string)
      if (value.has('to')) form.append('destination_path', value.get('to') as string)
      if (value.has('note')) form.append('contributor_notes', value.get('note') as string)
      if (bool.has('file')) form.append('file', await pickLocalFile('*/*'))
      if (channel) form.append('channel', channel)
      if ([...form.keys()].every((k) => k === 'channel')) fail('nothing to change - give --path, --to, --note or --file')
      const p = await updateCompProposal(id, form)
      ctx.print(`comp proposal #${p.id} updated (${p.status}, edited ${p.edit_count}×)`, 'ok')
    } else if (sub === 'withdraw') {
      const id = idArg(rest[0], 'comp withdraw <id>')
      if (!confirmAction(ctx, `Withdraw comp proposal #${id}?`, bool.has('y'))) return
      await withdrawCompProposal(id)
      ctx.print(`comp proposal #${id} withdrawn`, 'ok')
    } else if (sub === 'staging') {
      const id = idArg(rest[0], 'comp staging <id>')
      const blob = await adminFetchCompProposalStaging(id, channel, ctx.signal)
      const name = `proposal-${id}-staged`
      saveBlob(blob, name)
      ctx.print(`saved ${name} (${(blob.size / 1048576).toFixed(2)} MB) to your downloads`, 'ok')
    } else if (sub === 'history') {
      const path = rest.join(' ')
      if (!path) fail('usage: comp history <path>')
      const h = await adminCompFileHistory(path, channel)
      if (asJson(ctx, bool.has('json'), h)) return
      if (h.revisions.length === 0) { ctx.print('no revisions', 'dim'); return }
      ctx.print(table(h.revisions.map((r) => [r.is_current ? '*' : ' ', r.commit_id.slice(0, 8), `${(r.size / 1024).toFixed(0)} KB`, r.proposal_id ? `proposal #${r.proposal_id}` : '', relativeTime(r.created_at)])))
    } else fail('usage: comp [ls | new | edit | withdraw | staging | history] …')
  },
}

export const EDITING_COMMANDS: TermCommand[] = [
  proposalCommand,
  compCommand,
  {
    name: 'apply', group: 'Editor', usage: 'apply [status] <editor|contributor> [--motivation "…"] [--experience "…"] [--areas "…"] [--contact "…"] [--name "…"] [--channel c]',
    description: 'Apply to become an editor or contributor, or check the state of your application (apply status editor)',
    covers: ['userApi.getMyApplication', 'userApi.submitApplication'],
    complete: (before, partial) => (before.length === 0 ? ['status', 'editor', 'contributor'].filter((v) => v.startsWith(partial.toLowerCase())) : before.length === 1 && before[0] === 'status' ? ['editor', 'contributor'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      signedIn()
      const { rest, value } = parseArgs(args, ['motivation', 'experience', 'areas', 'contact', 'name', 'channel'])
      const status = rest[0]?.toLowerCase() === 'status'
      if (status) rest.shift()
      const type = (rest[0] ?? '').toLowerCase() as ApplicationType
      if (type !== 'editor' && type !== 'contributor') fail('usage: apply [status] <editor|contributor> --motivation "why you want in"')
      if (status) {
        const { application: a } = await getMyApplication(type, value.get('channel'))
        ctx.print(a ? `${type} application #${a.id}: ${a.status}${a.review_notes ? `\nreviewer: ${oneLine(a.review_notes, 200)}` : ''}\nsent ${relativeTime(a.created_at)}` : `no ${type} application yet`, a ? 'plain' : 'dim')
        return
      }
      const motivation = value.get('motivation') ?? fail('--motivation "…" is required')
      const made = await submitApplication({ application_type: type, motivation, experience: value.get('experience'), areas: value.get('areas'), contact: value.get('contact'), display_name: value.get('name'), channel: value.get('channel') })
      ctx.print(`${type} application #${made.id} sent (${made.status})`, 'ok')
    },
  },
  {
    name: 'leaderboard', aliases: ['lb'], group: 'Editor', usage: 'leaderboard [--json]', description: 'The editors with the most approved edits',
    covers: ['userApi.getLeaderboard'],
    run: async (args, ctx) => {
      const rows = await getLeaderboard()
      if (asJson(ctx, parseArgs(args).bool.has('json'), rows)) return
      if (rows.length === 0) { ctx.print('nobody on the board yet', 'dim'); return }
      ctx.print(table(rows.slice(0, 30).map((r) => [`#${r.rank}`, r.username, `${r.approved_count} approved`, r.badges.map((b) => b.name).join(', ')])))
    },
  },
  {
    name: 'changes', group: 'Editor', usage: 'changes [tracker|comp] [--limit N] [--json]', description: 'The recent-changes feeds: tracker edits (default) or comp file changes',
    covers: ['changesApi.fetchTrackerChanges', 'changesApi.fetchCompChanges'],
    complete: (before, partial) => (before.length === 0 ? ['tracker', 'comp'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['limit'])
      const which = (rest[0] ?? 'tracker').toLowerCase()
      const limit = Math.min(200, Math.max(1, Number(value.get('limit') ?? 30) || 30))
      if (which !== 'tracker' && which !== 'comp') fail('usage: changes [tracker|comp] [--limit N]')
      const rows = which === 'tracker' ? await fetchTrackerChanges(limit) : await fetchCompChanges(limit)
      if (asJson(ctx, bool.has('json'), rows)) return
      if (rows.length === 0) { ctx.print('no changes', 'dim'); return }
      ctx.print(table(rows.map((r) => [r.timestamp ? relativeTime(r.timestamp) : '', r.action, r.name, r.user])))
    },
  },
  {
    name: 'session-edits', aliases: ['sessions'], group: 'Library', usage: 'session-edits [era] [links] [--channel c] [--json]',
    description: 'The session-edit files by era, or (links) which songs have one linked',
    covers: ['sessionEditsApi.loadSessionEditFiles', 'sessionEditsApi.loadSessionEditLinks'],
    complete: (before, partial) => (before.length === 0 ? ['links'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['channel'])
      const channel = value.get('channel') ?? ''
      if (rest[0]?.toLowerCase() === 'links') {
        const links = await loadSessionEditLinks(channel)
        if (asJson(ctx, bool.has('json'), [...links.entries()].map(([song, l]) => ({ song, ...l })))) return
        ctx.print(`${links.size} song${links.size === 1 ? '' : 's'} have a session edit linked`)
        return
      }
      const files = await loadSessionEditFiles(channel)
      const era = rest.join(' ').toLowerCase()
      const shown = era ? files.filter((f) => f.era.toLowerCase().includes(era)) : files
      if (asJson(ctx, bool.has('json'), shown)) return
      if (shown.length === 0) { ctx.print('no session edits', 'dim'); return }
      ctx.print(pageLines(table(shown.map((f) => [f.era, f.name, f.duration ?? ''])).split('\n'), 100))
    },
  },
]
