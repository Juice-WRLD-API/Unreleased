// The site modules the CLI compiles in as they are (see build.mjs). Declared by
// hand so type-checking the CLI doesn't walk the site's whole browser module
// graph; keep these in step with the real signatures.

declare module 'site:fileTools' {
  import type { FilesCwd } from './files'
  export function catFile(cwd: FilesCwd, arg: string): Promise<string>
  export function headTailFile(which: 'head' | 'tail', cwd: FilesCwd, arg: string): Promise<string>
  export function wcFile(cwd: FilesCwd, arg: string): Promise<string>
  export function locateName(cwd: FilesCwd, arg: string): Promise<string>
  export function treeView(cwd: FilesCwd, arg: string): Promise<string>
  export function diskUsage(cwd: FilesCwd, arg: string): Promise<string>
  export function grepFiles(cwd: FilesCwd, arg: string): Promise<string>
}

declare module 'site:format' {
  export function formatBytes(b: number): string
}

declare module 'site:fileTypes' {
  export const AUDIO_EXTS: Set<string>
  export function getFileExt(name: string): string
}

declare module 'site:termTypes' {
  export function clock(seconds: number): string
  export function parseBool(word: string): boolean | null
  export function pickByName<T>(items: T[], name: (t: T) => string, typed: string): T | null
}

declare module 'site:listeningStats' {
  export type ListeningPeriod = 'all' | '7' | '30'
  export interface StatsSongLike {
    id: number
    name: string
    length: string
    credited_artists: string
    producers: string
    category: string
    era: { name: string } | null
  }
  export interface SongPreference { song: number; playcount: number }
  export interface PlayedSong<S extends StatsSongLike = StatsSongLike> { song: S; playcount: number; seconds: number }
  export interface RankedEntry { key: string; label: string; plays: number; songs: number; share: number }
  export interface ListeningStats<S extends StatsSongLike = StatsSongLike> {
    played: PlayedSong<S>[]
    totalPlays: number
    distinctSongs: number
    totalSeconds: number
    eras: RankedEntry[]
    categories: RankedEntry[]
    producers: RankedEntry[]
    collaborators: RankedEntry[]
  }
  export function prefsForPeriod(events: { song: number; played_at: string }[], period: ListeningPeriod): SongPreference[]
  export function joinPlayedSongs<S extends StatsSongLike>(prefs: SongPreference[], songs: Map<number, S>): PlayedSong<S>[]
  export function buildListeningStats<S extends StatsSongLike>(played: PlayedSong<S>[]): ListeningStats<S>
  export function formatListeningTime(seconds: number): string
}

declare module 'site:heardle' {
  export type PoolId = 'released' | 'unreleased'
  export type GameStatus = 'playing' | 'won' | 'lost'
  export interface HeardleSong {
    id: number
    name: string
    titles: string[]
    path: string
    era: string | null
    category: string
    length: string
  }
  export interface HeardleSettings {
    tries: number
    ladder: 'classic' | 'linear'
    startSeconds: number
    stepSeconds: number
    eras: string[]
    categories: PoolId[]
    startPoint: 'intro' | 'timestamp'
    eraHint: boolean
  }
  export interface Guess { songId: number | null; label: string; era: string | null; sameEra: boolean; viaVersion?: boolean }
  export interface PracticeRound { answerId: number; guesses: Guess[]; status: GameStatus; startAt: number }
  export type VersionMap = Map<number, { groupId: number; versionTitle: string | null; version: string | null }>
  export function loadSettings(): HeardleSettings
  export function settingsForMode(settings: HeardleSettings, mode: 'daily' | 'personal' | 'unlimited'): HeardleSettings
  export function stageLadder(settings: HeardleSettings): number[]
  export function unlockedSeconds(guessCount: number, finished: boolean, ladder: number[]): number
  export function loadPools(categories: PoolId[]): Promise<HeardleSong[]>
  export function filterByEra(pool: HeardleSong[], eras: string[]): HeardleSong[]
  export function loadVersionGroups(pool: HeardleSong[]): Promise<VersionMap>
  export function isCorrectGuess(guess: HeardleSong, answer: HeardleSong, versions?: VersionMap): boolean
  export function searchPool(pool: HeardleSong[], query: string, limit?: number): HeardleSong[]
  export function normalizeTitle(title: string): string
  export function pickRandomSong(pool: HeardleSong[]): HeardleSong | null
  export function clipStart(song: HeardleSong, window: number, startPoint: HeardleSettings['startPoint'], seed: string | null): number
  export function loadPracticeRound(): PracticeRound | null
  export function savePracticeRound(round: PracticeRound): void
  export function todayKey(d?: Date): string
  export function puzzleNumber(dayKey: string): number
}

declare module 'site:wordle' {
  import type { GameStatus, HeardleSong, PoolId } from 'site:heardle'
  export type LetterState = 'correct' | 'present' | 'absent'
  export interface WordleEntry { song: HeardleSong; key: string }
  export interface WordleSettings { tries: number; categories: PoolId[]; eras: string[]; eraHint: boolean }
  export interface WordleGuess { songId: number; label: string; key: string; era: string | null }
  export interface RoundState { day: string; answerId: number; guesses: WordleGuess[]; status: GameStatus }
  export function loadSettings(): WordleSettings
  export function settingsForMode(settings: WordleSettings, mode: 'daily' | 'unlimited'): WordleSettings
  export function playableEntries(pool: HeardleSong[]): WordleEntry[]
  export function titleKey(title: string): string
  export function findEntryByKey(entries: WordleEntry[], key: string): WordleEntry | null
  export function searchOptions(entries: WordleEntry[], length: number, query: string, limit?: number): HeardleSong[]
  export function gradeGuess(guess: string, answer: string): LetterState[]
  export function letterHints(rows: { key: string; states: LetterState[] }[]): Map<string, LetterState>
  export function pickDailyEntry(entries: WordleEntry[], dayKey: string): WordleEntry | null
  export function pickRandomEntry(entries: WordleEntry[]): WordleEntry | null
  export function loadRound(dayKey: string, answerId: number): RoundState | null
  export function saveRound(state: RoundState): void
  export function loadPracticeRound(): RoundState | null
  export function savePracticeRound(state: RoundState): void
  export function recordResult(dayKey: string, won: boolean, guessCount: number): unknown
  export function shareText(dayKey: string, rows: LetterState[][], status: GameStatus, tries: number, puzzleNo: number): string
}

declare const __VERSION__: string
