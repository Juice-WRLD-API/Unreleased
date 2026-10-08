import { relativeTime } from '../../components/adminShared'
import { APP_VERSION } from '../appVersion'
import { fetchRecentBroadcasts } from '../broadcastApi'
import { getSongsByIds } from '../juicewrldApi'
import { FEEDBACK_CATEGORIES, newReportId, SONG_ISSUE_TYPES, type FeedbackCategory, type SongIssueType } from '../reports'
import { listFeedback, listSongReports, reviewSongReport, submitFeedback, submitSongReport, type SongReportStatus } from '../reportsApi'
import { createTierlist, deleteTierlist, getPublicTierlist, listTierlists, updateTierlist, type ServerTierlist, type TierlistData } from '../tierlistApi'
import { useStore } from '../../store/useStore'
import { completeSongs, songFromArg } from './player'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, parseBool, table, type TermCommand, type TermCtx } from './types'

// Tier lists, feedback and song reports, and the broadcast banners - the
// community-facing pages. The tier list *page* keeps a local copy and syncs;
// these work on the account's copy directly.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const signedIn = (): void => { if (!st().account) fail('sign in first (login)') }

const DEFAULT_DATA = (): TierlistData => ({
  v: 1,
  tiers: [
    { id: 's', label: 'S', color: '#ff7f7f' }, { id: 'a', label: 'A', color: '#ffbf7f' }, { id: 'b', label: 'B', color: '#ffdf7f' },
    { id: 'c', label: 'C', color: '#ffff7f' }, { id: 'd', label: 'D', color: '#bfff7f' }, { id: 'unheard', label: "Haven't heard", color: '#7fffbf' },
  ],
  rows: {},
  filters: { categories: ['released', 'unreleased'], eras: [], albumId: null },
})

async function mine(id: number): Promise<ServerTierlist> {
  return (await listTierlists()).find((l) => l.id === id) ?? fail(`#${id} isn’t one of your tier lists (tierlist ls)`)
}

