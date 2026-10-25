// Server logs for administrators: search, dashboard numbers, raw text tails
// and the live log socket, under /accounts/admin/logs/ and ws/admin/logs/.
// Administrators with 2FA only - anyone else gets 403 on every call here, and
// the socket closes 4403.
//
// Every string in an entry (msg, path, user, user_agent, reason...) can be
// written by outside users. Render them as plain text, never as HTML.
import { baseFor, routeUrl } from './apiServers'
import { authedRequest, defaultParseError } from './apiClient'
import { getToken } from './userApi'

const LOGS_BASE = routeUrl('/accounts/admin/logs')

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
export type LogCategory = 'request' | 'audit' | 'security' | 'auth' | 'performance'
  | 'files' | 'comp' | 'lyrics' | 'tasks' | 'chat' | 'cdn' | 'app'

export const LOG_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
/** Used until `sources` says which categories the server has. */
export const LOG_CATEGORIES: LogCategory[] = ['request', 'audit', 'security', 'auth', 'performance', 'files', 'comp', 'lyrics', 'tasks', 'chat', 'cdn', 'app']

export interface LogEntry {
  /** UTC ISO, ending in Z. */
  ts: string
  level: LogLevel
  logger: string
  category: LogCategory
  msg: string
  module: string
  func: string
  line: number
  /** The server process that wrote it. */
  pid: number
  /** Traceback, only on errors. */
  exc?: string
  event?: string
  /** Username, "Anonymous" for signed-out requests, "system" with no request. */
  user?: string
  user_id?: number | null
  ip?: string | null
  method?: string
  /** No query string. */
  path?: string
  status?: number
  /** Milliseconds. */
  duration?: number
  user_agent?: string
  /** Event-specific extras (auth_method, reason, changes, target_user...). */
  [key: string]: unknown
}

/** The fields every entry has, as opposed to the extras an event adds. */
export const BASE_LOG_FIELDS = new Set(['ts', 'level', 'logger', 'category', 'msg', 'module', 'func', 'line', 'pid', 'exc'])

/** Event names the server writes, for filter suggestions. A trailing dot
 *  matches the whole group. */
export const LOG_EVENTS = [
  'auth.', 'auth.login', 'auth.login_failed', 'auth.logout', 'auth.signup', 'auth.otp_enabled', 'auth.otp_setup_failed',
  'auth.passkey_added', 'auth.passkey_removed', 'auth.login_approval_requested', 'auth.login_approval_decided',
  'api_key.', 'api_key.created', 'api_key.updated', 'api_key.deleted',
  'proposal.reviewed', 'proposal.reversed',
  'proposal.batch_submitted', 'proposal.batch_reviewed', 'proposal.batch_reversed', 'proposal.batch_withdrawn',
  'comp_proposal.', 'comp_proposal.submitted', 'comp_proposal.edited', 'comp_proposal.withdrawn', 'comp_proposal.reviewed',
  'comp_proposal.reversed', 'comp_proposal.apply_failed', 'comp_proposal.reverse_failed',
  'comp_proposal.batch_submitted', 'comp_proposal.batch_reviewed', 'comp_proposal.batch_reversed', 'comp_proposal.batch_withdrawn',
  'comp.', 'comp.replace_started', 'comp.replace_progress', 'comp.replaced', 'comp.replace_failed', 'comp.replace_preview',
  'comp.replace_locked', 'comp.replace_invalid',
  'comp_upload.', 'comp_upload.started', 'comp_upload.expired', 'comp_upload.rejected', 'comp_upload.purged',
  'lyrics.', 'lyrics.job_created', 'lyrics.job_started', 'lyrics.job_progress', 'lyrics.inference', 'lyrics.job_completed',
  'lyrics.job_failed', 'lyrics.job_cancelled', 'lyrics.job_discarded', 'lyrics.job_skipped', 'lyrics.job_deleted',
  'lyrics.model_loading', 'lyrics.model_loaded', 'lyrics.decode_failed', 'lyrics.unavailable', 'lyrics.job_refused',
  'lyrics.queue_failed', 'lyrics.jobs_expired', 'lyrics.previews_removed', 'lyrics.settings_updated',
  'admin.','admin.application_reviewed', 'admin.user_updated', 'admin.badge_awarded', 'admin.request',
  'access.', 'access.unauthenticated', 'access.denied', 'access.rate_limited',
  'logs.stream_ticket', 'logs.stream_opened',
  'task.failed', 'task.retry',
]

