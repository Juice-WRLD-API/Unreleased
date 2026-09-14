import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, Search, X, Check, Music2, BarChart3, Share2, RefreshCw,
  AlertCircle, Loader2, Volume2, SlidersHorizontal, RotateCcw, Type, Delete,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { apiFetch, songToTrack, smallCoverUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { eraFullName, loadEraFullNames } from '../lib/eras'
import {
  loadPools, filterByEra, poolEras, matchedAlias, POOL_LABELS,
  todayKey, puzzleNumber, msUntilNextPuzzle,
} from '../lib/heardle'
import type { HeardleSong, GameStatus, PoolId, Stats } from '../lib/heardle'
import {
  MIN_TRIES, MAX_TRIES, MIN_OPTIONS, DEFAULT_SETTINGS,
  playableEntries, guessOptions, searchOptions, findEntryByKey,
  pickDailyEntry, pickRandomEntry, titleKey, gradeGuess, letterHints,
  clampTries, settingsForMode, loadSettings, saveSettings,
  loadRound, saveRound, loadPracticeRound, savePracticeRound,
  loadMode, saveMode, loadStats, recordResult, shareText,
} from '../lib/wordle'
import type { WordleEntry, WordleGuess, WordleMode, WordleSettings, LetterState } from '../lib/wordle'
import { GameSwitcher, GameBackdrop, Field, Segmented, numberInput } from './gameShell'

const MODES: { id: WordleMode; label: string; hint: string }[] = [
  { id: 'daily', label: 'Daily', hint: 'One title a day - the same one for everyone' },
  { id: 'unlimited', label: 'Unlimited', hint: 'Random titles, play as many as you like' },
]

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Board ────────────────────────────────────────────────────────────────────

/** Tile colours. Kept in one place because the board, the letter tracker and
 *  the shared grid all have to agree on what green means. */
function tileTone(state: LetterState | 'empty'): string {
  switch (state) {
    case 'correct': return 'border-accent bg-accent text-white'
    case 'present': return 'border-amber-500/60 bg-amber-500/25 text-text-primary'
    case 'absent': return 'border-[var(--border)] bg-[var(--surface-overlay)]/70 text-text-muted'
    default: return 'border-[var(--border)] bg-[var(--surface-overlay)]/25 text-text-primary'
  }
}

/** One guess as a row of letters - or an empty row waiting for one. Rows are a
 *  grid rather than a flex run so every row of a round lines up column for
 *  column, whatever the title's length. */
function Row({ length, letters, states, active }: {
  length: number
  letters?: string
  states?: LetterState[]
  active?: boolean
}): JSX.Element {
  const size = length <= 8 ? 'text-base' : length <= 12 ? 'text-sm' : 'text-[11px]'
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
    >
      {Array.from({ length }, (_, i) => {
        // One tone class per tile - an `active` border stacked on top of the
        // tone's own border-* would leave which colour wins up to the order
        // Tailwind happened to emit them in.
        const state = states?.[i]
        const tone = state
          ? tileTone(state)
          : active
            ? 'border-accent/40 bg-[var(--surface-overlay)]/40 text-text-primary'
            : tileTone('empty')
        return (
          <span
            key={i}
            className={`aspect-square rounded-md border flex items-center justify-center font-bold uppercase transition-colors ${size} ${tone}`}
          >
            {letters?.[i] ?? ''}
          </span>
        )
      })}
    </div>
  )
}

/** The keyboard: how a guess is typed, and the tracker for what's already been
 *  ruled out. Both jobs on one control - the board only ever shows the letters
 *  that have been played, and tracking twenty-six of them in your head across a
 *  title three times longer than a Wordle word is the whole difficulty.
 *
 *  Present on desktop too, not just as a touch fallback: it's where the colours
 *  live, and a physical keyboard drives the same actions (see the window
 *  listener in the view). */
