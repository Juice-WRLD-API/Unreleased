import { useChatStore } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { APP_VERSION } from '../appVersion'
import { formatListeningTime, joinPlayedSongs, buildListeningStats, prefsForPeriod, type ListeningPeriod, type RankedEntry } from '../listeningStats'
import { resolveStatsSongs } from '../statsCatalog'
import { loadAllSongs } from '../juicewrldApi'
import { fail, type TermCommand } from './types'
import { getTermTheme, setTermTheme, TERM_THEMES } from './themeStore'

// The unserious end of the terminal: system-info flexing, fortunes, a cow, and
// the commands that hand the screen over to something live (matrix rain, the
// visualizer, karaoke lyrics, the games). None of it touches data.

// ─── cowsay ───────────────────────────────────────────────────────────────────

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { out.push(line); line = '' }
      // A word longer than the bubble is cut rather than allowed to break it.
      let w = word
      while (w.length > width) { out.push(w.slice(0, width)); w = w.slice(width) }
      line = line ? `${line} ${w}` : w
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

export function juicesayText(text: string): string {
  const lines = wrap(text.trim() || '...', 40)
  const width = Math.max(...lines.map((l) => l.length))
  const body = lines.length === 1
    ? [`< ${lines[0].padEnd(width)} >`]
    : lines.map((l, i) => {
      const [l1, r1] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|']
      return `${l1} ${l.padEnd(width)} ${r1}`
    })
  return [
    ` ${'_'.repeat(width + 2)}`,
    ...body,
    ` ${'-'.repeat(width + 2)}`,
    '        \\   .-------.',
    '         \\  |_______|',
    '            | JUICE |',
    '            |  (:)  |',
    '            |_______|',
  ].join('\n')
}

// A random line from a random song's lyrics, read from the catalogue the app
// already loads (5 minute cache) rather than shipped in the source.
async function randomLyricLine(): Promise<string> {
  const songs = (await loadAllSongs()).filter((s) => s.lyrics && s.lyrics.trim())
  if (songs.length === 0) fail('juicesay: no lyrics in the catalogue')
  for (let attempt = 0; attempt < 10; attempt++) {
    const song = songs[Math.floor(Math.random() * songs.length)]
    const lines = song.lyrics!.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 8 && l.length <= 120 && !/^[[(].*[\])]$/.test(l))
    if (lines.length) return `${lines[Math.floor(Math.random() * lines.length)]}\n- ${song.name}`
  }
  return fail('juicesay: could not find a lyric line')
}

// ─── neofetch ─────────────────────────────────────────────────────────────────

const LOGO = [
  '      .-""""""-.      ',
  '    .\'  .----.  \'.    ',
  '   /   /  __  \\   \\   ',
  '  |   |  /  \\  |   |  ',
  '  |   |  \\__/  |   |  ',
  '   \\   \\      /   /   ',
  '    \'.  \'----\'  .\'    ',
  '      \'-......-\'      ',
]

