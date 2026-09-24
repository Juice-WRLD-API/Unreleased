// Per-subsystem API server overrides, settable from Settings -> About. Most
// deployments run everything off one host, but chat and radio each open
// their own websocket (see chatSocket.ts/radioSocketService.ts) and can be
// pointed at a different server than the main REST API - a staging chat
// relay in front of production songs, for instance.
//
// Every lib/*Api.ts file builds its own `${BASE}/...` constants at import
// time (see juicewrldApi.ts), so a change here only takes effect on next
// load - setServerOverride reloads for that reason.
export type ApiSubsystem = 'main' | 'chat' | 'radio'

export const DEFAULT_JWAPI_BASE = 'https://juicewrldapi.com/juicewrld'

export const API_SUBSYSTEM_LABELS: Record<ApiSubsystem, string> = {
  main: 'Main API',
  chat: 'Chat',
  radio: 'Radio',
}

function overrideKey(subsystem: ApiSubsystem): string {
  return subsystem === 'main' ? 'jwapi_base_override' : `jwapi_base_override_${subsystem}`
}

function readOverride(subsystem: ApiSubsystem): string | null {
  try {
    const raw = localStorage.getItem(overrideKey(subsystem))
    return raw ? raw.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

export function getServerOverride(subsystem: ApiSubsystem): string | null {
  return readOverride(subsystem)
}

export const JWAPI_BASE = readOverride('main') ?? DEFAULT_JWAPI_BASE

// Chat/radio fall back to the main API's host when they don't have their own
// override - most deployments run them on the same server.
export const CHAT_API_BASE = readOverride('chat') ?? JWAPI_BASE
export const RADIO_API_BASE = readOverride('radio') ?? JWAPI_BASE

export function baseForSubsystem(subsystem: ApiSubsystem): string {
  if (subsystem === 'main') return JWAPI_BASE
  if (subsystem === 'chat') return CHAT_API_BASE
  return RADIO_API_BASE
}

export function setServerOverride(subsystem: ApiSubsystem, url: string | null): void {
  try {
    const key = overrideKey(subsystem)
    if (url && url.trim()) {
      localStorage.setItem(key, url.trim().replace(/\/+$/, ''))
    } else {
      localStorage.removeItem(key)
    }
    if (subsystem === 'main') {
      // The channel list is cached per-install, not per-server - carrying it
      // over to a different API base would show channels that don't exist
      // there (or hide ones that do) until a later loadChannels() happens to
      // overwrite it.
      localStorage.removeItem('unreleased:channels')
      localStorage.removeItem('unreleased:activeChannel')
    }
  } catch {}
  location.reload()
}
