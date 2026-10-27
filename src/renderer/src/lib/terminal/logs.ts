import {
  fetchLogFile, fetchLogSources, fetchLogStats, openLogStream, searchLogEvents,
  LOG_FILE_NAMES, LOG_FILTER_KEYS, type LogCount, type LogEntry, type LogFilters, type LogStream,
} from '../adminLogsApi'
import { formatBytes } from '../format'
import { relativeTime } from '../../components/adminShared'
import { asJson, fail, oneLine, parseArgs, table, type TermCommand, type TermCtx, type TermTone } from './types'

// The Admin page's Logs tab: search the structured server log, the dashboard
// numbers for a window, the plain-text log files, and the live stream (until
// Ctrl+C). Administrators with 2FA only - the API refuses everyone else.

const SUBS = ['stats', 'files', 'file', 'tail'] as const
const VALUED = [...LOG_FILTER_KEYS, 'since', 'until', 'before', 'limit', 'scan', 'hours', 'lines', 'backlog']

/** Filter flags, plus any leftover words as the text search. */
function filtersFrom(value: Map<string, string>, rest: string[]): LogFilters {
  const f: LogFilters = {}
  for (const k of LOG_FILTER_KEYS) {
    const v = value.get(k)?.trim()
    if (v) f[k] = k === 'level' || k === 'method' ? v.toUpperCase() : v
  }
  if (rest.length && !f.q) f.q = rest.join(' ')
  return f
}

const num = (v: string | undefined, flag: string): number | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fail(`--${flag} takes a positive number`)
}

