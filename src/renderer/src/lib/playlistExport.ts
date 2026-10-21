// Shared playlist-export helpers for PlaylistsView.
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
  tracks: ({
    id: number
    title: string
    artist: string
    album: string | null
    era: string | null
    path: string
    image_url: string | null | undefined
  } | {
    // A file entry: no catalogue id, just where the file lives.
    source: 'comp' | 'donor' | 'local'
    title: string
    path?: string
    channel?: string | null
    file_id?: string
    local_id?: string
  })[]
} {
  return {
    name: detail.name,
    description: detail.description,
    tracks: detail.items.map(i => i.song
      ? {
          id: i.song.id,
          title: i.song.name,
          artist: i.song.credited_artists,
          album: i.song.album ?? null,
          era: i.song.era?.name ?? null,
          path: i.song.path,
          image_url: i.song.image_url,
        }
      : i.source === 'comp'
        ? { source: 'comp' as const, title: i.title ?? '', path: i.filepath, channel: i.channel }
        : i.source === 'donor'
          ? { source: 'donor' as const, title: i.title ?? '', file_id: i.donor_file?.file_id }
          : { source: 'local' as const, title: i.title ?? '', local_id: i.local_id }),
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
