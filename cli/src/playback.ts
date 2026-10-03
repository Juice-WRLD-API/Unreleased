import { AUDIO_EXTS, getFileExt } from 'site:fileTypes'
import { clock, parseBool, pickByName } from 'site:termTypes'
import { fail, plural, type Command } from './command'
import { listDir, lookupEntry, unquote } from './files'
import { trackFromFile, trackFromSong, type Player, type Repeat, type Track } from './player'
import type { Shell } from './shell'
import { completeTitles, getSong, hasList, loadCatalog, songFromArg } from './songs'

// The site terminal's Player commands (lib/terminal/player.ts) on top of mpv.
// Playback lives in the interactive shell and stops with it, so a one-shot
// `unreleased play …` says so instead of starting music that dies at once.

export function playerOf(sh: Shell): Player {
  return sh.player ?? fail('playback runs inside the shell - start it with: unreleased')
}

/** What `play` / `queue add` were given: a number from the last list, a file
 *  or folder in the tree, or a song title. */
export async function tracksFromArg(arg: string, sh: Shell): Promise<{ tracks: Track[]; label: string }> {
  const typed = unquote(arg)
  if (!typed) fail('name a song (a title, a number from the last list, or a file or folder here)')
  if (!(/^#?\d+$/.test(typed) && hasList())) {
    // `.` is the folder you're in (`play .` plays what `ls` shows).
    const here = sh.cwd.channel && sh.cwd.dir.length > 0 && (typed === '.' || typed === './')
    const found = here
      ? { parent: { channel: sh.cwd.channel, dir: sh.cwd.dir.slice(0, -1) }, entry: { name: sh.cwd.dir[sh.cwd.dir.length - 1], type: 'directory' as const } }
      : await lookupEntry(sh.cwd, typed, 'play').catch(() => null)
    const channel = found?.parent.channel
    if (found?.entry && channel) {
      const { entry } = found
      if (entry.type === 'file') {
        if (!AUDIO_EXTS.has(getFileExt(entry.name))) fail(`${entry.name}: not an audio file`)
        return { tracks: [trackFromFile(entry.name, entry.entry!.path, channel)], label: entry.name }
      }
      const folder = { channel, dir: [...found.parent.dir, entry.name] }
      const files = (await listDir(folder)).filter((e) => e.type === 'file' && e.entry && AUDIO_EXTS.has(getFileExt(e.name)))
      if (files.length === 0) fail(`${entry.name}/: no audio files directly in this folder`)
      return { tracks: files.map((f) => trackFromFile(f.name, f.entry!.path, channel)), label: `${entry.name}/ (${plural(files.length, 'track')})` }
    }
  }
  const ref = await songFromArg(typed)
  const song = await getSong(ref.id)
  return { tracks: [trackFromSong(song)], label: song.name }
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

function progressBar(now: number, total: number, width = 24): string {
  const filled = total > 0 ? Math.max(0, Math.min(width, Math.round((now / total) * width))) : 0
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`
}

const trackLine = (t: Track): string => `${t.title}${t.era ? `  (${t.era})` : ''}`

function current(p: Player): Track {
  return p.current ?? fail('nothing is playing')
}

async function eraNames(): Promise<string[]> {
  const catalog = await loadCatalog(false, () => undefined)
  return [...new Set([...catalog.values()].map((s) => s.era?.name).filter((n): n is string => !!n))].sort()
}

const QUEUE_SUBS = ['list', 'clear', 'add', 'next', 'remove', 'jump']

export const PLAYER_COMMANDS: Command[] = [
  {
    name: 'play', group: 'Player', usage: 'play [title | N | file | folder]',
    description: 'Resume, or play a song by title or by its number from the last list. A file or folder in the tree plays that (a folder queues its audio files)',
    complete: (arg) => completeTitles(arg),
    run: async (args, sh) => {
      const p = playerOf(sh)
      if (!args.trim()) { current(p); await p.setPaused(false); sh.print('▶ playing', 'ok'); return }
      const { tracks, label } = await tracksFromArg(args, sh)
      await p.playCollection(tracks)
      sh.print(`▶ ${label}`, 'ok')
    },
  },
  {
    name: 'pause', group: 'Player', usage: 'pause', description: 'Pause playback',
    run: async (_a, sh) => { const p = playerOf(sh); current(p); await p.setPaused(true); sh.print('⏸ paused', 'ok') },
  },
  {
    name: 'toggle', aliases: ['playpause'], group: 'Player', usage: 'toggle', description: 'Play or pause',
    run: async (_a, sh) => {
      const p = playerOf(sh)
      current(p)
      const wasPaused = await p.paused()
      await p.setPaused(!wasPaused)
      sh.print(wasPaused ? '▶ playing' : '⏸ paused', 'ok')
    },
  },
  {
    name: 'next', aliases: ['skip'], group: 'Player', usage: 'next', description: 'Skip to the next track',
    run: async (_a, sh) => {
      const p = playerOf(sh)
      current(p)
      const t = await p.advance(false)
      sh.print(t ? `⏭ ${t.title}` : 'end of the queue', t ? 'ok' : 'dim')
    },
  },
  {
    name: 'prev', aliases: ['previous', 'back'], group: 'Player', usage: 'prev', description: 'Go to the previous track (or the start of this one)',
    run: async (_a, sh) => {
      const p = playerOf(sh)
      current(p)
      const t = await p.previous()
      sh.print(`⏮ ${t?.title ?? ''}`, 'ok')
    },
  },
  {
    name: 'seek', group: 'Player', usage: 'seek <+10 | -10 | 1:30 | 90 | 50%>',
    description: 'Jump within the current track: relative seconds, a clock time, absolute seconds or a percentage',
    run: async (args, sh) => {
      const p = playerOf(sh)
      current(p)
      const duration = await p.duration()
      const target = parseSeek(args.trim(), await p.position(), duration)
      await p.seek(target)
      sh.print(`⏩ ${clock(target)}${duration ? ` / ${clock(duration)}` : ''}`, 'ok')
    },
  },
  {
    name: 'volume', aliases: ['vol'], group: 'Player', usage: 'volume [0-100 | +N | -N | mute]',
    description: 'Show or set the volume; mute toggles mute',
    complete: async (arg) => ['mute'].filter((w) => w.startsWith(arg.trim())),
    run: async (args, sh) => {
      const p = playerOf(sh)
      const arg = args.trim().toLowerCase()
      const show = (): string => `volume ${p.volume}%${p.muted ? ' (muted)' : ''}`
      if (!arg) { sh.print(show()); return }
      if (arg === 'mute' || arg === 'unmute') { await p.setMuted(arg === 'mute' ? !p.muted : false); sh.print(show(), 'ok'); return }
      const m = /^([+-])?(\d+)%?$/.exec(arg) ?? fail('usage: volume [0-100 | +N | -N | mute]')
      const n = Number(m[2])
      await p.setVolume(m[1] ? p.volume + (m[1] === '-' ? -n : n) : n)
      sh.print(show(), 'ok')
    },
  },
  {
    name: 'speed', group: 'Player', usage: 'speed [0.5-2 | reset]', description: 'Show or set the playback speed',
    run: async (args, sh) => {
      const p = playerOf(sh)
      const arg = args.trim().toLowerCase().replace(/x$/, '')
      if (!arg) { sh.print(`speed ${p.speed}x`); return }
      const v = arg === 'reset' ? 1 : Number(arg)
      if (!Number.isFinite(v)) fail('usage: speed [0.5-2 | reset]')
      await p.setSpeed(Math.min(2, Math.max(0.5, Math.round(v * 100) / 100)))
      sh.print(`speed ${p.speed}x`, 'ok')
    },
  },
  {
    name: 'shuffle', group: 'Player', usage: 'shuffle [on|off]  ·  shuffle <era> [count]',
    description: 'Turn shuffle on or off (no argument toggles); or play a random pick of songs from an era (default 40)',
    complete: async (arg) => {
      const typed = arg.trim().toLowerCase()
      const modes = ['on', 'off'].filter((w) => w.startsWith(typed))
      const eras = await eraNames().catch(() => [])
      return [...modes, ...eras.filter((n) => n.toLowerCase().startsWith(typed))]
    },
    run: async (args, sh) => {
      const p = playerOf(sh)
      const typed = args.trim()
      const bool = typed ? parseBool(typed) : null
      if (!typed || bool !== null) {
        p.setShuffle(typed ? bool! : !p.shuffle)
        sh.print(`shuffle ${p.shuffle ? 'on' : 'off'}`, 'ok')
        return
      }
      const countWord = /\s(\d+)$/.exec(typed)
      const count = Math.min(200, Math.max(1, countWord ? Number(countWord[1]) : 40))
      const name = (countWord ? typed.slice(0, countWord.index) : typed).trim()
      const catalog = await loadCatalog(false, () => sh.status('loading the song catalog (kept for a day)…'))
      const names = [...new Set([...catalog.values()].map((s) => s.era?.name).filter((n): n is string => !!n))].sort()
      const era = pickByName(names, (n) => n, name) ?? fail(`no single era matches "${name}" (try: shuffle <tab>)`)
      const pool = [...catalog.values()].filter((s) => s.era?.name === era && s.path && !['unsurfaced', 'recording_session'].includes(s.category))
      if (pool.length === 0) fail(`no songs in ${era}`)
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      const picks = pool.slice(0, count)
      await p.playCollection(picks.map(trackFromSong))
      sh.print(`playing ${plural(picks.length, 'random song')} from ${era}`, 'ok')
    },
  },
  {
    name: 'repeat', aliases: ['loop'], group: 'Player', usage: 'repeat [none|all|one]', description: 'Set the repeat mode (no argument cycles it)',
    complete: async (arg) => ['none', 'all', 'one'].filter((w) => w.startsWith(arg.trim())),
    run: (args, sh) => {
      const p = playerOf(sh)
      const want = args.trim().toLowerCase()
      const order: Repeat[] = ['none', 'all', 'one']
      if (want && !order.includes(want as Repeat)) fail('usage: repeat [none|all|one]')
      p.repeat = want ? (want as Repeat) : order[(order.indexOf(p.repeat) + 1) % 3]
      sh.print(`repeat ${p.repeat}`, 'ok')
    },
  },
  {
    name: 'queue', aliases: ['q'], group: 'Player', usage: 'queue [list | clear | add <song> | next <song> | remove N | jump N]',
    description: 'Show or change the play queue. <song> is a title, a number from the last list, or a file or folder here',
    complete: async (arg) => {
      const m = /^(\S*)(\s+)?([\s\S]*)$/.exec(arg)!
      if (!m[2]) return QUEUE_SUBS.filter((w) => w.startsWith(m[1].toLowerCase()))
      return ['add', 'next'].includes(m[1].toLowerCase()) ? (await completeTitles(m[3])).map((t) => `${m[1]} ${t}`) : []
    },
    run: async (args, sh) => {
      const p = playerOf(sh)
      const [sub = 'list', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      switch (sub.toLowerCase() || 'list') {
        case 'list': case 'ls': {
          if (p.queue.length === 0) { sh.print('queue is empty', 'dim'); return }
          const from = Math.max(0, p.index - 5)
          const rows = p.queue.slice(from, from + 40).map((t, i) => `${from + i === p.index ? '▶' : ' '} ${String(from + i + 1).padStart(3)}  ${trackLine(t)}`)
          sh.print(`${from > 0 ? `  … ${from} earlier\n` : ''}${rows.join('\n')}${from + 40 < p.queue.length ? `\n  … ${p.queue.length - from - 40} more` : ''}`)
          return
        }
        case 'clear': p.clear(); sh.print('queue cleared', 'ok'); return
        case 'add': case 'next': {
          const { tracks, label } = await tracksFromArg(rest, sh)
          if (!p.current) { await p.playCollection(tracks); sh.print(`▶ ${label}`, 'ok'); return }
          if (sub.toLowerCase() === 'add') tracks.forEach((t) => p.add(t))
          else [...tracks].reverse().forEach((t) => p.playNext(t))
          sh.print(sub.toLowerCase() === 'add' ? `queued ${label}` : `playing ${label} next`, 'ok')
          return
        }
        case 'remove': case 'rm': {
          const n = Number(rest)
          if (!Number.isInteger(n) || n < 1 || n > p.queue.length) fail(`remove which? 1-${p.queue.length}`)
          sh.print(`removed ${p.remove(n - 1).title}`, 'ok')
          return
        }
        case 'jump': {
          const n = Number(rest)
          if (!Number.isInteger(n) || n < 1 || n > p.queue.length) fail(`jump to which? 1-${p.queue.length}`)
          sh.print(`▶ ${(await p.jump(n - 1)).title}`, 'ok')
          return
        }
        default: fail('usage: queue [list | clear | add <song> | next <song> | remove N | jump N]')
      }
    },
  },
  {
    name: 'status', aliases: ['now', 'np'], group: 'Player', usage: 'status', description: 'What is playing, plus volume, speed, shuffle, repeat and the queue',
    run: async (_a, sh) => {
      const p = playerOf(sh)
      const t = p.current
      const [paused, pos, dur] = await Promise.all([p.paused(), p.position(), p.duration()])
      sh.print([
        t ? `${paused ? '⏸' : '▶'} ${trackLine(t)}` : 'nothing playing',
        ...(t ? [`  ${progressBar(pos, dur)} ${clock(pos)}${dur ? ` / ${clock(dur)}` : ''}`] : []),
        `volume ${p.volume}%${p.muted ? ' (muted)' : ''}  speed ${p.speed}x  shuffle ${p.shuffle ? 'on' : 'off'}  repeat ${p.repeat}`,
        `queue ${plural(p.queue.length, 'track')}${p.index >= 0 ? ` (at ${p.index + 1})` : ''}`,
        ...(p.sleepEnd ? [`sleep timer: ${clock(Math.max(0, (p.sleepEnd - Date.now()) / 1000))} left`] : []),
      ].join('\n'))
    },
  },
  {
    name: 'sleep', group: 'Player', usage: 'sleep [minutes | off]', description: 'Pause playback after a delay',
    run: (args, sh) => {
      const p = playerOf(sh)
      const arg = args.trim().toLowerCase()
      if (!arg) { sh.print(p.sleepEnd ? `sleep timer: ${clock(Math.max(0, (p.sleepEnd - Date.now()) / 1000))} left` : 'no sleep timer'); return }
      if (arg === 'off' || arg === 'cancel') { p.setSleep(null); sh.print('sleep timer off', 'ok'); return }
      const minutes = Number(arg)
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) fail('usage: sleep <minutes 1-1440 | off>')
      p.setSleep(minutes)
      sh.print(`sleep timer: ${plural(minutes, 'minute')}`, 'ok')
    },
  },
  {
    name: 'stop', group: 'Player', usage: 'stop', description: 'Stop playback and empty the queue',
    run: (_a, sh) => { playerOf(sh).stop(); sh.print('⏹ stopped', 'ok') },
  },
]
