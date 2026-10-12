// Presentational pieces and pure helpers shared byte-for-byte between
// HeardleView.desktop.tsx and .mobile.tsx. Keep this file free of anything
// that reads mobile/desktop-specific state - the two views wire it up
// differently (see e.g. round-error plumbing, which genuinely diverges).
import { useMemo } from 'react'
import { Check, SkipForward, X } from 'lucide-react'
import type { DailyMode, GameStatus, Guess, Stats } from './heardle'

export type Mode = DailyMode | 'unlimited' | 'versus'

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'daily', label: 'Daily', hint: 'One song a day - the same one for everyone' },
  { id: 'personal', label: 'Personal', hint: 'One song a day, picked just for you' },
  { id: 'versus', label: '1v1', hint: 'Real-time match against another player' },
  { id: 'unlimited', label: 'Unlimited', hint: 'Random songs, play as many as you like' },
]

export function formatSeconds(s: number): string {
  const clamped = Math.max(0, s)
  return `0:${String(Math.floor(clamped)).padStart(2, '0')}`
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Seconds for a button label: "1S", "2.5S". */
export function secLabel(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}S`
}

/** Seconds as a position in a song: "1:23". */
export function formatClock(s: number): string {
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
export function Waveform({ seed, unlocked, elapsed, ladder, playing, startAt }: {
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
export function SlotRow({ ladder, guesses, status, showEraHint }: {
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
export function GuessRow({ guess, index, correct, showEraHint }: {
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

/** One past the deepest guess-count that's ever won a round. */
export function lastUsedBucket(stats: Stats): number {
  for (let i = stats.distribution.length - 1; i >= 0; i--) {
    if (stats.distribution[i] > 0) return i + 1
  }
  return 0
}
