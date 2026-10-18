// User-facing debug recorder. Settings -> "Record debug log" starts capturing
// console output, uncaught errors and network activity (fetch, XHR,
// WebSocket lifecycle, and everything else the browser loads via the
// Resource Timing API - audio, images, scripts); pressing it again stops and
// downloads one JSON file the user can send us.
//
// Everything is redacted on the way in (auth headers, token-ish query params
// and JSON fields) so the file is safe to pass around. Buffers are capped so a
// forgotten recording can't eat the tab's memory. A recording survives a page
// reload: the buffer is parked in sessionStorage on pagehide and picked back
// up by installDebugRecorder() at boot.
import { APP_VERSION, COMMIT_HASH } from './appVersion'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type DebugEntry =
  | { t: number; kind: 'console'; level: ConsoleLevel; args: string[] }
  | { t: number; kind: 'error'; message: string; source?: string; stack?: string }
  | { t: number; kind: 'rejection'; reason: string }
  | {
      t: number; kind: 'fetch' | 'xhr'; method: string; url: string
      status?: number; statusText?: string; ok?: boolean; error?: string
      durationMs?: number; requestHeaders?: Record<string, string>; requestBody?: string
      responseHeaders?: Record<string, string>; responseBody?: string; responseType?: string
    }
  | { t: number; kind: 'websocket'; event: 'open' | 'close' | 'error' | 'connect'; url: string; code?: number; reason?: string; sent?: number; received?: number }
  | { t: number; kind: 'resource'; url: string; initiator: string; durationMs: number; transferSize?: number; status?: number }
  | { t: number; kind: 'navigation'; url: string; note: string }

const MAX_ENTRIES = 8000
const MAX_ARG_CHARS = 4000
const MAX_REQ_BODY = 4000
const MAX_RES_BODY = 16000
const SESSION_KEY = 'unreleased:debugRecording'

const SECRET_PARAM = /^(token|access_token|refresh_token|api_key|apikey|key|sig|signature|password|code|auth|session|secret)$/i
const SECRET_FIELD = /(token|password|passwd|secret|authorization|cookie|api_?key|private_?key|session_?key)/i
const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i

let recording = false
let startedAt = 0
let entries: DebugEntry[] = []
let dropped = 0
const listeners = new Set<() => void>()

// Originals, captured once at install so a patch can always call through.
const origConsole: Partial<Record<ConsoleLevel, (...a: unknown[]) => void>> = {}
let origFetch: typeof window.fetch | null = null
let installed = false
let perfObserver: PerformanceObserver | null = null

function notify(): void {
  for (const l of listeners) { try { l() } catch { /* ignore */ } }
}

