import { apiFetch } from './juicewrldApi'
import { createTtlCache } from './ttlCache'

export interface TrackerChange {
  id: string
  proposal_id: number
  song_id: number | null
  action: string
  name: string
  user: string
  fields: string[]
  notes: string
  timestamp: string | null
  link: string
}

export interface CompChange {
  id: string
  action: string
  is_folder?: boolean
  path: string
  name: string
  folder: string
  user: string
  size: number | null
  md5: string
  source_path: string
  timestamp: string | null
  link: string
}

interface Results<T> {
  results: T[]
}

export async function fetchTrackerChanges(limit = 60): Promise<TrackerChange[]> {
  const res = await apiFetch<Results<TrackerChange>>('/feeds/tracker.json', { limit })
  return res.results ?? []
}

export async function fetchCompChanges(limit = 60): Promise<CompChange[]> {
  const res = await apiFetch<Results<CompChange>>('/feeds/comp.json', { limit })
  return res.results ?? []
}

async function buildRecentlyAddedMap(): Promise<Map<string, string>> {
  const changes = await fetchCompChanges(200)
  const map = new Map<string, string>()
  for (const c of changes) {
    if (c.is_folder || !c.timestamp) continue
    if (c.action !== 'create' && c.action !== 'upload') continue
    const existing = map.get(c.path)
    if (!existing || c.timestamp < existing) map.set(c.path, c.timestamp)
  }
  return map
}

export const loadRecentlyAddedMap = createTtlCache(5 * 60_000, buildRecentlyAddedMap)
