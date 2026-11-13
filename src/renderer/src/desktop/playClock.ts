// Where the song is, told the way the lyric styles and the desktop windows follow it: a position at a moment and
// whether it runs on from there, sent again only when that stops being true - a play, a pause, a seek, a new song or
// another speed - rather than every frame.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { getAudioCurrentTime } from '../components/Player'
import { epochNow, type StageClock } from './lyrics/scene'

/** How far the told position may drift from the audio before it's told again. */
const DRIFT = 0.25
const CHECK_MS = 250

/** 999 FM's position: the station's elapsed time at its last update, run on from there. */
let fmBase: { elapsed: number; at: number } | null = null

/** Where 999 FM's song is now, in seconds. `elapsed_ms` is already the heard position (RadioFmPlayer
 *  corrects it for the stream's lag), so it only runs on from when it last changed. */
export function radioFmSeconds(): number {
  const elapsed = useStore.getState().radioFmNowPlaying?.elapsed_ms ?? 0
  // No position (the DJ is talking, or nothing's known yet): the song hasn't started.
  if (!elapsed) return 0
  if (!fmBase || fmBase.elapsed !== elapsed) fmBase = { elapsed, at: Date.now() }
  return (elapsed + Date.now() - fmBase.at) / 1000
}
// Stamped when the position lands, not when something first reads it: a reader that starts later
// would otherwise run on from its own start and lag by the difference.
useStore.subscribe((s, p) => {
  const elapsed = s.radioFmNowPlaying?.elapsed_ms ?? 0
  if (elapsed !== (p.radioFmNowPlaying?.elapsed_ms ?? 0)) fmBase = { elapsed, at: Date.now() }
})

/** The playing position: 999 FM's while it's on, otherwise the audio's. */
export function playingSeconds(): number {
  return useStore.getState().radioFmActive ? radioFmSeconds() : getAudioCurrentTime()
}

function read(): StageClock {
  const s = useStore.getState()
  if (s.radioFmActive) {
    return { seconds: radioFmSeconds(), at: epochNow(), running: !!s.radioFmNowPlaying?.elapsed_ms, rate: 1 }
  }
  return { seconds: getAudioCurrentTime(), at: epochNow(), running: s.isPlaying, rate: s.playbackSpeed || 1 }
}

/** Calls `onChange` with the clock now, and again each time it changes course. */
export function watchPlayClock(onChange: (clock: StageClock) => void): () => void {
  let last: StageClock | null = null
  const check = (): void => {
    const next = read()
    if (last && last.running === next.running && last.rate === next.rate) {
      const predicted = last.running ? last.seconds + (next.at - last.at) * (last.rate ?? 1) : last.seconds
      if (Math.abs(predicted - next.seconds) < DRIFT) return
    }
    last = next
    onChange(next)
  }
  check()
  const timer = window.setInterval(check, CHECK_MS)
  // The audio's own time updates (a few a second, never held back like a hidden page's timers) catch a seek too.
  const unsubscribe = useStore.subscribe((s, p) => {
    if (s.radioFmActive !== p.radioFmActive || s.radioFmNowPlaying !== p.radioFmNowPlaying
      || s.isPlaying !== p.isPlaying || s.currentTrack !== p.currentTrack || s.playbackSpeed !== p.playbackSpeed || s.currentTime !== p.currentTime) check()
  })
  return () => { window.clearInterval(timer); unsubscribe() }
}

export function usePlayClock(active = true): StageClock | null {
  const [clock, setClock] = useState<StageClock | null>(null)
  useEffect(() => (active ? watchPlayClock(setClock) : undefined), [active])
  return clock
}