const stamp = (ts: string): string => {
  const d = new Date(ts)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour12: false })}`
}

function entryLine(e: LogEntry): string {
  const what = e.category === 'request' && e.method && e.path
    ? `${e.method} ${e.path}${e.status != null ? ` ${e.status}` : ''}${e.duration != null ? ` ${Math.round(e.duration)}ms` : ''}`
    : e.msg
  return `${stamp(e.ts)}  ${e.level.padEnd(8)} ${e.category.padEnd(12)} ${oneLine(what, 100)}${e.user ? `  · ${e.user}` : ''}`
}

const entryTone = (e: LogEntry): TermTone =>
  e.level === 'ERROR' || e.level === 'CRITICAL' ? 'error' : e.level === 'DEBUG' ? 'dim' : 'plain'

const counts = (rec: Partial<Record<string, number>> | undefined): string =>
  Object.entries(rec ?? {}).filter(([, c]) => c).map(([k, c]) => `${k} ${(c ?? 0).toLocaleString()}`).join(' · ') || '—'

const top = (title: string, rows: LogCount[] | undefined): string[] =>
  rows?.length ? [title, ...rows.map((r) => `  ${r.count.toLocaleString().padStart(7)}  ${oneLine(r.key, 90)}`)] : []

async function tail(filters: LogFilters, backlog: number, ctx: TermCtx): Promise<void> {
  if (ctx.scripted) fail('logs tail runs until Ctrl+C, so it can’t run from a script')
  await new Promise<void>((resolve, reject) => {
    let stream: LogStream | null = null
    const stop = (): void => { stream?.close(); resolve() }
    stream = openLogStream(filters, backlog, {
      onFrame: (f) => {
        if (f.type === 'connected') ctx.print('connected · Ctrl+C to stop', 'dim')
        else if (f.type === 'error') ctx.print(f.detail, 'error')
        else if (f.type === 'backlog' || f.type === 'events') {
          if (f.type === 'events' && f.skipped_bytes > 0) ctx.print('… fell behind and skipped ahead - search with `logs` to see what was missed', 'dim')
          else if (f.type === 'events' && f.dropped > 0) ctx.print(`… ${f.dropped.toLocaleString()} entries skipped in a burst`, 'dim')
          for (const e of f.results) ctx.print(entryLine(e), entryTone(e))
        }
      },
      onState: (s, detail) => {
        if (s === 'reconnecting') ctx.print('reconnecting…', 'dim')
        if (s === 'denied' || s === 'invalid') {
          ctx.signal.removeEventListener('abort', stop)
          stream?.close()
          reject(new Error(detail ?? (s === 'denied' ? 'no access to the live log' : 'the server refused these filters')))
        }
      },
    })
    if (ctx.signal.aborted) stop()
    else ctx.signal.addEventListener('abort', stop, { once: true })
  })
}

export const LOG_COMMANDS: TermCommand[] = [
  {
    name: 'logs', aliases: ['serverlog'], group: 'Admin',
    usage: 'logs [text] [--level L] [--category a,b] [--event e] [--user u] [--ip x] [--method M] [--path p] [--status 5xx] [--logger l] [--channel comp] [--since 1h] [--until t] [--before t] [--limit N] [--scan MB] [--json]  ·  logs tail [filters] [--backlog N]  ·  logs stats [--hours N | --since 2h]  ·  logs files  ·  logs file <name> [text] [--lines N] [--level L]',
    description: 'The server logs (the Admin page’s Logs tab): search entries newest first, watch them live, the numbers for a window, or the tail of a text log',
    covers: [
      'adminLogsApi.searchLogEvents', 'adminLogsApi.fetchLogStats', 'adminLogsApi.fetchLogSources',
      'adminLogsApi.fetchLogFile', 'adminLogsApi.openLogStream', 'adminLogsApi.createLogStreamTicket',
    ],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBS.filter((s) => s.startsWith(p))
      if (before.length === 1 && before[0].toLowerCase() === 'file') return LOG_FILE_NAMES.filter((f) => f.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, VALUED)
      const json = bool.has('json')
      const sub = rest[0]?.toLowerCase()

      if (sub === 'tail') {
        await tail(filtersFrom(value, rest.slice(1)), Math.min(500, num(value.get('backlog'), 'backlog') ?? 20), ctx)
        return
      }

      if (sub === 'stats') {
        const hours = num(value.get('hours'), 'hours')
        const s = await fetchLogStats(value.get('since') ? { since: value.get('since') } : { hours: hours ?? 24 }, ctx.signal)
        if (asJson(ctx, json, s)) return
        const statuses = s.request_statuses ?? {}
        ctx.print([
          `${s.total.toLocaleString()} entries since ${stamp(s.since)}${s.oldest_scanned ? ` (oldest read ${stamp(s.oldest_scanned)})` : ''}`,
          ...(s.scan_truncated ? ['! the server stopped reading before the start of the window'] : []),
          '',
          `levels      ${counts(s.levels)}`,
          `categories  ${counts(s.categories)}`,
          `requests    ${counts(statuses)}`,
          '',
          ...top('events', s.events),
          ...top('top errors', s.top_errors),
          ...top('failing routes (5xx)', s.top_server_error_paths),
          ...top('slow routes', s.top_slow_paths),
          ...top('denied IPs', s.top_denied_ips),
          ...top('failed sign-ins by IP', s.top_failed_login_ips),
          ...top('most active users', s.most_active_users),
        ].join('\n'))
        return
      }

      if (sub === 'files') {
        const s = await fetchLogSources(ctx.signal)
        if (asJson(ctx, json, s)) return
        ctx.print([
          table([['file', 'format', 'size', 'all backups', 'written'], ...s.sources.map((f) => [
            f.name, f.format, formatBytes(f.size), f.backups ? `${formatBytes(f.total_size)} (${f.backups})` : '—', relativeTime(f.modified),
          ])]),
          '',
          `levels      ${s.levels.join(', ')}`,
          `categories  ${s.categories.join(', ')}`,
        ].join('\n'))
        return
      }

      if (sub === 'file') {
        const name = rest[1] ?? fail(`usage: logs file <name> - one of ${LOG_FILE_NAMES.join(', ')}`)
        const t = await fetchLogFile(name, {
          lines: num(value.get('lines'), 'lines'),
          level: value.get('level')?.toUpperCase(),
          q: value.get('q') ?? (rest.slice(2).join(' ') || undefined),
        }, ctx.signal)
        if (asJson(ctx, json, t)) return
        if (t.lines.length === 0) { ctx.print(`no matching lines in ${t.name}`, 'dim'); return }
        // Oldest at the top, like a terminal tail.
        ctx.print([...t.lines].reverse().join('\n'))
        ctx.print(`${t.count.toLocaleString()} lines of ${t.name} · ${t.scanned_lines.toLocaleString()} read${t.scan_truncated ? ' · stopped early' : ''}`, 'dim')
        return
      }

      const r = await searchLogEvents({
        ...filtersFrom(value, rest),
        since: value.get('since'),
        until: value.get('until'),
        before: value.get('before'),
        limit: num(value.get('limit'), 'limit'),
        scan_mb: num(value.get('scan'), 'scan'),
      }, ctx.signal)
      if (asJson(ctx, json, r)) return
      if (r.results.length === 0) ctx.print('no matching entries', 'dim')
      for (const e of r.results) ctx.print(entryLine(e), entryTone(e))
      ctx.print([
        `${r.count.toLocaleString()} ${r.count === 1 ? 'entry' : 'entries'}, newest first · ${r.scanned_lines.toLocaleString()} lines read`,
        ...(r.scan_truncated ? ['the search stopped early - narrow --since/--until or raise --scan (MB, max 512)'] : []),
        ...(r.next_before ? [`older: add --before ${r.next_before}`] : []),
      ].join('\n'), 'dim')
    },
  },
]
