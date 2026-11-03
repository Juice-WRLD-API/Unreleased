import { relativeTime } from '../../components/adminShared'
import { useStore } from '../../store/useStore'
import {
  COVER_ART_STATUSES, COVER_ART_TYPES, adminCoverArtCounts, adminListCoverArt, adminReverseCoverArt, adminReviewCoverArt,
  checkCoverArtFile, fetchCoverArtImage, getMyCoverArt, listMyCoverArt, submitCoverArt, withdrawCoverArt,
  type CoverArtStatus, type CoverArtSubmission,
} from '../coverArtApi'
import { dropCoverArtImage } from '../coverArtImages'
import { formatBytes } from '../format'
import { pickLocalFile, saveBlob } from './pick'
import { completeSongs, songFromArg } from './player'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, table, type TermCommand } from './types'

// Cover art submissions, the same as a song's More → Submit cover art, My cover
// art in Settings → Account, and Admin → Cover art. Anyone signed in can send
// one in; queue/counts/approve/reject/reverse are for managers of the primary
// channel and admins, and the API refuses them for anyone else.
const SUBS = ['ls', 'show', 'submit', 'withdraw', 'image', 'queue', 'counts', 'approve', 'reject', 'reverse']
const USAGE = 'coverart [ls [status]] · show <id> · submit <song> [--note n] · withdraw <id> · image <id> · queue [status] · counts · approve <id> [note] · reject <id> [note] · reverse <id>   (--limit n --offset n)'

const signedIn = (): void => { if (!useStore.getState().account) fail('sign in first (login)') }

function statusArg(word: string | undefined, fallback: CoverArtStatus | undefined): CoverArtStatus | undefined {
  if (!word) return fallback
  if (word.toLowerCase() === 'all') return undefined
  return COVER_ART_STATUSES.find((s) => s.startsWith(word.toLowerCase())) ?? fail(`status must be one of: ${COVER_ART_STATUSES.join(', ')}, all`)
}

function numberFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fail(`--${name} must be a whole number`)
}

const listRows = (list: CoverArtSubmission[], submitter: boolean): string => table(list.map((s) => [
  `#${s.id}`, s.status, s.song_name || 'deleted song', ...(submitter ? [s.submitter_username || 'deleted account'] : []),
  `${s.width}×${s.height}`, relativeTime(s.created_at),
]))

