// Data + rules for Wordle - the "guess the song title, letter by letter" game
// (see components/WordleView).
//
// Same shape as Heardle and deliberately built on top of it: the catalogue
// pools, the title normalising and the whole-pool search are lib/heardle's, so
// the two games always agree on what a song is called and which songs exist.
// Everything is client-side for the same reason Heardle's local path is -
// there's no puzzle endpoint - so the daily title is *derived* from the date
// and every client that loads the same catalogue picks the same answer.
//
// The twist over classic Wordle: the answer isn't a five-letter word, it's a
// whole song title, and a guess has to be another real title of exactly the
// same letter count. The length is therefore a clue in itself, and the guess
// list is the catalogue rather than a dictionary - which is what makes it a
// *song title* game instead of a word game with a music skin.
import { hash32, normalizeTitle, searchPool, todayKey, previousDayKey } from './heardle'
import type { HeardleSong, GameStatus, Stats, PoolId } from './heardle'

export const DEFAULT_TRIES = 6
export const MIN_TRIES = 3
export const MAX_TRIES = 10

/** Answer length bounds. Under four letters there's nothing to deduce; past
 *  sixteen the row stops being readable at the width the card gives it. */
export const MIN_LETTERS = 4
export const MAX_LETTERS = 16

/** How many titles of a given length the pool must hold before that length can
 *  be an answer. A round whose length only three songs share isn't a puzzle,
 *  it's a coin toss - and there'd be nothing to fill six rows with. */
export const MIN_OPTIONS = 8

export function clampTries(tries: number): number {
  if (!Number.isFinite(tries)) return DEFAULT_TRIES
  return Math.min(MAX_TRIES, Math.max(MIN_TRIES, Math.round(tries)))
}

// ─── Titles as letter rows ────────────────────────────────────────────────────

/** A title flattened to the letters that go in the tiles: normalizeTitle's
 *  rules (apostrophes dropped, punctuation to spaces, case folded) with the
 *  spaces closed up. "All Girls Are The Same" → "ALLGIRLSARETHESAME".
 *
 *  Bracketed trailers go first. Two thirds of the released catalogue carries
 *  one - "(feat. Juice WRLD)", "(Extended Outro)", "[v1]" - and they're
 *  metadata bolted to the title, not part of it: leaving them in turned
 *  "GO (feat. Juice WRLD)" into fifteen tiles that mostly spell the credit,
 *  and made every long round a guess at which feature tag was attached.
 *
 *  Word breaks are deliberately not kept. Grading letter-by-letter across a
 *  guess with a different word shape would need them aligned, and showing the
 *  answer's shape would hand over most of the puzzle before the first guess. */
export function titleKey(title: string): string {
  return normalizeTitle(title.replace(/[([{][^)\]}]*[)\]}]/g, ' '))
    .replace(/ /g, '')
    .toUpperCase()
}

/** Titles carrying digits ("734", "Lucid Dreams 2") are out: a row of tiles
 *  reads as letters, and a stray numeral turns the letter tracker into a lie
 *  about what's left to try. The digits stay in the key so two titles that
 *  differ only by one don't collide - they're simply never playable. */
export function isPlayableKey(key: string): boolean {
  return /^[A-Z]+$/.test(key) && key.length >= MIN_LETTERS && key.length <= MAX_LETTERS
}

export interface WordleEntry {
  song: HeardleSong
  /** The song's `name` as tile letters - see titleKey. */
  key: string
}

/** Every song in a pool that can be an answer or a guess, one per distinct row
 *  of letters.
 *
 *  The catalogue files the same title several times over - "Lucid Dreams" next
 *  to "Lucid Dreams (Extended Outro)" - and once the trailers are stripped
 *  those are the same tiles. Offering both would be offering the same guess
 *  twice, so each key keeps a single representative: the plainest name (fewest
 *  characters), ties broken by id. That tiebreak has to be total and
 *  order-independent - two clients drawing the daily answer must land on the
 *  same row, whatever order the API returned pages in. */
export function playableEntries(pool: HeardleSong[]): WordleEntry[] {
  const best = new Map<string, HeardleSong>()
  for (const song of pool) {
    const key = titleKey(song.name)
    if (!isPlayableKey(key)) continue
    const held = best.get(key)
    if (!held
      || song.name.length < held.name.length
      || (song.name.length === held.name.length && song.id < held.id)) {
      best.set(key, song)
    }
  }
  return [...best.entries()].map(([key, song]) => ({ song, key }))
}

/** Entries whose length has enough company to make a round (see MIN_OPTIONS).
 *  This is the set answers are drawn from - not the set guesses come from,
 *  which is every entry of the answer's length. */
