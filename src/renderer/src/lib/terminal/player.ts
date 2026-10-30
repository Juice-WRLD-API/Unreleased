import { getAudioCurrentTime, getAudioDuration, seekAudio } from '../../components/Player'
import { useStore } from '../../store/useStore'
import { fisherYates } from '../../store/queueSlice'
import { EQ_PRESETS, type AudioFx } from '../audioEffects'
import { runHotkeyAction } from '../hotkeys'
import { getSongById, getSongsByIds, loadAllSongs, loadAllSongsWithLyricsAbortable, normalizeSongTitle, resolveTitleToSong, searchSongs, songToTrack, type JWApiSong } from '../juicewrldApi'
import { displaySongName, renamedSongs } from '../songPrefs'
import { parseSearchQuery, matchesFieldFilters, songsById, textMatches } from '../trackerSearch'
import { trackIdToSongId } from '../userApi'
import { loadCatalog, statsSongToTrack } from '../statsCatalog'
import { bestLyricLine, searchLyrics } from '../lyricSearch'
import { pageRows } from './more'
import { clock, fail, parseArgs, parseBool, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

function currentTrack(): NonNullable<ReturnType<typeof st>['currentTrack']> {
  return st().currentTrack ?? fail('nothing is playing')
}

// The last `find` listing, so `play 3` / `queue add 3` can refer to a result by
// number - the same shortcut a shell gives you with a numbered menu.
let lastFind: JWApiSong[] = []

/** Lets another command's numbered listing (onthisday) answer `play N` too. */
export function rememberFind(songs: JWApiSong[]): void {
  lastFind = songs
}

export async function songFromArg(arg: string): Promise<JWApiSong> {
  const n = /^\d+$/.test(arg) ? Number(arg) : 0
  if (n && lastFind.length > 0) return lastFind[n - 1] ?? fail(`pick a number from 1 to ${lastFind.length}`)
  // The API only knows its own names, so a song's rename is checked first.
  const wanted = normalizeSongTitle(arg)
  const renamed = renamedSongs().find(([, name]) => normalizeSongTitle(name) === wanted)
  if (renamed) return getSongById(renamed[0])
  return (await resolveTitleToSong(arg)) ?? fail(`no song found for "${arg}"`)
}

/** Songs whose rename contains `q` - the API's search can't find them by it. */
async function renamedSongsMatching(q: string, exclude: JWApiSong[]): Promise<JWApiSong[]> {
  const have = new Set(exclude.map((s) => s.id))
  const ids = renamedSongs().filter(([id, name]) => !have.has(id) && textMatches(name, q)).map(([id]) => id)
  return ids.length ? getSongsByIds(ids).catch(() => []) : []
}

/** Tab candidates for a song title typed over several words. `before` is the
 *  title's words so far (not the command's other arguments) and `partial` the
 *  word being typed; each candidate is only the rest of the title from that word
 *  on, because the prompt keeps what was already typed. */
export async function completeSongs(before: string[], partial: string): Promise<string[]> {
  const typed = [...before, partial].join(' ').trim().toLowerCase()
  // A bare number is a pick from the last find, not the start of a title.
  if (typed.length < 2 || /^\d+$/.test(typed)) return []
  const skip = before.length > 0 ? before.join(' ').length + 1 : 0
  const results = await searchSongs(typed, 15)
  const names = [...results.map(displaySongName), ...renamedSongs().map(([, name]) => name)]
  return [...new Set(names)].filter((n) => n.toLowerCase().startsWith(typed)).map((n) => n.slice(skip))
}

/** The queue position a `jump` argument means: a number, or a title (exact, then
 *  the start of one, then part of one - the first such in the queue). */
function queueIndexFor(arg: string, titles: string[]): number {
  const typed = arg.trim()
  if (/^#?\d+$/.test(typed)) {
    const n = Number(typed.replace('#', ''))
    return n >= 1 && n <= titles.length ? n - 1 : fail(`jump to which? 1-${titles.length}`)
  }
  if (!typed) fail(`jump to which? 1-${titles.length} or part of a title`)
  const q = typed.toLowerCase()
  const lower = titles.map((t) => t.toLowerCase())
  const at = [lower.findIndex((t) => t === q), lower.findIndex((t) => t.startsWith(q)), lower.findIndex((t) => t.includes(q))].find((i) => i >= 0)
  return at ?? fail(`nothing in the queue matches "${typed}"`)
}

function parseSeek(arg: string, now: number, duration: number): number {
  let target: number
  let m = /^([+-])(\d+(?:\.\d+)?)(s|m)?$/i.exec(arg)
  if (m) target = now + (m[1] === '-' ? -1 : 1) * Number(m[2]) * (m[3]?.toLowerCase() === 'm' ? 60 : 1)
  else if ((m = /^(\d+(?:\.\d+)?)%$/.exec(arg))) {
    if (!duration) fail('the length of this track is unknown, so a percentage has nothing to work with')
    target = (Number(m[1]) / 100) * duration
  } else if ((m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(arg))) target = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
  else if ((m = /^(\d+(?:\.\d+)?)s?$/i.exec(arg))) target = Number(m[1])
  else return fail('usage: seek <+10 | -10 | 1:30 | 90 | 50%>')
  return Math.max(0, duration > 0 ? Math.min(target, duration) : target)
}

export function progressBar(now: number, total: number, width = 24): string {
  const filled = total > 0 ? Math.max(0, Math.min(width, Math.round((now / total) * width))) : 0
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`
}

async function eraNames(): Promise<string[]> {
  const catalog = await loadCatalog()
  return [...new Set([...catalog.values()].map((s) => s.era?.name).filter((n): n is string => !!n))].sort()
}

const trackLine = (t: { title: string; artist?: string }): string => `${t.title}${t.artist ? ` - ${t.artist}` : ''}`

export const PLAYER_COMMANDS: TermCommand[] = [
  {
    name: 'play', group: 'Player', usage: 'play [title | N]',
    description: 'Resume playback, or play a song by title (or by its number from the last find). Tab completes titles',
    complete: completeSongs,
    run: async (args, ctx) => {
      const arg = args.trim()
      if (!arg) { currentTrack(); runHotkeyAction('play'); ctx.print('▶ playing', 'ok'); return }
      const song = await songFromArg(arg)
      st().playTrack(songToTrack(song))
      ctx.print(`▶ ${displaySongName(song)}`, 'ok')
    },
  },
  {
    name: 'pause', group: 'Player', usage: 'pause', description: 'Pause playback',
    run: (_a, ctx) => { currentTrack(); runHotkeyAction('pause'); ctx.print('⏸ paused', 'ok') },
  },
  {
    name: 'toggle', aliases: ['playpause'], group: 'Player', usage: 'toggle', description: 'Play or pause',
    run: (_a, ctx) => { currentTrack(); runHotkeyAction('play-pause'); ctx.print(st().isPlaying ? '▶ playing' : '⏸ paused', 'ok') },
  },
  {
    name: 'next', aliases: ['skip'], group: 'Player', usage: 'next', description: 'Skip to the next track',
    run: (_a, ctx) => {
      currentTrack()
      const before = st().queueIndex
      runHotkeyAction('next')
      const s = st()
      if (!s.radioMode && s.repeat === 'none' && s.queueIndex === before) { ctx.print('nothing left in the queue - queue radio plays random songs', 'dim'); return }
      ctx.print('⏭ next', 'ok')
    },
  },
  {
    name: 'prev', aliases: ['previous', 'back'], group: 'Player', usage: 'prev', description: 'Go to the previous track (or the start of this one)',
    run: (_a, ctx) => { currentTrack(); runHotkeyAction('previous'); ctx.print('⏮ previous', 'ok') },
  },
  {
    name: 'seek', group: 'Player', usage: 'seek <+10 | -10 | 1:30 | 90 | 50%>',
    description: 'Jump within the current track: relative seconds, a clock time, absolute seconds or a percentage',
    run: (args, ctx) => {
      currentTrack()
      const duration = getAudioDuration() || st().currentTrack?.duration || 0
      const target = parseSeek(args.trim(), getAudioCurrentTime(), duration)
      seekAudio(target)
      ctx.print(`⏩ ${clock(target)}${duration ? ` / ${clock(duration)}` : ''}`, 'ok')
    },
  },
  {
    name: 'volume', aliases: ['vol'], group: 'Player', usage: 'volume [0-100 | +N | -N | mute]',
    description: 'Show or set the volume; mute toggles mute',
    complete: (before, partial) => (before.length === 0 ? ['mute'].filter((w) => w.startsWith(partial)) : []),
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase()
      if (!arg) { ctx.print(`volume ${Math.round(st().volume * 100)}%`); return }
      if (arg === 'mute' || arg === 'unmute') { runHotkeyAction('mute'); ctx.print(`volume ${Math.round(st().volume * 100)}%`, 'ok'); return }
      const m = /^([+-])?(\d+)%?$/.exec(arg)
      if (!m) fail('usage: volume [0-100 | +N | -N | mute]')
      const n = Number(m![2])
      const next = m![1] ? Math.round(st().volume * 100) + (m![1] === '-' ? -n : n) : n
      st().setVolume(Math.max(0, Math.min(100, next)) / 100)
      ctx.print(`volume ${Math.round(st().volume * 100)}%`, 'ok')
    },
  },
  {
    name: 'speed', group: 'Player', usage: 'speed [0.5-2 | reset]', description: 'Show or set the playback speed',
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase().replace(/x$/, '')
      if (!arg) { ctx.print(`speed ${st().playbackSpeed}x`); return }
      const v = arg === 'reset' ? 1 : Number(arg)
      if (!Number.isFinite(v)) fail('usage: speed [0.5-2 | reset]')
      st().setPlaybackSpeed(Math.min(2, Math.max(0.5, Math.round(v * 100) / 100)))
      ctx.print(`speed ${st().playbackSpeed}x`, 'ok')
    },
  },
  {
    name: 'shuffle', group: 'Player', usage: 'shuffle [on|off]  ·  shuffle <era> [count]', description: 'Turn shuffle on or off (no argument toggles); or queue a random pick of songs from an era (default 40) and play it',
    complete: async (before, partial) => {
      const full = [...before, partial].join(' ').toLowerCase()
      const modes = before.length === 0 ? ['on', 'off'].filter((w) => w.startsWith(partial)) : []
      const eras = (await eraNames()).filter((n) => n.toLowerCase().startsWith(full)).map((n) => n.split(' ').slice(before.length).join(' '))
      return [...modes, ...eras]
    },
    run: async (args, ctx) => {
      const typed = args.trim()
      const bool = typed ? parseBool(typed) : null
      if (!typed || bool !== null) {
        const want = typed ? bool! : !st().shuffle
        if (want !== st().shuffle) st().toggleShuffle()
        ctx.print(`shuffle ${st().shuffle ? 'on' : 'off'}`, 'ok')
        return
      }
      const countWord = /\s(\d+)$/.exec(typed)
      const count = Math.min(200, Math.max(1, countWord ? Number(countWord[1]) : 40))
      const name = (countWord ? typed.slice(0, countWord.index) : typed).trim()
      const catalog = await loadCatalog()
      const names = await eraNames()
      const era = pickByName(names, (n) => n, name) ?? fail(`no single era matches "${name}" (try: shuffle <tab>)`)
      const pool = [...catalog.values()].filter((s) => s.era?.name === era)
      if (pool.length === 0) fail(`no songs in ${era}`)
      // A random `count` of them, played in that random order - the same
      // shufflePlay every Shuffle button uses.
      const picks = fisherYates(pool).slice(0, count)
      void st().shufflePlay(picks.map(statsSongToTrack))
      ctx.print(`playing ${picks.length} random song${picks.length === 1 ? '' : 's'} from ${era}`, 'ok')
    },
  },
  {
    name: 'repeat', aliases: ['loop'], group: 'Player', usage: 'repeat [none|all|one]', description: 'Set the repeat mode (no argument cycles it)',
    complete: (before, partial) => (before.length === 0 ? ['none', 'all', 'one'].filter((w) => w.startsWith(partial)) : []),
    run: (args, ctx) => {
      const want = args.trim().toLowerCase()
      if (want && !['none', 'all', 'one'].includes(want)) fail('usage: repeat [none|all|one]')
      for (let i = 0; i < 3 && (want ? st().repeat !== want : i === 0); i++) st().toggleRepeat()
      ctx.print(`repeat ${st().repeat}`, 'ok')
    },
  },
  {
    name: 'like', group: 'Player', usage: 'like', description: 'Like or unlike the current song',
    run: (_a, ctx) => {
      const track = currentTrack()
      st().toggleLike(track.id)
      ctx.print(st().likedTrackIds.includes(track.id) ? `♥ liked ${track.title}` : `♡ unliked ${track.title}`, 'ok')
    },
  },
  {
    name: 'unlike', group: 'Player', usage: 'unlike [title | N]', description: 'Take a song out of your liked songs (no argument: the one playing). like toggles; this only removes',
    complete: completeSongs,
    run: async (args, ctx) => {
      const arg = args.trim()
      const song = arg ? await songFromArg(arg) : null
      const id = song ? `jw-${song.id}` : currentTrack().id
      const title = song?.name ?? currentTrack().title
      if (!st().likedTrackIds.includes(id)) { ctx.print(`${title} isn’t in your liked songs`, 'dim'); return }
      st().toggleLike(id)
      ctx.print(`♡ removed ${title} from your liked songs`, 'ok')
    },
  },
  {
    name: 'stop', group: 'Player', usage: 'stop', description: 'Stop playback and empty the queue (pause only pauses)',
    run: (_a, ctx) => {
      const s = st()
      if (!s.currentTrack && s.queue.length === 0) fail('nothing is playing')
      runHotkeyAction('pause')
      useStore.setState({
        isPlaying: false, currentTrack: null, currentTrackFull: null, queue: [], queueIndex: -1, progress: 0, currentTime: 0,
        queueOriginal: null, queueFilter: null, queueSource: null, queueSongPool: null, radioMode: false, radioNext: null, radioFilter: null, _radioWaiting: false,
      })
      ctx.print('⏹ stopped', 'ok')
    },
  },
  {
    name: 'status', aliases: ['now'], group: 'Player', usage: 'status [-1]', description: 'What is playing, plus volume, speed, shuffle, repeat and the queue. Live (q leaves); -1 prints it once',
    run: (args, ctx) => {
      // It follows along on the watch screen (every second); in a script, inside
      // watch or with -1 it prints once.
      if (!ctx.scripted && args.trim() !== '-1') { ctx.screen({ kind: 'watch', command: 'status -1', seconds: 1 }); return }
      const s = st()
      const t = s.currentTrack
      const dur = getAudioDuration() || t?.duration || 0
      const lines = [
        t ? `${s.isPlaying ? '▶' : '⏸'} ${trackLine(t)}` : 'nothing playing',
        ...(t ? [`  ${progressBar(getAudioCurrentTime(), dur)} ${clock(getAudioCurrentTime())}${dur ? ` / ${clock(dur)}` : ''}${s.likedTrackIds.includes(t.id) ? '  ♥' : ''}`] : []),
        `volume ${Math.round(s.volume * 100)}%  speed ${s.playbackSpeed}x  shuffle ${s.shuffle ? 'on' : 'off'}  repeat ${s.repeat}`,
        `queue ${s.queue.length} track${s.queue.length === 1 ? '' : 's'}${s.queueIndex >= 0 ? ` (at ${s.queueIndex + 1})` : ''}`,
        ...(s.sleepTimerEnd ? [`sleep timer: ${clock(Math.max(0, (s.sleepTimerEnd - Date.now()) / 1000))} left`] : []),
      ]
      ctx.print(lines.join('\n'))
    },
  },
  {
    name: 'find', aliases: ['f'], group: 'Player', usage: 'find <title>', description: 'Search the song library and number the results (then play N / queue add N)',
    complete: completeSongs,
    run: async (args, ctx) => {
      const q = args.trim()
      if (!q) fail('usage: find <title>')
      const found = await searchSongs(q, 15)
      const results = [...await renamedSongsMatching(q, found), ...found]
      lastFind = results
      if (results.length === 0) { ctx.print(`no songs found for "${q}"`, 'dim'); return }
      ctx.print(`${results.map((r, i) => `${String(i + 1).padStart(3)}  ${displaySongName(r)}  (${r.era?.name ?? r.category})`).join('\n')}\nplay N · queue add N · queue next N`, 'plain')
    },
  },
  {
    name: 'lyricfind', aliases: ['lf'], group: 'Player', usage: 'lyricfind [--exact] <words from the lyrics>',
    description: 'Search every song’s lyrics, forgiving of punctuation, typos and word order (--exact for a plain phrase match), and number the songs (then play N / queue add N)',
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const q = rest.join(' ').trim()
      if (!q) fail('usage: lyricfind [--exact] <words from the lyrics>')
      const fuzzy = !bool.has('exact')
      const hits = searchLyrics(await loadAllSongsWithLyricsAbortable(ctx.signal), q, fuzzy)
      if (hits.length === 0) { ctx.print(`no lyrics match "${q}"${fuzzy ? ' (even loosely)' : ' - drop --exact to loosen it'}`, 'dim'); return }
      lastFind = hits
      const line = (s: JWApiSong): string => { const l = bestLyricLine(s.lyrics, q, fuzzy); return l ? `\n       “${l.length > 100 ? `${l.slice(0, 100)}…` : l}”` : '' }
      ctx.print(`${pageRows(hits.length, (i) => `${String(i + 1).padStart(3)}  ${displaySongName(hits[i])}  (${hits[i].era?.name ?? hits[i].category})${line(hits[i])}`, 15)}\nplay N · queue add N · queue next N`, 'plain')
    },
  },
  {
    name: 'queue', aliases: ['q'], group: 'Player', usage: 'queue [list [filter] | clear | add <song> | next <song> | remove N | jump N|title | history [N|title] | radio]',
    description: 'Show or change the play queue. <song> is a title or a number from find. list <filter> takes the Tracker search syntax (plain words, field:"value"). history lists what was played before this song (newest first); history N|title replays one; radio switches to random tracker songs',
    complete: (before, partial) => {
      if (before.length === 0) return ['list', 'clear', 'add', 'next', 'remove', 'jump', 'history', 'radio'].filter((w) => w.startsWith(partial))
      return ['add', 'next'].includes(before[0].toLowerCase()) ? completeSongs(before.slice(1), partial) : []
    },
    run: async (args, ctx) => {
      const [sub = 'list', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      const s = st()
      switch (sub.toLowerCase() || 'list') {
        case 'list': case 'ls': {
          if (s.queue.length === 0) { ctx.print('queue is empty', 'dim'); return }
          if (rest) {
            // Same syntax as the queue panel's search: plain words match
            // title/artist, field:"value" tokens are checked by song id
            // against the catalogue.
            const { freeText, filters } = parseSearchQuery(rest)
            const q = freeText.toLowerCase()
            const byId = filters.length ? songsById(await loadAllSongs()) : null
            const hits = s.queue
              .map((t, i) => ({ t, i }))
              .filter(({ t }) => {
                if (q && !t.title.toLowerCase().includes(q) && !t.artist.toLowerCase().includes(q)) return false
                if (!byId) return true
                const id = trackIdToSongId(t.id)
                const song = id != null ? byId.get(id) : undefined
                return !!song && matchesFieldFilters(song, filters)
              })
            if (hits.length === 0) { ctx.print(`nothing in the queue matches "${rest}"`, 'dim'); return }
            ctx.print(pageRows(hits.length, (k) => `${hits[k].i === s.queueIndex ? '▶' : ' '} ${String(hits[k].i + 1).padStart(3)}  ${trackLine(hits[k].t)}`, 40))
            return
          }
          const from = Math.max(0, s.queueIndex - 5)
          const rows = pageRows(s.queue.length - from, (i) => `${from + i === s.queueIndex ? '▶' : ' '} ${String(from + i + 1).padStart(3)}  ${trackLine(s.queue[from + i])}`, 40)
          ctx.print(`${from > 0 ? `  … ${from} earlier\n` : ''}${rows}`)
          return
        }
        case 'clear': s.clearQueue(); ctx.print('queue cleared', 'ok'); return
        case 'add': { if (!rest) fail('usage: queue add <title | N>'); const song = await songFromArg(rest); st().addToQueue(songToTrack(song)); ctx.print(`queued ${displaySongName(song)}`, 'ok'); return }
        case 'next': { if (!rest) fail('usage: queue next <title | N>'); const song = await songFromArg(rest); st().playNext(songToTrack(song)); ctx.print(`playing ${displaySongName(song)} next`, 'ok'); return }
        case 'remove': case 'rm': {
          const n = Number(rest)
          if (!Number.isInteger(n) || n < 1 || n > s.queue.length) fail(`remove which? 1-${s.queue.length}`)
          // The store leaves the playing row alone, so say so instead of "removed".
          if (n - 1 === s.queueIndex) fail(`${n} is playing now; use next to skip it`)
          const gone = s.queue[n - 1]
          s.removeFromQueue(n - 1)
          ctx.print(`removed ${gone.title}`, 'ok')
          return
        }
        case 'jump': {
          const n = queueIndexFor(rest, s.queue.map((t) => t.title))
          s.jumpToTrack(s.queue[n], n)
          ctx.print(`▶ ${s.queue[n].title}`, 'ok')
          return
        }
        case 'history': case 'hist': {
          const h = s.playHistory
          if (!rest) {
            if (h.length === 0) { ctx.print('nothing played yet', 'dim'); return }
            ctx.print(pageRows(h.length, (i) => `  ${String(i + 1).padStart(3)}  ${trackLine(h[i])}`, 40))
            return
          }
          if (h.length === 0) fail('nothing played yet')
          const n = queueIndexFor(rest, h.map((t) => t.title))
          s.playFromHistory(h[n])
          ctx.print(`▶ ${h[n].title}`, 'ok')
          return
        }
        case 'radio': {
          currentTrack()
          s.startRandomRadio()
          ctx.print('📻 radio on - playing random songs', 'ok')
          return
        }
        default: fail('usage: queue [list | clear | add <song> | next <song> | remove N | jump N|title | history [N|title] | radio]')
      }
    },
  },
  {
    name: 'eq', group: 'Player', usage: 'eq [on | off | list | reset [all] | <preset> | save <name> | delete <name> | preamp <-12..12> | reverb [on|off|<0-100>] [decay 1-8] | echo [on|off|<0-100>] | 8d [on|off|<seconds 1-20>] | comp [on|off|<threshold -60..0>] | filter [on|off] | width <0-200> | saturation <0-100> | boost <100-200> | balance <-100..100> | speed <0.5-2> | mono [on|off] | pitch [on|off]]', description: 'Show or change the equalizer, reverb and sound effects; a preset name turns it on with that preset (fine-tune effects with: set echo-time, set comp-ratio, set low-cut, …)',
    complete: (before, partial) => {
      const presets = (): string[] => [...EQ_PRESETS.map((p) => p.id), ...st().eqUserPresets.map((p) => p.name)]
      const words = before.length === 0
        ? ['on', 'off', 'list', 'reset', 'save', 'delete', 'preamp', 'reverb', 'echo', '8d', 'comp', 'filter', 'width', 'saturation', 'boost', 'balance', 'speed', 'mono', 'pitch', ...presets()]
        : before.length === 1 && before[0].toLowerCase() === 'delete' ? st().eqUserPresets.map((p) => p.name)
        : before.length === 1 && before[0].toLowerCase() === 'reset' ? ['all']
        : []
      return words.filter((w) => w.toLowerCase().startsWith(partial.toLowerCase()))
    },
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const s = st()
      const describe = (): string => `equalizer ${st().eqEnabled ? 'on' : 'off'} · preset ${presetLabel()} · preamp ${st().audioFx.preamp} dB · boost ${Math.round(st().eqBoost * 100)}% · balance ${Math.round(st().eqBalance * 100)}`
      const presetLabel = (): string => st().eqUserPresets.find((p) => p.id === st().eqPreset)?.name ?? st().eqPreset
      const describeFx = (): string => {
        const f = st().audioFx
        return `echo ${f.echo ? `on (${Math.round(f.echoTime * 1000)} ms, ${Math.round(f.echoMix * 100)}%)` : 'off'} · 8d ${f.autoPan ? `on (${f.autoPanPeriod}s sweep)` : 'off'} · compressor ${f.compressor ? `on (${f.compThreshold} dB, ${f.compRatio}:1)` : 'off'} · filter ${f.filter ? `on (${f.lowCut}-${f.highCut} Hz)` : 'off'}
width ${Math.round(f.width * 100)}% · saturation ${Math.round(f.drive * 100)}%`
      }
      if (!arg) { ctx.print(`${describe()}
reverb ${st().reverbEnabled ? 'on' : 'off'} · mix ${Math.round(st().reverbMix * 100)}% · decay ${st().reverbDecay}s · speed ${st().playbackSpeed}x · mono ${st().eqMono ? 'on' : 'off'} · pitch follows speed ${st().pitchShift ? 'on' : 'off'}
${describeFx()}`); return }
      const [sub, ...rest] = arg.split(/\s+/)
      // Preset names keep the case they were typed in.
      const rawName = args.trim().split(/\s+/).slice(1).join(' ')
      const onOff = (v: string | undefined, cur: boolean): boolean => (v === 'on' ? true : v === 'off' ? false : v === undefined ? !cur : fail('expected on or off'))
      const numIn = (v: string | undefined, lo: number, hi: number, what: string): number => {
        const n = Number(v)
        if (v === undefined || !Number.isFinite(n) || n < lo || n > hi) fail(`${what} must be ${lo} to ${hi}`)
        return n
      }
      if (sub === 'reverb') {
        const [a, b] = rest
        if (a === undefined) s.setReverbEnabled(!s.reverbEnabled)
        else if (a === 'on' || a === 'off') s.setReverbEnabled(a === 'on')
        else { s.setReverbMix(numIn(a, 0, 100, 'reverb amount') / 100); s.setReverbEnabled(true) }
        if (b !== undefined) s.setReverbDecay(numIn(b, 1, 8, 'reverb decay'))
        const r = st()
        ctx.print(`reverb ${r.reverbEnabled ? 'on' : 'off'} · mix ${Math.round(r.reverbMix * 100)}% · decay ${r.reverbDecay}s`, 'ok'); return
      }
      // Shared shape for the switchable effects: bare toggles, on/off sets,
      // a number sets that effect's main knob and switches it on.
      const fxToggle = (key: 'echo' | 'autoPan' | 'compressor' | 'filter', v: string | undefined, knob?: (n: string) => Partial<AudioFx>): void => {
        if (v === undefined || v === 'on' || v === 'off') s.setAudioFx({ [key]: onOff(v, s.audioFx[key]) })
        else if (knob) s.setAudioFx({ ...knob(v), [key]: true })
        else fail('expected on or off')
        ctx.print(describeFx(), 'ok')
      }
      if (sub === 'echo') { fxToggle('echo', rest[0], (v) => ({ echoMix: numIn(v, 0, 100, 'echo level') / 100 })); return }
      if (sub === '8d') { fxToggle('autoPan', rest[0], (v) => ({ autoPanPeriod: numIn(v, 1, 20, '8d sweep seconds') })); return }
      if (sub === 'comp' || sub === 'compressor') { fxToggle('compressor', rest[0], (v) => ({ compThreshold: numIn(v, -60, 0, 'compressor threshold') })); return }
      if (sub === 'filter') { fxToggle('filter', rest[0]); return }
      if (sub === 'width') { s.setAudioFx({ width: numIn(rest[0], 0, 200, 'width') / 100 }); ctx.print(describeFx(), 'ok'); return }
      if (sub === 'saturation' || sub === 'drive') { s.setAudioFx({ drive: numIn(rest[0], 0, 100, 'saturation') / 100 }); ctx.print(describeFx(), 'ok'); return }
      if (sub === 'preamp') { s.setAudioFx({ preamp: numIn(rest[0], -12, 12, 'preamp') }); ctx.print(describe(), 'ok'); return }
      if (sub === 'save') {
        if (!rawName) fail('usage: eq save <name>')
        s.saveEqUserPreset(rawName)
        s.setEqEnabled(true)
        ctx.print(`saved preset "${presetLabel()}"`, 'ok'); return
      }
      if (sub === 'delete') {
        if (!rawName) fail('usage: eq delete <name>')
        const preset = pickByName(s.eqUserPresets, (p) => p.name, rawName) ?? fail(`no saved preset "${rawName}" (try: eq list)`)
        s.deleteEqUserPreset(preset.id)
        ctx.print(`deleted preset "${preset.name}"`, 'ok'); return
      }
      if (arg === 'reset all') { s.resetSoundEffects(); ctx.print(`${describe()}\n${describeFx()}`, 'ok'); return }
      if (sub === 'boost') { s.setEqBoost(numIn(rest[0], 100, 200, 'boost') / 100); ctx.print(describe(), 'ok'); return }
      if (sub === 'balance') { s.setEqBalance(numIn(rest[0], -100, 100, 'balance') / 100); ctx.print(describe(), 'ok'); return }
      if (sub === 'speed') { s.setPlaybackSpeed(numIn(rest[0], 0.5, 2, 'speed')); ctx.print(`speed ${st().playbackSpeed}x`, 'ok'); return }
      if (sub === 'mono') { s.setEqMono(onOff(rest[0], s.eqMono)); ctx.print(`mono ${st().eqMono ? 'on' : 'off'}`, 'ok'); return }
      if (sub === 'pitch') { s.setPitchShift(onOff(rest[0], s.pitchShift)); ctx.print(`pitch follows speed: ${st().pitchShift ? 'on' : 'off'}`, 'ok'); return }
      if (arg === 'list') {
        const mine = s.eqUserPresets.length ? `\n\nyour presets:\n${s.eqUserPresets.map((p) => p.name).join('\n')}` : ''
        ctx.print(EQ_PRESETS.map((p) => `${p.id.padEnd(16)}${p.name}`).join('\n') + mine); return
      }
      if (arg === 'on' || arg === 'off') { s.setEqEnabled(arg === 'on'); ctx.print(describe(), 'ok'); return }
      const preset = arg === 'reset' ? EQ_PRESETS.find((p) => p.id === 'flat')
        : pickByName(EQ_PRESETS, (p) => p.id, arg) ?? pickByName(EQ_PRESETS, (p) => p.name, arg) ?? pickByName(s.eqUserPresets, (p) => p.name, arg)
      if (!preset) fail(`no preset "${args.trim()}" (try: eq list)`)
      s.setEqPreset(preset!.id)
      s.setEqEnabled(true)
      ctx.print(describe(), 'ok')
    },
  },
  {
    name: 'sleep', group: 'Player', usage: 'sleep [minutes | off]', description: 'Stop playback after a delay',
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const s = st()
      if (!arg) { ctx.print(s.sleepTimerEnd ? `sleep timer: ${clock(Math.max(0, (s.sleepTimerEnd - Date.now()) / 1000))} left` : 'no sleep timer', 'plain'); return }
      if (arg === 'off' || arg === 'cancel') { s.setSleepTimer(null); ctx.print('sleep timer off', 'ok'); return }
      const minutes = Number(arg)
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) fail('usage: sleep <minutes 1-1440 | off>')
      s.setSleepTimer(Date.now() + minutes * 60_000)
      ctx.print(`sleep timer: ${minutes} minute${minutes === 1 ? '' : 's'}`, 'ok')
    },
  },
]
