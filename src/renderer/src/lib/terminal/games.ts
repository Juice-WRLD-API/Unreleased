import {
  absoluteClipUrl, fetchLeaderboard, flushResults, outboxSize, skipGuess, startTodayPuzzle, submitGuess, submitResult, versusWins,
  type LeaderboardBoard, type PuzzleResponse,
} from '../heardleApi'
import { leaveMatchQueueRest, pollMatchQueue } from '../heardleMatchApi'
import { recordResult, type DailyMode } from '../heardle'
import { fetchRadioLibrary, searchRadioLibrary } from '../radioLibrary'
import { fetchRadioLive } from '../radioLive'
import { useStore } from '../../store/useStore'
import { completeSongs, songFromArg } from './player'
import { asJson, clock, fail, parseArgs, table, type TermCommand, type TermCtx } from './types'

// The server-graded daily Heardle, its leaderboards, and 999 FM. The practice
// game with the audio screen is `heardle`; this is the once-a-day round that
// counts, played as text (the clip plays through the app's audio).
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const signedIn = (): void => { if (!st().account) fail('sign in first (login) - the daily round is graded by the server') }

let round: PuzzleResponse | null = null
const submitted = new Set<string>()

const modeOf = (word: string | undefined): DailyMode => (word === 'personal' ? 'personal' : 'daily')
const needRound = (): PuzzleResponse => round ?? fail('no round open - start one with: daily start [daily|personal]')

function showRound(r: PuzzleResponse, ctx: TermCtx): void {
  const total = r.tries || r.ladder.length
  const lines = [
    `Heardle ${r.mode}${r.puzzle_number ? ` #${r.puzzle_number}` : ''} · ${r.day} · ${r.status === 'playing' ? `guess ${r.guesses.length + 1} of ${total}` : r.status}`,
    ...r.guesses.map((g, i) => `  ${i + 1}. ${g.songId === null ? '(skipped)' : `${g.label}${g.era ? `  [${g.era}]` : ''}${g.sameEra ? '  - same era' : ''}`}`),
  ]
  if (r.status === 'playing') lines.push(`clip: ${r.ladder[Math.min(r.guesses.length, r.ladder.length - 1)] ?? '?'}s unlocked · daily play · daily guess <song> · daily skip`)
  else if (r.reveal) lines.push(`${r.status === 'won' ? 'Got it' : 'It was'}: ${r.reveal.name}`)
  ctx.print(lines.join('\n'), r.status === 'won' ? 'ok' : 'plain')
}

// Once a round is over: fold it into the local stats and send it to the
// leaderboard, exactly once, as the Heardle page does.
async function finishIfOver(r: PuzzleResponse): Promise<void> {
  const key = `${r.mode}:${r.day}`
  if (r.status === 'playing' || submitted.has(key) || !r.reveal) return
  submitted.add(key)
  recordResult(r.mode, r.day, r.status === 'won', r.guesses.length)
  await submitResult({ day: r.day, mode: r.mode, song_id: r.reveal.id, guesses: r.guesses.length, won: r.status === 'won', guess_song_ids: r.guesses.map((g) => g.songId) })
}

let clip: HTMLAudioElement | null = null
function playClip(r: PuzzleResponse): number {
  clip?.pause()
  const seconds = r.ladder[Math.min(r.guesses.length, r.ladder.length - 1)] ?? 1
  const audio = new Audio(absoluteClipUrl(r.clip_url))
  clip = audio
  audio.currentTime = r.clip_start ?? 0
  const stopAt = (r.clip_start ?? 0) + seconds
  audio.addEventListener('timeupdate', () => { if (audio.currentTime >= stopAt) audio.pause() })
  void audio.play()
  return seconds
}

const BOARDS: LeaderboardBoard[] = ['today', 'streak', 'versus']

