import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { CHAT_COMMANDS } from '../../lib/chatCommands'
import { findChatCommand } from '../../lib/chatHelp'
import { cowsayText, directory, findTermCommand, resolveHandles, TERM_COMMAND_WORDS, TERM_COMMANDS, TERM_GROUPS, type TermCommand, type TermScreen } from '../../lib/terminal'
import { termThemeVars, useTermTheme } from '../../lib/terminal/themeStore'
import { catFile, diskUsage, grepFiles, headTailFile, locateName, treeView, wcFile } from '../../lib/terminalFileTools'
import { commandCardText } from '../../lib/commandCardText'
import { encodeSongShare, type LocalNoticePayload } from '../../lib/chatShare'
import { defaultFilesCwd, downloadPath, FILES_ROOT, filesPathString, formatListing, listDir, openTextFile, resolveDir, splitTyped, unquote, type FilesCwd } from '../../lib/terminalFiles'
import { getTerminalRunner, type TerminalSearchResult, type TerminalSink } from '../../lib/chatTerminalBridge'
import { conversationTitle, roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
import { useRoomPeople } from './people'
import { errorText } from './ui'
import NanoEditor from './NanoEditor'
import TerminalScreen from './TerminalScreens'

type NewEntry =
  | { kind: 'cmd'; prompt: { user: string; path: string }; text: string }
  | { kind: 'out'; text: string; tone: 'error' | 'ok' | 'plain' | 'dim' }
type Entry = NewEntry & { id: number }

interface Session { entries: Entry[]; history: string[]; search: TerminalSearchResult[] }

// Scrollback and command history live outside the component so closing the
// terminal (or `cd`-ing to another room and back) doesn't wipe the session.
// One session per room, like a shell per working directory.
const sessions = new Map<string, Session>()
const MAX_ENTRIES = 400
let nextEntryId = 1

function sessionFor(key: string): Session {
  let s = sessions.get(key)
  if (!s) { s = { entries: [], history: [], search: [] }; sessions.set(key, s) }
  return s
}

// Where the shell is standing. In `chat` mode cd moves between rooms (which is
// where chat commands run); in `files` mode it walks the Files tab's tree and
// `get` downloads from it. Chat commands work in both. Kept at module level so
// the position survives closing the terminal.
const shell: { mode: 'chat' | 'files'; cwd: FilesCwd; prevRoom: RoomRef | null } = { mode: 'chat', cwd: FILES_ROOT, prevRoom: null }

const BUILTINS = ['cd', 'ls', 'get', 'nano', 'cat', 'head', 'tail', 'wc', 'grep', 'locate', 'tree', 'du', 'source', 'pwd', 'whoami', 'clear', 'exit', 'alias', 'unalias', 'man']
// The ones that take a path in the file tree (Tab walks the folders); the
// directory-only ones skip files.
const PATH_WORDS = new Set(['cd', 'ls', 'get', 'nano', 'cat', 'head', 'tail', 'wc', 'tree', 'du', 'source'])
const DIR_ONLY_WORDS = new Set(['cd', 'ls', 'tree', 'du'])
const COMPLETIONS = [...new Set([
  ...CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
  ...BUILTINS,
  ...TERM_COMMAND_WORDS,
])].sort()

// History is shared by every room and kept across restarts, like a shell's;
// aliases are the user's own shortcuts (`alias np5='np -h 5'`).
const HISTORY_KEY = 'terminal:history'
const ALIAS_KEY = 'terminal:aliases'
const HISTORY_MAX = 300

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function saveJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode etc. - the session still works */ }
}

const HISTORY: string[] = loadJson<unknown[]>(HISTORY_KEY, []).filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX)
const ALIASES: Record<string, string> = loadJson<Record<string, string>>(ALIAS_KEY, {})

function pushHistory(line: string): void {
  if (HISTORY[HISTORY.length - 1] === line) return
  HISTORY.push(line)
  if (HISTORY.length > HISTORY_MAX) HISTORY.splice(0, HISTORY.length - HISTORY_MAX)
  // Kept in memory for the arrow keys and !!, but message text isn't written to disk.
  if (/^\/?(say|dm|feedback)\b/i.test(line)) return
  saveJson(HISTORY_KEY, HISTORY)
}

// `!!` (last command), `!N` (by number in `history`), `!text` (last one that
// starts with text) - same as a shell. Null when nothing matches.
function expandBang(line: string): string | null {
  const m = /^!(!|\d+|\S.*)$/.exec(line)
  if (!m) return line
  const past = HISTORY
  if (m[1] === '!') return past[past.length - 1] ?? null
  if (/^\d+$/.test(m[1])) return past[Number(m[1]) - 1] ?? null
  return [...past].reverse().find((h) => h.startsWith(m[1])) ?? null
}

