// Last.fm scrobbling client - auth (the desktop "token" flow), now-playing
// updates, and an offline-tolerant scrobble queue. Runs entirely in the
// renderer and works in both the Electron and web builds: ws.audioscrobbler.com
// sends CORS headers, so no main-process code is involved.
//
// Needs a Last.fm API account (https://www.last.fm/api/account/create) - set
// VITE_LASTFM_API_KEY / VITE_LASTFM_API_SECRET in .env.local before building.
// Without them lastfmConfigured() is false, Settings shows the row as
// unavailable, and everything here no-ops. Shipping the shared secret inside
// an installed app is Last.fm's documented model for desktop clients - it
// only signs this app's own requests; user auth still happens on last.fm.

const API_KEY = (import.meta.env.VITE_LASTFM_API_KEY as string | undefined) ?? ''
const API_SECRET = (import.meta.env.VITE_LASTFM_API_SECRET as string | undefined) ?? ''
const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'

const SESSION_KEY = 'unreleased:lastfmSession'
const QUEUE_KEY = 'unreleased:lastfmQueue'
// Oldest scrobbles are dropped past this - protects localStorage if the user
// listens offline (or with a revoked session) for a very long time.
const QUEUE_CAP = 500

export function lastfmConfigured(): boolean {
  return API_KEY.length > 0 && API_SECRET.length > 0
}

// ─── Errors ───────────────────────────────────────────────────────────────────

// Last.fm API error codes we branch on (https://www.last.fm/api/errorcodes).
const ERR_INVALID_SESSION = 9
const ERR_SERVICE_OFFLINE = 11
const ERR_TOKEN_NOT_AUTHORIZED = 14
const ERR_TOKEN_EXPIRED = 15
const ERR_TEMP_UNAVAILABLE = 16
const ERR_RATE_LIMITED = 29

export class LastfmError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'LastfmError'
  }
}

// The saved session key can be revoked server-side (user removes the app on
// last.fm) - when any call fails with "invalid session" the session is
// cleared here, and this handler lets the UI layer (store) reflect it without
// this module importing the store (which imports this module).
let sessionInvalidHandler: (() => void) | null = null
export function setLastfmSessionInvalidHandler(fn: (() => void) | null): void {
  sessionInvalidHandler = fn
}

function handleInvalidSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
  sessionInvalidHandler?.()
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface LastfmSession { name: string; key: string }

export function getLastfmSession(): LastfmSession | null {
  try {
    const v = localStorage.getItem(SESSION_KEY)
    if (!v) return null
    const s = JSON.parse(v) as LastfmSession
    return s && typeof s.name === 'string' && typeof s.key === 'string' ? s : null
  } catch {
    return null
  }
}

export function lastfmDisconnect(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(QUEUE_KEY)
  } catch {}
}

// ─── Auth (desktop token flow) ────────────────────────────────────────────────
// 1. lastfmGetAuthToken() → 2. open lastfmAuthUrl(token) in the browser and
// let the user approve → 3. poll lastfmTryGetSession(token) until it returns
// a session (null while the token is still unapproved).

export async function lastfmGetAuthToken(): Promise<string> {
  const res = await apiCall<{ token: string }>({ method: 'auth.getToken' }, false)
  return res.token
}

