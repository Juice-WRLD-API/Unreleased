import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, BarChart2, Copy, Check, FileText, Gauge, Globe, KeyRound, Layers, Loader2,
  Pause, Play, Radio, RefreshCw, ScrollText, Search as SearchIcon, Server, Shield, ShieldAlert, Tag, Trash2,
  TriangleAlert, Users as UsersIcon, type LucideIcon,
} from 'lucide-react'
import {
  fetchLogFile, fetchLogSources, fetchLogStats, isLogsAccessError, logEntryKey, searchLogEvents,
  LOG_CATEGORIES, LOG_LEVELS,
  type LogCount, type LogEntry, type LogFileTail, type LogFilters, type LogSources, type LogStats, type LogStreamState,
} from '../lib/adminLogsApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage, formatBytes } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { useLogStream, type LiveItem } from '../hooks/useLogStream'
import { useVisitedTabs } from '../hooks/useVisitedTabs'
import { useContentMotion } from '../hooks/useContentMotion'
import { relativeTime } from './adminShared'
import ThemedSelect from './ThemedSelect'
import {
  CATEGORY_ICON, DayDivider, GapNote, LEVEL_STYLE, LogFilterBar, LogListHeader, LogRow, LogsNotice, Segmented,
  STATUS_CLASS_STYLE, fullTime, levelOptions, normalizeLogFilters, type AddLogFilter,
} from './logsShared'

// Admin-only view of the server logs: a dashboard for a time window, the live
// socket, search over the structured log, and the plain-text log files. The
// page itself is gated on administrator + 2FA (AdminPage's OTP gate); the API
// enforces the same and anything it refuses shows as "no access" here.

type LogsView = 'overview' | 'live' | 'search' | 'files'
type RangePreset = '15m' | '1h' | '24h' | '7d' | '30d' | 'custom'
interface SearchRange { preset: RangePreset; since?: string; until?: string }

