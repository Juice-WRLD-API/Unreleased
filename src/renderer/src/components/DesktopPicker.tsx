import { useEffect, useRef } from 'react'
import { X, Check } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { useStore } from '../store/useStore'
import { LOOKS, lookOf, placeNumber, tickerHeight, type Look } from '../desktop/light/looks'
import { EdgeRenderer } from '../desktop/light/renderer'
import { hsbToRgb, type AlbumColors, type LightFrame } from '../desktop/light/engine'
import { LYRIC_LOOKS, lyricFontFor } from '../desktop/lyrics/looks'
import { LyricStage } from '../desktop/lyrics/stage'
import { epochNow } from '../desktop/lyrics/scene'
import type { TimedLyrics } from '../desktop/lyrics/timing'
import { useAlbumColors, eraAssetPath } from '../desktop/artColors'
import { useVizStore, useWrldEdgeLook } from '../store/vizStore'
import { VISUALIZERS } from '../lib/viz'
import { GLRenderer } from '../lib/viz/gl'
import { Canvas2DRenderer } from '../lib/viz/canvas2d'
import { BINS, NOTE_COUNT } from '../lib/viz/audio'
import { extractPalette, paletteFromAccent, parseColor } from '../lib/viz/palette'
import { QUALITY, type AudioFrame, type RGB } from '../lib/viz/types'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { webglAvailable } from './VizControls'

// The light, lyric and visualizer choosers: every light plays in a small screen of its own - the real shader, told it
// draws a 1920 × 1080 screen, scaled down - to a made-up song, a beat every half second, every other one harder, with
// the user's own thickness, glow, tail and colors; every lyric style sings a few made-up lines over and over in its
// own face and the playing song's colors; every WRLD visualizer, classic or shader, plays the same made-up song in the
// colors WRLD would give it. A click picks it. Only the screens in sight draw, all the lights (and all the shaders)
// through one WebGL canvas kept off the page.

const SCREEN: [number, number] = [1920, 1080]
const TILE_W = 220, TILE_H = 124
const PIXELS = 2

/** The one WebGL canvas the screens take turns on, `w` × `h`. Offscreen where the browser can draw WebGL there: each
 *  screen's picture is then handed over whole (transferToImageBitmap), with no copy and no wait for the GPU. Copying it
 *  in with drawImage, the way left where it can't, waits for the GPU to finish every screen, every frame. `make` gives
 *  null when it can't draw on the canvas it's given. */
