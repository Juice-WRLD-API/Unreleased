import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Maximize2,
  ListOrdered,
  Heart,
  ChevronUp,
  ChevronDown,
  Check,
  MoreHorizontal,
  Radio,
  Info,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { eventToCombo, resolveAction, registerHotkeyDispatch } from '../lib/hotkeys'
import { formatDuration } from '../lib/format'
import { getSongById, smallCoverUrl } from '../lib/juicewrldApi'
import { trackIdToSongId, showStaffProfile, staffProfileView } from '../lib/userApi'
import { rememberRecentTrack } from '../lib/recentTracks'
import { useCanEdit } from '../hooks/useChannelRoles'
import { toFileUrl } from '../lib/fileTypes'
import { IS_IOS } from '../lib/platform'
import { FullTrack } from '../types'
import SongContextMenu from './SongContextMenu'
import EqualizerPanel from './EqualizerPanel'
import { Sheet } from './mobile/Sheet'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  attachAudioElement, applyAudioEffects, resumeEffectsContext,
  setEffectsOutputDevice, getCurrentPeak, setEffectsChainWanted, EFFECTS_SUPPORTED,
} from '../lib/audioEffects'
import { LibraryTrack } from '../types'

function resolvePlaybackUrl(track: { id: string; streamUrl?: string; path: string }): string {
  return track.streamUrl ?? toFileUrl(track.path)
}

// How long the pause-fade ramps volume when "smooth fade when pausing" is on.
const PAUSE_FADE_MS = 400

// How much of a song counts as having played it (or half its length, for
// anything shorter). See creditPlayIfListened.
const PLAYCOUNT_THRESHOLD_SECONDS = 30

// ── Stream recovery tuning ───────────────────────────────────────────────────
// How many times a single track may be reloaded before the player gives up and
// admits it isn't playing.
const MAX_RECOVERY_ATTEMPTS = 4
// How long playback may sit with the clock not advancing before that counts as
// a dead stream rather than ordinary rebuffering. Generous, because a phone on
// a weak connection legitimately stalls for a while and re-fetching costs data.
const STALL_TIMEOUT_MS = 20000
// Grace period after a reload before healthy playback is allowed to reset the
// attempt counter - otherwise a stream that plays half a second and dies each
// time would retry forever.
const RECOVERY_SETTLE_MS = 10000
// Ceiling on consecutively skipped unplayable tracks, so an API outage that
// 404s everything stops the queue instead of racing through it.
const MAX_CONSECUTIVE_SKIPS = 3

let _seek: ((t: number) => void) | null = null
let _getAudioDuration: (() => number) | null = null
let _getAudioCurrentTime: (() => number) | null = null
export function seekAudio(t: number): void { _seek?.(t) }
export function getAudioDuration(): number { return _getAudioDuration?.() ?? 0 }
// Live audio.currentTime, not the Zustand-stored value (which only updates on
// the native 'timeupdate' event, ~4x/sec) - used to drive smooth per-frame
// synced-lyrics highlighting instead of choppy ~250ms jumps.
export function getAudioCurrentTime(): number { return _getAudioCurrentTime?.() ?? 0 }

// Cache of the API-derived lyrics for tracker songs, keyed by numeric song
// id. The metadata-load effect runs on every track change; without this,
// replaying or revisiting a song re-hits `/songs/{id}/` every single time.
// Entries expire after LYRICS_CACHE_TTL_MS so lyrics edited on the backend
// (outside this app, where invalidateLyricsCache never fires) still show up
// within a bounded time instead of staying stale for the rest of the session.
const LYRICS_CACHE_TTL_MS = 2 * 60 * 1000
const lyricsCache = new Map<number, { lyrics: string | null; syncedLyrics: string | null; ts: number }>()
export function invalidateLyricsCache(songId: number): void { lyricsCache.delete(songId) }
// Module-level, not a ref: dedupes the /songs/{id}/ fetch below across a
// synchronous double-invoke of its effect (React StrictMode's dev-only
// mount→cleanup→mount), where both invocations' closures still see the same
// pre-update `currentTrackFull` state.
let lyricsFetchInFlight: number | null = null

