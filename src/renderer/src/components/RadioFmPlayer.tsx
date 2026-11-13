import { useEffect, useRef, useCallback } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { RadioStreamClient, setActiveRadioClient } from '../lib/radioSocketService'
import { fetchRadioLive } from '../lib/radioLive'
import type { RadioLiveState, RadioVote } from '../lib/radioLive'
import { apiFetch, buildImageUrl, getSongById } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { attachAudioElement, resumeEffectsContext } from '../lib/audioEffects'
import { noteRadioFrame } from '../lib/radioVoteOutcome'

/** What the listener is hearing: the DJ or a song, and which song. */
const fmKey = (data: RadioLiveState): string => `${data.state === 'dj_talking' ? 'talk' : 'song'}|${data.now_playing?.title ?? ''}`

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
  const pendingRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout>; data: RadioLiveState; at: number } | null>(null)
  const shownKeyRef = useRef<string | null>(null)

  // `elapsed_ms` is where the song is at the live edge when the station posted it. Lyrics and the
  // progress bars run on from it, so it's turned into where the song is in what this listener
  // hears: plus how old the post is, minus how far the audio trails the live edge.
  // While the DJ talks (`dj_talking`) the station already names the next song but keeps counting
  // the last one's elapsed time, so the new song's lyrics ran far ahead and then jumped back when
  // it really began. The talk carries no position: the clock waits at the start until the song plays.
  const show = useCallback((data: RadioLiveState, receivedAt: number): void => {
    const np = data.now_playing
    shownKeyRef.current = fmKey(data)
    if (!np) { setRadioFmNowPlaying(null); return }
    if (data.state === 'dj_talking' || np.elapsed_ms == null) { setRadioFmNowPlaying({ ...np, elapsed_ms: undefined }); return }
    const heard = np.elapsed_ms + (data.stale_seconds ?? 0) * 1000 - (clientRef.current?.listenLagMs() ?? 0) + (Date.now() - receivedAt)
    setRadioFmNowPlaying({ ...np, elapsed_ms: Math.max(1, Math.round(heard)) })
  }, [])

  // A new song, or the DJ starting or stopping, reaches the listener only once the audio already
  // buffered has played out, so the change is shown then rather than when the post arrives. Posts
  // for the same change that land meanwhile update it without pushing it back.
  const applyNowPlaying = useCallback((data: RadioLiveState): void => {
    const now = Date.now()
    const key = fmKey(data)
    const pending = pendingRef.current
    if (pending) {
      if (pending.key === key) { pending.data = data; pending.at = now; return }
      clearTimeout(pending.timer)
      pendingRef.current = null
    }
    const lag = clientRef.current?.listenLagMs() ?? 0
    if (shownKeyRef.current !== null && shownKeyRef.current !== key && lag > 250) {
      const timer = setTimeout(() => {
        const due = pendingRef.current
        pendingRef.current = null
        if (due) show(due.data, due.at)
      }, lag)
      pendingRef.current = { key, timer, data, at: now }
      return
    }
    show(data, now)
  }, [show])

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

  // A frame without the count keeps the last one rather than blanking it.
  const applyListeners = useCallback((count: number | undefined): void => {
    if (typeof count === 'number' && Number.isFinite(count)) useStore.getState().setRadioFmListeners(Math.max(0, count))
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
        applyNowPlaying(data)
        applyVote(data.vote ?? null)
        setRadioFmUpNext(data.up_next)
        setRadioFmQueuePreview(data.queue_preview ?? [])
        applyListeners(data.total_listeners)
        noteRadioFrame(data, useStore.getState().radioFmActive)
      },
    })
    client.connect()
    clientRef.current = client
    setActiveRadioClient(client)
    wireAudio(audioRef.current)

    fetchRadioLive()
      .then((data) => {
        setRadioFmIsLive(data.is_live)
        applyNowPlaying(data)
        applyVote(data.vote ?? null)
        setRadioFmUpNext(data.up_next)
        setRadioFmQueuePreview(data.queue_preview ?? [])
        applyListeners(data.total_listeners)
      })
      // A failed REST probe means "unknown", not "offline" - leaving isLive null
      // keeps the FM toggle usable while the socket is streaming fine.
      .catch((error) => console.warn('[radio] live probe failed', error))

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer)
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
    // The last song's cover and lyrics go at once rather than showing while the new one's are fetched.
    setRadioFmMatchedSong(null)

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
