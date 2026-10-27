// The cleared desk's visualizer: WRLD's own, drawn behind the widgets in place of the wallpaper (desktop/pages/
// curtain.ts). The curtain hears nothing itself, so the main window, which plays the music, analyses it where WRLD's
// visualizer taps it and sends each frame on while the desk is clear, and tells the main process the look to draw it
// in whenever that changes, so a curtain knows it the moment it opens.
import { AudioEngine, PACKED_LENGTH, packFrame } from '../lib/viz/audio'
import { extractPalette } from '../lib/viz/palette'
import type { Quality, RGB } from '../lib/viz/types'
import { getAnalysisTap } from '../lib/audioEffects'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { smallCoverUrl } from '../lib/juicewrldApi'
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

/** Keeps the main process told what the cleared desk draws, and feeds the curtain frames while it's a visualizer. */
export function followDeskViz(api: DesktopApi, coverOf: (s: AppStore) => string | null): void {
  const readAccent = (): string => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  let accent = readAccent()
  let palette: RGB[] | null = null
  let paletteFor: string | null | undefined
  let mode: string | null = null
  let isClear = false
  let sent = ''

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
    const look: DeskVizLook = {
      mode: s.desktop.clear.visualizer && v.activeMode !== 'none' ? v.activeMode : null,
      quality: v.vizQuality,
      usePalette: v.vizUseArtwork,
      palette,
      accent,
      cover,
      playing: playingNow(s),
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
    if (v.activeMode !== p.activeMode || v.vizQuality !== p.vizQuality || v.vizUseArtwork !== p.vizUseArtwork) later()
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
  api.onClearState((on) => { isClear = on; follow() })
}
