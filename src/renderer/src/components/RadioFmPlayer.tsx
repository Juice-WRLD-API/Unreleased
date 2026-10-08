import { useEffect, useRef, useCallback } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { RadioStreamClient, setActiveRadioClient } from '../lib/radioSocketService'
import { fetchRadioLive } from '../lib/radioLive'
import type { RadioVote } from '../lib/radioLive'
import { apiFetch, buildImageUrl, getSongById } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { attachAudioElement, resumeEffectsContext } from '../lib/audioEffects'

export default function RadioFmPlayer(): JSX.Element {
  const {
    radioFmActive, setRadioFmActive,
    setRadioFmIsLive, setRadioFmNowPlaying,
    setRadioFmUpNext, setRadioFmQueuePreview,
    setRadioFmMatchedSong,
    radioFmNowPlaying,
    setIsPlaying,
    volume,
  } = useStorePick('radioFmActive', 'setRadioFmActive', 'setRadioFmIsLive', 'setRadioFmNowPlaying', 'setRadioFmUpNext', 'setRadioFmQueuePreview', 'setRadioFmMatchedSong', 'radioFmNowPlaying', 'setIsPlaying', 'volume')

  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const clientRef = useRef<RadioStreamClient | null>(null)
  const voteWasActiveRef = useRef(false)

  // A brand new ballot clears any previous dismissal, exactly once. Doing it
  // here - the single place metadata lands - keeps the WRLD panel, the floating
  // popup, and pop-out windows from each keeping their own copy.
  const applyVote = useCallback((vote: RadioVote | null): void => {
    const isActive = !!vote?.active
    if (isActive && !voteWasActiveRef.current) {
      useStore.getState().setRadioFmVoteDismissed(false)
    }
    voteWasActiveRef.current = isActive
    useStore.getState().setRadioFmVote(vote)
  }, [])

  const wireAudio = useCallback((el: HTMLAudioElement | null): void => {
    audioRef.current = el
    const client = clientRef.current
    if (!el || !client) return
    client.attach(el)
    attachAudioElement(el)
    el.volume = useStore.getState().volume
  }, [])

  useEffect(() => {
    const client = new RadioStreamClient({
      onMeta: (data) => {
        setRadioFmIsLive(data.is_live)
        setRadioFmNowPlaying(data.now_playing)
        applyVote(data.vote ?? null)
        setRadioFmUpNext(data.up_next)
        setRadioFmQueuePreview(data.queue_preview ?? [])
      },
    })
    client.connect()
    clientRef.current = client
    setActiveRadioClient(client)
    wireAudio(audioRef.current)

    fetchRadioLive()
      .then((data) => {
        setRadioFmIsLive(data.is_live)
        setRadioFmNowPlaying(data.now_playing)
        applyVote(data.vote ?? null)
        setRadioFmUpNext(data.up_next)
        setRadioFmQueuePreview(data.queue_preview ?? [])
      })
      // A failed REST probe means "unknown", not "offline" - leaving isLive null
      // keeps the FM toggle usable while the socket is streaming fine.
      .catch((error) => console.warn('[radio] live probe failed', error))

    return () => {
      client.disconnect()
      setActiveRadioClient(null)
      clientRef.current = null
    }
  }, [])

  // Sync store volume → FM audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // Mobile background watchdog - the socket/audio pipeline can silently
  // stall while the tab is hidden (throttled timers, OS-paused audio).
  // Periodically nudge it, and recheck immediately when the tab regains focus.
  useEffect(() => {
    if (!radioFmActive) return
    const check = (): void => clientRef.current?.checkHealth()
    const id = setInterval(check, 8000)
    const onVisible = (): void => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [radioFmActive])

  useEffect(() => {
    const client = clientRef.current
    if (!client) return
    if (radioFmActive) {
      setIsPlaying(false)
      resumeEffectsContext()
      client.startListening().catch(() => setRadioFmActive(false))
    } else {
      client.stopListening()
    }
  }, [radioFmActive])


  // When FM now-playing changes, look up the song for cover + lyrics
  useEffect(() => {
    const title = radioFmNowPlaying?.title
    if (!title) { setRadioFmMatchedSong(null); return }
    let cancelled = false

    const apply = (song: JWApiSong) => {
      if (cancelled) return
      setRadioFmMatchedSong({
        songId: song.id ?? null,
        imageUrl: buildImageUrl(song.image_url) ?? null,
        path: song.path ?? null,
        lyrics: song.lyrics ?? null,
        syncedLyrics: song.synced_lyrics ?? null,
        era: song.era?.name ?? null,
      })
    }

    // Prefer direct song_id fetch; fall back to title search
    const songId = radioFmNowPlaying?.song_id
    if (songId) {
      getSongById(songId)
        .then(apply)
        .catch(() => {
          // song_id fetch failed - fall back to title search
          apiFetch<{ results: JWApiSong[] }>('/songs/', { search: title, page_size: 3 })
            .then(d => { if (d.results[0]) apply(d.results[0]); else if (!cancelled) setRadioFmMatchedSong(null) })
            .catch(() => { if (!cancelled) setRadioFmMatchedSong(null) })
        })
    } else {
      apiFetch<{ results: JWApiSong[] }>('/songs/', { search: title, page_size: 3 })
        .then(d => { if (d.results[0]) apply(d.results[0]); else if (!cancelled) setRadioFmMatchedSong(null) })
        .catch(() => { if (!cancelled) setRadioFmMatchedSong(null) })
    }

    return () => { cancelled = true }
  }, [radioFmNowPlaying?.title, radioFmNowPlaying?.song_id])

  return (
    <audio
      ref={wireAudio}
      preload="none"
      // MSE playback uses a same-origin blob: URL (crossOrigin is a no-op
      // there); the HTTP fallback streams from the API, which sends CORS
      // headers - both keep the Web Audio chain un-tainted.
      crossOrigin="anonymous"
      style={{ display: 'none' }}
      onError={() => {
        if (useStore.getState().radioFmActive) setRadioFmActive(false)
      }}
    />
  )
}
