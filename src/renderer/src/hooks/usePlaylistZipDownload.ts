// Shared "download all" flow for PlaylistsView desktop/mobile.
//
// Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED in
// juicewrldApi.ts) - the ZIP is built client-side instead (lib/clientZip).
// Tracks can be passed as a loader so the save dialog opens straight off the
// click, before the playlist fetch eats the user activation it needs.
import { useCallback, useState } from 'react'
import { openZipTarget, saveItems } from '../lib/clientZip'
import { buildStreamUrl } from '../lib/juicewrldApi'
import type { Track } from '../types'

export function usePlaylistZipDownload(): {
  zipState: 'idle' | 'loading' | 'done' | 'error'
  handleZipDownload: (trackList: Track[] | (() => Promise<Track[]>), name: string) => Promise<void>
} {
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleZipDownload = useCallback(async (trackList: Track[] | (() => Promise<Track[]>), name: string) => {
    if (zipState === 'loading') return
    if (Array.isArray(trackList) && !trackList.some(t => t.path)) return
    const target = await openZipTarget(name)
    if (!target) return
    setZipState('loading')
    try {
      const all = Array.isArray(trackList) ? trackList : await trackList()
      const items = all.filter(t => t.path).map(t => ({
        name: t.path.split('/').pop() || t.title,
        url: t.streamUrl ?? buildStreamUrl(t.path),
      }))
      const { saved } = items.length ? await saveItems(target, items) : { saved: 0 }
      setZipState(saved > 0 ? 'done' : 'error')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 3000)
  }, [zipState])

  return { zipState, handleZipDownload }
}
