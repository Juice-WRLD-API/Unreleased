import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { resumeEffectsContext } from '../lib/audioEffects'
import { JWAPI_BASE } from '../lib/apiServers'
import {
  startPersonalDj, stopPersonalDj, fetchPersonalDjLive,
  skipPersonalDj, likePersonalDj, changePersonalDjVibe,
} from '../lib/personalDjApi'
import type { PersonalDjLive, PersonalDjVibe } from '../lib/personalDjApi'

export type PersonalDjPhase = 'idle' | 'starting' | 'listening' | 'error'

const POLL_MS = 2500
const WARMUP_ATTEMPTS = 20
const WARMUP_INTERVAL_MS = 1000
const PLAY_TIMEOUT_MS = 15000

function playWithTimeout(el: HTMLAudioElement): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Could not connect to the radio stream. Try again in a moment.')), PLAY_TIMEOUT_MS)
  })
  return Promise.race([el.play(), timeout]).finally(() => clearTimeout(timer))
}

function resolveStreamUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const base = new URL(JWAPI_BASE)
  return `${base.origin}${url}`
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.'
}

function streamErrorText(el: HTMLAudioElement | null): string {
  const code = el?.error?.code
  if (code === MediaError.MEDIA_ERR_NETWORK) {
    return 'Could not reach the radio stream. Check that Radio Master is running.'
  }
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return 'The stream format is not supported. The station may still be starting.'
  }
  return 'The stream stopped unexpectedly.'
}

export function usePersonalDj() {
  const { volume, setIsPlaying, setRadioFmActive } = useStorePick('volume', 'setIsPlaying', 'setRadioFmActive')
  const [phase, setPhase] = useState<PersonalDjPhase>('idle')
  const [live, setLive] = useState<PersonalDjLive | null>(null)
  const [liveAt, setLiveAt] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const listeningRef = useRef(false)
  const connectingRef = useRef(false)

  const clearPoll = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const silence = (): void => {
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    el.load()
  }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchPersonalDjLive()
      if (!listeningRef.current) return
      setLive(data)
      setLiveAt(Date.now())
      if (data.running === false) {
        listeningRef.current = false
        clearPoll()
        silence()
        setPhase('error')
        setErrorMessage('Your station went off air.')
      }
    } catch (error) {
      console.warn('[personal-dj] live poll failed', error)
    }
  }, [])

  const stopListening = useCallback((): void => {
    const wasListening = listeningRef.current
    listeningRef.current = false
    clearPoll()
    silence()
    setPhase('idle')
    setLive(null)
    if (wasListening) stopPersonalDj().catch((error) => console.warn('[personal-dj] stop failed', error))
  }, [])

  const startListening = useCallback(async (): Promise<void> => {
    if (listeningRef.current) return
    setPhase('starting')
    setErrorMessage(null)
    if (useStore.getState().radioFmActive) setRadioFmActive(false)
    setIsPlaying(false)
    resumeEffectsContext()
    try {
      const station = await startPersonalDj()
      const el = audioRef.current
      if (!el || !station.stream_url) throw new Error('No stream available for your station.')
      listeningRef.current = true

      let streamUrl = station.stream_url
      let ready = false
      for (let attempt = 0; !ready && attempt < WARMUP_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, WARMUP_INTERVAL_MS))
        const liveData = await fetchPersonalDjLive()
        if (!listeningRef.current) return
        setLive(liveData)
        setLiveAt(Date.now())
        if (liveData.stream_url) streamUrl = liveData.stream_url
        ready = liveData.running === true && !!liveData.stream_url
      }
      if (!ready) throw new Error('Your station is taking too long to start. Try again in a moment.')

      if (!listeningRef.current) return
      connectingRef.current = true
      const resolved = resolveStreamUrl(streamUrl)
      el.src = `${resolved}${resolved.includes('?') ? '&' : '?'}_=${Date.now()}`
      el.volume = useStore.getState().volume
      try {
        await playWithTimeout(el)
      } finally {
        connectingRef.current = false
      }
      setPhase('listening')
      clearPoll()
      pollRef.current = setInterval(() => { void refresh() }, POLL_MS)
    } catch (error) {
      const wasListening = listeningRef.current
      listeningRef.current = false
      clearPoll()
      const errText = streamErrorText(audioRef.current)
      silence()
      setPhase('error')
      const playMsg = message(error)
      setErrorMessage(
        playMsg.includes('supported source') || playMsg.includes('NotSupportedError')
          ? errText
          : playMsg,
      )
      if (wasListening) stopPersonalDj().catch(() => {})
    }
  }, [refresh, setIsPlaying, setRadioFmActive])

  const runAction = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    if (!listeningRef.current) return
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (error) {
      setErrorMessage(message(error))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const skip = useCallback(() => runAction(skipPersonalDj), [runAction])
  const toggleLike = useCallback(() => runAction(() => likePersonalDj(!live?.liked)), [runAction, live?.liked])
  const changeVibe = useCallback((vibe: PersonalDjVibe) => runAction(() => changePersonalDjVibe(vibe)), [runAction])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => useStore.subscribe((s, prev) => {
    if (!listeningRef.current) return
    if ((s.isPlaying && !prev.isPlaying) || (s.radioFmActive && !prev.radioFmActive)) stopListening()
  }), [stopListening])

  useEffect(() => () => {
    if (!listeningRef.current) return
    listeningRef.current = false
    clearPoll()
    silence()
    stopPersonalDj().catch(() => {})
  }, [])

  const bindAudio = useCallback((el: HTMLAudioElement | null): void => {
    if (!el) return
    audioRef.current = el
    el.volume = useStore.getState().volume
  }, [])

  const onAudioError = useCallback((): void => {
    if (!listeningRef.current || connectingRef.current) return
    listeningRef.current = false
    clearPoll()
    setPhase('error')
    setErrorMessage(streamErrorText(audioRef.current))
    stopPersonalDj().catch(() => {})
  }, [])

  return {
    phase, live, liveAt, errorMessage, busy, bindAudio,
    startListening, stopListening, skip, toggleLike, changeVibe, onAudioError,
    dismissError: () => setErrorMessage(null),
  }
}
