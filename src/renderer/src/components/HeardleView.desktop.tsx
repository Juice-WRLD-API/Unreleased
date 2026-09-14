import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, Play, Pause, SkipForward, Search, X, Check, Music2,
  BarChart3, Share2, RefreshCw, AlertCircle, Loader2, Volume2, SlidersHorizontal, RotateCcw, Trophy,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { Avatar } from './adminShared'
import { apiFetch, songToTrack, buildStreamUrl, smallCoverUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { eraFullName, loadEraFullNames } from '../lib/eras'
import {
  MIN_TRIES, MAX_TRIES, POOL_LABELS, DEFAULT_SETTINGS,
  loadPools, loadVersionGroups, filterByEra, poolEras,
  pickDailySong, pickPersonalSong, pickRandomSong, playerSeed, clipStart,
  searchPool, matchedAlias, isCorrectGuess, stageLadder, settingsForMode, clampTries,
  todayKey, puzzleNumber, msUntilNextPuzzle, unlockedSeconds,
  loadRound, saveRound, loadPracticeRound, savePracticeRound,
  loadGameMode, saveGameMode, loadStats, recordResult, shareText,
  loadSettings, saveSettings, revealCoverUrl,
} from '../lib/heardle'
import type {
  HeardleSong, Guess, GameStatus, PoolId, Stats, DailyMode, VersionMap, HeardleSettings,
} from '../lib/heardle'
import {
  HEARDLE_LEADERBOARD_ENABLED, fetchLeaderboard, submitResult, flushResults, outboxSize, versusWins,
  startTodayPuzzle, submitGuess as apiSubmitGuess, skipGuess as apiSkipGuess, absoluteClipUrl,
} from '../lib/heardleApi'
import type { LeaderboardBoard, LeaderboardEntry, PuzzleResponse } from '../lib/heardleApi'
import HeardleVersusPanel from './HeardleVersusPanel'
import { GameSwitcher, GameBackdrop, Field, Segmented, numberInput } from './gameShell'

type Mode = DailyMode | 'unlimited' | 'versus'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'daily', label: 'Daily', hint: 'One song a day - the same one for everyone' },
  { id: 'personal', label: 'Personal', hint: 'One song a day, picked just for you' },
  { id: 'versus', label: '1v1', hint: 'Real-time match against another player' },
  { id: 'unlimited', label: 'Unlimited', hint: 'Random songs, play as many as you like' },
]

