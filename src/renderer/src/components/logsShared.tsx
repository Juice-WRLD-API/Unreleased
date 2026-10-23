// Pieces of the admin Logs tab shared by its Live and Search views: the entry
// row and its details, level/category/status marks, and the filter bar both
// views drive with the same params.
//
// Entry text comes from outside users (paths, usernames, user agents, failed
// login names). Everything here renders it as React text, never as HTML.
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Globe, ScrollText, ShieldAlert, KeyRound, Gauge, FolderOpen, Archive, MicVocal, Cpu, MessageSquare, Server, Box,
  Search, X as XIcon, SlidersHorizontal, Copy, Check, Filter, type LucideIcon,
} from 'lucide-react'
import { BASE_LOG_FIELDS, LOG_EVENTS, LOG_LEVELS, type LogCategory, type LogEntry, type LogFilters, type LogLevel } from '../lib/adminLogsApi'
import { MotionDisclosure } from './MotionDisclosure'
import ThemedSelect from './ThemedSelect'

// ── Marks ────────────────────────────────────────────────────────────────────

export const LEVEL_STYLE: Record<LogLevel, { label: string; short: string; badge: string; dot: string; bar: string; edge: string }> = {
  DEBUG:    { label: 'Debug',    short: 'DEBUG', badge: 'bg-zinc-500/10 text-zinc-400',   dot: 'bg-zinc-500',  bar: 'bg-zinc-500',  edge: 'border-l-transparent' },
  INFO:     { label: 'Info',     short: 'INFO',  badge: 'bg-sky-500/10 text-sky-400',     dot: 'bg-sky-400',   bar: 'bg-sky-500',   edge: 'border-l-transparent' },
  WARNING:  { label: 'Warning',  short: 'WARN',  badge: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400', bar: 'bg-amber-500', edge: 'border-l-amber-500/70' },
  ERROR:    { label: 'Error',    short: 'ERROR', badge: 'bg-red-500/10 text-red-400',     dot: 'bg-red-400',   bar: 'bg-red-500',   edge: 'border-l-red-500/80' },
  CRITICAL: { label: 'Critical', short: 'CRIT',  badge: 'bg-red-500 text-white',          dot: 'bg-red-700',   bar: 'bg-red-800',   edge: 'border-l-red-500' },
}

export const levelStyle = (level: string): typeof LEVEL_STYLE[LogLevel] => LEVEL_STYLE[level as LogLevel] ?? LEVEL_STYLE.INFO

export function LevelBadge({ level }: { level: string }): JSX.Element {
  const s = levelStyle(level)
  return (
    <span className={`inline-flex items-center justify-center w-[46px] py-[3px] rounded-md text-[9px] font-bold tracking-wider ${s.badge}`}>
      {s.short}
    </span>
  )
}

export const CATEGORY_ICON: Record<LogCategory, LucideIcon> = {
  request: Globe, audit: ScrollText, security: ShieldAlert, auth: KeyRound, performance: Gauge,
  files: FolderOpen, comp: Archive, lyrics: MicVocal, tasks: Cpu, chat: MessageSquare, cdn: Server, app: Box,
}

export function CategoryLabel({ category }: { category: string }): JSX.Element {
  const Icon = CATEGORY_ICON[category as LogCategory] ?? Box
  return (
    <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-text-muted">
      <Icon size={11} className="shrink-0 opacity-70" />
      <span className="truncate">{category}</span>
    </span>
  )
}

export const STATUS_CLASS_STYLE: Record<string, { text: string; bar: string; label: string }> = {
  '2xx': { text: 'text-emerald-400', bar: 'bg-emerald-500', label: 'Success' },
  '3xx': { text: 'text-sky-400',     bar: 'bg-sky-500',     label: 'Redirect' },
  '4xx': { text: 'text-amber-400',   bar: 'bg-amber-500',   label: 'Client error' },
  '5xx': { text: 'text-red-400',     bar: 'bg-red-500',     label: 'Server error' },
}

export function StatusPill({ status }: { status: number }): JSX.Element {
  const s = STATUS_CLASS_STYLE[`${Math.floor(status / 100)}xx`]
  return <span className={`shrink-0 font-mono text-[10px] font-bold tabular-nums ${s?.text ?? 'text-text-muted'}`}>{status}</span>
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

// ── Time ─────────────────────────────────────────────────────────────────────

export function clockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function dayLabel(d: Date): string {
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export function fullTime(d: Date): string {
  return `${d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${clockTime(d)}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// ── Row ──────────────────────────────────────────────────────────────────────

/** Time · level · category · message · user. Shared by the header and rows. */
export const LOG_GRID = 'grid grid-cols-[86px_50px_100px_minmax(0,1fr)_minmax(0,128px)] items-center gap-3'

export type AddLogFilter = (key: keyof LogFilters, value: string) => void

const firstLine = (s: string): string => {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

function LogMessage({ entry }: { entry: LogEntry }): JSX.Element {
  if (entry.category === 'request' && entry.method && entry.path) {
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 w-[42px] font-mono text-[10px] font-bold text-text-muted">{entry.method}</span>
        <span className="truncate font-mono text-[11px] text-text-primary">{entry.path}</span>
        {typeof entry.status === 'number' && <StatusPill status={entry.status} />}
        {typeof entry.duration === 'number' && (
          <span className={`shrink-0 text-[10px] tabular-nums ${entry.duration >= 2000 ? 'text-amber-400' : 'text-text-muted'}`}>{formatDuration(entry.duration)}</span>
        )}
      </span>
    )
  }
  const msg = entry.event && entry.msg.startsWith(entry.event) ? entry.msg.slice(entry.event.length).trim() : entry.msg
  return (
    <span className="flex items-center gap-2 min-w-0">
      {entry.event && <span className="shrink-0 font-mono text-[10px] px-1.5 py-px rounded bg-accent/10 text-accent">{entry.event}</span>}
      <span className="truncate text-[12px] text-text-primary">{firstLine(msg) || entry.msg}</span>
      {entry.exc && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-red-400">traceback</span>}
    </span>
  )
}

export const LogRow = memo(function LogRow({ entry, onFilter }: { entry: LogEntry; onFilter?: AddLogFilter }): JSX.Element {
  const [open, setOpen] = useState(false)
  // The details only mount once asked for: a list holds up to 2,000 rows.
  const [opened, setOpened] = useState(false)
  const d = new Date(entry.ts)
  const s = levelStyle(entry.level)
  return (
    <div className={`border-l-2 ${s.edge} ${open ? 'bg-surface-raised/40' : ''} [content-visibility:auto] [contain-intrinsic-size:auto_34px]`}>
      <button
        onClick={() => { setOpened(true); setOpen((o) => !o) }}
        aria-expanded={open}
        className={`w-full ${LOG_GRID} h-[34px] pl-3.5 pr-4 text-left transition-colors ${open ? '' : 'hover:bg-surface-raised/60'}`}
      >
        <span className="font-mono text-[11px] tabular-nums text-text-muted" title={fullTime(d)}>
          {clockTime(d)}<span className="opacity-50">.{String(d.getMilliseconds()).padStart(3, '0')}</span>
        </span>
        <LevelBadge level={entry.level} />
        <CategoryLabel category={entry.category} />
        <LogMessage entry={entry} />
        <span className={`truncate text-right text-[11px] ${entry.user_id != null ? 'text-text-primary/80' : 'text-text-muted/70'}`}>{entry.user ?? ''}</span>
      </button>
      {opened && (
        <MotionDisclosure open={open}>
          <LogDetails entry={entry} onFilter={onFilter} />
        </MotionDisclosure>
      )}
    </div>
  )
})

// Context fields shown in the details grid with their own labels; anything
// else that isn't a base field is an event extra, listed after them.
const CONTEXT_FIELDS = new Set(['event', 'user', 'user_id', 'ip', 'method', 'path', 'status', 'duration', 'user_agent'])

function Field({ label, children, wide, filter }: { label: string; children: ReactNode; wide?: boolean; filter?: () => void }): JSX.Element {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-full' : ''}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-0.5">{label}</p>
      <div className="group flex items-start gap-1.5 min-w-0">
        <div className="min-w-0 text-[11px] text-text-primary break-words select-text">{children}</div>
        {filter && (
          <button onClick={filter} title={`Filter by ${label.toLowerCase()}`}
            className="shrink-0 p-0.5 rounded text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent transition-opacity">
            <Filter size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function CopyLabel({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {})
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'Copied' : label}
    </button>
  )
}

const valueText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? String(v))

function LogDetails({ entry, onFilter }: { entry: LogEntry; onFilter?: AddLogFilter }): JSX.Element {
  const d = new Date(entry.ts)
  const extras = Object.entries(entry).filter(([k]) => !BASE_LOG_FIELDS.has(k) && !CONTEXT_FIELDS.has(k))
  const by = (key: keyof LogFilters, value: unknown) => (onFilter && value != null && value !== '' ? () => onFilter(key, String(value)) : undefined)
  const multiLine = entry.msg.includes('\n') || entry.msg.length > 140
  return (
    <div className="mx-3 mb-2.5 mt-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-6 gap-y-2.5">
        <Field label="When"><span title={entry.ts}>{fullTime(d)}</span></Field>
        <Field label="Logger" filter={by('logger', entry.logger)}><span className="font-mono">{entry.logger}</span></Field>
        <Field label="Source"><span className="font-mono">{entry.module}.{entry.func}:{entry.line}</span></Field>
        <Field label="Process"><span className="font-mono">pid {entry.pid}</span></Field>
        {entry.event && <Field label="Event" filter={by('event', entry.event)}><span className="font-mono">{entry.event}</span></Field>}
        {entry.user && (
          <Field label="User" filter={entry.user_id != null ? by('user', entry.user) : undefined}>
            {entry.user}{entry.user_id != null && <span className="text-text-muted"> #{entry.user_id}</span>}
          </Field>
        )}
        {entry.ip && <Field label="IP" filter={by('ip', entry.ip)}><span className="font-mono">{entry.ip}</span></Field>}
        {entry.method && <Field label="Method" filter={by('method', entry.method)}><span className="font-mono">{entry.method}</span></Field>}
        {entry.path && <Field label="Path" filter={by('path', entry.path)}><span className="font-mono">{entry.path}</span></Field>}
        {typeof entry.status === 'number' && <Field label="Status" filter={by('status', entry.status)}><StatusPill status={entry.status} /></Field>}
        {typeof entry.duration === 'number' && <Field label="Duration">{formatDuration(entry.duration)}</Field>}
        {extras.map(([k, v]) => (
          <Field key={k} label={k.replace(/_/g, ' ')} wide={typeof v === 'object' && v !== null}>
            {typeof v === 'object' && v !== null
              ? <pre className="font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap">{valueText(v)}</pre>
              : <span className={typeof v === 'string' ? '' : 'font-mono'}>{valueText(v)}</span>}
          </Field>
        ))}
        {entry.user_agent && <Field label="User agent" wide><span className="text-text-muted">{entry.user_agent}</span></Field>}
        {multiLine && <Field label="Message" wide><p className="whitespace-pre-wrap leading-relaxed">{entry.msg}</p></Field>}
      </div>

      {entry.exc && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-red-500/15">
            <span className="flex-1 text-[9px] font-bold uppercase tracking-wider text-red-400">Traceback</span>
            <CopyLabel text={entry.exc} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-red-400/90 whitespace-pre select-text">{entry.exc}</pre>
        </div>
      )}

      <div className="flex items-center gap-1 -mb-1 -ml-2">
        <CopyLabel text={JSON.stringify(entry, null, 2)} label="Copy JSON" />
        <CopyLabel text={entry.msg} label="Copy message" />
      </div>
    </div>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────

export function LogListHeader(): JSX.Element {
  return (
    <div className={`${LOG_GRID} shrink-0 h-8 pl-4 pr-4 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-wider text-text-muted/70`}>
      <span>Time</span><span>Level</span><span>Category</span><span>Message</span><span className="text-right">User</span>
    </div>
  )
}

/** A sticky day label where the local date changes between rows. */
export function DayDivider({ date }: { date: Date }): JSX.Element {
  return (
    <div className="sticky top-0 z-[1] px-4 py-1 text-[10px] font-semibold text-text-muted bg-[var(--surface)]/90 backdrop-blur-sm border-b border-[var(--border)]">
      {dayLabel(date)}
    </div>
  )
}

export function GapNote({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] font-medium text-amber-400">
      <span className="h-px flex-1 bg-amber-500/25" />
      {text}
      <span className="h-px flex-1 bg-amber-500/25" />
    </div>
  )
}

/** Big centered message for an empty or blocked view. */
export function LogsNotice({ icon: Icon, title, children, tone = 'muted', spin }: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  tone?: 'muted' | 'warn' | 'error'
  spin?: boolean
}): JSX.Element {
  const ring = tone === 'error' ? 'bg-red-500/10 text-red-400' : tone === 'warn' ? 'bg-amber-500/10 text-amber-400' : 'bg-surface-overlay text-text-muted'
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
      <span className={`w-11 h-11 rounded-full flex items-center justify-center mb-1 ${ring}`}><Icon size={18} className={spin ? 'animate-spin' : ''} /></span>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {children && <div className="max-w-sm text-xs text-text-muted leading-relaxed">{children}</div>}
    </div>
  )
}

// ── Filter bar ───────────────────────────────────────────────────────────────

/** Trimmed, without empty values: what actually goes to the server. */
export function normalizeLogFilters(f: LogFilters): LogFilters {
  const out: LogFilters = {}
  for (const [k, v] of Object.entries(f)) {
    const t = typeof v === 'string' ? v.trim() : ''
    if (t) out[k as keyof LogFilters] = t
  }
  return out
}

/** A text filter that applies on Enter, on blur, or after a pause in typing -
 *  not per keystroke, since each change re-queries (or re-filters the socket). */
function CommitInput({ value, onCommit, placeholder, list, mono, icon, className = '' }: {
  value: string
  onCommit: (v: string) => void
  placeholder: string
  list?: string
  mono?: boolean
  icon?: boolean
  className?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const t = window.setTimeout(() => onCommit(draft), 650)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commit the draft, not on every parent render
  }, [draft])
  return (
    <div className={`relative flex items-center min-w-0 ${className}`}>
      {icon && <Search size={12} className="absolute left-2.5 text-text-muted pointer-events-none" />}
      <input
        value={draft}
        list={list}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(draft)
          if (e.key === 'Escape' && draft) { e.stopPropagation(); setDraft(''); onCommit('') }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full h-8 bg-surface-overlay rounded-lg ${icon ? 'pl-7' : 'pl-2.5'} ${draft ? 'pr-7' : 'pr-2.5'} text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 transition-shadow ${mono ? 'font-mono' : ''}`}
      />
      {draft && (
        <button onClick={() => { setDraft(''); onCommit('') }} title="Clear"
          className="absolute right-1.5 p-0.5 rounded text-text-muted hover:text-text-primary transition-colors">
          <XIcon size={11} />
        </button>
      )}
    </div>
  )
}

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'DEBUG', label: 'Debug and up' },
  { value: 'INFO', label: 'Info and up' },
  { value: 'WARNING', label: 'Warnings and up' },
  { value: 'ERROR', label: 'Errors and up' },
  { value: 'CRITICAL', label: 'Critical only' },
]

