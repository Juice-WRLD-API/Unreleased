// Shows a log saved by "Record debug log": summary counts that double as
// filters, a search box, and one row per event that opens to its full detail
// (headers, bodies, stacks, console arguments). Parsing lives in lib/debugLog,
// shared with the terminal's `debuglog open`. Dropping another log file on the
// panel swaps it in.
import { useDeferredValue, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, FileJson, FolderOpen, Search, X } from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'
import { showAppToast } from '../lib/appToast'
import { formatBytes } from '../lib/format'
import {
  describeEntry, describeLog, formatOffset, isProblem, matchesFilter, openDebugLogFile, prettyText,
  readDebugLogFile, searchText, useDebugLogViewer,
  type DebugLog, type DebugLogEntry, type DebugLogFilter,
} from '../lib/debugLog'

// Rows rendered at a time - a full recording is up to 8000 events.
const PAGE = 300

function tagColor(e: DebugLogEntry, problem: boolean): string {
  if (problem) return e.kind === 'console' && e.level === 'warn' ? 'text-amber-400' : 'text-red-400'
  switch (e.kind) {
    case 'fetch': case 'xhr': return 'text-sky-400'
    case 'websocket': return 'text-violet-400'
    case 'navigation': return 'text-accent'
    case 'resource': return 'text-text-muted'
    default: return 'text-text-secondary'
  }
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-mono break-all select-text">{children}</span>
    </>
  )
}

function Block({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="mt-2">
      <p className="text-text-muted text-[10px] font-semibold uppercase tracking-widest mb-1">{title}</p>
      <pre className="text-[11px] font-mono text-text-primary whitespace-pre-wrap break-all select-text max-h-72 overflow-auto rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-2">{text}</pre>
    </div>
  )
}

const headerLines = (h: Record<string, string> | undefined): string =>
  Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')

function EntryDetail({ e }: { e: DebugLogEntry }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const { id: _id, ...rest } = e
    navigator.clipboard?.writeText(JSON.stringify({ ...rest, at: new Date(e.t).toISOString() }, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })
      .catch(() => showAppToast('Couldn’t copy to the clipboard'))
  }

  const fields: [string, ReactNode][] = [['Time', new Date(e.t).toISOString()]]
  const blocks: [string, string][] = []
  switch (e.kind) {
    case 'console':
      fields.push(['Level', e.level])
      blocks.push(['Arguments', e.args.map(prettyText).join('\n\n')])
      break
    case 'error':
      fields.push(['Message', e.message])
      if (e.source) fields.push(['Source', e.source])
      if (e.stack) blocks.push(['Stack', e.stack])
      break
    case 'rejection':
      blocks.push(['Reason', prettyText(e.reason)])
      break
    case 'fetch': case 'xhr': {
      fields.push(['URL', e.url])
      if (e.status != null) fields.push(['Status', `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`])
      if (e.error) fields.push(['Error', e.error])
      if (e.durationMs != null) fields.push(['Duration', `${e.durationMs} ms`])
      if (e.responseType) fields.push(['Type', e.responseType])
      const reqH = headerLines(e.requestHeaders)
      const resH = headerLines(e.responseHeaders)
      if (reqH) blocks.push(['Request headers', reqH])
      if (e.requestBody) blocks.push(['Request body', prettyText(e.requestBody)])
      if (resH) blocks.push(['Response headers', resH])
      if (e.responseBody) blocks.push(['Response body', prettyText(e.responseBody)])
      break
    }
    case 'websocket':
      fields.push(['URL', e.url], ['Event', e.event])
      if (e.code != null) fields.push(['Close code', String(e.code)])
      if (e.reason) fields.push(['Reason', e.reason])
      if (e.sent != null) fields.push(['Sent', `${e.sent} messages`])
      if (e.received != null) fields.push(['Received', `${e.received} messages`])
      break
    case 'resource':
      fields.push(['URL', e.url], ['Initiator', e.initiator], ['Duration', `${e.durationMs} ms`])
      if (e.status != null) fields.push(['Status', String(e.status)])
      if (e.transferSize) fields.push(['Size', formatBytes(e.transferSize)])
      break
    case 'navigation':
      fields.push(['Note', e.note], ['URL', e.url])
      break
  }

  return (
    <div className="relative px-3 pb-3 pt-1 pl-[34px] text-[11px]">
      <button
        onClick={copy}
        title="Copy this entry as JSON"
        className="absolute top-1 right-3 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-text-muted hover:text-text-primary bg-[var(--surface-overlay)] border border-[var(--border)] transition-colors"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pr-20">
        {fields.map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}
      </div>
      {blocks.map(([title, text]) => <Block key={title} title={title} text={text} />)}
    </div>
  )
}

