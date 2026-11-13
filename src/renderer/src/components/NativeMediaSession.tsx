import { useEffect } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { IS_NATIVE_APP } from '../lib/platform'
import { onMediaControlEvent, readLocalArtworkBase64, setNativeResumeOnBluetooth, startMediaSession, updateMediaMetadata, updateMediaPlaybackState } from '../lib/mediaControl'
import { runPlayerCommand, seekAudio } from './Player'

/** Android's foreground service keeps the WebView player alive when locked. */
export default function NativeMediaSession(): null {
  const { currentTrack, currentTrackFull, radioFmActive, radioFmNowPlaying, radioFmMatchedSong, resumeOnBluetooth } = useStorePick(
    'currentTrack', 'currentTrackFull', 'radioFmActive', 'radioFmNowPlaying', 'radioFmMatchedSong', 'resumeOnBluetooth')
  useEffect(() => { setNativeResumeOnBluetooth(resumeOnBluetooth) }, [resumeOnBluetooth])
  useEffect(() => {
    if (!IS_NATIVE_APP || (!currentTrack && !radioFmActive)) return
    startMediaSession()
    const title = radioFmActive ? radioFmNowPlaying?.title || '999 FM' : currentTrack?.title ?? ''
    const artist = radioFmActive ? radioFmNowPlaying?.artist ?? '' : currentTrack?.artist ?? ''
    const art = radioFmActive ? radioFmMatchedSong?.imageUrl : currentTrackFull?.albumArt ?? currentTrack?.imageUrl
    const duration = radioFmActive ? 0 : currentTrackFull?.duration ?? currentTrack?.duration ?? 0
    const album = radioFmActive ? '999 FM' : currentTrack?.album ?? ''
    const metadata = { title, artist, album, duration }
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
    let resumeFm = false
    const push = (state: ReturnType<typeof useStore.getState>, previous?: ReturnType<typeof useStore.getState>): void => {
      if (state.radioFmActive || state.isPlaying || state.currentTrack?.id !== previous?.currentTrack?.id) resumeFm = false
      if (state.radioFmActive) {
        if (!previous?.radioFmActive) {
          startMediaSession()
          updateMediaPlaybackState({ playing: true, position: 0, speed: 0 })
        }
        return
      }
      if (!state.currentTrack) {
        if (previous?.currentTrack || previous?.radioFmActive) updateMediaPlaybackState({ playing: false, position: 0, speed: 1 })
        return
      }
      const now = performance.now()
      const changed = !previous || previous.radioFmActive || state.currentTrack.id !== previous.currentTrack?.id || state.isPlaying !== previous.isPlaying || state.playbackSpeed !== previous.playbackSpeed
      const seeked = previous && Math.abs(state.currentTime - previous.currentTime) > 2
      if (!changed && !seeked && now - lastPush < 3000) return
      lastPush = now
      startMediaSession()
      updateMediaPlaybackState({ playing: state.isPlaying, position: state.currentTime, speed: state.playbackSpeed })
    }
    push(useStore.getState())
    const unsubscribe = useStore.subscribe(push)
    const listeners = [
      onMediaControlEvent('play', () => {
        const state = useStore.getState()
        if (state.radioFmActive) return
        if (resumeFm) {
          resumeFm = false
          state.setRadioFmActive(true)
        } else {
          state.setIsPlaying(true)
        }
      }),
      onMediaControlEvent('pause', () => {
        const state = useStore.getState()
        if (state.radioFmActive) {
          resumeFm = true
          state.setRadioFmActive(false)
        } else {
          state.setIsPlaying(false)
        }
      }),
      onMediaControlEvent('next', () => { if (!useStore.getState().radioFmActive) runPlayerCommand('next') }),
      onMediaControlEvent('previous', () => { if (!useStore.getState().radioFmActive) runPlayerCommand('previous') }),
      onMediaControlEvent<{ position: number }>('seek', ({ position }) => {
        if (!useStore.getState().radioFmActive && Number.isFinite(position)) seekAudio(position)
      }),
    ]
    return () => { unsubscribe(); listeners.forEach((remove) => remove()) }
  }, [])
  return null
}
