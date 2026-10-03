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

declare const __VERSION__: string
