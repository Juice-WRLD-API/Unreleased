// Official videos for released songs, played in WRLD in place of the visualizer.
// They are the YouTube uploads filed under Footage/Youtube/<year>/<date>/ in the
// primary channel, named like "Juice WRLD - Wishing Well (Official Music Video).mp4".
// A video rarely runs the song straight through (intros, skits cut in, a shorter
// edit), so lib/videoSync lines its sound up with the song before it's shown.
import { apiFileIdToRef, getSongById, listSubtree, type JWApiFileEntry } from './juicewrldApi'
import { isAbortError } from './apiClient'
import { trackIdToSongId } from './userApi'
import { alignMusicVideo, type VideoSync } from './videoSync'
import { getMusicVideoDefaults } from './musicVideoDefaultsApi'
import type { Track } from '../types'

export const MUSIC_VIDEO_ROOT = 'Footage/Youtube'

/** music: music videos and "Official Video"s. Visualizers stand in when a song has none; lyric videos only when asked for. */
export type MusicVideoKind = 'music' | 'visualizer' | 'lyric'

export interface MusicVideo {
  path: string
  /** The song's title as the file names it, without artists or the "(Official …)" tag. */
  title: string
  kind: MusicVideoKind
  /** The upload day from its folder, YYYY-MM-DD, or '' when it has none. */
  date: string
  size: number
}

export const VIDEO_KIND_LABEL: Record<MusicVideoKind, string> = { music: 'Music video', visualizer: 'Official visualizer', lyric: 'Lyric video' }

