// Heardle leaderboard + server-graded round data layer.
//
// ── Where the trust sits ─────────────────────────────────────────────────────
//
// The server owns the answer on the signed-in daily path: startPuzzle hands
// back a round token and a clip, and every guess goes through submitGuess /
// skipGuess to be graded there. That is what makes a posted score evidence
// rather than a claim, and it is why the client must take the server's
// `ladder`, `status` and `guesses` as authoritative instead of recomputing
// them - the whole pool is still in the browser and localStorage is still
// plain text, so anything derived locally is only a display convenience.
//
// submitResult below is the *legacy* path and still self-reports. It stays
// because signed-out rounds queue through it, and because the server may want
// the guess ids for verification (`guess_song_ids` exists for exactly that).
// It must never be the only thing a ranking is built from: on the server path
// the round the server graded is the record, and a POST to /results/ that
// disagrees with it should be rejected there, not trusted here.
import { JWAPI_BASE } from './juicewrldApi'
import { apiRequest } from './apiClient'
import { getToken } from './userApi'
import type { DailyMode, Guess, GameStatus, HeardleSong } from './heardle'

export const HEARDLE_LEADERBOARD_ENABLED = true

const HEARDLE_BASE = `${JWAPI_BASE}/heardle`
const API_ORIGIN = JWAPI_BASE.replace(/\/juicewrld\/?$/, '')

export type LeaderboardBoard = 'today' | 'streak' | 'versus'

export interface LeaderboardEntry {
  rank: number
  user_id: number
  display_name: string
  discord_avatar?: string | null
  /** today: guesses used; null when the day was lost. */
  guesses?: number | null
  /** today: whether the day was won. A flag, never a tally - the versus
   *  boards count with `wins`, so that the two can't be confused into
   *  rendering a boolean where a number belongs. */
  won?: boolean
  /** streak: the running counters. */
  current_streak?: number
  max_streak?: number
  /** versus: match tallies. */
  played?: number
  wins?: number
  lost?: number
  drawn?: number
  /** 0–100. */
  win_rate?: number
}

/** Wins for a versus row, tolerating a server that still reuses `won` as a
 *  count. Anything non-numeric (including a boolean) reads as zero rather
 *  than rendering "trueW". */
export function versusWins(entry: LeaderboardEntry): number {
  const raw: unknown = entry.wins ?? entry.won
  return typeof raw === 'number' ? raw : 0
}

export interface LeaderboardResponse {
  board: LeaderboardBoard
  mode: DailyMode | 'versus'
  day: string
  entries: LeaderboardEntry[]
  me?: LeaderboardEntry | null
}

export interface PuzzleResponse {
  round_token: string
  day: string
  mode: DailyMode
  puzzle_number: number | null
  tries: number
  ladder: number[]
  clip_url: string
  clip_start: number
  status: GameStatus
  guesses: Guess[]
  reveal?: HeardleSong
}

export interface ResultSubmission {
  day: string
  mode: DailyMode
  song_id: number
  guesses: number
  won: boolean
  guess_song_ids: (number | null)[]
}

function authed<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(url, { ...options, headers: { ...headers, ...(options.headers as Record<string, string>) } })
}

export function absoluteClipUrl(relative: string): string {
  if (relative.startsWith('http')) return relative
  return `${API_ORIGIN}${relative}`
}

export async function startPuzzle(mode: DailyMode, day?: string): Promise<PuzzleResponse> {
  return authed<PuzzleResponse>(`${HEARDLE_BASE}/puzzle/`, {
    method: 'POST',
    body: JSON.stringify(day ? { mode, day } : { mode }),
  })
}

/** UTC calendar day - the only "today" both sides can agree on without
 *  knowing each other's timezone. */
function utcDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Today's round, with the server deciding what "today" means.
 *
 *  The browser's local date is not a safe thing to send: the API validates the
 *  day as "not in the future" against its own clock, so any player east of the
 *  server's timezone gets rejected for hours every night - which is exactly
 *  the "Must be YYYY-MM-DD and not in the future" failure. The server owns the
 *  answer, so it owns the calendar too; the day it returns is authoritative
 *  and callers should key their state off `res.day`, not off todayKey().
 *
 *  Candidates are tried in order and the first success wins: no day at all
 *  (correct if the server defaults to its own today), then the UTC day, then
 *  the UTC day before - which between them cover a server on any offset,
 *  whether or not it requires the field. Only a failure costs an extra call.
 */
export async function startTodayPuzzle(mode: DailyMode): Promise<PuzzleResponse> {
  const candidates: (string | undefined)[] = [undefined, utcDay(), utcDay(-1)]
  let lastError: unknown
  for (const day of candidates) {
    try {
      return await startPuzzle(mode, day)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not start the round')
}

export async function submitGuess(roundToken: string, songId: number): Promise<PuzzleResponse> {
  return authed<PuzzleResponse>(`${HEARDLE_BASE}/guess/`, {
    method: 'POST',
    body: JSON.stringify({ round_token: roundToken, song_id: songId }),
  })
}

export async function skipGuess(roundToken: string): Promise<PuzzleResponse> {
  return authed<PuzzleResponse>(`${HEARDLE_BASE}/skip/`, {
    method: 'POST',
    body: JSON.stringify({ round_token: roundToken }),
  })
}

const OUTBOX_KEY = 'unreleased:heardle:outbox'
const OUTBOX_LIMIT = 60

function readOutbox(): ResultSubmission[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const parsed = raw ? (JSON.parse(raw) as ResultSubmission[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeOutbox(items: ResultSubmission[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-OUTBOX_LIMIT)))
  } catch {}
}

export function outboxSize(): number {
  return readOutbox().length
}

function enqueue(result: ResultSubmission): void {
  const rest = readOutbox().filter((r) => !(r.day === result.day && r.mode === result.mode))
  writeOutbox([...rest, result])
}

export async function submitResult(result: ResultSubmission): Promise<void> {
  if (!HEARDLE_LEADERBOARD_ENABLED || !getToken()) {
    enqueue(result)
    return
  }
  try {
    await authed<unknown>(`${HEARDLE_BASE}/results/`, {
      method: 'POST',
      body: JSON.stringify(result),
    })
  } catch {
    enqueue(result)
  }
}

export async function flushResults(): Promise<void> {
  if (!HEARDLE_LEADERBOARD_ENABLED || !getToken()) return
  let pending = readOutbox()
  while (pending.length > 0) {
    const [next, ...rest] = pending
    try {
      await authed<unknown>(`${HEARDLE_BASE}/results/`, {
        method: 'POST',
        body: JSON.stringify(next),
      })
    } catch {
      break
    }
    pending = rest
    writeOutbox(pending)
  }
}

/** Standings. `day` is optional and best left off - the server then answers for
 *  its own today, which is the same calendar the rounds are graded against.
 *  Passing a locally-computed date risks asking for a day the server hasn't
 *  reached (see startTodayPuzzle). */
export async function fetchLeaderboard(
  board: LeaderboardBoard,
  mode: DailyMode | 'versus',
  day?: string,
): Promise<LeaderboardResponse> {
  const url = new URL(`${HEARDLE_BASE}/leaderboard/`)
  url.searchParams.set('board', board)
  if (board !== 'versus') url.searchParams.set('mode', mode)
  if (day) url.searchParams.set('day', day)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<LeaderboardResponse>(url.toString(), { headers })
}
