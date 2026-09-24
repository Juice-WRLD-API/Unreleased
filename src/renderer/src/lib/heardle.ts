// Data + rules for Heardle - the "name the song from its opening seconds"
// game (see components/HeardleView).
//
// Everything here is client-side: there's no puzzle endpoint on the API, so
// the daily song is *derived* from the date instead of being handed out. Every
// client that loads the same catalogue on the same local day picks the same
// answer (see pickDailySong), which is what makes the shared score grid mean
// anything.
import { apiRequest } from './apiClient'
import { routeUrl, buildImageUrl, parseDuration } from './juicewrldApi'
import type { JWApiSong, JWApiPaginatedResponse } from './juicewrldApi'
import { getVersionMetaForSongs } from './versionsApi'

// How many guesses a round allows, and how much of the intro each one unlocks.
// The defaults are the classic Heardle ladder - 1, 2, 4, 7, 11, 16 seconds over
// six tries - which stays tight enough that a first-second win feels like
// something. Both are configurable (see HeardleSettings), so nothing outside
// this file should assume six of anything.
export const DEFAULT_TRIES = 6
export const MIN_TRIES = 2
export const MAX_TRIES = 10

/** The classic ladder in closed form: gaps grow by one second each step
 *  (1, +1, +2, +3, +4, +5 …), so it extends past six tries on its own. */
function classicStage(index: number): number {
  return 1 + (index * (index + 1)) / 2
}

/** The unlock points for a round, one per try, ascending. */
export function stageLadder(settings: HeardleSettings): number[] {
  const tries = clampTries(settings.tries)
  if (settings.ladder === 'linear') {
    const start = Math.max(0.5, settings.startSeconds)
    const step = Math.max(0.5, settings.stepSeconds)
    return Array.from({ length: tries }, (_, i) => Math.round((start + step * i) * 10) / 10)
  }
  return Array.from({ length: tries }, (_, i) => classicStage(i))
}

/** Seconds unlocked after `guessCount` wrong guesses (the whole window once
 *  the round is over). */
export function unlockedSeconds(guessCount: number, finished: boolean, ladder: number[]): number {
  const full = ladder[ladder.length - 1]
  if (finished) return full
  return ladder[Math.min(guessCount, ladder.length - 1)]
}

// ─── Settings ─────────────────────────────────────────────────────────────────
//
// Unlimited only. Both once-a-day modes ignore every one of these and play the
// standard rules, because their results are league material: a run of six-try
// rounds and a run of ten-try rounds are not the same achievement, and a
// leaderboard that mixes them ranks whoever turned the difficulty down. The
// settings panel says so rather than letting the controls look live.

/** Bumped when a default changes in a way a saved blob would otherwise mask -
 *  see loadSettings. */
const SETTINGS_VERSION = 2

export interface HeardleSettings {
  /** Schema version of the saved blob, for the migration in loadSettings. */
  v?: number
  /** Guesses allowed per round. */
  tries: number
  ladder: 'classic' | 'linear'
  /** Linear ladder only: first unlock, and how much each miss adds. */
  startSeconds: number
  stepSeconds: number
  /** Era abbreviations to draw from; empty means all of them. */
  eras: string[]
  /** Which catalogues to draw from. Never empty - the UI keeps one selected. */
  categories: PoolId[]
  /** Where the clip starts: the song's opening, or a timestamp somewhere
   *  inside it. Timestamp is the default - intros are the most recognisable
   *  and most sampled part of a song, so starting there every time makes the
   *  game both easier and more repetitive than it should be. */
  startPoint: 'intro' | 'timestamp'
  /** The "Same era" badge on wrong guesses. */
  eraHint: boolean
}

// Skip-silence is deliberately NOT here. A clip of dead air isn't a difficulty
// setting, it's a broken round - nobody would choose it, and letting it be
// switched off just leaves a way to make the game worse. It's always on; see
// the silence detection in HeardleView.

export const DEFAULT_SETTINGS: HeardleSettings = {
  v: SETTINGS_VERSION,
  tries: DEFAULT_TRIES,
  ladder: 'classic',
  startSeconds: 1,
  stepSeconds: 2,
  eras: [],
  categories: ['released'],
  startPoint: 'timestamp',
  eraHint: true,
}

