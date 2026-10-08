import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { trackIdToSongId, updateNowPlaying } from '../lib/userApi'

// Keeps the 5-minute server-side staleness window (see docs/content.tsx "Now
// Playing") from expiring while a track is actively playing.
const PATCH_INTERVAL_MS = 20_000

// Headless - mounted once in App, mirrors LastfmScrobbler's shape. Pushes the
// current track to the public /np/ endpoint while public_now_playing is on
// and something with a real song id is playing, and clears it otherwise.
export default function NowPlayingSharer(): JSX.Element | null {
  const { currentTrack, isPlaying, publicNowPlaying } = useStore(useShallow((s) => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    publicNowPlaying: s.account?.public_now_playing ?? false,
  })))

  // Radio and raw file-browser tracks (see apiFileIdToRef elsewhere) have no
  // real song id - trackIdToSongId returns null for both, so they're skipped
  // the same way LastfmScrobbler drops their album metadata.
  const songId = currentTrack ? trackIdToSongId(currentTrack.id) : null
  const active = publicNowPlaying && isPlaying && songId != null

  const sharedRef = useRef(false)

  useEffect(() => {
    if (!active || !currentTrack || songId == null) {
      if (sharedRef.current) {
        sharedRef.current = false
        void updateNowPlaying(null)
      }
      return
    }
    const push = (): void => {
      void updateNowPlaying({
        song: songId,
        path: currentTrack.path,
        position: useStore.getState().currentTime,
      })
    }
    push()
    sharedRef.current = true
    const id = setInterval(push, PATCH_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentTrack?.id, songId])

  // App closing mid-listen: best-effort clear, no response awaited.
  useEffect(() => {
    const onUnload = (): void => { if (sharedRef.current) void updateNowPlaying(null) }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return null
}
