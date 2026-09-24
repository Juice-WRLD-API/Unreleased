// API server overrides, settable from Settings -> About. The main override
// moves the whole app to a different Juice WRLD API instance; route rules
// then send individual path prefixes somewhere else on top of that - e.g.
// `/cdn` -> a separate CDN host, or `/chat` -> a staging chat relay in front
// of production songs. Chat and radio open their own websockets (see
// chatSocket.ts/radioSocketService.ts), which follow their `/chat` and
// `/radio` rules too.
//
// Every lib/*Api.ts file builds its own `${BASE}/...` constants at import
// time (see juicewrldApi.ts), so a change here only takes effect on next
// load - the setters reload for that reason.

export const DEFAULT_JWAPI_BASE = 'https://juicewrldapi.com/juicewrld'

const MAIN_KEY = 'jwapi_base_override'
const RULES_KEY = 'jwapi_route_rules'
// Pre-rules per-subsystem overrides, folded into rules on first read.
const LEGACY_KEYS: Record<string, string> = {
  jwapi_base_override_chat: '/chat',
  jwapi_base_override_radio: '/radio',
}

/** Requests whose path (relative to the API base) starts with `prefix` go to
 *  `base` instead of the main API. `base` is a full API base in the same shape
 *  as the main one - the path is appended to it unchanged. */
export interface RouteRule {
  prefix: string
  base: string
}

const stripSlash = (s: string): string => s.trim().replace(/\/+$/, '')

// Bases are fed to `new URL()` at import time (JWAPI_HOST, cdnWebrtc's
// WS_BASE), so a stored value without a scheme - `staging.example.com` -
// would throw before React mounts and leave a blank page with no way back
// to Settings. Anything that isn't an absolute http(s) URL is ignored.
function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function normalizePrefix(prefix: string): string {
  const p = stripSlash(prefix)
  if (!p) return ''
  return p.startsWith('/') ? p : `/${p}`
}

function readMain(): string | null {
  try {
    const raw = localStorage.getItem(MAIN_KEY)
    const base = raw ? stripSlash(raw) : ''
    return isHttpUrl(base) ? base : null
  } catch {
    return null
  }
}

function readRules(): RouteRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    if (raw === null) {
      const migrated: RouteRule[] = []
      for (const [key, prefix] of Object.entries(LEGACY_KEYS)) {
        const base = localStorage.getItem(key)
        if (base) migrated.push({ prefix, base: stripSlash(base) })
        localStorage.removeItem(key)
      }
      if (migrated.length) localStorage.setItem(RULES_KEY, JSON.stringify(migrated))
      return migrated
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RouteRule => typeof r?.prefix === 'string' && typeof r?.base === 'string')
      .map((r) => ({ prefix: normalizePrefix(r.prefix), base: stripSlash(r.base) }))
      .filter((r) => r.prefix && isHttpUrl(r.base))
  } catch {
    return []
  }
}

export function getServerOverride(): string | null {
  return readMain()
}

export function getRouteRules(): RouteRule[] {
  return readRules()
}

export const JWAPI_BASE = readMain() ?? DEFAULT_JWAPI_BASE

// Longest prefix first, so `/cdn/admin` beats `/cdn` when both are set.
const RULES = readRules().sort((a, b) => b.prefix.length - a.prefix.length)

/** The API base a request for `path` should go to. Matches on whole segments:
 *  `/cdn` covers `/cdn` and `/cdn/...`, never `/cdnfoo`. */
export function baseFor(path: string): string {
  for (const r of RULES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`) || path.startsWith(`${r.prefix}?`)) return r.base
  }
  return JWAPI_BASE
}

/** Full URL for an API path, with route rules applied. */
export function routeUrl(path: string): string {
  return `${baseFor(path)}${path}`
}

export const CHAT_API_BASE = baseFor('/chat')
export const RADIO_API_BASE = baseFor('/radio')

export function setServerOverride(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(MAIN_KEY, stripSlash(url))
    } else {
      localStorage.removeItem(MAIN_KEY)
    }
    // The channel list is cached per-install, not per-server - carrying it
    // over to a different API base would show channels that don't exist
    // there (or hide ones that do) until a later loadChannels() happens to
    // overwrite it.
    localStorage.removeItem('unreleased:channels')
    localStorage.removeItem('unreleased:activeChannel')
  } catch {}
  location.reload()
}

/** Drops incomplete rows and normalizes the rest - what setRouteRules stores,
 *  exposed so the settings UI can compare a draft against what's saved. */
export function cleanRouteRules(rules: RouteRule[]): RouteRule[] {
  return rules
    .map((r) => ({ prefix: normalizePrefix(r.prefix), base: stripSlash(r.base) }))
    .filter((r) => r.prefix && isHttpUrl(r.base))
}

export function setRouteRules(rules: RouteRule[]): void {
  try {
    const clean = cleanRouteRules(rules)
    // Stored even when empty: an absent key is what triggers the legacy
    // migration, and that must only ever run once.
    localStorage.setItem(RULES_KEY, JSON.stringify(clean))
  } catch {}
  location.reload()
}
