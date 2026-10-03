import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { catFile, diskUsage, grepFiles, headTailFile, locateName, treeView, wcFile } from 'site:fileTools'
import { accountName, accountRole, apiBase, describeError, getMe, isAbortError, isHttpUrl, normalizePrefix, passwordLogin, routeRules, setActiveSignal, stripSlash, VERSION } from './api'
import { getToken, HISTORY_MAX, loadAliases, loadConfig, loadHistory, saveAliases, saveConfig, saveHistory } from './config'
import { ADMIN_COMMANDS } from './admin'
import { fail, type Command, type Group } from './command'
import { downloadPath } from './download'
import { FILES_ROOT, filesPathString, formatListing, homeCwd, listDir, readTextFile, resolveDir, splitTyped, unquote, type FilesCwd } from './files'
import { FUN_COMMANDS, juicesayText } from './fun'
import { GAME_COMMANDS } from './games'
import { LIBRARY_COMMANDS } from './library'
import { color, writeTone, type Tone } from './out'
import { PEOPLE_COMMANDS } from './people'
import { PLAYER_COMMANDS } from './playback'
import type { Player } from './player'
import { screenActive } from './screen'

// The site terminal's shell (components/chat/TerminalPanel.tsx) for the
// command line: the same file-tree commands, history with `!`, aliases, output
// pipes and `source`, minus what needs the page itself (chat, navigation).
// Commands throw an Error with a short message to fail; the shell prints it.

/** How the shell asks the user something (login, confirmations). */
export interface Prompter {
  ask: (question: string, hidden?: boolean) => Promise<string>
}

