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
//
// Secret values seen on the way in (the auth token, beta code, token-ish
// params and fields) are also remembered and scrubbed from every string when
// the file is saved, so a token a console.log printed doesn't slip through.
// Anonymous mode goes further: no device/browser details in `environment`,
// and emails, IPs, home-folder paths and account fields (username, display
// name, Discord id, avatar…) are scrubbed too, along with any other place the
// values of those fields show up.
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
const ANON_PREF_KEY = 'unreleased:debugRecordAnonymous'
const TOKEN_KEY = 'unreleased:authToken'

const SECRET_PARAM = /^(token|access_token|refresh_token|api_key|apikey|key|sig|signature|password|code|auth|session|secret)$/i
const SECRET_FIELD = /(token|password|passwd|secret|authorization|cookie|api_?key|private_?key|session_?key)/i
const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|x-beta-code|proxy-authorization)$/i

// Anonymous mode: fields (JSON keys, form params, header names) whose values
// identify the user or their machine.
const ANON_KEYS = 'e-?mail|username|user_?name|display_?name|global_?name|discord_?(?:id|username|avatar|name)|avatar(?:_url)?|bio|ip|ip_?address|remote_?addr|x-forwarded-for|x-real-ip|cf-connecting-ip|cf-ipcountry|phone|first_?name|last_?name|hostname|device_?name'
const ANON_FIELD = new RegExp(`^(?:${ANON_KEYS})$`, 'i')
const ANON_JSON_PAIR = new RegExp(`"(${ANON_KEYS})"(\\s*:\\s*)"((?:[^"\\\\]|\\\\.)*)"`, 'gi')
const ANON_FORM_PAIR = new RegExp(`(^|[?&])(${ANON_KEYS})=([^&#\\s"]*)`, 'gi')
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi
const HOME_DIR = /([A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)[^\\/\s"'<>]+/g
const HOME_DIR_ENCODED = /((?:Users|home)(?:%5C|%2F)+)[^%\s"'&<>]+/gi
// Both modes: auth schemes and JWTs wherever they're printed.
const AUTH_SCHEME = /\b(Token|Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g

let recording = false
let anonymous = false
let startedAt = 0
let entries: DebugEntry[] = []
let dropped = 0
// Raw secret values seen while recording, scrubbed from every string on save.
// Kept in memory only - never parked in sessionStorage.
const seenSecrets = new Set<string>()
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

function remember(v: unknown): void {
  if (!recording || typeof v !== 'string') return
  // "Token abc…" -> also remember "abc…", which is what gets printed alone.
  const bare = v.replace(/^(Token|Bearer|Basic)\s+/i, '').trim()
  for (const s of [v.trim(), bare]) if (s.length >= 8 && s !== '[redacted]') seenSecrets.add(s)
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, location.href)
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAM.test(k)) { remember(u.searchParams.get(k)); u.searchParams.set(k, '[redacted]') }
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
    const secret = SECRET_FIELD.test(k) && val != null && val !== ''
    if (secret) remember(val)
    out[k] = secret ? '[redacted]' : redactValue(val, depth + 1)
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
      for (const k of [...p.keys()]) if (SECRET_FIELD.test(k) || SECRET_PARAM.test(k)) { remember(p.get(k)); p.set(k, '[redacted]') }
      return clip(p.toString(), max)
    } catch { /* fall through */ }
  }
  return clip(text, max)
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    if (SECRET_HEADER.test(k)) remember(v)
    out[k] = SECRET_HEADER.test(k) ? '[redacted]' : v
  }
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
      if (typeof v === 'string' && SECRET_FIELD.test(k)) remember(v)
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
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ startedAt, anonymous, dropped: dropped + (entries.length - slice.length), entries: slice }))
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
    const saved = JSON.parse(raw) as { startedAt: number; anonymous?: boolean; dropped: number; entries: DebugEntry[] }
    entries = Array.isArray(saved.entries) ? saved.entries : []
    dropped = saved.dropped || 0
    startedAt = saved.startedAt || Date.now()
    anonymous = saved.anonymous === true
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
export function isDebugRecordingAnonymous(): boolean { return recording && anonymous }
export function debugRecordingStartedAt(): number { return startedAt }
export function debugRecordingCount(): number { return entries.length + dropped }

