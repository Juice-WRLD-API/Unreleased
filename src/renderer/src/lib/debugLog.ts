// Reads a log saved by "Record debug log" (lib/debugRecorder) back in. The
// file is checked and normalized here - unknown or half-written entries are
// skipped with a warning rather than failing the whole file - and every entry
// gets one shared description, so the viewer (DebugLogViewer) and the
// terminal (`debuglog open`) show the same thing.
import { create } from 'zustand'
import { summarizeDebugEntries, type DebugEntry, type DebugSummary } from './debugRecorder'
import { formatBytes } from './format'
import { pickLocalFile } from './terminal/pick'

export const DEBUG_LOG_FORMAT = 'unreleased-debug-log/1'

export type DebugLogEntry = DebugEntry & { id: number; sinceStartMs: number }

export interface DebugLog {
  fileName: string
  startedAt: number
  stoppedAt: number
  environment: Record<string, unknown>
  /** Recorded in anonymous mode (no device details, account fields scrubbed). */
  anonymous: boolean
  /** Recomputed from the entries, not read from the file. */
  summary: DebugSummary
  problems: number
  entries: DebugLogEntry[]
  /** Things that didn't read cleanly. Shown, never fatal. */
  warnings: string[]
}

const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug'])
const WS_EVENTS = new Set(['open', 'close', 'error', 'connect'])

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : v == null ? undefined : String(v))
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

function strMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = str(val) ?? ''
  return out
}

function normalizeEntry(raw: unknown): DebugEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const t = toMs(r.t) ?? toMs(r.at)
  if (t === undefined) return null
  switch (r.kind) {
    case 'console':
      return {
        t, kind: 'console',
        level: LEVELS.has(r.level as string) ? (r.level as 'log') : 'log',
        args: Array.isArray(r.args) ? r.args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))) : [],
      }
    case 'error':
      return { t, kind: 'error', message: str(r.message) ?? '', source: str(r.source), stack: str(r.stack) }
    case 'rejection':
      return { t, kind: 'rejection', reason: str(r.reason) ?? '' }
    case 'fetch':
    case 'xhr':
      return {
        t, kind: r.kind, method: (str(r.method) ?? 'GET').toUpperCase(), url: str(r.url) ?? '',
        status: num(r.status), statusText: str(r.statusText), ok: typeof r.ok === 'boolean' ? r.ok : undefined,
        error: str(r.error), durationMs: num(r.durationMs),
        requestHeaders: strMap(r.requestHeaders), requestBody: str(r.requestBody),
        responseHeaders: strMap(r.responseHeaders), responseBody: str(r.responseBody), responseType: str(r.responseType),
      }
    case 'websocket':
      if (!WS_EVENTS.has(r.event as string)) return null
      return {
        t, kind: 'websocket', event: r.event as 'open', url: str(r.url) ?? '',
        code: num(r.code), reason: str(r.reason), sent: num(r.sent), received: num(r.received),
      }
    case 'resource':
      return {
        t, kind: 'resource', url: str(r.url) ?? '', initiator: str(r.initiator) ?? 'other',
        durationMs: num(r.durationMs) ?? 0, transferSize: num(r.transferSize), status: num(r.status),
      }
    case 'navigation':
      return { t, kind: 'navigation', url: str(r.url) ?? '', note: str(r.note) ?? '' }
    default:
      return null
  }
}

