import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Terminal, X } from 'lucide-react'
import { CHAT_COMMANDS } from '../../lib/chatCommands'
import { encodeSongShare, type LocalNoticePayload } from '../../lib/chatShare'
import { getTerminalRunner, type TerminalSearchResult, type TerminalSink } from '../../lib/chatTerminalBridge'
import { roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
import { CommandCard } from './MessageBody'
import FeedbackSentCard from './FeedbackSentCard'
import { IconButton, errorText } from './ui'

type NewEntry =
  | { kind: 'cmd'; text: string }
  | { kind: 'out'; text: string; tone: 'error' | 'ok' | 'plain' }
  | { kind: 'card'; payload: LocalNoticePayload }
type Entry = NewEntry & { id: number }

// Scrollback and command history live outside the component so closing the
// panel (or switching rooms and coming back) doesn't wipe the session.
const sessions = new Map<string, { entries: Entry[]; history: string[]; search: TerminalSearchResult[] }>()
const MAX_ENTRIES = 300
let nextEntryId = 1

function sessionFor(key: string): { entries: Entry[]; history: string[]; search: TerminalSearchResult[] } {
  let s = sessions.get(key)
  if (!s) { s = { entries: [], history: [], search: [] }; sessions.set(key, s) }
  return s
}

const COMPLETIONS = [...new Set([
  ...CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
  'clear', 'exit',
])].sort()

function TerminalCard({ payload }: { payload: LocalNoticePayload }): JSX.Element | null {
  if (payload.kind === 'feedbackSent') return <FeedbackSentCard message={payload.message} />
  return <CommandCard card={payload} />
}

// A shell-style front end to the chat slash commands, for platform
// administrators. It does not reimplement any of them: input goes to the same
// command runner the composer uses (see chatTerminalBridge), so every command,
// flag, alias and permission check behaves identically - only the output lands
// here instead of in toasts and cards in the room. Text that isn't a command is
// rejected rather than posted, so nothing is ever sent by accident.
export default function TerminalPanel({ room, onClose }: { room: RoomRef; onClose: () => void }): JSX.Element | null {
  const me = useChatStore((s) => s.me)
  const roomLabel = useChatStore((s) => {
    if (room.kind === 'channel') return `#${s.servers.flatMap((x) => x.channels).find((c) => c.id === room.id)?.name ?? 'channel'}`
    return 'dm'
  })
  const key = roomKey(room)
  const session = sessionFor(key)
  const [, bump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState('')
  const historyIndex = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const push = useCallback((entry: NewEntry): void => {
    const s = sessionFor(key)
    s.entries = [...s.entries, { ...entry, id: nextEntryId++ }].slice(-MAX_ENTRIES)
    bump((n) => n + 1)
  }, [key])

  useEffect(() => { field.current?.focus() }, [key])
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.entries.length, busy])

  const sink = useMemo<TerminalSink>(() => ({
    toast: (text, tone = 'error') => push({ kind: 'out', text, tone }),
    notice: (payload) => push({ kind: 'card', payload }),
    pickSearch: (query, results) => {
      sessionFor(key).search = results
      push({
        kind: 'out',
        tone: 'plain',
        text: `${results.length} results for "${query}":\n${results.map((r, i) => `${String(i + 1).padStart(2)}. ${r.name} - ${r.detail}`).join('\n')}\nType a number to post that song to the room.`,
      })
    },
  }), [key, push])

  if (me?.role !== 'administrator') return null

  const run = async (raw: string): Promise<void> => {
    const line = raw.trim()
    if (!line) return
    const s = sessionFor(key)
    if (s.history[s.history.length - 1] !== line) s.history.push(line)
    historyIndex.current = null
    setInput('')
    setDraft('')

    if (/^(clear|cls)$/i.test(line)) { s.entries = []; bump((n) => n + 1); return }
    if (/^(exit|quit)$/i.test(line)) { onClose(); return }
    push({ kind: 'cmd', text: line })

    // A bare number after a /search listing picks that result.
    if (/^\d+$/.test(line) && s.search.length > 0) {
      const pick = s.search[Number(line) - 1]
      if (!pick) { push({ kind: 'out', tone: 'error', text: `Pick a number from 1 to ${s.search.length}` }); return }
      s.search = []
      setBusy(true)
      try {
        await useChatStore.getState().send(room, { text: encodeSongShare(pick.id), files: [] })
        push({ kind: 'out', tone: 'ok', text: `Posted "${pick.name}" to the room` })
      } catch (err) {
        push({ kind: 'out', tone: 'error', text: errorText(err, 'Message failed to send') })
      } finally { setBusy(false) }
      return
    }

    const runner = getTerminalRunner(key)
    if (!runner) { push({ kind: 'out', tone: 'error', text: 'This room isn’t ready yet - try again in a moment' }); return }
    s.search = []
    setBusy(true)
    try {
      const handled = await runner(line.startsWith('/') ? line : `/${line}`, sink)
      if (!handled) push({ kind: 'out', tone: 'error', text: `Unknown command "${line.split(/\s+/)[0]}". Type help for the list.` })
    } catch (err) {
      push({ kind: 'out', tone: 'error', text: errorText(err, 'Command failed') })
    } finally {
      setBusy(false)
      requestAnimationFrame(() => field.current?.focus())
    }
  }

  const complete = (): void => {
    const m = /^\/?(\w*)$/.exec(input)
    if (!m) return
    const hits = COMPLETIONS.filter((c) => c.startsWith(m[1].toLowerCase()))
    if (hits.length === 1) setInput(`${hits[0]} `)
    else if (hits.length > 1) {
      // Fill in the longest shared prefix, then list what's left to choose from.
      let prefix = hits[0]
      for (const h of hits) while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1)
      if (prefix.length > m[1].length) setInput(prefix)
      else push({ kind: 'out', tone: 'plain', text: hits.join('  ') })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const s = sessionFor(key)
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) void run(input); return }
    if (e.key === 'Tab') { e.preventDefault(); complete(); return }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); s.entries = []; bump((n) => n + 1); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (s.history.length === 0) return
      e.preventDefault()
      if (e.key === 'ArrowUp') {
        if (historyIndex.current === null) { setDraft(input); historyIndex.current = s.history.length - 1 }
        else historyIndex.current = Math.max(0, historyIndex.current - 1)
        setInput(s.history[historyIndex.current])
      } else if (historyIndex.current !== null) {
        if (historyIndex.current >= s.history.length - 1) { historyIndex.current = null; setInput(draft) }
        else { historyIndex.current += 1; setInput(s.history[historyIndex.current]) }
      }
    }
  }

  const prompt = `${me.username}@unreleased:${roomLabel}$`

  return (
    <aside className="w-full md:w-[460px] shrink-0 min-h-0 flex flex-col border-l border-[var(--border)] bg-surface" aria-label="Admin terminal">
      <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--border)]">
        <Terminal size={16} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary truncate">Terminal</h3>
          <p className="text-[11px] text-text-muted truncate">Chat commands for administrators · runs in {roomLabel}</p>
        </div>
        <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
      </header>

      <div
        ref={scroller}
        onClick={() => { if (!window.getSelection()?.toString()) field.current?.focus() }}
        className="chat-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3 font-mono text-xs leading-relaxed text-text-secondary select-text"
        role="log"
        aria-live="polite"
      >
        {session.entries.length === 0 && (
          <p className="text-text-muted">
            Same commands as the chat box, with or without the slash. Try <span className="text-accent">help</span>, <span className="text-accent">role @user</span> or <span className="text-accent">broadcast -h</span>.
            Tab completes, ↑ ↓ recalls history, <span className="text-accent">clear</span> wipes the screen.
          </p>
        )}
        {session.entries.map((e) => {
          if (e.kind === 'cmd') {
            return <p key={e.id} className="mt-2 break-words [overflow-wrap:anywhere]"><span className="text-accent">{prompt}</span> <span className="text-text-primary">{e.text}</span></p>
          }
          if (e.kind === 'out') {
            const color = e.tone === 'error' ? 'text-red-400' : e.tone === 'ok' ? 'text-green-400' : 'text-text-secondary'
            return <p key={e.id} className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${color}`}>{e.text}</p>
          }
          return <div key={e.id} className="my-1.5 font-sans"><TerminalCard payload={e.payload} /></div>
        })}
        {busy && <p className="mt-1 flex items-center gap-1.5 text-text-muted"><Loader2 size={11} className="animate-spin" />running…</p>}
      </div>

      <label className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-[var(--border)] font-mono text-xs">
        <span className="text-accent shrink-0 max-w-[45%] truncate">{prompt}</span>
        <input
          ref={field}
          value={input}
          onChange={(e) => { setInput(e.target.value); historyIndex.current = null }}
          onKeyDown={onKeyDown}
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Terminal command"
          className="flex-1 min-w-0 bg-transparent outline-none text-text-primary placeholder:text-text-muted"
          placeholder="type a command"
        />
      </label>
    </aside>
  )
}
