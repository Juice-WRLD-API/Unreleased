// Shared HTTP layer for both juicewrldApi.ts and userApi.ts — one place that
// does the fetch, the offline-cache fallback, and error parsing, so neither
// caller has to reimplement any of it.
import { cacheGet, cacheSet } from './apiCache'

async function defaultParseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body === 'string') return body
    if (body.detail) return String(body.detail)
    const firstKey = Object.keys(body)[0]
    if (firstKey) {
      const val = body[firstKey]
      return Array.isArray(val) ? String(val[0]) : String(val)
    }
  } catch {}
  return `Request failed (${res.status})`
}

export interface ApiRequestOptions extends RequestInit {
  // Opts a GET into the offline fallback cache — pass only for idempotent
  // reads whose staleness is acceptable (playlists, favorites, profile,
  // song/browse data). On a network-level failure (offline, DNS, etc.) the
  // last successful response for this key is returned instead of throwing.
  // HTTP-level errors (4xx/5xx) are real responses and always throw — they
  // never fall back to cache.
  cacheKey?: string
  parseError?: (res: Response) => Promise<string>
}

// Identical GETs that overlap in time share a single network round-trip.
// Mount storms are the normal case here, not the exception: the tracker view,
// the startup prefetch and the era-name loader all reach for /stats/, /eras/
// and the first /songs/ page in the same React commit, so a cold load used to
// send each of those two or three times. Keyed on the cache key (the full URL
// including params) plus the auth header, since the same URL answers
// differently signed-in and signed-out.
//
// Deliberately only *in-flight* — nothing is remembered once a request
// settles. A time-based memo would also swallow the deliberate refetch that
// follows a mutation (create playlist → refreshPlaylists), which is a
// correctness problem the duplicate requests never were.
const inFlight = new Map<string, Promise<unknown>>()

function dedupeKey(cacheKey: string, init: RequestInit): string {
  let auth = ''
  try { auth = new Headers(init.headers).get('authorization') ?? '' } catch {}
  return `${auth}\u0000${cacheKey}`
}

// Builds the `Authorization: Token …` header object callers merge into their
// request headers - a no-op object when signed out. Takes the token as a
// param (rather than reading it itself) so this file never has to import
// userApi.ts, which already imports apiRequest from here.
export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Token ${token}` } : {}
}

// Shared "JSON body + bearer token" wrapper for lib/*Api.ts files that all
// re-implemented the same `Content-Type: application/json` + auth-header
// construction. Callers that need a different content type (file uploads) or
// raw fetch error handling keep doing that themselves - this only covers the
// common JSON case.
export async function authedRequest<T>(
  url: string,
  options: ApiRequestOptions = {},
  token: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(token) }
  return apiRequest<T>(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  })
}

export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { cacheKey, parseError = defaultParseError, ...init } = options

  const method = (init.method ?? 'GET').toUpperCase()
  // A request with its own abort signal never joins (or leads) a shared
  // in-flight fetch: aborting it would otherwise kill the same round-trip for
  // everyone else waiting on it.
  if (method === 'GET' && cacheKey && !init.signal) {
    const key = dedupeKey(cacheKey, init)
    const existing = inFlight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const pending = sendRequest<T>(url, init, cacheKey, parseError)
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, pending)
    return pending
  }

  return sendRequest<T>(url, init, cacheKey, parseError)
}

async function sendRequest<T>(
  url: string,
  init: RequestInit,
  cacheKey: string | undefined,
  parseError: (res: Response) => Promise<string>,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    // A cancel is not an outage - never answer it with a stale cached copy.
    if (init.signal?.aborted) throw err
    if (cacheKey) {
      const cached = cacheGet<T>(cacheKey)
      if (cached !== undefined) return cached
    }
    throw err
  }

  if (!res.ok) throw new Error(await parseError(res))
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = (text ? JSON.parse(text) : undefined) as T
  if (cacheKey) cacheSet(cacheKey, data)
  return data
}

export const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'

// For waiting on a request somebody else owns (a shared cache's in-flight
// fetch): stops *waiting* when the signal fires, but leaves that fetch running
// for its other callers. Requests this caller starts itself take the signal
// directly instead, so the network call is genuinely aborted.
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export { cacheDelete } from './apiCache'