export function clampTries(tries: number): number {
  if (!Number.isFinite(tries)) return DEFAULT_TRIES
  return Math.min(MAX_TRIES, Math.max(MIN_TRIES, Math.round(tries)))
}

/** Settings as they actually apply to a mode - see the note above. Every read
 *  goes through this so no call site has to remember the rules. */
export function settingsForMode(settings: HeardleSettings, mode: 'daily' | 'personal' | 'unlimited'): HeardleSettings {
  return mode === 'unlimited' ? settings : DEFAULT_SETTINGS
}

export function loadSettings(): HeardleSettings {
  const saved = lsGet<Partial<HeardleSettings>>('settings')
  const merged = { ...DEFAULT_SETTINGS, ...(saved ?? {}) }

  // A blob is written the first time the tab is opened, so a saved value is
  // not evidence of a deliberate choice - it's usually just whatever the
  // default was that day. Without this, changing a default would only ever
  // reach people who had never played. v1 blobs predate the timestamp start,
  // so their startPoint is dropped in favour of the current default.
  const stale = (merged.v ?? 1) < SETTINGS_VERSION
  const startPoint = stale || (merged.startPoint !== 'intro' && merged.startPoint !== 'timestamp')
    ? DEFAULT_SETTINGS.startPoint
    : merged.startPoint

  return {
    ...merged,
    v: SETTINGS_VERSION,
    startPoint,
    tries: clampTries(merged.tries),
    categories: merged.categories?.length ? merged.categories : DEFAULT_SETTINGS.categories,
  }
}

export function saveSettings(settings: HeardleSettings): void {
  lsSet('settings', settings)
}

// Puzzle #1. Any date before this still works (the number just goes ≤ 0), but
// nothing sensible links to those, so it doubles as the launch day.
const EPOCH = Date.UTC(2026, 7, 1) // 2026-08-01

// ─── Song shape ───────────────────────────────────────────────────────────────
//
// A trimmed-down JWApiSong. The full objects carry lyrics and every metadata
// field, ~5 KB each - fine for a page of search results, far too heavy for a
// whole-category pool we want to keep in localStorage between sessions.

export interface HeardleSong {
  id: number
  name: string
  /** Every accepted spelling: `name` plus the API's `track_titles` aliases. */
  titles: string[]
  path: string
  era: string | null
  category: string
  imageUrl?: string
  length: string
}

/** Resolves a "reveal" song's cover to a loadable URL, regardless of which
 *  shape the server actually sent it in.
 *
 *  Server-graded rounds (see lib/heardleApi, lib/heardleMatchApi) hand back a
 *  `reveal` object that the client types as `HeardleSong` - i.e. it assumes
 *  the cover already arrives resolved under `imageUrl`, the same shape `slim`
 *  below produces locally. In practice these endpoints reuse the catalog's own
 *  serializer, which is `image_url` (snake_case, a site-relative asset path
 *  like "/assets/fd.webp" - confirmed against GET /songs/{id}/) - so reading
 *  `.imageUrl` off the real payload is reading a field that was never there,
 *  and the reveal card shows no art. That's a wire-shape mismatch, not missing
 *  data: the catalog has cover art for nearly every released song.
 *
 *  Takes `unknown` rather than `HeardleSong` on purpose - the whole point is
 *  to look past what the type declares and read what's actually on the
 *  runtime object, trying every field name a reasonable backend might use.
 *  `buildImageUrl` is idempotent for an already-absolute URL, so this is safe
 *  to run even where the field genuinely does arrive pre-resolved. */
export function revealCoverUrl(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const candidate = r.imageUrl ?? r.image_url ?? r.cover_url ?? r.coverUrl ?? r.image
  return typeof candidate === 'string' && candidate ? buildImageUrl(candidate) : undefined
}