function Keyboard({ hints, onLetter, onEnter, onBackspace, disabled }: {
  hints: Map<string, LetterState>
  onLetter: (letter: string) => void
  onEnter: () => void
  onBackspace: () => void
  disabled: boolean
}): JSX.Element {
  const base = 'h-10 rounded-md border flex items-center justify-center text-xs font-bold transition-colors disabled:opacity-40'
  return (
    <div className="space-y-1.5">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className="flex gap-1 justify-center">
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onEnter}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              className={`${base} flex-[1.6] border-accent/40 bg-accent/10 text-text-primary hover:bg-accent/20 text-[10px] uppercase tracking-wider`}
            >
              Enter
            </button>
          )}
          {row.split('').map((letter) => {
            const state = hints.get(letter)
            return (
              <button
                key={letter}
                onClick={() => onLetter(letter)}
                // Don't take focus: a focused letter key turns the next
                // physical Enter into another press of that letter instead of
                // a submit.
                onMouseDown={(e) => e.preventDefault()}
                disabled={disabled}
                className={`${base} flex-1 min-w-0 ${
                  state ? tileTone(state) : 'border-[var(--border)] bg-[var(--surface-overlay)]/60 text-text-primary hover:border-accent/40'
                }`}
              >
                {letter}
              </button>
            )
          })}
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onBackspace}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              title="Delete"
              className={`${base} flex-[1.6] border-[var(--border)] bg-[var(--surface-overlay)]/60 text-text-primary hover:border-accent/40`}
            >
              <Delete size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────────────────

/** Game rules for Unlimited. Daily ignores all of them (see settingsForMode) -
 *  same rule as Heardle's panel, and said out loud for the same reason. */
