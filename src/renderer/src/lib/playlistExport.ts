// Shared playlist-export helpers for PlaylistsView desktop/mobile.
import type { PlaylistDetail } from './userApi'
import type { Track } from '../types'

export function downloadBlob(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function playlistJsonPayload(detail: PlaylistDetail): {
  name: string
  description: string | null | undefined
  tracks: {
    id: number
    title: string
    artist: string
    album: string | null
    era: string | null
    path: string
    image_url: string | null | undefined
  }[]
} {
  return {
    name: detail.name,
    description: detail.description,
    tracks: detail.items.map(i => ({
      id: i.song.id,
      title: i.song.name,
      artist: i.song.credited_artists,
      album: i.song.album ?? null,
      era: i.song.era?.name ?? null,
      path: i.song.path,
      image_url: i.song.image_url,
    })),
  }
}

export function playlistM3uContent(tracks: Track[]): string {
  const lines = ['#EXTM3U']
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration)},${t.artist} - ${t.title}`)
    lines.push(t.streamUrl ?? t.path)
  }
  return lines.join('\n')
}