const n = (v: number | undefined): string => (v ?? 0).toLocaleString()
const pct = (part: number, total: number): string => {
  if (!total) return '0%'
  const p = (part / total) * 100
  return p > 0 && p < 0.1 ? '<0.1%' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

export default function LogsTab({ active }: { active: boolean }): JSX.Element {
  const [view, setView] = useState<LogsView>('overview')
  const [filters, setFilters] = useState<LogFilters>({})
  const applied = useMemo(() => normalizeLogFilters(filters), [filters])
  const [range, setRange] = useState<SearchRange>({ preset: '24h' })
  const [sources, setSources] = useState<LogSources | null>(null)
  const [sourcesError, setSourcesError] = useState<unknown>(null)
  const [sourcesKey, setSourcesKey] = useState(0)

  const visited = useVisitedTabs(view)
  // The socket opens once Live has been looked at, then stays open while this
  // tab is showing so switching to Search and back keeps the stream.
  const live = useLogStream(applied, active && visited.has('live'))

  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, view)

  useEffect(() => {
    if (!active || sources) return
    const ac = new AbortController()
    setSourcesError(null)
    fetchLogSources(ac.signal).then(setSources).catch((e) => { if (!isAbortError(e)) setSourcesError(e) })
    return () => ac.abort()
  }, [active, sources, sourcesKey])

  const setFilter = useCallback<AddLogFilter>((key, value) => setFilters((f) => ({ ...f, [key]: value })), [])
  const clearFilters = useCallback(() => setFilters({}), [])
  const openSearch = useCallback((next: LogFilters, since: RangePreset) => {
    setFilters(next)
    setRange({ preset: since })
    setView('search')
  }, [])

  if (isLogsAccessError(sourcesError)) return (
    <LogsNotice icon={Shield} title="No access to logs" tone="error">
      Logs are for administrators with two-factor turned on. {errorMessage(sourcesError, '')}
    </LogsNotice>
  )

  const categories = sources?.categories?.length ? sources.categories : LOG_CATEGORIES
  const levels = sources?.levels?.length ? sources.levels : LOG_LEVELS
  const streaming = visited.has('live') && active

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-3 pb-3 flex items-center gap-3">
        <Segmented value={view} onChange={setView} options={[
          { value: 'overview', label: <><BarChart2 size={12} /> Overview</> },
          { value: 'live', label: <><LiveDot state={streaming ? live.state : 'closed'} paused={live.paused} /> Live</> },
          { value: 'search', label: <><SearchIcon size={12} /> Search</> },
          { value: 'files', label: <><FileText size={12} /> Files</> },
        ]} />
        <div className="flex-1" />
        {sourcesError != null && (
          <button onClick={() => setSourcesKey((k) => k + 1)} className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:underline">
            <AlertCircle size={12} /> Couldn’t load log sources. Retry
          </button>
        )}
      </div>

      {(view === 'live' || view === 'search') && (
        <div className="shrink-0 px-6 pb-3">
          <LogFilterBar filters={filters} onSet={setFilter} onClear={clearFilters} levels={levels} categories={categories} />
        </div>
      )}

      <div ref={contentRef} className="flex-1 min-h-0 relative">
        {visited.has('overview') && (
          <div className={view === 'overview' ? 'h-full' : 'hidden'}>
            <OverviewView active={active && view === 'overview'} onOpenSearch={openSearch} />
          </div>
        )}
        {visited.has('live') && (
          <div className={view === 'live' ? 'h-full' : 'hidden'}>
            <LiveView live={live} onFilter={setFilter} />
          </div>
        )}
        {visited.has('search') && (
          <div className={view === 'search' ? 'h-full' : 'hidden'}>
            <SearchView active={active && view === 'search'} filters={applied} range={range} setRange={setRange} onFilter={setFilter} />
          </div>
        )}
        {visited.has('files') && (
          <div className={view === 'files' ? 'h-full' : 'hidden'}>
            <FilesView active={active && view === 'files'} sources={sources} levels={levels} onOpenSearch={() => setView('search')} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function LiveDot({ state, paused }: { state: LogStreamState; paused: boolean }): JSX.Element {
  if (state === 'live' && !paused) return (
    <span className="relative flex w-2 h-2">
      <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
      <span className="relative w-2 h-2 rounded-full bg-emerald-400" />
    </span>
  )
  if (state === 'live' && paused) return <span className="w-2 h-2 rounded-full bg-amber-400" />
  if (state === 'connecting' || state === 'reconnecting') return <span className="w-2 h-2 rounded-full bg-amber-400 motion-safe:animate-pulse" />
  return <Radio size={12} />
}

function Banner({ tone = 'warn', children }: { tone?: 'warn' | 'error'; children: ReactNode }): JSX.Element {
  const cls = tone === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
  return (
    <div className={`shrink-0 flex items-start gap-2 px-3 py-2 mb-2.5 rounded-xl border text-xs ${cls}`}>
      {tone === 'error' ? <AlertCircle size={13} className="shrink-0 mt-0.5" /> : <TriangleAlert size={13} className="shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ToolButton({ onClick, disabled, icon: Icon, label, spin, title }: {
  onClick: () => void; disabled?: boolean; icon: LucideIcon; label?: string; spin?: boolean; title?: string
}): JSX.Element {
  return (
    <button onClick={onClick} disabled={disabled} title={title ?? label}
      className="shrink-0 h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40">
      <Icon size={12} className={spin ? 'animate-spin' : ''} />{label}
    </button>
  )
}

/** Entries newest first, with a day label wherever the local date changes. */
function LogItems({ items, onFilter }: { items: LiveItem[]; onFilter: AddLogFilter }): JSX.Element {
  const out: JSX.Element[] = []
  let day = ''
  for (const it of items) {
    if (it.kind === 'gap') { out.push(<GapNote key={it.key} text={it.text} />); continue }
    const d = new Date(it.entry.ts)
    const ds = d.toDateString()
    if (ds !== day) { day = ds; out.push(<DayDivider key={`day-${ds}`} date={d} />) }
    out.push(<LogRow key={it.key} entry={it.entry} onFilter={onFilter} />)
  }
  return <>{out}</>
}

function ListCard({ children, overlay }: { children: ReactNode; overlay?: ReactNode }): JSX.Element {
  return (
    <div className="flex-1 min-h-0 relative flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <LogListHeader />
      {overlay}
      {children}
    </div>
  )
}

// ── Live ─────────────────────────────────────────────────────────────────────

const STREAM_LABEL: Record<LogStreamState, string> = {
  connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', denied: 'No access', invalid: 'Filters refused', closed: 'Stopped',
}

function LiveView({ live, onFilter }: { live: ReturnType<typeof useLogStream>; onFilter: AddLogFilter }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const entries = live.items.filter((i) => i.kind === 'entry').length
  const jumpToNew = (): void => {
    live.resume()
    scrollRef.current?.scrollTo({ top: 0 })
  }

  let empty: JSX.Element
  if (live.state === 'denied') {
    empty = <LogsNotice icon={Shield} title="No access to the live log" tone="error">{live.detail}</LogsNotice>
  } else if (live.state === 'invalid') {
    empty = <LogsNotice icon={TriangleAlert} title="The server refused these filters" tone="warn">{live.detail} Change a filter to try again.</LogsNotice>
  } else if (live.state === 'connecting' || live.state === 'reconnecting') {
    empty = <LogsNotice icon={Loader2} spin title={STREAM_LABEL[live.state]} />
  } else {
    empty = (
      <LogsNotice icon={Radio} title="Listening for new entries">
        Entries that match your filters appear here as the server writes them.
      </LogsNotice>
    )
  }

  return (
    <div className="h-full flex flex-col px-6 pb-4">
      <div className="shrink-0 flex items-center gap-3 pb-2.5">
        <span className={`flex items-center gap-2 h-7 px-2.5 rounded-lg text-[11px] font-semibold ${
          live.state === 'live' && !live.paused ? 'bg-emerald-500/10 text-emerald-400'
            : live.state === 'denied' ? 'bg-red-500/10 text-red-400'
            : 'bg-amber-500/10 text-amber-400'
        }`}>
          <LiveDot state={live.state} paused={live.paused} />
          {live.paused && live.state === 'live' ? 'Paused' : STREAM_LABEL[live.state]}
        </span>
        <span className="text-[11px] text-text-muted tabular-nums">
          {entries.toLocaleString()} {entries === 1 ? 'entry' : 'entries'}{entries >= 2000 ? ' · keeping the newest 2,000' : ''}
        </span>
        <div className="flex-1" />
        {live.paused
          ? <ToolButton onClick={live.resume} icon={Play} label={live.newCount ? `Resume (${live.newCount.toLocaleString()} new)` : 'Resume'} />
          : <ToolButton onClick={live.pause} icon={Pause} label="Pause" title="Keep receiving, but hold new entries until you resume" />}
        <ToolButton onClick={live.clear} icon={Trash2} label="Clear" disabled={live.items.length === 0} />
      </div>

      {live.error && live.state !== 'invalid' && <Banner>{live.error}</Banner>}

      <ListCard overlay={live.paused && live.newCount > 0 && (
        <button onClick={jumpToNew}
          className="absolute top-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-[var(--bg)] text-[11px] font-semibold shadow-lg hover:bg-accent/90 transition-colors">
          <ArrowUp size={12} /> {live.newCount.toLocaleString()} new
        </button>
      )}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {live.items.length === 0 ? empty : <LogItems items={live.items} onFilter={onFilter} />}
        </div>
      </ListCard>
    </div>
  )
}

// ── Search ───────────────────────────────────────────────────────────────────

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: '15m', label: '15m' }, { value: '1h', label: '1h' }, { value: '24h', label: '24h' },
  { value: '7d', label: '7d' }, { value: '30d', label: '30d' }, { value: 'custom', label: 'Custom' },
]

const localToIso = (v?: string): string | undefined => {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** A datetime-local value for `hoursAgo` back from now, in local time. */
function localInput(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 3600_000)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

interface SearchState { results: LogEntry[]; next: string | null; scanned: number; truncated: boolean }

function SearchView({ active, filters, range, setRange, onFilter }: {
  active: boolean
  filters: LogFilters
  range: SearchRange
  setRange: (r: SearchRange) => void
  onFilter: AddLogFilter
}): JSX.Element {
  const [res, setRes] = useState<SearchState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const time = useMemo(() => (range.preset === 'custom'
    ? { since: localToIso(range.since), until: localToIso(range.until) }
    : { since: range.preset, until: undefined }), [range])
  const baseKey = JSON.stringify([filters, time])
  // A larger scan only applies to the search it was asked for.
  const [scan, setScan] = useState<{ forKey: string; mb: number } | null>(null)
  const scanMb = scan?.forKey === baseKey ? scan.mb : undefined

  const abortRef = useRef<AbortController | null>(null)
  const loadedKey = useRef<string | null>(null)
  const key = `${baseKey}|${scanMb ?? ''}|${refreshKey}`

  const run = useCallback(async (before?: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    if (before) setLoadingMore(true); else setLoading(true)
    setError(null)
    try {
      const r = await searchLogEvents({ ...filters, ...time, before, limit: 100, scan_mb: scanMb }, ac.signal)
      setRes((prev) => (before && prev
        ? { results: [...prev.results, ...r.results], next: r.next_before, scanned: prev.scanned + r.scanned_lines, truncated: r.scan_truncated }
        : { results: r.results, next: r.next_before, scanned: r.scanned_lines, truncated: r.scan_truncated }))
    } catch (e) {
      if (!isAbortError(e)) setError(e)
    } finally {
      if (abortRef.current === ac) { setLoading(false); setLoadingMore(false) }
    }
  }, [filters, time, scanMb])

  useEffect(() => {
    if (!active || loadedKey.current === key) return
    loadedKey.current = key
    void run()
  }, [active, key, run])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Identical entries can repeat in a result page; keys stay unique anyway.
  const items = useMemo<LiveItem[]>(() => {
    const counts = new Map<string, number>()
    return (res?.results ?? []).map((entry) => {
      const k = logEntryKey(entry)
      const c = counts.get(k) ?? 0
      counts.set(k, c + 1)
      return { kind: 'entry', key: c ? `${k}#${c}` : k, entry }
    })
  }, [res])

  const nextScan = Math.min(512, (scanMb ?? 64) * 2)

  return (
    <div className="h-full flex flex-col px-6 pb-4">
      <div className="shrink-0 flex items-center gap-3 pb-2.5 flex-wrap">
        <Segmented size="sm" value={range.preset} options={RANGE_OPTIONS}
          onChange={(p) => setRange(p === 'custom'
            ? { preset: 'custom', since: range.since ?? localInput(24), until: range.until }
            : { preset: p })} />
        {range.preset === 'custom' && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <input type="datetime-local" value={range.since ?? ''} onChange={(e) => setRange({ ...range, since: e.target.value })}
              className="h-7 px-2 rounded-lg bg-surface-overlay text-text-primary text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/40" />
            to
            <input type="datetime-local" value={range.until ?? ''} onChange={(e) => setRange({ ...range, until: e.target.value })}
              className="h-7 px-2 rounded-lg bg-surface-overlay text-text-primary text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/40" />
            {!range.until && <span className="text-text-muted/70">now</span>}
          </div>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-text-muted tabular-nums">
          {loading ? 'Searching…' : res ? `${res.results.length.toLocaleString()} ${res.results.length === 1 ? 'result' : 'results'} · ${res.scanned.toLocaleString()} lines read` : ''}
        </span>
        <ToolButton onClick={() => setRefreshKey((k) => k + 1)} icon={RefreshCw} spin={loading} disabled={loading} title="Search again" />
      </div>

      {res?.truncated && !loading && (
        <Banner>
          The search stopped before covering the whole range, so older matches may exist. Narrow the time range
          {(scanMb ?? 64) < 512 && (
            <>, or <button onClick={() => setScan({ forKey: baseKey, mb: nextScan })} className="font-semibold underline underline-offset-2 hover:text-amber-300">read more ({nextScan} MB)</button></>
          )}.
        </Banner>
      )}
      {error != null && !isLogsAccessError(error) && (
        <Banner tone="error">
          {errorMessage(error, 'Search failed')}{' '}
          <button onClick={() => setRefreshKey((k) => k + 1)} className="font-semibold underline underline-offset-2">Try again</button>
        </Banner>
      )}

      <ListCard>
        <div className="flex-1 overflow-y-auto relative">
          {loading && res && (
            <div className="sticky top-0 z-[2] h-0.5 bg-accent/60 motion-safe:animate-pulse" />
          )}
          {isLogsAccessError(error) ? (
            <LogsNotice icon={Shield} title="No access to logs" tone="error">{errorMessage(error, '')}</LogsNotice>
          ) : !res ? (
            loading ? <LogsNotice icon={Loader2} spin title="Searching…" /> : null
          ) : items.length === 0 ? (
            <LogsNotice icon={SearchIcon} title="No matching entries">Try a wider time range or fewer filters.</LogsNotice>
          ) : (
            <>
              <LogItems items={items} onFilter={onFilter} />
              <div className="flex justify-center py-4">
                {res.next ? (
                  <button onClick={() => void run(res.next ?? undefined)} disabled={loadingMore}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-overlay text-[11px] font-semibold text-text-primary hover:bg-surface-raised transition-colors disabled:opacity-50">
                    {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />} Load older
                  </button>
                ) : (
                  <span className="text-[10px] text-text-muted">End of results</span>
                )}
              </div>
            </>
          )}
        </div>
      </ListCard>
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

const WINDOWS: { value: '1h' | '24h' | '7d' | '30d'; label: string; hours: number }[] = [
  { value: '1h', label: '1 hour', hours: 1 },
  { value: '24h', label: '24 hours', hours: 24 },
  { value: '7d', label: '7 days', hours: 168 },
  { value: '30d', label: '30 days', hours: 720 },
]

/** "GET /juicewrld/files/" -> method and path filters. */
function routeFilters(key: string): LogFilters {
  const [method, ...rest] = key.split(' ')
  return rest.length ? { method, path: rest.join(' ') } : { path: key }
}

function OverviewView({ active, onOpenSearch }: { active: boolean; onOpenSearch: (f: LogFilters, since: RangePreset) => void }): JSX.Element {
  const [win, setWin] = useState<typeof WINDOWS[number]['value']>('24h')
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const loadedKey = useRef<string | null>(null)

  useEffect(() => {
    const key = `${win}|${refreshKey}`
    if (!active || loadedKey.current === key) return
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchLogStats({ hours: WINDOWS.find((w) => w.value === win)?.hours ?? 24 }, ac.signal)
      // Marked loaded only once it lands, so leaving mid-request fetches again on return.
      .then((s) => { loadedKey.current = key; setStats(s) })
      .catch((e) => { if (!isAbortError(e)) setError(e) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [active, win, refreshKey])

  const open = (f: LogFilters): void => onOpenSearch(f, win)

  if (isLogsAccessError(error)) return <LogsNotice icon={Shield} title="No access to logs" tone="error">{errorMessage(error, '')}</LogsNotice>
  if (!stats) return error == null || loading
    ? <LogsNotice icon={Loader2} spin title="Reading the logs…" />
    : <LogsNotice icon={AlertCircle} title="Couldn’t load the overview" tone="error">
        {errorMessage(error, '')}{' '}
        <button onClick={() => setRefreshKey((k) => k + 1)} className="text-accent hover:underline">Try again</button>
      </LogsNotice>

  const levels = stats.levels ?? {}
  const errors = (levels.ERROR ?? 0) + (levels.CRITICAL ?? 0)
  const statuses = stats.request_statuses ?? {}
  const requests = Object.values(statuses).reduce<number>((a, b) => a + (b ?? 0), 0)
  const categories = Object.entries(stats.categories ?? {})
    .map(([key, count]) => ({ key, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="h-full overflow-y-auto px-6 pb-6">
      <div className="flex items-center gap-3 pb-3 flex-wrap">
        <Segmented size="sm" value={win} onChange={setWin} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
        <span className="text-[11px] text-text-muted">
          {stats.oldest_scanned ? `Back to ${fullTime(new Date(stats.oldest_scanned))}` : 'Nothing logged in this window'}
        </span>
        <div className="flex-1" />
        <ToolButton onClick={() => setRefreshKey((k) => k + 1)} icon={RefreshCw} spin={loading} disabled={loading} title="Refresh" />
      </div>

      {stats.scan_truncated && (
        <Banner>The server stopped reading before the start of this window, so these numbers cover less than {WINDOWS.find((w) => w.value === win)?.label}.</Banner>
      )}
      {error != null && <Banner tone="error">{errorMessage(error, 'Couldn’t refresh')}</Banner>}

      <div className={`space-y-3 transition-opacity duration-300 ${loading ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
          <StatTile icon={Activity} value={n(stats.total)} label="Entries" onClick={() => open({})} />
          <StatTile icon={AlertCircle} tone="red" value={n(errors)} label="Errors" hint={pct(errors, stats.total)} onClick={() => open({ level: 'ERROR' })} />
          <StatTile icon={TriangleAlert} tone="amber" value={n(levels.WARNING)} label="Warnings" hint={pct(levels.WARNING ?? 0, stats.total)} onClick={() => open({ level: 'WARNING' })} />
          <StatTile icon={Server} tone="red" value={n(statuses['5xx'])} label="Server errors" hint={requests ? `${pct(statuses['5xx'] ?? 0, requests)} of requests` : undefined} onClick={() => open({ category: 'request', status: '5xx' })} />
          <StatTile icon={ShieldAlert} value={n(stats.categories?.security)} label="Security" onClick={() => open({ category: 'security' })} />
          <StatTile icon={ScrollText} value={n(stats.categories?.audit)} label="Audit" onClick={() => open({ category: 'audit' })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card icon={Layers} title="Levels" hint={`${n(stats.total)} entries`}>
            <Breakdown total={stats.total} onPick={(k) => open({ level: k })}
              parts={LOG_LEVELS.map((l) => ({ key: l, label: LEVEL_STYLE[l].label, count: levels[l] ?? 0, bar: LEVEL_STYLE[l].bar }))} />
          </Card>
          <Card icon={Globe} title="Requests" hint={`${n(requests)} requests`}>
            <Breakdown total={requests} onPick={(k) => open({ category: 'request', status: k })}
              parts={(['2xx', '3xx', '4xx', '5xx'] as const).map((c) => ({ key: c, label: `${c} ${STATUS_CLASS_STYLE[c].label.toLowerCase()}`, count: statuses[c] ?? 0, bar: STATUS_CLASS_STYLE[c].bar }))} />
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card icon={Tag} title="Categories">
            <BarList rows={categories} empty="Nothing in this window" onPick={(k) => open({ category: k })}
              label={(k) => {
                const Icon = CATEGORY_ICON[k as keyof typeof CATEGORY_ICON]
                return <span className="flex items-center gap-1.5">{Icon && <Icon size={11} className="text-text-muted shrink-0" />}{k}</span>
              }} />
          </Card>
          <Card icon={ScrollText} title="Events" hint="Top 10">
            <BarList rows={stats.events ?? []} mono empty="No events in this window" onPick={(k) => open({ event: k })} />
          </Card>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          <Card icon={AlertCircle} title="Top errors">
            <BarList rows={stats.top_errors ?? []} empty="No errors" onPick={(k) => open({ level: 'ERROR', q: k.slice(0, 200) })} />
          </Card>
          <Card icon={Server} title="Failing routes" hint="5xx">
            <BarList rows={stats.top_server_error_paths ?? []} mono empty="No server errors" onPick={(k) => open({ ...routeFilters(k), status: '5xx' })} />
          </Card>
          <Card icon={Gauge} title="Slow routes" hint="Over 2 s">
            <BarList rows={stats.top_slow_paths ?? []} mono empty="Nothing slow" onPick={(k) => open({ ...routeFilters(k), category: 'performance' })} />
          </Card>
          <Card icon={ShieldAlert} title="Denied IPs" hint="401 · 403 · 429">
            <BarList rows={stats.top_denied_ips ?? []} mono empty="No denials" onPick={(k) => open({ ip: k, event: 'access.' })} />
          </Card>
          <Card icon={KeyRound} title="Failed sign-ins" hint="By IP">
            <BarList rows={stats.top_failed_login_ips ?? []} mono empty="No failed sign-ins" onPick={(k) => open({ ip: k, event: 'auth.login_failed' })} />
          </Card>
          <Card icon={UsersIcon} title="Most active users">
            <BarList rows={stats.most_active_users ?? []} empty="No signed-in activity" onPick={(k) => open({ user: k })} />
          </Card>
        </div>
      </div>
    </div>
  )
}

const TILE_TONE = {
  accent: 'bg-accent/10 text-accent',
  red: 'bg-red-500/10 text-red-400',
  amber: 'bg-amber-500/10 text-amber-400',
}

function StatTile({ icon: Icon, value, label, hint, tone = 'accent', onClick }: {
  icon: LucideIcon; value: string; label: string; hint?: string; tone?: keyof typeof TILE_TONE; onClick: () => void
}): JSX.Element {
  return (
    <button onClick={onClick} title={`Search: ${label.toLowerCase()}`}
      className="group min-w-0 text-left rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 hover:bg-surface-raised/50 transition-colors">
      <div className="flex items-center justify-between">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${TILE_TONE[tone]}`}><Icon size={14} /></span>
        <SearchIcon size={11} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="mt-3 text-xl font-bold tabular-nums text-text-primary truncate">{value}</p>
      <p className="text-[11px] text-text-muted truncate">{label}{hint && <span className="text-text-muted/70"> · {hint}</span>}</p>
    </button>
  )
}

function Card({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="flex items-center gap-2 mb-3">
        <Icon size={13} className="text-text-muted shrink-0" />
        <h3 className="flex-1 min-w-0 truncate text-xs font-semibold text-text-primary">{title}</h3>
        {hint && <span className="shrink-0 text-[10px] text-text-muted">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

/** A stacked bar of the parts, then a legend that doubles as the table. */
function Breakdown({ parts, total, onPick }: {
  parts: { key: string; label: string; count: number; bar: string }[]
  total: number
  onPick: (key: string) => void
}): JSX.Element {
  if (!total) return <p className="py-4 text-center text-[11px] text-text-muted">Nothing in this window</p>
  return (
    <>
      <div className="flex h-2.5 gap-[2px]">
        {parts.filter((p) => p.count > 0).map((p) => (
          <div key={p.key} className={`${p.bar} rounded-[4px] min-w-[4px]`} style={{ flexGrow: p.count, flexBasis: 0 }}
            title={`${p.label}: ${p.count.toLocaleString()} (${pct(p.count, total)})`} />
        ))}
      </div>
      <div className="mt-3 -mx-2">
        {parts.map((p) => (
          <button key={p.key} onClick={() => onPick(p.key)} disabled={!p.count}
            className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg text-[11px] hover:bg-surface-raised/60 transition-colors disabled:hover:bg-transparent disabled:cursor-default">
            <span className={`w-2 h-2 rounded-full shrink-0 ${p.bar} ${p.count ? '' : 'opacity-30'}`} />
            <span className={`flex-1 text-left truncate ${p.count ? 'text-text-primary' : 'text-text-muted'}`}>{p.label}</span>
            <span className="tabular-nums font-semibold text-text-primary">{p.count.toLocaleString()}</span>
            <span className="w-11 text-right tabular-nums text-text-muted">{pct(p.count, total)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function BarList({ rows, mono, empty, onPick, label }: {
  rows: LogCount[]
  mono?: boolean
  empty: string
  onPick: (key: string) => void
  label?: (key: string) => ReactNode
}): JSX.Element {
  if (rows.length === 0) return <p className="py-4 text-center text-[11px] text-text-muted">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="-mx-2">
      {rows.map((r) => (
        <button key={r.key} onClick={() => onPick(r.key)} title={r.key}
          className="w-full block px-2 py-1.5 rounded-lg text-left hover:bg-surface-raised/60 transition-colors">
          <span className="flex items-baseline gap-3">
            <span className={`flex-1 min-w-0 truncate text-[11px] text-text-primary ${mono ? 'font-mono' : ''}`}>{label ? label(r.key) : r.key}</span>
            <span className="shrink-0 tabular-nums text-[11px] font-semibold text-text-primary">{r.count.toLocaleString()}</span>
          </span>
          <span className="mt-1 block h-1 rounded-full bg-surface-overlay overflow-hidden">
            <span className="block h-full rounded-full bg-accent/60" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Files ────────────────────────────────────────────────────────────────────

const LINE_OPTIONS = ['200', '500', '1000', '2000'].map((v) => ({ value: v, label: `Last ${Number(v).toLocaleString()} lines` }))

function lineTone(line: string): string {
  const head = line.slice(0, 96)
  if (/\b(CRITICAL|ERROR)\b/.test(head)) return 'text-red-400'
  if (/\bWARNING\b/.test(head)) return 'text-amber-400'
  // Traceback and other continuation lines have no "[time] LEVEL" prefix.
  if (/\bDEBUG\b/.test(head) || !line.startsWith('[')) return 'text-text-muted'
  return 'text-text-primary/90'
}

/** The line with every case-insensitive match of `q` marked. Plain text only. */
function Highlighted({ text, q }: { text: string; q: string }): JSX.Element {
  const needle = q.trim().toLowerCase()
  if (!needle) return <>{text}</>
  const out: ReactNode[] = []
  const lower = text.toLowerCase()
  let i = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, i)) {
    if (at > i) out.push(text.slice(i, at))
    out.push(<mark key={at} className="bg-accent/25 text-inherit rounded-sm">{text.slice(at, at + needle.length)}</mark>)
    i = at + needle.length
  }
  out.push(text.slice(i))
  return <>{out}</>
}

function FilesView({ active, sources, levels, onOpenSearch }: {
  active: boolean
  sources: LogSources | null
  levels: string[]
  onOpenSearch: () => void
}): JSX.Element {
  const textSources = useMemo(() => (sources?.sources ?? []).filter((s) => s.format === 'text'), [sources])
  const structured = sources?.sources.find((s) => s.format === 'jsonl')
  const [name, setName] = useState<string | null>(null)
  const [lines, setLines] = useState('200')
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const [qDraft, setQDraft] = useState('')
  const [tail, setTail] = useState<LogFileTail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [copied, setCopied] = useState(false)

  const selected = name ?? (textSources.find((s) => s.name === 'errors.log') ?? textSources[0])?.name ?? null

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qDraft), 450)
    return () => window.clearTimeout(t)
  }, [qDraft])

  useEffect(() => {
    if (!active || !selected) return
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchLogFile(selected, { lines: Number(lines), level: level || undefined, q: q.trim() || undefined }, ac.signal)
      .then(setTail)
      .catch((e) => { if (!isAbortError(e)) setError(e) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [active, selected, lines, level, q, refreshKey])

  if (!sources) return <LogsNotice icon={Loader2} spin title="Loading log files…" />
  if (textSources.length === 0) return <LogsNotice icon={FileText} title="No text logs yet">The server hasn’t written any of its text log files.</LogsNotice>

  const shown = tail && tail.name === selected ? tail : null

  return (
    <div className="h-full flex px-6 pb-4 gap-4">
      <aside className="w-[220px] shrink-0 flex flex-col gap-3 overflow-y-auto">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5">
          <p className="px-2 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-text-muted/70">Text logs</p>
          {textSources.map((s) => (
            <button key={s.name} onClick={() => setName(s.name)}
              className={`w-full text-left px-2.5 py-2 rounded-xl transition-colors ${selected === s.name ? 'bg-accent/10' : 'hover:bg-surface-raised/60'}`}>
              <span className={`flex items-center gap-2 font-mono text-[11px] ${selected === s.name ? 'text-accent' : 'text-text-primary'}`}>
                <FileText size={12} className="shrink-0 opacity-70" />{s.name}
              </span>
              <span className="block pl-5 mt-0.5 text-[10px] text-text-muted truncate">
                {formatBytes(s.size)}{s.backups ? ` · +${s.backups} rotated` : ''} · {relativeTime(s.modified)}
              </span>
            </button>
          ))}
        </div>
        {structured && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70">Structured log</p>
            <p className="mt-1.5 font-mono text-[11px] text-text-primary">{structured.name}</p>
            <p className="mt-0.5 text-[10px] text-text-muted">
              {formatBytes(structured.size)}{structured.backups ? ` · ${formatBytes(structured.total_size)} with ${structured.backups} rotated` : ''}
            </p>
            <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
              Live and <button onClick={onOpenSearch} className="text-accent hover:underline">Search</button> read this one.
            </p>
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-2 pb-2.5">
          <div className="relative flex-1 min-w-0 flex items-center">
            <SearchIcon size={12} className="absolute left-2.5 text-text-muted pointer-events-none" />
            <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'Enter') setQ(qDraft); if (e.key === 'Escape' && qDraft) { e.stopPropagation(); setQDraft(''); setQ('') } }}
              placeholder={`Search ${selected ?? ''}`}
              className="w-full h-8 bg-surface-overlay rounded-lg pl-7 pr-2.5 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 transition-shadow" />
          </div>
          <ThemedSelect value={level} onChange={setLevel} options={levelOptions(levels)}
            className="shrink-0 w-[150px] h-8 bg-surface-overlay text-text-primary text-[11px] px-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40" />
          <ThemedSelect value={lines} onChange={setLines} options={LINE_OPTIONS}
            className="shrink-0 w-[150px] h-8 bg-surface-overlay text-text-primary text-[11px] px-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40" />
          <ToolButton onClick={() => setRefreshKey((k) => k + 1)} icon={RefreshCw} spin={loading} disabled={loading} title="Reload" />
        </div>

        {level && <Banner>Traceback lines have no level, so a level filter hides them. Search for text instead to find them.</Banner>}
        {error != null && <Banner tone="error">{errorMessage(error, 'Couldn’t read the file')}</Banner>}

        <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="shrink-0 flex items-center gap-3 h-9 px-4 border-b border-[var(--border)]">
            <span className="font-mono text-[11px] font-semibold text-text-primary">{selected}</span>
            <span className="flex-1 min-w-0 truncate text-[10px] text-text-muted">
              {shown ? `${shown.count.toLocaleString()} ${shown.count === 1 ? 'line' : 'lines'}, newest first · ${shown.scanned_lines.toLocaleString()} read${shown.scan_truncated ? ' · stopped early' : ''}` : ''}
            </span>
            {shown && shown.lines.length > 0 && (
              <button onClick={() => copyText(shown.lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {})}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <div className={`flex-1 overflow-auto py-2 transition-opacity duration-300 ${loading && shown ? 'opacity-60' : ''}`}>
            {!shown ? (
              loading ? <LogsNotice icon={Loader2} spin title="Reading…" /> : null
            ) : shown.lines.length === 0 ? (
              <LogsNotice icon={FileText} title="No matching lines">{q || level ? 'Try another search or level.' : 'This file is empty.'}</LogsNotice>
            ) : (
              shown.lines.map((line, i) => (
                <div key={i} className={`px-4 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all select-text hover:bg-surface-raised/40 [content-visibility:auto] [contain-intrinsic-size:auto_20px] ${lineTone(line)}`}>
                  <Highlighted text={line} q={q} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