const detail = (s: CoverArtSubmission): string => [
  `#${s.id} · ${s.status} · ${s.song_name || 'deleted song'}${s.song_public_id != null ? ` (#${s.song_public_id})` : ''}`,
  `by ${s.submitter_username || 'deleted account'}, ${relativeTime(s.created_at)}${s.reviewer_username ? ` · reviewed by ${s.reviewer_username}${s.reviewed_at ? ` ${relativeTime(s.reviewed_at)}` : ''}` : ''}`,
  `${s.width}×${s.height} · ${formatBytes(s.size)} · ${s.mime}`,
  ...(s.notes ? [`notes: ${oneLine(s.notes, 300)}`] : []),
  ...(s.review_notes ? [`review: ${oneLine(s.review_notes, 300)}`] : []),
  `song cover now: ${s.song_image_url ?? 'song deleted'}`,
  ...(s.previous_image_url ? [`replaced: ${s.previous_image_url}`] : []),
  `image ${s.status === 'approved' ? 'public' : 'private (coverart image <id> saves it)'}: ${s.image_url}`,
].join('\n')

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const coverArtCommand: TermCommand = {
  name: 'coverart', aliases: ['cover-art'], group: 'Content',
  usage: USAGE,
  description: 'Cover art you sent in for songs: list, show, submit (opens a file picker), withdraw a pending one, or save its image. queue, counts, approve, reject and reverse are the review side for managers and admins',
  covers: [
    'coverArtApi.listMyCoverArt', 'coverArtApi.getMyCoverArt', 'coverArtApi.submitCoverArt', 'coverArtApi.withdrawCoverArt',
    'coverArtApi.fetchCoverArtImage', 'coverArtApi.adminListCoverArt', 'coverArtApi.adminCoverArtCounts',
    'coverArtApi.adminReviewCoverArt', 'coverArtApi.adminReverseCoverArt',
  ],
  complete: (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return SUBS.filter((v) => v.startsWith(p))
    if (before.length === 1 && (before[0] === 'ls' || before[0] === 'queue')) return [...COVER_ART_STATUSES, 'all'].filter((v) => v.startsWith(p))
    if (before[0] === 'submit') return completeSongs(before.slice(1), partial)
    return []
  },
  run: async (args, ctx) => {
    signedIn()
    const { rest, bool, value } = parseArgs(args, ['note', 'limit', 'offset'])
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    const limit = numberFlag(value.get('limit'), 'limit')
    const offset = numberFlag(value.get('offset'), 'offset')

    if (sub === 'ls' || sub === 'list' || sub === 'queue') {
      const review = sub === 'queue'
      const status = statusArg(rest[0], review ? 'pending' : undefined)
      const page = review
        ? await adminListCoverArt({ status, limit, offset })
        : await listMyCoverArt({ status, limit, offset })
      if (asJson(ctx, bool.has('json'), page)) return
      if (page.results.length === 0) {
        ctx.print(review ? `no ${status ? `${status} ` : ''}cover art in the queue` : status ? `none of your cover art is ${status}` : 'no cover art sent in yet', 'dim')
        return
      }
      const shown = `${page.offset + 1}–${page.offset + page.results.length} of ${page.count}`
      ctx.print(`${listRows(page.results, review)}\n${shown}${review ? ' · coverart approve <id> · reject <id> [note]' : ''}`)
    } else if (sub === 'show') {
      const id = idArg(rest[0], 'coverart show <id>')
      let s: CoverArtSubmission
      try {
        s = await getMyCoverArt(id)
      } catch (err) {
        // Not one of yours: a reviewer can still find it in the queue.
        s = (await adminListCoverArt({ limit: 200 }).catch(() => { throw err })).results.find((r) => r.id === id) ?? fail(`no cover art #${id} among the 200 newest`)
      }
      if (asJson(ctx, bool.has('json'), s)) return
      ctx.print(detail(s))
    } else if (sub === 'submit') {
      if (rest.length === 0) fail('usage: coverart submit <song> [--note n]')
      // The picker has to open straight after the keypress, so it goes first.
      const picking = pickLocalFile(COVER_ART_TYPES.join(','))
      const song = await songFromArg(rest.join(' '))
      const file = await picking
      const checked = await checkCoverArtFile(file)
      if (typeof checked === 'string') fail(checked)
      ctx.print(`sending ${file.name} (${formatBytes(file.size)}) for ${song.name}…`, 'dim')
      const made = await submitCoverArt(song.id, file, value.get('note'))
      ctx.print(`cover art #${made.id} sent for review: ${made.song_name ?? song.name}`, 'ok')
    } else if (sub === 'withdraw') {
      const id = idArg(rest[0], 'coverart withdraw <id>')
      if (!confirmAction(ctx, `Withdraw cover art #${id}? Its image is deleted.`, bool.has('y'))) return
      await withdrawCoverArt(id)
      dropCoverArtImage(id)
      ctx.print(`cover art #${id} withdrawn`, 'ok')
    } else if (sub === 'image') {
      const id = idArg(rest[0], 'coverart image <id>')
      const blob = await fetchCoverArtImage(id)
      saveBlob(blob, `cover-${id}.${EXT[blob.type] ?? 'img'}`)
      ctx.print(`saved cover-${id} (${formatBytes(blob.size)})`, 'ok')
    } else if (sub === 'counts') {
      const c = await adminCoverArtCounts()
      if (asJson(ctx, bool.has('json'), c)) return
      ctx.print(`pending ${c.pending}\napproved ${c.approved}\nrejected ${c.rejected}\nreversed ${c.reversed}\ntotal ${c.total}`)
    } else if (sub === 'approve' || sub === 'reject') {
      const id = idArg(rest.shift(), `coverart ${sub} <id> [note]`)
      const s = await adminReviewCoverArt(id, sub, rest.join(' '))
      ctx.print(`cover art #${id} ${s.status}: ${s.song_name ?? 'deleted song'}`, 'ok')
    } else if (sub === 'reverse') {
      const id = idArg(rest[0], 'coverart reverse <id>')
      if (!confirmAction(ctx, `Take back cover art #${id}? The song goes back to its previous cover if it still shows this one.`, bool.has('y'))) return
      const s = await adminReverseCoverArt(id)
      ctx.print(`cover art #${id} reversed: ${s.song_name ?? 'deleted song'}`, 'ok')
    } else fail(`usage: ${USAGE}`)
  },
}

export const COVER_ART_COMMANDS: TermCommand[] = [coverArtCommand]