function sharedCanvas<R>(w: number, h: number, make: (canvas: HTMLCanvasElement | OffscreenCanvas) => R | null): { canvas: HTMLCanvasElement | OffscreenCanvas; renderer: R | null } {
  if (typeof OffscreenCanvas !== 'undefined' && typeof ImageBitmapRenderingContext !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const renderer = make(canvas)
    if (renderer) return { canvas, renderer }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return { canvas, renderer: make(canvas) }
}

type Screen = ImageBitmapRenderingContext | CanvasRenderingContext2D | null

/** A screen, taking its pictures from `from` the way it can: handed over, or copied. */
const screenFor = (canvas: HTMLCanvasElement, from: HTMLCanvasElement | OffscreenCanvas): Screen =>
  from instanceof HTMLCanvasElement ? canvas.getContext('2d') : canvas.getContext('bitmaprenderer')

/** The picture just drawn on `from`, onto a screen. */
function present(from: HTMLCanvasElement | OffscreenCanvas, to: Screen): void {
  if (!to) return
  if ('transferFromImageBitmap' in to) to.transferFromImageBitmap((from as OffscreenCanvas).transferToImageBitmap())
  else { to.clearRect(0, 0, to.canvas.width, to.canvas.height); to.drawImage(from, 0, 0) }
}

interface Tile { look: Look & { number: number }; el: HTMLDivElement; screen: Screen; seen: boolean; drops: { born: number; at: number }[] }

function LightGrid({ chosen, onPick, colors }: { chosen: string; onPick: (id: string) => void; colors: AlbumColors | null }): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const light = useStore((s) => s.desktop.light)
  const styleRef = useRef(light)
  styleRef.current = light
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const W = TILE_W * PIXELS, H = TILE_H * PIXELS
    const { canvas: glCanvas, renderer } = sharedCanvas(W, H, (canvas) => {
      try {
        // Copied from after each screen's drawn, a canvas on the page has to keep what it drew till then.
        return new EdgeRenderer(canvas, { preserveDrawingBuffer: canvas instanceof HTMLCanvasElement })
      } catch (e) {
        console.warn('[picker] no WebGL2', e)
        return null
      }
    })
    if (!renderer) return
    const tiles: Tile[] = [...grid.querySelectorAll<HTMLDivElement>('[data-look]')].map((el) => {
      const canvas = el.querySelector('canvas')!
      return { look: lookOf(el.dataset.look!), el, screen: screenFor(canvas, glCanvas), seen: false, drops: [] }
    })
    const sight = new IntersectionObserver((entries) => {
      for (const entry of entries) { const t = tiles.find((x) => x.el === entry.target); if (t) t.seen = entry.isIntersecting }
    }, { root: grid })
    tiles.forEach((t) => sight.observe(t.el))

    // ---- the made-up song ----
    let last = 0, nextBeat = 0, beats = 0, kick = 0, travel = 0, wiggle = 0, drift = 0
    const play = (now: number, seconds: number): void => {
      if (now >= nextBeat) {
        nextBeat = Math.max(nextBeat + 0.5, now)
        beats += 1
        kick = Math.max(kick, beats % 2 === 0 ? 1 : 0.6)
        for (const t of tiles) if (t.look.drops) { t.drops.push({ born: now, at: Math.random() }); if (t.drops.length > 4) t.drops.shift() }
      }
      kick *= Math.exp(-seconds / 0.14)
      const tempo = 1.1
      travel = (travel + (seconds / 16) * (tempo + 6 * kick)) % 1
      wiggle = (wiggle + seconds * 3 * (tempo + 1.5 * kick)) % (2 * Math.PI)
      drift = (drift + seconds * (tempo + 0.7 * kick) * 0.6) % 1000
    }

    const draw = (t: Tile, now: number): void => {
      const style = styleRef.current
      const album = style.useArtworkColors ? colorsRef.current : null
      const first = album ? album.primary : style.primary
      const second = style.twoColors ? (album ? album.secondary : style.secondary) : first
      const thickness = 12 + style.thickness * 52
      const recent = t.drops.slice(-4).reverse()
      const look = t.look
      const words = !!look.words
      const wordsWidth = words ? renderer.setWords('Your lyrics, in lights', style.thickness) : 0
      const u: LightFrame = {
        size: SCREEN, scale: W / SCREEN[0],
        colorA: hsbToRgb(first), colorB: hsbToRgb(second),
        wiggle, headA: travel, headB: look.id === 'twin' ? (1.5 - travel) % 1 : (travel + 0.5) % 1,
        span: 0.18 + 0.54 * style.tailLength, thickness, glow: style.glow, corner: 12,
        band: thickness * look.reach * 2.6, still: 0, presence: 1,
        pulse: 0.85 + 1.3 * 0.6 * kick, swell: 1 + 1.25 * 0.6 * kick, time: now % 3600,
        sparkle: 0, taper: 1.6 - style.tailLength,
        drops: [0, 1, 2, 3].map((i) => (i < recent.length ? now - recent[i].born : -1)),
        dropAt: [0, 1, 2, 3].map((i) => (i < recent.length ? recent[i].at : 0)),
        strip: [wordsWidth, tickerHeight(style.thickness), (now * 90) % Math.max(wordsWidth, 1), 0],
        look: look.number, fn: look.fn, drift, beat: kick, place: placeNumber(style.place),
      }
      // A light whose program is still building keeps its screen as it was.
      if (renderer.draw(u, W, H, words)) present(glCanvas, t.screen)
    }

    let raf = 0
    const frame = (ms: number): void => {
      raf = requestAnimationFrame(frame)
      const now = ms / 1000
      if (now - last < 1 / 30 - 0.004) return // thirty frames a second is plenty for a preview
      const seconds = last ? Math.min(now - last, 0.1) : 0
      last = now
      play(now, seconds)
      for (const t of tiles) if (t.seen) draw(t, now)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      sight.disconnect()
      renderer.dispose()
    }
  }, [])

  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 overflow-y-auto p-5 pt-1 min-h-0">
      {LOOKS.map((l) => (
        <div key={l.id} data-look={l.id} onClick={() => onPick(l.id)} className="cursor-pointer group">
          <canvas
            width={TILE_W * PIXELS} height={TILE_H * PIXELS}
            className={`block w-full aspect-[220/124] rounded-xl bg-[#0d0d0d] transition-shadow ${
              chosen === l.id ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.9)]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]'
            }`}
          />
          <div className={`flex items-center mt-2 text-[13px] font-medium ${chosen === l.id ? 'text-text-primary' : 'text-text-muted'}`}>
            <span className="flex-1">{l.title}</span>
            {chosen === l.id && <Check size={14} />}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- the lyric styles ----

const LINES = ['your words land here', 'word by word on the beat', 'in the style you pick']
const EACH = 2.4
const PERIOD = EACH * LINES.length + 0.6
const PREVIEW_LYRICS: TimedLyrics = {
  isSynced: true,
  lines: LINES.map((text, index) => {
    const start = 0.3 + index * EACH, parts = text.split(' '), step = (EACH - 0.4) / parts.length
    return { time: start, text, words: parts.map((t, i) => ({ text: t, start: start + i * step, end: start + (i + 1) * step })), adlibs: [] }
  }),
}
const SCALE = 0.36

function LyricGrid({ chosen, onPick, colors }: { chosen: string; onPick: (id: string) => void; colors: AlbumColors | null }): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const fonts = useStore((s) => s.desktop.lyrics.fonts)
  const fontsRef = useRef(fonts)
  fontsRef.current = fonts
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const singRef = useRef<() => void>(() => {})

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const started = epochNow()
    const screens = [...grid.querySelectorAll<HTMLDivElement>('[data-lyric]')]
    const tiles = screens.map((el, index) => {
      const stage = new LyricStage(el.querySelector<HTMLDivElement>('[data-screen]')!)
      stage.use(el.dataset.lyric!)
      // Each screen a little ahead of the one before: a line is drawn into pictures as it starts, and all of them
      // starting together made one long frame each time.
      return { id: el.dataset.lyric!, el, stage, seen: false, from: started - index * (EACH / screens.length), timer: 0 }
    })
    /** One screen, from the top of the lines this time round: a new clock each round, so the lines start again. */
    const sing = (t: (typeof tiles)[number]): void => {
      const now = epochNow()
      const round = Math.floor((now - t.from) / PERIOD)
      const clock = { seconds: 0, at: t.from + round * PERIOD, running: true }
      t.stage.show({ id: `preview-${round}`, lyrics: PREVIEW_LYRICS, title: 'Unreleased', artist: '' },
        { clock, isSeen: t.seen, colors: colorsRef.current, face: lyricFontFor(fontsRef.current, t.id), scale: SCALE })
    }
    const singAll = (): void => tiles.forEach(sing)
    singRef.current = singAll
    const sight = new IntersectionObserver((entries) => {
      for (const entry of entries) { const t = tiles.find((x) => x.el === entry.target); if (t) { t.seen = entry.isIntersecting; sing(t) } }
    }, { root: grid })
    tiles.forEach((t) => sight.observe(t.el))
    const nextRound = (t: (typeof tiles)[number]): void => {
      const wait = PERIOD - ((epochNow() - t.from) % PERIOD)
      t.timer = window.setTimeout(() => { sing(t); nextRound(t) }, wait * 1000 + 5)
    }
    tiles.forEach(nextRound)
    return () => {
      tiles.forEach((t) => window.clearTimeout(t.timer))
      sight.disconnect()
      tiles.forEach((t) => t.stage.destroy())
    }
  }, [])

  useEffect(() => { singRef.current() }, [fonts, colors])

  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 overflow-y-auto p-5 pt-1 min-h-0">
      {LYRIC_LOOKS.map((l) => (
        <div key={l.id} data-lyric={l.id} onClick={() => onPick(l.id)} className="cursor-pointer group">
          <div className={`relative w-full aspect-[220/124] rounded-xl overflow-hidden bg-[#0d0d0d] transition-shadow ${
            chosen === l.id ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.9)]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]'
          }`}>
            <div data-screen />
          </div>
          <div className={`flex items-center mt-2 text-[13px] font-medium ${chosen === l.id ? 'text-text-primary' : 'text-text-muted'}`}>
            <span className="flex-1">{l.title}</span>
            {chosen === l.id && <Check size={14} />}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- the WRLD visualizers ----

const CLASSIC = VISUALIZERS.filter((v) => v.engine === '2d' && v.id !== 'none')
const SHADERS = VISUALIZERS.filter((v) => v.engine === 'gl')
const RIPPLES = 8
/** A chord a bar: the notes the made-up song holds, as semitones above C2. */
const CHORDS = [[12, 16, 19, 28], [9, 12, 16, 33], [5, 9, 12, 29], [7, 11, 14, 31]]

/** The made-up song as the engine's analysis would hear it: the same beat as the lights', a bass under it, a chord a
 *  bar, a wave and a stereo scope that swing with it. */
function madeUpSong(): { audio: AudioFrame; ripples: Float32Array; clock: { time: number; flow: number }; play: (seconds: number) => void } {
  const audio: AudioFrame = {
    spec: new Float32Array(BINS), peaks: new Float32Array(BINS), wave: new Float32Array(256),
    waveL: new Float32Array(512), waveR: new Float32Array(512), notes: new Float32Array(NOTE_COUNT), chroma: new Float32Array(12),
    bass: 0, mid: 0, treble: 0, energy: 0, beat: 0,
  }
  const ripples = new Float32Array(RIPPLES * 4)
  const drops: { born: number; angle: number; dist: number; strength: number }[] = []
  const clock = { time: 0, flow: 0 }
  let nextBeat = 0, beats = 0, kick = 0
  const play = (seconds: number): void => {
    const time = (clock.time += seconds)
    if (time >= nextBeat) {
      nextBeat = Math.max(nextBeat + 0.5, time)
      beats += 1
      kick = beats % 2 === 0 ? 1 : 0.6
      drops.push({ born: time, angle: Math.random() * Math.PI * 2, dist: 0.9 + Math.random() * 0.5, strength: 0.45 + kick * 0.7 })
      if (drops.length > RIPPLES) drops.shift()
    } else {
      kick *= Math.exp(-seconds / 0.14)
    }
    audio.bass = 0.3 + 0.6 * kick
    audio.mid = 0.35 + 0.12 * Math.sin(time * 1.3)
    audio.treble = 0.25 + 0.12 * Math.sin(time * 2.1 + 1)
    audio.energy = (audio.bass + audio.mid + audio.treble) / 3
    audio.beat = kick
    for (let i = 0; i < BINS; i++) {
      const low = i < 10 ? kick * (1 - i / 10) : 0
      audio.spec[i] = Math.min(1, Math.max(0, 0.6 * (1 - i / BINS) + 0.5 * low + 0.12 * Math.sin(time * 3 + i * 0.45)))
      audio.peaks[i] = Math.max(audio.peaks[i] - seconds * 0.55, audio.spec[i])
    }
    const swing = 0.4 + 0.6 * audio.energy
    for (let k = 0; k < audio.wave.length; k++) {
      audio.wave[k] = swing * (0.5 * Math.sin((k / audio.wave.length) * Math.PI * 6 + time * 8) + 0.25 * kick * Math.sin(k * 0.37 + time * 20))
    }
    const width = 0.5 + 0.4 * Math.sin(time * 0.7)
    for (let k = 0; k < audio.waveL.length; k++) {
      const phase = (k / audio.waveL.length) * Math.PI * 10 + time * 6
      audio.waveL[k] = swing * (0.6 * Math.sin(phase) + 0.2 * Math.sin(phase * 3.01))
      audio.waveR[k] = swing * (0.6 * Math.sin(phase + width) + 0.2 * Math.sin(phase * 2.99 + width))
    }
    const chord = CHORDS[Math.floor(beats / 4) % CHORDS.length]
    audio.chroma.fill(0)
    for (let n = 0; n < NOTE_COUNT; n++) {
      const held = chord.includes(n) ? 0.55 + 0.35 * kick : 0
      audio.notes[n] = Math.max(held, audio.notes[n] * Math.exp(-seconds / 0.25))
      audio.chroma[n % 12] += audio.notes[n]
    }
    const loudest = Math.max(...audio.chroma, 1e-6)
    for (let c = 0; c < 12; c++) audio.chroma[c] /= loudest
    clock.flow += seconds * (0.4 + audio.energy * 1.1 + audio.beat * 0.8)
    while (drops.length && time - drops[0].born > 4) drops.shift()
    ripples.fill(0)
    drops.forEach((d, i) => ripples.set([d.angle, d.dist, time - d.born, d.strength], i * 4))
  }
  return { audio, ripples, clock, play }
}

function VizGrid({ chosen, onPick, cover }: { chosen: string; onPick: (id: string) => void; cover: string | null }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const useArtwork = useVizStore((s) => s.vizUseArtwork)
  const palRef = useRef<RGB[]>([])
  const sections = [
    { title: 'Classic', modes: CLASSIC },
    ...(webglAvailable() ? [{ title: 'Shaders', modes: SHADERS }] : []),
  ]

  // The colors WRLD would draw in: the cover's, or the accent's with artwork colors off or unreadable.
  useEffect(() => {
    let live = true
    const accent = paletteFromAccent(parseColor(getComputedStyle(document.documentElement).getPropertyValue('--accent')))
    palRef.current = accent
    if (useArtwork && cover) {
      const era = eraAssetPath(cover)
      if (era) palRef.current = ERA_PALETTES[era] ?? accent
      else void extractPalette(smallCoverUrl(cover) ?? cover).then((p) => { if (live && p) palRef.current = p })
    }
    return () => { live = false }
  }, [cover, useArtwork])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const W = TILE_W * PIXELS, H = TILE_H * PIXELS
    const { canvas: glCanvas, renderer: gl } = sharedCanvas(W, H, (canvas) => {
      const made = new GLRenderer<HTMLCanvasElement | OffscreenCanvas>(canvas)
      return made.ok ? made : null
    })
    const tiles = [...root.querySelectorAll<HTMLDivElement>('[data-viz-mode]')].map((el) => {
      const canvas = el.querySelector('canvas')!
      const id = el.dataset.vizMode!
      const shader = SHADERS.some((v) => v.id === id)
      // A classic draws straight into its own screen; the shaders take turns on the one WebGL canvas.
      return { id, el, flat: shader ? null : new Canvas2DRenderer(canvas), screen: shader ? screenFor(canvas, glCanvas) : null, seen: false }
    })
    const sight = new IntersectionObserver((entries) => {
      for (const entry of entries) { const t = tiles.find((x) => x.el === entry.target); if (t) t.seen = entry.isIntersecting }
    }, { root })
    tiles.forEach((t) => sight.observe(t.el))

    const song = madeUpSong()
    const focus = { x: W / 2, y: H / 2, r: Math.min(W, H) * 0.17 }
    let last = 0, raf = 0
    const frame = (ms: number): void => {
      raf = requestAnimationFrame(frame)
      const now = ms / 1000
      if (now - last < 1 / 30 - 0.004) return // thirty frames a second is plenty for a preview
      const seconds = last ? Math.min(now - last, 0.1) : 0
      last = now
      song.play(seconds)
      const { audio, ripples, clock: { time, flow } } = song
      for (const t of tiles) {
        if (!t.seen) continue
        if (t.flat) {
          t.flat.render({
            mode: t.id, frame: audio, pal: palRef.current, focus, protect: [], feather: 0,
            intensity: 1, q: QUALITY.medium, time, dt: seconds, px: 0.6,
          })
          continue
        }
        // Every shader in sight builds at once, on the GPU's side, and its screen joins in once it's ready.
        if (gl?.status(t.id) !== 'ready') continue
        if (gl.render({ mode: t.id, frame: audio, pal: palRef.current, time, flow, focus, protect: [], feather: 0, intensity: 1, octaves: 4, ripples })) {
          present(glCanvas, t.screen)
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      sight.disconnect()
      gl?.dispose()
    }
  }, [])

  return (
    <div ref={rootRef} className="overflow-y-auto p-5 pt-1 min-h-0">
      {sections.map((sec) => (
        <div key={sec.title}>
          <p className="pt-2 pb-2.5 text-[11px] font-bold tracking-[0.12em] uppercase text-text-muted select-none">{sec.title}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 pb-4">
            {sec.modes.map((v) => (
              <div key={v.id} data-viz-mode={v.id} onClick={() => onPick(v.id)} className="cursor-pointer group">
                <canvas
                  width={TILE_W * PIXELS} height={TILE_H * PIXELS}
                  className={`block w-full aspect-[220/124] rounded-xl bg-[#0d0d0d] transition-shadow ${
                    chosen === v.id ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.9)]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]'
                  }`}
                />
                <div className={`flex items-center mt-2 text-[13px] font-medium ${chosen === v.id ? 'text-text-primary' : 'text-text-muted'}`}>
                  <span className="flex-1">{v.name}</span>
                  {chosen === v.id && <Check size={14} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DesktopPicker({ kind, onClose, onPicked }: {
  /** 'light': the screen-edge light round the desktop. 'overlay': WRLD's Edge light, round its visualizer. */
  kind: 'light' | 'lyrics' | 'viz' | 'overlay'
  onClose: () => void
  /** Also told the pick. */
  onPicked?: (id: string) => void
}): JSX.Element {
  const look = useStore((s) => s.desktop.light.look)
  const lyricLook = useStore((s) => s.desktop.lyrics.look)
  const setDesktop = useStore((s) => s.setDesktop)
  const vizMode = useVizStore((s) => s.vizMode)
  const overlay = useWrldEdgeLook()
  const setOverlay = useVizStore((s) => s.setVizEdgeOverlay)
  const title = { light: 'Lights', lyrics: 'Lyric styles', viz: 'Visualizers', overlay: 'Edge light' }[kind]
  const cover = useStore((s) => s.currentTrack?.imageUrl || (s.currentTrackFull?.id === s.currentTrack?.id ? s.currentTrackFull?.albumArt : null) || null)
  const colors = useAlbumColors(cover)
  // WRLD holds still underneath while this is open.
  useEffect(() => {
    const { coverViz } = useVizStore.getState()
    coverViz(true)
    return () => coverViz(false)
  }, [])

  return (
    <ModalOverlay
      onClose={onClose}
      standalone
      zIndexClassName="z-[180]"
      panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl h-[80svh]"
      minWidth={420} minHeight={360}
    >
      {() => (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-3 px-5 py-4 shrink-0">
            <h2 className="flex-1 text-text-primary text-lg font-semibold">{title}</h2>
            {kind === 'overlay' && overlay && (
              <button onClick={() => setOverlay(null)} className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] text-xs font-medium transition-colors">
                None
              </button>
            )}
            {kind === 'lyrics' && lyricLook !== 'classic' && (
              <button onClick={() => { setDesktop({ lyrics: { look: 'classic' } }); onPicked?.('classic') }} title="The plain scrolling lyrics" className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] text-xs font-medium transition-colors">
                Classic
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          {kind === 'light' || kind === 'overlay'
            ? <LightGrid
                chosen={kind === 'light' ? look : overlay ?? ''}
                colors={colors}
                onPick={(id) => { if (kind === 'light') setDesktop({ light: { look: id } }); else setOverlay(id); onPicked?.(id) }}
              />
            : kind === 'lyrics'
              ? <LyricGrid chosen={lyricLook} colors={colors} onPick={(id) => { setDesktop({ lyrics: { look: id } }); onPicked?.(id) }} />
              : <VizGrid chosen={vizMode} cover={cover} onPick={(id) => { useVizStore.getState().selectMode(id, true); onPicked?.(id) }} />}
        </div>
      )}
    </ModalOverlay>
  )
}