export function lastfmAuthUrl(token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(API_KEY)}&token=${encodeURIComponent(token)}`
}

export async function lastfmTryGetSession(token: string): Promise<LastfmSession | null> {
  try {
    const res = await apiCall<{ session: { name: string; key: string } }>(
      { method: 'auth.getSession', token }, false,
    )
    const session: LastfmSession = { name: res.session.name, key: res.session.key }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch {}
    return session
  } catch (e) {
    if (e instanceof LastfmError && e.code === ERR_TOKEN_NOT_AUTHORIZED) return null
    if (e instanceof LastfmError && e.code === ERR_TOKEN_EXPIRED) {
      throw new LastfmError(e.code, 'Authorization expired - try connecting again.')
    }
    throw e
  }
}

// ─── Now playing / scrobbles ──────────────────────────────────────────────────

export interface LastfmTrackInfo {
  artist: string
  track: string
  album?: string
  duration?: number // seconds
}

export interface PendingScrobble extends LastfmTrackInfo {
  timestamp: number // unix seconds the track STARTED playing (Last.fm's rule)
}

// Fire-and-forget by design: a missed now-playing update is cosmetic, so all
// failures are swallowed (an invalid session still tears down the connection).
export async function lastfmUpdateNowPlaying(info: LastfmTrackInfo): Promise<void> {
  const session = getLastfmSession()
  if (!session || !lastfmConfigured()) return
  const params: Record<string, string> = {
    method: 'track.updateNowPlaying',
    sk: session.key,
    artist: info.artist,
    track: info.track,
  }
  if (info.album) params.album = info.album
  if (info.duration && info.duration > 0) params.duration = String(Math.round(info.duration))
  try {
    await apiCall(params, true)
  } catch (e) {
    if (e instanceof LastfmError && e.code === ERR_INVALID_SESSION) handleInvalidSession()
  }
}

function loadQueue(): PendingScrobble[] {
  try {
    const v = localStorage.getItem(QUEUE_KEY)
    const q = v ? (JSON.parse(v) as PendingScrobble[]) : []
    return Array.isArray(q) ? q : []
  } catch {
    return []
  }
}

function saveQueue(q: PendingScrobble[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_CAP))) } catch {}
}

export function lastfmQueueSize(): number {
  return loadQueue().length
}

// Queue + flush instead of a direct send so listens survive being offline,
// Last.fm outages, and app restarts (the queue lives in localStorage).
export function lastfmEnqueueScrobble(s: PendingScrobble): void {
  saveQueue([...loadQueue(), s])
}

let flushing = false

export async function lastfmFlushQueue(): Promise<void> {
  if (flushing || !lastfmConfigured()) return
  const session = getLastfmSession()
  if (!session) return
  flushing = true
  try {
    for (;;) {
      const queue = loadQueue()
      if (queue.length === 0) return
      // track.scrobble accepts up to 50 per call via indexed params.
      const batch = queue.slice(0, 50)
      const params: Record<string, string> = { method: 'track.scrobble', sk: session.key }
      batch.forEach((s, i) => {
        params[`artist[${i}]`] = s.artist
        params[`track[${i}]`] = s.track
        params[`timestamp[${i}]`] = String(s.timestamp)
        if (s.album) params[`album[${i}]`] = s.album
        if (s.duration && s.duration > 0) params[`duration[${i}]`] = String(Math.round(s.duration))
      })
      try {
        await apiCall(params, true)
      } catch (e) {
        if (e instanceof LastfmError) {
          if (e.code === ERR_INVALID_SESSION) { handleInvalidSession(); return }
          // Temporary server-side conditions: keep the batch, retry later.
          if (e.code === ERR_SERVICE_OFFLINE || e.code === ERR_TEMP_UNAVAILABLE || e.code === ERR_RATE_LIMITED) return
          // Any other API error is permanent for this payload (malformed
          // params etc.) - fall through and drop the batch so one bad entry
          // can't wedge the whole queue forever.
        } else {
          return // network error - keep everything queued
        }
      }
      // Reload rather than reusing `queue`: new scrobbles may have been
      // enqueued while the request was in flight, and only the batch (always
      // the queue's head) may be removed.
      saveQueue(loadQueue().slice(batch.length))
    }
  } finally {
    flushing = false
  }
}

// ─── API plumbing ─────────────────────────────────────────────────────────────

// Every authenticated method takes api_sig = md5 of all params (name+value,
// sorted by name, `format` excluded) with the shared secret appended.
function withSignature(params: Record<string, string>): URLSearchParams {
  const p: Record<string, string> = { ...params, api_key: API_KEY }
  const sig = md5(Object.keys(p).sort().map((k) => k + p[k]).join('') + API_SECRET)
  return new URLSearchParams({ ...p, api_sig: sig, format: 'json' })
}

async function apiCall<T>(params: Record<string, string>, post: boolean): Promise<T> {
  const search = withSignature(params)
  const res = await fetch(post ? API_ROOT : `${API_ROOT}?${search}`, post ? { method: 'POST', body: search } : undefined)
  // Last.fm returns errors as JSON bodies (often with a 4xx status) - parse
  // before checking res.ok so the API's own code/message wins over "HTTP 403".
  let json: unknown = null
  try { json = await res.json() } catch {}
  const err = json as { error?: number; message?: string } | null
  if (err && typeof err.error === 'number') throw new LastfmError(err.error, err.message || `Last.fm error ${err.error}`)
  if (!res.ok) throw new LastfmError(0, `Last.fm request failed (HTTP ${res.status})`)
  return json as T
}

// ─── MD5 (RFC 1321) ───────────────────────────────────────────────────────────
// Only needed for Last.fm's api_sig, which predates SubtleCrypto (which offers
// no MD5 anyway) - a dependency isn't worth it for one legacy digest. Operates
// on the UTF-8 encoding of the input, as the scrobbler spec requires.

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
// K[i] = floor(|sin(i+1)| · 2^32) - computed instead of a 64-entry literal
// (the Uint32Array assignment truncates to uint32 exactly as the spec wants).
const MD5_K = new Uint32Array(64)
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

function md5(input: string): string {
  const data = new TextEncoder().encode(input)
  const nBlocks = ((data.length + 8) >> 6) + 1
  const bytes = new Uint8Array(nBlocks * 64)
  bytes.set(data)
  bytes[data.length] = 0x80
  const dv = new DataView(bytes.buffer)
  const bitLen = data.length * 8
  dv.setUint32(bytes.length - 8, bitLen >>> 0, true)
  dv.setUint32(bytes.length - 4, Math.floor(bitLen / 4294967296), true)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const m = new Uint32Array(16)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const sum = (a + f + MD5_K[i] + m[g]) | 0
      const rotated = (sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i]))
      const nb = (b + rotated) | 0
      a = d; d = c; c = b; b = nb
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
  }

  let out = ''
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
  }
  return out
}