export const levelOptions = (levels: string[]): { value: string; label: string }[] =>
  LEVEL_OPTIONS.filter((o) => !o.value || levels.includes(o.value))

const MORE_FIELDS: { key: keyof LogFilters; label: string; placeholder: string; list?: string; mono?: boolean }[] = [
  { key: 'event', label: 'Event', placeholder: 'auth.login_failed, access.', list: 'admin-log-events', mono: true },
  { key: 'user', label: 'User', placeholder: 'Username or id' },
  { key: 'ip', label: 'IP', placeholder: '1.2.3.4', mono: true },
  { key: 'path', label: 'Path contains', placeholder: '/juicewrld/files', mono: true },
  { key: 'status', label: 'Status', placeholder: '404, 5xx', mono: true },
  { key: 'method', label: 'Method', placeholder: 'GET, POST', list: 'admin-log-methods', mono: true },
  { key: 'logger', label: 'Logger', placeholder: 'juicewrld.security', mono: true },
]

/** Level, categories, text and the rest of the search params - the same
 *  names in Live and Search, so switching views keeps the filters. */
export function LogFilterBar({ filters, onSet, onClear, levels = LOG_LEVELS, categories }: {
  filters: LogFilters
  /** One field at a time, so a text field committing after its typing pause
   *  can't overwrite a change made elsewhere in the meantime. */
  onSet: AddLogFilter
  onClear: () => void
  levels?: string[]
  categories: string[]
}): JSX.Element {
  const [more, setMore] = useState(false)
  const set = onSet
  const picked = useMemo(() => new Set((filters.category ?? '').split(',').map((c) => c.trim()).filter(Boolean)), [filters.category])
  const toggleCategory = (c: string): void => {
    const next = new Set(picked)
    if (next.has(c)) next.delete(c); else next.add(c)
    set('category', categories.filter((x) => next.has(x)).join(','))
  }
  const advanced = MORE_FIELDS.filter((f) => (filters[f.key] ?? '').trim())
  const anySet = Object.values(filters).some((v) => (v ?? '').trim())

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CommitInput icon value={filters.q ?? ''} onCommit={(v) => set('q', v)} placeholder="Search messages and tracebacks" className="flex-1" />
        <ThemedSelect
          value={filters.level ?? ''}
          onChange={(v) => set('level', v)}
          options={levelOptions(levels)}
          className="shrink-0 w-[150px] h-8 bg-surface-overlay text-text-primary text-[11px] px-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <button onClick={() => setMore((m) => !m)} aria-expanded={more}
          className={`shrink-0 h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold transition-colors ${
            more || advanced.length ? 'bg-accent/15 text-accent' : 'bg-surface-overlay text-text-muted hover:text-text-primary'
          }`}>
          <SlidersHorizontal size={12} /> Filters
          {advanced.length > 0 && <span className="text-[9px] font-bold px-1 min-w-[14px] text-center rounded-full bg-accent/20">{advanced.length}</span>}
        </button>
        {anySet && (
          <button onClick={onClear}
            className="shrink-0 h-8 px-2 rounded-lg text-[11px] text-text-muted hover:text-text-primary transition-colors">
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {categories.map((c) => {
          const Icon = CATEGORY_ICON[c as LogCategory] ?? Box
          const on = picked.has(c)
          return (
            <button key={c} onClick={() => toggleCategory(c)} aria-pressed={on}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                on ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
              }`}>
              <Icon size={11} className={on ? '' : 'opacity-70'} /> {c}
            </button>
          )
        })}
      </div>

      {!more && advanced.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {advanced.map((f) => (
            <span key={f.key} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-surface-overlay text-[10px] text-text-muted">
              {f.label.toLowerCase()}
              <span className={`text-text-primary ${f.mono ? 'font-mono' : ''}`}>{filters[f.key]}</span>
              <button onClick={() => set(f.key, '')} title={`Remove ${f.label.toLowerCase()} filter`}
                className="p-0.5 rounded hover:text-text-primary transition-colors"><XIcon size={10} /></button>
            </span>
          ))}
        </div>
      )}

      <MotionDisclosure open={more}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2 pt-1">
          {MORE_FIELDS.map((f) => (
            <label key={f.key} className="min-w-0">
              <span className="block mb-1 text-[9px] font-bold uppercase tracking-wider text-text-muted/70">{f.label}</span>
              <CommitInput value={filters[f.key] ?? ''} onCommit={(v) => set(f.key, v)} placeholder={f.placeholder} list={f.list} mono={f.mono} />
            </label>
          ))}
        </div>
        <datalist id="admin-log-events">{LOG_EVENTS.map((e) => <option key={e} value={e} />)}</datalist>
        <datalist id="admin-log-methods">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m} />)}</datalist>
      </MotionDisclosure>
    </div>
  )
}

/** Segmented control used for the Logs views and time windows. */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-surface-overlay">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`flex items-center gap-1.5 rounded-[10px] font-semibold transition-colors ${size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'} ${
            value === o.value ? 'bg-[var(--surface-raised)] text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
