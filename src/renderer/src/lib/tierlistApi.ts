// Account-synced tier lists: /library/tierlists/, modelled on library
// playlists (same auth, same `is_public` + anonymous /public/{id}/ read).
//
// The list's contents travel as one opaque `data` object - tiers, rows and
// filters are client-defined and the server only stores and size-checks
// them, so the tier list UI can evolve without an API change each time.
//
// Errors carry the HTTP status (unlike apiClient's, which flatten it into a
// message): sync needs to tell "these routes don't exist on this server yet"
// (404/405) apart from a real failure, and stay local-only in the first case.
import { routeUrl } from './juicewrldApi'
import { authHeaders } from './apiClient'
import { getToken } from './userApi'
import type { Tier, TierlistFilters } from './tierlist'

const BASE = routeUrl('/library/tierlists')

/** What `data` holds. `v` lets a future client migrate old rows. */
export interface TierlistData {
  v: 1
  tiers: Tier[]
  rows: Record<string, number[]>
  filters: TierlistFilters
}

export interface ServerTierlist {
  id: number
  name: string
  is_public: boolean
  data: TierlistData
  ranked_count: number
  created_at: string
  updated_at: string
  /** Only on the public endpoint. */
  owner?: { id: number; display_name: string }
}

/** A public list as it appears on someone's profile - no `data`. */
export interface TierlistSummary {
  id: number
  name: string
  ranked_count: number
  created_at: string
  updated_at: string
}

export type TierlistWrite = Partial<Pick<ServerTierlist, 'name' | 'is_public' | 'data'>>

export class TierlistApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** The routes aren't deployed on this server (yet). */
export function isUnsupported(err: unknown): boolean {
  return err instanceof TierlistApiError && (err.status === 404 || err.status === 405 || err.status === 501)
}

async function send<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth ? getToken() : null) },
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) message = String(body.detail)
    } catch {}
    throw new TierlistApiError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function listTierlists(): Promise<ServerTierlist[]> {
  return send<ServerTierlist[] | { results: ServerTierlist[] }>('/')
    .then((d) => (Array.isArray(d) ? d : d?.results ?? []))
}

export function createTierlist(body: Required<Pick<ServerTierlist, 'name' | 'data'>> & { is_public?: boolean }): Promise<ServerTierlist> {
  return send('/', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTierlist(id: number, body: TierlistWrite): Promise<ServerTierlist> {
  return send(`/${id}/`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteTierlist(id: number): Promise<void> {
  return send(`/${id}/`, { method: 'DELETE' })
}

/** A public list, anonymously - or your own, whatever its visibility, when
 *  signed in as its owner. */
export function getPublicTierlist(id: number): Promise<ServerTierlist> {
  return send(`/public/${id}/`, {}, true)
}
