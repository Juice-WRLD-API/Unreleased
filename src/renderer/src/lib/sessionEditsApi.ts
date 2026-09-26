import { apiFetch, parseBrowseEntries, normalizeSongTitle, loadAllSongs, JWApiSong, JWApiBrowseResponse, JWApiFileEntry } from './juicewrldApi'
import { createTtlCache } from './ttlCache'
import { setSessionEditLinksCache } from './sessionEditLinksMirror'

export interface SessionEditFile {
  name: string
  path: string
  era: string
  duration: string | null
  size: number | null
}

const SESSION_EDITS_ROOT = 'Session Edits'

async function browse(path: string, channel: string): Promise<JWApiFileEntry[]> {
  const params: Record<string, string> = { path }
  if (channel) params.channel = channel
  const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', params)
  return parseBrowseEntries(data)
}

async function fetchAll(channel: string): Promise<SessionEditFile[]> {
  const folders = (await browse(SESSION_EDITS_ROOT, channel)).filter((e) => e.type === 'directory')
  const perFolder = await Promise.all(
    folders.map(async (folder) => {
      const files = (await browse(folder.path, channel)).filter((e) => e.type === 'file')
      return files.map((f): SessionEditFile => ({
        name: f.name.replace(/\.[^.]+$/, ''),
        path: f.path,
        era: folder.name,
        duration: f.duration ?? null,
        size: f.size ?? null,
      }))
    })
  )
  return perFolder.flat()
}

const filesCaches = new Map<string, () => Promise<SessionEditFile[]>>()
export function loadSessionEditFiles(channel = ''): Promise<SessionEditFile[]> {
  let cache = filesCaches.get(channel)
  if (!cache) {
    cache = createTtlCache(5 * 60_000, () => fetchAll(channel))
    filesCaches.set(channel, cache)
  }
  return cache()
}

function stripSessionEditSuffix(title: string): string {
  let stripped = title
  let prev: string
  do {
    prev = stripped
    stripped = stripped.replace(/\s*\[Session Edit\]\s*$/i, '').replace(/\s*\(Sessions?\)\s*$/i, '')
  } while (stripped !== prev)
  return stripped
}

export interface SessionEditMatches {
  primary: Map<string, JWApiSong>
  alt: Map<string, JWApiSong>
}

async function fetchSessionEditMatches(): Promise<SessionEditMatches> {
  const allSongs = await loadAllSongs()
  const songById = new Map<number, JWApiSong>()
  const primaryBySongId = new Map<string, Set<number>>()
  const altBySongId = new Map<string, Set<number>>()
  for (const song of allSongs) {
    if (song.category !== 'recording_session') continue
    songById.set(song.id, song)
    const primaryNorm = normalizeSongTitle(song.name)
    if (primaryNorm) {
      if (!primaryBySongId.has(primaryNorm)) primaryBySongId.set(primaryNorm, new Set())
      primaryBySongId.get(primaryNorm)!.add(song.id)
    }
    for (const key of song.track_titles ?? []) {
      const norm = normalizeSongTitle(key)
      if (!norm) continue
      if (!altBySongId.has(norm)) altBySongId.set(norm, new Set())
      altBySongId.get(norm)!.add(song.id)
    }
  }
  const primary = new Map<string, JWApiSong>()
  for (const [norm, ids] of primaryBySongId) {
    if (ids.size === 1) primary.set(norm, songById.get([...ids][0])!)
  }
  const alt = new Map<string, JWApiSong>()
  for (const [norm, ids] of altBySongId) {
    if (primary.has(norm)) continue
    if (ids.size === 1) alt.set(norm, songById.get([...ids][0])!)
  }
  return { primary, alt }
}

export const loadSessionEditMatches = createTtlCache(5 * 60_000, fetchSessionEditMatches)

export interface SessionEditLink {
  path: string
  duration: string | null
}

async function buildLinkMap(channel: string): Promise<Map<number, SessionEditLink>> {
  const [files, matches] = await Promise.all([loadSessionEditFiles(channel), loadSessionEditMatches()])
  const fileNorms = files.map((file) => ({ file, norm: normalizeSongTitle(stripSessionEditSuffix(file.name)) }))
  const map = new Map<number, SessionEditLink>()
  for (const { file, norm } of fileNorms) {
    const song = matches.primary.get(norm)
    if (song && !map.has(song.id)) map.set(song.id, { path: file.path, duration: file.duration })
  }
  for (const { file, norm } of fileNorms) {
    const song = matches.alt.get(norm)
    if (song && !map.has(song.id)) map.set(song.id, { path: file.path, duration: file.duration })
  }
  return map
}

const linkCaches = new Map<string, () => Promise<Map<number, SessionEditLink>>>()
export function loadSessionEditLinks(channel = ''): Promise<Map<number, SessionEditLink>> {
  let cache = linkCaches.get(channel)
  if (!cache) {
    cache = createTtlCache(5 * 60_000, async () => {
      const map = await buildLinkMap(channel)
      setSessionEditLinksCache(channel, map)
      return map
    })
    linkCaches.set(channel, cache)
  }
  return cache()
}
