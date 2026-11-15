// The video every player shows in WRLD for a song, as administrators set it on the server
// (/accounts/admin/music-videos/). Players read /accounts/music-videos/ and use a song's default
// before their own automatic pick; a listener's pick on their device wins over both. See backend
// docs/11-admin.md, "Admin: Music video defaults".
import { routeUrl } from './apiServers'
import { apiRequest, authedRequest } from './apiClient'
import { getToken } from './userApi'
import { ls } from './persist'

const PUBLIC_URL = routeUrl('/accounts/music-videos/')
const ADMIN_URL = routeUrl('/accounts/admin/music-videos/')

export interface MusicVideoDefault {
  song_id: number
  public_id: number | null
  /** The song's file; players match what's playing by it. */
  song_path: string
  /** A video in the primary channel, or '' for no video. */
  video_path: string
  updated_at: string
  /** Admin list only. */
  song_name?: string
  updated_by?: string | null
}

const TTL_MS = 5 * 60 * 1000
let cache: { at: number; byPath: Promise<Map<string, string>> } | null = null
const listeners = new Set<() => void>()

function changed(): void {
  cache = null
  listeners.forEach((cb) => cb())
}

/** Called when an administrator changes a default, here or in another window. */
export function onMusicVideoDefaultsChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// Song info usually runs in a pop-out window: a change made there reaches WRLD in the main window this way.
const BUMP_KEY = 'musicVideoDefaultsAt'
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === `unreleased:${BUMP_KEY}`) changed() })
}

/** Song file path → its default video path ('' for none). Kept five minutes; offline, the last copy. */
export function getMusicVideoDefaults(force = false): Promise<Map<string, string>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.byPath
  const byPath = apiRequest<{ defaults?: MusicVideoDefault[] }>(PUBLIC_URL, { cacheKey: 'music-video-defaults' })
    .then((data) => new Map((data.defaults ?? []).filter((d) => d.song_path).map((d) => [d.song_path, d.video_path])))
  // A failed read isn't kept: no defaults this time, and the next song asks again.
  byPath.catch(() => { if (cache?.byPath === byPath) cache = null })
  cache = { at: Date.now(), byPath }
  return byPath
}

export function getMusicVideoDefaultsAdmin(signal?: AbortSignal): Promise<{ defaults: MusicVideoDefault[] }> {
  return authedRequest(ADMIN_URL, { signal }, getToken())
}

/** Sets a song's default for every player: a video path, or '' for no video. Administrators with two-factor only. */
export async function setMusicVideoDefault(songId: number, videoPath: string): Promise<MusicVideoDefault> {
  const row = await authedRequest<MusicVideoDefault>(ADMIN_URL, { method: 'PUT', body: JSON.stringify({ song_id: songId, video_path: videoPath }) }, getToken())
  ls.set(BUMP_KEY, Date.now())
  changed()
  return row
}

/** Puts a song back on the players' automatic pick. */
export async function clearMusicVideoDefault(songId: number): Promise<void> {
  await authedRequest(`${ADMIN_URL}${songId}/`, { method: 'DELETE' }, getToken())
  ls.set(BUMP_KEY, Date.now())
  changed()
}
