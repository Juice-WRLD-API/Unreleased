import { routeUrl } from './apiServers'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'

const BASE = '/v2/radio/personal'

export const PERSONAL_DJ_VIBES = [
  'auto', 'emotional', 'reflective', 'hopeful', 'hype', 'aggressive',
  'party', 'romantic', 'dark', 'chill', 'chaotic',
] as const

export type PersonalDjVibe = typeof PERSONAL_DJ_VIBES[number]

export interface PersonalDjTrack {
  song_id?: number | null
  source_id?: string | null
  title: string
  artist: string
  era?: string | null
  reason?: string | null
}

export interface PersonalDjStation {
  station_slug?: string
  slug?: string
  stream_url: string
  metadata_ws?: string
  status?: string
}

export interface PersonalDjLive extends PersonalDjStation {
  state?: string
  running?: boolean
  dj_enabled?: boolean
  listeners?: number
  elapsed_ms?: number
  duration_ms?: number
  now_playing?: PersonalDjTrack | null
  up_next?: PersonalDjTrack | null
  queue_preview?: PersonalDjTrack[]
  vibe?: string
  liked?: boolean
}

function authed<T>(path: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(routeUrl(`${BASE}${path}`), options, getToken())
}

export function startPersonalDj(): Promise<PersonalDjStation> {
  return authed<PersonalDjStation>('/start/', { method: 'POST' })
}

export function stopPersonalDj(): Promise<{ status: string }> {
  return authed<{ status: string }>('/stop/', { method: 'POST' })
}

export function fetchPersonalDjLive(): Promise<PersonalDjLive> {
  return authed<PersonalDjLive>('/live/')
}

export function skipPersonalDj(): Promise<unknown> {
  return authed<unknown>('/skip/', { method: 'POST' })
}

export function likePersonalDj(liked: boolean): Promise<unknown> {
  return authed<unknown>('/like/', { method: 'POST', body: JSON.stringify({ liked }) })
}

export function changePersonalDjVibe(vibe?: PersonalDjVibe): Promise<{ vibe: string; up_next: PersonalDjTrack | null }> {
  return authed('/vibe/', { method: 'POST', body: JSON.stringify(vibe ? { vibe } : {}) })
}