function uptime(): string {
  const s = Math.floor(performance.now() / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function browserName(): string {
  const ua = navigator.userAgent
  if (/Electron\//.test(ua)) return `Electron ${/Electron\/(\S+)/.exec(ua)?.[1] ?? ''}`.trim()
  if (/Edg\//.test(ua)) return `Edge ${/Edg\/(\d+)/.exec(ua)?.[1] ?? ''}`.trim()
  if (/Firefox\//.test(ua)) return `Firefox ${/Firefox\/(\d+)/.exec(ua)?.[1] ?? ''}`.trim()
  if (/Chrome\//.test(ua)) return `Chrome ${/Chrome\/(\d+)/.exec(ua)?.[1] ?? ''}`.trim()
  if (/Safari\//.test(ua)) return 'Safari'
  return 'unknown browser'
}

function fetchText(): string {
  const s = useStore.getState()
  const cs = useChatStore.getState()
  const me = cs.me
  const rooms = cs.servers.reduce((n, srv) => n + srv.channels.length, 0)
  const info: [string, string][] = [
    ['OS', `${navigator.platform || 'unknown'} · ${browserName()}`],
    ['Host', `Unreleased ${APP_VERSION}`],
    ['Uptime', uptime()],
    ['Shell', 'unreleased-term'],
    ['Theme', `${s.theme} · terminal ${getTermTheme().id}`],
    ['Resolution', `${window.innerWidth}x${window.innerHeight}`],
    ['Chat', `${cs.servers.length} server${cs.servers.length === 1 ? '' : 's'}, ${rooms} channels, ${cs.conversations.length} DMs`],
    ['Library', `${s.playlists.length} playlists · ${s.likedTrackIds.length} liked · queue ${s.queue.length}`],
    ['Playing', s.currentTrack ? `${s.isPlaying ? '▶' : '⏸'} ${s.currentTrack.title}` : 'nothing'],
  ]
  const head = `${me?.username ?? 'admin'}@unreleased`
  const text = [head, '-'.repeat(head.length), ...info.map(([k, v]) => `${k}: ${v}`)]
  const rows = Math.max(LOGO.length, text.length)
  return Array.from({ length: rows }, (_, i) => `${LOGO[i] ?? ' '.repeat(LOGO[0].length)}  ${text[i] ?? ''}`).join('\n')
}

// ─── stats ────────────────────────────────────────────────────────────────────

function barRows(entries: RankedEntry[], limit: number): string[] {
  const top = entries.slice(0, limit)
  const max = Math.max(1, ...top.map((e) => e.plays))
  const width = Math.min(26, Math.max(...top.map((e) => e.label.length), 4))
  return top.map((e) => {
    const bar = '█'.repeat(Math.max(1, Math.round((e.plays / max) * 24)))
    return `  ${e.label.slice(0, width).padEnd(width)}  ${bar} ${e.plays}`
  })
}

const PERIODS = ['all', '7', '30']

// ─── the commands ─────────────────────────────────────────────────────────────

export const FUN_COMMANDS: TermCommand[] = [
  {
    name: 'neofetch', aliases: ['fetch'], group: 'Fun', usage: 'neofetch', description: 'System info, with a logo',
    run: (_a, ctx) => { ctx.print(fetchText()) },
  },
  {
    name: 'fortune', group: 'Fun', usage: 'fortune  ·  fortune | juicesay', description: 'A random line from a random song (pipe it into juicesay)',
    run: async (_a, ctx) => { ctx.print(await randomLyricLine()) },
  },
  {
    name: 'juicesay', group: 'Fun', usage: 'juicesay [text]  ·  <command> | juicesay', description: 'A juice box says things (a random lyric line when you give it nothing)',
    run: async (args, ctx) => { ctx.print(juicesayText(args.trim() || await randomLyricLine())) },
  },
  {
    name: 'termtheme', aliases: ['colors'], group: 'Fun', usage: 'termtheme [name]', description: 'List the terminal colour schemes, or switch to one',
    complete: (before, partial) => (before.length === 0 ? TERM_THEMES.map((t) => t.id).filter((id) => id.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const want = args.trim()
      if (!want) {
        const now = getTermTheme().id
        ctx.print(TERM_THEMES.map((t) => `${t.id === now ? '*' : ' '} ${t.id.padEnd(8)} ${t.label}`).join('\n'))
        return
      }
      const set = setTermTheme(want) ?? fail(`no theme "${want}" (try: termtheme)`)
      ctx.print(`terminal theme: ${set.label}`, 'ok')
    },
  },
  {
    name: 'matrix', group: 'Fun', usage: 'matrix', description: 'Digital rain. Any key leaves',
    run: (_a, ctx) => ctx.screen({ kind: 'matrix' }),
  },
  {
    name: 'visualizer', aliases: ['viz'], group: 'Fun', usage: 'visualizer', description: 'A live spectrum of whatever is playing. Any key leaves',
    run: (_a, ctx) => ctx.screen({ kind: 'visualizer' }),
  },
  {
    name: 'karaoke', group: 'Fun', usage: 'karaoke', description: 'The current song’s lyrics, following along (synced lyrics scroll with the song). q leaves',
    run: (_a, ctx) => {
      if (!useStore.getState().currentTrack) fail('nothing is playing')
      ctx.screen({ kind: 'karaoke' })
    },
  },
  {
    name: 'wordle', group: 'Fun', usage: 'wordle [daily | unlimited]', description: 'The song-title Wordle, in the terminal (same daily puzzle and saved progress as the page)',
    complete: (before, partial) => (before.length === 0 ? ['daily', 'unlimited'].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const mode = args.trim().toLowerCase()
      if (mode && !['daily', 'unlimited', 'practice'].includes(mode)) fail('usage: wordle [daily | unlimited]')
      ctx.screen({ kind: 'wordle', unlimited: mode === 'unlimited' || mode === 'practice' })
    },
  },
  {
    name: 'heardle', group: 'Fun', usage: 'heardle', description: 'Name the song from a short clip (practice rounds, with the page’s settings)',
    run: (_a, ctx) => ctx.screen({ kind: 'heardle' }),
  },
  {
    name: 'watch', group: 'App', usage: 'watch [-n seconds] <command>  (quote a pipe: watch "users | head 5")', description: 'Re-run a command every few seconds on a live screen (default 2s). q leaves',
    run: (args, ctx) => {
      const m = /^(?:-n\s*(\d+(?:\.\d+)?)\s+)?([\s\S]+)$/.exec(args.trim())
      if (!m) fail('usage: watch [-n seconds] <command>')
      const seconds = Math.min(300, Math.max(1, m![1] ? Number(m![1]) : 2))
      const command = m![2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
      if (/^watch\b/i.test(command)) fail('watch: no watching a watch')
      ctx.screen({ kind: 'watch', command, seconds })
    },
  },
  {
    name: 'stats', group: 'Library', usage: 'stats [all | 7 | 30] [N]', description: 'Your listening stats as bar charts: top songs, eras, categories, collaborators',
    complete: (before, partial) => (before.length === 0 ? PERIODS.filter((p) => p.startsWith(partial)) : []),
    run: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const period = (words.find((w) => PERIODS.includes(w)) ?? 'all') as ListeningPeriod
      const limit = Math.min(30, Math.max(3, Number(words.find((w) => /^\d+$/.test(w) && !PERIODS.includes(w))) || 10))
      const plays = useStore.getState().listeningPlays
      if (plays.length === 0) { ctx.print('nothing played yet', 'dim'); return }
      const prefs = prefsForPeriod(plays, period)
      if (prefs.length === 0) { ctx.print(`no plays in the last ${period} days`, 'dim'); return }
      ctx.print(`reading ${prefs.length} played songs…`, 'dim')
      const songs = await resolveStatsSongs(prefs.map((p) => p.song), () => undefined, () => false)
      const stats = buildListeningStats(joinPlayedSongs(prefs, songs))
      const top = stats.played.slice(0, limit)
      const topMax = Math.max(1, top[0]?.playcount ?? 1)
      const width = Math.min(32, Math.max(...top.map((p) => p.song.name.length), 4))
      ctx.print([
        `${period === 'all' ? 'All time' : `Last ${period} days`}: ${stats.totalPlays} plays · ${stats.distinctSongs} songs · ${formatListeningTime(stats.totalSeconds)}`,
        '',
        'Top songs',
        ...top.map((p) => `  ${p.song.name.slice(0, width).padEnd(width)}  ${'█'.repeat(Math.max(1, Math.round((p.playcount / topMax) * 24)))} ${p.playcount}`),
        '',
        'Eras',
        ...barRows(stats.eras, 6),
        '',
        'Categories',
        ...barRows(stats.categories, 5),
        ...(stats.collaborators.length ? ['', 'Collaborators', ...barRows(stats.collaborators, 5)] : []),
      ].join('\n'))
    },
  },
]
