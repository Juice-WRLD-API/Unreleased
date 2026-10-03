import { getAudioCurrentTime, getAudioDuration, seekAudio } from '../../components/Player'
import { useStore } from '../../store/useStore'
import { EQ_PRESETS } from '../audioEffects'
import { runHotkeyAction } from '../hotkeys'
import { resolveTitleToSong, searchSongs, songToTrack, type JWApiSong } from '../juicewrldApi'
import { loadCatalog, statsSongToTrack } from '../statsCatalog'
import { clock, fail, parseBool, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

function currentTrack(): NonNullable<ReturnType<typeof st>['currentTrack']> {
  return st().currentTrack ?? fail('nothing is playing')
}

// The last `find` listing, so `play 3` / `queue add 3` can refer to a result by
// number - the same shortcut a shell gives you with a numbered menu.
let lastFind: JWApiSong[] = []

export async function songFromArg(arg: string): Promise<JWApiSong> {
  const n = /^\d+$/.test(arg) ? Number(arg) : 0
  if (n && lastFind.length > 0) return lastFind[n - 1] ?? fail(`pick a number from 1 to ${lastFind.length}`)
  return (await resolveTitleToSong(arg)) ?? fail(`no song found for "${arg}"`)
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
  return results.map((s) => s.name).filter((n) => n.toLowerCase().startsWith(typed)).map((n) => n.slice(skip))
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
      ctx.print(`▶ ${song.name}`, 'ok')
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
    run: (_a, ctx) => { currentTrack(); runHotkeyAction('next'); ctx.print('⏭ next', 'ok') },
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
      // Fisher-Yates, then the first `count`.
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]]
      }
      const picks = pool.slice(0, count)
      st().playCollection(picks.map(statsSongToTrack), null, null)
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
        queueFilter: null, queueSource: null, radioMode: false, radioNext: null, _radioWaiting: false,
      })
      ctx.print('⏹ stopped', 'ok')
    },
  },
  {
    name: 'status', aliases: ['now'], group: 'Player', usage: 'status', description: 'What is playing, plus volume, speed, shuffle, repeat and the queue',
    run: (_a, ctx) => {
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
      const results = await searchSongs(q, 15)
      lastFind = results
      if (results.length === 0) { ctx.print(`no songs found for "${q}"`, 'dim'); return }
      ctx.print(`${results.map((r, i) => `${String(i + 1).padStart(3)}  ${r.name}  (${r.era?.name ?? r.category})`).join('\n')}\nplay N · queue add N · queue next N`, 'plain')
    },
  },
  {
    name: 'queue', aliases: ['q'], group: 'Player', usage: 'queue [list | clear | add <song> | next <song> | remove N | jump N]',
    description: 'Show or change the play queue. <song> is a title or a number from find',
    complete: (before, partial) => {
      if (before.length === 0) return ['list', 'clear', 'add', 'next', 'remove', 'jump'].filter((w) => w.startsWith(partial))
      return ['add', 'next'].includes(before[0].toLowerCase()) ? completeSongs(before.slice(1), partial) : []
    },
    run: async (args, ctx) => {
      const [sub = 'list', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      const s = st()
      switch (sub.toLowerCase() || 'list') {
        case 'list': case 'ls': {
          if (s.queue.length === 0) { ctx.print('queue is empty', 'dim'); return }
          const from = Math.max(0, s.queueIndex - 5)
          const rows = s.queue.slice(from, from + 40).map((t, i) => `${from + i === s.queueIndex ? '▶' : ' '} ${String(from + i + 1).padStart(3)}  ${trackLine(t)}`)
          ctx.print(`${from > 0 ? `  … ${from} earlier\n` : ''}${rows.join('\n')}${from + 40 < s.queue.length ? `\n  … ${s.queue.length - from - 40} more` : ''}`)
          return
        }
        case 'clear': s.clearQueue(); ctx.print('queue cleared', 'ok'); return
        case 'add': { const song = await songFromArg(rest); st().addToQueue(songToTrack(song)); ctx.print(`queued ${song.name}`, 'ok'); return }
        case 'next': { const song = await songFromArg(rest); st().playNext(songToTrack(song)); ctx.print(`playing ${song.name} next`, 'ok'); return }
        case 'remove': case 'rm': {
          const n = Number(rest)
          if (!Number.isInteger(n) || n < 1 || n > s.queue.length) fail(`remove which? 1-${s.queue.length}`)
          const gone = s.queue[n - 1]
          s.removeFromQueue(n - 1)
          ctx.print(`removed ${gone.title}`, 'ok')
          return
        }
        case 'jump': {
          const n = Number(rest)
          if (!Number.isInteger(n) || n < 1 || n > s.queue.length) fail(`jump to which? 1-${s.queue.length}`)
          s.jumpToTrack(s.queue[n - 1], n - 1)
          ctx.print(`▶ ${s.queue[n - 1].title}`, 'ok')
          return
        }
        default: fail('usage: queue [list | clear | add <song> | next <song> | remove N | jump N]')
      }
    },
  },
  {
    name: 'eq', group: 'Player', usage: 'eq [on | off | list | reset | <preset> | reverb [on|off|<0-100>] [decay 1-8] | boost <100-200> | balance <-100..100> | speed <0.5-2> | mono [on|off] | pitch [on|off]]', description: 'Show or change the equalizer, reverb and sound effects; a preset name turns it on with that preset',
    complete: (before, partial) => (before.length === 0 ? ['on', 'off', 'list', 'reset', 'reverb', 'boost', 'balance', 'speed', 'mono', 'pitch', ...EQ_PRESETS.map((p) => p.id)].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const s = st()
      const describe = (): string => `equalizer ${st().eqEnabled ? 'on' : 'off'} · preset ${st().eqPreset} · boost ${Math.round(st().eqBoost * 100)}% · balance ${Math.round(st().eqBalance * 100)}`
      if (!arg) { ctx.print(`${describe()}
reverb ${st().reverbEnabled ? 'on' : 'off'} · mix ${Math.round(st().reverbMix * 100)}% · decay ${st().reverbDecay}s · speed ${st().playbackSpeed}x · mono ${st().eqMono ? 'on' : 'off'} · pitch follows speed ${st().pitchShift ? 'on' : 'off'}`); return }
      const [sub, ...rest] = arg.split(/\s+/)
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
      if (sub === 'boost') { s.setEqBoost(numIn(rest[0], 100, 200, 'boost') / 100); ctx.print(describe(), 'ok'); return }
      if (sub === 'balance') { s.setEqBalance(numIn(rest[0], -100, 100, 'balance') / 100); ctx.print(describe(), 'ok'); return }
      if (sub === 'speed') { s.setPlaybackSpeed(numIn(rest[0], 0.5, 2, 'speed')); ctx.print(`speed ${st().playbackSpeed}x`, 'ok'); return }
      if (sub === 'mono') { s.setEqMono(onOff(rest[0], s.eqMono)); ctx.print(`mono ${st().eqMono ? 'on' : 'off'}`, 'ok'); return }
      if (sub === 'pitch') { s.setPitchShift(onOff(rest[0], s.pitchShift)); ctx.print(`pitch follows speed: ${st().pitchShift ? 'on' : 'off'}`, 'ok'); return }
      if (arg === 'list') { ctx.print(EQ_PRESETS.map((p) => `${p.id.padEnd(16)}${p.name}`).join('\n')); return }
      if (arg === 'on' || arg === 'off') { s.setEqEnabled(arg === 'on'); ctx.print(describe(), 'ok'); return }
      const preset = arg === 'reset' ? EQ_PRESETS.find((p) => p.id === 'flat') : pickByName(EQ_PRESETS, (p) => p.id, arg) ?? pickByName(EQ_PRESETS, (p) => p.name, arg)
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
