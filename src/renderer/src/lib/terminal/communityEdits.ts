import { relativeTime } from '../../components/adminShared'
import { formatLength, openCommunityEditMatch } from '../../components/communityEditShared'
import { useStore } from '../../store/useStore'
import {
  COMMUNITY_EDIT_ACCEPT, COMMUNITY_EDIT_KINDS, COMMUNITY_EDIT_STATUSES, DuplicateEditError,
  adminCommunityEditCounts, adminListCommunityEdits, adminReverseCommunityEdit, adminReviewCommunityEdit,
  checkCommunityEditFile, checkCommunityEditHash, communityEditKindLabel, fetchCommunityEditAudio, getMyCommunityEdit,
  listMyCommunityEdits, sha256OfFile, submitCommunityEdit, withdrawCommunityEdit,
  type CommunityEdit, type CommunityEditKind, type CommunityEditMatch, type CommunityEditStatus,
} from '../communityEditsApi'
import { formatBytes } from '../format'
import { pickLocalFile, saveBlob } from './pick'
import { completeSongs, songFromArg } from './player'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, table, type TermCommand, type TermCtx } from './types'

// Community remixes and edits: Home → Tools → Submit a remix or edit, My
// remixes & edits in Settings → Account, and Admin → Remixes & edits. submit
// checks the file's hash first, like the dialog, and a file the server
// already has is named with --open to go there. queue/counts/approve/reject/
// reverse are for managers of the primary channel and admins.
const SUBS = ['ls', 'show', 'submit', 'check', 'withdraw', 'audio', 'open', 'queue', 'counts', 'approve', 'reject', 'reverse']
const USAGE = 'remix [ls [status]] · show <id> · submit [--title t] [--kind remix|stem_edit|other] [--song s] [--note n] [--open] · check [--open] · withdraw <id> · audio <id> · open <id> · queue [status] · counts · approve <id> [note] · reject <id> [note] · reverse <id>   (--limit n --offset n)'

const signedIn = (): void => { if (!useStore.getState().account) fail('sign in first (login)') }

function statusArg(word: string | undefined, fallback: CommunityEditStatus | undefined): CommunityEditStatus | undefined {
  if (!word) return fallback
  if (word.toLowerCase() === 'all') return undefined
  return COMMUNITY_EDIT_STATUSES.find((s) => s.startsWith(word.toLowerCase())) ?? fail(`status must be one of: ${COMMUNITY_EDIT_STATUSES.join(', ')}, all`)
}

function kindArg(word: string | undefined): CommunityEditKind {
  if (!word) return 'remix'
  const w = word.toLowerCase().replace('-', '_')
  return COMMUNITY_EDIT_KINDS.find((k) => k.id.startsWith(w))?.id ?? fail('--kind must be remix, stem_edit or other')
}

function numberFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fail(`--${name} must be a whole number`)
}

const listRows = (list: CommunityEdit[], submitter: boolean): string => table(list.map((e) => [
  `#${e.id}`, e.status, e.title, communityEditKindLabel(e.kind), ...(submitter ? [e.submitter_username || 'deleted account'] : []),
  formatLength(e.duration), relativeTime(e.created_at),
]))