// The Settings toggle: whether the next recording starts in anonymous mode.
export function getDebugAnonymousPref(): boolean {
  try { return localStorage.getItem(ANON_PREF_KEY) === '1' } catch { return false }
}

export function setDebugAnonymousPref(on: boolean): void {
  try { localStorage.setItem(ANON_PREF_KEY, on ? '1' : '0') } catch { /* storage blocked */ }
  notify()
}

export function subscribeDebugRecorder(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function startDebugRecording(opts: { anonymous?: boolean } = {}): void {
  if (recording) return
  installDebugRecorder()
  entries = []
  dropped = 0
  seenSecrets.clear()
  anonymous = opts.anonymous ?? getDebugAnonymousPref()
  startedAt = Date.now()
  recording = true
  startPerfObserver()
  push({ t: startedAt, kind: 'navigation', url: redactUrl(location.href), note: anonymous ? 'recording started (anonymous)' : 'recording started' })
}

// ── scrubbing on save ────────────────────────────────────────────────────

function knownSecrets(): Set<string> {
  const out = new Set(seenSecrets)
  try { const t = localStorage.getItem(TOKEN_KEY); if (t) out.add(t) } catch { /* ignore */ }
  const devToken = (import.meta.env.VITE_AUTH_TOKEN as string | undefined)?.trim()
  if (devToken) out.add(devToken)
  for (const s of out) if (s.length < 8) out.delete(s)
  return out
}

function forEachString(v: unknown, fn: (s: string, key?: string) => void, key?: string, depth = 0): void {
  if (depth > 12) return
  if (typeof v === 'string') { fn(v, key); return }
  if (Array.isArray(v)) { for (const x of v) forEachString(x, fn, key, depth + 1); return }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) forEachString(x, fn, k, depth + 1)
}

