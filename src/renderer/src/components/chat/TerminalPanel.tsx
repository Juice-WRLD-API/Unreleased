import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { CHAT_COMMANDS } from '../../lib/chatCommands'
import { findChatCommand } from '../../lib/chatHelp'
import { findTermCommand, TERM_COMMAND_WORDS, TERM_COMMANDS, TERM_GROUPS, type TermCommand } from '../../lib/terminal'
import { commandCardText } from '../../lib/commandCardText'
import { encodeSongShare, type LocalNoticePayload } from '../../lib/chatShare'
import { defaultFilesCwd, downloadPath, FILES_ROOT, filesPathString, formatListing, listDir, resolveDir, splitTyped, unquote, type FilesCwd } from '../../lib/terminalFiles'
import { getTerminalRunner, type TerminalSearchResult, type TerminalSink } from '../../lib/chatTerminalBridge'
import { conversationTitle, roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
import { useRoomPeople } from './people'
import { errorText } from './ui'

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
const shell: { mode: 'chat' | 'files'; cwd: FilesCwd } = { mode: 'chat', cwd: FILES_ROOT }

const BUILTINS = ['cd', 'ls', 'get', 'pwd', 'whoami', 'clear', 'exit']
const COMPLETIONS = [...new Set([
  ...CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
  ...BUILTINS,
  ...TERM_COMMAND_WORDS,
])].sort()

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

const SHELL_NAMES = ['cd', 'ls', 'get', 'pwd', 'whoami', 'clear', 'exit']

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
    'help <command> explains one · help <group> lists a group in full (chat, player, library, navigation, settings, admin, app, shell)',
    'Tab completes names and arguments · ↑ ↓ history · Ctrl+L clear · Ctrl+C cancel line',
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

const MONO = "'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', ui-monospace, monospace"

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
  const [draft, setDraft] = useState('')
  const historyIndex = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const user = me?.username ?? 'admin'

  const push = useCallback((entry: NewEntry): void => {
    const s = sessionFor(key)
    s.entries = [...s.entries, { ...entry, id: nextEntryId++ }].slice(-MAX_ENTRIES)
    bump((n) => n + 1)
  }, [key])
  const print = useCallback((text: string, tone: 'error' | 'ok' | 'plain' | 'dim' = 'plain'): void => push({ kind: 'out', text, tone }), [push])

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
    const cs = useChatStore.getState()
    const norm = slug(target)
    const [serverPart, channelPart] = norm.includes('/') ? norm.split('/', 2) : [null, norm]
    const inServer = cs.servers.filter((x) => (serverPart ? slug(x.name) === serverPart : true))
    const here = serverPart ? [] : inServer.filter((x) => x.id === cs.activeServerId)
    const pool = [...here, ...inServer.filter((x) => !here.includes(x))]
    for (const server of pool) {
      const channel = server.channels.find((c) => slug(c.name) === channelPart || slug(c.name) === slug(channelPart.replace(/^#/, '')))
      if (channel) { cs.openRoom({ kind: 'channel', id: channel.id }); return }
    }
    const conv = cs.conversations.find((c) => slug(conversationTitle(c, cs.meId)) === norm.replace(/^dm\//, ''))
    if (conv) { cs.openRoom({ kind: 'conversation', id: conv.id }); return }
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

  const runTerm = (command: TermCommand, arg: string): Promise<boolean> =>
    Promise.resolve()
      .then(() => command.run(arg, { print, history: () => sessionFor(key).history }))
      .then(() => true)

  // Shell-ish commands that never leave this panel. A promise means it needs the
  // network (the file tree); false means "not mine, hand it to the chat runner".
  const builtin = (line: string): boolean | Promise<boolean> => {
    const [word, ...rest] = line.split(/\s+/)
    const arg = rest.join(' ')
    switch (word.toLowerCase()) {
      case 'clear': case 'cls': clear(); return true
      case 'exit': case 'quit': case 'logout': onClose(); return true
      case 'pwd': print(path); return true
      case 'whoami': print(user); return true
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

  const run = async (raw: string): Promise<void> => {
    const line = raw.trim()
    if (!line) { push({ kind: 'cmd', prompt: { user, path }, text: '' }); return }
    const s = sessionFor(key)
    if (s.history[s.history.length - 1] !== line) s.history.push(line)
    historyIndex.current = null
    setLine('')
    setDraft('')

    // `clear` leaves nothing behind, like the real thing.
    if (!/^(clear|cls)$/i.test(line)) push({ kind: 'cmd', prompt: { user, path }, text: line })
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
      const handled = await runner(line.startsWith('/') ? line : `/${line}`, sink)
      if (!handled) print(`${line.split(/\s+/)[0]}: command not found (try help)`, 'error')
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
        .filter((e) => word === 'get' || e.type === 'directory')
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
    if (shell.mode === 'files' && (word === 'cd' || word === 'ls' || word === 'get') && !/^[#@]/.test(token)) {
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
      finishCompletion(input.slice(0, input.length - partial.length), '', command.complete!(tokens, partial), partial, true)
    } else if (token.startsWith('@')) {
      finishCompletion(head, '@', people.map((p) => p.username), token.slice(1), true)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const s = sessionFor(key)
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
      if (s.history.length === 0) return
      e.preventDefault()
      if (e.key === 'ArrowUp') {
        if (historyIndex.current === null) { setDraft(input); historyIndex.current = s.history.length - 1 }
        else historyIndex.current = Math.max(0, historyIndex.current - 1)
        setLine(s.history[historyIndex.current])
      } else if (historyIndex.current !== null) {
        if (historyIndex.current >= s.history.length - 1) { historyIndex.current = null; setLine(draft) }
        else { historyIndex.current += 1; setLine(s.history[historyIndex.current]) }
      }
    }
  }

  const syncCaret = (): void => setCaret(field.current?.selectionStart ?? input.length)
  const before = input.slice(0, caret)
  const at = input.slice(caret, caret + 1)
  const after = input.slice(caret + 1)

  const promptEl = (p: { user: string; path: string }): JSX.Element => (
    <>
      <span className="font-bold text-[#5af78e]">{p.user}@unreleased</span>
      <span className="text-[#d4d4d4]">:</span>
      <span className="font-bold text-[#6ab0ff]">{p.path}</span>
      <span className="text-[#d4d4d4]">$ </span>
    </>
  )

  return (
    <section
      className="absolute inset-0 z-40 flex flex-col bg-black text-[#d4d4d4]"
      style={{ fontFamily: MONO }}
      aria-label="Admin terminal"
    >
      <header className="h-9 shrink-0 flex items-center gap-3 px-3 bg-[#1b1b1b] border-b border-[#2a2a2a] text-[11px] text-[#9a9a9a]">
        <span className="flex gap-1.5" aria-hidden>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
        </span>
        <span className="flex-1 min-w-0 truncate text-center">{user}@unreleased: {path}</span>
        <button onClick={onClose} title="Close terminal (exit)" aria-label="Close terminal" className="w-6 h-6 rounded flex items-center justify-center text-[#9a9a9a] hover:text-white hover:bg-[#2a2a2a]">
          <X size={14} />
        </button>
      </header>

      <div
        ref={scroller}
        onClick={() => { if (!window.getSelection()?.toString()) field.current?.focus() }}
        className="chat-scroll flex-1 min-h-0 overflow-y-auto px-4 py-3 text-[13px] leading-[1.45] select-text cursor-text"
        role="log"
        aria-live="polite"
      >
        {session.entries.length === 0 && (
          <p className="whitespace-pre-wrap text-[#8a8a8a] mb-2">
            {'Unreleased admin console\nType help for commands, ls to list rooms, cd <room> to switch. Tab completes.'}
          </p>
        )}
        {session.entries.map((e) => {
          if (e.kind === 'cmd') {
            return <p key={e.id} className="whitespace-pre-wrap break-all">{promptEl(e.prompt)}{e.text}</p>
          }
          const color = e.tone === 'error' ? 'text-[#ff6b6b]' : e.tone === 'ok' ? 'text-[#5af78e]' : e.tone === 'dim' ? 'text-[#8a8a8a]' : ''
          return <p key={e.id} className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${color}`}>{e.text}</p>
        })}

        <div className="relative">
          <p className="whitespace-pre-wrap break-all">
            {promptEl({ user, path })}
            {before}
            <span className={`${busy ? '' : 'term-cursor'} bg-[#d4d4d4] text-black`}>{at || ' '}</span>
            {after}
          </p>
          <input
            ref={field}
            value={input}
            onChange={(e) => { setInput(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); historyIndex.current = null }}
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
      <style>{'@keyframes term-blink{0%,49%{opacity:1}50%,100%{opacity:0}} .term-cursor{animation:term-blink 1.1s steps(1) infinite}'}</style>
    </section>
  )
}