/** The text logs `fetchLogFile` accepts. */
export const LOG_FILE_NAMES = ['api.log', 'audit.log', 'auth.log', 'security.log', 'errors.log', 'performance.log', 'file_access.log', 'django.log'] as const

/** Filters shared by REST search and the socket. Values are comma-separated
 *  "any of" lists where the server allows it; `level` is a minimum. */
export interface LogFilters {
  level?: string
  category?: string
  event?: string
  user?: string
  ip?: string
  method?: string
  logger?: string
  /** `404` or a class like `5xx`. */
  status?: string
  /** Substring of the request path. */
  path?: string
  /** Comp slug(s): entries about that comp (browsing, file errors, proposals,
   *  uploads, replacements, lyrics jobs). The primary comp's slug also
   *  matches the file views' `channel: null`. */
  channel?: string
  /** Text in msg and exc. */
  q?: string
}

export const LOG_FILTER_KEYS: (keyof LogFilters)[] = ['level', 'category', 'event', 'user', 'ip', 'method', 'logger', 'status', 'path', 'channel', 'q']

export interface LogSearchParams extends LogFilters {
  /** ISO time, or a window back from now: `15m`, `2h`, `7d`. */
  since?: string
  until?: string
  /** `next_before` from the previous page. */
  before?: string
  /** Default 100, max 1000. */
  limit?: number
  /** MB of log to read. Default 64, max 512. */
  scan_mb?: number
}

export interface LogSearchResult {
  count: number
  /** Newest first. */
  results: LogEntry[]
  scanned_lines: number
  /** The server stopped reading before covering the whole range. */
  scan_truncated: boolean
  /** Pass as `before` for the next (older) page; null when there's no more. */
  next_before: string | null
}

export interface LogSource {
  name: string
  format: 'jsonl' | 'text'
  size: number
  /** Including rotated backups. */
  total_size: number
  backups: number
  modified: string
}

export interface LogSources {
  sources: LogSource[]
  levels: LogLevel[]
  categories: LogCategory[]
}

export interface LogCount { key: string; count: number }

export interface LogStats {
  since: string
  oldest_scanned: string | null
  total: number
  scan_truncated: boolean
  levels: Partial<Record<LogLevel, number>>
  categories: Partial<Record<string, number>>
  request_statuses: Partial<Record<'2xx' | '3xx' | '4xx' | '5xx', number>>
  events: LogCount[]
  top_errors: LogCount[]
  top_server_error_paths: LogCount[]
  top_slow_paths: LogCount[]
  top_denied_ips: LogCount[]
  top_failed_login_ips: LogCount[]
  most_active_users: LogCount[]
}

export interface LogFileTail {
  name: string
  count: number
  /** Newest first. */
  lines: string[]
  scanned_lines: number
  scan_truncated: boolean
}

/** Carries the HTTP status, so a 403 can read as "no access" rather than an
 *  error worth retrying. */
export class LogsApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'LogsApiError'
  }
}

export const isLogsAccessError = (e: unknown): boolean =>
  e instanceof LogsApiError && (e.status === 401 || e.status === 403)

function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, {
    ...init,
    // Throwing here replaces apiRequest's plain Error, keeping the status.
    parseError: async (res) => { throw new LogsApiError(res.status, await defaultParseError(res)) },
  }, getToken())
}

/** Query string from params, dropping empty values. */
function query(params: object): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function fetchLogSources(signal?: AbortSignal): Promise<LogSources> {
  return request(`${LOGS_BASE}/`, { signal })
}

