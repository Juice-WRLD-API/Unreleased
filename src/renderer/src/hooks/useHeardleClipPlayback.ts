// The Heardle clip player - a dedicated <audio> element with silence-aware
// unlock accounting. Byte-identical between HeardleView.desktop.tsx and
// .mobile.tsx before this extraction; neither view touches anything here
// beyond what's returned, so this is safe to share outright.
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildStreamUrl } from '../lib/juicewrldApi'
import type { HeardleSong } from '../lib/heardle'

export function useHeardleClipPlayback(params: {
  unlocked: number
  startAt: number
  answer: HeardleSong | null
  useServerRound: boolean
  serverClipUrl: string | null
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  volume: number
}): {
  audioRef: React.RefObject<HTMLAudioElement>
  playing: boolean
  preparing: boolean
  elapsed: number
  audioError: boolean
  setAudioError: (v: boolean) => void
  stopPlayback: () => void
  startPlayback: () => void
  enforceLimit: () => void
} {
  const { unlocked, startAt, answer, useServerRound, serverClipUrl, isPlaying, setIsPlaying, volume } = params

  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioError, setAudioError] = useState(false)

  // ── Playback ───────────────────────────────────────────────────────────────
  // A dedicated element rather than the app's player: this has to start at a
  // fixed point, cut off mid-song, and never touch the queue or what the user
  // was listening to. It's deliberately outside the Web Audio effects chain
  // too - the EQ shouldn't colour the clue.
  //
  // Positions are tracked relative to `startAt`, since a "random" clip start
  // means the element's currentTime is offset from what the player sees.
  // ── Silence detection ──────────────────────────────────────────────────────
  // A timestamp start can easily land in a gap - an intro pad, the beat of air
  // between verses - and a one-second clip of nothing is unguessable. So the
  // budget is spent in *audible* seconds: quiet is hopped over and doesn't
  // count against the unlock.
  //
  // This needs a private Web Audio graph on the game's element. Deliberately
  // not the shared effects chain (lib/audioEffects) - the EQ must never colour
  // the clue - but it carries the same CORS requirement: without
  // crossOrigin="anonymous" on the element, createMediaElementSource emits
  // pure silence. The API sends Access-Control-Allow-Origin, same as it does
  // for the main player.
  //
  // If any of it throws, analysis is simply off and the clip plays straight
  // through. A missing skip is a worse round; a broken graph is no audio.
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number | null>(null)
  const limitRef = useRef(unlocked)
  const startRef = useRef(startAt)
  useEffect(() => { limitRef.current = unlocked }, [unlocked])
  useEffect(() => { startRef.current = startAt }, [startAt])

  const analyserRef = useRef<AnalyserNode | null>(null)
  // Typed as the ArrayBuffer-backed variant getFloatTimeDomainData expects -
  // a bare Float32Array widens to ArrayBufferLike and won't assign.
  const analyserBufRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const graphFailedRef = useRef(false)

  const ensureAnalyser = useCallback((audio: HTMLAudioElement): boolean => {
    if (analyserRef.current) return true
    if (graphFailedRef.current) return false
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      source.connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      analyserBufRef.current = new Float32Array(analyser.fftSize)
      return true
    } catch {
      graphFailedRef.current = true
      return false
    }
  }, [])

  /** Peak amplitude of what's coming out right now (0..1). The signal is
   *  scaled by the element's volume, so the caller's threshold must be too. */
  const currentPeak = useCallback((): number => {
    const analyser = analyserRef.current
    const buf = analyserBufRef.current
    if (!analyser || !buf) return 1
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i])
      if (v > peak) peak = v
    }
    return peak
  }, [])

  // Audible seconds heard so far this play - this, not wall-clock position, is
  // what the unlock is measured in.
  const audibleRef = useRef(0)
  const lastTickRef = useRef(0)
  const silentSinceRef = useRef<number | null>(null)

  // Every start claims a token. Anything that ends playback bumps it, so the
  // async continuations below (waiting on metadata, on a seek, on play()) can
  // tell they've been superseded - a start that was still loading when the
  // view went away would otherwise land on a detached element and play the
  // song through, unsupervised. Refs survive unmount; audioRef.current doesn't.
  const playTokenRef = useRef(0)

  const stopPlayback = useCallback((): void => {
    playTokenRef.current++
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.currentTime = startRef.current }
    audibleRef.current = 0
    lastTickRef.current = 0
    silentSinceRef.current = null
    setPlaying(false)
    setPreparing(false)
    setElapsed(0)
  }, [])

  // Silence has to be quiet for a moment before it counts - inter-word gaps
  // and drum rests are part of a song, not dead air. Hops are short so the
  // onset of the next sound is never far past the landing point.
  const SILENCE_FLOOR = 0.005
  const SILENCE_HOLD_MS = 250
  const SILENCE_HOP_S = 0.4

  const tick = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    const now = performance.now()
    const dt = lastTickRef.current ? Math.min((now - lastTickRef.current) / 1000, 0.25) : 0
    lastTickRef.current = now

    // A stalled or seeking element outputs silence that isn't in the song -
    // don't bank it as audible and don't hop over it either.
    const settled = !audio.seeking && audio.readyState >= 2
    // Under a muted element, real silence and real audio look identical. The
    // only other reason to stand down is the graph having failed to build.
    const canDetect = !graphFailedRef.current
      && analyserRef.current !== null && audio.volume > 0.01
    const quiet = canDetect && settled && currentPeak() < SILENCE_FLOOR * audio.volume

    if (quiet) {
      if (silentSinceRef.current == null) silentSinceRef.current = now
      else if (now - silentSinceRef.current >= SILENCE_HOLD_MS) {
        const duration = isFinite(audio.duration) ? audio.duration : 0
        const cap = duration > 0 ? duration - 0.25 : audio.currentTime + SILENCE_HOP_S
        const next = Math.min(audio.currentTime + SILENCE_HOP_S, cap)
        // Out of song to skip into - end the clip rather than idle at the tail.
        if (next <= audio.currentTime) { stopPlayback(); return }
        audio.currentTime = next
      }
    } else {
      silentSinceRef.current = null
      if (settled) audibleRef.current += dt
    }

    if (audibleRef.current >= limitRef.current) { stopPlayback(); return }
    setElapsed(audibleRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [stopPlayback, currentPeak])

  /** Backstop cutoff. requestAnimationFrame drives the audible-time accounting
   *  above, but it stops firing while the page is hidden, so it cannot be the
   *  only thing ending a clip - this rides the element's own timeupdate, which
   *  keeps firing as long as audio is being decoded.
   *
   *  It measures wall-clock position, not audible time, so it has to allow for
   *  whatever silence the round is legitimately skipping past; the rAF path is
   *  what stops a normal clip on time. */
  const SILENCE_ALLOWANCE_S = 20
  const enforceLimit = useCallback((): void => {
    const audio = audioRef.current
    if (!audio || audio.paused) return
    const played = audio.currentTime - startRef.current
    if (played >= limitRef.current + SILENCE_ALLOWANCE_S) stopPlayback()
  }, [stopPlayback])

  const startPlayback = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    // Two things playing at once makes the clue unlistenable - yield the room.
    if (isPlaying) setIsPlaying(false)
    setAudioError(false)
    setPreparing(true)
    audio.volume = volume

    const token = ++playTokenRef.current
    const live = (): boolean => playTokenRef.current === token && !!audioRef.current

    // Built on first play (a user gesture), so the context isn't born
    // suspended. Autoplay policy can still suspend it later.
    ensureAnalyser(audio)
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {})
    audibleRef.current = 0
    lastTickRef.current = 0
    silentSinceRef.current = null

    // Seeking before the element knows the song's duration is silently
    // dropped, which put the clip back at 0:00 for every timestamp start -
    // wait for metadata (and the seek itself) before playing. Nothing to wait
    // for when the clip starts at the beginning.
    const begin = (): void => {
      if (!live()) { audio.pause(); return }
      audio.play()
        .then(() => {
          // play() resolves asynchronously too - the round can have ended, or
          // the view gone, in the meantime.
          if (!live()) { audio.pause(); return }
          setPreparing(false); setPlaying(true)
          rafRef.current = requestAnimationFrame(tick)
        })
        .catch(() => {
          if (!live()) return
          setPreparing(false); setAudioError(true); setPlaying(false)
        })
    }
    const seekThenPlay = (): void => {
      if (!live()) { audio.pause(); return }
      if (startRef.current <= 0 || Math.abs(audio.currentTime - startRef.current) < 0.25) { begin(); return }
      audio.addEventListener('seeked', begin, { once: true })
      audio.currentTime = startRef.current
    }
    if (audio.readyState >= 1 /* HAVE_METADATA */) seekThenPlay()
    else audio.addEventListener('loadedmetadata', seekThenPlay, { once: true })
  }, [isPlaying, setIsPlaying, volume, tick, ensureAnalyser])

  // Leaving the page stops the clip. Without this you could start a snippet,
  // switch away, and let the song run on underneath - the whole track for
  // free, on the first guess. Covers a backgrounded tab and a minimised
  // desktop window; navigating to another view unmounts this component, which
  // stops it through the cleanup below.
  useEffect(() => {
    const onVisibility = (): void => { if (document.hidden) stopPlayback() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stopPlayback])

  // New answer → new source, and never carry playback across rounds.
  useEffect(() => {
    stopPlayback()
    const audio = audioRef.current
    if (audio && useServerRound && serverClipUrl) audio.src = serverClipUrl
    else if (audio && answer) audio.src = buildStreamUrl(answer.path)
    setAudioError(false)
  }, [answer, serverClipUrl, useServerRound, stopPlayback])

  // Teardown. The element is captured on mount rather than read from the ref
  // in the cleanup: React detaches refs before passive cleanups run, so
  // audioRef.current can already be null here - and a paused-by-nobody element
  // keeps playing after the view is gone.
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      playTokenRef.current++
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      audio?.pause()
      // Contexts are a limited resource and this one is single-use.
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  return { audioRef, playing, preparing, elapsed, audioError, setAudioError, stopPlayback, startPlayback, enforceLimit }
}
