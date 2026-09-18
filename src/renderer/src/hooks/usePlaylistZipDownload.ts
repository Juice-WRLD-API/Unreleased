// Shared "download all" flow for PlaylistsView desktop/mobile.
//
// Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED in
// juicewrldApi.ts) - downloads every track's file individually instead,
// spaced out so the browser doesn't treat them as a popup flood.
import { useCallback, useState } from 'react'
import { triggerDownload } from '../lib/apiFilesShared'
import { buildStreamUrl } from '../lib/juicewrldApi'
import type { Track } from '../types'

export function usePlaylistZipDownload(): {
  zipState: 'idle' | 'loading' | 'done' | 'error'
  handleZipDownload: (trackList: Track[], name: string) => Promise<void>
} {
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleZipDownload = useCallback(async (trackList: Track[], name: string) => {
    if (zipState === 'loading') return
    const tracks = trackList.filter(t => t.path)
    if (!tracks.length) return
    setZipState('loading')
    try {
      for (const t of tracks) {
        triggerDownload(t.streamUrl ?? buildStreamUrl(t.path), t.path.split('/').pop() || t.title)
        await new Promise((r) => setTimeout(r, 350))
      }
      setZipState('done')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 3000)
  }, [zipState])

  return { zipState, handleZipDownload }
}