// `cmd | grep text | head 5`: output filters for any command. Only recognised
// when every part after a pipe is one of these, so a message that happens to
// contain " | " is left alone.
const FILTERS = new Set(['grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'cowsay'])

function splitPipes(line: string): { cmd: string; filters: string[] } {
  const parts = line.split(/\s+\|\s+/)
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
    case 'cowsay': return cowsayText(lines.join(' ')).split('\n')
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

function suggest(word: string): string[] {
  const w = word.toLowerCase().replace(/^\//, '')
  if (!w) return []
  const names = [...new Set([...COMPLETIONS, ...Object.keys(ALIASES)])]
  return names
    .map((n) => ({ n, d: editDistance(w, n) + (n.startsWith(w) ? -2 : 0) }))
    .filter((x) => x.d <= (w.length <= 3 ? 1 : 2))
    .sort((a, b) => a.d - b.d || a.n.length - b.n.length)
    .slice(0, 3)
    .map((x) => x.n)
}

const slug = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '-')

// The card payloads a command hands back, as the plain text a console would
// print. commandCardText already writes them as markdown for `-s`, so strip the
// markup; help gets its own layout so long usages read as a list, not a wall.
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^- /gm, '  ')
}

const SHELL_NAMES = ['cd', 'ls', 'get', 'nano', 'cat', 'head', 'tail', 'wc', 'grep', 'locate', 'tree', 'du', 'source', 'pwd', 'whoami', 'clear', 'exit']

// `help` alone is an index (there are a lot of commands now); `help <group>`
// lists one group in full and `help <command>` explains one.
function helpText(): string {
  const chat = CHAT_COMMANDS.filter((c) => c.name !== 'help').map((c) => c.name).join('  ')
  const groups = TERM_GROUPS
    .map((g) => ({ g, names: TERM_COMMANDS.filter((c) => c.group === g).map((c) => c.name) }))
    .filter((x) => x.names.length > 0)
  const width = Math.max(...groups.map((x) => x.g.length), 'Chat'.length, 'Shell'.length) + 2
  const row = (label: string, names: string): string => `  ${label.padEnd(width)}${names}`
  return [
    'Commands (the slash is optional here):',
    row('Chat', chat),
    ...groups.map((x) => row(x.g, x.names.join('  '))),
    row('Shell', SHELL_NAMES.join('  ')),
    '',
    'help <command> explains one · help <group> lists a group in full (chat, people, player, library, navigation, settings, admin, app, fun, shell)',
    'Tab completes names and arguments · ↑ ↓ history · Ctrl+R search history · Ctrl+L clear · Ctrl+C cancel line',
    'cmd | grep text · cmd | head 5 · fortune | cowsay · click a → hint to put it on the prompt',
  ].join('\n')
}

function groupHelp(word: string): string | null {
  const w = word.trim().toLowerCase()
  const entry = (usage: string, description: string): string => `  ${usage}\n      ${description}`
  if (w === 'chat') return ['Chat commands (the slash is optional here):', ...CHAT_COMMANDS.filter((c) => c.name !== 'help').map((c) => entry(c.usage, c.description))].join('\n')
  if (w === 'shell') return ['Shell:', ...SHELL_NAMES.map((n) => BUILTIN_HELP[n] ?? n)].join('\n')
  const group = TERM_GROUPS.find((g) => g.toLowerCase() === w)
  if (!group) return null
  return [`${group}:`, ...TERM_COMMANDS.filter((c) => c.group === group).map((c) => entry(c.usage, c.description))].join('\n')
}

const BUILTIN_HELP: Record<string, string> = {
  cd: 'cd <channel | server/channel | @dm>\n      Switch the room commands run in. Tab completes names.\ncd files\n      Browse the Files tab. Inside it: cd <folder>, cd .., cd / (channels), cd ~ (back to chat).',
  ls: 'ls [folder]\n      List the channels in this server, or your DMs. In the file tree, list a folder (size, name).',
  get: 'get <file | folder | *>\n      In the file tree: download a file, a folder as a ZIP (structure kept), or * for the whole current folder.',
  nano: 'nano [file]\n      Open a text editor. In the file tree it loads that file (read-only on the server); ^O saves your edited copy to your computer, ^X exits, ^G lists the keys.',
  cat: 'cat <file>\n      File tree: print a text file.',
  head: 'head [-n N] <file>\n      File tree: the first lines of a text file (10 by default).',
  tail: 'tail [-n N] <file>\n      File tree: the last lines of a text file. (Outside the tree, tail is the message log.)',
  wc: 'wc <file>\n      File tree: lines, words and bytes of a text file. (After a pipe, wc counts lines.)',
  grep: 'grep [-s] [-r] [-l] <text> [folder | file]\n      File tree: search inside text files (current folder; -r goes into subfolders, -s is case-sensitive, -l lists names). After a pipe it filters output instead.',
  locate: 'locate <name> [folder]\n      File tree: find files and folders by name under here. * and ? are wildcards.',
  tree: 'tree [-L depth] [folder]\n      File tree: an indented tree of a folder (two levels by default).',
  du: 'du [folder]\n      File tree: how much is in each subfolder, and in total.',
  source: 'source [-y] [-k] <file>\n      File tree: run the commands in a text file, one per line (# comments and blank lines are skipped). Without -y it only lists what would run; -k keeps going after an error.',
  pwd: 'pwd\n      Show which room commands run in.',
  whoami: 'whoami\n      Show who you are signed in as.',
  clear: 'clear\n      Wipe the screen (Ctrl+L).',
  exit: 'exit\n      Close the terminal (Ctrl+D on an empty line).',
}

// `help <command>`: just that command, found by name or alias ("commit" is
// /changelog). Null when nothing by that name exists.
function commandHelp(word: string): string | null {
  const name = word.replace(/^\//, '').toLowerCase()
  if (BUILTIN_HELP[name]) return BUILTIN_HELP[name]
  const grouped = groupHelp(name)
  if (grouped) return grouped
  const term = findTermCommand(name)
  if (term) {
    const termAliases = term.aliases?.length ? `\n      aliases: ${term.aliases.join(', ')}` : ''
    return `${term.usage}\n      ${term.description}${termAliases}`
  }
  const info = findChatCommand(name)
  if (!info) return null
  const aliases = info.aliases?.length ? `\n      aliases: ${info.aliases.map((a) => `/${a}`).join(', ')}` : ''
  return `${info.usage}\n      ${info.description}${aliases}`
}

function noticeText(payload: LocalNoticePayload): string {
  if (payload.kind === 'feedbackSent') return `Feedback sent: ${payload.message}`
  return stripMarkdown(commandCardText(payload) ?? '')
}

const LINK = 'underline decoration-dotted underline-offset-2 cursor-pointer hover:text-[color:var(--t-accent)]'

// Output a command wrote as "... → user bob", or that mentions @someone: the
// command (or the handle) is a button that puts it on the prompt. It never runs
// it - clicking is only a shortcut for typing.
function linkLine(line: string, onPick: (command: string) => void): JSX.Element | string {
  const arrow = /^(.*→ )(\S.*)$/.exec(line)
  if (arrow) {
    const command = arrow[2]
    return <>{arrow[1]}<button type="button" className={LINK} title="Put this on the prompt" onClick={() => onPick(command)}>{command}</button></>
  }
  const parts: (string | JSX.Element)[] = []
  const handles = /(^|\s)(@[\w.-]{2,})/g
  let last = 0
  for (let m = handles.exec(line); m; m = handles.exec(line)) {
    const start = m.index + m[1].length
    const handle = m[2]
    parts.push(line.slice(last, start))
    parts.push(<button key={start} type="button" className={LINK} title="Put user lookup on the prompt" onClick={() => onPick(`user ${handle.slice(1)}`)}>{handle}</button>)
    last = start + handle.length
  }
  if (parts.length === 0) return line
  parts.push(line.slice(last))
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>
}

function LinkedText({ text, onPick }: { text: string; onPick: (command: string) => void }): JSX.Element {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {linkLine(line, onPick)}
        </Fragment>
      ))}
    </>
  )
}

