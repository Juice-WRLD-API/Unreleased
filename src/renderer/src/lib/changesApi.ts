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
  has_more?: boolean
  next_offset?: number | null
}

export interface ChangesPage<T> {
  results: T[]
  // null when this is the last page. An older server without `offset` support
  // sends neither field; treat that as one page so we never re-request it.
  nextOffset: number | null
}

async function fetchPage<T>(feed: 'tracker' | 'comp', limit: number, offset: number): Promise<ChangesPage<T>> {
  const res = await apiFetch<Results<T>>(`/feeds/${feed}.json`, offset > 0 ? { limit, offset } : { limit })
  const results = res.results ?? []
  const nextOffset = res.has_more ? (res.next_offset ?? offset + results.length) : null
  return { results, nextOffset }
}

export function fetchTrackerChangesPage(offset = 0, limit = 50): Promise<ChangesPage<TrackerChange>> {
  return fetchPage<TrackerChange>('tracker', limit, offset)
}

export function fetchCompChangesPage(offset = 0, limit = 50): Promise<ChangesPage<CompChange>> {
  return fetchPage<CompChange>('comp', limit, offset)
}

export async function fetchTrackerChanges(limit = 60): Promise<TrackerChange[]> {
  return (await fetchTrackerChangesPage(0, limit)).results
}

export async function fetchCompChanges(limit = 60): Promise<CompChange[]> {
  return (await fetchCompChangesPage(0, limit)).results
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
