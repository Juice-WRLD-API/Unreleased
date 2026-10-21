// Shared "download all" flow for PlaylistsView desktop/mobile.
//
// Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED in
// juicewrldApi.ts) - the ZIP is built client-side instead (lib/clientZip).
// Tracks can be passed as a loader so the save dialog opens straight off the
// click, before the playlist fetch eats the user activation it needs.
import { useCallback, useState } from 'react'
import { openZipTarget, saveItems } from '../lib/clientZip'
import { resolveTrackFile } from '../lib/sessionEditsApi'
import { trackIdToSongId } from '../lib/userApi'
import { isPrimaryChannelSlug } from './useChannelRoles'
import { useStore } from '../store/useStore'
import type { Track } from '../types'
import { isServerFileTrack } from '../lib/playlistItems'

export function usePlaylistZipDownload(): {
  zipState: 'idle' | 'loading' | 'done' | 'error'
  handleZipDownload: (trackList: Track[] | (() => Promise<Track[]>), name: string) => Promise<void>
} {
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleZipDownload = useCallback(async (trackList: Track[] | (() => Promise<Track[]>), name: string) => {
    if (zipState === 'loading') return
    if (Array.isArray(trackList) && !trackList.some(isServerFileTrack)) return
    const target = await openZipTarget(name)
    if (!target) return
    setZipState('loading')
    try {
      const all = Array.isArray(trackList) ? trackList : await trackList()
      const { channels, activeChannel } = useStore.getState()
      const useCdn = isPrimaryChannelSlug(channels, activeChannel)
      // A session not yet looked up has no file of its own until it is.
      const files = await Promise.all(all.filter(isServerFileTrack).map(t =>
        resolveTrackFile(t).then(f => ({
          name: f.path.split('/').pop() || t.title,
          url: f.url,
          // A file from another comp's tree isn't what the CDN holds at that path.
          cdnPath: useCdn && !f.url.includes('&channel=') ? f.path : undefined,
          songId: trackIdToSongId(t.id),
        }), () => null)))
      const items = files.filter(<T,>(f: T | null): f is T => f != null)
      const { saved, cancelled } = items.length ? await saveItems(target, items) : { saved: 0, cancelled: false }
      if (cancelled) { setZipState('idle'); return }
      setZipState(saved > 0 ? 'done' : 'error')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 3000)
  }, [zipState])

  return { zipState, handleZipDownload }
}