function push(e: DebugEntry): void {
  if (!recording) return
  entries.push(e)
  if (entries.length > MAX_ENTRIES) { entries.shift(); dropped++ }
  notify()
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} more chars]` : s
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, location.href)
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAM.test(k)) u.searchParams.set(k, '[redacted]')
    }
    if (u.username || u.password) { u.username = ''; u.password = '' }
    return u.toString()
  } catch {
    return raw
  }
}

function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 8 || v == null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => redactValue(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SECRET_FIELD.test(k) && val != null && val !== '' ? '[redacted]' : redactValue(val, depth + 1)
  }
  return out
}

// Bodies: JSON gets field-level redaction; form-encoded gets param redaction;
// anything else is kept as text (clipped).
function redactBody(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return clip(JSON.stringify(redactValue(JSON.parse(trimmed))), max) } catch { /* not JSON */ }
  }
  if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(trimmed)) {
    try {
      const p = new URLSearchParams(trimmed)
      for (const k of [...p.keys()]) if (SECRET_FIELD.test(k) || SECRET_PARAM.test(k)) p.set(k, '[redacted]')
      return clip(p.toString(), max)
    } catch { /* fall through */ }
  }
  return clip(text, max)
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) out[k] = SECRET_HEADER.test(k) ? '[redacted]' : v
  return out
}

function headersToObject(h: HeadersInit | Headers | undefined | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  try {
    new Headers(h).forEach((v, k) => { out[k] = v })
  } catch { /* ignore */ }
  return out
}

function describeBody(body: unknown): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return redactBody(body, MAX_REQ_BODY)
  if (body instanceof URLSearchParams) return redactBody(body.toString(), MAX_REQ_BODY)
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: string[] = []
    body.forEach((v, k) => {
      if (typeof v === 'string') parts.push(`${k}=${SECRET_FIELD.test(k) ? '[redacted]' : clip(v, 200)}`)
      else parts.push(`${k}=<file ${(v as File).name || 'blob'} ${(v as File).size}B ${(v as File).type}>`)
    })
    return `[FormData] ${parts.join('&')}`
  }
  if (body instanceof Blob) return `<blob ${body.size}B ${body.type}>`
  if (body instanceof ArrayBuffer) return `<arraybuffer ${body.byteLength}B>`
  if (ArrayBuffer.isView(body)) return `<binary ${body.byteLength}B>`
  return `<${Object.prototype.toString.call(body)}>`
}

function isTextual(contentType: string | null): boolean {
  if (!contentType) return false
  return /json|text\/|xml|javascript|x-www-form-urlencoded/i.test(contentType)
}

function serializeArg(a: unknown): string {
  if (typeof a === 'string') return clip(a, MAX_ARG_CHARS)
  if (a instanceof Error) return clip(`${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`, MAX_ARG_CHARS)
  if (a === undefined) return 'undefined'
  if (typeof a === 'function') return `[function ${a.name || 'anonymous'}]`
  if (typeof a === 'symbol' || typeof a === 'bigint') return String(a)
  if (typeof Element !== 'undefined' && a instanceof Element) return `<${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}>`
  try {
    const seen = new WeakSet<object>()
    const json = JSON.stringify(redactValue(a), (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]'
        seen.add(v)
      }
      if (typeof v === 'bigint') return v.toString()
      return v
    })
    return clip(json ?? String(a), MAX_ARG_CHARS)
  } catch {
    return clip(String(a), MAX_ARG_CHARS)
  }
}

// ── patches ──────────────────────────────────────────────────────────────

function patchConsole(): void {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as ConsoleLevel[]) {
    const orig = console[level].bind(console)
    origConsole[level] = orig
    console[level] = (...args: unknown[]) => {
      orig(...args)
      if (recording) {
        try { push({ t: Date.now(), kind: 'console', level, args: args.map(serializeArg) }) } catch { /* never break logging */ }
      }
    }
  }
}

function patchFetch(): void {
  if (typeof window.fetch !== 'function') return
  origFetch = window.fetch.bind(window)
  const base = origFetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!recording) return base(input, init)
    const t = Date.now()
    const started = performance.now()
    let method = 'GET'
    let url = ''
    let reqHeaders: Record<string, string> = {}
    let reqBody: string | undefined
    try {
      if (input instanceof Request) {
        method = input.method
        url = input.url
        reqHeaders = headersToObject(input.headers)
      } else {
        url = String(input)
      }
      if (init?.method) method = init.method
      if (init?.headers) reqHeaders = { ...reqHeaders, ...headersToObject(init.headers) }
      reqBody = describeBody(init?.body)
    } catch { /* best effort */ }
    try {
      const res = await base(input, init)
      const entry: DebugEntry = {
        t, kind: 'fetch', method: method.toUpperCase(), url: redactUrl(url),
        status: res.status, statusText: res.statusText, ok: res.ok,
        durationMs: Math.round(performance.now() - started),
        requestHeaders: redactHeaders(reqHeaders), requestBody: reqBody,
        responseHeaders: redactHeaders(headersToObject(res.headers)),
        responseType: res.headers.get('content-type') ?? undefined,
      }
      // Only read bodies that are text and not huge - never tee an audio
      // stream into memory.
      const ct = res.headers.get('content-type')
      const len = Number(res.headers.get('content-length') || '0')
      if (isTextual(ct) && (!len || len <= 2_000_000) && res.body) {
        res.clone().text()
          .then(text => { entry.responseBody = redactBody(text, MAX_RES_BODY); notify() })
          .catch(() => { /* aborted / opaque */ })
      }
      push(entry)
      return res
    } catch (err) {
      push({
        t, kind: 'fetch', method: method.toUpperCase(), url: redactUrl(url),
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        durationMs: Math.round(performance.now() - started),
        requestHeaders: redactHeaders(reqHeaders), requestBody: reqBody,
      })
      throw err
    }
  }
}

type XhrMeta = { method: string; url: string; headers: Record<string, string>; started: number; t: number; body?: string }
const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>()

function patchXhr(): void {
  if (typeof XMLHttpRequest === 'undefined') return
  const proto = XMLHttpRequest.prototype
  const open = proto.open
  const send = proto.send
  const setHeader = proto.setRequestHeader
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    xhrMeta.set(this, { method: method.toUpperCase(), url: String(url), headers: {}, started: 0, t: 0 })
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof proto.open
  proto.setRequestHeader = function (this: XMLHttpRequest, k: string, v: string) {
    const m = xhrMeta.get(this)
    if (m) m.headers[k] = v
    return setHeader.call(this, k, v)
  }
  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = xhrMeta.get(this)
    if (recording && m) {
      m.t = Date.now()
      m.started = performance.now()
      m.body = describeBody(body)
      const finish = (error?: string) => {
        const resHeaders: Record<string, string> = {}
        try {
          for (const line of this.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
            const i = line.indexOf(':')
            if (i > 0) resHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
          }
        } catch { /* ignore */ }
        let responseBody: string | undefined
        try {
          if ((this.responseType === '' || this.responseType === 'text') && isTextual(resHeaders['content-type'] ?? null)) {
            responseBody = redactBody(this.responseText, MAX_RES_BODY)
          } else if (this.responseType === 'json' && this.response != null) {
            responseBody = clip(JSON.stringify(redactValue(this.response)), MAX_RES_BODY)
          }
        } catch { /* ignore */ }
        push({
          t: m.t, kind: 'xhr', method: m.method, url: redactUrl(m.url),
          status: this.status, statusText: this.statusText, ok: this.status >= 200 && this.status < 300,
          error, durationMs: Math.round(performance.now() - m.started),
          requestHeaders: redactHeaders(m.headers), requestBody: m.body,
          responseHeaders: redactHeaders(resHeaders), responseBody,
          responseType: resHeaders['content-type'],
        })
      }
      this.addEventListener('load', () => finish())
      this.addEventListener('error', () => finish('network error'))
      this.addEventListener('abort', () => finish('aborted'))
      this.addEventListener('timeout', () => finish('timeout'))
    }
    return send.call(this, body)
  }
}

function patchWebSocket(): void {
  if (typeof WebSocket === 'undefined') return
  const Orig = WebSocket
  const Patched = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const ws = new Orig(url, protocols)
    if (!recording) return ws
    const u = redactUrl(String(url))
    let sent = 0
    let received = 0
    const origSend = ws.send.bind(ws)
    ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => { sent++; origSend(data) }
    push({ t: Date.now(), kind: 'websocket', event: 'connect', url: u })
    ws.addEventListener('open', () => push({ t: Date.now(), kind: 'websocket', event: 'open', url: u }))
    ws.addEventListener('message', () => { received++ })
    ws.addEventListener('error', () => push({ t: Date.now(), kind: 'websocket', event: 'error', url: u, sent, received }))
    ws.addEventListener('close', (e) => push({ t: Date.now(), kind: 'websocket', event: 'close', url: u, code: e.code, reason: e.reason, sent, received }))
    return ws
  } as unknown as typeof WebSocket
  Patched.prototype = Orig.prototype
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
    Object.defineProperty(Patched, k, { value: Orig[k] })
  }
  window.WebSocket = Patched
}

function onError(e: ErrorEvent): void {
  push({
    t: Date.now(), kind: 'error', message: e.message,
    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
    stack: e.error?.stack,
  })
}

function onRejection(e: PromiseRejectionEvent): void {
  push({ t: Date.now(), kind: 'rejection', reason: serializeArg(e.reason) })
}

// Resource Timing catches what fetch/XHR patches can't see: <audio>, <img>,
// CSS, scripts. fetch/xmlhttprequest entries are skipped (already logged).
function startPerfObserver(): void {
  if (typeof PerformanceObserver === 'undefined' || perfObserver) return
  try {
    perfObserver = new PerformanceObserver(list => {
      for (const raw of list.getEntries()) {
        const e = raw as PerformanceResourceTiming & { responseStatus?: number }
        if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest' || e.name.startsWith('data:')) continue
        push({
          t: Math.round(performance.timeOrigin + e.startTime), kind: 'resource', url: redactUrl(e.name),
          initiator: e.initiatorType, durationMs: Math.round(e.duration),
          transferSize: e.transferSize || undefined, status: e.responseStatus || undefined,
        })
      }
    })
    perfObserver.observe({ type: 'resource', buffered: false })
  } catch { perfObserver = null }
}

function stopPerfObserver(): void {
  perfObserver?.disconnect()
  perfObserver = null
}

// ── persistence across reloads ───────────────────────────────────────────

function park(): void {
  if (!recording) return
  try {
    // Keep the newest entries if the whole buffer won't fit.
    let slice = entries
    for (;;) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ startedAt, dropped: dropped + (entries.length - slice.length), entries: slice }))
        return
      } catch {
        if (slice.length < 50) { sessionStorage.removeItem(SESSION_KEY); return }
        slice = slice.slice(Math.floor(slice.length / 2))
      }
    }
  } catch { /* storage blocked */ }
}

function resumeParked(): void {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    sessionStorage.removeItem(SESSION_KEY)
    const saved = JSON.parse(raw) as { startedAt: number; dropped: number; entries: DebugEntry[] }
    entries = Array.isArray(saved.entries) ? saved.entries : []
    dropped = saved.dropped || 0
    startedAt = saved.startedAt || Date.now()
    recording = true
    startPerfObserver()
    push({ t: Date.now(), kind: 'navigation', url: redactUrl(location.href), note: 'page reloaded during recording' })
  } catch { /* corrupt - drop it */ }
}

// ── public API ───────────────────────────────────────────────────────────

// Call once at startup, before anything else logs or fetches. Patches are
// inert (straight pass-through) until a recording starts.
export function installDebugRecorder(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  patchConsole()
  patchFetch()
  patchXhr()
  patchWebSocket()
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('pagehide', park)
  resumeParked()
}

export function isDebugRecording(): boolean { return recording }
export function debugRecordingStartedAt(): number { return startedAt }
export function debugRecordingCount(): number { return entries.length + dropped }

export function subscribeDebugRecorder(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function startDebugRecording(): void {
  if (recording) return
  installDebugRecorder()
  entries = []
  dropped = 0
  startedAt = Date.now()
  recording = true
  startPerfObserver()
  push({ t: startedAt, kind: 'navigation', url: redactUrl(location.href), note: 'recording started' })
}

function environment(): Record<string, unknown> {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; saveData?: boolean }; deviceMemory?: number }
  return {
    app: 'unreleased-web',
    version: APP_VERSION,
    commit: COMMIT_HASH,
    url: redactUrl(location.href),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    connection: nav.connection ? { type: nav.connection.effectiveType, downlink: nav.connection.downlink, saveData: nav.connection.saveData } : undefined,
    deviceMemoryGB: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: document.documentElement.classList.contains('standalone'),
    serviceWorker: !!navigator.serviceWorker?.controller,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Stops the recording and returns the log file (not yet downloaded).
export function stopDebugRecording(): { blob: Blob; filename: string; count: number } {
  push({ t: Date.now(), kind: 'navigation', url: redactUrl(location.href), note: 'recording stopped' })
  recording = false
  stopPerfObserver()
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  const stoppedAt = Date.now()
  const sorted = [...entries].sort((a, b) => a.t - b.t)
  const summary = {
    console: sorted.filter(e => e.kind === 'console').length,
    consoleErrors: sorted.filter(e => e.kind === 'console' && (e.level === 'error' || e.level === 'warn')).length,
    uncaughtErrors: sorted.filter(e => e.kind === 'error' || e.kind === 'rejection').length,
    requests: sorted.filter(e => e.kind === 'fetch' || e.kind === 'xhr').length,
    failedRequests: sorted.filter(e => (e.kind === 'fetch' || e.kind === 'xhr') && (e.error || (e.status != null && e.status >= 400))).length,
    resources: sorted.filter(e => e.kind === 'resource').length,
    websocketEvents: sorted.filter(e => e.kind === 'websocket').length,
    droppedOldest: dropped,
  }
  const file = {
    format: 'unreleased-debug-log/1',
    startedAt: new Date(startedAt).toISOString(),
    stoppedAt: new Date(stoppedAt).toISOString(),
    durationSec: Math.round((stoppedAt - startedAt) / 1000),
    environment: environment(),
    summary,
    entries: sorted.map(e => ({ ...e, at: new Date(e.t).toISOString(), sinceStartMs: e.t - startedAt })),
  }
  const count = sorted.length
  entries = []
  dropped = 0
  notify()
  return {
    blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    filename: `unreleased-debug-${stamp(new Date(startedAt))}.json`,
    count,
  }
}

export function discardDebugRecording(): void {
  recording = false
  stopPerfObserver()
  entries = []
  dropped = 0
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  notify()
}

// Stop + trigger the download in one go - what the UI buttons call.
export function stopAndDownloadDebugRecording(): number {
  const { blob, filename, count } = stopDebugRecording()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return count
}
