import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import {
  lastfmConfigured, lastfmUpdateNowPlaying, lastfmEnqueueScrobble, lastfmFlushQueue,
  lastfmQueueSize, setLastfmSessionInvalidHandler, type LastfmTrackInfo,
} from '../lib/lastfm'
import { apiFileIdToPath } from '../lib/juicewrldApi'

// Last.fm's scrobbling rules (https://www.last.fm/api/scrobbling): a track
// qualifies once it's been listened to for half its length or 4 minutes,
// whichever comes first, and tracks shorter than 30 seconds never scrobble.
const MIN_TRACK_S = 30
const SCROBBLE_AT_S = 240

// A backward currentTime jump this large that lands near the start is the
// same track restarting (repeat-one / user pressing back-to-start) - the old
// listen is finalized and a fresh one begins.
const RESTART_JUMP_S = 10
const RESTART_LANDING_S = 5

// One in-progress listen. `listened` counts wall-clock seconds actually spent
// playing (paused time excluded), which is what the half-or-4-minutes rule is
// defined over - track position can't be used directly because seeking would
// inflate or erase it.
interface Candidate {
  key: string
  info: LastfmTrackInfo
  startedAt: number // unix seconds - becomes the scrobble timestamp
  listened: number
}

// Headless - mounted once in App. Watches playback (both regular tracks and
// the live radio) and turns qualifying listens into queued scrobbles;
// lib/lastfm owns the network side.
export default function LastfmScrobbler(): JSX.Element | null {
  const {
    currentTrack, isPlaying,
    radioFmActive, radioFmNowPlaying,
    lastfmUser, lastfmEnabled,
  } = useStore(useShallow((s) => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    radioFmActive: s.radioFmActive,
    radioFmNowPlaying: s.radioFmNowPlaying,
    lastfmUser: s.lastfmUser,
    lastfmEnabled: s.lastfmEnabled,
  })))

  const active = lastfmConfigured() && !!lastfmUser && lastfmEnabled

  const candidateRef = useRef<Candidate | null>(null)
  // Last sampled playback position - only used for the restart detection.
  const lastTimeRef = useRef(0)

  // A revoked session discovered mid-flight (error 9) must also flip the UI
  // back to "not connected".
  useEffect(() => {
    setLastfmSessionInvalidHandler(() => useStore.getState().setLastfmUser(null))
    return () => setLastfmSessionInvalidHandler(null)
  }, [])

  // Ends the current listen: scrobbles it if it met the threshold, drops it
  // otherwise. Touches only refs + lib, so it's safe to call from any effect.
  const finalize = (): void => {
    const c = candidateRef.current
    candidateRef.current = null
    if (!c) return
    const dur = c.info.duration ?? 0
    if (dur > 0 && dur < MIN_TRACK_S) return
    const needed = dur > 0 ? Math.min(dur / 2, SCROBBLE_AT_S) : SCROBBLE_AT_S
    if (c.listened < needed) return
    lastfmEnqueueScrobble({ ...c.info, timestamp: c.startedAt })
    void lastfmFlushQueue()
  }

  // What's audible right now, normalized across the two sources. Radio has no
  // pause state - while the tuner is active and reporting a track, it plays.
  let item: { key: string; info: LastfmTrackInfo } | null = null
  let playing = false
  if (radioFmActive) {
    if (radioFmNowPlaying?.title && radioFmNowPlaying.artist) {
      item = {
        key: `radio:${radioFmNowPlaying.title}:${radioFmNowPlaying.artist}`,
        info: {
          artist: radioFmNowPlaying.artist,
          track: radioFmNowPlaying.title,
          album: radioFmNowPlaying.album || undefined,
          duration: (radioFmNowPlaying.duration_ms ?? 0) / 1000 || undefined,
        },
      }
      playing = true
    }
  } else if (currentTrack?.title && currentTrack.artist) {
    // Raw file-browser tracks (unreleased sessions/leaks with no proper song
    // entry - see apiFilePathToTrack) stuff the containing folder name into
    // `album` as a display fallback (e.g. "10. Outsiders (Session)"). That's
    // fine for the app's own UI but not a real album title, so it's dropped
    // here rather than scrobbled as one.
    const isRawFile = apiFileIdToPath(currentTrack.id) !== null
    item = {
      key: `track:${currentTrack.id}`,
      info: {
        artist: currentTrack.artist,
        track: currentTrack.title,
        album: isRawFile ? undefined : (currentTrack.album || undefined),
        duration: currentTrack.duration || undefined,
      },
    }
    playing = isPlaying
  }

  // Listen lifecycle: finalize on track change/stop, start a candidate when a
  // new item begins playing, and (re)send now-playing on start and on resume
  // (Last.fm expires now-playing on its own, so a resend after pause is the
  // only way to keep it accurate).
  useEffect(() => {
    if (!active) {
      // Disabled or disconnected mid-listen - drop, never scrobble.
      candidateRef.current = null
      return
    }
    if (candidateRef.current && candidateRef.current.key !== item?.key) finalize()
    if (!item) return
    if (playing && !candidateRef.current) {
      candidateRef.current = { key: item.key, info: item.info, startedAt: Math.floor(Date.now() / 1000), listened: 0 }
      lastTimeRef.current = useStore.getState().currentTime
    }
    if (playing) void lastfmUpdateNowPlaying(item.info)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, item?.key, playing])

  // Listened-time ticker + repeat-one restart detection.
  useEffect(() => {
    if (!active || !playing) return
    const id = setInterval(() => {
      const c = candidateRef.current
      if (!c) return
      c.listened += 1
      if (radioFmActive) return
      const t = useStore.getState().currentTime
      if (lastTimeRef.current - t > RESTART_JUMP_S && t < RESTART_LANDING_S) {
        const info = c.info
        finalize()
        candidateRef.current = { key: c.key, info, startedAt: Math.floor(Date.now() / 1000), listened: 0 }
        void lastfmUpdateNowPlaying(info)
      }
      lastTimeRef.current = t
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, playing, radioFmActive])

  // Delivery: drain the queue on connect/startup, retry once a minute while
  // anything is pending (offline listens, Last.fm outages), and immediately
  // when the network comes back.
  useEffect(() => {
    if (!active) return
    void lastfmFlushQueue()
    const id = setInterval(() => { if (lastfmQueueSize() > 0) void lastfmFlushQueue() }, 60_000)
    const onOnline = (): void => { void lastfmFlushQueue() }
    window.addEventListener('online', onOnline)
    return () => { clearInterval(id); window.removeEventListener('online', onOnline) }
  }, [active])

  // App closing mid-listen: enqueue synchronously (localStorage) - the send
  // happens next launch.
  useEffect(() => {
    const onUnload = (): void => finalize()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