/** Throws with a short, user-facing reason when the text isn't a debug log. */
export function parseDebugLog(text: string, fileName = 'debug log'): DebugLog {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch (err) {
    throw new Error(`not valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
  // A bare entries array (copied out of a log) reads too.
  const root = (Array.isArray(data) ? { entries: data } : data) as Record<string, unknown> | null
  if (!root || typeof root !== 'object' || !Array.isArray(root.entries)) {
    throw new Error('not a debug log - it has no "entries" list')
  }

  const warnings: string[] = []
  const format = str(root.format)
  if (format !== DEBUG_LOG_FORMAT) {
    warnings.push(format ? `unknown format "${format}", read as ${DEBUG_LOG_FORMAT}` : `no format tag, read as ${DEBUG_LOG_FORMAT}`)
  }

  const list: DebugEntry[] = []
  let skipped = 0
  for (const raw of root.entries) {
    const e = normalizeEntry(raw)
    if (e) list.push(e)
    else skipped++
  }
  if (skipped) warnings.push(`${skipped} unreadable ${skipped === 1 ? 'entry' : 'entries'} skipped`)
  list.sort((a, b) => a.t - b.t)

  const startedAt = toMs(root.startedAt) ?? list[0]?.t ?? 0
  const stoppedAt = toMs(root.stoppedAt) ?? list[list.length - 1]?.t ?? startedAt
  const fileSummary = root.summary && typeof root.summary === 'object' ? root.summary as Record<string, unknown> : {}
  const dropped = num(fileSummary.droppedOldest) ?? 0
  if (dropped) warnings.push(`the recording filled up - its oldest ${dropped} events were dropped`)

  const environment = root.environment && typeof root.environment === 'object' && !Array.isArray(root.environment)
    ? root.environment as Record<string, unknown>
    : {}

  return {
    fileName, startedAt, stoppedAt, environment,
    anonymous: root.anonymous === true,
    summary: summarizeDebugEntries(list, dropped),
    problems: list.filter(isProblem).length,
    entries: list.map((e, id) => ({ ...e, id, sinceStartMs: e.t - startedAt })),
    warnings,
  }
}

export async function readDebugLogFile(file: File): Promise<DebugLog> {
  return parseDebugLog(await file.text(), file.name)
}

// ── what an entry means ──────────────────────────────────────────────────

export function isProblem(e: DebugEntry): boolean {
  switch (e.kind) {
    case 'console': return e.level === 'error' || e.level === 'warn'
    case 'error': case 'rejection': return true
    case 'fetch': case 'xhr': return !!e.error || (e.status != null && e.status >= 400)
    case 'resource': return e.status != null && e.status >= 400
    // 1000/1001 are clean closes, 1005 is a close with no code given.
    case 'websocket': return e.event === 'error' || (e.event === 'close' && e.code != null && ![1000, 1001, 1005].includes(e.code))
    case 'navigation': return false
  }
}

export type DebugLogFilter = 'all' | 'problems' | 'requests' | 'console' | 'resources' | 'websocket'

export function matchesFilter(e: DebugEntry, filter: DebugLogFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'problems': return isProblem(e)
    case 'requests': return e.kind === 'fetch' || e.kind === 'xhr'
    case 'console': return e.kind === 'console' || e.kind === 'error' || e.kind === 'rejection'
    case 'resources': return e.kind === 'resource'
    case 'websocket': return e.kind === 'websocket'
  }
}

/** Everything a search should look through, lowercased. */
export function searchText(e: DebugEntry): string {
  switch (e.kind) {
    case 'console': return `${e.level} ${e.args.join(' ')}`.toLowerCase()
    case 'error': return `${e.message} ${e.source ?? ''} ${e.stack ?? ''}`.toLowerCase()
    case 'rejection': return e.reason.toLowerCase()
    case 'fetch': case 'xhr':
      return `${e.method} ${e.url} ${e.status ?? ''} ${e.error ?? ''} ${e.requestBody ?? ''} ${e.responseBody ?? ''}`.toLowerCase()
    case 'websocket': return `${e.event} ${e.url} ${e.reason ?? ''}`.toLowerCase()
    case 'resource': return `${e.initiator} ${e.url} ${e.status ?? ''}`.toLowerCase()
    case 'navigation': return `${e.note} ${e.url}`.toLowerCase()
  }
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

/** Offset from the start of the recording: +m:ss.mmm */
export function formatOffset(ms: number): string {
  const a = Math.abs(Math.round(ms))
  const m = Math.floor(a / 60000)
  const s = Math.floor(a / 1000) % 60
  return `${ms < 0 ? '-' : '+'}${m}:${String(s).padStart(2, '0')}.${String(a % 1000).padStart(3, '0')}`
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** One line per entry: a short tag, the main text, and trailing detail
 *  (status, timing). The viewer's rows and the terminal both use it. */
export function describeEntry(e: DebugEntry): { tag: string; text: string; meta: string } {
  const ms = (n: number | undefined): string => (n != null ? `${n}ms` : '')
  const join = (...parts: (string | number | undefined)[]): string => parts.filter(p => p !== undefined && p !== '').join(' ')
  switch (e.kind) {
    case 'console': return { tag: e.level, text: e.args.join(' '), meta: '' }
    case 'error': return { tag: 'error', text: e.message, meta: e.source ?? '' }
    case 'rejection': return { tag: 'rejection', text: e.reason, meta: '' }
    case 'fetch': case 'xhr':
      return { tag: e.kind, text: `${e.method} ${shortUrl(e.url)}`, meta: join(e.error ?? e.status, ms(e.durationMs)) }
    case 'websocket':
      return {
        tag: 'ws', text: `${e.event} ${shortUrl(e.url)}`,
        meta: join(e.code != null ? `code ${e.code}` : undefined, e.reason, e.sent != null ? `${e.sent} sent` : undefined, e.received != null ? `${e.received} received` : undefined),
      }
    case 'resource':
      return { tag: e.initiator, text: shortUrl(e.url), meta: join(e.status, ms(e.durationMs), e.transferSize ? formatBytes(e.transferSize) : undefined) }
    case 'navigation': return { tag: 'page', text: e.note, meta: shortUrl(e.url) }
  }
}

/** JSON bodies and console arguments, indented; anything else as it is.
 *  Clipped bodies (ending in "… [n more chars]") aren't valid JSON and stay raw. */
export function prettyText(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return text
  try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return text }
}

/** "v2.4.18 (abc1234) · 2m 13s · 20/10/2026, 14:03:12 · anonymous" */
export function describeLog(log: DebugLog): string {
  const env = log.environment
  const version = str(env.version)
  const commit = str(env.commit)
  return [
    version ? `v${version}${commit ? ` (${commit.slice(0, 7)})` : ''}` : '',
    formatDuration((log.stoppedAt - log.startedAt) / 1000),
    log.startedAt ? new Date(log.startedAt).toLocaleString() : '',
    log.anonymous ? 'anonymous' : '',
  ].filter(Boolean).join(' · ')
}

// ── the open viewer ──────────────────────────────────────────────────────

interface DebugLogViewerState {
  log: DebugLog | null
  open: (log: DebugLog) => void
  close: () => void
}

export const useDebugLogViewer = create<DebugLogViewerState>((set) => ({
  log: null,
  open: (log) => set({ log }),
  close: () => set({ log: null }),
}))

/** Shows a log that was just recorded, straight from the saved file's bytes. */
export async function openDebugLogBlob(blob: Blob, fileName: string): Promise<DebugLog> {
  const log = parseDebugLog(await blob.text(), fileName)
  useDebugLogViewer.getState().open(log)
  return log
}

/** Asks for a file and shows it in the viewer. Resolves null when the picker
 *  is cancelled; throws when the file isn't a debug log. */
export async function openDebugLogFile(): Promise<DebugLog | null> {
  let file: File
  try {
    file = await pickLocalFile('.json,application/json')
  } catch {
    return null
  }
  const log = await readDebugLogFile(file)
  useDebugLogViewer.getState().open(log)
  return log
}
