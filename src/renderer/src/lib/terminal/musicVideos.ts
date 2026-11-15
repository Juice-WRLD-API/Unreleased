import { useStore } from '../../store/useStore'
import { useVizStore } from '../../store/vizStore'
import {
  chooseMusicVideo, findMusicVideo, loadMusicVideoIndex, musicVideoTargetFor, musicVideoTargetForSong, titleKey, videoLabel, videosFor,
  type MusicVideo, type MusicVideoChoice, type MusicVideoTarget,
} from '../musicVideos'
import { forgetVideoSync, type VideoSync } from '../videoSync'
import { clearMusicVideoDefault, getMusicVideoDefaults, getMusicVideoDefaultsAdmin, setMusicVideoDefault } from '../musicVideoDefaultsApi'
import { trackIdToSongId } from '../userApi'
import { completeSongs, songFromArg } from './player'
import { asJson, clock, fail, table, type TermCommand } from './types'

// The official videos WRLD plays in place of the visualizer (Settings: `set wrld-videos`).
const SUBS = ['show', 'list', 'resync', 'pick', 'default', 'defaults']

async function target(arg: string): Promise<MusicVideoTarget> {
  if (arg) {
    const song = await songFromArg(arg)
    return (await musicVideoTargetForSong(song.id)) ?? fail(`${song.name} isn’t a released song with a file, so it has no video`)
  }
  // What WRLD and the cleared desk look a video up for: the playing song, or 999 FM's.
  const s = useStore.getState()
  if (!s.radioFmActive && !s.currentTrack) fail('nothing is playing - name a song: musicvideo <song>')
  const name = s.radioFmActive ? (s.radioFmNowPlaying?.title ?? '999 FM’s song') : s.currentTrack!.title
  return (await musicVideoTargetFor({ track: s.currentTrack, fmActive: s.radioFmActive, fmSong: s.radioFmMatchedSong }))
    ?? fail(`${name} isn’t a released song with a file, so it has no video`)
}

const spanLines = (sync: VideoSync): string[][] => sync.spans.map((s, i) => {
  const end = sync.spans[i + 1]?.at
  const range = `${clock(s.at)}-${end === undefined ? 'end' : clock(end)}`
  return [range, s.lag === null ? 'not in the video' : `video at ${clock(s.at + s.lag)} (${s.lag >= 0 ? '+' : ''}${s.lag.toFixed(2)} s)`]
})

/** The song's pick for WRLD as `musicvideo pick` takes it: auto, none, or the video's number. */
function pickWord(t: MusicVideoTarget, videos: MusicVideo[]): string {
  const picked = useVizStore.getState().wrldVideoPicks[t.path] ?? null
  if (picked === null) return 'auto'
  if (picked === 'none') return 'none'
  const n = videos.findIndex((v) => v.path === picked)
  return n >= 0 ? String(n + 1) : 'auto'
}

