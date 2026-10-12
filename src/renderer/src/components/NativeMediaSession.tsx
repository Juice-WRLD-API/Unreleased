import { useEffect } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { IS_NATIVE_APP } from '../lib/platform'
import { onMediaControlEvent, readLocalArtworkBase64, startMediaSession, updateMediaMetadata, updateMediaPlaybackState } from '../lib/mediaControl'
import { runPlayerCommand, seekAudio } from './Player'
import { startSiriCommands } from '../lib/siriCommands'

/** Android's foreground service keeps the WebView player alive when locked. */
export default function NativeMediaSession(): null {
  const { currentTrack, currentTrackFull, radioFmActive, radioFmNowPlaying, radioFmMatchedSong } = useStorePick(
    'currentTrack', 'currentTrackFull', 'radioFmActive', 'radioFmNowPlaying', 'radioFmMatchedSong')
  useEffect(() => {
    if (!IS_NATIVE_APP || !currentTrack) return
    startMediaSession()
    const title = radioFmActive ? radioFmNowPlaying?.title ?? '' : currentTrack.title
    const artist = radioFmActive ? radioFmNowPlaying?.artist ?? '' : currentTrack.artist
    const art = radioFmActive ? radioFmMatchedSong?.imageUrl : currentTrackFull?.albumArt ?? currentTrack.imageUrl
    const duration = currentTrackFull?.duration ?? currentTrack.duration ?? 0
    const metadata = { title, artist, album: currentTrack.album ?? '', duration }
    let cancelled = false
    updateMediaMetadata({ ...metadata, artworkUrl: art?.startsWith('http') ? art : null, artworkBase64: null })
    if (art && !art.startsWith('http')) {
      void readLocalArtworkBase64(art).then((artworkBase64) => {
        if (!cancelled) updateMediaMetadata({ ...metadata, artworkUrl: null, artworkBase64 })
      })
    }
    return () => { cancelled = true }
  }, [currentTrack, currentTrackFull, radioFmActive, radioFmNowPlaying, radioFmMatchedSong])

  useEffect(() => {
    if (!IS_NATIVE_APP) return
    let lastPush = 0
    const push = (state: ReturnType<typeof useStore.getState>, previous?: ReturnType<typeof useStore.getState>): void => {
      if (!state.currentTrack) {
        if (previous?.currentTrack) updateMediaPlaybackState({ playing: false, position: 0, speed: 1 })
        return
      }
      const now = performance.now()
      const changed = !previous || state.currentTrack.id !== previous.currentTrack?.id || state.isPlaying !== previous.isPlaying || state.playbackSpeed !== previous.playbackSpeed
      const seeked = previous && Math.abs(state.currentTime - previous.currentTime) > 2
      if (!changed && !seeked && now - lastPush < 3000) return
      lastPush = now
      startMediaSession()
      updateMediaPlaybackState({ playing: state.isPlaying, position: state.currentTime, speed: state.playbackSpeed })
    }
    push(useStore.getState())
    const unsubscribe = useStore.subscribe(push)
    const listeners = [
      onMediaControlEvent('play', () => useStore.getState().setIsPlaying(true)),
      onMediaControlEvent('pause', () => useStore.getState().setIsPlaying(false)),
      onMediaControlEvent('next', () => runPlayerCommand('next')),
      onMediaControlEvent('previous', () => runPlayerCommand('previous')),
      onMediaControlEvent<{ position: number }>('seek', ({ position }) => { if (Number.isFinite(position)) seekAudio(position) }),
    ]
    return () => { unsubscribe(); listeners.forEach((remove) => remove()) }
  }, [])
  useEffect(() => startSiriCommands(), [])
  return null
}