const MONO ="'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', ui-monospace, monospace"

// A Linux-style console for platform administrators. It does not reimplement
// any chat command: input goes to the same runner the composer uses (see
// chatTerminalBridge), so every command, flag, alias and permission check
// behaves identically - only the output is printed here instead of shown as
// toasts and cards in the room. Text that isn't a command is rejected rather
// than posted, so nothing is ever sent by accident. It sits over the whole chat
// view (the room underneath stays mounted - that's where the commands run).
export default function TerminalPanel({ room, onClose }: { room: RoomRef; onClose: () => void }): JSX.Element | null {
  const me = useChatStore((s) => s.me)
  const chatPath = useChatStore((s) => {
    // The terminal page can run with no room open (id 0 stands in for it).
    if (room.kind === 'channel' && room.id === 0) return '~'
    if (room.kind === 'channel') {
      const server = s.servers.find((x) => x.channels.some((c) => c.id === room.id))
      const channel = server?.channels.find((c) => c.id === room.id)
      return `~/${slug(server?.name ?? 'server')}/${slug(channel?.name ?? 'channel')}`
    }
    const conv = s.conversations.find((c) => c.id === room.id)
    return `~/dm/${slug(conv ? conversationTitle(conv, s.meId) : 'chat')}`
  })
  const path = shell.mode === 'files' ? filesPathString(shell.cwd) : chatPath
  const people = useRoomPeople(room)
  const key = roomKey(room)
  const session = sessionFor(key)
  const [, bump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [caret, setCaret] = useState(0)
  const [editor, setEditor] = useState<{ name: string; text: string; existed: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [screen, setScreen] = useState<TermScreen | null>(null)
  // Ctrl+R: the line as it was, and which history entry the query has reached.
  const [rs, setRs] = useState<{ saved: string; at: number } | null>(null)
  const theme = useTermTheme()
  const historyIndex = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const user = me?.username ?? 'admin'

  const push = useCallback((entry: NewEntry): void => {
    const s = sessionFor(key)
    s.entries = [...s.entries, { ...entry, id: nextEntryId++ }].slice(-MAX_ENTRIES)
    bump((n) => n + 1)
  }, [key])
  // While a piped command runs, its output is collected here instead of shown,
  // so the filters after the pipe can work on it. Errors always show - except
  // under `watch`, whose screen is the only place its output can go.
  const capture = useRef<{ lines: string[]; keepErrors: boolean } | null>(null)
  // Error lines printed so far, so a script can tell that a line failed.
  const errorCount = useRef(0)
  // Non-zero while a script or a `watch` is running commands: the interactive
  // ones (nano, screens, moving to another room) refuse then.
  const locked = useRef(0)
  const print = useCallback((text: string, tone: 'error' | 'ok' | 'plain' | 'dim' = 'plain'): void => {
    if (tone === 'error') errorCount.current += 1
    const cap = capture.current
    if (cap && (tone !== 'error' || cap.keepErrors)) { cap.lines.push(...text.split('\n')); return }
    push({ kind: 'out', text, tone })
  }, [push])
  // The watch screen re-runs its command on a timer, so it gets a function whose
  // identity never changes and that always calls the latest render's runner.
  const runCaptured = useRef<(line: string) => Promise<string>>(async () => '')
  const watchRun = useCallback((line: string) => runCaptured.current(line), [])

  useEffect(() => { field.current?.focus() }, [key])
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.entries.length, busy, input])

  const sink = useMemo<TerminalSink>(() => ({
    toast: (text, tone = 'error') => print(text, tone),
    notice: (payload) => print(noticeText(payload)),
    pickSearch: (query, results) => {
      sessionFor(key).search = results
      print(`${results.length} results for "${query}":\n${results.map((r, i) => `${String(i + 1).padStart(3)}  ${r.name}  (${r.detail})`).join('\n')}\nType a number to post that song to the room.`)
    },
  }), [key, print])

  if (me?.role !== 'administrator') return null

  const setLine = (value: string): void => { setInput(value); setCaret(value.length) }
  const clear = (): void => { sessionFor(key).entries = []; bump((n) => n + 1) }

  const changeRoom = (arg: string): void => {
    const target = arg.replace(/^[#@]/, '').replace(/^\.\//, '').trim()
    if (!target) { print('usage: cd <channel | server/channel | @dm>', 'error'); return }
    if (locked.current > 0) { print('cd: can’t change rooms inside a script or watch', 'error'); return }
    const cs = useChatStore.getState()
    const norm = slug(target)
    const [serverPart, channelPart] = norm.includes('/') ? norm.split('/', 2) : [null, norm]
    const inServer = cs.servers.filter((x) => (serverPart ? slug(x.name) === serverPart : true))
    const here = serverPart ? [] : inServer.filter((x) => x.id === cs.activeServerId)
    const pool = [...here, ...inServer.filter((x) => !here.includes(x))]
    for (const server of pool) {
      const channel = server.channels.find((c) => slug(c.name) === channelPart || slug(c.name) === slug(channelPart.replace(/^#/, '')))
      if (channel) { shell.prevRoom = room; cs.openRoom({ kind: 'channel', id: channel.id }); return }
    }
    const conv = cs.conversations.find((c) => slug(conversationTitle(c, cs.meId)) === norm.replace(/^dm\//, ''))
    if (conv) { shell.prevRoom = room; cs.openRoom({ kind: 'conversation', id: conv.id }); return }
    print(`cd: ${arg}: no such room`, 'error')
  }

  const listRooms = (): void => {
    const cs = useChatStore.getState()
    const server = cs.activeServerId !== null ? cs.servers.find((x) => x.id === cs.activeServerId) : null
    const names = server
      ? server.channels.map((c) => `${slug(c.name)}${c.is_private ? '*' : ''}`)
      : cs.conversations.map((c) => `@${slug(conversationTitle(c, cs.meId))}`)
    print(names.length ? names.join('  ') : '(empty)', names.length ? 'plain' : 'dim')
  }

  const enterFiles = async (sub: string): Promise<boolean> => {
    let cwd = await defaultFilesCwd()
    if (sub) cwd = await resolveDir(cwd, sub)
    shell.mode = 'files'
    shell.cwd = cwd
    bump((n) => n + 1)
    return true
  }

  const changeDir = (arg: string): boolean | Promise<boolean> => {
    const target = unquote(arg)
    if (shell.mode === 'chat') {
      const files = /^(?:~\/|\/)?files(?:\/(.*))?$/i.exec(target)
      if (files) return enterFiles(files[1] ?? '')
      if (target === '-') {
        const back = shell.prevRoom
        if (locked.current > 0) { print('cd: can’t change rooms inside a script or watch', 'error'); return true }
        if (!back) { print('cd: no previous room', 'error'); return true }
        shell.prevRoom = room
        useChatStore.getState().openRoom(back)
        return true
      }
      changeRoom(arg)
      return true
    }
    // In the file tree `~` is home: back to chat (and a #channel / @dm goes
    // straight to that room).
    if (target === '~' || /^\/?chat\/?$/i.test(target) || /^[#@]/.test(target)) {
      shell.mode = 'chat'
      bump((n) => n + 1)
      if (/^[#@]/.test(target)) changeRoom(arg)
      return true
    }
    return resolveDir(shell.cwd, target || '/').then((cwd) => { shell.cwd = cwd; bump((n) => n + 1); return true })
  }

  const listFiles = async (arg: string): Promise<boolean> => {
    const dir = arg ? await resolveDir(shell.cwd, arg) : shell.cwd
    print(formatListing(await listDir(dir, true), dir), 'plain')
    return true
  }

  const currentPath = (): string => (shell.mode === 'files' ? filesPathString(shell.cwd) : chatPath)

  const openScreen = (next: TermScreen): void => {
    if (locked.current > 0) throw new Error('not available inside a script or watch')
    setScreen(next)
  }

  // Output of a command that has to land somewhere other than the scrollback.
  // Nested captures (a pipe inside a watch) keep the outer one's error handling.
  const withCapture = async (fn: () => Promise<void>, keepErrors: boolean): Promise<string[]> => {
    const prev = capture.current
    const mine = { lines: [] as string[], keepErrors: keepErrors || (prev?.keepErrors ?? false) }
    capture.current = mine
    try { await fn() } finally { capture.current = prev }
    return mine.lines
  }

  // Runs one line as if typed (echoed, aliases and pipes included) and says
  // whether it got through without printing an error. Used by `source`.
  const execLine = async (line: string): Promise<boolean> => {
    push({ kind: 'cmd', prompt: { user, path: currentPath() }, text: line })
    const before = errorCount.current
    await dispatch(line)
    return errorCount.current === before
  }

  const runTerm = (command: TermCommand, arg: string): Promise<boolean> =>
    Promise.resolve()
      .then(() => command.run(arg, { print, history: () => HISTORY, room, people, screen: openScreen, exec: execLine, scripted: locked.current > 0 }))
      .then(() => true)

  // `source [-y] [-k] <file>`: without -y it only shows what would run, since
  // the file could be anyone's and every line runs with admin rights.
  const runSource = async (arg: string): Promise<boolean> => {
    if (locked.current > 0) { print('source: a script can’t start another script', 'error'); return true }
    let rest = arg.trim()
    let go = false
    let keepGoing = false
    for (let m = /^-([yk]+)(?:\s+|$)/.exec(rest); m; m = /^-([yk]+)(?:\s+|$)/.exec(rest)) {
      if (m[1].includes('y')) go = true
      if (m[1].includes('k')) keepGoing = true
      rest = rest.slice(m[0].length)
    }
    if (!rest) { print('usage: source [-y] [-k] <file>', 'error'); return true }
    if (shell.mode !== 'files') { print('source: only works in the file tree (try: cd files)', 'error'); return true }
    const file = await openTextFile(shell.cwd, rest)
    if (!file.existed) { print(`source: ${unquote(rest)}: no such file`, 'error'); return true }
    const lines = file.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (lines.length === 0) { print('source: nothing to run', 'dim'); return true }
    if (lines.length > 200) { print(`source: ${lines.length} commands is too many (limit 200)`, 'error'); return true }
    const plural = lines.length === 1 ? '' : 's'
    if (!go) {
      print([`${file.name} would run ${lines.length} command${plural}:`, ...lines.map((l, i) => `${String(i + 1).padStart(4)}  ${l}`), '', `Read it first - these run with your admin rights. To run it: source -y ${rest}`].join('\n'))
      return true
    }
    locked.current += 1
    try {
      for (let i = 0; i < lines.length; i++) {
        if (!(await execLine(lines[i])) && !keepGoing) {
          print(`source: stopped at line ${i + 1} (${i} of ${lines.length} ran; add -k to keep going)`, 'error')
          return true
        }
      }
      print(`source: ran ${lines.length} command${plural}`, 'ok')
    } finally { locked.current -= 1 }
    return true
  }

  // The file tools print a block of text; this runs one and prints it.
  const printed = (job: Promise<string>): Promise<boolean> => job.then((text) => { print(text); return true })

  // Shell-ish commands that never leave this panel. A promise means it needs the
  // network (the file tree); false means "not mine, hand it to the chat runner".
  const builtin = (line: string): boolean | Promise<boolean> => {
    const [word, ...rest] = line.split(/\s+/)
    const arg = rest.join(' ')
    switch (word.toLowerCase()) {
      case 'clear': case 'cls': clear(); return true
      case 'exit': case 'quit': onClose(); return true
      case 'cat': case 'head': case 'tail': case 'wc': case 'grep': {
        const name = word.toLowerCase()
        // Outside the file tree these have other meanings: `tail` is the message
        // log, and head/wc/grep filter another command's output after a pipe.
        const logLike = name === 'tail' && (shell.mode !== 'files' || /^(\d+)?(\s+@\S+)?$/.test(arg.trim()))
        if (logLike) { const log = findTermCommand('tail'); return log ? runTerm(log, arg) : false }
        if (shell.mode !== 'files') {
          print(`${name}: only works in the file tree (try: cd files)${name === 'cat' ? '' : `; to filter output use: command | ${name} ...`}`, 'error')
          return true
        }
        if (name === 'cat') return printed(catFile(shell.cwd, arg))
        if (name === 'wc') return printed(wcFile(shell.cwd, arg))
        if (name === 'grep') return printed(grepFiles(shell.cwd, arg))
        return printed(headTailFile(name as 'head' | 'tail', shell.cwd, arg))
      }
      case 'locate': case 'tree': case 'du': {
        const name = word.toLowerCase()
        if (shell.mode !== 'files') { print(`${name}: only works in the file tree (try: cd files)`, 'error'); return true }
        return printed(name === 'locate' ? locateName(shell.cwd, arg) : name === 'tree' ? treeView(shell.cwd, arg) : diskUsage(shell.cwd, arg))
      }
      case 'source': case '.': return runSource(arg)
      case 'nano': case 'pico': {
        if (locked.current > 0) { print('nano: not available inside a script or watch', 'error'); return true }
        const cwd = shell.mode === 'files' ? shell.cwd : FILES_ROOT
        if (!arg.trim()) { setEditor({ name: '', text: '', existed: true }); return true }
        return openTextFile(cwd, arg).then((file) => { setEditor(file); return true })
      }
      case 'pwd': print(path); return true
      case 'whoami': print(`${user}   id ${me?.id ?? '?'} · ${me?.role ?? 'user'}`); return true
      case 'man': return builtin(arg ? `help ${arg}` : 'help')
      case 'alias': {
        const m = /^([\w.-]+)\s*=\s*([\s\S]+)$/.exec(arg.trim())
        if (!arg.trim()) { print(Object.keys(ALIASES).length ? Object.entries(ALIASES).map(([k, v]) => `alias ${k}='${v}'`).join('\n') : 'no aliases (alias name=command…)', Object.keys(ALIASES).length ? 'plain' : 'dim'); return true }
        if (!m) {
          const one = ALIASES[arg.trim()]
          if (one) print(`alias ${arg.trim()}='${one}'`)
          else print(`alias: ${arg.trim()}: not found (usage: alias name=command…)`, 'error')
          return true
        }
        if (['alias', 'unalias'].includes(m[1])) { print(`alias: can't alias ${m[1]}`, 'error'); return true }
        ALIASES[m[1]] = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
        saveJson(ALIAS_KEY, ALIASES)
        print(`alias ${m[1]}='${ALIASES[m[1]]}'`, 'ok')
        return true
      }
      case 'unalias': {
        if (!ALIASES[arg.trim()]) { print(`unalias: ${arg.trim() || '?'}: not found`, 'error'); return true }
        delete ALIASES[arg.trim()]
        saveJson(ALIAS_KEY, ALIASES)
        print(`removed alias ${arg.trim()}`, 'ok')
        return true
      }
      case 'ls': case 'dir':
        if (shell.mode === 'files') return listFiles(arg)
        listRooms()
        return true
      case 'cd': return changeDir(arg)
      case 'get': case 'download': case 'dl': {
        if (shell.mode !== 'files') { print('get: only works in the file tree (try: cd files)', 'error'); return true }
        return downloadPath(shell.cwd, arg).then((r) => { print(r.message, r.message === 'cancelled' ? 'dim' : 'ok'); return true })
      }
      case 'help': case '/help': {
        // -s means "post the full list to the room", which only the real
        // command does; anything else after help names a command to look up.
        const topic = rest.filter((t) => !/^(-s|--share)$/i.test(t))[0]
        if (!topic && rest.length > 0) return false
        if (!topic) { print(helpText()); return true }
        const text = commandHelp(topic)
        if (text) print(text)
        else print(`help: no help for "${topic}"`, 'error')
        return true
      }
      default: {
        const term = findTermCommand(word)
        return term ? runTerm(term, arg) : false
      }
    }
  }

  // The front half of a command line: history, `!` expansion, aliases and
  // pipes. execute() below runs the resulting plain command.
  const run = async (raw: string): Promise<void> => {
    let line = raw.trim()
    if (!line) { push({ kind: 'cmd', prompt: { user, path }, text: '' }); return }
    historyIndex.current = null
    setLine('')
    setDraft('')

    if (line.startsWith('!')) {
      const expanded = expandBang(line)
      if (expanded === null) { push({ kind: 'cmd', prompt: { user, path }, text: line }); print(`${line}: event not found`, 'error'); return }
      line = expanded
    }
    pushHistory(line)

    // `clear` leaves nothing behind, like the real thing.
    if (!/^(clear|cls)$/i.test(line)) push({ kind: 'cmd', prompt: { user, path }, text: line })
    await dispatch(line)
  }

  // Aliases and pipes, then the plain command.
  const dispatch = async (line: string): Promise<void> => {
    const first = line.split(/\s+/)[0]
    const aliased = ALIASES[first] !== undefined && first !== 'alias' && first !== 'unalias' ? `${ALIASES[first]}${line.slice(first.length)}` : line
    const { cmd, filters } = splitPipes(aliased)
    if (filters.length === 0) { await execute(cmd); return }

    const collected = await withCapture(() => execute(cmd), false)
    try {
      const out = filters.reduce((lines, f) => applyFilter(lines, f), collected)
      if (out.length > 0) print(out.join('\n'))
      else print('(no output)', 'dim')
    } catch (err) { print(errorText(err, 'Filter failed'), 'error') }
  }

  // What the watch screen shows: the command's output (errors included) as text.
  runCaptured.current = async (line: string): Promise<string> => {
    locked.current += 1
    try { return (await withCapture(() => dispatch(line), true)).join('\n') || '(no output)' } finally { locked.current -= 1 }
  }

  const execute = async (line: string): Promise<void> => {
    const s = sessionFor(key)
    const handled = builtin(line)
    if (handled !== false) {
      if (typeof handled !== 'boolean') {
        setBusy(true)
        try { await handled } catch (err) { print(errorText(err, 'Command failed'), 'error') } finally {
          setBusy(false)
          requestAnimationFrame(() => field.current?.focus())
        }
      }
      return
    }

    // A bare number after a /search listing picks that result.
    if (/^\d+$/.test(line) && s.search.length > 0) {
      const pick = s.search[Number(line) - 1]
      if (!pick) { print(`pick a number from 1 to ${s.search.length}`, 'error'); return }
      s.search = []
      setBusy(true)
      try {
        await useChatStore.getState().send(room, { text: encodeSongShare(pick.id), files: [] })
        print(`posted "${pick.name}" to the room`, 'ok')
      } catch (err) {
        print(errorText(err, 'Message failed to send'), 'error')
      } finally { setBusy(false) }
      return
    }

    const runner = getTerminalRunner(key)
    if (!runner) { print('room not ready yet - try again in a moment', 'error'); return }
    s.search = []
    setBusy(true)
    try {
      const resolved = await resolveHandles(line, people)
      const handled = await runner(resolved.startsWith('/') ? resolved : `/${resolved}`, sink)
      if (!handled) {
        const word = line.split(/\s+/)[0]
        const maybe = suggest(word)
        print(`${word}: command not found${maybe.length ? ` - did you mean ${maybe.join(', ')}?` : ' (try help)'}`, 'error')
      }
    } catch (err) {
      print(errorText(err, 'Command failed'), 'error')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => field.current?.focus())
    }
  }

  // Tab completion: the command name for the first word; after that, room
  // names for `cd` (channels, or `server/channel` for other servers, plus DMs)
  // and @usernames for any other command. `#` / `@` typed first narrows to
  // channels / DMs, like the prefix does in chat.
  const roomCandidates = (): { name: string; dm: boolean }[] => {
    const cs = useChatStore.getState()
    const out: { name: string; dm: boolean }[] = []
    for (const server of cs.servers) {
      const prefix = server.id === cs.activeServerId ? '' : `${slug(server.name)}/`
      for (const c of server.channels) out.push({ name: `${prefix}${slug(c.name)}`, dm: false })
    }
    for (const c of cs.conversations) out.push({ name: slug(conversationTitle(c, cs.meId)), dm: true })
    out.push({ name: 'files', dm: false })
    return out
  }

  const finishCompletion = (head: string, sigil: string, names: string[], typed: string, space: boolean): void => {
    const lower = typed.toLowerCase()
    const hits = [...new Set(names)].filter((n) => n.toLowerCase().startsWith(lower)).sort()
    if (hits.length === 0) return
    if (hits.length === 1) { setLine(`${head}${sigil}${hits[0]}${space ? ' ' : ''}`); return }
    let prefix = hits[0]
    for (const h of hits) while (!h.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1)
    if (prefix.length > typed.length) setLine(`${head}${sigil}${prefix}`)
    else print(hits.map((h) => `${sigil}${h}`).join('  '), 'dim')
  }

  // Paths in the file tree: the folder part of what's typed is listed, then the
  // rest filters it. Names can hold spaces, so the whole argument counts, not
  // just the last word. Folders get a trailing slash so Tab can keep walking.
  const completeFiles = async (word: string): Promise<void> => {
    const m = /^(\s*\S+\s+)([\s\S]*)$/.exec(input)
    if (!m) return
    const typed = m[2].replace(/^["']/, '')
    const { dirPart, prefix } = splitTyped(typed)
    try {
      const dir = dirPart ? await resolveDir(shell.cwd, dirPart) : shell.cwd
      const names = (await listDir(dir))
        .filter((e) => !DIR_ONLY_WORDS.has(word) || e.type === 'directory')
        .map((e) => e.name + (e.type === 'directory' ? '/' : ''))
      if (field.current?.value !== input) return
      finishCompletion(m[1] + dirPart, '', names, prefix, false)
    } catch { /* a bad folder just means nothing to complete */ }
  }

  const complete = (): void => {
    const first = /^(\/?)(\S*)$/.exec(input)
    if (first) {
      const hits = COMPLETIONS.filter((c) => c.startsWith(first[2].toLowerCase()))
      if (hits.length === 1) setLine(`${first[1]}${hits[0]} `)
      else if (hits.length > 1) {
        // Longest shared prefix first; if that adds nothing, list the options.
        let prefix = hits[0]
        for (const h of hits) while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1)
        if (prefix.length > first[2].length) setLine(`${first[1]}${prefix}`)
        else print(hits.join('  '), 'dim')
      }
      return
    }
    const word = input.trim().split(/\s+/)[0].replace(/^\//, '').toLowerCase()
    const token = /\S*$/.exec(input)?.[0] ?? ''
    const head = input.slice(0, input.length - token.length)
    if (shell.mode === 'files' && PATH_WORDS.has(word) && !/^[#@]/.test(token)) {
      void completeFiles(word)
    } else if (word === 'cd') {
      const sigil = /^[#@]/.exec(token)?.[0] ?? ''
      const pool = roomCandidates().filter((r) => (sigil === '@' ? r.dm : sigil === '#' ? !r.dm : true))
      finishCompletion(head, sigil, pool.map((r) => r.name), token.slice(sigil.length), false)
    } else if (word === 'help' && !token.startsWith('-')) {
      finishCompletion(head, token.startsWith('/') ? '/' : '', COMPLETIONS, token.replace(/^\//, ''), false)
    } else if (findTermCommand(word)?.complete) {
      const command = findTermCommand(word)!
      const tokens = input.slice(input.search(/\s/)).trim().split(/\s+/).filter(Boolean)
      const partial = /\s$/.test(input) ? '' : tokens.pop() ?? ''
      const snapshot = input
      const headText = input.slice(0, input.length - partial.length)
      void Promise.resolve(command.complete!(tokens, partial)).then((names) => {
        if (field.current?.value === snapshot) finishCompletion(headText, '', names, partial, true)
      }).catch(() => undefined)
    } else if (token.startsWith('@')) {
      const snapshot = input
      void directory().then((all) => {
        if (field.current?.value === snapshot) finishCompletion(head, '@', all.map((u) => u.username), token.slice(1), true)
      }).catch(() => finishCompletion(head, '@', people.map((p) => p.username), token.slice(1), true))
    }
  }

  // Ctrl+R: the newest history entry containing the query, searching back from
  // `from`. -1 when nothing matches.
  const findBack = (query: string, from: number): number => {
    const q = query.toLowerCase()
    if (!q) return -1
    for (let i = Math.min(from, HISTORY.length) - 1; i >= 0; i--) if (HISTORY[i].toLowerCase().includes(q)) return i
    return -1
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (rs) {
      const k = e.key.toLowerCase()
      const leave = (value: string): void => { e.preventDefault(); setLine(value); setRs(null) }
      if (e.key === 'Enter') { leave(rs.at >= 0 ? HISTORY[rs.at] : rs.saved); return }
      if (e.key === 'Escape' || (e.ctrlKey && (k === 'c' || k === 'g'))) { leave(rs.saved); return }
      if (e.ctrlKey && k === 'r') {
        e.preventDefault()
        const older = findBack(input, rs.at >= 0 ? rs.at : HISTORY.length)
        if (older >= 0) setRs({ ...rs, at: older })
        return
      }
      // Arrows and Tab take the match to the prompt for editing, like bash.
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { leave(rs.at >= 0 ? HISTORY[rs.at] : rs.saved); return }
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); setRs({ saved: input, at: HISTORY.length }); setInput(''); setCaret(0); return }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) void run(input); return }
    if (e.key === 'Tab') { e.preventDefault(); complete(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); clear(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && field.current?.selectionStart === field.current?.selectionEnd) {
      e.preventDefault()
      push({ kind: 'cmd', prompt: { user, path }, text: `${input}^C` })
      setLine('')
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'd' && !input) { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (HISTORY.length === 0) return
      e.preventDefault()
      if (e.key === 'ArrowUp') {
        if (historyIndex.current === null) { setDraft(input); historyIndex.current = HISTORY.length - 1 }
        else historyIndex.current = Math.max(0, historyIndex.current - 1)
        setLine(HISTORY[historyIndex.current])
      } else if (historyIndex.current !== null) {
        if (historyIndex.current >= HISTORY.length - 1) { historyIndex.current = null; setLine(draft) }
        else { historyIndex.current += 1; setLine(HISTORY[historyIndex.current]) }
      }
    }
  }

  const syncCaret = (): void => setCaret(field.current?.selectionStart ?? input.length)
  const before = input.slice(0, caret)
  const at = input.slice(caret, caret + 1)
  const after = input.slice(caret + 1)

  const promptEl = (p: { user: string; path: string }): JSX.Element => (
    <>
      <span className="font-bold text-[color:var(--t-user)]">{p.user}@unreleased</span>
      <span>:</span>
      <span className="font-bold text-[color:var(--t-path)]">{p.path}</span>
      <span>$ </span>
    </>
  )

  const leaveScreen = (message?: string): void => {
    setScreen(null)
    if (message) print(message, 'ok')
    requestAnimationFrame(() => field.current?.focus())
  }

  return (
    <section
      className="absolute inset-0 z-40 flex flex-col bg-[var(--t-bg)] text-[color:var(--t-fg)]"
      style={{ fontFamily: MONO, ...termThemeVars(theme) }}
      aria-label="Admin terminal"
    >
      <header className="h-9 shrink-0 flex items-center gap-3 px-3 bg-[var(--t-bar)] border-b border-[color:var(--t-border)] text-[11px] text-[color:var(--t-dim)]">
        <span className="flex gap-1.5" aria-hidden>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
        </span>
        <span className="flex-1 min-w-0 truncate text-center">{user}@unreleased: {path}</span>
        <button onClick={onClose} title="Close terminal (exit)" aria-label="Close terminal" className="w-6 h-6 rounded flex items-center justify-center text-[color:var(--t-dim)] hover:text-[color:var(--t-fg)] hover:bg-[var(--t-border)]">
          <X size={14} />
        </button>
      </header>

      {screen ? (
        <TerminalScreen screen={screen} run={watchRun} onExit={leaveScreen} />
      ) : editor ? (
        <NanoEditor
          name={editor.name}
          initial={editor.text}
          existed={editor.existed}
          onClose={(message) => { setEditor(null); if (message) print(message, 'ok'); requestAnimationFrame(() => field.current?.focus()) }}
        />
      ) : (
      <div
        ref={scroller}
        onClick={() => { if (!window.getSelection()?.toString()) field.current?.focus() }}
        className="chat-scroll flex-1 min-h-0 overflow-y-auto px-4 py-3 text-[13px] leading-[1.45] select-text cursor-text"
        role="log"
        aria-live="polite"
      >
        {session.entries.length === 0 && (
          <p className="whitespace-pre-wrap text-[color:var(--t-dim)] mb-2">
            {'Unreleased admin console\nTry: user <name> · lookup <text> · pending · play <song> · open settings · neofetch · help\nTab completes names, users and settings · ↑ / Ctrl+R history · cmd | grep text · !! repeats'}
          </p>
        )}
        {session.entries.map((e) => {
          if (e.kind === 'cmd') {
            return <p key={e.id} className="whitespace-pre-wrap break-all">{promptEl(e.prompt)}{e.text}</p>
          }
          const color = e.tone === 'error' ? 'text-[color:var(--t-err)]' : e.tone === 'ok' ? 'text-[color:var(--t-ok)]' : e.tone === 'dim' ? 'text-[color:var(--t-dim)]' : ''
          return (
            <p key={e.id} className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${color}`}>
              {e.tone === 'error' ? e.text : <LinkedText text={e.text} onPick={(cmd) => { setLine(cmd); field.current?.focus() }} />}
            </p>
          )
        })}

        <div className="relative">
          <p className="whitespace-pre-wrap break-all">
            {rs ? (
              <>
                <span className="text-[color:var(--t-dim)]">(reverse-i-search)`{input}&apos;: </span>
                {rs.at >= 0 ? HISTORY[rs.at] : ''}
                <span className="term-cursor bg-[var(--t-fg)] text-[color:var(--t-bg)]"> </span>
              </>
            ) : (
              <>
                {promptEl({ user, path })}
                {before}
                <span className={`${busy ? '' : 'term-cursor'} bg-[var(--t-fg)] text-[color:var(--t-bg)]`}>{at || ' '}</span>
                {after}
              </>
            )}
          </p>
          <input
            ref={field}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              historyIndex.current = null
              if (rs) setRs({ ...rs, at: findBack(e.target.value, HISTORY.length) })
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onSelect={syncCaret}
            onClick={syncCaret}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            aria-label="Terminal command"
            className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          />
        </div>
      </div>
      )}
      <style>{'@keyframes term-blink{0%,49%{opacity:1}50%,100%{opacity:0}} .term-cursor{animation:term-blink 1.1s steps(1) infinite}'}</style>
    </section>
  )
}