const detail = (e: CommunityEdit): string => [
  `#${e.id} · ${e.status} · ${e.title} (${communityEditKindLabel(e.kind)})`,
  `by ${e.submitter_username || 'deleted account'}, ${relativeTime(e.created_at)}${e.reviewer_username ? ` · reviewed by ${e.reviewer_username}${e.reviewed_at ? ` ${relativeTime(e.reviewed_at)}` : ''}` : ''}`,
  `${formatLength(e.duration)} · ${formatBytes(e.size)} · ${e.extension.toUpperCase()} · sha256 ${e.sha256.slice(0, 16)}…`,
  ...(e.song_name ? [`made from: ${e.song_name}${e.song_public_id != null ? ` (#${e.song_public_id})` : ''}`] : []),
  ...(e.notes ? [`notes: ${oneLine(e.notes, 300)}`] : []),
  ...(e.review_notes ? [`review: ${oneLine(e.review_notes, 300)}`] : []),
  ...(e.comp_path ? [`in Files: ${e.comp_channel ?? '?'}:${e.comp_path}`] : []),
  `audio ${e.status === 'approved' ? 'public' : 'private (remix audio <id> saves it)'}: ${e.audio_url}`,
].join('\n')

function describeMatch(match: CommunityEditMatch): string {
  if (match.target === 'file') return `already in Files: ${match.channel ? `${match.channel}:` : ''}${match.path} (${match.score}%)`
  if (match.target === 'song') return `already in the catalogue: ${match.song.name} (#${match.song.public_id}, ${match.score}%)`
  return `already sent in${match.mine && match.submission != null ? ` by you as #${match.submission}${match.title ? ` "${match.title}"` : ''}` : ' by someone else'}, waiting for review (${match.score}%)`
}

function reportMatch(ctx: TermCtx, match: CommunityEditMatch, open: boolean): void {
  ctx.print(describeMatch(match), 'dim')
  if (match.target === 'pending') return
  if (open) {
    openCommunityEditMatch(match)
    ctx.print(match.target === 'file' ? 'opened it in Files' : 'opened the song', 'ok')
  } else ctx.print('add --open to go there', 'dim')
}

const remixCommand: TermCommand = {
  name: 'remix', aliases: ['community-edit', 'remixes'], group: 'Content',
  usage: USAGE,
  description: 'Remixes and stem edits you sent in: list, show, submit (opens a file picker; a file we already have is turned away and named), check a file without sending it, withdraw a pending one, save its audio, or open an approved one in Files. queue, counts, approve, reject and reverse are the review side for managers and admins',
  covers: [
    'communityEditsApi.listMyCommunityEdits', 'communityEditsApi.getMyCommunityEdit', 'communityEditsApi.submitCommunityEdit',
    'communityEditsApi.checkCommunityEditHash', 'communityEditsApi.withdrawCommunityEdit', 'communityEditsApi.fetchCommunityEditAudio',
    'communityEditsApi.adminListCommunityEdits', 'communityEditsApi.adminCommunityEditCounts',
    'communityEditsApi.adminReviewCommunityEdit', 'communityEditsApi.adminReverseCommunityEdit',
  ],
  complete: (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return SUBS.filter((v) => v.startsWith(p))
    if (before.length === 1 && (before[0] === 'ls' || before[0] === 'queue')) return [...COMMUNITY_EDIT_STATUSES, 'all'].filter((v) => v.startsWith(p))
    if (before[0] === 'submit' && before[before.length - 1] === '--song') return completeSongs([], partial)
    if (before[0] === 'submit' && before[before.length - 1] === '--kind') return COMMUNITY_EDIT_KINDS.map((k) => k.id).filter((v) => v.startsWith(p))
    return []
  },
  run: async (args, ctx) => {
    signedIn()
    const { rest, bool, value } = parseArgs(args, ['title', 'kind', 'song', 'note', 'limit', 'offset'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    const limit = numberFlag(value.get('limit'), 'limit')
    const offset = numberFlag(value.get('offset'), 'offset')

    if (sub === 'ls' || sub === 'list' || sub === 'queue') {
      const review = sub === 'queue'
      const status = statusArg(rest[0], review ? 'pending' : undefined)
      const page = review
        ? await adminListCommunityEdits({ status, limit, offset })
        : await listMyCommunityEdits({ status, limit, offset })
      if (asJson(ctx, bool.has('json'), page)) return
      if (page.results.length === 0) {
        ctx.print(review ? `no ${status ? `${status} ` : ''}edits in the queue` : status ? `none of your edits are ${status}` : 'no edits sent in yet', 'dim')
        return
      }
      const shown = `${page.offset + 1}–${page.offset + page.results.length} of ${page.count}`
      ctx.print(`${listRows(page.results, review)}\n${shown}${review ? ' · remix approve <id> · reject <id> [note]' : ''}`)
    } else if (sub === 'show' || sub === 'open') {
      const id = idArg(rest[0], `remix ${sub} <id>`)
      let e: CommunityEdit
      try {
        e = await getMyCommunityEdit(id)
      } catch (err) {
        e = (await adminListCommunityEdits({ limit: 200 }).catch(() => { throw err })).results.find((r) => r.id === id) ?? fail(`no edit #${id} among the 200 newest`)
      }
      if (sub === 'open') {
        if (!e.comp_path) fail(`edit #${id} is ${e.status}, not in Files`)
        openCommunityEditMatch({ source: 'community_edit', score: 100, verdict: 'duplicate', target: 'file', path: e.comp_path!, channel: e.comp_channel })
        ctx.print(`opened ${e.comp_channel ?? '?'}:${e.comp_path} in Files`, 'ok')
        return
      }
      if (asJson(ctx, bool.has('json'), e)) return
      ctx.print(detail(e))
    } else if (sub === 'check' || sub === 'submit') {
      // The picker has to open straight after the keypress, so it goes first.
      const picking = pickLocalFile(COMMUNITY_EDIT_ACCEPT)
      const song = sub === 'submit' && value.has('song') ? await songFromArg(value.get('song')!) : null
      const kind = sub === 'submit' ? kindArg(value.get('kind')) : 'remix'
      const file = await picking
      const problem = checkCommunityEditFile(file)
      if (problem) fail(problem)
      ctx.print(`checking ${file.name} (${formatBytes(file.size)})…`, 'dim')
      const match = await checkCommunityEditHash(await sha256OfFile(file), ctx.signal)
      if (match) { reportMatch(ctx, match, bool.has('open')); return }
      if (sub === 'check') {
        ctx.print('no exact copy here (submit runs the full check, which also catches re-encodes and near-copies)', 'ok')
        return
      }
      const title = (value.get('title') ?? file.name.replace(/\.[^.]+$/, '')).trim()
      if (!title) fail('give it a title with --title')
      let lastShown = -1
      try {
        const made = await submitCommunityEdit(file, { title, kind, songId: song?.id ?? null, notes: value.get('note') }, (f) => {
          const pct = Math.floor(f * 10) * 10
          if (pct !== lastShown && pct < 100) { lastShown = pct; ctx.print(`uploading ${pct}%`, 'dim') }
        }, ctx.signal)
        ctx.print(`edit #${made.id} sent for review: ${made.title}`, 'ok')
      } catch (err) {
        if (!(err instanceof DuplicateEditError)) throw err
        ctx.print(err.message, 'error')
        reportMatch(ctx, err.match, bool.has('open'))
      }
    } else if (sub === 'withdraw') {
      const id = idArg(rest[0], 'remix withdraw <id>')
      if (!confirmAction(ctx, `Withdraw edit #${id}? Its file is deleted.`, bool.has('y'))) return
      await withdrawCommunityEdit(id)
      ctx.print(`edit #${id} withdrawn`, 'ok')
    } else if (sub === 'audio') {
      const id = idArg(rest[0], 'remix audio <id>')
      const blob = await fetchCommunityEditAudio(id, ctx.signal)
      const ext = (await getMyCommunityEdit(id).catch(() => null))?.extension ?? 'audio'
      saveBlob(blob, `edit-${id}.${ext}`)
      ctx.print(`saved edit-${id}.${ext} (${formatBytes(blob.size)})`, 'ok')
    } else if (sub === 'counts') {
      const c = await adminCommunityEditCounts()
      if (asJson(ctx, bool.has('json'), c)) return
      ctx.print(`pending ${c.pending}\napproved ${c.approved}\nrejected ${c.rejected}\nreversed ${c.reversed}\ntotal ${c.total}`)
    } else if (sub === 'approve' || sub === 'reject') {
      const id = idArg(rest.shift(), `remix ${sub} <id> [note]`)
      const e = await adminReviewCommunityEdit(id, sub, rest.join(' '))
      ctx.print(`edit #${id} ${e.status}: ${e.title}${e.comp_path ? ` · filed at ${e.comp_channel ?? '?'}:${e.comp_path}` : ''}`, 'ok')
    } else if (sub === 'reverse') {
      const id = idArg(rest[0], 'remix reverse <id>')
      if (!confirmAction(ctx, `Take back edit #${id}? It is taken out of Files (Remixes & Edits/Community-Made).`, bool.has('y'))) return
      const e = await adminReverseCommunityEdit(id)
      ctx.print(`edit #${id} reversed: ${e.title}`, 'ok')
    } else fail(`usage: ${USAGE}`)
  },
}

export const COMMUNITY_EDIT_COMMANDS: TermCommand[] = [remixCommand]