function SettingsPanel({ settings, onChange, eras, mode, onClose }: {
  settings: WordleSettings
  onChange: (s: WordleSettings) => void
  eras: { era: string; count: number }[]
  mode: WordleMode
  onClose: () => void
}): JSX.Element {
  const set = <K extends keyof WordleSettings>(key: K, value: WordleSettings[K]): void =>
    onChange({ ...settings, [key]: value })

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
          These apply to <span className="text-text-secondary font-semibold">Unlimited</span> only. The Daily
          title always runs the standard rules - everyone plays the same round, and a six-guess round and a
          ten-guess round aren&apos;t the same result.
        </p>
        {mode !== 'unlimited' && (
          <p className="text-xs text-accent bg-accent/10 border border-accent/25 rounded-lg px-3 py-2 mb-4">
            You&apos;re playing Daily right now - nothing here changes that round. Switch to Unlimited to
            play by these.
          </p>
        )}

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Difficulty</h3>
        <Field label="Guesses" hint={`${MIN_TRIES}–${MAX_TRIES} titles per round`}>
          <input
            type="number"
            min={MIN_TRIES}
            max={MAX_TRIES}
            value={settings.tries}
            onChange={(e) => set('tries', clampTries(Number(e.target.value)))}
            className={numberInput}
          />
        </Field>
        <Field label="Era hint" hint="Flag wrong guesses from the answer's era">
          <Segmented
            options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
            value={settings.eraHint ? 'on' : 'off'}
            onChange={(v) => set('eraHint', v === 'on')}
          />
        </Field>

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mt-4 mb-1">Title pool</h3>
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

/** Reads straight from storage on open rather than mirroring the round's
 *  state - only Daily is ever recorded, so there's a single set to show. */
function StatsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const stats = useMemo(() => loadStats(), [])
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
        <p className="text-xs text-text-muted mb-4">Daily rounds only - Unlimited isn&apos;t counted.</p>
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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function WordleView(): JSX.Element {
  const { setActiveView, playTrack } = useStorePick('setActiveView', 'playTrack')

  const [mode, setMode] = useState<WordleMode>(() => loadMode())
  const [settings, setSettings] = useState<WordleSettings>(() => loadSettings())
  const [pool, setPool] = useState<HeardleSong[]>([])
  const [poolLoading, setPoolLoading] = useState(true)
  const [poolError, setPoolError] = useState<string | null>(null)

  const [answer, setAnswer] = useState<WordleEntry | null>(null)
  const [guesses, setGuesses] = useState<WordleGuess[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  // Which mode the round in state was dealt for. On the render a mode switch
  // happens, the round below is still the old mode's - without this the save
  // effect would file it under the new mode's key before the setup effect's
  // state lands, overwriting a daily round with a practice one.
  const [roundMode, setRoundMode] = useState<WordleMode>(mode)

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Letters typed into the current row, and the complaint when a full row
  // doesn't name a song. `shake` is a counter rather than a flag: restarting
  // the animation needs the element to remount, which a bumped key does and a
  // boolean doesn't.
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const [showStats, setShowStats] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle())
  const [copied, setCopied] = useState(false)
  const [playError, setPlayError] = useState(false)

  const day = useMemo(() => todayKey(), [])
  const isDaily = mode === 'daily'
  // Which settings actually apply here - Daily ignores all of them. Everything
  // below reads `rules`, never `settings`, so the mode rules live in one place.
  const rules = useMemo(() => settingsForMode(settings, mode), [settings, mode])
  const tries = clampTries(rules.tries)
  const categories = rules.categories
  const finished = status !== 'playing'

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

  const eraKey = rules.eras.join(',')
  const playablePool = useMemo(
    () => filterByEra(pool, eraKey ? eraKey.split(',') : []),
    [pool, eraKey])
  const availableEras = useMemo(() => poolEras(pool), [pool])
  // Titles that can be answers or guesses - letters only, and the right length
  // to fit a row (see lib/wordle).
  const entries = useMemo(() => playableEntries(playablePool), [playablePool])

  // ── Round setup ────────────────────────────────────────────────────────────
  // Daily restores whatever was already guessed today; Unlimited starts fresh
  // whenever the pool (or the mode) changes.
  //
  // Deliberately not keyed on the settings: changing the guess count mid-round
  // must not re-roll a once-a-day title. A cut that strands a round over the
  // new limit is settled below instead.
  useEffect(() => {
    if (entries.length === 0) { setAnswer(null); return }
    if (isDaily) {
      const entry = pickDailyEntry(entries, day)
      setAnswer(entry)
      const saved = entry ? loadRound(day, entry.song.id) : null
      setGuesses(saved?.guesses ?? [])
      setStatus(saved?.status ?? 'playing')
    } else {
      // Practice picks up where it was left, unless the saved title has since
      // fallen out of the pool (the era filter or the catalogue moved under
      // it) - then there's nothing to resume against and it deals a new one.
      const saved = loadPracticeRound()
      const resumed = saved ? entries.find((e) => e.song.id === saved.answerId) : undefined
      setAnswer(resumed ?? pickRandomEntry(entries))
      setGuesses(resumed && saved ? saved.guesses : [])
      setStatus(resumed && saved ? saved.status : 'playing')
    }
    setRoundMode(isDaily ? 'daily' : 'unlimited')
    setQuery('')
    setDraft('')
    setNotice(null)
  }, [entries, isDaily, day])

  // A guess-count cut can leave a saved round already at or past the new limit.
  // Settle it as a loss rather than showing a round that can't be played on.
  //
  // Only ever against the round it's actually judging: on a mode switch the
  // guesses here are still the old mode's, and a seven-guess practice round
  // measured against Daily's six would settle the round being restored as a
  // loss it never played.
  useEffect(() => {
    if (roundMode !== mode) return
    if (status === 'playing' && guesses.length >= tries) setStatus('lost')
  }, [roundMode, mode, status, guesses.length, tries])

  // Persist the round after every guess - both modes, under their own keys.
  useEffect(() => {
    if (!answer || roundMode !== mode) return
    const state = { day, answerId: answer.song.id, guesses, status }
    if (roundMode === 'daily') saveRound(state)
    else savePracticeRound(state)
  }, [roundMode, mode, answer, day, guesses, status])

  useEffect(() => { saveMode(mode) }, [mode])

  // Fold a finished daily round into the stats (once - see recordResult's
  // lastDay guard). The roundMode gate matters here more than anywhere: a
  // finished practice round left on screen would otherwise be recorded as
  // today's daily result the moment the Daily tab is clicked.
  useEffect(() => {
    if (!isDaily || roundMode !== mode || status === 'playing' || !answer) return
    recordResult(day, status === 'won', guesses.length)
  }, [isDaily, roundMode, mode, status, day, guesses.length, answer])

  useEffect(() => {
    if (!finished) return
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000)
    return () => clearInterval(id)
  }, [finished])

  // ── Board ──────────────────────────────────────────────────────────────────
  const answerKey = answer?.key ?? ''
  const length = answerKey.length
  // Marks are derived, never stored: a saved round then can't disagree with the
  // board it's rendered on, and the answer is the only thing that has to match.
  const rows = useMemo(
    () => guesses.map((g) => ({ key: g.key, states: gradeGuess(g.key, answerKey) })),
    [guesses, answerKey])
  const hints = useMemo(() => letterHints(rows), [rows])
  const optionCount = useMemo(
    () => (length ? guessOptions(entries, length).length : 0),
    [entries, length])

  // ── Guessing ───────────────────────────────────────────────────────────────
  // Suggestions are titles of exactly the answer's length: anything else can't
  // be laid on the board, so offering it would only waste a guess.
  const suggestions = useMemo(
    () => (query.trim() && length ? searchOptions(entries, length, query, 50) : []),
    [entries, length, query])

  useEffect(() => { setHighlighted(0) }, [query])

  const alreadyGuessed = (song: HeardleSong): boolean =>
    guesses.some((g) => g.songId === song.id)

  const submitGuess = (song: HeardleSong): void => {
    if (finished || !answer) return
    const key = titleKey(song.name)
    if (key.length !== length) return
    const next: WordleGuess[] = [...guesses, {
      songId: song.id,
      label: song.name,
      key,
      era: song.era,
    }]
    setGuesses(next)
    // Any title with the answer's exact letters wins - the catalogue holds
    // plenty of rows that are the same thing filed twice, and picking the
    // "wrong" one of those out of the dropdown isn't a wrong guess.
    if (key === answerKey) setStatus('won')
    else if (next.length >= tries) setStatus('lost')
    setQuery('')
    setDraft('')
    setNotice(null)
    setDropdownOpen(false)
  }

  // ── Typing ─────────────────────────────────────────────────────────────────
  // A row can be typed out letter by letter as well as picked from the search
  // box. It still has to name a real song - the catalogue is this game's
  // dictionary, and a row of any old letters would be a free look at the
  // colours for a guess nobody could have meant.
  const typeLetter = (letter: string): void => {
    if (finished || !answer) return
    setNotice(null)
    setDraft((d) => (d.length >= length ? d : d + letter))
  }

  const backspace = (): void => {
    setNotice(null)
    setDraft((d) => d.slice(0, -1))
  }

  const reject = (message: string): void => {
    setNotice(message)
    setShake((n) => n + 1)
  }

  const submitDraft = (): void => {
    if (finished || !answer) return
    // Nothing typed but something searched: Enter means "the row I've got
    // highlighted", the same as clicking it.
    if (!draft) {
      const picked = query.trim() ? suggestions[highlighted] : undefined
      if (picked) submitGuess(picked)
      else reject(`Type a ${length}-letter title, or search for one by name`)
      return
    }
    if (draft.length < length) {
      reject(`${length} letters - you've typed ${draft.length}`)
      return
    }
    const entry = findEntryByKey(entries, draft)
    if (!entry) {
      reject(`“${draft}” isn't a song in this pool`)
      return
    }
    submitGuess(entry.song)
  }

  // Physical keys, on window and in the capture phase so the player's own
  // shortcuts never see them: bare letters are bound by default (S shuffle,
  // R loop, L like, M mute - see lib/hotkeys), and without stopping them here
  // every guess typed out would also shuffle the queue and mute the audio.
  //
  // The listener is registered once and dispatches through a ref, so it always
  // runs against the current round without resubscribing on every keystroke.
  const globalKey = (e: KeyboardEvent): void => {
    if (finished || !answer || showSettings || showStats) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // App-level overlays sit over this view without unmounting it - read them
    // at event time so a keypress meant for one of them isn't swallowed by a
    // board nobody can see. Settings used to be one of these too, but it's a
    // real page now (see App.tsx) - navigating to it unmounts this component
    // entirely, so there's nothing left here to guard against.
    const app = useStore.getState()
    if (app.showUserAuth || app.showDiagnostics) return
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    // Typing into the search box (or anywhere else that takes text) is not
    // typing on the board.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
    const consume = (): void => { e.preventDefault(); e.stopPropagation() }
    if (e.key === 'Enter') {
      // Enter on a focused button/link still has to activate it.
      const clickable = tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || el?.getAttribute('role') === 'button'
      if (clickable) return
      consume()
      submitDraft()
    } else if (e.key === 'Backspace') {
      consume()
      backspace()
    } else if (/^[a-z]$/i.test(e.key)) {
      consume()
      typeLetter(e.key.toUpperCase())
    }
  }
  const globalKeyRef = useRef(globalKey)
  globalKeyRef.current = globalKey

  useEffect(() => {
    const listener = (e: KeyboardEvent): void => globalKeyRef.current(e)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

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
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${answer.song.id}/`)
      playTrack(songToTrack(song))
    } catch {
      setPlayError(true)
    }
  }

  const share = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        shareText(day, rows.map((r) => r.states), status, tries, puzzleNumber(day)))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const newRound = (): void => {
    const entry = pickRandomEntry(entries)
    setAnswer(entry)
    setGuesses([])
    setStatus('playing')
    setQuery('')
    setDraft('')
    setNotice(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />

      {/* Corner controls - the hero owns the middle, so navigation and the
          panels sit out of its way. z-20 clears the scroll container; no-drag
          keeps Electron's title strip from swallowing the clicks (see
          HeardleView, which has the same corners for the same reasons). */}
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
          onClick={() => setShowStats(true)}
          title="Statistics"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <BarChart3 size={20} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-xl">
          <GameSwitcher current="wordle" />

          {/* Hero */}
          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight inline-flex items-start gap-1">
              Juice WRLD Wordle
              <span className="text-accent text-sm font-mono font-bold mt-1">999</span>
            </h1>
            <p className="mt-2 text-[11px] font-mono lowercase tracking-[0.18em] text-text-muted">
              guess the song title, letter by letter
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

          <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mb-3">
            {isDaily && `#${puzzleNumber(day)} · `}
            {MODES.find((m) => m.id === mode)?.hint.toLowerCase()}
            {length > 0 && ` · ${length} letters · ${tries} guesses`}
            {mode === 'unlimited' && rules.eras.length > 0 && ` · ${rules.eras.join(', ')}`}
          </p>

          {/* Reroll - practice rounds aren't scored, so being stuck with a
              title you have no chance on is just a dead end. */}
          <div className="flex justify-center mb-6">
            {mode === 'unlimited' ? (
              <button
                onClick={newRound}
                disabled={entries.length === 0}
                title="Skip this title and draw another"
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border)] hover:border-accent/40 text-text-muted hover:text-text-primary text-[10px] font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} /> Reroll
              </button>
            ) : (
              <div className="h-[30px]" aria-hidden />
            )}
          </div>

          {poolLoading ? (
            <div className="flex flex-col items-center gap-3 py-24 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-sm">
                Loading the {categories.map((c) => POOL_LABELS[c].toLowerCase()).join(' + ')} catalogue…
              </p>
            </div>
          ) : poolError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-sm text-text-secondary">Couldn&apos;t load the catalogue - {poolError}</p>
            </div>
          ) : !answer ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm text-text-muted">
                {rules.eras.length > 0
                  ? 'No titles match the eras you picked.'
                  : `No title in this pool has ${MIN_OPTIONS} others its length to play against.`}
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
              {/* Board */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/60 p-4 sm:p-5 space-y-4">
                <div className="space-y-1">
                  {Array.from({ length: tries }, (_, i) => {
                    const row = rows[i]
                    const active = !row && i === rows.length && status === 'playing'
                    const tiles = (
                      <Row
                        length={length}
                        letters={row?.key ?? (active ? draft : undefined)}
                        states={row?.states}
                        active={active}
                      />
                    )
                    // A rejected row shakes. The wrapper's key carries the
                    // shake counter so a second rejection remounts it and
                    // replays the animation instead of sitting still.
                    return active && notice
                      ? <div key={`${i}-${shake}`} className="animate-wordle-shake">{tiles}</div>
                      : <div key={i}>{tiles}</div>
                  })}
                </div>

                {notice && !finished && (
                  <p className="text-center text-xs text-red-400">{notice}</p>
                )}

                {!finished && (
                  <>
                    <Keyboard
                      hints={hints}
                      onLetter={typeLetter}
                      onEnter={submitDraft}
                      onBackspace={backspace}
                      disabled={finished}
                    />

                    {/* Second way in: the catalogue is long and some titles are
                        easier named than spelled. Picking one here submits it
                        exactly as typing it out would. */}
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
                        onFocus={() => setDropdownOpen(true)}
                        onKeyDown={handleKeyDown}
                        placeholder={`or find a ${length}-letter title by name…`}
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[var(--surface-overlay)]/50 border border-[var(--border)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
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
                                } ${alreadyGuessed(s) ? 'opacity-40' : ''}`}
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

                  </>
                )}
              </div>

              {/* The board carries the letters; this is the part you actually
                  read back - which titles have already been spent. */}
              {guesses.length > 0 && (
                <div className="space-y-1.5 mt-4">
                  {guesses.map((guess, i) => {
                    const correct = status === 'won' && i === guesses.length - 1
                    const sameEra = !!guess.era && guess.era === answer.song.era && rules.eraHint
                    return (
                      <div
                        key={i}
                        className={`h-10 rounded-lg border flex items-center gap-2 px-3 ${
                          correct
                            ? 'border-accent/50 bg-accent/15 text-text-primary'
                            : sameEra
                              ? 'border-amber-500/40 bg-amber-500/10 text-text-primary'
                              : 'border-[var(--border)] bg-[var(--surface-raised)] text-text-primary'
                        }`}
                      >
                        {correct
                          ? <Check size={14} className="shrink-0 text-accent" />
                          : <X size={14} className="shrink-0 text-red-400" />}
                        <span className="text-sm truncate">{guess.label}</span>
                        {!correct && sameEra && (
                          <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                            Same era
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {finished && (
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="flex gap-4">
                    {/* Art stays hidden until the round is over - era covers are
                        shared, so showing one early would narrow the field. */}
                    <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] overflow-hidden flex items-center justify-center">
                      {answer.song.imageUrl
                        ? <img src={smallCoverUrl(answer.song.imageUrl)} alt="" className="w-full h-full object-cover" />
                        : <Music2 size={28} className="text-text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${status === 'won' ? 'text-accent' : 'text-red-400'}`}>
                        {status === 'won'
                          ? `Got it in ${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'}`
                          : 'Out of guesses'}
                      </p>
                      <h2 className="text-text-primary text-lg font-bold leading-snug">{answer.song.name}</h2>
                      <p className="text-sm text-text-secondary mt-0.5">
                        {[answer.song.era, CATEGORY_LABELS[answer.song.category] ?? answer.song.category,
                          answer.song.length].filter(Boolean).join(' · ')}
                      </p>
                      {/* The tiles carry the stripped title; the heading is the
                          catalogue's full name. Say so when they differ, or a
                          win on "Titanic" reading back as "Titanic (v2)" looks
                          like the game graded something else. */}
                      {/[([{]/.test(answer.song.name) && (
                        <p className="text-xs text-text-muted mt-1.5">
                          Tiles spell <span className="font-mono">{answer.key}</span> - anything in brackets
                          is left off the board.
                        </p>
                      )}
                    </div>
                  </div>
                  {playError && (
                    <p className="text-xs text-red-400 mt-3">Couldn&apos;t load that song. Check your connection.</p>
                  )}
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
                        <RefreshCw size={15} /> Next title
                      </button>
                    )}
                    {isDaily && (
                      <span className="ml-auto text-xs text-text-muted tabular-nums">
                        Next title in {formatCountdown(countdown)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!finished && (
                <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mt-4 flex items-center justify-center gap-1.5">
                  <Type size={11} />
                  {tries - guesses.length} {tries - guesses.length === 1 ? 'guess' : 'guesses'} left ·
                  {' '}type it out or search by name ·
                  {' '}{optionCount} titles are {length} letters long
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
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