export function searchLogEvents(params: LogSearchParams, signal?: AbortSignal): Promise<LogSearchResult> {
  return request(`${LOGS_BASE}/events/${query(params)}`, { signal })
}

/** `hours` (default 24, max 720) or `since` (ISO or `2h`). */
export function fetchLogStats(window: { hours?: number; since?: string } = {}, signal?: AbortSignal): Promise<LogStats> {
  return request(`${LOGS_BASE}/stats/${query(window)}`, { signal })
}

/** The last lines of a text log, newest first. A `level` filter drops
 *  traceback lines (they have no level); find those with `q`. */
export function fetchLogFile(name: string, params: { lines?: number; level?: string; q?: string } = {}, signal?: AbortSignal): Promise<LogFileTail> {
  return request(`${LOGS_BASE}/files/${encodeURIComponent(name)}/${query(params)}`, { signal })
}

/** Single use, valid 30 seconds: one per connect. 400 means the account has no
 *  API token to bind it to. */
export function createLogStreamTicket(): Promise<{ ticket: string; expires_in: number }> {
  return request(`${LOGS_BASE}/ws-ticket/`, { method: 'POST' })
}

/** Same entry twice (a reconnect's backlog overlapping what's on screen). */
export const logEntryKey = (e: LogEntry): string => `${e.ts}|${e.pid}|${e.msg}`

// ── Live socket ──────────────────────────────────────────────────────────────

export type LogStreamFrame =
  | { type: 'connected' }
  /** Oldest first. */
  | { type: 'backlog'; results: LogEntry[]; scan_truncated: boolean }
  /** Oldest first. `dropped`: older entries in the burst that weren't sent.
   *  `skipped_bytes`: the socket fell far behind and jumped ahead. */
  | { type: 'events'; results: LogEntry[]; dropped: number; skipped_bytes: number }
  | { type: 'filters.updated' }
  | { type: 'error'; detail: string }

/** connecting -> live; reconnecting after a drop; denied (no access, stopped);
 *  invalid (the filters were refused, waiting for new ones); closed. */
export type LogStreamState = 'connecting' | 'live' | 'reconnecting' | 'denied' | 'invalid' | 'closed'

export interface LogStream {
  /** Swap filters. Asks for `backlog` recent matches (default 100) so the
   *  view isn't empty; reconnects if the last filters were refused. */
  setFilters: (filters: LogFilters, backlog?: number) => void
  close: () => void
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]
const PING_MS = 30_000
// Which route the proxy upgrades depends on the deployment; rotate through
// both on handshake failure, like the other sockets.
const WS_PATHS = ['/juicewrld/ws/admin/logs/', '/ws/admin/logs/']

function wsUrl(path: string): string {
  const env = import.meta.env.VITE_JWAPI_WS as string | undefined
  const origin = env
    ? env.replace(/\/$/, '')
    : baseFor('/accounts').replace(/\/juicewrld\/?$/, '').replace(/^http/, 'ws')
  return `${origin}${path}`
}

const cleanFilters = (f: LogFilters): LogFilters =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as LogFilters

/** Opens the live log stream. Handles tickets, keepalive, reconnects and the
 *  close codes; after a drop it asks for the backlog since the last entry it
 *  delivered, so the caller only has to de-duplicate (logEntryKey). */
