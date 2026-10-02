import { getAudioCurrentTime, getAudioDuration, seekAudio } from '../../components/Player'
import { useStore } from '../../store/useStore'
import { EQ_PRESETS } from '../audioEffects'
import { runHotkeyAction } from '../hotkeys'
import { resolveTitleToSong, searchSongs, songToTrack, type JWApiSong } from '../juicewrldApi'
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

const trackLine = (t: { title: string; artist?: string }): string => `${t.title}${t.artist ? ` - ${t.artist}` : ''}`

export const PLAYER_COMMANDS: TermCommand[] = [
  {
    name: 'play', group: 'Player', usage: 'play [title | N]',
    description: 'Resume playback, or play a song by title (or by its number from the last find)',
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
    name: 'shuffle', group: 'Player', usage: 'shuffle [on|off]', description: 'Turn shuffle on or off (no argument toggles)',
    complete: (before, partial) => (before.length === 0 ? ['on', 'off'].filter((w) => w.startsWith(partial)) : []),
    run: (args, ctx) => {
      const want = args.trim() ? parseBool(args) ?? fail('usage: shuffle [on|off]') : !st().shuffle
      if (want !== st().shuffle) st().toggleShuffle()
      ctx.print(`shuffle ${st().shuffle ? 'on' : 'off'}`, 'ok')
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
    name: 'status', aliases: ['now'], group: 'Player', usage: 'status', description: 'What is playing, plus volume, speed, shuffle, repeat and the queue',
    run: (_a, ctx) => {
      const s = st()
      const t = s.currentTrack
      const dur = getAudioDuration() || t?.duration || 0
      const lines = [
        t ? `${s.isPlaying ? '▶' : '⏸'} ${trackLine(t)}` : 'nothing playing',
        ...(t ? [`  ${clock(getAudioCurrentTime())}${dur ? ` / ${clock(dur)}` : ''}${s.likedTrackIds.includes(t.id) ? '  ♥' : ''}`] : []),
        `volume ${Math.round(s.volume * 100)}%  speed ${s.playbackSpeed}x  shuffle ${s.shuffle ? 'on' : 'off'}  repeat ${s.repeat}`,
        `queue ${s.queue.length} track${s.queue.length === 1 ? '' : 's'}${s.queueIndex >= 0 ? ` (at ${s.queueIndex + 1})` : ''}`,
        ...(s.sleepTimerEnd ? [`sleep timer: ${clock(Math.max(0, (s.sleepTimerEnd - Date.now()) / 1000))} left`] : []),
      ]
      ctx.print(lines.join('\n'))
    },
  },
  {
    name: 'find', aliases: ['f'], group: 'Player', usage: 'find <title>', description: 'Search the song library and number the results (then play N / queue add N)',
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
    complete: (before, partial) => (before.length === 0 ? ['list', 'clear', 'add', 'next', 'remove', 'jump'].filter((w) => w.startsWith(partial)) : []),
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
    name: 'lyrics', group: 'Player', usage: 'lyrics', description: 'Show or hide the lyrics panel',
    run: (_a, ctx) => { runHotkeyAction('toggle-lyrics'); ctx.print('lyrics toggled', 'ok') },
  },
  {
    name: 'eq', group: 'Player', usage: 'eq [on | off | list | reset | <preset>]', description: 'Show or change the equalizer; a preset name turns it on with that preset',
    complete: (before, partial) => (before.length === 0 ? ['on', 'off', 'list', 'reset', ...EQ_PRESETS.map((p) => p.id)].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const s = st()
      const describe = (): string => `equalizer ${st().eqEnabled ? 'on' : 'off'} · preset ${st().eqPreset} · boost ${Math.round(st().eqBoost * 100)}% · balance ${Math.round(st().eqBalance * 100)}`
      if (!arg) { ctx.print(describe()); return }
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
