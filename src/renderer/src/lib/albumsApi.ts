import { JWAPI_BASE, apiFetch } from './juicewrldApi'
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
  play_count: number
  songs: AlbumSongEntry[]
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  })
}

// The docs for these list endpoints promise a bare array, but the live API
// actually paginates /artists/ and /albums/ (the standard DRF
// {count,next,previous,results} envelope) - documented behavior has drifted
// from the real API before (see project memory), so unwrap defensively
// instead of trusting either shape blindly.
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
