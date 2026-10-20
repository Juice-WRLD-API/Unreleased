import { useStore, type AppStore } from '../store/useStore'

type LyricState = Pick<AppStore, 'currentTrack' | 'currentTrackFull' | 'lyricsOffset' | 'radioFmActive'>

export function lyricsSnapshot(state: LyricState) {
  const track = state.currentTrack
  // FM's live stream is not the queued track and has a different clock.
  if (!track || state.radioFmActive) return null
  const full = state.currentTrackFull?.id === track.id ? state.currentTrackFull : null
  return {
    track: { id: track.id, title: track.title, artist: track.artist, duration: track.duration },
    plainLyrics: full?.lyrics || '',
    syncedLyrics: full?.syncedLyrics || '',
    offset: state.lyricsOffset,
    pending: !full || !!full.lyricsPending,
  }
}

export function initIjwaLyrics(): void {
  const el = (window as any).electron
  if (el?.platform !== 'win32' || !el.setIjwaLyrics) return
  el.setIjwaLyrics(lyricsSnapshot(useStore.getState()))
  useStore.subscribe((state, before) => {
    if (state.currentTrack !== before.currentTrack || state.currentTrackFull !== before.currentTrackFull
      || state.lyricsOffset !== before.lyricsOffset || state.radioFmActive !== before.radioFmActive) {
      el.setIjwaLyrics(lyricsSnapshot(state))
    }
  })
}