export function answerEntries(entries: WordleEntry[]): WordleEntry[] {
  const counts = new Map<number, number>()
  for (const e of entries) counts.set(e.key.length, (counts.get(e.key.length) ?? 0) + 1)
  return entries.filter((e) => (counts.get(e.key.length) ?? 0) >= MIN_OPTIONS)
}

/** The entry a typed row spells, if the catalogue holds one. Entries are one
 *  per distinct row of letters (see playableEntries), so this is unambiguous -
 *  and it's what lets a guess be typed out letter by letter instead of picked
 *  from the list: the letters still have to name a real song. */
export function findEntryByKey(entries: WordleEntry[], key: string): WordleEntry | null {
  return entries.find((e) => e.key === key) ?? null
}

/** The songs a guess can be: every playable title of exactly `length` letters.
 *  Includes the answer itself, obviously - it has to be guessable. */
export function guessOptions(entries: WordleEntry[], length: number): HeardleSong[] {
  return entries.filter((e) => e.key.length === length).map((e) => e.song)
}

/** Dropdown candidates, narrowed to titles that fit the board. Search itself is
 *  Heardle's, so aliases still find their song ("agats" → All Girls Are The
 *  Same) - but only when that song's own name is the right length, since the
 *  tiles are filled from the name. */
export function searchOptions(
  entries: WordleEntry[],
  length: number,
  query: string,
  limit = 50,
): HeardleSong[] {
  return searchPool(guessOptions(entries, length), query, limit)
}

// ─── Grading ──────────────────────────────────────────────────────────────────

export type LetterState = 'correct' | 'present' | 'absent'

/** Classic Wordle marking, duplicates and all: exact positions are taken
 *  first, then the leftovers are spent left to right, so a guess with two Es
 *  against an answer with one gets exactly one of them coloured. */
export function gradeGuess(guess: string, answer: string): LetterState[] {
  const states: LetterState[] = Array(guess.length).fill('absent')
  const left = new Map<string, number>()
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) states[i] = 'correct'
    else if (i < answer.length) left.set(answer[i], (left.get(answer[i]) ?? 0) + 1)
  }
  for (let i = 0; i < guess.length; i++) {
    if (states[i] === 'correct') continue
    const remaining = left.get(guess[i]) ?? 0
    if (remaining > 0) {
      states[i] = 'present'
      left.set(guess[i], remaining - 1)
    }
  }
  return states
}

const RANK: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 }

/** Best-known state per letter across every guess so far - what the A–Z
 *  tracker is drawn from. A letter never demotes: once it's been green
 *  somewhere it stays green even if a later guess puts it in the wrong slot. */
export function letterHints(rows: { key: string; states: LetterState[] }[]): Map<string, LetterState> {
  const out = new Map<string, LetterState>()
  for (const row of rows) {
    for (let i = 0; i < row.key.length; i++) {
      const letter = row.key[i]
      const state = row.states[i]
      const known = out.get(letter)
      if (!known || RANK[state] > RANK[known]) out.set(letter, state)
    }
  }
  return out
}

// ─── Settings ─────────────────────────────────────────────────────────────────
//
// Unlimited only, exactly as in Heardle: the daily round runs fixed rules so
// two people's results are the same achievement.

const SETTINGS_VERSION = 1

export interface WordleSettings {
  v?: number
  /** Guesses allowed per round. */
  tries: number
  /** Which catalogues to draw from. Never empty - the UI keeps one selected. */
  categories: PoolId[]
  /** Era abbreviations to draw from; empty means all of them. */
  eras: string[]
  /** Flag wrong guesses that come from the answer's era. */
  eraHint: boolean
}

export const DEFAULT_SETTINGS: WordleSettings = {
  v: SETTINGS_VERSION,
  tries: DEFAULT_TRIES,
  categories: ['released'],
  eras: [],
  eraHint: true,
}

export type WordleMode = 'daily' | 'unlimited'

/** Settings as they actually apply to a mode - every read goes through this so
 *  no call site has to remember that Daily ignores them. */
export function settingsForMode(settings: WordleSettings, mode: WordleMode): WordleSettings {
  return mode === 'unlimited' ? settings : DEFAULT_SETTINGS
}

// ─── Selection ────────────────────────────────────────────────────────────────

/** The answer for a given day. Sorted by id first so the choice never depends
 *  on the order the API happened to return pages in - two clients must agree.
 *  A different seed prefix from Heardle's, or both games would march through
 *  the catalogue in lockstep and give each other away. */
export function pickDailyEntry(entries: WordleEntry[], dayKey: string): WordleEntry | null {
  const eligible = answerEntries(entries)
  if (eligible.length === 0) return null
  const sorted = [...eligible].sort((a, b) => a.song.id - b.song.id)
  return sorted[hash32(`wordle-${dayKey}`) % sorted.length]
}