/** "Music video · July 13, 2020": how a picker names a video, the song being known already. */
export function videoLabel(v: MusicVideo): string {
  const day = v.date ? new Date(`${v.date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
  return day ? `${VIDEO_KIND_LABEL[v.kind]} · ${day}` : VIDEO_KIND_LABEL[v.kind]
}

/** What a setting lets WRLD show: none, music videos (or a visualizer when there's none), or lyric videos too. */
export type MusicVideoChoice = 'off' | 'music' | 'all'

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i
const KIND_TAGS: [RegExp, MusicVideoKind][] = [
  [/\((?:official\s+)?(?:music\s+|fortnite\s+)?video\)/i, 'music'],
  [/\(official\s+visuali[sz]er\)/i, 'visualizer'],
  [/\((?:official\s+)?lyric\s+video\)/i, 'lyric'],
]

/** Words, lowercased, with "&" read as "and" and every quote and sign dropped. */
export function titleKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// "(with X)", "(feat. X)", "[ft. X]" and a trailing "ft. X" name guests, not the song.
const FEATURES = /\s*[([](?:with|feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s.*$/gi

/** A song name as a match key: its features left out, "(Remix)" and "(Live)" kept. */
export function songTitleKey(name: string): string {
  return titleKey(name.replace(FEATURES, ''))
}

/** The title and kind a file name stands for, or null when it isn't a video of a song. */
export function parseVideoName(fileName: string): { title: string; kind: MusicVideoKind } | null {
  if (!VIDEO_EXT.test(fileName) || /\.temp\.\w+$/i.test(fileName)) return null
  const base = fileName.replace(VIDEO_EXT, '')
  // Vevo's older uploads carry no tag at all ("Juice WRLD - Black & White"). Any other "(Official …)" (Audio, Album
  // Trailer) is a still picture or not the song; a live set or freestyle names itself and finds no song.
  const tag = KIND_TAGS.find(([re]) => re.test(base)) ?? (/\(official\b/i.test(base) ? null : [/$^/, 'music'] as [RegExp, MusicVideoKind])
  if (!tag) return null
  let rest = base.replace(tag[0], '')
  // "Artists - Title": the first dash with a space after it ("Juice WRLD-  Conversations" too).
  const dash = /\s*[-–—]\s+/.exec(rest)
  if (dash) rest = rest.slice(dash.index + dash[0].length)
  const title = rest.replace(/[＂"“”]/g, '').replace(FEATURES, '').trim()
  return title ? { title, kind: tag[1] } : null
}

/** A video known only by its path (an administrator's default filed under another title): named from the file if it
 *  can be, else as a music video titled by its file name. */
export function videoFromPath(path: string): MusicVideo {
  const name = path.split('/').pop() ?? path
  const parsed = parseVideoName(name) ?? { title: name.replace(VIDEO_EXT, ''), kind: 'music' as MusicVideoKind }
  return { path, ...parsed, date: /\/(\d{4}-\d{2}-\d{2})\//.exec(path)?.[1] ?? '', size: 0 }
}

export function videosFromEntries(entries: JWApiFileEntry[]): MusicVideo[] {
  const out: MusicVideo[] = []
  for (const e of entries) {
    if (e.type !== 'file') continue
    const parsed = parseVideoName(e.name)
    if (!parsed) continue
    out.push({ path: e.path, ...parsed, date: /\/(\d{4}-\d{2}-\d{2})\//.exec(e.path)?.[1] ?? '', size: e.size ?? 0 })
  }
  return out
}

const INDEX_TTL_MS = 30 * 60 * 1000
let index: { at: number; byKey: Promise<Map<string, MusicVideo[]>> } | null = null

/** Every song video in the archive, by title key. Fetched once and kept half an hour. */
export function loadMusicVideoIndex(force = false): Promise<Map<string, MusicVideo[]>> {
  if (!force && index && Date.now() - index.at < INDEX_TTL_MS) return index.byKey
  const byKey = listSubtree(MUSIC_VIDEO_ROOT).then((entries) => {
    const map = new Map<string, MusicVideo[]>()
    for (const v of videosFromEntries(entries ?? [])) {
      const key = titleKey(v.title)
      map.set(key, [...(map.get(key) ?? []), v])
    }
    return map
  })
  // A failure isn't kept: the next song asks again.
  byKey.catch(() => { if (index?.byKey === byKey) index = null })
  index = { at: Date.now(), byKey }
  return byKey
}

const RANK: Record<MusicVideoKind, number> = { music: 0, visualizer: 1, lyric: 2 }

/** The videos for a song name, best first: music videos, then official visualizers, then (with `all`) lyric videos,
 *  newest first within each. Visualizers come after every music video, so they only play for a song whose music
 *  videos are missing or don't line up. A re-upload or "Go Hard 2.0" gets its own name, so this never mixes songs. */
export function videosFor(map: Map<string, MusicVideo[]>, songName: string, choice: MusicVideoChoice): MusicVideo[] {
  if (choice === 'off') return []
  return (map.get(songTitleKey(songName)) ?? [])
    .filter((v) => choice === 'all' || v.kind !== 'lyric')
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.date.localeCompare(a.date))
}

/** Only released songs have official videos; an unreleased "Lucid Dreams (v2)" must not borrow one. */
export function isReleasedPath(path: string | null | undefined): boolean {
  return !!path && /^Compilation\/1\. Released Discography\//.test(path)
}

/** The song a video is looked for: its name and its file in the primary channel. */
export interface MusicVideoTarget { name: string; path: string }

/** What's playing as a video target: a released catalogue song, or a file from the released discography. */
export async function musicVideoTargetForTrack(track: Track | null, signal?: AbortSignal): Promise<MusicVideoTarget | null> {
  if (!track) return null
  const songId = trackIdToSongId(track.id)
  if (songId != null) return musicVideoTargetForSong(songId, signal)
  const ref = apiFileIdToRef(track.id)
  if (!ref || (ref.channel && ref.channel !== 'comp') || !isReleasedPath(ref.path)) return null
  return { name: (ref.path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''), path: ref.path }
}

export async function musicVideoTargetForSong(songId: number, signal?: AbortSignal): Promise<MusicVideoTarget | null> {
  const song = await getSongById(songId, signal)
  return song.category === 'released' && song.path && isReleasedPath(song.path) ? { name: song.name, path: song.path } : null
}

export interface MusicVideoMatch { video: MusicVideo; sync: VideoSync }

/** The first of the song's videos whose sound holds the song, lined up with it; null when none does. The first look at a
 *  video downloads its sound and the song's (a few MB) and takes a few seconds; after that it's kept on the device. */
export async function findMusicVideo(target: MusicVideoTarget, choice: MusicVideoChoice, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<MusicVideoMatch | null> {
  const map = await loadMusicVideoIndex()
  for (const video of videosFor(map, target.name, choice)) {
    let sync: VideoSync | null = null
    try { sync = await alignMusicVideo(video.path, target.path, opts) } catch (err) {
      if (isAbortError(err)) throw err
      console.warn('[musicVideos] could not sync', video.path, err)
    }
    if (sync) return { video, sync }
  }
  return null
}

/** What's playing as a video target, whether a song or 999 FM: what WRLD and the cleared desk look a video up for. */
export interface PlayingForVideo {
  track: Track | null
  fmActive: boolean
  fmSong: { songId?: number | null; path?: string | null } | null
}

/** Changes exactly when the video target may: a new song, or 999 FM's next. */
export const videoTargetKey = (p: PlayingForVideo): string =>
  (p.fmActive ? `fm:${p.fmSong?.songId ?? ''}:${p.fmSong?.path ?? ''}` : `t:${p.track?.id ?? ''}`)

export async function musicVideoTargetFor(p: PlayingForVideo, signal?: AbortSignal): Promise<MusicVideoTarget | null> {
  if (!p.fmActive) return musicVideoTargetForTrack(p.track, signal)
  if (p.fmSong?.songId != null) return musicVideoTargetForSong(p.fmSong.songId, signal)
  const path = p.fmSong?.path
  return path && isReleasedPath(path) ? { name: (path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''), path } : null
}

/** The song's videos for the pickers: every one, the one on screen, and the administrators' default. */
export interface MusicVideoList {
  songPath: string
  videos: { path: string; label: string }[]
  active: string | null
  /** A video's path, '' for no video for everyone, null for none set. */
  serverDefault: string | null
}

/** The video to show for `target`: the listener's own `pick` (a path, or 'none' for the visualizer), then the
 *  administrators' default, then the best that lines up under `choice`. `onList` hears the song's videos as soon as
 *  they're known, before any is lined up; `pickedFails` when the picked one doesn't line up with the song. */
export async function chooseMusicVideo(target: MusicVideoTarget, opts: {
  choice: MusicVideoChoice
  pick: string | null
  signal?: AbortSignal
  onList?: (list: MusicVideoList) => void
  pickedFails?: () => void
}): Promise<{ list: MusicVideoList; match: MusicVideoMatch | null }> {
  const { choice, pick, signal } = opts
  const [index, defaults] = await Promise.all([loadMusicVideoIndex(), getMusicVideoDefaults().catch(() => new Map<string, string>())])
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const videos = videosFor(index, target.name, 'all')
  // '' : no video for everyone; a path: that video, even one filed under another title.
  const serverDefault = defaults.get(target.path) ?? null
  if (serverDefault && !videos.some((v) => v.path === serverDefault)) videos.unshift(videoFromPath(serverDefault))
  const list: MusicVideoList = { songPath: target.path, videos: videos.map((v) => ({ path: v.path, label: videoLabel(v) })), active: null, serverDefault }
  opts.onList?.(list)
  const lineUp = async (video: MusicVideo): Promise<MusicVideoMatch | null> => {
    const sync = await alignMusicVideo(video.path, target.path, { signal })
    return sync ? { video, sync } : null
  }
  const picked = pick && pick !== 'none' ? videos.find((v) => v.path === pick) : undefined
  const byDefault = !pick && serverDefault ? videos.find((v) => v.path === serverDefault) : undefined
  let match: MusicVideoMatch | null = null
  if (picked) {
    match = await lineUp(picked)
    if (!match && !signal?.aborted) opts.pickedFails?.()
  } else if (pick === 'none' || choice === 'off' || (!pick && serverDefault === '')) {
    match = null
  } else {
    // A default that doesn't line up falls back to the automatic pick rather than showing nothing.
    match = (byDefault && await lineUp(byDefault)) || await findMusicVideo(target, choice, { signal })
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return { list: { ...list, active: match?.video.path ?? null }, match }
}
