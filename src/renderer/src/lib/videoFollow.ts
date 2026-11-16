// A muted video kept in time with the song, by the sync lib/videoSync works out: where in the video each part of the
// song is, so an intro or a skit cut into the video is stepped over. Used by WRLD (components/WrldMusicVideo.tsx) and by
// the cleared desk's curtain (desktop/pages/curtain.ts), which has no store of its own: so nothing here imports one.

/** From `at` seconds into the song (until the next span), the video is `lag` seconds ahead of it; null: not in the video. */
export interface SyncSpan { at: number; lag: number | null }
export interface VideoSync {
  spans: SyncSpan[]
  /** Share of the song's windows found in the video, 0..1. */
  covered: number
}

/** Where the video should be for a moment of the song, or null when that part isn't in it. */
export function videoTimeAt(sync: VideoSync, songSeconds: number): number | null {
  let span = sync.spans[0]
  for (const s of sync.spans) { if (s.at <= songSeconds) span = s; else break }
  return span?.lag == null ? null : songSeconds + span.lag
}

/** Where the song is: its position in seconds, whether it runs, and at what speed. */
export interface SongClock { song: number; playing: boolean; rate: number }

/** How far the video may be off before it's moved (seconds); closer than this it's eased in by its speed. */
const SEEK_AT = 0.4
const EASE_AT = 0.04
const STEP_MS = 100
/** A video this far ahead of the song (where a seek aimed) holds its frame for it; further than this it seeks back. */
const HOLD_MAX = 4
/** What a seek is first assumed to take, before one has been timed, and the most it's allowed to count as. */
const SEEK_GUESS = 1.2
const SEEK_MAX = 3

/** Keeps `v` with the song by `clock`. `onShown` hears whether a frame of the right moment is up: true once one is drawn,
 *  false for a part of the song the video leaves out. `initiallyShown`: the video is already up (the same element picked
 *  up again after a remount), so it stays up through the first seek. Returns the way to stop (the video is paused). */
export function followVideo(v: HTMLVideoElement, sync: VideoSync, clock: () => SongClock, onShown: (shown: boolean) => void, initiallyShown = false): () => void {
  let shown = initiallyShown
  // How long a seek into a part not loaded yet takes here (the server needs about a second to start sending one).
  let seekCost = SEEK_GUESS
  let seekStarted = 0
  const onSeeked = (): void => {
    if (!seekStarted) return
    const took = (performance.now() - seekStarted) / 1000
    seekStarted = 0
    if (took > 0.25) seekCost = Math.min(SEEK_MAX, Math.max(0.3, seekCost * 0.6 + took * 0.4))
  }
  v.addEventListener('seeked', onSeeked)
  const loaded = (time: number): boolean => {
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= time && time < v.buffered.end(i) - 0.5) return true
    return false
  }
  const step = (): void => {
    const { song, playing, rate } = clock()
    const t = videoTimeAt(sync, song)
    const end = Number.isFinite(v.duration) ? v.duration - 0.15 : Infinity
    const inVideo = t !== null && t >= 0 && t < end
    if (inVideo && v.seeking) {
      // Mid-seek: wait for it rather than asking again for a moment that will have passed by the time it lands.
    } else if (inVideo) {
      const drift = v.currentTime - t
      if (!playing) {
        if (!v.paused) v.pause()
        if (Math.abs(drift) > EASE_AT) v.currentTime = t
      } else if (drift < -SEEK_AT || drift > HOLD_MAX) {
        // Aim where the song will be once the frame arrives, and wait there for it: chasing the song's position
        // only ever lands behind it and seeks again.
        const lead = (loaded(t) ? 0.1 : seekCost) * rate
        const ahead = videoTimeAt(sync, song + lead)
        seekStarted = performance.now()
        v.currentTime = ahead !== null && ahead < end ? ahead : t
        v.pause()
      } else if (drift > SEEK_AT || (v.paused && drift > EASE_AT)) {
        // Ahead of the song (where a seek aimed): hold this frame until the song gets here, then go with it.
        if (!v.paused) v.pause()
      } else {
        v.playbackRate = rate * (Math.abs(drift) > EASE_AT ? (drift > 0 ? 0.96 : 1.04) : 1)
        if (v.paused) v.play().catch(() => { /* not loaded yet; tried again next step */ })
      }
    } else if (!v.paused) v.pause()
    // Up once a frame of the right moment is drawn (a seek's frame lands a moment after it's asked for), and kept up
    // through later seeks, such as stepping over a skit, rather than blinking.
    const next = inVideo && (shown || (v.readyState >= 2 && !v.seeking))
    if (next !== shown) {
      shown = next
      onShown(next)
    }
  }
  step()
  const timer = window.setInterval(step, STEP_MS)
  return () => {
    window.clearInterval(timer)
    v.removeEventListener('seeked', onSeeked)
    v.pause()
  }
}
