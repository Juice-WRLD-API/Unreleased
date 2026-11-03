import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp, AtSign, AudioLines, CalendarDays, Clock, Code2, FileText, Hash, Image as ImageIcon, Link2, Loader2,
  Lock, MessageSquareReply, Music2, Pencil, Pin, Search, SearchX, Sparkles, UserRound, Video, X,
} from 'lucide-react'
import type { ChatMessage } from '../../lib/chatApi'
import {
  FILTER_HELP, compileQuery, hasToken, matches, removeToken, snippetOf, suggest, toggleToken,
  type Clause, type Facts, type FilterKey, type Suggestion,
} from '../../lib/chatSearch'
import {
  allKnownUsers, allRoomNames, collectFacts, jumpToMessage, scopeRooms, startIndexing, type Progress, type Scope,
} from '../../lib/chatSearchIndex'
import { displayName, roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { ChatAvatar, IconButton, shortStamp } from './ui'

const RESULT_PAGE = 40
const RECENT_KEY = 'unreleased:chat:recentSearches'
const MAX_RECENT = 6

// The panel unmounts whenever a thread opens over it (jumping to a thread
// reply does that), so what you typed lives here instead of in component
// state - closing and reopening search lands exactly where you left off.
const remembered = { query: '', scope: 'room' as Scope, newestFirst: true }

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch { return [] }
}
function saveRecent(q: string): string[] {
  const t = q.trim()
  if (t.length < 2) return loadRecent()
  const next = [t, ...loadRecent().filter((x) => x !== t)].slice(0, MAX_RECENT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
  return next
}
function clearRecent(): void {
  try { localStorage.removeItem(RECENT_KEY) } catch {}
}

const CHIP_TONE: Record<FilterKey | 'text', string> = {
  from: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  mentions: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  has: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  is: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  in: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  before: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  after: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  on: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  text: 'bg-surface-overlay text-text-secondary border-[var(--border)]',
}

function KeyIcon({ k, size = 12 }: { k: FilterKey | 'text'; size?: number }): JSX.Element {
  switch (k) {
    case 'from': return <UserRound size={size} />
    case 'mentions': return <AtSign size={size} />
    case 'has': return <Sparkles size={size} />
    case 'is': return <Sparkles size={size} />
    case 'in': return <Hash size={size} />
    case 'text': return <Search size={size} />
    default: return <CalendarDays size={size} />
  }
}

const QUICK: { token: string; label: string; icon: JSX.Element }[] = [
  { token: 'has:image', label: 'Images', icon: <ImageIcon size={12} /> },
  { token: 'has:video', label: 'Video', icon: <Video size={12} /> },
  { token: 'has:link', label: 'Links', icon: <Link2 size={12} /> },
  { token: 'has:file', label: 'Files', icon: <FileText size={12} /> },
  { token: 'has:song', label: 'Songs', icon: <Music2 size={12} /> },
  { token: 'is:pinned', label: 'Pinned', icon: <Pin size={12} /> },
  { token: 'mentions:me', label: 'Mentions me', icon: <AtSign size={12} /> },
  { token: 'from:me', label: 'From me', icon: <UserRound size={12} /> },
]

const SCOPE_LABEL = (scope: Scope, active: RoomRef | null): string => {
  if (scope === 'room') return 'This chat'
  if (scope === 'all') return 'Everywhere'
  return active?.kind === 'conversation' ? 'All DMs' : 'This server'
}

function SuggestIcon({ kind }: { kind: Suggestion['kind'] }): JSX.Element {
  switch (kind) {
    case 'user': return <UserRound size={14} />
    case 'room': return <Hash size={14} />
    case 'flag': return <Sparkles size={14} />
    case 'date': return <CalendarDays size={14} />
    default: return <Search size={14} />
  }
}

function AttachmentPill({ a }: { a: Facts['atts'][number] }): JSX.Element {
  const icon = a.unresolved ? <Lock size={11} />
    : a.kind === 'image' ? <ImageIcon size={11} />
    : a.kind === 'video' ? <Video size={11} />
    : a.kind === 'audio' ? <AudioLines size={11} />
    : <FileText size={11} />
  return (
    <span className="inline-flex items-center gap-1 max-w-full rounded-md bg-surface-overlay px-1.5 py-0.5 text-[11px] text-text-secondary">
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="truncate">{a.unresolved ? 'Encrypted attachment' : a.name}</span>
    </span>
  )
}

function ResultRow({ f, terms, showRoom, roomLabel, onOpen }: {
  f: Facts
  terms: string[]
  showRoom: boolean
  roomLabel: string
  onOpen: (m: ChatMessage) => void
}): JSX.Element {
  const m = f.m
  const snippet = useMemo(() => snippetOf(f.text, terms), [f.text, terms])
  const when = new Date(m.created_at)
  return (
    <button
      onClick={() => onOpen(m)}
      className="chat-in w-full text-left rounded-xl border border-[var(--border)] bg-surface-raised/50 p-3 hover:border-accent/50 hover:bg-surface-raised transition-colors focus:outline-none focus-visible:border-accent"
    >
      <div className="flex items-center gap-2 mb-1">
        <ChatAvatar user={m.author} size={20} />
        <span className="text-xs font-semibold text-text-primary truncate">{displayName(m.author)}</span>
        {showRoom && (
          <span className="inline-flex items-center gap-1 min-w-0 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
            {m.conversation != null ? <Lock size={9} className="shrink-0" /> : <Hash size={9} className="shrink-0" />}
            <span className="truncate">{roomLabel.replace(/^#/, '')}</span>
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-text-muted" title={when.toLocaleString()}>{shortStamp(m.created_at)}</span>
      </div>
      {snippet.parts.length > 0 ? (
        <p className="text-[0.85rem] leading-relaxed text-text-primary break-words [overflow-wrap:anywhere] line-clamp-4">
          {snippet.parts.map((p, i) => p.hit
            ? <mark key={i} className="rounded bg-accent/30 px-0.5 text-text-primary">{p.text}</mark>
            : <span key={i}>{p.text}</span>)}
        </p>
      ) : f.shares.size > 0 ? (
        <p className="text-xs italic text-text-muted">Shared a {[...f.shares][0]}</p>
      ) : !f.readable ? (
        <p className="inline-flex items-center gap-1 text-xs italic text-text-muted"><Lock size={11} />Can&apos;t be read on this device</p>
      ) : null}
      {f.atts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {f.atts.slice(0, 4).map((a, i) => <AttachmentPill key={i} a={a} />)}
          {f.atts.length > 4 && <span className="text-[11px] text-text-muted self-center">+{f.atts.length - 4}</span>}
        </div>
      )}
      {(m.pinned || m.edited_at || f.isReply || m.reply_count > 0) && (
        <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-text-muted">
          {m.pinned && <span className="inline-flex items-center gap-0.5 text-amber-400"><Pin size={10} />Pinned</span>}
          {f.isReply && <span className="inline-flex items-center gap-0.5"><MessageSquareReply size={10} />{m.parent ? 'In thread' : 'Reply'}</span>}
          {m.reply_count > 0 && <span>{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</span>}
          {m.edited_at && <span className="inline-flex items-center gap-0.5"><Pencil size={10} />Edited</span>}
        </div>
      )}
    </button>
  )
}

function FilterChip({ clause, onRemove }: { clause: Clause; onRemove: () => void }): JSX.Element {
  const k = clause.key ?? 'text'
  const bad = !!clause.error
  return (
    <span
      title={clause.error ?? undefined}
      className={`inline-flex items-center gap-1 max-w-full rounded-full border pl-2 pr-1 py-0.5 text-[11px] font-semibold ${bad ? 'bg-red-500/15 text-red-300 border-red-500/40' : CHIP_TONE[k]}`}
    >
      <KeyIcon k={k} />
      {clause.negate && <span className="uppercase text-[9px] tracking-wide opacity-80">not</span>}
      <span className="truncate">{clause.label}</span>
      <button onClick={onRemove} aria-label={`Remove ${clause.label}`} className="shrink-0 rounded-full p-0.5 hover:bg-white/10"><X size={11} /></button>
    </span>
  )
}

export default function SearchPanel({ room, onClose, onNavigate }: {
  room: RoomRef | null
  onClose: () => void
  onNavigate?: () => void
}): JSX.Element {
  const [query, setQuery] = useState(remembered.query)
  const [scope, setScope] = useState<Scope>(remembered.scope)
  const [newestFirst, setNewestFirst] = useState(remembered.newestFirst)
  const [caret, setCaret] = useState(remembered.query.length)
  const [focused, setFocused] = useState(true)
  const [pick, setPick] = useState(0)
  const [shown, setShown] = useState(RESULT_PAGE)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [progress, setProgress] = useState<Progress | null>(null)
  const input = useRef<HTMLInputElement>(null)

  remembered.query = query
  remembered.scope = scope
  remembered.newestFirst = newestFirst

  const servers = useChatStore((s) => s.servers)
  const conversations = useChatStore((s) => s.conversations)
  const liveRooms = useChatStore((s) => s.rooms)
  const plain = useChatStore((s) => s.plain)
  const threads = useChatStore((s) => s.threads)
  const meId = useChatStore((s) => s.meId)
  const mutedUserIds = useStore((s) => s.mutedUserIds)

  const activeKey = room ? roomKey(room) : ''
  const targets = useMemo(
    () => scopeRooms(scope, room),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, activeKey, servers, conversations],
  )
  const targetSig = targets.map((t) => t.key).join(',')

  // (Re)load history whenever the set of chats in scope changes.
  useEffect(() => {
    setProgress(null)
    if (!targets.length) return
    return startIndexing(targets, setProgress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSig])

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setShown(RESULT_PAGE) }, [query, scope, newestFirst, targetSig])
  useEffect(() => { setPick(0) }, [query, caret])

  const corpus = useMemo(
    () => collectFacts(targets, mutedUserIds),
    // `progress` ticks as pages land; the store slices pick up live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets, progress, liveRooms, plain, threads, mutedUserIds],
  )

  const users = useMemo(() => allKnownUsers(corpus.facts.map((f) => f.m.author)), [corpus.facts, servers, conversations])
  const deferred = useDeferredValue(query)
  const compiled = useMemo(() => compileQuery(deferred, { meId, users }), [deferred, meId, users])
  // Quick filters read the live (undeferred) query so toggles feel instant.
  const liveClauses = useMemo(() => compileQuery(query, { meId, users }).clauses, [query, meId, users])

  const results = useMemo(() => {
    if (!compiled.active || compiled.hasError) return []
    const out = corpus.facts.filter((f) => matches(compiled, f))
    out.sort((a, b) => (newestFirst ? 1 : -1) * (new Date(b.m.created_at).getTime() - new Date(a.m.created_at).getTime()) || (newestFirst ? b.m.id - a.m.id : a.m.id - b.m.id))
    return out
  }, [compiled, corpus.facts, newestFirst])

  const sugg = useMemo(
    () => (focused ? suggest(query, caret, { users, rooms: allRoomNames() }) : { range: [0, 0] as [number, number], items: [] }),
    [focused, query, caret, users],
  )

  const applySuggestion = useCallback((s: Suggestion) => {
    const [from, to] = sugg.range
    const tail = query.slice(to)
    const insert = s.insert + (s.done ? ' ' : '')
    const next = query.slice(0, from) + insert + (s.done && tail.startsWith(' ') ? tail.slice(1) : tail)
    const pos = from + insert.length
    setQuery(next)
    setCaret(pos)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(pos, pos) })
  }, [query, sugg.range])

  const setAndFocus = (q: string): void => {
    setQuery(q)
    setCaret(q.length)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(q.length, q.length) })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const open = sugg.items.length > 0
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + sugg.items.length) % sugg.items.length)
    } else if (open && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault()
      applySuggestion(sugg.items[Math.min(pick, sugg.items.length - 1)])
    } else if (e.key === 'Enter') {
      setRecent(saveRecent(query))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (open) setFocused(false)
      else if (query) setAndFocus('')
      else onClose()
    }
  }

  const open = useCallback((m: ChatMessage) => {
    setRecent(saveRecent(query))
    void jumpToMessage(m)
    onNavigate?.()
  }, [query, onNavigate])

  const scopes: Scope[] = ['room', 'space', 'all']
  const showRoomTag = scope !== 'room'
  const indexing = !!progress?.running
  const canSearchAnything = targets.length > 0

  return (
    <aside className="w-full md:w-[380px] shrink-0 min-h-0 flex flex-col border-l border-[var(--border)] bg-surface">
      <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--separator)]">
        <div className="flex-1 min-w-0">
          <h3 className="text-headline md:text-sm md:font-bold md:tracking-normal text-text-primary">Search</h3>
          <p className="text-footnote md:text-[11px] md:tracking-normal text-text-muted truncate">
            {targets.length === 0 ? 'Nothing to search yet' : targets.length === 1 ? targets[0].label : `${targets.length} chats`}
            {scope === 'all' || (scope === 'space' && room?.kind === 'conversation') ? ' · includes encrypted DMs' : ''}
          </p>
        </div>
        <IconButton label="Close search" className="hidden md:flex" onClick={onClose}><X size={17} /></IconButton>
        <button onClick={onClose} className="md:hidden h-11 px-1 text-body font-semibold text-accent active:opacity-60">Done</button>
      </header>

      <div className="shrink-0 px-4 md:px-3 pt-3 pb-2 space-y-2 border-b border-[var(--separator)]">
        <div className="relative">
          <div className="flex items-center gap-2 rounded-full md:rounded-xl border border-transparent md:border-[var(--border)] bg-[var(--fill)] md:bg-surface-raised px-3 h-9 md:h-10 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/20 transition-shadow">
            {indexing ? <Loader2 size={15} className="shrink-0 animate-spin text-accent" /> : <Search size={15} className="shrink-0 text-text-muted" />}
            <input
              ref={input}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setFocused(true) }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 120)}
              placeholder="Search messages — try from:me has:image"
              spellCheck={false}
              autoComplete="off"
              aria-label="Search messages"
              className="flex-1 min-w-0 bg-transparent text-body md:text-sm md:tracking-normal text-text-primary placeholder:text-text-muted outline-none"
            />
            {query && (
              <button onClick={() => setAndFocus('')} aria-label="Clear search" className="shrink-0 text-text-muted hover:text-text-primary"><X size={15} /></button>
            )}
          </div>
          {sugg.items.length > 0 && (
            <ul role="listbox" className="chat-pop absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-surface shadow-2xl py-1">
              {sugg.items.map((s, i) => (
                <li key={s.insert + i} role="option" aria-selected={i === pick}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); applySuggestion(s) }}
                    onMouseEnter={() => setPick(i)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === pick ? 'bg-surface-overlay' : ''}`}
                  >
                    <span className="shrink-0 text-text-muted"><SuggestIcon kind={s.kind} /></span>
                    <span className="text-sm font-semibold text-text-primary truncate">{s.label}</span>
                    {s.detail && <span className="ml-auto pl-2 text-[11px] text-text-muted truncate">{s.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {liveClauses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {liveClauses.map((c, i) => (
              <FilterChip key={`${c.token.start}-${i}`} clause={c} onRemove={() => setAndFocus(removeToken(query, c.token))} />
            ))}
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3">
          {QUICK.map((qk) => {
            const on = hasToken(query, qk.token)
            return (
              <button
                key={qk.token}
                onClick={() => setAndFocus(toggleToken(query, qk.token))}
                aria-pressed={on}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'border-accent/60 bg-accent/15 text-accent' : 'border-[var(--border)] bg-surface-raised text-text-secondary hover:text-text-primary hover:border-accent/40'}`}
              >
                {qk.icon}{qk.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 flex rounded-lg bg-surface-raised p-0.5" role="tablist" aria-label="Search scope">
            {scopes.map((sc) => (
              <button
                key={sc}
                role="tab"
                aria-selected={scope === sc}
                onClick={() => setScope(sc)}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold truncate transition-colors ${scope === sc ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
              >
                {SCOPE_LABEL(sc, room)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setNewestFirst((v) => !v)}
            title={newestFirst ? 'Newest first' : 'Oldest first'}
            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-surface-raised px-2 h-7 text-[11px] font-semibold text-text-secondary hover:text-text-primary"
          >
            <ArrowDownUp size={12} />{newestFirst ? 'Newest' : 'Oldest'}
          </button>
        </div>
      </div>

      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {compiled.active && (
          <p className="px-0.5 text-[11px] text-text-muted flex items-center gap-1.5">
            {compiled.hasError
              ? <span className="text-red-300">Fix the highlighted filter to search.</span>
              : <><span className="font-semibold text-text-secondary">{results.length.toLocaleString()} {results.length === 1 ? 'result' : 'results'}</span>
                <span>· searched {corpus.total.toLocaleString()} messages{indexing ? ' so far' : ''}</span></>}
          </p>
        )}

        {!canSearchAnything && (
          <p className="text-center text-xs text-text-muted py-8">There aren&apos;t any chats to search in this scope.</p>
        )}

        {compiled.active && !compiled.hasError && results.length === 0 && !indexing && canSearchAnything && (
          <div className="flex flex-col items-center text-center py-10 px-4">
            <span className="w-12 h-12 rounded-2xl bg-surface-raised text-text-muted flex items-center justify-center mb-3"><SearchX size={22} /></span>
            <p className="text-sm font-semibold text-text-primary">No messages found</p>
            <p className="text-xs text-text-muted mt-1">
              {scope === 'room' ? 'Try widening the search to the whole server or everywhere.' : 'Try fewer words or remove a filter.'}
            </p>
            {scope === 'room' && (
              <button onClick={() => setScope('space')} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white hover:brightness-110">
                Search {SCOPE_LABEL('space', room).toLowerCase()}
              </button>
            )}
          </div>
        )}

        {results.slice(0, shown).map((f) => (
          <ResultRow
            key={f.m.id}
            f={f}
            terms={compiled.terms}
            showRoom={showRoomTag}
            roomLabel={corpus.byRoom.get(f.m.id)?.label ?? ''}
            onOpen={open}
          />
        ))}
        {results.length > shown && (
          <button onClick={() => setShown((n) => n + RESULT_PAGE)} className="w-full rounded-xl border border-dashed border-[var(--border)] py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50">
            Show {Math.min(RESULT_PAGE, results.length - shown)} more
          </button>
        )}

        {compiled.active && !compiled.hasError && (corpus.locked > 0 || (progress?.capped ?? 0) > 0 || (progress?.failed ?? 0) > 0 || corpus.pendingAttachments > 0) && (
          <div className="mt-2 space-y-1 rounded-xl bg-surface-raised/60 px-3 py-2 text-[11px] text-text-muted">
            {corpus.locked > 0 && <p className="flex gap-1.5"><Lock size={12} className="shrink-0 mt-0.5" />{corpus.locked.toLocaleString()} encrypted {corpus.locked === 1 ? 'message' : 'messages'} can&apos;t be read on this device, so they can&apos;t be searched.</p>}
            {corpus.pendingAttachments > 0 && indexing === false && <p className="flex gap-1.5"><Clock size={12} className="shrink-0 mt-0.5" />Some encrypted attachments are still being identified; file filters may miss them.</p>}
            {(progress?.capped ?? 0) > 0 && <p className="flex gap-1.5"><Clock size={12} className="shrink-0 mt-0.5" />Very busy chats were searched back to their most recent {3000} messages.</p>}
            {(progress?.failed ?? 0) > 0 && <p className="flex gap-1.5"><X size={12} className="shrink-0 mt-0.5" />{progress!.failed} {progress!.failed === 1 ? 'chat' : 'chats'} couldn&apos;t be loaded; results may be incomplete.</p>}
          </div>
        )}

        {!compiled.active && canSearchAnything && (
          <div className="pt-1 space-y-4">
            {recent.length > 0 && (
              <section>
                <div className="flex items-center mb-1.5">
                  <h4 className="text-footnote font-semibold text-text-secondary md:text-[10px] md:font-bold md:uppercase md:tracking-wider md:text-text-muted">Recent</h4>
                  <button onClick={() => { clearRecent(); setRecent([]) }} className="ml-auto text-[10px] text-text-muted hover:text-text-primary">Clear</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r) => (
                    <button key={r} onClick={() => setAndFocus(r)} className="inline-flex items-center gap-1 max-w-full rounded-full border border-[var(--border)] bg-surface-raised px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:border-accent/40">
                      <Clock size={11} className="shrink-0" /><span className="truncate">{r}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h4 className="text-footnote font-semibold text-text-secondary md:text-[10px] md:font-bold md:uppercase md:tracking-wider md:text-text-muted mb-1.5">Filters</h4>
              <div className="space-y-1">
                {FILTER_HELP.map((h) => (
                  <button
                    key={h.key}
                    onClick={() => setAndFocus(`${query.trim()} ${h.example}`.trim())}
                    className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
                  >
                    <span className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center ${CHIP_TONE[h.key]}`}><KeyIcon k={h.key} size={13} /></span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-text-primary font-mono">{h.example}</span>
                      <span className="block text-[11px] text-text-muted truncate">{h.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="rounded-xl bg-surface-raised/60 p-3 text-[11px] leading-relaxed text-text-muted space-y-1">
              <p className="flex items-center gap-1.5 text-text-secondary font-semibold"><Code2 size={12} />Combine them</p>
              <p><code className="text-text-primary">from:alice has:image after:7d</code> — pictures from Alice this week.</p>
              <p>Put <code className="text-text-primary">-</code> in front to exclude: <code className="text-text-primary">-has:link</code>. Quote exact phrases: <code className="text-text-primary">&quot;set list&quot;</code>. Use commas for either/or: <code className="text-text-primary">has:image,video</code>.</p>
              <p className="flex items-center gap-1.5 pt-1"><Lock size={11} />Encrypted DMs are searched on this device — nothing is sent to the server.</p>
            </section>
          </div>
        )}
      </div>

    </aside>
  )
}
