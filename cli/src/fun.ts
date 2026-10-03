import { arch, platform, release } from 'node:os'
import { loadPools } from 'site:heardle'
import { apiBase, VERSION } from './api'
import { fail, type Command } from './command'
import { getToken, loadConfig } from './config'
import { color } from './out'
import { canOpenScreen, openScreen, visibleLength, wrapText, type Screen } from './screen'
import type { Shell } from './shell'
import { getSong } from './songs'

// The unserious end of the terminal (lib/terminal/fun.ts on the site): system
// info, fortunes, a juice box, matrix rain - plus watch and date. None of it
// touches data.

// ─── juicesay ────────────────────────────────────────────────────────────────

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

// A random line from a random song's lyrics. The pool (the same one the games
// use, cached a day) says which songs exist; lyrics come from the song itself.
async function randomLyricLine(): Promise<string> {
  const pool = await loadPools(['released', 'unreleased'])
  if (pool.length === 0) fail('fortune: no songs to pick from')
  for (let attempt = 0; attempt < 10; attempt++) {
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const song = await getSong(pick.id) as { name: string; lyrics?: string | null }
    const lines = (song.lyrics ?? '').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l.length >= 8 && l.length <= 120 && !/^[[(].*[\])]$/.test(l))
    if (lines.length) return `${lines[Math.floor(Math.random() * lines.length)]}\n- ${song.name}`
  }
  return fail('fortune: couldn’t find a lyric line (try again)')
}

// ─── neofetch ────────────────────────────────────────────────────────────────

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
  const s = Math.floor(process.uptime())
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function fetchText(sh: Shell): string {
  const os = ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as Record<string, string>)[platform()] ?? platform()
  const user = getToken() ? loadConfig().user : undefined
  const p = sh.player
  const info: [string, string][] = [
    ['OS', `${os} ${release()} · ${arch()}`],
    ['Host', `unreleased-cli ${VERSION}`],
    ['Uptime', uptime()],
    ['Shell', `unreleased-term · node ${process.versions.node}`],
    ['Terminal', `${process.env.TERM_PROGRAM ?? (process.env.WT_SESSION ? 'Windows Terminal' : process.env.TERM ?? 'unknown')} · ${process.stdout.columns ?? '?'}x${process.stdout.rows ?? '?'}`],
    ['Account', user ? `${user.name} (${user.role})` : 'guest'],
    ['API', new URL(apiBase()).host],
    ['Playing', p?.current ? `${p.current.title} · queue ${p.queue.length}` : 'nothing'],
  ]
  const head = `${user?.name ?? 'guest'}@unreleased`
  const text = [color.green(head), '-'.repeat(head.length), ...info.map(([k, v]) => `${color.green(k)}: ${v}`)]
  const rows = Math.max(LOGO.length, text.length)
  return Array.from({ length: rows }, (_, i) => `${color.yellow(LOGO[i] ?? ' '.repeat(LOGO[0].length))}  ${text[i] ?? ''}`).join('\n')
}

// ─── matrix ──────────────────────────────────────────────────────────────────

const RAIN = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789999'
const TRAIL = 24

function matrixScreen(): Parameters<typeof openScreen>[0] {
  let timer: NodeJS.Timeout | null = null
  let cols = 0
  let rows = 0
  let heads: number[] = []
  let age: Uint16Array = new Uint16Array(0)
  let glyph: string[] = []
  const pick = (): string => RAIN[Math.floor(Math.random() * RAIN.length)]

  const fit = (s: Screen): void => {
    cols = s.cols
    rows = s.rows
    // Drops start staggered above the top so the rain arrives unevenly.
    heads = Array.from({ length: cols }, () => -Math.floor(Math.random() * rows))
    age = new Uint16Array(cols * rows).fill(999)
    glyph = Array.from({ length: cols * rows }, pick)
  }

  const frame = (s: Screen): void => {
    if (s.cols !== cols || s.rows !== rows) fit(s)
    for (let i = 0; i < age.length; i++) if (age[i] < 999) age[i]++
    for (let c = 0; c < cols; c++) {
      heads[c]++
      if (heads[c] > rows + TRAIL && Math.random() > 0.9) heads[c] = -Math.floor(Math.random() * 10)
      const r = heads[c]
      if (r >= 0 && r < rows) { age[r * cols + c] = 0; glyph[r * cols + c] = pick() }
    }
    // A few lit characters flicker to another glyph.
    for (let k = 0; k < cols / 4; k++) {
      const i = Math.floor(Math.random() * glyph.length)
      if (age[i] < TRAIL) glyph[i] = pick()
    }
    const lines: string[] = []
    for (let r = 0; r < rows; r++) {
      let line = ''
      let last = ''
      for (let c = 0; c < cols; c++) {
        const a = age[r * cols + c]
        // The head is white-hot; the trail fades from bright green to dark.
        const style = a === 0 ? '\x1b[1;97m' : a < 4 ? '\x1b[0;92m' : a < 12 ? '\x1b[0;32m' : a < TRAIL ? '\x1b[0;2;32m' : ''
        if (style !== last) { line += style || '\x1b[0m'; last = style }
        line += style ? glyph[r * cols + c] : ' '
      }
      lines.push(line)
    }
    s.draw(lines)
  }

  return {
    start: (s) => { fit(s); timer = setInterval(() => frame(s), 50) },
    key: (_str, _key, s) => s.exit(),
    resize: (s) => fit(s),
    stop: () => { if (timer) clearInterval(timer) },
  }
}