async function describeList(l: ServerTierlist, ctx: TermCtx): Promise<void> {
  const ids = [...new Set(Object.values(l.data.rows).flat())]
  const names = new Map((ids.length ? await getSongsByIds(ids.slice(0, 300), ctx.signal) : []).map((s) => [s.id, s.name]))
  ctx.print([
    `${l.name}  (#${l.id}, ${l.is_public ? 'public' : 'private'}, ${l.ranked_count} ranked)`,
    ...l.data.tiers.map((t) => `${t.label.padEnd(14)}${(l.data.rows[t.id] ?? []).map((id) => names.get(id) ?? `#${id}`).join(', ') || '-'}`),
  ].join('\n'))
}

const tierlistCommand: TermCommand = {
  name: 'tierlist', aliases: ['tiers'], group: 'Content',
  usage: 'tierlist [ls] · show <id> · view <id> · new <name> [--public] · rename <id> -- <name> · public|private <id> · rank <id> <tier> -- <song> · unrank <id> -- <song> · rm <id>',
  description: 'Your tier lists on the account (view <id> opens a public one). rank puts a song in a tier (S, A, B…); a song is in one tier at a time',
  covers: ['tierlistApi.listTierlists', 'tierlistApi.createTierlist', 'tierlistApi.updateTierlist', 'tierlistApi.deleteTierlist', 'tierlistApi.getPublicTierlist'],
  complete: (before, partial) => (before.length === 0 ? ['ls', 'show', 'view', 'new', 'rename', 'public', 'private', 'rank', 'unrank', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : before[0] === 'rank' && before.length >= 3 ? completeSongs(before.slice(3).filter((w) => w !== '--'), partial) : []),
  run: async (args, ctx) => {
    const dash = args.split(/\s+--\s+/)
    const { rest, bool } = parseArgs(dash[0])
    const tail = dash.slice(1).join(' -- ').trim()
    const sub = (rest.shift() ?? 'ls').toLowerCase()
    if (sub === 'view') { // anonymous: no sign-in needed
      await describeList(await getPublicTierlist(idArg(rest[0], 'tierlist view <id>')), ctx)
      return
    }
    signedIn()
    if (sub === 'ls' || sub === 'list') {
      const lists = await listTierlists()
      if (asJson(ctx, bool.has('json'), lists)) return
      ctx.print(lists.length ? table(lists.map((l) => [`#${l.id}`, l.name, l.is_public ? 'public' : 'private', `${l.ranked_count} ranked`, relativeTime(l.updated_at)])) : 'no tier lists on your account yet (tierlist new <name>)', lists.length ? 'plain' : 'dim')
    } else if (sub === 'show') {
      await describeList(await mine(idArg(rest[0], 'tierlist show <id>')), ctx)
    } else if (sub === 'new') {
      const name = rest.join(' ') || fail('usage: tierlist new <name> [--public]')
      const l = await createTierlist({ name, data: DEFAULT_DATA(), is_public: bool.has('public') })
      ctx.print(`created tier list #${l.id} ${l.name}`, 'ok')
    } else if (sub === 'rename') {
      const id = idArg(rest[0], 'tierlist rename <id> -- <name>')
      if (!tail) fail('usage: tierlist rename <id> -- <name>')
      await updateTierlist(id, { name: tail })
      ctx.print(`renamed #${id} to "${tail}"`, 'ok')
    } else if (sub === 'public' || sub === 'private') {
      const id = idArg(rest[0], `tierlist ${sub} <id>`)
      await updateTierlist(id, { is_public: sub === 'public' })
      ctx.print(`#${id} is now ${sub}`, 'ok')
    } else if (sub === 'rank' || sub === 'unrank') {
      const id = idArg(rest[0], 'tierlist rank <id> <tier> -- <song>')
      const tierWord = sub === 'rank' ? rest.slice(1).join(' ') : ''
      if (!tail || (sub === 'rank' && !tierWord)) fail(sub === 'rank' ? 'usage: tierlist rank <id> <tier> -- <song>' : 'usage: tierlist unrank <id> -- <song>')
      const list = await mine(id)
      const song = await songFromArg(tail)
      const rows: Record<string, number[]> = Object.fromEntries(Object.entries(list.data.rows).map(([k, v]) => [k, v.filter((s) => s !== song.id)]))
      let where = 'unranked'
      if (sub === 'rank') {
        const q = tierWord.toLowerCase()
        const tier = list.data.tiers.find((t) => t.id.toLowerCase() === q || t.label.toLowerCase() === q) ?? fail(`no tier "${tierWord}" (${list.data.tiers.map((t) => t.label).join(', ')})`)
        rows[tier.id] = [...(rows[tier.id] ?? []), song.id]
        where = `tier ${tier.label}`
      }
      await updateTierlist(id, { data: { ...list.data, rows } })
      ctx.print(`${song.name} → ${where} in "${list.name}"`, 'ok')
    } else if (sub === 'rm') {
      const id = idArg(rest[0], 'tierlist rm <id>')
      if (!confirmAction(ctx, `Delete tier list #${id}?`, bool.has('y'))) return
      await deleteTierlist(id)
      ctx.print(`deleted #${id}`, 'ok')
    } else fail('usage: tierlist [ls | show | view | new | rename | public | private | rank | unrank | rm]')
  },
}

const feedbackCommand: TermCommand = {
  name: 'devfeedback', group: 'Content', usage: 'devfeedback send <bug|suggestion|praise|other> -- <message> [--contact how] · ls [--automated on|off]',
  description: 'Send feedback to the developers (the chat /feedback is a different command), or (admins) read what has been sent',
  covers: ['reportsApi.submitFeedback', 'reportsApi.listFeedback'],
  complete: (before, partial) => (before.length === 0 ? ['send', 'ls'].filter((v) => v.startsWith(partial.toLowerCase())) : before[0] === 'send' && before.length === 1 ? FEEDBACK_CATEGORIES.filter((v) => v.startsWith(partial.toLowerCase())) : []),
  run: async (args, ctx) => {
    const dash = args.split(/\s+--\s+/)
    const { rest, bool, value } = parseArgs(dash[0], ['contact', 'automated'])
    const message = dash.slice(1).join(' -- ').trim()
    const sub = (rest.shift() ?? '').toLowerCase()
    if (sub === 'ls') {
      signedIn()
      const flag = value.get('automated')
      const rows = await listFeedback(flag === undefined ? undefined : parseBool(flag) ?? fail('--automated takes on or off'))
      if (asJson(ctx, bool.has('json'), rows)) return
      ctx.print(rows.length ? rows.map((r) => `#${r.id}  ${r.created_at ? relativeTime(r.created_at) : ''}${r.automated ? '  [automated]' : ''}${r.contact ? `  (${r.contact})` : ''}\n  ${oneLine(r.message, 300)}`).join('\n') : 'no feedback', rows.length ? 'plain' : 'dim')
    } else if (sub === 'send') {
      const category = (rest[0] ?? '').toLowerCase() as FeedbackCategory
      if (!FEEDBACK_CATEGORIES.includes(category) || !message) fail(`usage: devfeedback send <${FEEDBACK_CATEGORIES.join('|')}> -- <message>`)
      await submitFeedback({ kind: 'feedback', id: newReportId(), category, message, appVersion: APP_VERSION, createdAt: Date.now(), attempts: 0 }, value.get('contact'))
      ctx.print('feedback sent - thank you', 'ok')
    } else fail('usage: devfeedback [send | ls]')
  },
}

const reportCommand: TermCommand = {
  name: 'report', group: 'Content',
  usage: 'report song <song> --issues wrong_info,missing_lyrics -- <message> [--contact how] · ls [pending|resolved] · review <id> [--status pending|resolved] [--note text]',
  description: `Report a problem with a song (issues: ${SONG_ISSUE_TYPES.join(', ')}), or (editors) list and review reports`,
  covers: ['reportsApi.submitSongReport', 'reportsApi.listSongReports', 'reportsApi.reviewSongReport'],
  complete: (before, partial) => (before.length === 0 ? ['song', 'ls', 'review'].filter((v) => v.startsWith(partial.toLowerCase())) : before[0] === 'song' ? completeSongs(before.slice(1).filter((w) => w !== '--'), partial) : []),
  run: async (args, ctx) => {
    const dash = args.split(/\s+--\s+/)
    const { rest, bool, value } = parseArgs(dash[0], ['issues', 'contact', 'status', 'note'])
    const message = dash.slice(1).join(' -- ').trim()
    const sub = (rest.shift() ?? '').toLowerCase()
    if (sub === 'song') {
      const song = await songFromArg(rest.join(' '))
      const issues = (value.get('issues') ?? 'other').split(',').map((s) => s.trim()).filter(Boolean) as SongIssueType[]
      const bad = issues.find((i) => !SONG_ISSUE_TYPES.includes(i))
      if (bad) fail(`unknown issue "${bad}" (${SONG_ISSUE_TYPES.join(', ')})`)
      await submitSongReport({ kind: 'song', id: newReportId(), songId: song.id, songName: song.name, issues, message, appVersion: APP_VERSION, createdAt: Date.now(), attempts: 0 }, value.get('contact'))
      ctx.print(`reported ${song.name} - thank you`, 'ok')
    } else if (sub === 'ls') {
      signedIn()
      const status = rest[0]?.toLowerCase() as SongReportStatus | undefined
      if (status && status !== 'pending' && status !== 'resolved') fail('usage: report ls [pending|resolved]')
      const rows = await listSongReports(status)
      if (asJson(ctx, bool.has('json'), rows)) return
      ctx.print(rows.length ? table(rows.map((r) => [`#${r.id}`, r.status, r.song_name ?? `song ${r.song ?? r.song_id ?? '?'}`, oneLine(r.message, 80)])) : 'no reports', rows.length ? 'plain' : 'dim')
    } else if (sub === 'review') {
      signedIn()
      const id = idArg(rest[0], 'report review <id> [--status s] [--note text]')
      const status = value.get('status') as SongReportStatus | undefined
      if (status && status !== 'pending' && status !== 'resolved') fail('--status is pending or resolved')
      if (!status && !value.has('note')) fail('nothing to change - give --status or --note')
      await reviewSongReport(id, { status, review_notes: value.get('note') })
      ctx.print(`report #${id} updated`, 'ok')
    } else fail('usage: report [song | ls | review]')
  },
}

const broadcastsCommand: TermCommand = {
  name: 'broadcasts', group: 'Content', usage: 'broadcasts [--after id]',
  description: 'The announcement banners sent in the last day (admins send them with /broadcast)',
  covers: ['broadcastApi.fetchRecentBroadcasts'],
  run: async (args, ctx) => {
    const { bool, value } = parseArgs(args, ['after'])
    const rows = await fetchRecentBroadcasts(Number(value.get('after')) || undefined)
    if (asJson(ctx, bool.has('json'), rows)) return
    ctx.print(rows.length ? rows.map((b) => `#${b.id}  [${b.level}] ${b.title ? `${b.title} - ` : ''}${b.message}  (${b.sender}, ${relativeTime(b.sent_at)})`).join('\n') : 'no broadcasts in the last day', rows.length ? 'plain' : 'dim')
  },
}

export const COMMUNITY_COMMANDS: TermCommand[] = [tierlistCommand, feedbackCommand, reportCommand, broadcastsCommand]