const dailyCommand: TermCommand = {
  name: 'daily', group: 'Content',
  usage: 'daily [start [daily|personal]] · play · guess <song> · skip · board [today|streak|versus] [daily|personal] · versus join|leave · sync',
  description: 'The server-graded daily Heardle played as text, its leaderboards, and the versus queue (the live match itself needs the Heardle page). `heardle` is the practice game',
  covers: [
    'heardleApi.startTodayPuzzle', 'heardleApi.startPuzzle', 'heardleApi.submitGuess', 'heardleApi.skipGuess', 'heardleApi.submitResult', 'heardleApi.flushResults',
    'heardleApi.fetchLeaderboard', 'heardleMatchApi.pollMatchQueue', 'heardleMatchApi.leaveMatchQueueRest',
  ],
  complete: (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return ['start', 'play', 'guess', 'skip', 'board', 'versus', 'sync'].filter((v) => v.startsWith(p))
    if (before[0] === 'guess') return completeSongs(before.slice(1), partial)
    if (before[0] === 'board' && before.length === 1) return BOARDS.filter((v) => v.startsWith(p))
    if (before[0] === 'versus' && before.length === 1) return ['join', 'leave'].filter((v) => v.startsWith(p))
    return []
  },
  run: async (args, ctx) => {
    const { rest, bool } = parseArgs(args)
    const sub = (rest.shift() ?? (round ? 'status' : 'start')).toLowerCase()
    if (sub === 'board') {
      const board = (BOARDS.find((b) => b === rest[0]?.toLowerCase()) ?? 'today') as LeaderboardBoard
      const mode = board === 'versus' ? 'versus' : modeOf(rest[board === rest[0]?.toLowerCase() ? 1 : 0])
      const res = await fetchLeaderboard(board, mode)
      if (asJson(ctx, bool.has('json'), res)) return
      const cell = (e: (typeof res.entries)[number]): string => (board === 'versus' ? `${versusWins(e)} wins · ${e.played ?? 0} played` : board === 'streak' ? `streak ${e.current_streak ?? 0} (best ${e.max_streak ?? 0})` : `${e.won ? 'won' : 'lost'} in ${e.guesses ?? '?'}`)
      ctx.print(`${board} · ${res.day}\n${res.entries.length ? table(res.entries.slice(0, 25).map((e) => [`#${e.rank}`, e.display_name, cell(e)])) : '(empty)'}${res.me ? `\nyou: #${res.me.rank} ${cell(res.me)}` : ''}`)
      return
    }
    signedIn()
    if (sub === 'sync') {
      const before = outboxSize()
      await flushResults()
      ctx.print(before ? `sent ${before - outboxSize()} of ${before} queued result${before === 1 ? '' : 's'}` : 'nothing queued', before ? 'ok' : 'dim')
    } else if (sub === 'versus') {
      const verb = (rest[0] ?? '').toLowerCase()
      if (verb === 'join') {
        const res = await pollMatchQueue()
        ctx.print(res.matchId ? `matched! match ${res.matchId} - the live round plays on the Heardle page` : 'in the queue - run again to check for an opponent (versus leave to stop)', res.matchId ? 'ok' : 'plain')
      } else if (verb === 'leave') {
        await leaveMatchQueueRest()
        ctx.print('left the versus queue', 'ok')
      } else fail('usage: daily versus <join|leave>')
    } else if (sub === 'start' || sub === 'status') {
      if (sub === 'start' || !round) round = await startTodayPuzzle(modeOf(rest[0]?.toLowerCase()))
      showRound(round, ctx)
    } else if (sub === 'play') {
      const r = needRound()
      if (r.status !== 'playing') fail('this round is over')
      ctx.print(`▶ ${playClip(r)}s clip`, 'ok')
    } else if (sub === 'guess' || sub === 'skip') {
      const r = needRound()
      if (r.status !== 'playing') fail('this round is over (daily start for another)')
      if (sub === 'guess') {
        const song = await songFromArg(rest.join(' '))
        round = await submitGuess(r.round_token, song.id)
      } else round = await skipGuess(r.round_token)
      showRound(round, ctx)
      await finishIfOver(round)
    } else fail('usage: daily [start | play | guess | skip | board | versus | sync]')
  },
}

const fmCommand: TermCommand = {
  name: 'fm', aliases: ['radio'], group: 'Content', usage: 'fm [live] · library [era] · search <text>',
  description: '999 FM: what is on air now, and the tracks the station can play',
  covers: ['radioLive.fetchRadioLive', 'radioLibrary.fetchRadioLibrary', 'radioLibrary.searchRadioLibrary'],
  complete: (before, partial) => (before.length === 0 ? ['live', 'library', 'search'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
  run: async (args, ctx) => {
    const { rest, bool } = parseArgs(args)
    const sub = (rest.shift() ?? 'live').toLowerCase()
    if (sub === 'live') {
      const s = await fetchRadioLive()
      if (asJson(ctx, bool.has('json'), s)) return
      const np = s.now_playing
      ctx.print([
        `${s.station} · ${s.is_live ? 'live' : s.state} · ${s.total_listeners ?? 0} listening`,
        np ? `now     ${np.display ?? `${np.artist} - ${np.title}`}${np.duration_ms ? `  (${clock((np.elapsed_ms ?? 0) / 1000)} / ${clock(np.duration_ms / 1000)})` : ''}` : 'now     (nothing)',
        s.up_next ? `next    ${s.up_next.display ?? `${s.up_next.artist} - ${s.up_next.title}`}` : '',
        s.queue_preview?.length ? `queue   ${s.queue_preview.slice(0, 5).join(' · ')}` : '',
        s.dj_line ? `dj      ${s.dj_line}` : '',
        s.stream_url ? `stream  ${s.stream_url}` : '',
      ].filter(Boolean).join('\n'))
    } else if (sub === 'library') {
      const era = rest.join(' ').toLowerCase()
      const all = await fetchRadioLibrary()
      const shown = era ? all.filter((t) => t.era.toLowerCase().includes(era)) : all
      if (asJson(ctx, bool.has('json'), shown)) return
      ctx.print(`${table(shown.slice(0, 60).map((t) => [t.id, t.title, t.era]))}\n${shown.length} track${shown.length === 1 ? '' : 's'}${shown.length > 60 ? ' (60 shown - add an era to narrow it)' : ''}`)
    } else if (sub === 'search') {
      const q = rest.join(' ')
      if (!q) fail('usage: fm search <text>')
      const found = await searchRadioLibrary(q, 20)
      ctx.print(found.length ? table(found.map((t) => [t.id, t.title, t.artist, t.era])) : `nothing on the station matches "${q}"`, found.length ? 'plain' : 'dim')
    } else fail('usage: fm [live | library | search]')
  },
}

export const GAME_COMMANDS: TermCommand[] = [dailyCommand, fmCommand]