function slim(song: JWApiSong): HeardleSong | null {
  // No path means nothing to stream - a song that can't be played can't be
  // guessed, and it must not sit in the pool the daily answer is drawn from.
  if (!song.path) return null
  const titles = [song.name, ...(song.track_titles ?? [])].filter(Boolean)
  return {
    id: song.id,
    // The API's own `name`, NOT track_titles[0] - track_titles is an
    // unordered alias list, and using its first entry as the display title
    // (once the pattern elsewhere in the app, since fixed) surfaced aliases in
    // place of the names people actually know: "Breakthrough" for Man Of The
    // Year, "AGATS (Pt. 1)" for All Girls Are The Same, "GTA Love" for Wasted
    // (20 of 321 released songs disagree). `name` also carries the "(1)"/"(2)"
    // suffixes that tell four identically-titled rows apart. Every alias
    // still counts as a guess - see `titles`.
    name: song.name,
    titles: [...new Set(titles)],
    path: song.path,
    era: song.era?.name ?? null,
    category: song.category,
    imageUrl: buildImageUrl(song.image_url),
    length: song.length,
  }
}

// ─── Title matching ───────────────────────────────────────────────────────────

/** Flattens a title for comparison/search: punctuation and casing differ
 *  constantly between a song's `name` and its `track_titles` aliases.
 *
 *  Apostrophes are deleted rather than flattened to a space, so "dont" matches
 *  "don't" - the way the API's own search behaves, and the way people type.
 *  Turning them into spaces made "I'll Be Fine" normalize to "i ll be fine",
 *  which the natural query "ill be fine" doesn't contain, so 30 of the 321
 *  released songs simply never appeared in the dropdown. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

// ─── Version groups ───────────────────────────────────────────────────────────
//
// The /versions/ table links rows that are the same underlying song under
// different cuts - "Zoom (v1)" / "(v2)", an unreleased take and its session.
// Guessing any member of the group is guessing the song, so all of them count.

export interface VersionInfo {
  groupId: number
  /** The group's shared name, e.g. "Zoom". */
  versionTitle: string | null
  /** This cut's own label within the group, e.g. "v2", "Session". */
  version: string | null
}

export type VersionMap = Map<number, VersionInfo>

/** Version metadata for everything in a pool, keyed by song id. One bulk
 *  request; failures come back empty, which just falls the matching back to
 *  titles. Never block the round on this. */
export async function loadVersionGroups(pool: HeardleSong[]): Promise<VersionMap> {
  const meta = await getVersionMetaForSongs(pool.map((s) => s.id))
  const out: VersionMap = new Map()
  for (const [songId, m] of meta) {
    out.set(songId, { groupId: m.groupId, versionTitle: m.versionTitle, version: m.version })
  }
  return out
}

/** True when a guess names the answer: the same row, a linked version of it,
 *  or a row that shares one of its titles. The catalogue holds plenty of songs
 *  that are the same thing filed twice, and picking the "wrong" one of those
 *  out of the dropdown is not a wrong guess. */
export function isCorrectGuess(guess: HeardleSong, answer: HeardleSong, versions?: VersionMap): boolean {
  if (guess.id === answer.id) return true
  if (versions) {
    const g = versions.get(guess.id)
    const a = versions.get(answer.id)
    if (g && a && g.groupId === a.groupId) return true
  }
  const wanted = new Set(answer.titles.map(normalizeTitle))
  return guess.titles.some((t) => wanted.has(normalizeTitle(t)))
}

/** Dropdown candidates for what the user has typed so far. Whole-pool
 *  substring match over every alias, prefix matches first, capped so the list
 *  stays renderable.
 *
 *  The whole pool is always scanned: an earlier version bailed out as soon as
 *  the prefix bucket was full, which silently dropped later songs even when
 *  the list had room for them. 321 rows of `indexOf` per keystroke is nothing.
 */
export function searchPool(pool: HeardleSong[], query: string, limit = 50): HeardleSong[] {
  const q = normalizeTitle(query)
  if (!q) return []
  const starts: HeardleSong[] = []
  const contains: HeardleSong[] = []
  for (const song of pool) {
    let best = -1
    for (const t of song.titles) {
      const idx = normalizeTitle(t).indexOf(q)
      if (idx >= 0 && (best < 0 || idx < best)) best = idx
    }
    if (best === 0) starts.push(song)
    else if (best > 0) contains.push(song)
  }
  return [...starts, ...contains].slice(0, limit)
}

