// Plays an API file entry, queuing the rest of the current folder's audio
// files behind it - identical logic shared by ApiFilesView.desktop.tsx and
// .mobile.tsx.
import { useState } from 'react'
import { fileToTrack } from '../lib/apiFilesShared'
import { getMediaType } from '../lib/fileTypes'
import { JWApiFileEntry } from '../lib/juicewrldApi'
import { Track } from '../types'

export function usePlayFileEntry(
  entries: JWApiFileEntry[],
  activeChannel: string,
  playTrack: (track: Track, queue: Track[]) => void,
): { playing: string | null; handlePlay: (entry: JWApiFileEntry) => Promise<void> } {
  const [playing, setPlaying] = useState<string | null>(null)

  const handlePlay = async (entry: JWApiFileEntry): Promise<void> => {
    if (playing === entry.path) return
    setPlaying(entry.path)
    try {
      const track = fileToTrack(entry, activeChannel)
      const queue = entries
        .filter((e) => e.type === 'file' && getMediaType(e.name) === 'audio')
        .map((e) => fileToTrack(e, activeChannel))
      playTrack(track, queue.length > 0 ? queue : [track])
    } finally {
      setPlaying(null)
    }
  }

  return { playing, handlePlay }
}
