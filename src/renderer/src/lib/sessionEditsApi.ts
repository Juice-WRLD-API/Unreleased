import { apiFetch, apiUrl, parseBrowseEntries, normalizeSongTitle, loadAllSongs, getSongById, searchFiles, buildStreamUrl, JWApiSong, JWApiBrowseResponse, JWApiFileEntry } from './juicewrldApi'
import { apiRequest } from './apiClient'
import { createTtlCache } from './ttlCache'
import { peekActiveChannel } from './activeChannelState'
import { peekSessionEditLink, setSessionEditLink, setSessionEditLinksCache, sessionEditSongId } from './sessionEditLinksMirror'

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

// Only recording_session songs can have a session-edit link, and the API
// applies ?category= even with ?all=true: ~500 songs / ~1.2 MB instead of the
// ~10 MB whole catalogue this used to pull (and JSON.parse) on every app
// start. Deliberately not apiFetch - that would also persist the response to
// the localStorage offline cache, a ~2.3 MB (UTF-16) synchronous write for
// data that's useless offline, since session edits only ever stream.
const loadSessionSongs = createTtlCache(5 * 60_000, () =>
  apiRequest<JWApiSong[]>(apiUrl('/songs/', { category: 'recording_session', all: 'true' }), { cache: 'no-cache' }))

async function fetchSessionEditMatches(): Promise<SessionEditMatches> {
  // Reuse the whole catalogue if someone else already paid for it.
  const allSongs = await (loadAllSongs.peek() ?? loadSessionSongs())
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

// ─── Lookup on play ───────────────────────────────────────────────────────────
//
// The walk above lists every Session Edits folder; that's far more than playing
// one song needs, so playback instead searches the file tree for just that
// song's name (and its alternate titles) and keeps the result.

const AUDIO_FILE = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?|wma|mp4)$/i
const SESSION_EDITS_PREFIX = `${SESSION_EDITS_ROOT.toLowerCase()}/`

export class SessionEditNotFoundError extends Error {
  constructor(songId: number) {
    super(`No session edit found for song ${songId}`)
    this.name = 'SessionEditNotFoundError'
  }
}

const lookups = new Map<string, Promise<SessionEditLink | null>>()

async function lookupSessionEdit(songId: number, channel: string): Promise<SessionEditLink | null> {
  const song = await getSongById(songId)
  const terms = [song.name, ...(song.track_titles ?? [])]
    .map((t) => stripSessionEditSuffix(t))
    .filter((t, i, a) => t && a.indexOf(t) === i)
  const extra: Record<string, string> = channel ? { channel } : {}
  // Primary name first; alternate titles only if it finds nothing.
  for (const term of terms) {
    const wanted = normalizeSongTitle(term)
    if (!wanted) continue
    const entries = await searchFiles(term, extra)
    const hit = entries.find((e) =>
      e.type === 'file' &&
      e.path.toLowerCase().startsWith(SESSION_EDITS_PREFIX) &&
      AUDIO_FILE.test(e.name) &&
      normalizeSongTitle(stripSessionEditSuffix(e.name.replace(/\.[^.]+$/, ''))) === wanted)
    if (hit) return { path: hit.path, duration: hit.duration ?? null }
  }
  return null
}

/** The stream URL for a `sessionedit://<id>` marker, or null if it hasn't been looked up yet. */
export function cachedSessionEditUrl(placeholder: string): string | null {
  const channel = peekActiveChannel()
  const link = peekSessionEditLink(sessionEditSongId(placeholder), channel)
  return link ? buildStreamUrl(link.path, channel || undefined) : null
}

/** Looks up (once per song and channel) the session edit file a song plays, rejecting when there isn't one. */
export function ensureSessionEditUrl(placeholder: string): Promise<string> {
  const hit = cachedSessionEditUrl(placeholder)
  if (hit) return Promise.resolve(hit)
  const songId = sessionEditSongId(placeholder)
  const channel = peekActiveChannel()
  const key = `${channel}:${songId}`
  let p = lookups.get(key)
  if (!p) {
    p = lookupSessionEdit(songId, channel).finally(() => {
      // A miss isn't remembered, so a retry searches again.
      if (!peekSessionEditLink(songId, channel)) lookups.delete(key)
    })
    lookups.set(key, p)
  }
  return p.then((link) => {
    if (!link) throw new SessionEditNotFoundError(songId)
    setSessionEditLink(songId, channel, link)
    return buildStreamUrl(link.path, channel || undefined)
  })
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