/** A random title for practice rounds. */
export function pickRandomEntry(entries: WordleEntry[]): WordleEntry | null {
  const eligible = answerEntries(entries)
  if (eligible.length === 0) return null
  return eligible[Math.floor(Math.random() * eligible.length)]
}

// ─── Game state ───────────────────────────────────────────────────────────────

export interface WordleGuess {
  songId: number
  /** The song's display name, for the reveal list. */
  label: string
  /** Its tile letters - states are derived from this and the answer, never
   *  stored, so a saved round can't disagree with the board it renders. */
  key: string
  era: string | null
}

export interface RoundState {
  day: string
  answerId: number
  guesses: WordleGuess[]
  status: GameStatus
}

export const EMPTY_STATS: Stats = {
  played: 0, won: 0, currentStreak: 0, maxStreak: 0,
  distribution: Array(MAX_TRIES).fill(0), lastDay: null,
}

const LS_PREFIX = 'unreleased:wordle:'

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function lsSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {}
}

export function loadSettings(): WordleSettings {
  const saved = lsGet<Partial<WordleSettings>>('settings')
  const merged = { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  return {
    ...merged,
    v: SETTINGS_VERSION,
    tries: clampTries(merged.tries),
    categories: merged.categories?.length ? merged.categories : DEFAULT_SETTINGS.categories,
  }
}

export function saveSettings(settings: WordleSettings): void {
  lsSet('settings', settings)
}

/** The saved round for `dayKey`, or null when it's a new day / a different
 *  answer (the catalogue grew and the day's pick moved - start over rather
 *  than replay someone else's guesses against the wrong title). */
export function loadRound(dayKey: string, answerId: number): RoundState | null {
  const saved = lsGet<RoundState>('round')
  if (!saved || saved.day !== dayKey || saved.answerId !== answerId) return null
  return saved
}

export function saveRound(state: RoundState): void {
  lsSet('round', state)
}

/** The practice round in progress, if there is one.
 *
 *  Unlimited isn't scored, but it is still a round someone is in the middle
 *  of: leaving the tab and coming back used to throw away a half-finished
 *  board and deal a new title. Kept under its own key so it can never be
 *  mistaken for the daily one, and without a day - a practice round is
 *  whatever you last left open, not something that expires at midnight.
 *
 *  `day` is carried anyway so the shape matches the daily round; nothing
 *  reads it here. */
export function loadPracticeRound(): RoundState | null {
  return lsGet<RoundState>('round:unlimited')
}

export function savePracticeRound(state: RoundState): void {
  lsSet('round:unlimited', state)
}

/** The mode tab to open on, so returning to the tab doesn't drop you back on
 *  Daily halfway through a practice round. */
export function loadMode(): WordleMode {
  return lsGet<WordleMode>('mode') === 'unlimited' ? 'unlimited' : 'daily'
}

export function saveMode(mode: WordleMode): void {
  lsSet('mode', mode)
}

export function loadStats(): Stats {
  const saved = lsGet<Stats>('stats')
  if (!saved) return { ...EMPTY_STATS, distribution: Array(MAX_TRIES).fill(0) }
  return {
    ...EMPTY_STATS,
    ...saved,
    distribution: Array.from({ length: MAX_TRIES }, (_, i) => saved.distribution?.[i] ?? 0),
  }
}

/** Folds one finished daily round into the saved stats. Idempotent per day -
 *  `lastDay` guards against a re-render (or a second window) counting the same
 *  result twice. */
export function recordResult(dayKey: string, won: boolean, guessCount: number): Stats {
  const stats = loadStats()
  if (stats.lastDay === dayKey) return stats

  const continues = stats.lastDay === previousDayKey(dayKey)
  const currentStreak = won ? (continues ? stats.currentStreak : 0) + 1 : 0
  const next: Stats = {
    played: stats.played + 1,
    won: stats.won + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    distribution: stats.distribution.map((n, i) => (won && i === guessCount - 1 ? n + 1 : n)),
    lastDay: dayKey,
  }
  lsSet('stats', next)
  return next
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

/** The spoiler-free grid: one row of squares per guess. The row width gives the
 *  title's length away, which is the same clue everyone playing that day
 *  already has. */
export function shareText(
  dayKey: string,
  rows: LetterState[][],
  status: GameStatus,
  tries: number,
  puzzleNo: number,
): string {
  const grid = rows
    .map((states) => states
      .map((s) => (s === 'correct' ? '🟩' : s === 'present' ? '🟨' : '⬜'))
      .join(''))
    .join('\n')
  const score = status === 'won' ? `${rows.length}/${tries}` : `X/${tries}`
  return `Unreleased Wordle #${puzzleNo} ${score}\n\n${grid}`
}

export { todayKey }
