import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { CHAT_COMMANDS } from '../../lib/chatCommands'
import { commandCardText } from '../../lib/commandCardText'
import { encodeSongShare, type LocalNoticePayload } from '../../lib/chatShare'
import { getTerminalRunner, type TerminalSearchResult, type TerminalSink } from '../../lib/chatTerminalBridge'
import { conversationTitle, roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
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

const BUILTINS = ['cd', 'ls', 'pwd', 'whoami', 'clear', 'exit']
const COMPLETIONS = [...new Set([
  ...CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
  ...BUILTINS,
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

function helpText(): string {
  const rows = CHAT_COMMANDS.filter((c) => c.name !== 'help').map((c) => `  ${c.usage}\n      ${c.description}`)
  return [
    'Chat commands (the slash is optional here):',
    ...rows,
    '',
    'Terminal:',
    '  cd <channel|@dm>   switch the room commands run in',
    '  ls                 list channels (or DMs)',
    '  pwd  whoami  clear  exit',
    '  Tab completes · ↑ ↓ history · Ctrl+L clear · Ctrl+C cancel line',
  ].join('\n')
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
  const path = useChatStore((s) => {
    if (room.kind === 'channel') {
      const server = s.servers.find((x) => x.channels.some((c) => c.id === room.id))
      const channel = server?.channels.find((c) => c.id === room.id)
      return `~/${slug(server?.name ?? 'server')}/${slug(channel?.name ?? 'channel')}`
    }
    const conv = s.conversations.find((c) => c.id === room.id)
    return `~/dm/${slug(conv ? conversationTitle(conv, s.meId) : 'chat')}`
  })
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

  // Shell-ish commands that never leave this panel. Returns true when handled.
  const builtin = (line: string): boolean => {
    const [word, ...rest] = line.split(/\s+/)
    const arg = rest.join(' ')
    switch (word.toLowerCase()) {
      case 'clear': case 'cls': clear(); return true
      case 'exit': case 'quit': case 'logout': onClose(); return true
      case 'pwd': print(path); return true
      case 'whoami': print(user); return true
      case 'ls': listRooms(); return true
      case 'cd': changeRoom(arg); return true
      case 'help': case '/help':
        if (rest.length > 0) return false
        print(helpText())
        return true
      default: return false
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
    if (builtin(line)) return

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

  const complete = (): void => {
    const m = /^\/?(\w*)$/.exec(input)
    if (!m) return
    const hits = COMPLETIONS.filter((c) => c.startsWith(m[1].toLowerCase()))
    if (hits.length === 1) setLine(`${hits[0]} `)
    else if (hits.length > 1) {
      // Longest shared prefix first; if that adds nothing, list the options.
      let prefix = hits[0]
      for (const h of hits) while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1)
      if (prefix.length > m[1].length) setLine(prefix)
      else print(hits.join('  '), 'dim')
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