// Values of account fields anywhere in the log (JSON bodies, console output,
// form bodies, headers), so they can be scrubbed where they show up bare -
// a username in a URL path or a "logged in as …" console line.
function harvestIdentity(file: unknown): Set<string> {
  const found = new Set<string>()
  const add = (raw: string, encoded: 'json' | 'form' | 'plain'): void => {
    let v = raw
    try {
      if (encoded === 'json') v = JSON.parse(`"${raw}"`) as string
      else if (encoded === 'form') v = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch { /* keep raw */ }
    for (const s of [raw, v]) {
      if (s.trim().length >= 3 && !/^(\[redacted\]|null|undefined|none)$/i.test(s.trim())) found.add(s)
    }
  }
  forEachString(file, (s, key) => {
    if (key && ANON_FIELD.test(key)) add(s, 'plain')
    for (const m of s.matchAll(ANON_JSON_PAIR)) add(m[3], 'json')
    for (const m of s.matchAll(ANON_FORM_PAIR)) add(m[3], 'form')
  })
  return found
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Secrets are long and random, so they're cut wherever they appear. Account
// values can be short ("max"), so they only match as whole words.
function scrubber(anon: boolean, secrets: string[], identity: string[]): (s: string) => string {
  // Longest first, so a value that contains a shorter one goes in one piece.
  const longestFirst = (a: string, b: string): number => b.length - a.length
  const sortedSecrets = [...secrets].sort(longestFirst)
  const identityRe = identity.length
    ? new RegExp(`(?<![\\w@.-])(?:${[...identity].sort(longestFirst).map(escapeRe).join('|')})(?![\\w-])`, 'g')
    : null
  return (input: string): string => {
    let s = input
    for (const v of sortedSecrets) if (s.includes(v)) s = s.split(v).join('[redacted]')
    s = s.replace(AUTH_SCHEME, '$1 [redacted]').replace(JWT, '[redacted]')
    if (!anon) return s
    if (identityRe) s = s.replace(identityRe, '[redacted]')
    return s
      .replace(ANON_JSON_PAIR, '"$1"$2"[redacted]"')
      .replace(ANON_FORM_PAIR, '$1$2=[redacted]')
      .replace(EMAIL, '[email]')
      .replace(IPV4, '[ip]')
      .replace(IPV6, '[ip]')
      .replace(HOME_DIR, '$1[user]')
      .replace(HOME_DIR_ENCODED, '$1[user]')
  }
}

function scrubDeep(v: unknown, scrub: (s: string) => string, anon: boolean, depth = 0): unknown {
  if (depth > 12) return v
  if (typeof v === 'string') return scrub(v)
  if (Array.isArray(v)) return v.map(x => scrubDeep(x, scrub, anon, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      out[k] = anon && ANON_FIELD.test(k) && typeof x === 'string' && x ? '[redacted]' : scrubDeep(x, scrub, anon, depth + 1)
    }
    return out
  }
  return v
}

function environment(anon: boolean): Record<string, unknown> {
  // Anonymous logs keep only what says which build this was.
  if (anon) {
    return {
      app: 'unreleased-web',
      version: APP_VERSION,
      commit: COMMIT_HASH,
      online: navigator.onLine,
      standalone: document.documentElement.classList.contains('standalone'),
      serviceWorker: !!navigator.serviceWorker?.controller,
    }
  }
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

export type DebugSummary = {
  console: number; consoleErrors: number; uncaughtErrors: number
  requests: number; failedRequests: number; resources: number
  websocketEvents: number; droppedOldest: number
}

// The file's `summary` block. Shared with lib/debugLog, which recomputes it
// when a saved log is opened rather than trusting the one in the file.
export function summarizeDebugEntries(list: DebugEntry[], droppedOldest: number): DebugSummary {
  return {
    console: list.filter(e => e.kind === 'console').length,
    consoleErrors: list.filter(e => e.kind === 'console' && (e.level === 'error' || e.level === 'warn')).length,
    uncaughtErrors: list.filter(e => e.kind === 'error' || e.kind === 'rejection').length,
    requests: list.filter(e => e.kind === 'fetch' || e.kind === 'xhr').length,
    failedRequests: list.filter(e => (e.kind === 'fetch' || e.kind === 'xhr') && (e.error || (e.status != null && e.status >= 400))).length,
    resources: list.filter(e => e.kind === 'resource').length,
    websocketEvents: list.filter(e => e.kind === 'websocket').length,
    droppedOldest,
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
  const summary = summarizeDebugEntries(sorted, dropped)
  const anon = anonymous
  const body = {
    environment: environment(anon),
    entries: sorted.map(e => ({ ...e, at: new Date(e.t).toISOString(), sinceStartMs: e.t - startedAt })),
  }
  // Never scrub the build's own identifiers out of the log.
  const keep = (v: string): boolean => v !== APP_VERSION && v !== COMMIT_HASH
  const secrets = [...knownSecrets()].filter(keep)
  const identity = anon ? [...harvestIdentity(body)].filter(keep) : []
  const scrubbed = scrubDeep(body, scrubber(anon, secrets, identity), anon) as typeof body
  const file = {
    format: 'unreleased-debug-log/1',
    anonymous: anon,
    startedAt: new Date(startedAt).toISOString(),
    stoppedAt: new Date(stoppedAt).toISOString(),
    durationSec: Math.round((stoppedAt - startedAt) / 1000),
    environment: scrubbed.environment,
    summary,
    entries: scrubbed.entries,
  }
  const count = sorted.length
  entries = []
  dropped = 0
  anonymous = false
  seenSecrets.clear()
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
  anonymous = false
  seenSecrets.clear()
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  notify()
}

// Stop + trigger the download in one go - what the UI buttons call. The file
// comes back too, so the caller can offer to open it (lib/debugLog).
export function stopAndDownloadDebugRecording(): { blob: Blob; filename: string; count: number } {
  const { blob, filename, count } = stopDebugRecording()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { blob, filename, count }
}
