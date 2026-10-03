import { getToken, loadConfig } from './config'

export const DEFAULT_API = 'https://juicewrldapi.com/juicewrld'
export const VERSION = __VERSION__

export function apiBase(): string {
  return (process.env.UNRELEASED_API || loadConfig().api || DEFAULT_API).replace(/\/+$/, '')
}

// The command running right now. Every request picks up its abort signal, so
// Ctrl+C cancels the network work of any command - including the site's file
// tools, which don't take a signal of their own.
let activeSignal: AbortSignal | undefined
export function setActiveSignal(signal: AbortSignal | undefined): void { activeSignal = signal }

function headers(token: string | null, json: boolean): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': `unreleased-cli/${VERSION}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Token ${token}` } : {}),
  }
}

/** The server's own words for a failed request, when it sent any. */
async function errorText(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json() as Record<string, unknown>
    const first = body.detail ?? body.error ?? body.message ?? body.non_field_errors ?? Object.values(body)[0]
    detail = Array.isArray(first) ? first.join(' ') : typeof first === 'string' ? first : ''
  } catch { /* not JSON */ }
  return `API error ${res.status}${detail ? `: ${detail}` : ''}`
}

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Use this token instead of the saved one (null sends none). */
  token?: string | null
}

export function apiUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(`${apiBase()}${path}`)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
  return url.toString()
}

export async function apiFetch<T>(path: string, params: Record<string, string | number | null | undefined> = {}, opts: RequestOptions = {}): Promise<T> {
  const token = opts.token === undefined ? getToken() : opts.token
  const res = await fetch(apiUrl(path, params), {
    method: opts.method ?? 'GET',
    headers: headers(token, opts.body !== undefined),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: activeSignal,
  })
  if (!res.ok) throw new Error(await errorText(res))
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Same URL the site's buildStreamUrl makes: a file's bytes from the tree. */
export function streamUrl(path: string, channel?: string): string {
  return apiUrl('/files/download/', { path, channel })
}

/** Opens a download; the caller reads the body. */
export async function fetchStream(url: string): Promise<Response> {
  const res = await fetch(url, { headers: headers(getToken(), false), signal: activeSignal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

// Mirrors the site's AccountUser, only the fields the CLI reads.
export interface Account {
  id: number
  username?: string
  discord_username?: string
  display_name?: string
  is_administrator?: boolean
  is_manager?: boolean
  is_editor?: boolean
}

export const accountName = (a: Account): string => a.discord_username || a.username || a.display_name || 'user'
export const accountRole = (a: Account): string => (a.is_administrator ? 'admin' : a.is_manager ? 'manager' : a.is_editor ? 'editor' : 'user')

export function getMe(token?: string | null): Promise<Account> {
  return apiFetch<Account>('/accounts/account/me/', {}, { token })
}

export function passwordLogin(username: string, password: string, otp?: string): Promise<{ token: string; user: Account }> {
  return apiFetch('/accounts/auth/login/', {}, { method: 'POST', body: { username, password, ...(otp ? { otp_token: otp } : {}) }, token: null })
}

export const isAbortError = (err: unknown): boolean => (err as Error | null)?.name === 'AbortError'

/** A failed request as one readable line ("couldn't reach …" rather than
 *  Node's bare "fetch failed"). */
export function describeError(err: unknown): string {
  const e = err as Error & { cause?: { code?: string } }
  if (e?.message === 'fetch failed') return `couldn't reach ${new URL(apiBase()).host}${e.cause?.code ? ` (${e.cause.code})` : ''}`
  if (/^API error 401\b/.test(e?.message ?? '') && getToken()) return `${e.message} - the saved token was rejected (try: login)`
  return e?.message || String(err)
}