function formatSeconds(s: number): string {
  const clamped = Math.max(0, s)
  return `0:${String(Math.floor(clamped)).padStart(2, '0')}`
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** Seconds for a button label: "1S", "2.5S". */
function secLabel(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}S`
}

/** Seconds as a position in a song: "1:23". */
function formatClock(s: number): string {
  const total = Math.max(0, Math.floor(s))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ─── Scope ────────────────────────────────────────────────────────────────────

const WAVE_BARS = 56

/** Bar heights for the scope. Deterministic from the song id so a round always
 *  looks the same (and a reload doesn't reshuffle it mid-guess) - this is a
 *  decorative readout, not analysis of the actual audio, which would mean
 *  decoding the file we're deliberately only streaming 16 seconds of. */
function barHeights(seed: number, count: number): number[] {
  const out: number[] = []
  let x = (seed || 1) >>> 0
  for (let i = 0; i < count; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out.push(0.16 + (x / 0x1_0000_0000) * 0.84)
  }
  return out
}

/** The clip as a scope: solid up to the playhead, dim out to what's unlocked,
 *  barely there beyond it - so the bars carry the same information the old
 *  progress bar did, plus a sense of how much song is still locked. */
function Waveform({ seed, unlocked, elapsed, ladder, playing, startAt }: {
  seed: number; unlocked: number; elapsed: number; ladder: number[]; playing: boolean; startAt: number
}) {
  const full = ladder[ladder.length - 1]
  const heights = useMemo(() => barHeights(seed, WAVE_BARS), [seed])
  return (
    <div className="relative h-24 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)]/40 px-3 pb-3 pt-6 overflow-hidden">
      {/* Where in the song this clip was cut from. Harmless to show - it says
          nothing about which song it is - and without it a timestamp start
          just looks like the audio is broken. */}
      <span className="absolute top-2 left-3 text-[9px] font-mono uppercase tracking-[0.2em] text-text-muted">
        {startAt > 0 ? `@ ${formatClock(startAt + elapsed)}` : 'From the top'}
      </span>
      <span className="absolute top-2 right-3 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-text-muted">
        <span className={`w-1.5 h-1.5 rounded-full bg-accent ${playing ? 'animate-pulse' : 'opacity-40'}`} />
        Rec
      </span>
      <div className="flex items-end justify-between gap-px h-full">
        {heights.map((h, i) => {
          const at = ((i + 0.5) / WAVE_BARS) * full
          const state = at <= elapsed ? 'played' : at <= unlocked ? 'unlocked' : 'locked'
          return (
            <span
              key={i}
              className={`flex-1 rounded-sm transition-colors duration-100 ${
                state === 'played' ? 'bg-accent'
                  : state === 'unlocked' ? 'bg-accent/30'
                    : 'bg-[var(--text-muted)]/15'
              }`}
              style={{ height: `${h * 100}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** The guess slots, left to right - the round's progress at a glance. The one
 *  you're on glows; finished ones carry their result's colour. */
function SlotRow({ ladder, guesses, status, showEraHint }: {
  ladder: number[]; guesses: Guess[]; status: GameStatus; showEraHint: boolean
}) {
  return (
    <div className="flex gap-1.5 sm:gap-2">
      {ladder.map((secs, i) => {
        const guess = guesses[i]
        const won = status === 'won' && i === guesses.length - 1
        const active = !guess && i === guesses.length && status === 'playing'
        const tone = won ? 'border-accent bg-accent/20'
          : !guess ? (active
            ? 'border-accent bg-accent/10 shadow-[0_0_18px_-6px_var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface-overlay)]/30')
            : guess.songId === null ? 'border-[var(--border)] bg-[var(--surface-overlay)]/60'
              : guess.sameEra && showEraHint ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-red-500/40 bg-red-500/10'
        return (
          <div
            key={i}
            title={guess ? (guess.songId === null ? 'Skipped' : guess.label) : `${secLabel(secs)} unlocked`}
            className={`flex-1 h-11 sm:h-12 rounded-xl border transition-all duration-200 ${tone}`}
          />
        )
      })}
    </div>
  )
}

/** One of the six slots - empty, a skip, a wrong guess, or the winning one.
 *  Only the final guess of a won round is `correct`. */
function GuessRow({ guess, index, correct, showEraHint }: {
  guess: Guess | undefined; index: number; correct: boolean; showEraHint: boolean
}) {
  if (!guess) {
    return (
      <div className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]/40 flex items-center px-3">
        <span className="text-xs text-text-muted">{index + 1}</span>
      </div>
    )
  }
  const skipped = guess.songId === null
  return (
    <div
      className={`h-10 rounded-lg border flex items-center gap-2 px-3 ${
        correct
          ? 'border-accent/50 bg-accent/15 text-text-primary'
          : skipped
            ? 'border-[var(--border)] bg-[var(--surface-raised)]/40 text-text-muted'
            : guess.sameEra && showEraHint
              ? 'border-amber-500/40 bg-amber-500/10 text-text-primary'
              : 'border-[var(--border)] bg-[var(--surface-raised)] text-text-primary'
      }`}
    >
      {correct
        ? <Check size={14} className="shrink-0 text-accent" />
        : skipped
          ? <SkipForward size={14} className="shrink-0" />
          : <X size={14} className="shrink-0 text-red-400" />}
      <span className="text-sm truncate">{skipped ? 'Skipped' : guess.label}</span>
      {!correct && !skipped && guess.sameEra && showEraHint && (
        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-amber-400">
          Same era
        </span>
      )}
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────────────────
//
// Field/Segmented/numberInput live in ./gameShell - Wordle's panel is built
// from the same rows, and two copies drifting apart would make one game's
// settings sheet quietly stop matching the other's.

/** Game rules for Unlimited. The daily modes ignore all of them (see
 *  settingsForMode), so the panel says which mode it's editing rather than
 *  presenting live-looking controls that silently do nothing. */
function SettingsPanel({ settings, onChange, eras, mode, onClose }: {
  settings: HeardleSettings
  onChange: (s: HeardleSettings) => void
  eras: { era: string; count: number }[]
  mode: Mode
  onClose: () => void
}) {
  const set = <K extends keyof HeardleSettings>(key: K, value: HeardleSettings[K]): void =>
    onChange({ ...settings, [key]: value })

  const ladder = stageLadder(settings)
  const toggleEra = (era: string): void =>
    set('eras', settings.eras.includes(era) ? settings.eras.filter((e) => e !== era) : [...settings.eras, era])
  const toggleCategory = (cat: PoolId): void => {
    const next = settings.categories.includes(cat)
      ? settings.categories.filter((c) => c !== cat)
      : [...settings.categories, cat]
    // Never leave nothing to draw from.
    if (next.length > 0) set('categories', next)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <SlidersHorizontal size={16} className="text-accent" />
          <h2 className="text-text-primary font-bold">Game settings</h2>
          <button
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            title="Reset to defaults"
            className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-text-muted mb-3">
          These apply to <span className="text-text-secondary font-semibold">Unlimited</span> only. Daily and
          Personal always run the standard rules - their results are headed for a leaderboard, and a
          six-try round and a ten-try round aren't the same achievement.
        </p>
        {mode !== 'unlimited' && (
          <p className="text-xs text-accent bg-accent/10 border border-accent/25 rounded-lg px-3 py-2 mb-4">
            You're playing {mode === 'personal' ? 'Personal' : 'Daily'} right now - nothing here changes
            that round. Switch to Unlimited to play by these.
          </p>
        )}

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Difficulty</h3>
        <Field label="Tries" hint={`${MIN_TRIES}–${MAX_TRIES} guesses per song`}>
          <input
            type="number"
            min={MIN_TRIES}
            max={MAX_TRIES}
            value={settings.tries}
            onChange={(e) => set('tries', clampTries(Number(e.target.value)))}
            className={numberInput}
          />
        </Field>
        <Field label="Snippet lengths" hint={settings.ladder === 'classic' ? 'Gaps grow each miss' : 'Same amount each miss'}>
          <Segmented
            options={[{ id: 'classic', label: 'Classic' }, { id: 'linear', label: 'Even' }]}
            value={settings.ladder}
            onChange={(v) => set('ladder', v)}
          />
        </Field>
        {settings.ladder === 'linear' && (
          <>
            <Field label="First snippet" hint="Seconds you hear before guessing">
              <input
                type="number" min={0.5} max={30} step={0.5}
                value={settings.startSeconds}
                onChange={(e) => set('startSeconds', Math.max(0.5, Number(e.target.value)))}
                className={numberInput}
              />
            </Field>
            <Field label="Added per miss" hint="Seconds unlocked by each wrong guess">
              <input
                type="number" min={0.5} max={30} step={0.5}
                value={settings.stepSeconds}
                onChange={(e) => set('stepSeconds', Math.max(0.5, Number(e.target.value)))}
                className={numberInput}
              />
            </Field>
          </>
        )}
        <Field
          label="Clip starts at"
          hint={settings.startPoint === 'intro'
            ? "The song's opening seconds"
            : 'A timestamp somewhere inside the song'}
        >
          <Segmented
            options={[{ id: 'timestamp', label: 'Timestamp' }, { id: 'intro', label: 'Intro' }]}
            value={settings.startPoint}
            onChange={(v) => set('startPoint', v)}
          />
        </Field>
        <Field label="Era hint" hint="Flag wrong guesses from the answer's era">
          <Segmented
            options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
            value={settings.eraHint ? 'on' : 'off'}
            onChange={(v) => set('eraHint', v === 'on')}
          />
        </Field>
        <p className="text-xs text-text-muted py-3">
          Ladder: {ladder.map((s) => `${s}s`).join(' → ')}
        </p>

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mt-4 mb-1">Song pool</h3>
        <div className="py-3 border-b border-[var(--border)]">
          <div className="text-sm text-text-primary font-medium mb-2">Catalogues</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(POOL_LABELS) as PoolId[]).map((c) => (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  settings.categories.includes(c)
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-[var(--border)] text-text-muted hover:text-text-primary'
                }`}
              >
                {POOL_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-sm text-text-primary font-medium">Eras</div>
            <span className="text-xs text-text-muted">
              {settings.eras.length === 0 ? 'All' : `${settings.eras.length} selected`}
            </span>
            {settings.eras.length > 0 && (
              <button onClick={() => set('eras', [])} className="ml-auto text-xs text-accent hover:underline">
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {eras.map(({ era, count }) => (
              <button
                key={era}
                onClick={() => toggleEra(era)}
                title={eraFullName(era) ?? era}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  settings.eras.includes(era)
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-[var(--border)] text-text-muted hover:text-text-primary'
                }`}
              >
                {era} <span className="opacity-60">{count}</span>
              </button>
            ))}
            {eras.length === 0 && <span className="text-xs text-text-muted">Loading…</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One past the deepest guess-count that's ever won a round. */
function lastUsedBucket(stats: Stats): number {
  for (let i = stats.distribution.length - 1; i >= 0; i--) {
    if (stats.distribution[i] > 0) return i + 1
  }
  return 0
}

/** Streaks are per-mode, so the panel is too - it reads straight from storage
 *  on open rather than mirroring the round's state. */
function StatsPanel({ initialMode, onClose }: { initialMode: DailyMode; onClose: () => void }) {
  const [tab, setTab] = useState<DailyMode>(initialMode)
  const stats: Stats = useMemo(() => loadStats(tab), [tab])
  const max = Math.max(1, ...stats.distribution)
  const winRate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-accent" />
          <h2 className="text-text-primary font-bold">Statistics</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden mb-4">
          {(['daily', 'personal'] as DailyMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setTab(m)}
              className={`flex-1 px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                tab === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 mb-5 text-center">
          {[
            { label: 'Played', value: stats.played },
            { label: 'Win %', value: winRate },
            { label: 'Streak', value: stats.currentStreak },
            { label: 'Best', value: stats.maxStreak },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-text-primary text-xl font-bold">{s.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
        {/* The distribution is stored at the maximum width, but showing ten
            empty rows to someone playing six-try rounds is noise - trim to the
            deepest bucket that's actually been used. */}
        <div className="space-y-1.5">
          {stats.distribution.slice(0, Math.max(DEFAULT_SETTINGS.tries, lastUsedBucket(stats))).map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 text-xs text-text-muted">{i + 1}</span>
              <div className="flex-1 h-5 rounded bg-[var(--surface-overlay)] overflow-hidden">
                <div
                  className="h-full bg-accent/70 flex items-center justify-end px-1.5"
                  style={{ width: `${Math.max(6, (n / max) * 100)}%` }}
                >
                  <span className="text-[10px] font-bold text-white">{n}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

/** Standings for the two once-a-day modes. Both run fixed rules (see
 *  settingsForMode), which is what makes a ranking mean anything.
 *
 *  The endpoint doesn't exist yet - see lib/heardleApi. Until it does this
 *  shows what's waiting to be sent rather than pretending to be empty. */
function LeaderboardPanel({ initialMode, signedIn, onClose }: {
  initialMode: DailyMode
  signedIn: boolean
  onClose: () => void
}) {
  const [board, setBoard] = useState<LeaderboardBoard>('today')
  const [mode, setMode] = useState<DailyMode>(initialMode)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [me, setMe] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const day = useMemo(() => todayKey(), [])
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
    // No day: the server answers for its own today, which is the calendar the
    // rounds are actually graded against.
    fetchLeaderboard(board, fetchMode)
      .then((res) => {
        if (cancelled) return
        setEntries(res.entries ?? [])
        setMe(res.me ?? null)
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [board, mode, day, needsSignIn])

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

  const row = (e: LeaderboardEntry, isMe: boolean): JSX.Element => (
    <div
      key={`${e.user_id}-${e.rank}`}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
        isMe ? 'bg-accent/15 border border-accent/30' : ''
      }`}
    >
      <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-text-muted text-right">{e.rank}</span>
      <Avatar src={e.discord_avatar ?? undefined} name={e.display_name} size={7} />
      <span className="min-w-0 flex-1 text-sm text-text-primary truncate">{e.display_name}</span>
      {board === 'streak' && e.max_streak != null && (
        <span className="shrink-0 text-[10px] text-text-muted">best {e.max_streak}</span>
      )}
      <span className="shrink-0 text-sm font-bold tabular-nums text-text-primary">{score(e)}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-accent" />
          <h2 className="text-text-primary font-bold">Leaderboard</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {([['today', 'Today'], ['streak', 'Streaks'], ['versus', '1v1']] as [LeaderboardBoard, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setBoard(id)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  board === id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={`flex rounded-lg border border-[var(--border)] overflow-hidden ml-auto ${board === 'versus' ? 'opacity-40 pointer-events-none' : ''}`}>
            {(['daily', 'personal'] as DailyMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  mode === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {needsSignIn ? (
          <div className="py-8 text-center">
            <p className="text-sm text-text-muted">Sign in to appear on the leaderboard.</p>
            {pending > 0 && (
              <p className="text-xs text-text-muted mt-2 leading-relaxed">
                {pending} finished {pending === 1 ? 'round is' : 'rounds are'} saved on this device and
                will be sent when you do, so you won&apos;t start from zero.
              </p>
            )}
          </div>
        ) : loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-400">{error}</p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>
        ) : (
          <>
            <div className="space-y-0.5">
              {entries.map((e) => row(e, e.user_id === me?.user_id))}
            </div>
            {/* Your own row again when you placed outside the page. */}
            {me && !entries.some((e) => e.user_id === me.user_id) && (
              <div className="mt-2 pt-2 border-t border-[var(--border)]">{row(me, true)}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function HeardleView(): JSX.Element {
  const { setActiveView, playTrack, setIsPlaying, isPlaying, volume, setVolume, account } = useStorePick(
    'setActiveView', 'playTrack', 'setIsPlaying', 'isPlaying', 'volume', 'setVolume', 'account')

  const [mode, setMode] = useState<Mode>(() => loadGameMode())
  const [settings, setSettings] = useState<HeardleSettings>(() => loadSettings())
  const [pool, setPool] = useState<HeardleSong[]>([])
  const [poolLoading, setPoolLoading] = useState(true)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionMap>(() => new Map())

  const [answer, setAnswer] = useState<HeardleSong | null>(null)
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  // Which mode the round in state was dealt for. On the render a mode switch
  // happens, the round below is still the old mode's - without this the save
  // effects would file it under the new mode's key before the setup effect's
  // state lands, overwriting a daily round with a practice one.
  const [roundMode, setRoundMode] = useState<DailyMode | 'unlimited'>('daily')

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioError, setAudioError] = useState(false)

  const [showStats, setShowStats] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle())
  const [copied, setCopied] = useState(false)
  const [startAt, setStartAt] = useState(0)
  const [roundToken, setRoundToken] = useState<string | null>(null)
  const [serverClipUrl, setServerClipUrl] = useState<string | null>(null)
  const [waveSeed, setWaveSeed] = useState(1)
  const [serverLadder, setServerLadder] = useState<number[] | null>(null)
  // The server's calendar day and puzzle number for the current round. Null
  // until it answers (or on the offline/signed-out path), where the local
  // date stands in.
  const [serverDay, setServerDay] = useState<string | null>(null)
  const [serverPuzzleNo, setServerPuzzleNo] = useState<number | null>(null)
  // Round failures are their own thing - reporting them as "couldn't load the
  // catalogue" sent me looking at the songs endpoint for a date bug.
  const [roundError, setRoundError] = useState<string | null>(null)

  const isDaily = mode !== 'unlimited' && mode !== 'versus'
  const useServerRound = isDaily && !!account
  const dailyMode: DailyMode = mode === 'personal' ? 'personal' : 'daily'
  // The mode the round in state should belong to. Compared against roundMode
  // to tell "the round on screen" from "the round the tabs are now asking
  // for" - they differ for one render after every mode switch.
  const wantedRoundMode: DailyMode | 'unlimited' = mode === 'unlimited' ? 'unlimited' : dailyMode
  const localDay = useMemo(() => todayKey(), [])
  // Every day-keyed thing below uses this, never todayKey() directly: on the
  // server path the round belongs to the server's day, and storing it under
  // this machine's date would split one round across two keys near midnight.
  const day = serverDay ?? localDay

  // Which settings actually apply here - Daily ignores all of them, Personal
  // takes the difficulty half. Everything below reads `rules`, never
  // `settings`, so the mode rules live in exactly one place.
  const rules = useMemo(
    () => settingsForMode(settings, mode === 'personal' ? 'personal' : mode === 'unlimited' ? 'unlimited' : 'daily'),
    [settings, mode],
  )
  // On the signed-in daily path the server owns the round and grades against
  // its own ladder, so that ladder - not the local settings - has to drive the
  // slot count, the unlocked window and the playback cutoff. Deriving them
  // locally would show a different number of tries than the server allows and
  // cut the clip at a different second than it intends.
  const localLadder = useMemo(() => stageLadder(rules), [rules])
  const ladder = useServerRound && serverLadder && serverLadder.length > 0
    ? serverLadder
    : localLadder
  // Daily/Personal pin `rules.categories` to ['released'] - right for the
  // *difficulty* rules (settingsForMode), wrong for the *guess pool*: a
  // server-graded round is drawn from the server's own catalog, not the
  // client's, and there's no reason to believe that stays inside 'released'.
  // If it doesn't, an answer outside this pool is one the player can never
  // type in - searchPool below only ever sees what's fetched here, so a
  // missing category isn't a harder guess, it's an unwinnable one. Search
  // every category on a server round; only the local fallback (signed out,
  // or Unlimited) needs the restriction, since there the same pool is what
  // picks the answer in the first place.
  const categories: PoolId[] = useServerRound
    ? (Object.keys(POOL_LABELS) as PoolId[])
    : rules.categories

  const finished = status !== 'playing'
  const unlocked = unlockedSeconds(guesses.length, finished, ladder)

  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number | null>(null)
  const limitRef = useRef(unlocked)
  const startRef = useRef(startAt)
  useEffect(() => { limitRef.current = unlocked }, [unlocked])
  useEffect(() => { startRef.current = startAt }, [startAt])

  useEffect(() => { saveSettings(settings) }, [settings])
  useEffect(() => { loadEraFullNames().catch(() => undefined) }, [])

  // ── Pool ───────────────────────────────────────────────────────────────────
  // `categories` is an array in state, so key the effect on its contents - a
  // fresh array every render would otherwise refetch (and re-roll) endlessly.
  const categoryKey = categories.join(',')
  useEffect(() => {
    let cancelled = false
    setPoolLoading(true)
    setPoolError(null)
    loadPools(categoryKey.split(',') as PoolId[])
      .then((songs) => { if (!cancelled) { setPool(songs); setPoolLoading(false) } })
      .catch((err: Error) => { if (!cancelled) { setPoolError(err.message); setPoolLoading(false) } })
    return () => { cancelled = true }
  }, [categoryKey])

  // The era filter narrows what's already loaded - no refetch, and the guess
  // dropdown narrows with it, which is the point: a Goodbye & Good Riddance
  // round shouldn't autocomplete songs that can't be the answer.
  const eraKey = rules.eras.join(',')
  const playablePool = useMemo(
    () => filterByEra(pool, eraKey ? eraKey.split(',') : []),
    [pool, eraKey])
  const availableEras = useMemo(() => poolEras(pool), [pool])

  // Version links load behind the pool - a round is playable without them,
  // they only widen what counts as correct. Empty on failure.
  useEffect(() => {
    if (pool.length === 0) return
    let cancelled = false
    loadVersionGroups(pool)
      .then((map) => { if (!cancelled) setVersions(map) })
      .catch(() => { if (!cancelled) setVersions(new Map()) })
    return () => { cancelled = true }
  }, [pool])

  // ── Round setup ────────────────────────────────────────────────────────────
  // The daily modes restore whatever was already guessed today; unlimited
  // starts fresh whenever the pool (or the mode) changes.
  //
  // Deliberately not keyed on the difficulty settings: changing tries or the
  // ladder mid-round must not re-roll a once-a-day song. A tries cut that
  // strands a round over the new limit is settled below instead.
  const fullWindow = ladder[ladder.length - 1]

  const applyServerPuzzle = useCallback((res: PuzzleResponse) => {
    setRoundToken(res.round_token)
    // Tag the round with the mode it was fetched for, same as the local paths
    // do - the stats fold below keys off it.
    setRoundMode(dailyMode)
    // The server's calendar wins. Everything keyed by day - the saved round,
    // the stats entry, the share text - must use the day the round was
    // actually graded against, not this machine's local date.
    if (res.day) setServerDay(res.day)
    if (res.puzzle_number != null) setServerPuzzleNo(res.puzzle_number)
    // Fall back to the local ladder only when the server didn't send one -
    // a short/absent ladder must not silently shrink the round.
    setServerLadder(Array.isArray(res.ladder) && res.ladder.length > 0 ? res.ladder : null)
    setServerClipUrl(absoluteClipUrl(res.clip_url))
    setStartAt(res.clip_start ?? 0)
    setGuesses(res.guesses ?? [])
    setStatus(res.status)
    setWaveSeed(res.round_token.split('').reduce((a, c) => a + c.charCodeAt(0), 0))
    if (res.reveal) setAnswer(res.reveal)
    else if (res.status !== 'playing') setAnswer(res.reveal ?? null)
    else setAnswer(null)
  }, [dailyMode])

  useEffect(() => {
    if (!useServerRound) return
    let cancelled = false
    setRoundError(null)
    startTodayPuzzle(dailyMode)
      .then((res) => { if (!cancelled) applyServerPuzzle(res) })
      .catch((err: Error) => { if (!cancelled) setRoundError(err.message) })
    return () => { cancelled = true }
  }, [useServerRound, dailyMode, applyServerPuzzle])

  useEffect(() => {
    if (playablePool.length === 0 || useServerRound) return
    const seed = playerSeed()
    if (isDaily) {
      const song = dailyMode === 'personal'
        ? pickPersonalSong(playablePool, day, seed)
        : pickDailySong(playablePool, day)
      if (!song) return
      setAnswer(song)
      const saved = loadRound(dailyMode, day, song.id)
      setGuesses(saved?.guesses ?? [])
      setStatus(saved?.status ?? 'playing')
      // Same seed every load, so a refresh can't shop for a kinder offset.
      setStartAt(clipStart(song, fullWindow, rules.startPoint, `${seed}-${dailyMode}-${day}`))
      setRoundMode(dailyMode)
    } else {
      // Practice picks up where it was left, unless the saved song has since
      // fallen out of the pool (the era filter or the catalogue moved under
      // it) - then there's nothing to resume against and it deals a new one.
      const saved = loadPracticeRound()
      const resumed = saved ? playablePool.find((s) => s.id === saved.answerId) : undefined
      if (saved && resumed) {
        setAnswer(resumed)
        setGuesses(saved.guesses)
        setStatus(saved.status)
        setStartAt(saved.startAt)
      } else {
        const song = pickRandomSong(playablePool)
        setAnswer(song)
        setGuesses([])
        setStatus('playing')
        setStartAt(song ? clipStart(song, fullWindow, rules.startPoint, null) : 0)
      }
      setRoundMode('unlimited')
    }
    setQuery('')
    setElapsed(0)
    // fullWindow/startPoint are read, not depended on: they only decide where a
    // freshly-picked song starts, and re-running this on a settings change
    // would re-roll the round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playablePool, isDaily, dailyMode, day])

  // A tries cut can leave a saved round already at or past the new limit.
  // Settle it as a loss rather than showing a round that can't be played on.
  //
  // Never on the server path: there the round's status is the server's to
  // decide, and forcing a loss locally because a stale ladder looked full
  // would report a defeat for a round the server still has open.
  //
  // And only against the round it's actually judging: on a mode switch the
  // guesses here are still the old mode's, and a ten-try practice round
  // measured against Daily's six would settle the round being restored as a
  // loss it never played.
  useEffect(() => {
    if (useServerRound || roundMode !== wantedRoundMode) return
    if (status === 'playing' && guesses.length >= ladder.length) setStatus('lost')
  }, [useServerRound, roundMode, wantedRoundMode, status, guesses.length, ladder.length])

  // Persist the round after every guess.
  useEffect(() => {
    if (!isDaily || useServerRound || !answer || roundMode !== wantedRoundMode) return
    saveRound(dailyMode, { day, answerId: answer.id, guesses, status })
  }, [isDaily, useServerRound, dailyMode, roundMode, wantedRoundMode, answer, day, guesses, status])

  // Same for practice, under its own key - see loadPracticeRound. The clip
  // offset rides along: it was rolled at random for this round and can't be
  // derived again.
  useEffect(() => {
    if (mode !== 'unlimited' || roundMode !== wantedRoundMode || !answer) return
    savePracticeRound({ answerId: answer.id, guesses, status, startAt })
  }, [mode, roundMode, wantedRoundMode, answer, guesses, status, startAt])

  // 1v1 is live, so it's never what the tab reopens on (see saveGameMode).
  useEffect(() => { if (mode !== 'versus') saveGameMode(mode) }, [mode])

  // Fold a finished round into that mode's stats (once - see recordResult's
  // lastDay guard) and hand it to the leaderboard. submitResult queues rather
  // than throwing while the endpoint is missing or the user is signed out, so
  // rounds played today still count once it's live.
  useEffect(() => {
    if (!isDaily || status === 'playing') return
    if (!useServerRound && !answer) return
    // Never fold a round that belongs to another mode: a finished practice
    // round left on screen would otherwise be recorded as today's daily
    // result the moment the Daily tab is clicked.
    if (roundMode !== wantedRoundMode) return
    // Both paths, always. The Stats panel reads localStorage and nothing else,
    // so a server-graded round has to be folded in here too - gating this on
    // the local path would freeze the streak, distribution and played count
    // for exactly the signed-in players the leaderboard is for. recordResult
    // is idempotent per day, so the server path re-running it is harmless.
    recordResult(dailyMode, day, status === 'won', guesses.length)
    if (useServerRound && answer) {
      submitResult({
        day,
        mode: dailyMode,
        song_id: answer.id,
        guesses: guesses.length,
        won: status === 'won',
        guess_song_ids: guesses.map((g) => g.songId),
      })
    }
  }, [isDaily, useServerRound, dailyMode, roundMode, wantedRoundMode, status, day, guesses.length, answer])

  // Deliver anything queued in an earlier session.
  useEffect(() => { flushResults() }, [account])

  useEffect(() => {
    if (!finished) return
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000)
    return () => clearInterval(id)
  }, [finished])

  // ── Playback ───────────────────────────────────────────────────────────────
  // A dedicated element rather than the app's player: this has to start at a
  // fixed point, cut off mid-song, and never touch the queue or what the user
  // was listening to. It's deliberately outside the Web Audio effects chain
  // too - the EQ shouldn't colour the clue.
  //
  // Positions are tracked relative to `startAt`, since a "random" clip start
  // means the element's currentTime is offset from what the player sees.
  // ── Silence detection ──────────────────────────────────────────────────────
  // A timestamp start can easily land in a gap - an intro pad, the beat of air
  // between verses - and a one-second clip of nothing is unguessable. So the
  // budget is spent in *audible* seconds: quiet is hopped over and doesn't
  // count against the unlock.
  //
  // This needs a private Web Audio graph on the game's element. Deliberately
  // not the shared effects chain (lib/audioEffects) - the EQ must never colour
  // the clue - but it carries the same CORS requirement: without
  // crossOrigin="anonymous" on the element, createMediaElementSource emits
  // pure silence. The API sends Access-Control-Allow-Origin, same as it does
  // for the main player.
  //
  // If any of it throws, analysis is simply off and the clip plays straight
  // through. A missing skip is a worse round; a broken graph is no audio.
  const analyserRef = useRef<AnalyserNode | null>(null)
  // Typed as the ArrayBuffer-backed variant getFloatTimeDomainData expects -
  // a bare Float32Array widens to ArrayBufferLike and won't assign.
  const analyserBufRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const graphFailedRef = useRef(false)

  const ensureAnalyser = useCallback((audio: HTMLAudioElement): boolean => {
    if (analyserRef.current) return true
    if (graphFailedRef.current) return false
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      source.connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      analyserBufRef.current = new Float32Array(analyser.fftSize)
      return true
    } catch {
      graphFailedRef.current = true
      return false
    }
  }, [])

  /** Peak amplitude of what's coming out right now (0..1). The signal is
   *  scaled by the element's volume, so the caller's threshold must be too. */
  const currentPeak = useCallback((): number => {
    const analyser = analyserRef.current
    const buf = analyserBufRef.current
    if (!analyser || !buf) return 1
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i])
      if (v > peak) peak = v
    }
    return peak
  }, [])

  // Audible seconds heard so far this play - this, not wall-clock position, is
  // what the unlock is measured in.
  const audibleRef = useRef(0)
  const lastTickRef = useRef(0)
  const silentSinceRef = useRef<number | null>(null)

  // Every start claims a token. Anything that ends playback bumps it, so the
  // async continuations below (waiting on metadata, on a seek, on play()) can
  // tell they've been superseded - a start that was still loading when the
  // view went away would otherwise land on a detached element and play the
  // song through, unsupervised. Refs survive unmount; audioRef.current doesn't.
  const playTokenRef = useRef(0)

  const stopPlayback = useCallback((): void => {
    playTokenRef.current++
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.currentTime = startRef.current }
    audibleRef.current = 0
    lastTickRef.current = 0
    silentSinceRef.current = null
    setPlaying(false)
    setPreparing(false)
    setElapsed(0)
  }, [])

  // Silence has to be quiet for a moment before it counts - inter-word gaps
  // and drum rests are part of a song, not dead air. Hops are short so the
  // onset of the next sound is never far past the landing point.
  const SILENCE_FLOOR = 0.005
  const SILENCE_HOLD_MS = 250
  const SILENCE_HOP_S = 0.4

  const tick = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    const now = performance.now()
    const dt = lastTickRef.current ? Math.min((now - lastTickRef.current) / 1000, 0.25) : 0
    lastTickRef.current = now

    // A stalled or seeking element outputs silence that isn't in the song -
    // don't bank it as audible and don't hop over it either.
    const settled = !audio.seeking && audio.readyState >= 2
    // Under a muted element, real silence and real audio look identical. The
    // only other reason to stand down is the graph having failed to build.
    const canDetect = !graphFailedRef.current
      && analyserRef.current !== null && audio.volume > 0.01
    const quiet = canDetect && settled && currentPeak() < SILENCE_FLOOR * audio.volume

    if (quiet) {
      if (silentSinceRef.current == null) silentSinceRef.current = now
      else if (now - silentSinceRef.current >= SILENCE_HOLD_MS) {
        const duration = isFinite(audio.duration) ? audio.duration : 0
        const cap = duration > 0 ? duration - 0.25 : audio.currentTime + SILENCE_HOP_S
        const next = Math.min(audio.currentTime + SILENCE_HOP_S, cap)
        // Out of song to skip into - end the clip rather than idle at the tail.
        if (next <= audio.currentTime) { stopPlayback(); return }
        audio.currentTime = next
      }
    } else {
      silentSinceRef.current = null
      if (settled) audibleRef.current += dt
    }

    if (audibleRef.current >= limitRef.current) { stopPlayback(); return }
    setElapsed(audibleRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [stopPlayback, currentPeak])

  /** Backstop cutoff. requestAnimationFrame drives the audible-time accounting
   *  above, but it stops firing while the page is hidden, so it cannot be the
   *  only thing ending a clip - this rides the element's own timeupdate, which
   *  keeps firing as long as audio is being decoded.
   *
   *  It measures wall-clock position, not audible time, so it has to allow for
   *  whatever silence the round is legitimately skipping past; the rAF path is
   *  what stops a normal clip on time. */
  const SILENCE_ALLOWANCE_S = 20
  const enforceLimit = useCallback((): void => {
    const audio = audioRef.current
    if (!audio || audio.paused) return
    const played = audio.currentTime - startRef.current
    if (played >= limitRef.current + SILENCE_ALLOWANCE_S) stopPlayback()
  }, [stopPlayback])

  const startPlayback = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    // Two things playing at once makes the clue unlistenable - yield the room.
    if (isPlaying) setIsPlaying(false)
    setAudioError(false)
    setPreparing(true)
    audio.volume = volume

    const token = ++playTokenRef.current
    const live = (): boolean => playTokenRef.current === token && !!audioRef.current

    // Built on first play (a user gesture), so the context isn't born
    // suspended. Autoplay policy can still suspend it later.
    ensureAnalyser(audio)
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {})
    audibleRef.current = 0
    lastTickRef.current = 0
    silentSinceRef.current = null

    // Seeking before the element knows the song's duration is silently
    // dropped, which put the clip back at 0:00 for every timestamp start -
    // wait for metadata (and the seek itself) before playing. Nothing to wait
    // for when the clip starts at the beginning.
    const begin = (): void => {
      if (!live()) { audio.pause(); return }
      audio.play()
        .then(() => {
          // play() resolves asynchronously too - the round can have ended, or
          // the view gone, in the meantime.
          if (!live()) { audio.pause(); return }
          setPreparing(false); setPlaying(true)
          rafRef.current = requestAnimationFrame(tick)
        })
        .catch(() => {
          if (!live()) return
          setPreparing(false); setAudioError(true); setPlaying(false)
        })
    }
    const seekThenPlay = (): void => {
      if (!live()) { audio.pause(); return }
      if (startRef.current <= 0 || Math.abs(audio.currentTime - startRef.current) < 0.25) { begin(); return }
      audio.addEventListener('seeked', begin, { once: true })
      audio.currentTime = startRef.current
    }
    if (audio.readyState >= 1 /* HAVE_METADATA */) seekThenPlay()
    else audio.addEventListener('loadedmetadata', seekThenPlay, { once: true })
  }, [isPlaying, setIsPlaying, volume, tick, ensureAnalyser])

  // Leaving the page stops the clip. Without this you could start a snippet,
  // switch away, and let the song run on underneath - the whole track for
  // free, on the first guess. Covers a backgrounded tab and a minimised
  // desktop window; navigating to another view unmounts this component, which
  // stops it through the cleanup below.
  useEffect(() => {
    const onVisibility = (): void => { if (document.hidden) stopPlayback() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stopPlayback])

  // New answer → new source, and never carry playback across rounds.
  useEffect(() => {
    stopPlayback()
    const audio = audioRef.current
    if (audio && useServerRound && serverClipUrl) audio.src = serverClipUrl
    else if (audio && answer) audio.src = buildStreamUrl(answer.path)
    setAudioError(false)
  }, [answer, serverClipUrl, useServerRound, stopPlayback])

  // Teardown. The element is captured on mount rather than read from the ref
  // in the cleanup: React detaches refs before passive cleanups run, so
  // audioRef.current can already be null here - and a paused-by-nobody element
  // keeps playing after the view is gone.
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      playTokenRef.current++
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      audio?.pause()
      // Contexts are a limited resource and this one is single-use.
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  // ── Guessing ───────────────────────────────────────────────────────────────
  // Suggestions come from the filtered pool: under an era filter, songs that
  // can't be the answer shouldn't be offered as guesses.
  const suggestions = useMemo(
    () => (query.trim() ? searchPool(playablePool, query, 50) : []),
    [playablePool, query])

  useEffect(() => { setHighlighted(0) }, [query])

  const commitGuess = (guess: Guess): void => {
    stopPlayback()
    const next = [...guesses, guess]
    setGuesses(next)
    if (next.length >= ladder.length) setStatus('lost')
    setQuery('')
    setDropdownOpen(false)
  }

  const submitGuess = (song: HeardleSong): void => {
    if (finished) return
    if (useServerRound && roundToken) {
      stopPlayback()
      apiSubmitGuess(roundToken, song.id)
        .then(applyServerPuzzle)
        .catch((err: Error) => setRoundError(err.message))
      setQuery('')
      setDropdownOpen(false)
      return
    }
    if (!answer) return
    if (isCorrectGuess(song, answer, versions)) {
      stopPlayback()
      setGuesses((prev) => [...prev, {
        songId: song.id,
        label: song.name,
        era: song.era,
        sameEra: false,
        viaVersion: song.id !== answer.id,
      }])
      setStatus('won')
      setQuery('')
      setDropdownOpen(false)
      return
    }
    commitGuess({
      songId: song.id,
      label: song.name,
      era: song.era,
      sameEra: !!song.era && song.era === answer.era,
    })
  }

  const skip = (): void => {
    if (finished) return
    if (useServerRound && roundToken) {
      stopPlayback()
      apiSkipGuess(roundToken).then(applyServerPuzzle).catch((err: Error) => setRoundError(err.message))
      return
    }
    if (!answer) return
    commitGuess({ songId: null, label: 'Skipped', era: null, sameEra: false })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((i) => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = suggestions[highlighted]; if (s) submitGuess(s) }
    else if (e.key === 'Escape') { setDropdownOpen(false) }
  }

  // ── Reveal actions ─────────────────────────────────────────────────────────
  // The pool is slimmed down, so hand the player the real song object (user
  // renames, preferred version, cover overrides all live on it).
  const playFullSong = async (): Promise<void> => {
    if (!answer) return
    stopPlayback()
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${answer.id}/`)
      playTrack(songToTrack(song))
    } catch {
      setAudioError(true)
    }
  }

  const share = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shareText(dailyMode, day, guesses, status, ladder.length))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const newRound = (): void => {
    stopPlayback()
    const song = pickRandomSong(playablePool)
    setAnswer(song)
    setStartAt(song ? clipStart(song, fullWindow, rules.startPoint, null) : 0)
    setGuesses([])
    setStatus('playing')
    setQuery('')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />
      {/* crossOrigin is load-bearing: the silence analyser routes this element
          through a MediaElementSource, which emits pure silence for media
          fetched without CORS clearance. Must be set before src (it is - this
          attribute is on the element, src is assigned in an effect). */}
      <audio
        ref={audioRef}
        preload="auto"
        crossOrigin="anonymous"
        onTimeUpdate={enforceLimit}
        onError={() => setAudioError(true)}
      />

      {/* Corner controls - the hero owns the middle, so navigation and the
          panels sit out of its way.
          z-20 (over the scroll container's z-10): the scroll container fills
          the whole view and comes later in the DOM, so at equal z it took every
          click in these corners and left the buttons visible but dead.
          no-drag: in Electron the frameless window's drag strip runs along the
          top of this pane, and an app-region rect swallows mouse events no
          matter what pointer-events says. */}
      <div
        className="absolute top-4 left-4 z-20"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setActiveView('wrld')}
          title="Back"
          className="p-2.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
      </div>
      <div
        className="absolute top-4 right-4 z-20 flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setShowSettings(true)}
          title="Game settings"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <SlidersHorizontal size={20} />
        </button>
        <button
          onClick={() => setShowLeaderboard(true)}
          title="Leaderboard"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Trophy size={20} />
        </button>
        <button
          onClick={() => setShowStats(true)}
          title="Statistics"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <BarChart3 size={20} />
        </button>
      </div>

      {/* z-10: the backdrop layers above are absolutely positioned, so content
          has to be positioned too or they paint over it. */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-xl">
          <GameSwitcher current="heardle" />

          {/* Hero */}
          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight inline-flex items-start gap-1">
              Juice WRLD Heardle
              <span className="text-accent text-sm font-mono font-bold mt-1">999</span>
            </h1>
            <p className="mt-2 text-[11px] font-mono lowercase tracking-[0.18em] text-text-muted">
              name the song from its opening seconds
            </p>
          </div>

          {/* Mode tabs */}
          <div className="flex items-center justify-center gap-6 mb-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={`pb-1.5 text-xs font-bold uppercase tracking-[0.2em] border-b-2 transition-colors ${
                  mode === m.id
                    ? 'text-text-primary border-accent'
                    : 'text-text-muted border-transparent hover:text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* The three modes are easy to confuse at a glance, so spell out what
              you're playing rather than leaving it to the tab labels. */}
          <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mb-3">
            {mode === 'daily' && `#${serverPuzzleNo ?? puzzleNumber(day)} · `}
            {MODES.find((m) => m.id === mode)?.hint.toLowerCase()}
            {mode !== 'versus' && ` · ${ladder.length} tries · up to ${formatSeconds(fullWindow)}`}
            {mode !== 'versus' && rules.startPoint === 'timestamp' ? ' · from a timestamp' : mode !== 'versus' ? ' · from the intro' : ''}
            {mode === 'unlimited' && rules.eras.length > 0 && ` · ${rules.eras.join(', ')}`}
          </p>

          {/* Reroll - practice rounds aren't scored, so being stuck with a
              song you have no chance on is just a dead end. Only here: the
              daily modes get one song a day, and a reroll would be the whole
              point of them undone. */}
          <div className="flex justify-center mb-6">
            {mode === 'unlimited' ? (
              <button
                onClick={newRound}
                disabled={playablePool.length === 0}
                title="Skip this song and draw another"
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border)] hover:border-accent/40 text-text-muted hover:text-text-primary text-[10px] font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} /> Reroll
              </button>
            ) : (
              <div className="h-[30px]" aria-hidden />
            )}
          </div>

          {mode === 'versus' ? (
            <HeardleVersusPanel embedded onClose={() => setMode('daily')} />
          ) : poolLoading ? (
            <div className="flex flex-col items-center gap-3 py-24 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-sm">
                Loading the {categories.map((c) => POOL_LABELS[c].toLowerCase()).join(' + ')} catalogue…
              </p>
            </div>
          ) : roundError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-sm text-text-secondary">Couldn't start today's round - {roundError}</p>
              <button
                onClick={() => {
                  setRoundError(null)
                  startTodayPuzzle(dailyMode)
                    .then(applyServerPuzzle)
                    .catch((err: Error) => setRoundError(err.message))
                }}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Try again
              </button>
            </div>
          ) : poolError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-sm text-text-secondary">Couldn't load the catalogue - {poolError}</p>
            </div>
          ) : !answer && !(useServerRound && serverClipUrl) ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm text-text-muted">
                {rules.eras.length > 0
                  ? 'No songs match the eras you picked.'
                  : 'No playable songs in this pool.'}
              </p>
              {rules.eras.length > 0 && (
                <button
                  onClick={() => setSettings((s) => ({ ...s, eras: [] }))}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Clear era filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Play card */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/60 p-4 sm:p-5 space-y-4">
                <SlotRow ladder={ladder} guesses={guesses} status={status} showEraHint={rules.eraHint} />

                <Waveform
                  seed={answer?.id ?? waveSeed}
                  unlocked={unlocked}
                  elapsed={elapsed}
                  ladder={ladder}
                  playing={playing}
                  startAt={startAt}
                />

                <div>
                  <button
                    onClick={() => (playing ? stopPlayback() : startPlayback())}
                    title={playing ? 'Stop' : `Play ${unlocked}s${startAt > 0 ? ' from the clip start' : ' from the beginning'}`}
                    className="w-full h-12 rounded-xl border border-accent/40 bg-accent/10 hover:bg-accent/20 text-text-primary text-sm font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-colors"
                  >
                    {preparing
                      ? <><Loader2 size={16} className="animate-spin" /> Loading</>
                      : playing
                        ? <><Pause size={16} className="fill-current" /> Stop</>
                        : <><Play size={16} className="fill-current" /> Play ({secLabel(unlocked)})</>}
                  </button>
                  {/* Thin readout under the button - the scope shows the same
                      thing, this just gives it an exact edge to read against. */}
                  <div className="mt-2 h-1 w-full rounded-full bg-[var(--surface-overlay)] overflow-hidden">
                    <div
                      className="h-full bg-accent/30"
                      style={{ width: `${(unlocked / fullWindow) * 100}%` }}
                    />
                    <div
                      className="h-full bg-accent -mt-1 transition-[width] duration-75 ease-linear"
                      style={{ width: `${(Math.min(elapsed, unlocked) / fullWindow) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Volume is the app's own - the game plays through it, so a
                    slider that only moved a private copy would be a lie. */}
                <div className="flex items-center gap-3">
                  <Volume2 size={14} className="text-text-muted shrink-0" />
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={volume}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setVolume(v)
                      if (audioRef.current) audioRef.current.volume = v
                    }}
                    className="flex-1 h-1 accent-[var(--accent)] cursor-pointer"
                  />
                </div>

                {audioError && (
                  <p className="text-center text-xs text-red-400">
                    Couldn't stream this one. {mode === 'unlimited' ? 'Try a new song.' : 'Check your connection.'}
                  </p>
                )}

                {!finished && (
                  <>
                    {/* Guess input */}
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
                        onFocus={() => setDropdownOpen(true)}
                        onKeyDown={handleKeyDown}
                        placeholder="guess the track…"
                        className="w-full h-12 pl-9 pr-3 rounded-xl bg-[var(--surface-overlay)]/50 border border-[var(--border)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                      />
                      {dropdownOpen && suggestions.length > 0 && (
                        <div className="absolute bottom-full mb-1 left-0 right-0 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-xl z-20">
                          {suggestions.map((s, i) => {
                            const alias = matchedAlias(s, query)
                            return (
                              <button
                                key={s.id}
                                onMouseEnter={() => setHighlighted(i)}
                                onClick={() => submitGuess(s)}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                                  i === highlighted ? 'bg-accent/15' : 'hover:bg-surface-overlay'
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-sm text-text-primary truncate">{s.name}</span>
                                  {/* Why this row is here when the name doesn't
                                      match what was typed. */}
                                  {alias && (
                                    <span className="block text-[10px] text-text-muted truncate">aka {alias}</span>
                                  )}
                                </span>
                                {s.era && <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-wider">{s.era}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <button
                        onClick={skip}
                        className="h-12 rounded-xl border border-[var(--border)] hover:border-accent/40 text-text-secondary hover:text-text-primary text-xs font-bold uppercase tracking-[0.18em] transition-colors"
                      >
                        Skip
                        {guesses.length < ladder.length - 1 &&
                          ` (+${secLabel(Math.round((ladder[guesses.length + 1] - ladder[guesses.length]) * 10) / 10)})`}
                      </button>
                      <button
                        onClick={() => { const s = suggestions[highlighted]; if (s) submitGuess(s) }}
                        disabled={suggestions.length === 0}
                        className="h-12 rounded-xl border border-accent/40 bg-accent/10 hover:bg-accent/20 text-text-primary text-xs font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-40 disabled:hover:bg-accent/10"
                      >
                        Submit
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* What's been guessed so far. The slots above carry the shape of
                  the round; this is the part you actually have to read. */}
              {guesses.length > 0 && (
                <div className="space-y-1.5 mt-4">
                  {guesses.map((guess, i) => (
                    <GuessRow
                      key={i}
                      guess={guess}
                      index={i}
                      correct={status === 'won' && i === guesses.length - 1}
                      showEraHint={rules.eraHint}
                    />
                  ))}
                </div>
              )}

              {finished && answer && (
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="flex gap-4">
                    {/* Art stays hidden until the round is over - era covers are
                        shared, so showing one early would narrow the field. */}
                    <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] overflow-hidden flex items-center justify-center">
                      {revealCoverUrl(answer)
                        ? <img src={smallCoverUrl(revealCoverUrl(answer))} alt="" className="w-full h-full object-cover" />
                        : <Music2 size={28} className="text-text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${status === 'won' ? 'text-accent' : 'text-red-400'}`}>
                        {status === 'won'
                          ? `Got it in ${guesses.length} ${guesses.length === 1 ? 'try' : 'tries'}`
                          : 'Out of guesses'}
                      </p>
                      <h2 className="text-text-primary text-lg font-bold leading-snug">{answer.name}</h2>
                      <p className="text-sm text-text-secondary mt-0.5">
                        {[answer.era, CATEGORY_LABELS[answer.category] ?? answer.category, answer.length,
                          versions.get(answer.id)?.version]
                          .filter(Boolean).join(' · ')}
                      </p>
                      {/* Won on a different row - say why it counted, or it looks
                          like the game accepted a song you didn't guess. */}
                      {status === 'won' && guesses[guesses.length - 1]?.viaVersion && (
                        <p className="text-xs text-text-muted mt-1.5">
                          Counted “{guesses[guesses.length - 1].label}” - same song, different version.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <button
                      onClick={playFullSong}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity"
                    >
                      <Volume2 size={15} /> Play full song
                    </button>
                    {isDaily ? (
                      <button
                        onClick={share}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Share2 size={15} /> {copied ? 'Copied!' : 'Share'}
                      </button>
                    ) : (
                      <button
                        onClick={newRound}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <RefreshCw size={15} /> Next song
                      </button>
                    )}
                    {isDaily && (
                      <button
                        onClick={() => setShowLeaderboard(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Trophy size={15} /> Leaderboard
                      </button>
                    )}
                    {isDaily && (
                      <span className="ml-auto text-xs text-text-muted tabular-nums">
                        Next {mode === 'personal' ? 'song' : 'puzzle'} in {formatCountdown(countdown)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!finished && (
                <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mt-4">
                  {ladder.length - guesses.length} {ladder.length - guesses.length === 1 ? 'guess' : 'guesses'} left ·
                  {' '}each miss unlocks more of the {startAt > 0 ? 'clip' : 'intro'}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {showStats && <StatsPanel initialMode={dailyMode} onClose={() => setShowStats(false)} />}
      {showLeaderboard && (
        <LeaderboardPanel
          initialMode={dailyMode}
          signedIn={!!account}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          eras={availableEras}
          mode={mode}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