export const MUSIC_VIDEO_COMMANDS: TermCommand[] = [
  {
    name: 'musicvideo', aliases: ['mvideo'], group: 'Player',
    usage: 'musicvideo [show] [<song>] [--all] · list [text] · resync [<song>] · pick <N|auto|none> · default <N|auto|none> [-- <song>] · defaults',
    description: 'The song’s official video from Files that WRLD plays in place of the visualizer, and where each part of the song is in it. The playing song unless one is named; --all also looks at visualizers and lyric videos. resync works the timing out again. pick chooses the playing song’s video in WRLD by its number from musicvideo (auto: the best that lines up; none: the visualizer). default sets it for every player (administrators), defaults lists them',
    covers: ['musicVideoDefaultsApi.getMusicVideoDefaults', 'musicVideoDefaultsApi.getMusicVideoDefaultsAdmin', 'musicVideoDefaultsApi.setMusicVideoDefault', 'musicVideoDefaultsApi.clearMusicVideoDefault', 'musicVideos.loadMusicVideoIndex', 'musicVideos.findMusicVideo', 'musicVideos.chooseMusicVideo', 'musicVideos.musicVideoTargetFor', 'musicVideos.musicVideoTargetForSong', 'musicVideos.musicVideoTargetForTrack', 'videoSync.alignMusicVideo'],
    complete: (before, partial) => (before.length === 0 ? SUBS.filter((s) => s.startsWith(partial.toLowerCase()))
      : before[0] === 'pick' || before[0] === 'default' ? ['auto', 'none'].filter((w) => w.startsWith(partial.toLowerCase()))
      : before[0] === 'list' || before[0] === 'defaults' ? [] : completeSongs(before.slice(1), partial)),
    run: async (args, ctx) => {
      const json = /(^|\s)--json(?=\s|$)/.test(args)
      const all = /(^|\s)--all(?=\s|$)/.test(args)
      const raw = args.replace(/(^|\s)--(json|all)(?=\s|$)/g, ' ').trim()
      const m = /^(\S+)\s*([\s\S]*)$/.exec(raw)
      const first = (m?.[1] ?? '').toLowerCase()
      const sub = SUBS.includes(first) ? first : 'show'
      const tail = SUBS.includes(first) ? (m?.[2] ?? '').trim() : raw

      if (sub === 'list') {
        const map = await loadMusicVideoIndex(true)
        const q = titleKey(tail)
        const rows = [...map.values()].flat()
          .filter((v) => !q || titleKey(v.title).includes(q))
          .sort((a, b) => a.title.localeCompare(b.title) || a.date.localeCompare(b.date))
        if (asJson(ctx, json, rows)) return
        if (!rows.length) { ctx.print(q ? `no video titled like "${tail}"` : 'no videos found in Files', 'dim'); return }
        ctx.print(table(rows.map((v) => [v.title, v.kind, v.date || '-', v.path]), 200))
        return
      }

      if (sub === 'defaults') {
        const { defaults } = await getMusicVideoDefaultsAdmin()
        if (asJson(ctx, json, defaults)) return
        if (!defaults.length) { ctx.print('no defaults set: every song gets the automatic pick', 'dim'); return }
        ctx.print(table(defaults.map((d) => [`#${d.song_id}`, d.song_name ?? '', d.video_path || '(no video)', d.updated_by ?? '-']), 200))
        return
      }

      if (sub === 'default') {
        // `default <N|none|auto> [-- <song>]`: the playing song unless one is named.
        const [word = '', songArg = ''] = tail.split(/\s+--\s+/)
        const t = await target(songArg.trim())
        const playing = useStore.getState().currentTrack
        const songId = songArg.trim() ? (await songFromArg(songArg.trim())).id
          : (playing ? trackIdToSongId(playing.id) : null) ?? fail('the playing file isn’t a library song - name one: musicvideo default <N|auto|none> -- <song>')
        const videos = videosFor(await loadMusicVideoIndex(), t.name, 'all')
        const w = word.trim().toLowerCase()
        const n = Number(w)
        const chosen = Number.isInteger(n) && n >= 1 && n <= videos.length ? videos[n - 1] : null
        if (w !== 'auto' && w !== 'none' && !chosen) fail(`usage: musicvideo default <1-${videos.length || 'N'}|auto|none> [-- <song>]`)
        if (w === 'auto') await clearMusicVideoDefault(songId)
        else await setMusicVideoDefault(songId, w === 'none' ? '' : chosen!.path)
        ctx.print(`${t.name}, for everyone: ${w === 'auto' ? 'the automatic pick' : w === 'none' ? 'no video' : videoLabel(chosen!)}`, 'ok')
        return
      }

      if (sub === 'pick') {
        const t = await target('')
        const videos = videosFor(await loadMusicVideoIndex(), t.name, 'all')
        if (!videos.length) fail(`${t.name} has no video in Files`)
        const word = tail.toLowerCase()
        const n = Number(word)
        const chosen = Number.isInteger(n) && n >= 1 && n <= videos.length ? videos[n - 1] : null
        if (word !== 'auto' && word !== 'none' && !chosen) fail(`usage: musicvideo pick <1-${videos.length}|auto|none>`)
        useVizStore.getState().setWrldVideoPick(t.path, word === 'auto' ? null : word === 'none' ? 'none' : chosen!.path)
        ctx.print(`${t.name}: ${word === 'auto' ? 'the best video that lines up' : word === 'none' ? 'the visualizer, no video' : videoLabel(chosen!)} in WRLD`, 'ok')
        return
      }

      const t = await target(tail)
      const choice: MusicVideoChoice = all ? 'all' : useVizStore.getState().wrldVideos === 'all' ? 'all' : 'music'
      const every = videosFor(await loadMusicVideoIndex(), t.name, 'all')
      const serverDefault = (await getMusicVideoDefaults().catch(() => new Map<string, string>())).get(t.path) ?? null
      if (sub === 'resync') for (const v of every) forgetVideoSync(v.path, t.path)
      ctx.print(`Looking for a video of ${t.name}… (the first time takes a few seconds)`, 'dim')
      // What WRLD shows: the song's pick, then the administrators' default, then the best that lines up. resync looks
      // again for the best.
      const match = sub === 'resync'
        ? await findMusicVideo(t, choice, { force: true })
        : (await chooseMusicVideo(t, { choice, pick: useVizStore.getState().wrldVideoPicks[t.path] ?? null })).match
      if (asJson(ctx, json, { song: t, match, videos: every, pick: pickWord(t, every) })) return
      const listing = every.length > 1
        ? ['', `All of its videos (musicvideo pick <N|auto|none>, now ${pickWord(t, every)}):`, table(every.map((v, i) => [String(i + 1), videoLabel(v), v.path, serverDefault === v.path ? 'default for everyone' : '']))]
        : []
      if (!match) {
        ctx.print([every.length
          ? `${t.name}: ${every.length} video${every.length === 1 ? '' : 's'} in Files, but ${choice === 'music' ? 'no music video holds the song (try --all for visualizers and lyric videos)' : 'none of them holds the song'}`
          : `${t.name} has no video in Files`, ...listing].join('\n'), 'dim')
        return
      }
      const off = [
        ...(useVizStore.getState().wrldVideos === 'off' ? ['(WRLD shows none while videos are off: set wrld-videos music)'] : []),
        ...(serverDefault === '' ? ['(an administrator turned the video off for everyone: musicvideo default auto)'] : []),
      ]
      ctx.print([
        `${t.name}: ${match.video.kind} video, ${match.video.path}`,
        `${Math.round(match.sync.covered * 100)}% of the song found in it`,
        table(spanLines(match.sync)),
        ...off,
        ...listing,
      ].join('\n'))
    },
  },
]
