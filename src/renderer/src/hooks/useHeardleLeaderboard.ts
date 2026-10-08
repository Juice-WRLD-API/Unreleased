// State for Heardle's Leaderboard panel - identical between the desktop
// modal and the mobile Sheet; only the wrapping JSX differs between the two
// views. (Desktop additionally memoized `day = todayKey()` as an effect
// dependency; todayKey() never changes across a panel's mount lifetime, so
// that dependency was inert and is dropped here rather than carried along.)
import { useEffect, useMemo, useState } from 'react'
import { HEARDLE_LEADERBOARD_ENABLED, fetchLeaderboard, outboxSize, versusWins } from '../lib/heardleApi'
import type { LeaderboardBoard, LeaderboardEntry } from '../lib/heardleApi'
import type { DailyMode } from '../lib/heardle'

export function useHeardleLeaderboard(initialMode: DailyMode, signedIn: boolean): {
  board: LeaderboardBoard
  setBoard: (b: LeaderboardBoard) => void
  mode: DailyMode
  setMode: (m: DailyMode) => void
  entries: LeaderboardEntry[]
  me: LeaderboardEntry | null
  loading: boolean
  error: string | null
  pending: number
  needsSignIn: boolean
  score: (e: LeaderboardEntry) => string
  emptyMessage: string
} {
  const [board, setBoard] = useState<LeaderboardBoard>('today')
  const [mode, setMode] = useState<DailyMode>(initialMode)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [me, setMe] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useMemo(() => outboxSize(), [])

  // The 1v1 table is a public ranking - readable signed out, unlike the daily
  // boards which are scoped to the caller. One definition, used by both the
  // fetch and the render: when these drifted apart the versus board fetched
  // fine and then rendered the sign-in prompt over it.
  const needsSignIn = board !== 'versus' && !signedIn

  useEffect(() => {
    if (!HEARDLE_LEADERBOARD_ENABLED || needsSignIn) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const fetchMode = board === 'versus' ? 'versus' : mode
    // No day param - the server answers for its own today, which is the same
    // calendar the rounds are graded against (see startTodayPuzzle).
    fetchLeaderboard(board, fetchMode)
      .then((res) => {
        if (cancelled) return
        setEntries(res.entries ?? [])
        setMe(res.me ?? null)
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [board, mode, needsSignIn])

  const score = (e: LeaderboardEntry): string => {
    if (board === 'versus') return `${versusWins(e)}W · ${e.win_rate ?? 0}%`
    if (board === 'streak') return `${e.current_streak ?? 0}`
    if (e.won === false || e.guesses == null) return '—'
    return `${e.guesses}`
  }

  const emptyMessage = board === 'versus'
    ? 'No matches played yet.'
    : board === 'today'
      ? "Nobody's finished today's round yet."
      : 'No streaks going yet.'

  return { board, setBoard, mode, setMode, entries, me, loading, error, pending, needsSignIn, score, emptyMessage }
}