export function openLogStream(
  initialFilters: LogFilters,
  backlog: number,
  handlers: { onFrame: (frame: LogStreamFrame) => void; onState: (state: LogStreamState, detail?: string) => void },
): LogStream {
  let filters = cleanFilters(initialFilters)
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let pathIndex = 0
  let retriedAuth = false
  let lastTs: string | null = null
  let lastError: string | undefined
  let retryTimer: number | null = null
  let pingTimer: number | null = null
  // A ticket request in flight, before there's a socket to look at.
  let fetchingTicket = false

  const setState = (s: LogStreamState, detail?: string): void => { if (!closed || s === 'closed') handlers.onState(s, detail) }

  const stopTimers = (): void => {
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    if (pingTimer !== null) window.clearInterval(pingTimer)
    retryTimer = null
    pingTimer = null
  }

  const schedule = (delay: number): void => {
    if (closed) return
    retryTimer = window.setTimeout(() => { retryTimer = null; void connect(true) }, delay)
  }

  const connect = async (resume: boolean): Promise<void> => {
    if (closed) return
    setState(resume ? 'reconnecting' : 'connecting')
    let ticket: string
    fetchingTicket = true
    try {
      ;({ ticket } = await createLogStreamTicket())
    } catch (e) {
      fetchingTicket = false
      if (closed) return
      if (e instanceof LogsApiError && (e.status === 401 || e.status === 403 || e.status === 400)) {
        setState('denied', e.status === 400 ? e.message || 'This account has no API token' : e.message)
        return
      }
      schedule(RECONNECT_DELAYS_MS[Math.min(attempt++, RECONNECT_DELAYS_MS.length - 1)])
      return
    }
    fetchingTicket = false
    if (closed) return

    const socket = new WebSocket(wsUrl(WS_PATHS[pathIndex]))
    ws = socket
    let opened = false
    socket.onopen = () => {
      if (ws !== socket) return
      opened = true
      // Resuming: the backlog since the last entry delivered fills the gap.
      const auth = resume && lastTs
        ? { type: 'auth', ticket, filters: { ...filters, since: lastTs }, backlog: 500 }
        : { type: 'auth', ticket, filters, backlog }
      socket.send(JSON.stringify(auth))
      if (pingTimer !== null) window.clearInterval(pingTimer)
      pingTimer = window.setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping') }, PING_MS)
    }
    socket.onmessage = (ev) => {
      if (ws !== socket || ev.data === 'pong') return
      let frame: LogStreamFrame
      try { frame = JSON.parse(ev.data as string) as LogStreamFrame } catch { return }
      if (frame.type === 'connected') {
        attempt = 0
        retriedAuth = false
        lastError = undefined
        setState('live')
      } else if (frame.type === 'error') {
        lastError = frame.detail
      } else if ((frame.type === 'backlog' || frame.type === 'events') && frame.results.length) {
        lastTs = frame.results[frame.results.length - 1].ts
      }
      handlers.onFrame(frame)
    }
    socket.onerror = () => {}
    socket.onclose = (ev) => {
      if (ws !== socket) return
      ws = null
      if (pingTimer !== null) window.clearInterval(pingTimer)
      pingTimer = null
      if (closed) return
      if (ev.code === 4403) { setState('denied', 'Logs need an administrator with two-factor on'); return }
      if (ev.code === 4400) { setState('invalid', lastError ?? 'The server refused these filters'); return }
      if (ev.code === 4401) {
        // One retry with a fresh ticket; the ticket request itself says
        // whether access is really gone.
        if (retriedAuth) { setState('denied', 'Sign in again to watch the logs'); return }
        retriedAuth = true
        void connect(true)
        return
      }
      if (!opened && (pathIndex + 1) % WS_PATHS.length !== 0) {
        pathIndex++
        schedule(250)
        return
      }
      if (!opened) pathIndex = 0
      schedule(RECONNECT_DELAYS_MS[Math.min(attempt++, RECONNECT_DELAYS_MS.length - 1)])
    }
  }

  void connect(false)

  return {
    setFilters: (next, nextBacklog = 100) => {
      filters = cleanFilters(next)
      backlog = nextBacklog
      lastTs = null
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'filters', filters, backlog: nextBacklog }))
      } else if (!ws && retryTimer === null && !fetchingTicket) {
        // Refused or denied earlier: try again with these.
        attempt = 0
        void connect(false)
      }
    },
    close: () => {
      closed = true
      stopTimers()
      const socket = ws
      ws = null
      if (socket) try { socket.close() } catch { /* already closing */ }
      handlers.onState('closed')
    },
  }
}
