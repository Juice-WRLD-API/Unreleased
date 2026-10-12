import { RADIO_API_BASE } from './apiServers'

export interface RadioTrack {
  title: string
  artist: string
  album?: string
  display?: string
  elapsed_ms?: number
  duration_ms?: number
  image_url?: string
  song_id?: number
}

export interface RadioVote {
  active: boolean
  kind?: 'skip' | 'queue'
  yes?: number
  no?: number
  votes_needed?: number
  total_listeners?: number
  seconds_left?: number
  track?: string
}

export interface RadioLiveState {
  is_live: boolean
  station: string
  state: string
  stream_url: string
  now_playing: RadioTrack | null
  up_next: RadioTrack | null
  queue_preview: string[]
  dj_enabled?: boolean
  dj_line?: string
  vote?: RadioVote
  web_listeners?: number
  discord_listeners?: number
  total_listeners?: number
  stale_seconds?: number | null
}

export async function fetchRadioLive(): Promise<RadioLiveState> {
  const res = await fetch(`${RADIO_API_BASE}/radio/live/`)
  if (!res.ok) throw new Error(`Radio live ${res.status}`)
  return res.json()
}