/** The alias a query hit, when it isn't the name being displayed - so the
 *  dropdown can explain why a row it doesn't obviously match is in the list
 *  (typing "agats" turning up "All Girls Are The Same"). */
export function matchedAlias(song: HeardleSong, query: string): string | null {
  const q = normalizeTitle(query)
  if (!q || normalizeTitle(song.name).includes(q)) return null
  return song.titles.find((t) => t !== song.name && normalizeTitle(t).includes(q)) ?? null
}

// ─── Pool loading ─────────────────────────────────────────────────────────────

export type PoolId = 'released' | 'unreleased'

export const POOL_LABELS: Record<PoolId, string> = {
  released: 'Released',
  unreleased: 'Unreleased',
}

// Deliberately NOT routed through apiFetch: that caches each raw response
// under the offline cache, and a category's worth of full song objects is
// ~0.5 MB per page - enough to evict most of the app's other cached reads.
// The slimmed pool is cached here instead, at roughly a twentieth the size.
const POOL_TTL_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 100
const MAX_PAGES = 25

const memoryPool = new Map<PoolId, HeardleSong[]>()

interface CachedPool { ts: number; songs: HeardleSong[] }

async function fetchPool(category: PoolId): Promise<HeardleSong[]> {
  const songs: HeardleSong[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${routeUrl('/songs/')}?category=${category}&page=${page}&page_size=${PAGE_SIZE}`
    const data = await apiRequest<JWApiPaginatedResponse>(url)
    for (const song of data.results ?? []) {
      const s = slim(song)
      if (s) songs.push(s)
    }
    if (!data.next) break
  }
  return songs
}

/** The full playable catalogue for a category, memoised for the session and
 *  cached on disk for a day. A stale cache is served immediately and left
 *  alone - the pool only shifts when the catalogue itself grows, and a pool
 *  that changed mid-round would change the answer under the player. */
export async function loadPool(category: PoolId): Promise<HeardleSong[]> {
  const memo = memoryPool.get(category)
  if (memo) return memo

  // v2: entries cached before the display name switched from track_titles[0]
  // to `name` would keep showing aliases until the TTL ran out.
  const cached = lsGet<CachedPool>(`pool:v2:${category}`)
  if (cached && cached.songs?.length && Date.now() - cached.ts < POOL_TTL_MS) {
    memoryPool.set(category, cached.songs)
    return cached.songs
  }

  let songs: HeardleSong[]
  try {
    songs = await fetchPool(category)
  } catch (err) {
    // Offline with a stale copy is better than no game at all.
    if (cached?.songs?.length) {
      memoryPool.set(category, cached.songs)
      return cached.songs
    }
    throw err
  }
  memoryPool.set(category, songs)
  lsSet(`pool:v2:${category}`, { ts: Date.now(), songs } as CachedPool)
  return songs
}

/** Every pool in `categories`, concatenated. */
export async function loadPools(categories: PoolId[]): Promise<HeardleSong[]> {
  const pools = await Promise.all(categories.map(loadPool))
  return pools.flat()
}

/** Narrows a pool to the chosen eras (empty = all). */
export function filterByEra(pool: HeardleSong[], eras: string[]): HeardleSong[] {
  if (eras.length === 0) return pool
  const wanted = new Set(eras)
  return pool.filter((s) => s.era && wanted.has(s.era))
}

/** Era abbreviations present in a pool, with song counts, most first. */
export function poolEras(pool: HeardleSong[]): { era: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const s of pool) {
    if (s.era) counts.set(s.era, (counts.get(s.era) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([era, count]) => ({ era, count }))
    .sort((a, b) => b.count - a.count || a.era.localeCompare(b.era))
}

// ─── Clip start ───────────────────────────────────────────────────────────────

/** Where in the song the clip begins. 'intro' is always 0; 'timestamp' picks a
 *  point that still leaves the full window's worth of audio ahead of it.
 *
 *  Skips the first 10 seconds as well as the tail: a "timestamp" that lands on
 *  0:03 is an intro with extra steps, and lead-ins are often near-silent.
 *  Songs too short to offer a real interval start at the beginning.
 *
 *  `seed` makes the choice repeatable - a once-a-day round has to resume at
 *  the same offset after a reload, or a player could re-roll an awkward start
 *  by refreshing. Pass null for practice rounds, which re-roll freely. */
export function clipStart(
  song: HeardleSong,
  window: number,
  startPoint: HeardleSettings['startPoint'],
  seed: string | null,
): number {
  if (startPoint === 'intro') return 0
  const duration = parseDuration(song.length)
  const earliest = 10
  const latest = duration - window - 5
  if (!(latest > earliest)) return 0
  const roll = seed === null ? Math.random() : hash32(`${seed}-${song.id}`) / 0x1_0000_0000
  return Math.floor(earliest + roll * (latest - earliest))
}

// ─── Daily selection ──────────────────────────────────────────────────────────

/** Local calendar day as YYYY-MM-DD - the puzzle rolls over at the player's
 *  own midnight, so the countdown they see matches the one they feel. */
export function todayKey(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayKeyToUtc(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** 1-based puzzle number for a day key - what the shared grid is titled with. */
export function puzzleNumber(dayKey: string): number {
  return Math.round((dayKeyToUtc(dayKey) - EPOCH) / 86_400_000) + 1
}

/** The day key before this one. */
export function previousDayKey(dayKey: string): string {
  return todayKey(new Date(dayKeyToUtc(dayKey) - 86_400_000))
}

/** Milliseconds until the local day rolls over. */
export function msUntilNextPuzzle(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

// FNV-1a. Not cryptographic - it just has to scatter consecutive date strings
// so consecutive days don't land on neighbouring songs. Exported for lib/wordle,
// which derives its own daily answer the same way (from a different seed).
export function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The answer for a given day. Sorted by id first so the choice never depends
 *  on the order the API happened to return pages in - two clients must agree.
 *  (Adding songs to the catalogue does shift the mapping; that only matters
 *  within a day, and the pool cache means a shift mid-day is unlikely.) */
export function pickDailySong(pool: HeardleSong[], dayKey: string): HeardleSong | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort((a, b) => a.id - b.id)
  return sorted[hash32(`heardle-${dayKey}`) % sorted.length]
}

/** The player's own answer for a given day - same idea as pickDailySong, but
 *  the seed carries a per-device id, so it's a different song from everyone
 *  else's while still being stable for the whole day. */
export function pickPersonalSong(pool: HeardleSong[], dayKey: string, seed: string): HeardleSong | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort((a, b) => a.id - b.id)
  return sorted[hash32(`heardle-${seed}-${dayKey}`) % sorted.length]
}

/** This install's personal-mode seed, minted on first use and kept forever -
 *  losing it re-rolls today's personal song. Not an identity: nothing is sent
 *  anywhere, it exists purely to be different from the next person's. */
export function playerSeed(): string {
  const saved = lsGet<string>('seed')
  if (saved) return saved
  const seed = Math.random().toString(36).slice(2) + Date.now().toString(36)
  lsSet('seed', seed)
  return seed
}

/** A random song for practice rounds. */
export function pickRandomSong(pool: HeardleSong[]): HeardleSong | null {
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

// ─── Game state ───────────────────────────────────────────────────────────────

export interface Guess {
  /** null for a skip. */
  songId: number | null
  label: string
  era: string | null
  /** Wrong guess that shares the answer's era - shown as a warm "close" hint. */
  sameEra: boolean
  /** Won on a different row than the answer's - a linked version, or a
   *  duplicate filed under the same title. Worth saying so on the reveal, or
   *  it reads like the game accepted the wrong song. */
  viaVersion?: boolean
}

export type GameStatus = 'playing' | 'won' | 'lost'

/** The two once-a-day modes. `daily` is the same song for everyone; `personal`
 *  is the player's own. They keep separate saved rounds and separate streaks -
 *  playing one must never advance (or break) the other's. `unlimited` isn't
 *  here: practice rounds are neither saved nor counted. */
export type DailyMode = 'daily' | 'personal'

export interface RoundState {
  day: string
  answerId: number
  guesses: Guess[]
  status: GameStatus
}

export interface Stats {
  played: number
  won: number
  currentStreak: number
  maxStreak: number
  /** Wins bucketed by the guess that landed them, index 0 = first try. */
  distribution: number[]
  lastDay: string | null
}

export const EMPTY_STATS: Stats = {
  played: 0, won: 0, currentStreak: 0, maxStreak: 0,
  distribution: Array(MAX_TRIES).fill(0), lastDay: null,
}

const LS_PREFIX = 'unreleased:heardle:'

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

/** The saved round for `dayKey`, or null when it's a new day / a different
 *  answer (the catalogue grew and the day's pick moved - start over rather
 *  than replay someone else's guesses against the wrong song). */
export function loadRound(mode: DailyMode, dayKey: string, answerId: number): RoundState | null {
  const saved = lsGet<RoundState>(`round:${mode}`)
  if (!saved || saved.day !== dayKey || saved.answerId !== answerId) return null
  return saved
}

export function saveRound(mode: DailyMode, state: RoundState): void {
  lsSet(`round:${mode}`, state)
}

/** A practice round in progress. Unlimited is neither scored nor streaked, but
 *  it is still a round someone is in the middle of: leaving the tab and coming
 *  back used to throw the guesses away and deal a new song. No day - a
 *  practice round is whatever you last left open, not something that expires
 *  at midnight. */
export interface PracticeRound {
  answerId: number
  guesses: Guess[]
  status: GameStatus
  /** Where the clip was cut from. Practice re-rolls this freely on a new song
   *  (see clipStart's null seed), so resuming has to restore the offset the
   *  round was actually played at rather than roll a fresh one under it. */
  startAt: number
}

export function loadPracticeRound(): PracticeRound | null {
  return lsGet<PracticeRound>('round:unlimited')
}

export function savePracticeRound(round: PracticeRound): void {
  lsSet('round:unlimited', round)
}

/** The mode tab to open on. 1v1 is deliberately not persistable - it's a live
 *  match, and dropping someone back into matchmaking because that's where they
 *  were last week isn't resuming anything. */
export function loadGameMode(): DailyMode | 'unlimited' {
  const saved = lsGet<string>('mode')
  return saved === 'personal' || saved === 'unlimited' ? saved : 'daily'
}

export function saveGameMode(mode: DailyMode | 'unlimited'): void {
  lsSet('mode', mode)
}

export function loadStats(mode: DailyMode): Stats {
  const saved = lsGet<Stats>(`stats:${mode}`)
  if (!saved) return { ...EMPTY_STATS, distribution: Array(MAX_TRIES).fill(0) }
  return {
    ...EMPTY_STATS,
    ...saved,
    distribution: Array.from({ length: MAX_TRIES }, (_, i) => saved.distribution?.[i] ?? 0),
  }
}

/** Folds one finished round into that mode's saved stats. Idempotent per day -
 *  `lastDay` guards against a re-render (or a second window) counting the same
 *  result twice. */
export function recordResult(mode: DailyMode, dayKey: string, won: boolean, guessCount: number): Stats {
  const stats = loadStats(mode)
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
  lsSet(`stats:${mode}`, next)
  return next
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

/** The spoiler-free result grid: a square per guess, left to right. Personal
 *  rounds get their own title - the grid isn't comparable with anyone else's,
 *  so it shouldn't read as if it were. */
export function shareText(mode: DailyMode, dayKey: string, guesses: Guess[], status: GameStatus, tries: number): string {
  const squares: string[] = guesses.map((g) => (g.songId === null ? '⬛' : '🟥'))
  if (status === 'won') squares[squares.length - 1] = '🟩'
  while (squares.length < tries) squares.push('⬜')
  const title = mode === 'daily'
    ? `Unreleased Heardle #${puzzleNumber(dayKey)}`
    : `My Heardle - ${dayKey}`
  return `${title}\n\n🔊${squares.join('')}`
}
