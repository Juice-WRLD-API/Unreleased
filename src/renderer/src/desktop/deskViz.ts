// The cleared desk's visualizer: WRLD's own, drawn behind the widgets in place of the wallpaper (desktop/pages/
// curtain.ts). The curtain hears nothing itself, so the main window, which plays the music, analyses it where WRLD's
// visualizer taps it and sends each frame on while the desk is clear, and tells the main process the look to draw it
// in whenever that changes, so a curtain knows it the moment it opens. The song's video plays there too, as in WRLD:
// worked out here (lib/musicVideos) while the desk is clear, and sent with where the song is for the curtain to follow.
import { AudioEngine, PACKED_LENGTH, packFrame } from '../lib/viz/audio'
import { extractPalette } from '../lib/viz/palette'
import type { Quality, RGB } from '../lib/viz/types'
import { getAnalysisTap } from '../lib/audioEffects'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { buildStreamUrl, smallCoverUrl } from '../lib/juicewrldApi'
import { isAbortError } from '../lib/apiClient'
import { chooseMusicVideo, musicVideoTargetFor, videoTargetKey, type PlayingForVideo } from '../lib/musicVideos'
import { onMusicVideoDefaultsChange } from '../lib/musicVideoDefaultsApi'
import type { VideoSync } from '../lib/videoFollow'
import { watchPlayClock } from './playClock'
import type { StageClock } from './lyrics/scene'
import { useStore, type AppStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { eraAssetPath } from './artColors'
import type { DesktopApi } from './api'

/** How often a frame goes to the curtain: about the screen's own rate, as the meter does. */
const FRAME_MS = 16
/** Frames go on this long after the desk comes back, while the curtain fades away. */
const LINGER_MS = 900

/** What the cleared desk's curtain draws. */
export interface DeskVizLook {
  /** The visualizer; null for the wallpaper instead (it's Off in WRLD, or switched off for the desk). */
  mode: string | null
  quality: Quality
  /** The cover's colors rather than the accent's. */
  usePalette: boolean
  palette: RGB[] | null
  accent: string
  /** The cover, blurred behind the visualizer as WRLD has it. */
  cover: string | null
  playing: boolean
  /** The song's video over the visualizer (or over the cover, with the visualizer Off), as WRLD shows it. */
  video: { url: string; sync: VideoSync } | null
  /** Where the song is, for the video to follow; null without a video. */
  clock: StageClock | null
}

const palettes = new Map<string, Promise<RGB[] | null>>()

/** The cover's colors as WRLD's visualizer takes them: the API site's era images can't be sampled (no CORS), so
 *  theirs are baked; the rest are sampled at 48px, which the small cover is enough for. */
function paletteOf(cover: string): Promise<RGB[] | null> {
  let found = palettes.get(cover)
  if (!found) {
    const era = eraAssetPath(cover)
    found = era ? Promise.resolve(ERA_PALETTES[era] ?? null) : extractPalette(smallCoverUrl(cover) ?? cover)
    if (palettes.size > 200) palettes.clear()
    palettes.set(cover, found)
  }
  return found
}

const playingNow = (s: AppStore): boolean => s.radioFmActive || s.isPlaying
const playingOf = (s: AppStore): PlayingForVideo => ({ track: s.currentTrack, fmActive: s.radioFmActive, fmSong: s.radioFmMatchedSong })
/** How long to wait before looking a video up again after a look-up cut short by someone else's (WRLD's) abort. */
const RETRY_MS = 1000

/** Keeps the main process told what the cleared desk draws, and feeds the curtain frames while it's a visualizer. */
export function followDeskViz(api: DesktopApi, coverOf: (s: AppStore) => string | null): void {
  const readAccent = (): string => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  let accent = readAccent()
  let palette: RGB[] | null = null
  let paletteFor: string | null | undefined
  let mode: string | null = null
  let isClear = false
  let sent = ''

  // ---- the song's video ----

  let video: { url: string; sync: VideoSync } | null = null
  /** What `video` was looked up for (the song, the choice, the picks), '' for nothing yet. */
  let videoFor = ''
  let videoJob: AbortController | null = null
  let defaultsTurn = 0
  let clock: StageClock | null = null
  let stopClock: (() => void) | null = null

  /** Only while the desk is clear and draws WRLD's backdrop: the look-up can download a few MB the first time. */
  const wantVideo = (): boolean => isClear && useStore.getState().desktop.clear.visualizer
  const videoKey = (): string => {
    const v = useVizStore.getState()
    return [videoTargetKey(playingOf(useStore.getState())), v.wrldVideos, JSON.stringify(v.wrldVideoPicks), defaultsTurn].join('|')
  }

  function lookUpVideo(): void {
    if (!wantVideo()) {
      // A look-up cut short starts again next time; one finished is kept for the same song.
      if (videoJob) { videoJob.abort(); videoJob = null; videoFor = '' }
      return
    }
    const key = videoKey()
    if (key === videoFor) return
    videoFor = key
    videoJob?.abort()
    const ac = new AbortController()
    videoJob = ac
    video = null
    void (async () => {
      const target = await musicVideoTargetFor(playingOf(useStore.getState()), ac.signal)
      if (!target) return null
      const v = useVizStore.getState()
      return (await chooseMusicVideo(target, { choice: v.wrldVideos, pick: v.wrldVideoPicks[target.path] ?? null, signal: ac.signal })).match
    })().then((m) => {
      if (ac.signal.aborted) return
      videoJob = null
      video = m ? { url: buildStreamUrl(m.video.path), sync: m.sync } : null
      later()
    }, (err) => {
      if (ac.signal.aborted) return
      videoJob = null
      // A line-up WRLD started and then dropped (its song changed, it closed) ends this one too: ask again.
      if (isAbortError(err)) { videoFor = ''; window.setTimeout(later, RETRY_MS); return }
      console.warn('[deskViz] video', err)
    })
  }

  /** The song's clock goes with the look while there's a video to follow it. */
  function followClock(on: boolean): void {
    if (on && !stopClock) stopClock = watchPlayClock((next) => { clock = next; later() })
    else if (!on && stopClock) { stopClock(); stopClock = null; clock = null }
  }

  const send = (): void => {
    const s = useStore.getState()
    const v = useVizStore.getState()
    const cover = coverOf(s)
    // The last song's colors stay until the new one's are known, as in WRLD.
    if (cover !== paletteFor) {
      paletteFor = cover
      if (!cover) palette = null
      else void paletteOf(cover).then((p) => { if (paletteFor === cover) { palette = p; later() } })
    }
    lookUpVideo()
    const shownVideo = wantVideo() ? video : null
    followClock(shownVideo !== null)
    const look: DeskVizLook = {
      mode: s.desktop.clear.visualizer && v.activeMode !== 'none' ? v.activeMode : null,
      quality: v.vizQuality,
      usePalette: v.vizUseArtwork,
      palette,
      accent,
      cover,
      playing: playingNow(s),
      video: shownVideo,
      clock: shownVideo ? clock : null,
    }
    mode = look.mode
    const json = JSON.stringify(look)
    if (json !== sent) { sent = json; api.vizLook(look) }
    follow()
  }

  let scheduled = false
  const later = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; send() })
  }

  // ---- the frames ----

  let feed: { engine: AudioEngine; timer: number } | null = null
  let lingering = 0

  const start = (): void => {
    const engine = new AudioEngine()
    const out = new Float32Array(PACKED_LENGTH)
    let last = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // The graph is built on the first play: until then, the gentle signal of no audio.
      if (!engine.active) {
        const tap = getAnalysisTap()
        if (tap) engine.enableNode(tap.ctx, tap.node)
      }
      engine.boost = useVizStore.getState().vizBoost
      api.vizFrame(packFrame(engine.analyze(dt, playingNow(useStore.getState())), out))
    }, FRAME_MS)
    feed = { engine, timer }
  }

  const stop = (): void => {
    if (!feed) return
    window.clearInterval(feed.timer)
    feed.engine.disable()
    feed = null
  }

  /** Frames go while the desk is clear with a visualizer to draw, and a moment after. */
  function follow(): void {
    const wanted = isClear && mode !== null
    if (wanted) {
      window.clearTimeout(lingering)
      lingering = 0
      if (!feed) start()
    } else if (feed && !lingering) {
      lingering = window.setTimeout(() => { lingering = 0; stop() }, LINGER_MS)
    }
  }

  send()
  useVizStore.subscribe((v, p) => {
    if (v.activeMode !== p.activeMode || v.vizQuality !== p.vizQuality || v.vizUseArtwork !== p.vizUseArtwork
      || v.wrldVideos !== p.wrldVideos || v.wrldVideoPicks !== p.wrldVideoPicks) later()
  })
  useStore.subscribe((s, p) => {
    if (s.desktop.clear !== p.desktop.clear || s.isPlaying !== p.isPlaying || s.radioFmActive !== p.radioFmActive
      || s.currentTrack !== p.currentTrack || s.currentTrackFull !== p.currentTrackFull || s.radioFmNowPlaying !== p.radioFmNowPlaying
      || s.radioFmMatchedSong !== p.radioFmMatchedSong) later()
  })
  // --accent is written to <html>'s inline style by several paths (WrldVisualizer follows it the same way).
  new MutationObserver(() => {
    const next = readAccent()
    if (next !== accent) { accent = next; later() }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  onMusicVideoDefaultsChange(() => { defaultsTurn++; later() })
  api.onClearState((on) => { isClear = on; later() })
}
