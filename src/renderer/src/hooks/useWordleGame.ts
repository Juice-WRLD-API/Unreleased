// Shared round state/logic for WordleView (song-title-guessing game).
// Desktop and mobile wrap this in their own JSX/layout - keep behavior here.
// Desktop additionally wires up useWordlePhysicalKeyboard for its window
// keydown listener, which mobile has no equivalent of (typing only happens
// through the on-screen Keyboard there).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { apiFetch, songToTrack } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { loadEraFullNames } from '../lib/eras'
import {
  loadPools, filterByEra, poolEras, POOL_LABELS,
  todayKey, puzzleNumber, msUntilNextPuzzle,
} from '../lib/heardle'
import type { HeardleSong, GameStatus, PoolId } from '../lib/heardle'
import {
  MIN_OPTIONS, DEFAULT_SETTINGS,
  playableEntries, guessOptions, searchOptions, findEntryByKey,
  pickDailyEntry, pickRandomEntry, titleKey, gradeGuess, letterHints,
  clampTries, settingsForMode, loadSettings, saveSettings,
  loadRound, saveRound, loadPracticeRound, savePracticeRound,
  loadMode, saveMode, recordResult, shareText,
} from '../lib/wordle'
import type { WordleEntry, WordleGuess, WordleMode, WordleSettings } from '../lib/wordle'

export const MODES: { id: WordleMode; label: string; hint: string }[] = [
  { id: 'daily', label: 'Daily', hint: 'One title a day - the same one for everyone' },
  { id: 'unlimited', label: 'Unlimited', hint: 'Random titles, play as many as you like' },
]

export const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

export function useWordleGame(): {
  playTrack: ReturnType<typeof useStorePick<'playTrack'>>['playTrack']
  mode: WordleMode
  setMode: (m: WordleMode) => void
  settings: WordleSettings
  setSettings: React.Dispatch<React.SetStateAction<WordleSettings>>
  poolLoading: boolean
  poolError: string | null
  answer: WordleEntry | null
  guesses: WordleGuess[]
  status: GameStatus
  query: string
  setQuery: (v: string) => void
  highlighted: number
  setHighlighted: React.Dispatch<React.SetStateAction<number>>
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  draft: string
  notice: string | null
  shake: number
  showStats: boolean
  setShowStats: (v: boolean) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  countdown: number
  copied: boolean
  playError: boolean
  day: string
  isDaily: boolean
  rules: WordleSettings
  tries: number
  categories: PoolId[]
  finished: boolean
  availableEras: { era: string; count: number }[]
  entries: WordleEntry[]
  answerKey: string
  length: number
  rows: { key: string; states: ReturnType<typeof gradeGuess> }[]
  hints: ReturnType<typeof letterHints>
  optionCount: number
  suggestions: HeardleSong[]
  alreadyGuessed: (song: HeardleSong) => boolean
  submitGuess: (song: HeardleSong) => void
  typeLetter: (letter: string) => void
  backspace: () => void
  submitDraft: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  playFullSong: () => Promise<void>
  share: () => Promise<void>
  newRound: () => void
} {
  const { playTrack } = useStorePick('playTrack')

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
      reject(`"${draft}" isn't a song in this pool`)
      return
    }
    submitGuess(entry.song)
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

  return {
    playTrack,
    mode, setMode, settings, setSettings, poolLoading, poolError,
    answer, guesses, status,
    query, setQuery, highlighted, setHighlighted, dropdownOpen, setDropdownOpen,
    draft, notice, shake,
    showStats, setShowStats, showSettings, setShowSettings, countdown, copied, playError,
    day, isDaily, rules, tries, categories, finished,
    availableEras, entries, answerKey, length, rows, hints, optionCount,
    suggestions, alreadyGuessed, submitGuess, typeLetter, backspace, submitDraft, handleKeyDown,
    playFullSong, share, newRound,
  }
}

/** Desktop-only: physical keys, on window and in the capture phase so the
 *  player's own shortcuts never see them - bare letters are bound by default
 *  (S shuffle, R loop, L like, M mute - see lib/hotkeys), and without stopping
 *  them here every guess typed out would also shuffle the queue and mute the
 *  audio. Mobile has no equivalent listener - typing only happens through the
 *  on-screen Keyboard there. */
export function useWordlePhysicalKeyboard({ answer, finished, showSettings, showStats, submitDraft, backspace, typeLetter }: {
  answer: unknown
  finished: boolean
  showSettings: boolean
  showStats: boolean
  submitDraft: () => void
  backspace: () => void
  typeLetter: (letter: string) => void
}): void {
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
}