// `cmd | grep text | head 5`: output filters for any command. Only recognised
// when every part after a pipe is one of these.
const FILTERS = new Set(['grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'juicesay'])

/** Splits on ` | ` outside quotes, so `watch "users | head 5"` keeps its pipe.
 *  A quote only opens at the start of a word (the apostrophe in "ain't"
 *  doesn't), and one that never closes counts for nothing. */
function splitOnPipes(line: string): string[] {
  const parts: string[] = []
  let quote = ''
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if ((ch === '"' || ch === "'") && (i === 0 || /\s/.test(line[i - 1]))) { quote = ch; continue }
    if (ch === '|' && /\s/.test(line[i - 1] ?? '') && /\s/.test(line[i + 1] ?? '')) {
      parts.push(line.slice(start, i).trim())
      start = i + 1
    }
  }
  if (quote) return line.split(/\s+\|\s+/)
  parts.push(line.slice(start).trim())
  return parts
}

function splitPipes(line: string): { cmd: string; filters: string[] } {
  const parts = splitOnPipes(line)
  if (parts.length > 1 && parts.slice(1).every((p) => FILTERS.has(p.trim().split(/\s+/)[0].toLowerCase()))) return { cmd: parts[0], filters: parts.slice(1) }
  return { cmd: line, filters: [] }
}

function applyFilter(lines: string[], filter: string): string[] {
  const [name, ...args] = filter.trim().split(/\s+/)
  const count = (fallback: number): number => {
    const word = args.find((a) => /^-?\d+$/.test(a))
    return word ? Math.max(0, Math.abs(Number(word))) : fallback
  }
  switch (name.toLowerCase()) {
    case 'grep': {
      let invert = false
      let sensitive = false
      while (args[0]?.startsWith('-')) {
        const flag = args.shift()!
        if (flag.includes('v')) invert = true
        if (flag.includes('s')) sensitive = true
      }
      const needle = args.join(' ').replace(/^(["'])(.*)\1$/, '$2')
      if (!needle) throw new Error('grep: missing text to look for')
      const fold = (t: string): string => (sensitive ? t : t.toLowerCase())
      return lines.filter((l) => fold(l).includes(fold(needle)) !== invert)
    }
    case 'head': return lines.slice(0, count(10))
    case 'tail': { const n = count(10); return n === 0 ? [] : lines.slice(-n) }
    case 'wc': return [String(lines.length)]
    case 'sort': {
      const sorted = [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      return args.some((a) => a.startsWith('-') && a.includes('r')) ? sorted.reverse() : sorted
    }
    case 'uniq': return lines.filter((l, i) => i === 0 || l !== lines[i - 1])
    case 'juicesay': return juicesayText(lines.join(' ')).split('\n')
    default: return lines
  }
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

// ─── Commands ────────────────────────────────────────────────────────────────

const fileTool = (job: (cwd: FilesCwd, arg: string) => Promise<string>) => async (arg: string, sh: Shell): Promise<void> => {
  sh.print(await job(sh.cwd, arg))
}

async function login(arg: string, sh: Shell): Promise<void> {
  const username = unquote(arg)
  let token: string
  if (!username) {
    token = (await sh.ask('API token (on the site, type `token copy` in the terminal): ', true)).trim()
    if (!token) fail('login: no token given')
  } else {
    const password = await sh.ask(`password for ${username}: `, true)
    if (!password) fail('login: no password given')
    let res: { token: string }
    try {
      res = await passwordLogin(username, password)
    } catch (err) {
      if (isAbortError(err) || !/otp|2fa|two.?factor|authenticator/i.test((err as Error).message)) throw new Error(`login: ${describeError(err)}`)
      const otp = (await sh.ask('2FA code: ')).trim()
      res = await passwordLogin(username, password, otp)
    }
    token = res.token
  }
  let me
  try { me = await getMe(token) } catch (err) {
    if (isAbortError(err)) throw err
    fail(`login: that token was not accepted (${describeError(err)})`)
  }
  const user = { id: me!.id, name: accountName(me!), role: accountRole(me!) }
  saveConfig({ ...loadConfig(), token, user })
  sh.print(`signed in as ${user.name} (${user.role})`, 'ok')
  if (process.env.UNRELEASED_TOKEN) sh.print('note: UNRELEASED_TOKEN is set and is used instead of the saved token', 'dim')
}

const COMMANDS: Command[] = [
  {
    name: 'cd', group: 'Files', usage: 'cd [folder | .. | / | - | ~]', path: 'dir',
    description: 'Move around the file tree. / is the channel list, - goes back to the previous folder, cd alone (or ~) goes to the main channel',
    run: async (arg, sh) => {
      const target = unquote(arg)
      if (target === '-') {
        if (!sh.prevCwd) fail('cd: no previous folder')
        ;[sh.cwd, sh.prevCwd] = [sh.prevCwd!, sh.cwd]
        sh.print(filesPathString(sh.cwd), 'dim')
        return
      }
      const next = !target || target === '~' ? await homeCwd() : await resolveDir(sh.cwd, target)
      sh.prevCwd = sh.cwd
      sh.cwd = next
    },
  },
  {
    name: 'ls', aliases: ['dir'], group: 'Files', usage: 'ls [folder]', path: 'dir',
    description: 'List a folder: folders first, sizes on the left. At / it lists the channels',
    run: async (arg, sh) => {
      const dir = arg.trim() ? await resolveDir(sh.cwd, arg) : sh.cwd
      sh.print(formatListing(await listDir(dir, true), dir))
    },
  },
  {
    name: 'pwd', group: 'Files', usage: 'pwd', description: 'Where you are in the file tree, and the local folder get saves into',
    run: (_arg, sh) => sh.print(`${filesPathString(sh.cwd)}\n${color.dim(`local  ${sh.localDir}`)}`),
  },
  {
    name: 'lcd', group: 'Files', usage: 'lcd [local folder]',
    description: 'Change the local folder downloads are saved into (no argument: show it)',
    run: (arg, sh) => {
      const target = unquote(arg)
      if (!target) { sh.print(sh.localDir); return }
      const next = resolve(sh.localDir, target.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'))
      if (!existsSync(next) || !statSync(next).isDirectory()) fail(`lcd: ${target}: no such local folder`)
      sh.localDir = next
      sh.print(next, 'dim')
    },
  },
  {
    name: 'get', aliases: ['download', 'dl'], group: 'Files', usage: 'get [-o dir] [-f] <file | folder | *>', path: 'any',
    description: 'Download a file, or a whole folder with its structure kept, into the local folder (see lcd). -o picks another folder; -f overwrites files already there',
    run: async (arg, sh) => sh.print(await downloadPath(sh.cwd, arg, sh.localDir), 'ok'),
  },
  { name: 'cat', group: 'Files', usage: 'cat <file>', path: 'any', description: 'Print a text file', run: fileTool(catFile) },
  { name: 'head', group: 'Files', usage: 'head [-n N] <file>', path: 'any', description: 'The first lines of a text file (10 by default)', run: fileTool((cwd, arg) => headTailFile('head', cwd, arg)) },
  { name: 'tail', group: 'Files', usage: 'tail [-n N] <file>', path: 'any', description: 'The last lines of a text file (10 by default)', run: fileTool((cwd, arg) => headTailFile('tail', cwd, arg)) },
  { name: 'wc', group: 'Files', usage: 'wc <file>', path: 'any', description: 'Lines, words and bytes in a text file', run: fileTool(wcFile) },
  {
    name: 'grep', group: 'Files', usage: 'grep [-s] [-r] [-l] <text> [folder | file]',
    description: 'Search inside the text files here (-r: and in subfolders, -l: file names only, -s: case-sensitive)', run: fileTool(grepFiles),
  },
  { name: 'locate', group: 'Files', usage: 'locate <name> [folder]', description: 'Find files and folders by name under here (* and ? are wildcards)', run: fileTool(locateName) },
  { name: 'tree', group: 'Files', usage: 'tree [-L depth] [folder]', path: 'dir', description: 'A folder as an indented tree, two levels by default', run: fileTool(treeView) },
  { name: 'du', group: 'Files', usage: 'du [folder]', path: 'dir', description: 'How much is in each subfolder, and in total', run: fileTool(diskUsage) },
  ...LIBRARY_COMMANDS,
  ...PLAYER_COMMANDS,
  ...PEOPLE_COMMANDS,
  ...ADMIN_COMMANDS,
  ...FUN_COMMANDS,
  ...GAME_COMMANDS,
  {
    name: 'source', aliases: ['.'], group: 'Shell', usage: 'source [-y] [-k] <file>', path: 'any',
    description: 'Run the commands in a text file from the tree, one per line (# comments). Without -y it only shows them; -k keeps going past a failing line',
    run: async (arg, sh) => sh.source(arg),
  },
  {
    name: 'alias', group: 'Shell', usage: 'alias [name=command]', description: 'Make a shortcut (alias music=\'cd comp/Music\'); with no argument, list them',
    run: (arg, sh) => {
      const m = /^([\w.-]+)\s*=\s*([\s\S]+)$/.exec(arg.trim())
      if (!arg.trim()) {
        const all = Object.entries(sh.aliases)
        sh.print(all.length ? all.map(([k, v]) => `alias ${k}='${v}'`).join('\n') : 'no aliases (alias name=command…)', all.length ? 'plain' : 'dim')
        return
      }
      if (!m) {
        const one = sh.aliases[arg.trim()]
        if (!one) fail(`alias: ${arg.trim()}: not found (usage: alias name=command…)`)
        sh.print(`alias ${arg.trim()}='${one}'`)
        return
      }
      if (['alias', 'unalias'].includes(m[1])) fail(`alias: can't alias ${m[1]}`)
      sh.aliases[m[1]] = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
      saveAliases(sh.aliases)
      sh.print(`alias ${m[1]}='${sh.aliases[m[1]]}'`, 'ok')
    },
  },
  {
    name: 'unalias', group: 'Shell', usage: 'unalias <name>', description: 'Remove a shortcut',
    run: (arg, sh) => {
      const name = arg.trim()
      if (!sh.aliases[name]) fail(`unalias: ${name || '?'}: not found`)
      delete sh.aliases[name]
      saveAliases(sh.aliases)
      sh.print(`removed alias ${name}`, 'ok')
    },
  },
  {
    name: 'history', group: 'Shell', usage: 'history [N | -c]', description: 'Commands you typed, numbered for !N (!! is the last one, !text the last starting with text). -c clears it',
    run: (arg, sh) => {
      const a = arg.trim()
      if (a === '-c') { sh.history.length = 0; saveHistory([]); sh.print('history cleared', 'ok'); return }
      const n = a ? Number(a) : sh.history.length
      if (!Number.isInteger(n) || n < 0) fail('usage: history [N | -c]')
      const start = Math.max(0, sh.history.length - n)
      sh.print(sh.history.slice(start).map((h, i) => `${String(start + i + 1).padStart(5)}  ${h}`).join('\n') || '(empty)', sh.history.length ? 'plain' : 'dim')
    },
  },
  { name: 'echo', group: 'Shell', usage: 'echo <text>', description: 'Print text', run: (arg, sh) => sh.print(unquote(arg)) },
  {
    name: 'clear', aliases: ['cls'], group: 'Shell', usage: 'clear', description: 'Clear the screen',
    run: () => { if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H') },
  },
  { name: 'exit', aliases: ['quit'], group: 'Shell', usage: 'exit', description: 'Leave the shell', run: (_arg, sh) => { sh.exiting = true } },
  {
    name: 'help', aliases: ['man'], group: 'Shell', usage: 'help [command]', description: 'List the commands, or explain one',
    run: (arg, sh) => {
      const topic = arg.trim()
      if (!topic) { sh.print(helpText()); return }
      const command = findCommand(topic)
      if (!command) fail(`help: no help for "${topic}"`)
      sh.print(`${command!.usage}\n    ${command!.description}${command!.aliases?.length ? `\n    also: ${command!.aliases.join(', ')}` : ''}`)
    },
  },
  {
    name: 'login', group: 'Account', usage: 'login [username]',
    description: 'Sign in. With no username it asks for your API token (on the site: token copy in the terminal); with one it asks for the password',
    run: login,
  },
  {
    name: 'logout', group: 'Account', usage: 'logout', description: 'Forget the saved token on this computer (the token itself stays valid on the site)',
    run: (_arg, sh) => {
      const { token: _token, user: _user, ...rest } = loadConfig()
      saveConfig(rest)
      sh.print('signed out here', 'ok')
    },
  },
  {
    name: 'whoami', group: 'Account', usage: 'whoami', description: 'The account you are signed in as',
    run: async (_arg, sh) => {
      if (!getToken()) { sh.print('guest (not signed in - try: login)', 'dim'); return }
      let me
      try { me = await getMe() } catch (err) {
        if (isAbortError(err)) throw err
        fail(/ 40[13]\b/.test((err as Error).message) ? 'the saved token was rejected (try: login)' : describeError(err))
      }
      const user = { id: me!.id, name: accountName(me!), role: accountRole(me!) }
      // Keep the prompt's name in step with the account.
      if (!process.env.UNRELEASED_TOKEN) saveConfig({ ...loadConfig(), user })
      sh.print(`${user.name}   id ${user.id} · ${user.role}`)
    },
  },
  {
    name: 'api', group: 'Account', usage: 'api [set <url> | reset | rule <prefix> <url> | unrule <prefix>]',
    description: 'Show or change the API base, and route path prefixes (/cdn, /chat…) to other servers',
    complete: async (arg) => ['set ', 'reset', 'rule ', 'unrule ', ...routeRules().map((r) => `unrule ${r.prefix}`)].filter((c) => c.startsWith(arg)),
    run: (arg, sh) => {
      const [sub = '', ...rest] = arg.trim().split(/\s+/).map(unquote)
      const cfg = loadConfig()
      const show = (): void => {
        const rules = routeRules()
        const env = process.env.UNRELEASED_API ? ' (from UNRELEASED_API)' : cfg.api ? '' : ' (default)'
        sh.print(`API ${apiBase()}${env}${rules.length ? '\n' + rules.map((r) => `  ${r.prefix.padEnd(14)} -> ${r.base}`).join('\n') : '\nno route rules'}`)
      }
      if (!sub || sub === 'show') return show()
      if (sub === 'set') {
        const url = stripSlash(rest[0] ?? '')
        if (!isHttpUrl(url)) fail('usage: api set <url>  (a full http(s) address, e.g. https://staging.example.com/juicewrld)')
        saveConfig({ ...cfg, api: url })
        sh.print(`API base set to ${url}`, 'ok')
        if (process.env.UNRELEASED_API) sh.print('UNRELEASED_API is set and still wins over this', 'dim')
        return
      }
      if (sub === 'reset') {
        const { api: _api, rules: _rules, ...keep } = cfg
        saveConfig(keep)
        sh.print('API base and route rules cleared', 'ok')
        return
      }
      if (sub === 'rule') {
        const prefix = normalizePrefix(rest[0] ?? '')
        const base = stripSlash(rest[1] ?? '')
        if (!prefix || !isHttpUrl(base)) fail('usage: api rule <prefix> <url>  (e.g. api rule /cdn https://cdn.example.com/juicewrld)')
        saveConfig({ ...cfg, rules: [...(cfg.rules ?? []).filter((r) => normalizePrefix(r.prefix) !== prefix), { prefix, base }] })
        sh.print(`${prefix} -> ${base}`, 'ok')
        return
      }
      if (sub === 'unrule') {
        const prefix = normalizePrefix(rest[0] ?? '')
        if (!(cfg.rules ?? []).some((r) => r.prefix === prefix)) fail(`unrule: ${prefix || '?'}: no such rule (api lists them)`)
        saveConfig({ ...cfg, rules: (cfg.rules ?? []).filter((r) => r.prefix !== prefix) })
        sh.print(`removed rule ${prefix}`, 'ok')
        return
      }
      fail('usage: api [set <url> | reset | rule <prefix> <url> | unrule <prefix>]')
    },
  },
  { name: 'version', group: 'Account', usage: 'version', description: 'The CLI version and the API it talks to', run: (_arg, sh) => sh.print(`unreleased-cli ${VERSION}\nAPI ${apiBase()}`) },
]

const GROUPS: Group[] = ['Files', 'Library', 'Player', 'People', 'Admin', 'Fun', 'Shell', 'Account']

function findCommand(word: string): Command | null {
  const name = word.trim().replace(/^\//, '').toLowerCase()
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name)) ?? null
}

function helpText(): string {
  const width = Math.max(...GROUPS.map((g) => g.length)) + 2
  // Like the site, the Admin row is only offered to administrators (going by
  // the role saved at login); the commands themselves check again.
  const shown = GROUPS.filter((g) => g !== 'Admin' || loadConfig().user?.role === 'admin')
  return [
    'Commands:',
    ...shown.map((g) => `  ${g.padEnd(width)}${COMMANDS.filter((c) => c.group === g).map((c) => c.name).join('  ')}`),
    '',
    'help <command> explains one',
    'Tab completes names and paths · ↑ ↓ history · Ctrl+R search history · Ctrl+L clear · Ctrl+C cancel · Ctrl+D leave',
    'cmd | grep text · cmd | head 5 · cmd | sort -r · fortune | juicesay · !! repeats the last command',
    'Without the shell: unreleased ls comp   (one command, then exit)',
  ].join('\n')
}

const commandNames = (): string[] => [...new Set(COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]))].sort()

// ─── The shell ───────────────────────────────────────────────────────────────

export class Shell {
  cwd: FilesCwd = FILES_ROOT
  prevCwd: FilesCwd | null = null
  /** The local folder `get` saves into. */
  localDir = process.cwd()
  readonly history: string[]
  readonly aliases: Record<string, string>
  exiting = false
  /** The music player; only the interactive shell has one (it stops with it). */
  player: Player | null = null
  private errors = 0
  private scriptDepth = 0
  /** Inside `watch`, where nothing may stop to ask a question. */
  private captureDepth = 0
  private sinks: { lines: string[]; keepErrors?: boolean }[] = []
  private controllers: AbortController[] = []

  constructor(private readonly prompter: Prompter, private readonly persistHistory: boolean) {
    this.history = persistHistory ? loadHistory() : []
    this.aliases = loadAliases()
  }

  get busy(): boolean { return this.controllers.length > 0 }

  /** Running lines nobody is typing (a script, watch): full screens and
   *  questions have to refuse. */
  get scripted(): boolean { return this.scriptDepth > 0 || this.captureDepth > 0 }

  /** Asks the user something, unless no one is there to answer. */
  ask(question: string, hidden = false): Promise<string> {
    if (this.captureDepth > 0) fail('that has to ask first, which it can’t do inside watch')
    return this.prompter.ask(question, hidden)
  }

  /** How many commands are running right now (watch cancels the ones it started). */
  get depth(): number { return this.controllers.length }
  abortAbove(depth: number): void { for (const c of this.controllers.slice(depth)) c.abort() }

  /** Runs a line and hands back everything it printed, errors included, as
   *  text (what `watch` shows). */
  async capture(line: string): Promise<string> {
    const sink = { lines: [] as string[], keepErrors: true }
    this.sinks.push(sink)
    this.captureDepth++
    try { await this.dispatch(line) } finally {
      this.sinks.splice(this.sinks.indexOf(sink), 1)
      this.captureDepth--
    }
    return sink.lines.join('\n')
  }

  /** Every command, for lookup. */
  commandList(): readonly Command[] { return COMMANDS }

  /** Starts in the main channel; stays at the root if the API can't be reached
   *  (the first command will say why). */
  async goHome(): Promise<void> {
    try { this.cwd = await homeCwd() } catch { this.cwd = FILES_ROOT }
  }

  prompt(): string {
    const user = getToken() ? loadConfig().user?.name ?? 'user' : 'guest'
    return `${color.green(`${user}@unreleased`)}:${color.blue(filesPathString(this.cwd))}$ `
  }

  print(text: string, tone: Tone = 'plain'): void {
    if (tone === 'error') this.errors++
    const sink = this.sinks[this.sinks.length - 1]
    // Errors skip a pipe and go straight to the screen, like stderr (watch
    // keeps them: they're part of what it shows).
    if (sink && (tone !== 'error' || sink.keepErrors)) sink.lines.push(...text.split('\n'))
    else writeTone(text, tone)
  }

  /** A progress note ("loading…"): straight to stderr, never into a pipe or
   *  a one-shot command's stdout - and not at all over a full screen. */
  status(text: string): void {
    if (this.captureDepth > 0 || screenActive()) return
    process.stderr.write(color.errDim(text) + '\n')
  }

  /** Ctrl+C: cancels whatever is running (a script and the line inside it). */
  abort(): void {
    for (const c of this.controllers) c.abort()
  }

  /** One typed line: `!` expansion, history, then the command. Resolves false
   *  when it printed an error. */
  async run(raw: string): Promise<boolean> {
    let line = raw.trim()
    if (!line) return true
    if (line.startsWith('!')) {
      const expanded = this.expandBang(line)
      if (expanded === null) { this.print(`${line}: event not found`, 'error'); return false }
      line = expanded
      this.print(line, 'dim')
    }
    // Like a shell's ignorespace: a line typed with a leading space isn't kept.
    if (!raw.startsWith(' ')) this.pushHistory(line)
    return this.execLine(line)
  }

  /** Runs a line without recording it (scripts, rc). */
  async execLine(line: string): Promise<boolean> {
    const before = this.errors
    await this.dispatch(line)
    return this.errors === before
  }

  private pushHistory(line: string): void {
    if (this.history[this.history.length - 1] === line) return
    this.history.push(line)
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX)
    if (this.persistHistory) saveHistory(this.history)
  }

  private expandBang(line: string): string | null {
    const m = /^!(!|\d+|\S.*)$/.exec(line)
    if (!m) return line
    const past = this.history
    if (m[1] === '!') return past[past.length - 1] ?? null
    if (/^\d+$/.test(m[1])) return past[Number(m[1]) - 1] ?? null
    return [...past].reverse().find((h) => h.startsWith(m[1])) ?? null
  }

  // Aliases and pipes, then the plain command.
  private async dispatch(line: string): Promise<void> {
    const first = line.split(/\s+/)[0]
    const aliased = this.aliases[first] !== undefined && first !== 'alias' && first !== 'unalias' ? `${this.aliases[first]}${line.slice(first.length)}` : line
    const { cmd, filters } = splitPipes(aliased)
    if (filters.length === 0) { await this.execute(cmd); return }

    const sink = { lines: [] as string[] }
    this.sinks.push(sink)
    try { await this.execute(cmd) } finally { this.sinks.pop() }
    try {
      const out = filters.reduce((lines, f) => applyFilter(lines, f), sink.lines)
      this.print(out.length > 0 ? out.join('\n') : '(no output)', out.length > 0 ? 'plain' : 'dim')
    } catch (err) { this.print((err as Error).message, 'error') }
  }

  private async execute(line: string): Promise<void> {
    const [word, ...rest] = line.split(/\s+/)
    const command = findCommand(word)
    if (!command) {
      const maybe = this.suggest(word)
      this.print(`${word}: command not found${maybe.length ? ` - did you mean ${maybe.join(', ')}?` : ' (try help)'}`, 'error')
      return
    }
    const controller = new AbortController()
    this.controllers.push(controller)
    setActiveSignal(controller.signal)
    try {
      await command.run(rest.join(' '), this)
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) this.print('cancelled', 'error')
      else this.print(describeError(err), 'error')
    } finally {
      this.controllers.pop()
      setActiveSignal(this.controllers[this.controllers.length - 1]?.signal)
    }
  }

  private suggest(word: string): string[] {
    const w = word.toLowerCase().replace(/^\//, '')
    if (!w) return []
    return [...new Set([...commandNames(), ...Object.keys(this.aliases)])]
      .map((n) => ({ n, d: editDistance(w, n) + (n.startsWith(w) ? -2 : 0) }))
      .filter((x) => x.d <= (w.length <= 3 ? 1 : 2))
      .sort((a, b) => a.d - b.d || a.n.length - b.n.length)
      .slice(0, 3)
      .map((x) => x.n)
  }

  /** `source [-y] [-k] <file>`: without -y it only shows what would run, since
   *  the file could be anyone's and every line runs as you. */
  async source(arg: string): Promise<void> {
    if (this.scriptDepth > 0) fail('source: a script can’t start another script')
    let rest = arg.trim()
    let go = false
    let keepGoing = false
    for (let m = /^-([yk]+)(?:\s+|$)/.exec(rest); m; m = /^-([yk]+)(?:\s+|$)/.exec(rest)) {
      if (m[1].includes('y')) go = true
      if (m[1].includes('k')) keepGoing = true
      rest = rest.slice(m[0].length)
    }
    if (!rest) fail('usage: source [-y] [-k] <file>')
    const file = await readTextFile(this.cwd, rest, 'source')
    if (!file) fail(`source: ${unquote(rest)}: no such file`)
    const lines = file!.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (lines.length === 0) { this.print('source: nothing to run', 'dim'); return }
    if (lines.length > 200) fail(`source: ${lines.length} commands is too many (limit 200)`)
    const plural = lines.length === 1 ? '' : 's'
    if (!go) {
      this.print([`${file!.name} would run ${lines.length} command${plural}:`, ...lines.map((l, i) => `${String(i + 1).padStart(4)}  ${l}`), '', `Read it first - these run as you. To run it: source -y ${rest}`].join('\n'))
      return
    }
    this.scriptDepth++
    try {
      for (let i = 0; i < lines.length; i++) {
        this.print(`${color.dim('+')} ${lines[i]}`, 'dim')
        const ok = await this.execLine(lines[i])
        if (this.exiting) return
        if (!ok && (!keepGoing || this.controllers[0]?.signal.aborted)) fail(`source: stopped at line ${i + 1} (${i} of ${lines.length} ran${keepGoing ? '' : '; add -k to keep going'})`)
      }
      this.print(`source: ran ${lines.length} command${plural}`, 'ok')
    } finally { this.scriptDepth-- }
  }

  /** Tab: command names for the first word, folder/file names after a command
   *  that takes a path. Returns readline's [candidates, text being completed]. */
  async complete(line: string): Promise<[string[], string]> {
    const m = /^(\s*)(\S*)(\s+)?([\s\S]*)$/.exec(line)
    if (!m) return [[], line]
    if (!m[3]) {
      const typed = m[2]
      const w = typed.replace(/^\//, '').toLowerCase()
      const names = [...new Set([...commandNames(), ...Object.keys(this.aliases)])].sort()
      return [names.filter((n) => n.startsWith(w)).map((n) => (typed.startsWith('/') ? `/${n}` : n)), typed]
    }
    const command = findCommand(m[2])
    if (command?.complete) {
      try { return [await command.complete(m[4], this), m[4]] } catch { return [[], m[4]] }
    }
    if (!command?.path) return [[], line]
    // Flags before the path (`tree -L 3 `, `get -f `) aren't part of it.
    const arg = m[4].replace(/^(?:-\S+\s+(?:\d+\s+)?)*/, '')
    const { dirPart, prefix } = splitTyped(arg)
    let entries
    try {
      entries = await listDir(await resolveDir(this.cwd, dirPart))
    } catch { return [[], arg] }
    const usable = entries.filter((e) => command.path === 'any' || e.type === 'directory')
    // Exact-case first; otherwise case-insensitive (paths resolve either way).
    const exact = usable.filter((e) => e.name.startsWith(prefix))
    const hits = exact.length ? exact : usable.filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
    return [hits.map((e) => `${dirPart}${e.name}${e.type === 'directory' ? '/' : ''}`), arg]
  }
}
