// Plays an API file entry, queuing the rest of the current folder's audio
// files behind it - identical logic shared by ApiFilesView.desktop.tsx and
// .mobile.tsx.
import { useState } from 'react'
import { fileToTrack } from '../lib/apiFilesShared'
import { getMediaType } from '../lib/fileTypes'
import { JWApiFileEntry } from '../lib/juicewrldApi'
import { Track } from '../types'
import { useTrackChannel } from './useTrackChannel'

export function usePlayFileEntry(
  entries: JWApiFileEntry[],
  playTrack: (track: Track, queue: Track[]) => void,
): { playing: string | null; handlePlay: (entry: JWApiFileEntry) => Promise<void> } {
  const [playing, setPlaying] = useState<string | null>(null)
  const { resolveTrackChannel, activeChannel } = useTrackChannel()

  const handlePlay = async (entry: JWApiFileEntry): Promise<void> => {
    if (playing === entry.path) return
    setPlaying(entry.path)
    try {
      // Unlike a like, a queue is transient - nothing is persisted, so when the
      // channel can't be resolved the listing's own channel is a better guess
      // than refusing to play. It is already correct for a non-primary tree.
      const ch = (await resolveTrackChannel()) ?? activeChannel
      const track = fileToTrack(entry, ch)
      const queue = entries
        .filter((e) => e.type === 'file' && getMediaType(e.name) === 'audio')
        .map((e) => fileToTrack(e, ch))
      playTrack(track, queue.length > 0 ? queue : [track])
    } finally {
      setPlaying(null)
    }
  }

  return { playing, handlePlay }
}