// ─── watch ───────────────────────────────────────────────────────────────────

function watchScreen(sh: Shell, command: string, seconds: number): { body: Parameters<typeof openScreen>[0]; settle: () => Promise<void> } {
  let timer: NodeJS.Timeout | null = null
  let output = ''
  let at: Date | null = null
  let inFlight: Promise<void> | null = null
  const depth = sh.depth

  const render = (s: Screen): void => {
    const left = `Every ${seconds}s: ${command}`
    const right = `${at ? at.toLocaleTimeString() : ''}   q leaves`
    const gap = Math.max(1, s.cols - visibleLength(left) - right.length)
    s.draw([color.dim(`${left}${' '.repeat(gap)}${right}`), '', ...wrapText(output || '…', s.cols)])
  }

  const tick = (s: Screen): void => {
    if (inFlight || s.closed) return
    inFlight = sh.capture(command)
      .then((text) => { output = text })
      .catch((err) => { output = (err as Error).message })
      .finally(() => { inFlight = null; at = new Date(); if (!s.closed) render(s) })
  }

  return {
    body: {
      start: (s) => { render(s); tick(s); timer = setInterval(() => tick(s), seconds * 1000) },
      key: (str, key, s) => { if (str === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) s.exit() },
      resize: (s) => render(s),
      stop: () => { if (timer) clearInterval(timer) },
    },
    // Leaving mid-run cancels that run, and waits for it, so nothing it prints
    // lands after the prompt is back.
    settle: async () => { sh.abortAbove(depth); await inFlight?.catch(() => undefined) },
  }
}

// ─── The commands ────────────────────────────────────────────────────────────

const needScreen = (sh: Shell, name: string): void => {
  if (sh.scripted) fail(`${name}: not inside a script or watch`)
  if (!canOpenScreen()) fail(`${name}: needs an interactive terminal`)
}

export const FUN_COMMANDS: Command[] = [
  {
    name: 'neofetch', aliases: ['fetch'], group: 'Fun', usage: 'neofetch', description: 'System info, with a logo',
    run: (_a, sh) => sh.print(fetchText(sh)),
  },
  {
    name: 'fortune', group: 'Fun', usage: 'fortune  ·  fortune | juicesay', description: 'A random line from a random song (pipe it into juicesay)',
    run: async (_a, sh) => sh.print(await randomLyricLine()),
  },
  {
    name: 'juicesay', group: 'Fun', usage: 'juicesay [text]  ·  <command> | juicesay', description: 'A juice box says things (a random lyric line when you give it nothing)',
    run: async (args, sh) => sh.print(juicesayText(args.trim() || await randomLyricLine())),
  },
  {
    name: 'matrix', group: 'Fun', usage: 'matrix', description: 'Digital rain. Any key leaves',
    run: async (_a, sh) => { needScreen(sh, 'matrix'); await openScreen(matrixScreen()) },
  },
  {
    name: 'watch', group: 'Shell', usage: 'watch [-n seconds] <command>  (quote a pipe: watch "users | head 5")',
    description: 'Re-run a command every few seconds on a live screen (default 2s). q leaves',
    run: async (args, sh) => {
      const m = /^(?:-n\s*(\d+(?:\.\d+)?)\s+)?([\s\S]+)$/.exec(args.trim())
      if (!m) fail('usage: watch [-n seconds] <command>')
      const seconds = Math.min(300, Math.max(1, m![1] ? Number(m![1]) : 2))
      const command = m![2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
      if (/^(watch|matrix|wordle|heardle|login|source|\.)\b/i.test(command)) fail(`watch: ${command.split(/\s+/)[0]} can’t run inside watch`)
      needScreen(sh, 'watch')
      const { body, settle } = watchScreen(sh, command, seconds)
      await openScreen(body)
      await settle()
    },
  },
  {
    name: 'date', group: 'Shell', usage: 'date', description: 'The current date and time',
    run: (_a, sh) => sh.print(new Date().toString()),
  },
]
