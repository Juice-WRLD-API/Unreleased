import { JWAPI_BASE, apiFetch, buildImageUrl, resolvePrefCoverUrl, type JWApiSong } from './juicewrldApi'
import type { SongPrefMap } from './songPrefs'
import { apiRequest } from './apiClient'
import { getToken } from './userApi'

const ACCOUNT_BASE = `${JWAPI_BASE}/accounts`

export interface Artist {
  id: number
  name: string
  bio?: string
}

export interface AlbumSongEntry {
  order: number
  path: string
}

export interface Album {
  id: number
  title: string
  type?: string
  artist: Artist
  release_date: string
  description?: string
  cover_url: string
  play_count: number
  songs: AlbumSongEntry[]
}

/** An album's entries in play order. */
export const albumTracks = (album: Album): AlbumSongEntry[] => [...album.songs].sort((a, b) => a.order - b.order)

/** Album entries carry track paths, not full song metadata - this path→song
 *  lookup, built from the whole catalogue (loadAllSongs), resolves them. */
export const indexSongsByPath = (songs: JWApiSong[]): Map<string, JWApiSong> =>
  new Map(songs.filter(s => s.path).map(s => [s.path as string, s]))

/** The lead track's personalized cover wins, then the album's own cover, then
 *  the lead track's API art. The raw `image_url` alone skipped both of the
 *  first two - and comes back "null" for most unreleased songs. */
export function albumCoverUrl(album: Album, songIndex: Map<string, JWApiSong>, songPrefs: SongPrefMap): string | undefined {
  const lead = songIndex.get(albumTracks(album)[0]?.path ?? '')
  return (lead ? resolvePrefCoverUrl(songPrefs[lead.id]?.cover_url) : undefined)
    ?? buildImageUrl(album.cover_url)
    ?? buildImageUrl(lead?.image_url)
}

function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(url, { ...options, headers: { ...headers, ...(options.headers as Record<string, string>) } })
}

// The docs for these list endpoints promise a bare array, but the live API
// actually paginates /artists/ and /albums/ (the standard DRF
// {count,next,previous,results} envelope) - documented behavior has drifted
// from the real API before, so unwrap defensively instead of trusting either
// shape blindly.
function unwrapList<T>(data: T[] | { results: T[] }): T[] {
  return Array.isArray(data) ? data : (data?.results ?? [])
}

// ── Public (no auth) ─────────────────────────────────────────────────────────

export async function fetchArtists(): Promise<Artist[]> {
  return unwrapList(await apiFetch<Artist[] | { results: Artist[] }>('/artists/'))
}

export async function fetchAlbums(): Promise<Album[]> {
  return unwrapList(await apiFetch<Album[] | { results: Album[] }>('/albums/'))
}

// ── Admin (Token + is_administrator + OTP) ───────────────────────────────────

export async function adminFetchAlbums(): Promise<Album[]> {
  return unwrapList(await request<Album[] | { results: Album[] }>(`${ACCOUNT_BASE}/admin/albums/`, { method: 'GET' }))
}

export interface AlbumWritePayload {
  title: string
  artist_id: number
  release_date: string
  type?: string
  description?: string
  cover_url?: string
  play_count?: number
  songs?: AlbumSongEntry[]
}

export async function adminCreateAlbum(payload: AlbumWritePayload): Promise<Album> {
  return request(`${ACCOUNT_BASE}/admin/albums/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminUpdateAlbum(id: number, payload: Partial<AlbumWritePayload>): Promise<Album> {
  return request(`${ACCOUNT_BASE}/admin/albums/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function adminDeleteAlbum(id: number): Promise<void> {
  await request(`${ACCOUNT_BASE}/admin/albums/${id}/`, { method: 'DELETE' })
}