export default function Player(): JSX.Element {
  const {
    currentTrack,
    currentTrackFull,
    isPlaying,
    volume,
    progress,
    currentTime,
    shuffle,
    repeat,
    setIsPlaying,
    setVolume,
    setProgress,
    setCurrentTime,
    setCurrentTrackFull,
    toggleShuffle,
    toggleRepeat,
    nextTrack,
    prevTrack,
    setShowNowPlaying,
    showNowPlaying,
    showQueue,
    setShowQueue,
    playerCollapsed,
    setPlayerCollapsed,
    queue,
    queueIndex,
    crossfadeEnabled,
    crossfadeDuration,
    sleepTimerEnd,
    setSleepTimer,
    audioOutput,
    setAudioOutput,
    playbackSpeed,
    setPlaybackSpeed,
    likedTrackIds,
    toggleLike,
    setActiveView,
    activeView,
    playNext, account, setPendingEditorSongId } = useStorePick('currentTrack', 'currentTrackFull', 'isPlaying', 'volume', 'progress', 'currentTime', 'shuffle', 'repeat', 'setIsPlaying', 'setVolume', 'setProgress', 'setCurrentTime', 'setCurrentTrackFull', 'toggleShuffle', 'toggleRepeat', 'nextTrack', 'prevTrack', 'setShowNowPlaying', 'showNowPlaying', 'showQueue', 'setShowQueue', 'playerCollapsed', 'setPlayerCollapsed', 'queue', 'queueIndex', 'crossfadeEnabled', 'crossfadeDuration', 'sleepTimerEnd', 'setSleepTimer', 'audioOutput', 'setAudioOutput', 'playbackSpeed', 'setPlaybackSpeed', 'likedTrackIds', 'toggleLike', 'setActiveView', 'activeView', 'playNext', 'account', 'setPendingEditorSongId')
  const canEditSong = useCanEdit()

  const [showContextMenu, setShowContextMenu] = useState(false)
  // Cursor position for a right-click-spawned menu. null → menu was opened via
  // the 3-dot button, so it anchors to the button rect instead.
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number } | null>(null)
  const contextMenuBtnRef = useRef<HTMLButtonElement>(null)
  const currentSongId = currentTrack ? trackIdToSongId(currentTrack.id) : null
  const { radioMode, radioNext } = useStorePick('radioMode', 'radioNext')
  const { radioFmActive, radioFmNowPlaying, radioFmMatchedSong } = useStorePick('radioFmActive', 'radioFmNowPlaying', 'radioFmMatchedSong')
  const { eqEnabled, eqGains, eqBalance, eqMono, eqBoost, skipSilence } = useStorePick('eqEnabled', 'eqGains', 'eqBalance', 'eqMono', 'eqBoost', 'skipSilence')
  const { reverbEnabled, reverbMix, reverbDecay, pitchShift } = useStorePick('reverbEnabled', 'reverbMix', 'reverbDecay', 'pitchShift')
  const { abLoopStart, abLoopEnd, setAbLoopPoint, clearAbLoop } = useStorePick('abLoopStart', 'abLoopEnd', 'setAbLoopPoint', 'clearAbLoop')

  // Applies the playback rate to an element, letting the pitch follow the
  // rate while the pitch-shift option is on.
  const applyRate = (audio: HTMLAudioElement): void => {
    const s = useStore.getState()
    audio.playbackRate = s.playbackSpeed
    audio.preservesPitch = !s.pitchShift
  }

  // Re-assert the rate once a slot has actually loaded a resource. Setting
  // playbackRate/preservesPitch right after assigning .src (or on a slot the
  // crossfade preloaded) can be dropped when the element loads the new
  // media - which is what made a slowed/pitched track silently revert to 1x
  // partway through a playlist until some setting was toggled.
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>): void => applyRate(e.currentTarget)


  // FM elapsed time - ticks locally between WS updates
  const [fmElapsedMs, setFmElapsedMs] = useState(0)
  const fmBaseRef = useRef<{ elapsed: number; at: number }>({ elapsed: 0, at: 0 })
  const fmTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fmElapsed = radioFmNowPlaying?.elapsed_ms
  // Keyed on elapsed_ms rather than the whole now-playing object: that object is
  // replaced on every metadata broadcast, which tore the interval down and
  // rebuilt it faster than its own 500ms tick, so the bar sat still.
  useEffect(() => {
    if (!radioFmActive || !fmElapsed) {
      if (fmTickRef.current) { clearInterval(fmTickRef.current); fmTickRef.current = null }
      setFmElapsedMs(0)
      return
    }
    fmBaseRef.current = { elapsed: fmElapsed, at: Date.now() }
    setFmElapsedMs(fmElapsed)
    if (!fmTickRef.current) {
      fmTickRef.current = setInterval(() => {
        const { elapsed, at } = fmBaseRef.current
        setFmElapsedMs(elapsed + (Date.now() - at))
      }, 500)
    }
  }, [radioFmActive, fmElapsed])
  useEffect(() => () => { if (fmTickRef.current) clearInterval(fmTickRef.current) }, [])
  const fmDurationMs = radioFmNowPlaying?.duration_ms ?? 0
  const fmProgress = fmDurationMs > 0 ? Math.min(fmElapsedMs / fmDurationMs, 1) : 0
  // Global infoSongId (not local state) so the info panel survives switching
  // to another tab, which unmounts this view.
  const openSongInfo = (): void => {
    setShowContextMenu(false)
    if (radioFmActive) {
      const songId = radioFmNowPlaying?.song_id ?? radioFmMatchedSong?.songId
      if (songId == null) return
      useStore.getState().setInfoSongId(songId)
      return
    }
    if (!currentTrack) return
    const match = currentTrack.id.match(/^jw-(\d+)$/)
    if (!match) return
    useStore.getState().setInfoSongId(Number(match[1]))
  }

  // Two audio slots - ping-pong between them for crossfade
  const slotA = useRef<HTMLAudioElement>(null)
  const slotB = useRef<HTMLAudioElement>(null)
  const activeSlot = useRef<'A' | 'B'>('A')

  const [prevMute, setPrevMute] = useState(0.8)

  // Seek drag buffering - only commit audio.currentTime on mouse release
  const [seekDrag, setSeekDrag] = useState<number | null>(null)

  // Crossfade state (all refs - no re-renders needed)
  const cfActive     = useRef(false)
  const cfTargetIdx  = useRef(-1)
  const cfIsRadio    = useRef(false)
  const cfOutRaf     = useRef<number | null>(null)
  const cfInRaf      = useRef<number | null>(null)
  const skipNextLoad = useRef(false)

  // Pause-fade ramp ("smooth fade when pausing" setting)
  const pauseFadeRaf = useRef<number | null>(null)
  // Timer backstop for the pause-fade's final audio.pause(). requestAnimationFrame
  // is frozen while the window is hidden/occluded, so if the user pauses and
  // immediately switches tabs/apps the RAF ramp never reaches its end and the
  // audio would keep playing. A timer still fires in the background - use it to
  // guarantee the element actually pauses.
  const pauseFadeTimer = useRef<number | null>(null)
  // The current ramp's finalize(). Held in a ref so a visibilitychange handler
  // can snap the ramp to its end state the moment the window hides - RAF is
  // frozen and the timer backstop above is throttled while hidden, so without
  // this a resume ramp gets stuck mid-fade and the song plays at reduced volume
  // (and a pause ramp keeps playing) until the throttled timer eventually fires.
  const pauseFadeFinalize = useRef<(() => void) | null>(null)

  // Keep a ref of volume so RAF callbacks (created once) always see the latest value
  const volumeRef = useRef(volume)
  useEffect(() => { volumeRef.current = volume }, [volume])

  const getActive = (): HTMLAudioElement | null =>
    activeSlot.current === 'A' ? slotA.current : slotB.current
  const getNext = (): HTMLAudioElement | null =>
    activeSlot.current === 'A' ? slotB.current : slotA.current

  const cancelPauseFade = (): void => {
    if (pauseFadeRaf.current != null) { cancelAnimationFrame(pauseFadeRaf.current); pauseFadeRaf.current = null }
    if (pauseFadeTimer.current != null) { clearTimeout(pauseFadeTimer.current); pauseFadeTimer.current = null }
    pauseFadeFinalize.current = null
  }

  const cancelCF = (): void => {
    if (cfOutRaf.current != null) { cancelAnimationFrame(cfOutRaf.current); cfOutRaf.current = null }
    if (cfInRaf.current  != null) { cancelAnimationFrame(cfInRaf.current);  cfInRaf.current  = null }
    if (cfActive.current) {
      const na = getNext()
      if (na) { na.pause(); na.src = ''; na.volume = 0 }
      cfActive.current = false
      cfTargetIdx.current = -1
      cfIsRadio.current = false
    }
    // Restore current audio to proper volume
    const a = getActive()
    if (a) a.volume = volumeRef.current
  }

  // Compute what the next queue index would be (mirrors store's nextTrack logic,
  // without advancing). Shuffle included: the store pre-shuffles the upcoming
  // list and then advances sequentially, so the next track is queueIndex + 1
  // there too - picking a random index here (as this used to) could crossfade
  // into already-played history and desync from what nextTrack() would play.
  const computeNextIdx = (): number => {
    if (queue.length === 0) return -1
    if (repeat === 'one') return queueIndex
    const next = queueIndex + 1
    if (next >= queue.length) return repeat === 'all' ? 0 : -1
    return next
  }

  // Preload next track into inactive slot - only when crossfade is on: the
  // inactive slot is never played otherwise, so preloading just streamed data
  // that got thrown away on every track change. Shuffle queues are
  // pre-shuffled, so the next track is deterministic (queueIndex + 1) there
  // too. Radio's next track lives in radioNext, not the queue - nothing to
  // preload from here.
  useEffect(() => {
    if (!crossfadeEnabled || radioMode || !isPlaying || queue.length === 0 || cfActive.current) return
    let nextIdx: number
    if (repeat === 'one') nextIdx = queueIndex
    else {
      nextIdx = queueIndex + 1
      if (nextIdx >= queue.length) {
        if (repeat === 'all') nextIdx = 0
        else return
      }
    }
    const nextTrackData = queue[nextIdx]
    if (!nextTrackData) return
    const url = resolvePlaybackUrl(nextTrackData)
    const na = getNext()
    if (!na || na.src === url) return
    na.src = url
    na.load()
    // Preloaded slots inherit the current rate too - the loadedmetadata
    // handler re-asserts it once this load settles.
    applyRate(na)
  }, [queueIndex, queue.length, isPlaying, repeat, crossfadeEnabled, radioMode])

  // Route both slots through the shared Web Audio effects chain (EQ, balance,
  // mono, silence detection). Elements keep their own volume/rate handling.
  //
  // On mobile the chain only gets built once an effect is actually switched on
  // (see setEffectsChainWanted): routing a media element through Web Audio is
  // what makes background playback fragile there, and the overwhelming
  // majority of listeners never touch the EQ - no reason to make them pay for
  // it. Desktop attaches on mount as it always has.
  const effectsInUse = eqEnabled || eqBalance !== 0 || eqMono || eqBoost !== 1 || reverbEnabled || skipSilence
  useEffect(() => {
    if (effectsInUse) setEffectsChainWanted(true)
    attachAudioElement(slotA.current)
    attachAudioElement(slotB.current)
  }, [effectsInUse])

  // Push effect settings into the chain whenever they change.
  useEffect(() => {
    applyAudioEffects({
      eqEnabled,
      gains: eqGains,
      balance: eqBalance,
      mono: eqMono,
      reverbMix: reverbEnabled ? reverbMix : 0,
      reverbDecay,
      boost: eqBoost,
    })
  }, [eqEnabled, eqGains, eqBalance, eqMono, eqBoost, reverbEnabled, reverbMix, reverbDecay])

  // Expose seek and duration to other components
  useEffect(() => {
    _seek = (t) => {
      const audio = getActive()
      if (!audio) return
      cancelCF()
      audio.volume = volumeRef.current
      audio.currentTime = t
      setCurrentTime(t)
      if (audio.duration) setProgress(t / audio.duration)
    }
    _getAudioDuration = () => getActive()?.duration ?? 0
    _getAudioCurrentTime = () => getActive()?.currentTime ?? 0
    return () => { _seek = null; _getAudioDuration = null; _getAudioCurrentTime = null }
  }, []) // stable - only depends on refs

  // Load full metadata when track changes or currentTrackFull is cleared
  useEffect(() => {
    if (!currentTrack) return
    if (currentTrackFull) return  // already populated - skip
    // Guard against stale async responses: if the track changes again before
    // a fetch resolves, that response must not overwrite the new track's
    // metadata (this is what caused a finished song's metadata to bleed
    // into the next one).
    const trackId = currentTrack.id
    const isStale = (): boolean => useStore.getState().currentTrack?.id !== trackId
    // Build synthetic FullTrack immediately so cover art + artist show
    const synthetic: FullTrack = {
      ...currentTrack,
      albumArt: currentTrack.imageUrl ?? null,
      lyrics: null,
      syncedLyrics: null,
      producer: null,
      notes: null,
      ext: '',
    }
    setCurrentTrackFull(synthetic)
    // Fetch lyrics from API if this is a tracker song (id = "jw-{n}")
    const match = currentTrack.id.match(/^jw-(\d+)$/)
    if (match) {
      const songId = Number(match[1])
      // Serve from session cache to avoid re-hitting /songs/ when replaying
      // or revisiting a song.
      const cached = lyricsCache.get(songId)
      if (cached && Date.now() - cached.ts < LYRICS_CACHE_TTL_MS) {
        setCurrentTrackFull({ ...synthetic, lyrics: cached.lyrics, syncedLyrics: cached.syncedLyrics })
      } else if (lyricsFetchInFlight !== songId) {
        // Flagged pending so WRLD's layout doesn't read the still-null
        // lyrics as "this song has none" and snap to the centered,
        // no-lyrics arrangement before the fetch below has a chance to say
        // otherwise.
        setCurrentTrackFull({ ...synthetic, lyricsPending: true })
        lyricsFetchInFlight = songId
        getSongById(songId)
          .then((song) => {
            const syncedLyrics = song.synced_lyrics || null
            const lyrics = song.lyrics || null
            lyricsCache.set(songId, { lyrics, syncedLyrics, ts: Date.now() })
            if (isStale()) return
            setCurrentTrackFull({ ...synthetic, lyrics, syncedLyrics })
          })
          .catch(() => { if (!isStale()) setCurrentTrackFull(synthetic) /* no network - treat as no lyrics */ })
      }
    }
  }, [currentTrack?.id, currentTrackFull])

  // Load audio into active slot when track changes
  useEffect(() => {
    const audio = getActive()
    if (!audio || !currentTrack) return

    if (skipNextLoad.current) {
      // Crossfade just swapped - audio already playing on active slot
      skipNextLoad.current = false
      audio.volume = volumeRef.current
      // This slot was loaded by the crossfade preload, which never ran the
      // rate setup below - apply it now or the faded-in track plays at 1x.
      applyRate(audio)
      return
    }

    const fileUrl = resolvePlaybackUrl(currentTrack)
    // Reassigning `.src` restarts the fetch even when the URL is unchanged -
    // guard against a redundant re-run of this effect (e.g. React StrictMode's
    // deliberate double-invoke in dev) firing a second network request for
    // the same track.
    if (audio.src === fileUrl) return

    cancelCF()
    cancelPauseFade()
    audio.src = fileUrl
    audio.volume = volumeRef.current
    applyRate(audio)
    if (isPlaying) audio.play().catch(console.error)
  }, [currentTrack?.id])

  // Rotate suggested covers (when the setting is on and the song has no cover
  // the user set). Keyed on the track id rather than the play-credit threshold
  // so the cover is picked as the song starts and then holds for the whole
  // play - advancing mid-song would swap the art out from under the user.
  // Released songs are excluded: they already have real official artwork, so
  // "suggestions" there would just be fan-made covers overriding it.
  useEffect(() => {
    if (currentSongId == null || currentTrack?.genre === 'released') return
    useStore.getState()._maybeRotateCover(currentSongId)
  }, [currentSongId, currentTrack?.genre])

  // Play / pause
  useEffect(() => {
    const audio = getActive()
    if (!audio) return
    cancelPauseFade()
    // Only ramp when the window is actually visible. A play/pause fired while
    // hidden (mini player, tray, another tab in front) can't animate - RAF is
    // frozen - so skip the fade and apply the end state instantly instead of
    // starting a ramp that would sit stuck at the wrong volume until a
    // throttled timer catches up.
    // iOS Safari also ignores HTMLMediaElement.volume entirely (it's pinned to
    // the hardware volume buttons), so a ramp there would just no-op every
    // frame and pause would still snap silent/loud instantly - skip it rather
    // than run a fade that can never be heard.
    const smoothFade = useStore.getState().pauseFadeEnabled && !cfActive.current
      && document.visibilityState === 'visible' && !IS_IOS
    // Autoplay policy can leave the effects AudioContext suspended until a
    // gesture - kick it on every play so audio never routes into a dead graph.
    if (isPlaying) resumeEffectsContext()
    if (isPlaying) {
      if (smoothFade) {
        // Ramp back up - from 0 on a normal resume, or from wherever a
        // still-running fade-out left the volume when it got cancelled above.
        const from = audio.paused ? 0 : audio.volume
        audio.volume = from
        audio.play().catch(console.error)
        const startTime = performance.now()
        // Land the ramp at full volume - from the RAF ramp completing, or from
        // the timer backstop below. RAF is frozen while this window is hidden/
        // occluded, so a resume triggered remotely (mini player or tray with
        // the main window minimized) would otherwise start playback with the
        // volume stuck at the 0 set above - the song "plays" silently.
        const finalize = (): void => {
          cancelPauseFade()
          audio.volume = volumeRef.current
        }
        const tick = (): void => {
          const t = Math.min((performance.now() - startTime) / PAUSE_FADE_MS, 1)
          // volumeRef read per-frame so slider moves mid-ramp still land
          audio.volume = from + (volumeRef.current - from) * t
          if (t < 1) pauseFadeRaf.current = requestAnimationFrame(tick)
          else finalize()
        }
        pauseFadeFinalize.current = finalize
        pauseFadeRaf.current = requestAnimationFrame(tick)
        pauseFadeTimer.current = window.setTimeout(finalize, PAUSE_FADE_MS + 50)
      } else {
        // Instant resume (fade off, or fired while hidden). Restore volume in
        // case a previous ramp was snapped/cancelled mid-fade at a low value.
        audio.volume = volumeRef.current
        audio.play().catch(console.error)
      }
    } else {
      // Pause must stop BOTH slots. Mid-crossfade the incoming slot is also
      // playing, and a boundary race (the outgoing's `ended` firing around the
      // same tick) can clear cfActive before this effect runs - so relying on
      // cancelCF() alone to stop the incoming element isn't race-proof.
      // Pausing both elements unconditionally guarantees nothing keeps playing.
      if (cfActive.current) cancelCF()
      if (smoothFade && !audio.paused && !audio.ended) {
        // Fade only the active slot; the inactive one is silenced immediately
        // (it should never be audible outside a crossfade anyway).
        getNext()?.pause()
        const startVol = audio.volume
        const startTime = performance.now()
        // Finalize the pause. Runs from whichever fires first - the RAF ramp
        // completing, or the timer backstop below (which still fires when the
        // window is hidden and RAF is frozen). cancelPauseFade() makes it
        // idempotent by clearing the other pending handle.
        const finalize = (): void => {
          cancelPauseFade()
          audio.pause()
          // Restore element volume while silent so any code path that plays
          // this slot without going through the resume ramp isn't stuck at 0.
          audio.volume = volumeRef.current
        }
        const tick = (): void => {
          const t = Math.min((performance.now() - startTime) / PAUSE_FADE_MS, 1)
          audio.volume = startVol * (1 - t)
          if (t < 1) pauseFadeRaf.current = requestAnimationFrame(tick)
          else finalize()
        }
        pauseFadeFinalize.current = finalize
        pauseFadeRaf.current = requestAnimationFrame(tick)
        // Backstop so the pause still lands if RAF is frozen (tab hidden / app
        // backgrounded) before the ramp finishes. Small margin past the ramp so
        // it normally loses the race to RAF and only wins when RAF is stalled.
        pauseFadeTimer.current = window.setTimeout(finalize, PAUSE_FADE_MS + 50)
      } else {
        slotA.current?.pause()
        slotB.current?.pause()
      }
    }
  }, [isPlaying])

  // ── Stream recovery ────────────────────────────────────────────────────────
  // Mobile networks drop connections mid-song constantly - a wifi/cellular
  // handoff, a dead spot on a train, the radio powering down behind a lock
  // screen. When that happens the element either fires 'error' or simply stops
  // advancing, and neither state fixes itself: play() on an errored element
  // rejects, so playback stayed dead for the rest of the session while the UI
  // cheerfully showed a playing state. That is what "it randomly stops" is.
  //
  // Reload the same URL and resume from where it died instead, on a bounded
  // backoff. Everything here is event- or wall-clock-driven rather than
  // tick-counted, because a hidden mobile tab has its timers throttled to a
  // fraction of their nominal rate.
  const recoveryAttempts   = useRef(0)
  const recoveryTimer      = useRef<number | null>(null)
  const lastRecoveryAt     = useRef(0)
  // Last observed playhead position and when it was observed - the pair that
  // distinguishes "buffering" from "the stream is gone".
  const lastProgressTime   = useRef(0)
  const lastProgressAt     = useRef(Date.now())
  // Pauses the app didn't ask for (audio focus lost to a call or another app).
  const unexpectedPauses   = useRef(0)
  // Tracks skipped in a row for being unplayable.
  const consecutiveSkips   = useRef(0)

  const clearRecoveryTimer = (): void => {
    if (recoveryTimer.current != null) { clearTimeout(recoveryTimer.current); recoveryTimer.current = null }
  }

  useEffect(() => {
    recoveryAttempts.current = 0
    unexpectedPauses.current = 0
    lastProgressTime.current = 0
    lastProgressAt.current = Date.now()
    clearRecoveryTimer()
  }, [currentTrack?.id])
  useEffect(() => clearRecoveryTimer, [])

  // Reloads the active slot and picks up where it stopped. Reads everything
  // from the store/refs so a stale closure (the watchdog interval holds one)
  // can still call it safely.
  const recoverPlayback = (reason: string): void => {
    const audio = getActive()
    const track = useStore.getState().currentTrack
    if (!audio || !track || !useStore.getState().isPlaying) return
    // A crossfade deliberately drives one slot to silence - never reload
    // through one. (A pending seek is filtered by the caller, not here: a
    // stream that dies mid-seek leaves `seeking` stuck true, and that case
    // still has to be recoverable.)
    if (cfActive.current) return
    if (recoveryTimer.current != null) return  // a retry is already queued

    const url = resolvePlaybackUrl(track)
    // Nothing to retry into while the device is offline - don't burn attempts;
    // the 'online' listener in the watchdog retries the moment it's back.
    // Downloaded and local files are unaffected by connectivity.
    if (url.startsWith('http') && navigator.onLine === false) return

    if (recoveryAttempts.current >= MAX_RECOVERY_ATTEMPTS) {
      // Out of retries. Stop pretending - a paused player the user can tap is
      // far better than a play button that lies.
      console.error(`Playback recovery gave up on "${track.title}" after ${MAX_RECOVERY_ATTEMPTS} attempts (${reason})`)
      setIsPlaying(false)
      return
    }

    const attempt = recoveryAttempts.current++
    lastRecoveryAt.current = Date.now()
    const resumeAt = audio.currentTime > 0 ? audio.currentTime : lastProgressTime.current
    console.warn(`Playback ${reason} - reloading "${track.title}" at ${resumeAt.toFixed(1)}s (attempt ${attempt + 1}/${MAX_RECOVERY_ATTEMPTS})`)

    recoveryTimer.current = window.setTimeout(() => {
      recoveryTimer.current = null
      const a = getActive()
      const s = useStore.getState()
      // The user may have paused, skipped, or seeked away while we waited.
      if (!a || !s.isPlaying || s.currentTrack?.id !== track.id) return
      const onReady = (): void => {
        a.removeEventListener('loadedmetadata', onReady)
        // Streamed audio reports Infinity duration until the server has sent
        // enough to know the length; seeking then silently no-ops, and the
        // stall detector picks that up as another round.
        if (resumeAt > 0 && isFinite(a.duration) && resumeAt < a.duration) {
          try { a.currentTime = resumeAt } catch { /* not seekable yet */ }
        }
        applyRate(a)
        a.volume = volumeRef.current
        a.play().catch(() => {})
      }
      a.addEventListener('loadedmetadata', onReady)
      a.src = url
      a.load()
      // Fresh stall budget so the reload itself isn't immediately judged.
      lastProgressAt.current = Date.now()
    }, Math.min(1000 * 2 ** attempt, 8000))
  }

  // A source the browser can't play at all - a 404, a codec it doesn't
  // support - will never come back on retry, and stopping dead in the middle
  // of a queue is the same complaint from the user's side. Move past it.
  const skipUnplayableTrack = (): void => {
    if (consecutiveSkips.current >= MAX_CONSECUTIVE_SKIPS) {
      console.error('Too many unplayable tracks in a row - stopping playback')
      setIsPlaying(false)
      return
    }
    consecutiveSkips.current++
    if (!nextTrack()) setIsPlaying(false)
  }

  const handleAudioError = (audio: HTMLAudioElement, slot: string): void => {
    // The inactive slot gets its src blanked by cancelCF(), which fires an
    // error of its own, and a preload dying is harmless either way.
    if (audio !== getActive()) return
    const err = audio.error
    if (!err || err.code === MediaError.MEDIA_ERR_ABORTED) return
    console.error(`Audio error (${slot}): code ${err.code}`, err.message)
    if (!useStore.getState().isPlaying) return
    // Unsupported before a single frame played = the file itself is the
    // problem. Mid-song it means the connection died, which is recoverable.
    if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && lastProgressTime.current === 0) {
      skipUnplayableTrack()
      return
    }
    recoverPlayback('error')
  }

  // Something outside the app paused us: audio focus went to a phone call or
  // another player, or the browser dropped the media session. One nudge back
  // is worth trying (hidden tabs do get spuriously paused, which is what the
  // watchdog below was built for), but if it happens again straight away the
  // OS means it - stop fighting and let the UI say so.
  const handleAudioPause = (audio: HTMLAudioElement): void => {
    if (audio !== getActive()) return
    if (!useStore.getState().isPlaying) return   // our own pause; already in sync
    if (audio.ended || audio.error) return       // handled by ended/error paths
    if (cfActive.current || pauseFadeRaf.current != null) return
    // Assigning .src fires a pause of its own (the media load algorithm pauses
    // the element before tearing down the old resource), and it resets
    // readyState to HAVE_NOTHING. Without this, every track change - and every
    // recovery reload - would read as the OS taking playback away, so a quick
    // triple-tap on skip was enough to stop the player outright.
    if (audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    unexpectedPauses.current++
    if (unexpectedPauses.current > 2) {
      console.warn('Playback paused externally - yielding')
      setIsPlaying(false)
      return
    }
    audio.play().catch(() => {})
  }

  // Mobile background watchdog - browsers can silently pause an audio
  // element (or never finish a play() call) while the tab is hidden, with
  // no event firing to tell the app. Periodically nudge it back, and
  // recheck immediately when the tab regains focus.
  //
  // A locked screen can also suspend JS badly enough that the native
  // 'ended' event dispatch for a track that finished never actually reaches
  // our handler - audio.paused and audio.ended both end up true with
  // playback just stuck there forever ("next song doesn't play"). Calling
  // .play() on an already-ended element only replays it from 0, so that
  // case needs to go through the real advance-to-next-track logic instead.
  useEffect(() => {
    // The "last advanced" stamp goes stale while paused - a five-minute pause
    // would otherwise read as a five-minute stall the instant playback resumes.
    lastProgressAt.current = Date.now()

    const check = (): void => {
      if (!isPlaying) return
      // A reload is already queued - let it land before judging anything.
      if (recoveryTimer.current != null) return
      // The audio graph can be suspended by the OS (screen off / Android doze)
      // while the element still reports as playing - that silences output since
      // audio routes through the graph, and the checks below wouldn't catch it.
      // Nudge it back on every tick (complements the graph's own statechange
      // auto-resume, which timer throttling in the background can starve).
      resumeEffectsContext()
      const audio = getActive()
      if (!audio) return
      if (audio.ended) { onAudioEnded(audio); return }
      if (audio.error) { recoverPlayback('error'); return }
      if (audio.paused) { audio.play().catch(() => recoverPlayback('play-rejected')); return }
      // Playing on paper, but the clock isn't moving. Very common on mobile:
      // the connection goes away without the element ever firing 'error', so it
      // sits in a rebuffer that will never finish. Nothing else detects this.
      if (!audio.seeking && !cfActive.current
        && Date.now() - lastProgressAt.current > STALL_TIMEOUT_MS) {
        recoverPlayback('stalled')
      }
    }
    const id = setInterval(check, 8000)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') { check(); return }
      // Going hidden mid-ramp: RAF is about to freeze and the timer backstop is
      // throttled, so snap the fade to its end state now (full volume on a
      // resume, paused on a pause) rather than leaving it stuck partway.
      pauseFadeFinalize.current?.()
    }
    // Connectivity came back - retry immediately with a clean slate instead of
    // waiting out a backoff that was scheduled against a dead network.
    const onOnline = (): void => {
      recoveryAttempts.current = 0
      lastProgressAt.current = Date.now()
      check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('focus', check)
    }
  }, [isPlaying])

  // Volume - only change if not mid-crossfade or mid-pause-fade (the resume
  // ramp reads volumeRef per-frame, so slider moves still apply through it)
  useEffect(() => {
    const audio = getActive()
    if (!audio) return
    if (!cfActive.current && pauseFadeRaf.current == null) audio.volume = volume
  }, [volume])

  // Playback rate - apply to both audio slots (speed and the pitch-shift
  // option both funnel through applyRate)
  useEffect(() => {
    for (const ref of [slotA, slotB]) {
      if (ref.current) applyRate(ref.current)
    }
  }, [playbackSpeed, pitchShift])

  // ── Skip silence ───────────────────────────────────────────────────────────
  // Polls the effects chain's analyser; once silence is confirmed, playback
  // leaps forward in JUMP_S-second hops until sound is found, then steps back
  // one hop and plays the remainder normally - long gaps vanish near-instantly
  // (a 30s gap costs ~2s of hops + at most one hop of real-time run-in) and
  // the sound's onset is never clipped by an overshooting hop.
  const silentTicks = useRef(0)
  // Position before the first hop of the current silence run; null = not
  // hopping. Doubles as the back-stop so a step-back can't rewind past the
  // silence we already confirmed.
  const silenceJumpStart = useRef<number | null>(null)
  // Wall-clock timestamp until which detection sleeps after a step-back, so
  // the deliberately replayed (≤ one hop) tail of silence can't re-trigger.
  const skipCooldownUntil = useRef(0)
  useEffect(() => {
    silentTicks.current = 0
    silenceJumpStart.current = null
    skipCooldownUntil.current = 0
  }, [currentTrack?.id])

  // A-B loop points are positions within one track - meaningless (and
  // possibly out of range) once the track changes, so clear them whenever it
  // does. Deliberately not keyed on abLoopStart/End too, or this would fight
  // the very set/clear it's meant to react to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { clearAbLoop() }, [currentTrack?.id])
  useEffect(() => {
    if (!skipSilence) return
    const JUMP_S = 1.5
    const reset = (): void => { silentTicks.current = 0; silenceJumpStart.current = null }
    const id = setInterval(() => {
      const audio = getActive()
      // Only ever touch normal, active playback - never mid-crossfade (the
      // fade-out deliberately approaches silence) and never while paused.
      if (!audio || audio.paused || !useStore.getState().isPlaying || cfActive.current) { reset(); return }
      // Wait out an in-flight seek or rebuffer: a stalled element outputs
      // silence, which would otherwise read as more silence to hop over.
      if (audio.seeking || audio.readyState < 2) return
      if (performance.now() < skipCooldownUntil.current) return
      // The analyser reads the element-volume-scaled mix, so silence under
      // mute is indistinguishable from real silence - bail instead of
      // fast-forwarding a muted song into oblivion.
      const vol = volumeRef.current
      if (vol <= 0.01) { reset(); return }
      // Leave the track's run-out alone: the ended/crossfade boundary logic
      // must play out normally, and no hop may land inside that window.
      const s = useStore.getState()
      const endGuard = Math.max(2, s.crossfadeEnabled ? s.crossfadeDuration + 0.5 : 0)
      const dur = isFinite(audio.duration) ? audio.duration : 0
      if (dur > 0 && dur - audio.currentTime < endGuard) { reset(); return }
      // Scale the threshold by volume to undo the element-volume scaling.
      if (getCurrentPeak() < 0.005 * vol) {
        // ~300ms of confirmed silence before engaging, so inter-word gaps
        // and drum rests don't trigger it.
        silentTicks.current++
        if (silentTicks.current >= 3) {
          if (silenceJumpStart.current == null) silenceJumpStart.current = audio.currentTime
          const cap = dur > 0 ? dur - endGuard : audio.currentTime + JUMP_S
          audio.currentTime = Math.min(audio.currentTime + JUMP_S, cap)
        }
      } else {
        if (silenceJumpStart.current != null) {
          // Sound found mid-hop - the onset lies somewhere inside the hop we
          // just crossed. Step back one hop (never before the run's start,
          // which also no-ops after a user seek reshuffled positions) so the
          // onset plays from the top.
          const back = audio.currentTime - JUMP_S
          if (back > silenceJumpStart.current) {
            audio.currentTime = back
            const rate = Math.max(0.25, s.playbackSpeed)
            skipCooldownUntil.current = performance.now() + (JUMP_S / rate) * 1000 + 500
          }
        }
        reset()
      }
    }, 100)
    return () => { clearInterval(id); reset() }
  }, [skipSilence])

  // mediaOverlayEnabled only makes sense on desktop (Electron) - it exists to
  // stop Windows from popping up its System Media Transport Controls overlay
  // on media-key presses. The web build relies on Media Session staying alive
  // to keep the background/lock-screen session from being torn down, so it
  // always stays active here (the toggle is a no-op and hidden in Settings).
  const mediaSessionActive = true

  // Media Session API - lock screen / notification metadata
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!mediaSessionActive) { navigator.mediaSession.metadata = null; return }
    const title  = radioFmActive ? (radioFmNowPlaying?.title  ?? '') : (currentTrack?.title  ?? '')
    const artist = radioFmActive ? (radioFmNowPlaying?.artist ?? '') : (currentTrack?.artist ?? '')
    const rawArt = radioFmActive
      ? radioFmMatchedSong?.imageUrl
      : (currentTrackFull?.albumArt ?? currentTrack?.imageUrl)
    // Only pass HTTP URLs to MediaMetadata - data URIs crash Windows media transport
    const artSrc = rawArt?.startsWith('http') ? rawArt : undefined
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: '',
      artwork: artSrc ? [{ src: artSrc }] : [],
    })
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.imageUrl,
    currentTrackFull?.albumArt,
    radioFmActive,
    radioFmNowPlaying?.title,
    radioFmNowPlaying?.artist,
    radioFmMatchedSong?.imageUrl,
    mediaSessionActive,
  ])

  // Media Session playback state - mobile browsers (Android Chrome in
  // particular) use this to decide whether the background media session is
  // still "active" and worth keeping alive. Never setting it meant the OS
  // could treat a locked-screen session as stale and tear it down mid-track,
  // which silently stopped playback with no 'ended' event ever firing - so
  // the queue never advanced to the next song.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!mediaSessionActive) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying, mediaSessionActive])

  // Media Session action handlers - play/pause/skip
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!mediaSessionActive) return
    navigator.mediaSession.setActionHandler('play',  () => setIsPlaying(true))
    navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false))
    navigator.mediaSession.setActionHandler('nexttrack',     () => nextTrack())
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack())
    return () => {
      navigator.mediaSession.setActionHandler('play',          null)
      navigator.mediaSession.setActionHandler('pause',         null)
      navigator.mediaSession.setActionHandler('nexttrack',     null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
    }
  }, [setIsPlaying, nextTrack, prevTrack, mediaSessionActive])

  // Media Session position state - for lock screen seek bar
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!mediaSessionActive) return
    const audio = getActive()
    if (!audio || !audio.duration || isNaN(audio.duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration:     audio.duration,
        playbackRate: playbackSpeed,
        position:     Math.min(currentTime, audio.duration),
      })
    } catch {/* ignore */}
  }, [currentTime, playbackSpeed, mediaSessionActive])

  // Audio output device
  useEffect(() => {
    // Attached elements emit through the effects AudioContext, so the device
    // choice must land there too (element sinkIds no longer carry the sound).
    setEffectsOutputDevice(audioOutput)
    const apply = async (): Promise<void> => {
      for (const audio of [slotA.current, slotB.current]) {
        if (!audio) continue
        try {
          // setSinkId is a Web Audio API - available in Electron's Chromium
          await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(audioOutput || '')
        } catch (e) {
          console.warn('setSinkId failed:', e)
        }
      }
    }
    apply()
  }, [audioOutput])

  // Credits a play once the track has actually been listened to, rather than
  // the moment it starts - skipping through a queue or letting a crossfade
  // preload the next song shouldn't count. Whichever comes first: a fixed
  // number of seconds in, or halfway through anything shorter than that.
  const creditedTrackId = useRef<string | null>(null)
  const creditPlayIfListened = (position: number, dur: number): void => {
    const track = useStore.getState().currentTrack
    if (!track || dur <= 0) return
    // Back at the start of a track that already counted - repeat-one came
    // around, or the user seeked back - so let it count again as a new play.
    if (creditedTrackId.current === track.id && position < 1) creditedTrackId.current = null
    if (creditedTrackId.current === track.id) return
    if (position < Math.min(PLAYCOUNT_THRESHOLD_SECONDS, dur / 2)) return
    const songId = trackIdToSongId(track.id)
    // Local files and raw file-browser entries have no song id to count against.
    if (songId == null) return
    creditedTrackId.current = track.id
    useStore.getState().bumpSongPlaycount(songId)
    // Same moment, but kept separate: bumpSongPlaycount only receives the id,
    // and Home needs the whole Track to render (and replay) a row offline.
    rememberRecentTrack(track)
  }

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>): void => {
    const audio = e.currentTarget
    if (audio !== getActive()) return  // ignore pre-loading slot's events

    // Liveness signal for the stall detector. Compared for *any* change, not
    // just forward motion, so a seek backwards doesn't look like a frozen
    // clock. Sustained healthy playback also clears the recovery counters -
    // after a settle window, so a stream that plays half a second and dies on
    // every reload still runs out of attempts instead of retrying forever.
    if (audio.currentTime !== lastProgressTime.current) {
      lastProgressTime.current = audio.currentTime
      lastProgressAt.current = Date.now()
      if (Date.now() - lastRecoveryAt.current > RECOVERY_SETTLE_MS) {
        recoveryAttempts.current = 0
        unexpectedPauses.current = 0
        consecutiveSkips.current = 0
      }
    }

    setCurrentTime(audio.currentTime)
    // audio.duration reads as Infinity for streamed audio until the server's
    // sent enough to know the real length (no Content-Length / chunked
    // response) - dividing by that kept progress pinned at 0 the whole song,
    // so fall back to the track's own known duration when audio.duration
    // isn't a finite number yet.
    const dur = isFinite(audio.duration) ? audio.duration : (currentTrack?.duration || 0)
    if (dur > 0) setProgress(audio.currentTime / dur)

    creditPlayIfListened(audio.currentTime, dur)

    // Sleep timer
    if (sleepTimerEnd && Date.now() >= sleepTimerEnd) {
      audio.pause()
      setIsPlaying(false)
      setSleepTimer(null)
      return
    }

    // A-B loop: keep playback pinned inside the marked region. Checked before
    // (and - via the guard below - instead of) the crossfade logic, so a
    // looped section can never bleed into the next track.
    const abLooping = abLoopStart != null && abLoopEnd != null
    if (abLooping && audio.currentTime >= abLoopEnd!) {
      audio.currentTime = abLoopStart!
      setCurrentTime(abLoopStart!)
      if (dur > 0) setProgress(abLoopStart! / dur)
      return
    }

    // Start crossfade when approaching end. A queued timeupdate event can
    // still fire right after the user pauses (it was already in flight),
    // so without this guard a crossfade - and the next song's playback -
    // could kick off even though playback was just paused.
    if (!abLooping && crossfadeEnabled && crossfadeDuration > 0 && !cfActive.current && useStore.getState().isPlaying && dur > 0) {
      const remaining = dur - audio.currentTime

      if (remaining > 0 && remaining <= crossfadeDuration) {
        // In radio mode use radioNext; otherwise compute from queue. Compute
        // the index ONCE and reuse it for both the track data (what actually
        // gets loaded into the next audio slot) and nextIdx (what queueIndex
        // becomes once the crossfade completes). With shuffle on, calling
        // computeNextIdx() twice re-rolls a new random pick each time, so the
        // audio that plays and the metadata/queue position that gets set
        // could end up referring to two different tracks.
        const isRadio = useStore.getState().radioMode
        const nextIdx = isRadio ? -1 : computeNextIdx()
        const nextTrackData = isRadio
          ? useStore.getState().radioNext
          : (nextIdx >= 0 && nextIdx < queue.length) ? queue[nextIdx] : null
        const na = getNext()

        if (na && nextTrackData) {
          cfActive.current = true
          cfIsRadio.current = isRadio
          cfTargetIdx.current = nextIdx

          const url = resolvePlaybackUrl(nextTrackData)
          // Only reassign src if not already preloaded
          if (na.src !== url) na.src = url
          na.volume = 0
          applyRate(na)
          na.play().catch(console.error)

          // Fade OUT active audio
          const startVol  = audio.volume
          const startTime = performance.now()
          const fadeDur   = remaining * 1000

          const tickOut = (): void => {
            const a = getActive()
            if (!a) return
            const t = Math.min((performance.now() - startTime) / fadeDur, 1)
            a.volume = startVol * (1 - t)
            if (t < 1) cfOutRaf.current = requestAnimationFrame(tickOut)
            else { a.volume = 0; cfOutRaf.current = null }
          }
          cfOutRaf.current = requestAnimationFrame(tickOut)

          // Fade IN next audio
          const targetVol = volumeRef.current
          const tickIn = (): void => {
            const n = getNext()
            if (!n) return
            const t = Math.min((performance.now() - startTime) / fadeDur, 1)
            n.volume = targetVol * t
            if (t < 1) cfInRaf.current = requestAnimationFrame(tickIn)
            else { n.volume = targetVol; cfInRaf.current = null }
          }
          cfInRaf.current = requestAnimationFrame(tickIn)
        }
      }
    }
  }

  const handleEnded = (e: React.SyntheticEvent<HTMLAudioElement>): void => onAudioEnded(e.currentTarget)

  // Split out from the React event handler so the background watchdog below
  // can invoke the exact same advance-to-next-track logic directly on the
  // audio element, for when the real 'ended' event never reaches JS at all.
  const onAudioEnded = (audio: HTMLAudioElement): void => {
    // Read playback state fresh from the store: the background watchdog calls
    // this from an effect keyed only on isPlaying, so the closure's
    // repeat/queue/currentTrack can be stale (e.g. repeat toggled mid-song)
    // by the time a missed locked-screen 'ended' is handled here.
    const { repeat, queue, queueIndex, currentTrack } = useStore.getState()
    if (audio !== getActive()) {
      // Pre-loading slot ended (very short next track, or error)
      if (cfActive.current) cancelCF()
      return
    }

    if (cfActive.current) {
      // Crossfade complete - next audio is already playing at full volume
      if (cfOutRaf.current != null) { cancelAnimationFrame(cfOutRaf.current); cfOutRaf.current = null }
      if (cfInRaf.current  != null) { cancelAnimationFrame(cfInRaf.current);  cfInRaf.current  = null }
      cfActive.current = false

      const targetIdx = cfTargetIdx.current
      const wasRadio  = cfIsRadio.current
      cfTargetIdx.current = -1
      cfIsRadio.current   = false

      // Ensure incoming track is at full volume
      const na = getNext()
      if (na) na.volume = volumeRef.current

      // Swap which slot is "active"
      activeSlot.current = activeSlot.current === 'A' ? 'B' : 'A'

      // Tell the load useEffect to skip (audio already playing)
      skipNextLoad.current = true

      // Preserve a pause that raced in right at the crossfade boundary -
      // don't let the queue-advance forcibly resume playback. Since the
      // active slot just swapped, the [isPlaying] effect won't re-fire if
      // the value doesn't change (false -> false), so pause explicitly here.
      const wasPlaying = useStore.getState().isPlaying
      if (!wasPlaying) na?.pause()

      if (wasRadio) {
        // Radio: delegate to nextTrack() which handles queue history + prefetch
        nextTrack()
        if (!wasPlaying) useStore.setState({ isPlaying: false })
      } else if (targetIdx >= 0 && targetIdx < queue.length) {
        // Normal queue: advance store to the crossfaded-into track
        const track = queue[targetIdx]
        const isSameTrack = targetIdx === queueIndex
        useStore.setState({
          queueIndex: targetIdx,
          currentTrack: track,
          currentTrackFull: isSameTrack ? useStore.getState().currentTrackFull : null,
          isPlaying: wasPlaying,
        })
        // This setState bypasses nextTrack(), which is what normally tops up a
        // lazily-loaded queue and applies the preferred-version swap - without
        // these, crossfaded advances never fetch the next page and playback
        // stops dead at the end of the initially loaded songs.
        useStore.getState()._loadMore()
        useStore.getState()._maybeSwapToPreferredVersion(track)
      }
      return
    }

    // Normal (no crossfade) track end.
    // Guard against a paused crossfade boundary race: if the user pauses mid-
    // crossfade, the [isPlaying] effect runs cancelCF() which clears cfActive
    // BEFORE the outgoing element's already-queued `ended` event is handled.
    // That `ended` then lands here instead of the crossfade branch above - and
    // a paused player must never auto-advance into playback.
    if (!useStore.getState().isPlaying) return

    if (repeat === 'one') {
      const a = getActive()
      if (a) { a.currentTime = 0; a.volume = volumeRef.current; a.play().catch(console.error) }
      return
    }
    const prevId = currentTrack?.id
    const next = nextTrack()
    if (!next) {
      setIsPlaying(false)
      return
    }
    if (next.id === prevId) {
      // Same track (single song in queue with repeat-all, or only one option)
      const a = getActive()
      if (a) { a.currentTime = 0; a.volume = volumeRef.current; a.play().catch(console.error) }
    }
  }

  const handlePrev = (): void => {
    const audio = getActive()
    // In radio mode the user can't go back - always restart current song
    if (radioMode) {
      cancelCF()
      if (audio) { audio.currentTime = 0; audio.volume = volumeRef.current }
      setCurrentTime(0)
      setProgress(0)
      return
    }
    // When on repeat-one, skip back = restart the same song (mirrors handleNext)
    if (repeat === 'one') {
      cancelCF()
      if (audio) {
        audio.currentTime = 0
        audio.volume = volumeRef.current
        if (isPlaying) audio.play().catch(console.error)
      }
      setCurrentTime(0)
      setProgress(0)
      return
    }
    if (audio && audio.currentTime > 3) {
      cancelCF()
      audio.currentTime = 0
      audio.volume = volumeRef.current
      setCurrentTime(0)
      setProgress(0)
      return
    }
    cancelCF()
    prevTrack()
  }

  const handleNext = (): void => {
    cancelCF()
    // When on repeat-one, skip = restart the same song
    if (repeat === 'one') {
      const audio = getActive()
      if (audio) {
        audio.currentTime = 0
        audio.volume = volumeRef.current
        if (isPlaying) audio.play().catch(console.error)
      }
      setCurrentTime(0)
      setProgress(0)
      return
    }
    nextTrack()
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // What each hotkey action *does*. Keyed by the ids in lib/hotkeys.ts (which
  // owns the id → key-combo mapping). Recreated every render so the closures
  // see fresh state; a stable listener reads the ref. Store reads/writes go
  // through getState() so they never need the pick.
  const clampSpeed = (v: number): number => Math.min(2, Math.max(0.5, Math.round(v * 100) / 100))
  const seekToPercent = (pct: number): void => {
    if (!currentTrack || radioFmActive) return
    const dur = getAudioDuration() || currentTrack.duration || 0
    if (dur > 0) seekAudio(dur * pct)
  }
  const hotkeyActionsRef = useRef<Record<string, () => void>>({})
  hotkeyActionsRef.current = {
    'play-pause': () => { if (currentTrack && !radioFmActive) setIsPlaying(!isPlaying) },
    'play':       () => { if (currentTrack && !radioFmActive) setIsPlaying(true) },
    'pause':      () => { if (currentTrack && !radioFmActive) setIsPlaying(false) },
    'next':       () => { if (currentTrack && !radioFmActive) handleNext() },
    'previous':   () => { if (currentTrack && !radioFmActive) handlePrev() },
    'seek-forward': () => {
      if (!currentTrack || radioFmActive) return
      const step = useStore.getState().hotkeySeekSeconds
      const dur = getAudioDuration() || currentTrack.duration || 0
      const target = getAudioCurrentTime() + step
      seekAudio(dur > 0 ? Math.min(target, dur) : target)
    },
    'seek-backward': () => {
      if (!currentTrack || radioFmActive) return
      const step = useStore.getState().hotkeySeekSeconds
      seekAudio(Math.max(0, getAudioCurrentTime() - step))
    },
    'volume-up':   () => { const v = useStore.getState().volume; setVolume(Math.min(1, Math.round((v + 0.05) * 100) / 100)) },
    'volume-down': () => { const v = useStore.getState().volume; setVolume(Math.max(0, Math.round((v - 0.05) * 100) / 100)) },
    'mute':        () => toggleMute(),
    'shuffle':     () => { if (!radioFmActive) toggleShuffle() },
    'loop':        () => { if (!radioFmActive) toggleRepeat() },
    'clear-queue': () => useStore.getState().clearQueue(),
    'like':        () => { if (currentTrack && !radioFmActive) toggleLike(currentTrack.id) },
    'toggle-lyrics': () => { const s = useStore.getState(); s.setLyricsOverride(!s.lyricsOverride) },
    'song-info':   () => { if (currentTrack || radioFmActive) openSongInfo() },
    'edit-song': () => {
      if (radioFmActive) return
      if (currentSongId != null) useStore.getState().openSongEditor(currentSongId)
    },
    'speed-up':    () => setPlaybackSpeed(clampSpeed(playbackSpeed + 0.25)),
    'speed-down':  () => setPlaybackSpeed(clampSpeed(playbackSpeed - 0.25)),
    'equalizer':   () => { if (EFFECTS_SUPPORTED) useStore.getState().toggleEqPanel() },
    'ab-loop':     () => { if (currentTrack && !radioFmActive) setAbLoopPoint() },
    'crossfade':   () => { const s = useStore.getState(); s.setCrossfade(!s.crossfadeEnabled, s.crossfadeDuration) },
    'smooth-playback': () => { const s = useStore.getState(); s.setPauseFade(!s.pauseFadeEnabled) },
    'prefer-og':   () => { const s = useStore.getState(); s.setPreferOgVersion(!s.preferOgVersion) },
    'sleep-timer': () => { const s = useStore.getState(); s.setSleepTimer(s.sleepTimerEnd ? null : Date.now() + 30 * 60 * 1000) },
    'seek-0':  () => seekToPercent(0),
    'seek-10': () => seekToPercent(0.1),
    'seek-20': () => seekToPercent(0.2),
    'seek-30': () => seekToPercent(0.3),
    'seek-40': () => seekToPercent(0.4),
    'seek-50': () => seekToPercent(0.5),
    'seek-60': () => seekToPercent(0.6),
    'seek-70': () => seekToPercent(0.7),
    'seek-80': () => seekToPercent(0.8),
    'seek-90': () => seekToPercent(0.9),
    'view-tracker':   () => setActiveView('api-tracker'),
    'view-playlists': () => setActiveView('playlists'),
    'view-wrld':      () => setActiveView('wrld'),
    'view-admin':     () => {
      // Admin tools live in the editor profile page's Admin tab now.
      if (showStaffProfile(account) && (account?.is_administrator || account?.is_editor || account?.is_manager)) useStore.getState().openProfile()
    },
    'open-settings':    () => useStore.getState().setShowSettings(true),
    'open-diagnostics': () => useStore.getState().setShowDiagnostics(true),
    'toggle-queue':     () => { const s = useStore.getState(); s.setShowQueue(!s.showQueue) },
    'focus-search':     () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search" i]')
      input?.focus()
      input?.select()
    },
  }
  // Same table, exposed to UI that triggers actions by id (the app menu) - a
  // stable subscription dispatching into the ref's fresh closures.
  useEffect(() => registerHotkeyDispatch((id) => hotkeyActionsRef.current[id]?.()), [])
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const combo = eventToCombo(e)
      if (!combo) return
      // Never hijack typing (search boxes, the metadata editor, etc.) - media
      // keys are one exception (meaningless while typing), and so are bare
      // function keys (F1-F24): conventionally global in every browser/OS,
      // never part of typed text, so a focused input shouldn't swallow them.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable
      const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(combo.split('+').pop() ?? '')
      if (typing && !combo.startsWith('Media') && !isFKey) return
      // Leave Space/Enter alone when a button/link/select is focused so they
      // still activate it (native keyboard behavior) instead of toggling play.
      const clickable = tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || target?.getAttribute('role') === 'button'
      if (clickable && (combo === 'Space' || combo === 'Enter')) return
      const id = resolveAction(combo, useStore.getState().hotkeyBindings)
      if (!id) return
      const fn = hotkeyActionsRef.current[id]
      if (!fn) return
      e.preventDefault()
      fn()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Seek: buffer visually while dragging, only commit on mouse release
  const handleSeekMouseDown = (): void => {
    setSeekDrag(progress)
  }

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseFloat(e.target.value)
    setSeekDrag(val)
    // Update display time without touching audio
    const audio = getActive()
    // `audio.duration` can be Infinity (streamed audio with no known length
    // yet) - that's still truthy, so a bare `if (audio?.duration)` let it
    // through and multiplied it into the seek target below.
    const dur = audio && isFinite(audio.duration) ? audio.duration : (currentTrack?.duration || 0)
    if (dur > 0) setCurrentTime(val * dur)
  }

  // Commits on mouse-up, touch-end, AND key-up: keyboard seeking (arrow keys
  // on the focused slider) fires change events with no mouse/touch pair, so
  // without the key-up commit `seekDrag` was set by handleSeekChange and never
  // cleared - the bar froze at the phantom position while audio played on.
  const handleSeekCommit = (): void => {
    if (seekDrag === null) return
    const audio = getActive()
    const dur = audio && isFinite(audio.duration) ? audio.duration : (currentTrack?.duration || 0)
    if (audio && dur > 0) {
      cancelCF()
      const time = seekDrag * dur
      audio.currentTime = time
      audio.volume = volumeRef.current
      applyRate(audio)
      setCurrentTime(time)
      setProgress(seekDrag)
    }
    setSeekDrag(null)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (val > 0) setPrevMute(val)
  }

  const toggleMute = (): void => {
    if (isMuted) setVolume(prevMute || 0.8)
    else { setPrevMute(volume); setVolume(0) }
  }

  const isMuted = volume === 0
  const activeDuration = getActive()?.duration
  const duration = (activeDuration && isFinite(activeDuration) ? activeDuration : 0) || currentTrack?.duration || 0

  // Equalizer popover (also hosts balance/mono/skip-silence + playback speed).
  // Visibility lives in the store so the 'equalizer' hotkey and the WRLD tab's
  // button can open it too - this always-mounted component owns the portal.
  const { showEqPanel, setShowEqPanel, toggleEqPanel } = useStorePick('showEqPanel', 'setShowEqPanel', 'toggleEqPanel')
  const isMobile = useIsMobile()
  const eqBtnRef = useRef<HTMLButtonElement>(null)
  const [eqPos, setEqPos] = useState({ bottom: 0, right: 0 })
  // Anchor above the bar button when it's on screen; openers without an
  // anchor (hotkey, WRLD tab, collapsed bar) get a fixed bottom-right spot.
  useEffect(() => {
    if (!showEqPanel) return
    const btn = eqBtnRef.current
    if (btn?.isConnected) {
      const r = btn.getBoundingClientRect()
      setEqPos({ bottom: window.innerHeight - r.top + 8, right: Math.max(8, window.innerWidth - r.right - 170) })
    } else {
      setEqPos({ bottom: 104, right: 16 })
    }
  }, [showEqPanel])
  // Accent the button when anything in the panel deviates from neutral.
  const eqActive = eqEnabled || playbackSpeed !== 1 || eqBalance !== 0 || eqMono || eqBoost !== 1 || skipSilence || reverbEnabled


  // (Play/pause on Space is handled by the unified hotkey system above - the
  // 'play-pause' action defaults to Space and is rebindable in Settings.)

  // Cover art error state - reset when track changes
  const [coverArtError, setCoverArtError] = useState(false)
  useEffect(() => { setCoverArtError(false) }, [currentTrack?.id])

  // Output device picker
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [showOutputPicker, setShowOutputPicker] = useState(false)
  const outputBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState({ bottom: 0, right: 0 })

  useEffect(() => {
    // Absent in some iOS Safari contexts - accessing it directly (rather
    // than optional-chaining) threw synchronously on mount there, crashing
    // the whole player on every load ("undefined is not an object
    // (evaluating 'navigator.mediaDevices.addEventListener')").
    if (!navigator.mediaDevices) return
    const enumerate = async (): Promise<void> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
      } catch { /* ignore */ }
    }
    enumerate()
    // Mount-once: 'devicechange' already covers plug/unplug, so re-enumerating
    // (and re-registering the listener) on every play/pause was pure churn.
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
  }, [])

  const openOutputPicker = (): void => {
    if (!outputBtnRef.current) return
    const r = outputBtnRef.current.getBoundingClientRect()
    setPickerPos({ bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right })
    setShowOutputPicker((v) => !v)
  }

  return (
    <>
      {/* crossOrigin: required for the Web Audio effects chain - without CORS
          clearance createMediaElementSource outputs pure silence. The API and
          the local-media:// protocol both send Access-Control-Allow-Origin. */}
      <audio
        ref={slotA}
        preload="none"
        crossOrigin="anonymous"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPause={(e) => handleAudioPause(e.currentTarget)}
        onError={(e) => handleAudioError(e.currentTarget, 'slotA')}
      />
      <audio
        ref={slotB}
        preload="none"
        crossOrigin="anonymous"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPause={(e) => handleAudioPause(e.currentTarget)}
        onError={(e) => handleAudioError(e.currentTarget, 'slotB')}
      />

      {/* Equalizer - outside the WRLD-page conditional below so the hotkey and
          the WRLD tab's own button can open it on any view. Mobile has no
          anchor button to position a popover against (the bar this ref lives
          on is desktop-only, `hidden md:flex`), so it opens as a full bottom
          sheet there instead of the desktop anchored popover. */}
      {showEqPanel && EFFECTS_SUPPORTED && (isMobile ? (
        <Sheet onClose={() => setShowEqPanel(false)} title="Equalizer">
          <EqualizerPanel />
        </Sheet>
      ) : createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowEqPanel(false)} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-50 bg-surface-highest border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto"
            // Cap below the title bar so a full panel scrolls internally
            // instead of growing under the window controls.
            style={{ bottom: eqPos.bottom, right: eqPos.right, maxHeight: `calc(100vh - ${eqPos.bottom + 48}px)` }}
          >
            <EqualizerPanel />
          </div>
        </>,
        document.body
      ))}

      {/* Bottom bar hidden on the WRLD page - it has its own full playback controls.
          Audio elements above stay mounted regardless so playback is unaffected. */}
      {activeView !== 'wrld' && (
      <>
      {/* ── Mobile player ── */}
      {/* No safe-area-inset-bottom padding here: the BottomNav sits directly
          below this bar and already reserves the home-indicator space for the
          whole stack. Adding it here too (it reads ~0 in Safari, where the URL
          bar occupies the inset, but the real ~34px once installed as a
          standalone PWA) injected a dead gap between the player and the nav. */}
      <div className="app-player md:hidden bg-surface border-t border-[var(--border)] shrink-0" onContextMenu={(e) => { e.preventDefault(); if (currentTrack) setShowContextMenu(v => !v) }}>
        {/* Thin progress bar */}
        {radioFmActive ? (
          <div className="h-[2px] bg-red-900/40 relative">
            <div className="h-full bg-red-400 absolute left-0 top-0 transition-none" style={{ width: `${fmProgress * 100}%` }} />
          </div>
        ) : (
        // Seekable. The visible line is 2px but the hit area is padded taller
        // (py-2 -my-2) so it's grabbable on touch, and touch-none stops the
        // browser from treating a horizontal drag as a scroll. Commits on
        // release via seekToPercent(last) rather than the seekDrag state, so a
        // stale closure in the document listeners can't seek to the wrong spot.
        <div
          className="relative py-2 -my-2 cursor-pointer touch-none"
          onMouseDown={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pctAt = (x: number): number => Math.max(0, Math.min(1, (x - rect.left) / rect.width))
            let last = pctAt(e.clientX)
            setSeekDrag(last)
            const onMove = (ev: MouseEvent): void => { last = pctAt(ev.clientX); setSeekDrag(last) }
            const onUp = (): void => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
              seekToPercent(last); setSeekDrag(null)
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
          onTouchStart={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pctAt = (x: number): number => Math.max(0, Math.min(1, (x - rect.left) / rect.width))
            let last = pctAt(e.touches[0].clientX)
            setSeekDrag(last)
            const onMove = (ev: TouchEvent): void => { last = pctAt(ev.touches[0].clientX); setSeekDrag(last) }
            const onEnd = (): void => {
              document.removeEventListener('touchmove', onMove)
              document.removeEventListener('touchend', onEnd)
              seekToPercent(last); setSeekDrag(null)
            }
            document.addEventListener('touchmove', onMove, { passive: true })
            document.addEventListener('touchend', onEnd)
          }}
        >
          <div className="h-[2px] bg-surface-overlay relative">
            <div
              className="h-full bg-accent absolute left-0 top-0 transition-none"
              style={{ width: `${(seekDrag !== null ? seekDrag : progress) * 100}%` }}
            />
          </div>
        </div>
        )}
        {/* Track row - whole row opens WRLD, not just the cover; the
            transport buttons stopPropagation so tapping them doesn't also
            navigate. */}
        <div className="flex items-center px-3 py-2 gap-3 h-14" onClick={() => setActiveView('wrld')}>
          <div className="w-10 h-10 rounded bg-surface-overlay shrink-0 overflow-hidden">
            {radioFmActive ? (
              radioFmMatchedSong?.imageUrl
                ? <img src={radioFmMatchedSong.imageUrl} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-red-900/70 to-black flex items-center justify-center"><Radio size={16} className="text-red-400 opacity-80" /></div>
            ) : (!coverArtError && (currentTrackFull?.albumArt ?? currentTrack?.imageUrl)) ? (
              // Keyed per cover - the bar keeps one element across track
              // changes, so without this the previous song's art stays painted
              // until the new one decodes.
              <img key={currentTrackFull?.albumArt ?? currentTrack?.imageUrl} src={smallCoverUrl(currentTrackFull?.albumArt ?? currentTrack?.imageUrl)} alt="" className="w-full h-full object-cover" onError={() => setCoverArtError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-medium text-text-primary truncate"
              title={radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.title : (currentTrack?.title || undefined)}
            >
              {radioFmActive && radioFmNowPlaying
                ? radioFmNowPlaying.title
                : (currentTrack?.title || 'Not playing')}
            </p>
            <p className="text-xs text-text-muted truncate">
              {radioFmActive && radioFmNowPlaying
                ? radioFmNowPlaying.artist
                : (currentTrack?.artist || '')}
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {!radioFmActive && (
              <button onClick={toggleShuffle} className={`p-1.5 transition-colors ${shuffle ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}>
                <Shuffle size={15} />
              </button>
            )}
            <button onClick={handlePrev} disabled={radioFmActive} className="p-2 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!currentTrack || radioFmActive}
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30"
            >
              {isPlaying
                ? <Pause size={16} fill="#000" className="text-black" />
                : <Play  size={16} fill="#000" className="text-black ml-0.5" />}
            </button>
            <button onClick={handleNext} disabled={radioFmActive} className="p-2 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <SkipForward size={18} fill="currentColor" />
            </button>
            {!radioFmActive && (
              <button onClick={toggleRepeat} className={`p-1.5 transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}>
                {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Desktop player ── */}
      <div className={`app-player hidden md:flex bg-surface border-t border-[var(--border)] items-center shrink-0 relative ${playerCollapsed ? 'h-7' : 'h-[90px] px-4 gap-4'}`} onContextMenu={(e) => { e.preventDefault(); if (currentTrack) { setCtxMenuPos({ x: e.clientX, y: e.clientY }); setShowContextMenu(true) } }}>
        {playerCollapsed ? (
        <>
          {/* Thin progress line along the top edge */}
          {radioFmActive ? (
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-900/40">
              <div className="h-full bg-red-400" style={{ width: `${fmProgress * 100}%` }} />
            </div>
          ) : (
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-surface-overlay">
              <div className="h-full bg-accent" style={{ width: `${(seekDrag !== null ? seekDrag : progress) * 100}%` }} />
            </div>
          )}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={!currentTrack || radioFmActive}
            className="ml-4 w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-transform disabled:opacity-30"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <Pause size={12} fill="#000" className="text-black" />
              : <Play  size={12} fill="#000" className="text-black ml-0.5" />}
          </button>
          <span className="ml-3 text-xs truncate min-w-0 flex-1">
            <span className="text-text-secondary font-medium">
              {radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.title : (currentTrack?.title || 'Not playing')}
            </span>
            {(radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.artist : currentTrack?.artist) && (
              <span className="text-text-muted"> - {radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.artist : currentTrack?.artist}</span>
            )}
          </span>
          <span className="text-text-muted text-xs tabular-nums shrink-0">
            {radioFmActive
              ? `${formatDuration(Math.floor(fmElapsedMs / 1000))} / ${formatDuration(Math.floor(fmDurationMs / 1000))}`
              : `${formatDuration(currentTime)} / ${formatDuration(duration)}`}
          </span>
          <button
            onClick={() => setPlayerCollapsed(false)}
            title="Expand player"
            className="mx-4 text-text-secondary hover:text-text-primary transition-colors shrink-0"
          >
            <ChevronUp size={18} />
          </button>
        </>
        ) : (
        <>
        {/* Track info */}
        <div className="flex items-center gap-3 w-72 min-w-0 shrink-0">
          <button
            className="w-14 h-14 rounded-md bg-surface-overlay shrink-0 overflow-hidden hover:ring-2 ring-accent transition-all"
            onClick={() => setActiveView('wrld')}
            title={radioFmActive ? '999FM' : 'Open WRLD'}
          >
            {radioFmActive ? (
              radioFmMatchedSong?.imageUrl
                ? <img src={radioFmMatchedSong.imageUrl} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-red-900/70 to-black flex items-center justify-center"><Radio size={22} className="text-red-400 opacity-80" /></div>
            ) : (!coverArtError && (currentTrackFull?.albumArt ?? currentTrack?.imageUrl)) ? (
              <img key={currentTrackFull?.albumArt ?? currentTrack?.imageUrl} src={smallCoverUrl(currentTrackFull?.albumArt ?? currentTrack?.imageUrl)} alt="Album art" className="w-full h-full object-cover" onError={() => setCoverArtError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </button>

          <div className="min-w-0 flex-1">
            {/* Title + heart + 3-dot inline */}
            <div className="flex items-center gap-1 min-w-0">
              <p
                className="text-text-primary text-sm font-medium truncate min-w-0"
                title={radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.title : (currentTrack?.title || undefined)}
              >
                {radioFmActive && radioFmNowPlaying
                  ? radioFmNowPlaying.title
                  : (currentTrack?.title || 'Not playing')}
              </p>
              <div className="flex items-center gap-0 shrink-0">
                {currentSongId != null && (
                  <button
                    className={`p-1 rounded transition-colors ${currentTrack && likedTrackIds.includes(currentTrack.id) ? 'text-accent' : 'text-text-muted hover:text-accent'}`}
                    onClick={() => currentTrack && toggleLike(currentTrack.id)}
                    title="Like"
                  >
                    <Heart size={13} fill={currentTrack && likedTrackIds.includes(currentTrack.id) ? 'currentColor' : 'none'} />
                  </button>
                )}

                <div className="relative">
                  <button
                    ref={contextMenuBtnRef}
                    className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
                    onClick={() => { setCtxMenuPos(null); setShowContextMenu((v) => !v) }}
                    title="More options"
                    disabled={!currentTrack && !radioFmActive}
                  >
                    <MoreHorizontal size={13} />
                  </button>

                  {showContextMenu && radioFmActive && radioFmNowPlaying && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(false)} />
                      <div className="absolute bottom-7 left-0 z-50 w-48 bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--border)] mb-1">
                          <p className="text-text-primary text-xs font-semibold truncate" title={radioFmNowPlaying.title}>{radioFmNowPlaying.title}</p>
                          <p className="text-text-muted text-[10px] truncate">{radioFmNowPlaying.artist}</p>
                        </div>
                        {radioFmNowPlaying.song_id != null && (
                          <button
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                            onClick={openSongInfo}
                          >
                            <Info size={14} /> Song info
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {showContextMenu && !radioFmActive && currentTrack && (
                    <SongContextMenu
                      state={{
                        track: currentTrack,
                        songId: currentSongId,
                        x: ctxMenuPos?.x ?? contextMenuBtnRef.current?.getBoundingClientRect().left ?? 0,
                        y: ctxMenuPos?.y ?? contextMenuBtnRef.current?.getBoundingClientRect().top ?? 0,
                      }}
                      onClose={() => { setShowContextMenu(false); setCtxMenuPos(null) }}
                      canEdit={canEditSong}
                      onInfo={openSongInfo}
                      onPlayNext={() => playNext(currentTrack)}
                      liked={likedTrackIds.includes(currentTrack.id)}
                      onToggleLike={() => toggleLike(currentTrack.id)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Artist + radio badge */}
            <div className="flex items-center gap-1.5">
              <p className="text-text-muted text-xs truncate">{radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.artist : (currentTrack?.artist || '')}</p>
              {(radioMode || radioFmActive) && (
                <span className={`flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-widest shrink-0 ${radioFmActive ? 'text-red-400' : 'text-accent'}`}>
                  <Radio size={9} /> {radioFmActive ? '999 FM' : 'Random'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: controls + progress */}
        <div className="flex-1 flex flex-col items-center gap-2">
          <div className="flex items-center gap-5">
            {!radioFmActive && <button onClick={toggleShuffle}
              className={`transition-colors ${shuffle ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}>
              <Shuffle size={18} />
            </button>}

            <button onClick={handlePrev} disabled={radioFmActive} className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <SkipBack size={20} fill="currentColor" />
            </button>

            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!currentTrack || radioFmActive}
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30"
            >
              {isPlaying
                ? <Pause size={18} fill="#000" className="text-black" />
                : <Play  size={18} fill="#000" className="text-black ml-0.5" />}
            </button>

            <button onClick={handleNext} disabled={radioFmActive} className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <SkipForward size={20} fill="currentColor" />
            </button>

            {!radioFmActive && <button onClick={toggleRepeat}
              className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}>
              {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 w-full max-w-xl">
            <span className="text-text-muted text-xs w-10 text-right tabular-nums">
              {radioFmActive
                ? formatDuration(Math.floor(fmElapsedMs / 1000))
                : formatDuration(currentTime)}
            </span>
            <div className="flex-1 progress-track">
              <input
                type="range" min={0} max={1} step={0.001}
                value={radioFmActive ? fmProgress : (seekDrag !== null ? seekDrag : progress)}
                onMouseDown={radioFmActive ? undefined : handleSeekMouseDown}
                onTouchStart={radioFmActive ? undefined : handleSeekMouseDown}
                onChange={handleSeekChange}
                onMouseUp={radioFmActive ? undefined : handleSeekCommit}
                onTouchEnd={radioFmActive ? undefined : handleSeekCommit}
                onKeyUp={radioFmActive ? undefined : handleSeekCommit}
                disabled={!currentTrack} className="w-full"
                style={{ '--val': `${(radioFmActive ? fmProgress : (seekDrag !== null ? seekDrag : progress)) * 100}%`, ...(radioFmActive ? { pointerEvents: 'none' as const } : {}) } as React.CSSProperties}
              />
            </div>
            <span className="text-text-muted text-xs w-10 tabular-nums">
              {radioFmActive ? formatDuration(Math.floor(fmDurationMs / 1000)) : formatDuration(duration)}
            </span>
          </div>
        </div>

        {/* Right: equalizer + queue + NP + volume */}
        <div className="flex items-center gap-3 w-72 justify-end">
          {/* Equalizer (EQ, balance, mono, skip silence, playback speed).
              Stays visible during FM - the effects chain applies to the live
              stream too; only the speed row hides inside the panel. Hidden
              entirely on iOS: EFFECTS_SUPPORTED is false there since routing
              through Web Audio kills background playback (see audioEffects.ts). */}
          {EFFECTS_SUPPORTED && (
            <button
              ref={eqBtnRef}
              onClick={toggleEqPanel}
              title="Equalizer"
              className={`transition-colors ${eqActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
            >
              <SlidersHorizontal size={16} />
            </button>
          )}

          {!radioFmActive && <button onClick={() => setShowQueue(!showQueue)}
            className={`relative transition-colors ${showQueue ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
            title="Queue">
            <ListOrdered size={16} />
            {queue.length > queueIndex + 1 && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-accent text-black rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                {Math.min(queue.length - queueIndex - 1, 99)}
              </span>
            )}
          </button>}

          {!radioFmActive && <button onClick={() => setShowNowPlaying(!showNowPlaying)}
            className={`transition-colors ${showNowPlaying ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
            title="Now Playing">
            <Maximize2 size={16} />
          </button>}

          {/* Volume: mute + slider + output picker */}
          <div className="flex items-center gap-1.5">
            <button onClick={toggleMute} className="text-text-secondary hover:text-text-primary transition-colors" title="Mute">
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            <div className="relative w-20 progress-track flex items-center group/vol">
              <span
                className="absolute -top-8 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-surface-highest border border-[var(--border)] text-text-primary text-sm font-semibold tabular-nums opacity-0 group-hover/vol:opacity-100 transition-opacity pointer-events-none"
              >
                {Math.round(volume * 100)}%
              </span>
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={handleVolumeChange} className="w-full block"
                style={{ '--val': `${volume * 100}%` } as React.CSSProperties} />
            </div>

            {outputDevices.length > 1 && (
              <button
                ref={outputBtnRef}
                onClick={openOutputPicker}
                title="Audio output"
                className={`transition-colors ${audioOutput ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
              >
                <Volume2 size={14} />
              </button>
            )}
          </div>

          <button
            onClick={() => setPlayerCollapsed(true)}
            title="Collapse player"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronDown size={18} />
          </button>
        </div>
        </>
        )}

        {/* Output device popover */}
        {showOutputPicker && createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowOutputPicker(false)} />
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed z-50 bg-surface-highest border border-[var(--border)] rounded-xl shadow-2xl py-1.5 min-w-[220px]"
              style={{ bottom: pickerPos.bottom, right: pickerPos.right }}
            >
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted">Audio Output</p>
              <button
                onClick={() => { setAudioOutput(''); setShowOutputPicker(false) }}
                className="flex items-center gap-3 w-full px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
              >
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {audioOutput === '' && <Check size={12} className="text-accent" />}
                </span>
                System default
              </button>
              {outputDevices.map((d) => (
                <button
                  key={d.deviceId}
                  onClick={() => { setAudioOutput(d.deviceId); setShowOutputPicker(false) }}
                  className="flex items-center gap-3 w-full px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
                >
                     <span className="w-4 h-4 flex items-center justify-center shrink-0">
                    {audioOutput === d.deviceId && <Check size={12} className="text-accent" />}
                  </span>
                  <span className="truncate">{d.label || `Output ${d.deviceId.slice(0, 8)}`}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
      </div>
      </>
      )}
    </>
  )
}