function EntryRow({ e, open, onToggle }: { e: DebugLogEntry; open: boolean; onToggle: () => void }): JSX.Element {
  const problem = isProblem(e)
  const { tag, text, meta } = describeEntry(e)
  return (
    <div className={`border-b border-[var(--border)] border-l-2 ${problem ? 'border-l-red-500/60' : 'border-l-transparent'} ${open ? 'bg-[var(--surface-raised)]' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--surface-overlay)] transition-colors"
      >
        {open ? <ChevronDown size={12} className="shrink-0 text-text-muted" /> : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
        <span className="shrink-0 w-[76px] font-mono tabular-nums text-text-muted">{formatOffset(e.sinceStartMs)}</span>
        <span className={`shrink-0 w-[68px] truncate font-mono text-[10px] uppercase ${tagColor(e, problem)}`}>{tag}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-text-primary">{text}</span>
        {meta && <span className={`shrink-0 max-w-[40%] truncate font-mono tabular-nums ${problem ? 'text-red-400' : 'text-text-muted'}`}>{meta}</span>}
      </button>
      {open && <EntryDetail e={e} />}
    </div>
  )
}

function Environment({ env }: { env: Record<string, unknown> }): JSX.Element | null {
  const rows = Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v)] as const)
  if (!rows.length) return null
  return (
    <details className="px-4 py-2 border-b border-[var(--border)] text-[11px] group">
      <summary className="cursor-pointer select-none text-text-muted text-[10px] font-semibold uppercase tracking-widest list-none flex items-center gap-1">
        <ChevronRight size={12} className="group-open:rotate-90 transition-transform" /> Environment
      </summary>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2 mb-1">
        {rows.map(([k, v]) => <Field key={k} label={k}>{v}</Field>)}
      </div>
    </details>
  )
}

function LogBody({ log }: { log: DebugLog }): JSX.Element {
  const [filter, setFilter] = useState<DebugLogFilter>(log.problems ? 'problems' : 'all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set())
  const q = useDeferredValue(query.trim().toLowerCase())

  const haystacks = useMemo(() => log.entries.map(searchText), [log])
  const shown = useMemo(
    () => log.entries.filter((e, i) => matchesFilter(e, filter) && (!q || haystacks[i].includes(q))),
    [log, filter, q, haystacks],
  )

  const s = log.summary
  const chips: { id: DebugLogFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: log.entries.length },
    { id: 'problems', label: 'Problems', count: log.problems },
    { id: 'requests', label: s.failedRequests ? `Requests (${s.failedRequests} failed)` : 'Requests', count: s.requests },
    { id: 'console', label: 'Console', count: s.console + s.uncaughtErrors },
    { id: 'resources', label: 'Resources', count: s.resources },
    { id: 'websocket', label: 'WebSocket', count: s.websocketEvents },
  ]

  const pick = (f: DebugLogFilter): void => { setFilter(f); setLimit(PAGE) }
  const toggle = (id: number): void => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <>
      {log.warnings.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border)] bg-amber-500/10 text-amber-400 text-[11px] flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-px" />
          <span>{log.warnings.join(' · ')}</span>
        </div>
      )}
      <Environment env={log.environment} />

      <div className="px-4 py-2.5 border-b border-[var(--border)] flex flex-col gap-2 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {chips.filter(c => c.id === 'all' || c.count > 0).map(c => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                filter === c.id
                  ? c.id === 'problems' ? 'bg-red-500/15 border-red-500/40 text-red-400' : 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-[var(--surface-overlay)] border-[var(--border)] text-text-secondary hover:text-text-primary'
              }`}
            >
              {c.label} <span className="tabular-nums opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] focus-within:border-accent/50">
          <Search size={13} className="text-text-muted shrink-0" />
          <input
            value={query}
            onChange={(ev) => { setQuery(ev.target.value); setLimit(PAGE) }}
            placeholder="Search URLs, messages, bodies…"
            className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} title="Clear search" className="text-text-muted hover:text-text-primary">
              <X size={13} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-text-muted text-xs">Nothing matches.</p>
        ) : (
          <>
            {shown.slice(0, limit).map(e => (
              <EntryRow key={e.id} e={e} open={openIds.has(e.id)} onToggle={() => toggle(e.id)} />
            ))}
            {shown.length > limit && (
              <button
                onClick={() => setLimit(l => l + PAGE)}
                className="w-full py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
              >
                Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

export default function DebugLogViewer(): JSX.Element | null {
  const log = useDebugLogViewer((s) => s.log)
  const close = useDebugLogViewer((s) => s.close)
  const open = useDebugLogViewer((s) => s.open)
  const [dragOver, setDragOver] = useState(false)

  const openAnother = (): void => {
    openDebugLogFile().catch((err) => showAppToast(`Couldn’t open that debug log: ${err instanceof Error ? err.message : String(err)}`))
  }
  const hasFiles = (ev: DragEvent): boolean => Array.from(ev.dataTransfer.types).includes('Files')
  const onDrop = (ev: DragEvent): void => {
    if (!hasFiles(ev)) return
    ev.preventDefault()
    setDragOver(false)
    const file = ev.dataTransfer.files[0]
    if (!file) return
    readDebugLogFile(file)
      .then(open)
      .catch((err) => showAppToast(`Couldn’t open ${file.name}: ${err instanceof Error ? err.message : String(err)}`))
  }

  if (!log) return null
  return (
    <ModalOverlay
      onClose={close}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-[880px] h-[85vh] md:h-[720px] max-h-[90vh]"
      minWidth={420} minHeight={360}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
        <div
          className={`bg-surface w-full h-full flex flex-col overflow-hidden ${dragOver ? 'ring-2 ring-inset ring-accent/60' : ''}`}
          onDragOver={(ev) => { if (hasFiles(ev)) { ev.preventDefault(); setDragOver(true) } }}
          onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDragOver(false) }}
          onDrop={onDrop}
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border)] shrink-0" onMouseDown={onHandleMouseDown}>
            <div className="flex items-center gap-2.5 min-w-0">
              <FileJson size={16} className="text-accent shrink-0" />
              <div className="min-w-0">
                <h2 className="text-text-primary font-black text-lg tracking-tight leading-tight truncate">Debug log</h2>
                <p className="text-text-muted text-[11px] truncate" title={log.fileName}>{log.fileName} · {describeLog(log)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={openAnother}
                title="Open another debug log (or drop one here)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary bg-[var(--surface-overlay)] border border-[var(--border)] transition-colors"
              >
                <FolderOpen size={13} /> Open
              </button>
              {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
              <button onClick={close} title="Close" className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>
          {/* Keyed on the file, so swapping logs resets filters and open rows
              without remounting (and re-animating) the panel itself. */}
          <LogBody key={`${log.fileName}:${log.startedAt}:${log.entries.length}`} log={log} />
        </div>
      )}
    </ModalOverlay>
  )
}
