import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronLeft, ChevronRight, TextQuote, ListMusic, AudioLines, Minimize2, Maximize2, Radio, Settings2 } from 'lucide-react'
import { Visualizer, VISUALIZERS, type VizLayout } from '../lib/viz'
import { getAnalysisTap, resumeEffectsContext } from '../lib/audioEffects'
import { smallCoverUrl, JWAPI_HOST } from '../lib/juicewrldApi'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { eventToCombo } from '../lib/hotkeys'
import { hasEscapeLayer, useEscapeToClose } from '../hooks/useEscapeToClose'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import VizControls from './VizControls'
import LyricsControls from './LyricsControls'

// Audio-reactive backdrop for the WRLD tab, plus its toolbar, keys and (in
// fullscreen) the visualizer-only caption. WRLD only mounts while its tab is
// open, so the engine never renders off-screen.

const IDLE_MS = 2600
const OSD_MS = 1400

const vizName = (id: string): string => VISUALIZERS.find((v) => v.id === id)?.name ?? id

function rectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

// First match that's actually laid out. WRLD mounts a phone layout and a desktop
// layout side by side and hides one with CSS, so a plain querySelector can land
// on the hidden copy and report no rect at all.
function visibleRect(root: ParentNode, selector: string): DOMRect | null {
  for (const el of root.querySelectorAll(selector)) {
    const r = rectOf(el)
    if (r) return r
  }
  return null
}

const toRect = (r: DOMRect, strength: number): VizLayout['protect'][number] =>
  ({ x: r.left, y: r.top, w: r.width, h: r.height, strength })

// The /assets/ path when `url` is one of the API site's era images - the cover
// of every tracker song without art of its own. Those are served with no CORS
// header, so sampling one in the browser can only fail (loudly: a blocked-
// request error on every fullscreen entry, see coverImage.ts). Their palettes
// are baked ahead of time instead, in eraPalettes.ts.
function eraAssetPath(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    const apiHost = hostname === JWAPI_HOST || hostname.endsWith(`.${JWAPI_HOST}`)
    return apiHost && pathname.startsWith('/assets/') ? pathname : null
  } catch {
    return null
  }
}

// Polled by the engine ~10x/s. Circular modes orbit the cover, and every mode
// backs off around text, hardest on the lyric being sung. Elements opt in with
// data-viz attributes inside the fullscreen root, so the layout is described
// where it's rendered instead of being threaded through as refs.
function readLayout(root: HTMLElement | null, minimal: boolean): VizLayout {
  if (!root) return { focus: null, protect: [], intensity: 1 }
  if (minimal) {
    const cap = visibleRect(root, '[data-viz="caption"]')
    return { focus: null, protect: cap ? [toRect(cap, 0.55)] : [], intensity: 1 }
  }

  const cover = visibleRect(root, '[data-viz="cover"]')
  const focus = cover
    // Half the diagonal, so orbiting modes clear the cover's corners.
    ? { x: cover.left + cover.width / 2, y: cover.top + cover.height / 2, r: Math.hypot(cover.width, cover.height) / 2 }
    : null

  const protect: VizLayout['protect'] = []
  const meta = Array.from(root.querySelectorAll('[data-viz="meta"]'), rectOf).filter((r): r is DOMRect => r !== null)
  if (meta.length) {
    const x0 = Math.min(...meta.map((r) => r.left))
    const y0 = Math.min(...meta.map((r) => r.top))
    const x1 = Math.max(...meta.map((r) => r.right))
    const y1 = Math.max(...meta.map((r) => r.bottom))
    protect.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, strength: 0.7 })
  }
  const panel = visibleRect(root, '[data-viz="panel"]')
  if (panel) protect.push(toRect(panel, 0.4))
  const line = panel ? visibleRect(root, '[data-viz-active]') : null
  if (line) protect.push(toRect(line, 0.9))

  return { focus, protect, intensity: panel ? 0.85 : 0.95 }
}

interface Props {
  /** WRLD's page root: scopes layout lookups and carries the idle state. */
  rootRef: React.RefObject<HTMLDivElement>
  /** Cursor hiding, the chrome fade, the hotkeys and exit exist only in fullscreen. */
  fullscreen: boolean
  artUrl: string | null
  title: string
  artist: string
  /** Changes once per track; drives auto-switch. */
  trackKey: string | null
  albumKey: string | null
  /** Whether the current track has lyrics at all - words the lyrics-toggle label. */
  hasLyrics: boolean
  /** The page's own art-derived text colours, so the caption matches it. */
  txtPri: string
  txtSec: string
  /** 999 FM toggle, shown in the toolbar. */
  fm: { active: boolean; live: boolean; label: string; disabled: boolean; toggle: () => void
    /** Which panel the FM column shows. */
    tab: 'radio' | 'lyrics'; setTab: (t: 'radio' | 'lyrics') => void }
  onEnter: () => void
  onExit: () => void
}

export default function WrldVisualizer({
  rootRef, fullscreen, artUrl, title, artist, trackKey, albumKey, hasLyrics, txtPri, txtSec, fm, onEnter, onExit,
}: Props): JSX.Element {
  const isPlaying = useStore((s) => s.isPlaying)
  const lyricsOverride = useStore((s) => s.lyricsOverride)
  const { activeMode, vizQuality, vizUseArtwork, vizBoost, immMinimal, immCaptionPos } = useVizStore(useShallow((s) => ({
    activeMode: s.activeMode,
    vizQuality: s.vizQuality,
    vizUseArtwork: s.vizUseArtwork,
    vizBoost: s.vizBoost,
    immMinimal: s.immMinimal,
    immCaptionPos: s.immCaptionPos,
  })))

  const hostRef = useRef<HTMLDivElement>(null)
  const vizRef = useRef<Visualizer | null>(null)
  const [glSupported, setGlSupported] = useState(true)
  // The layout provider outlives any one render, so it reads through a ref.
  const minimal = immMinimal
  // "Off" tears the engine down entirely - no canvases, audio tap or frame loop.
  const off = activeMode === 'none'
  const [showSettings, setShowSettings] = useState(false)
  useEscapeToClose(() => setShowSettings(false), showSettings)
  const minimalRef = useRef(minimal)
  minimalRef.current = minimal

  // ── Engine lifetime ────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host || off) return
    // React owns only the host div. If a lost GL context never comes back the
    // engine swaps its canvas for a fresh clone, and doing that to a
    // React-managed node would pull it out from under the reconciler.
    const canvas = (): HTMLCanvasElement => {
      const c = document.createElement('canvas')
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
      host.appendChild(c)
      return c
    }
    const viz = new Visualizer(canvas(), canvas())
    viz.setLayoutProvider(() => readLayout(rootRef.current, minimalRef.current))
    vizRef.current = viz
    setGlSupported(viz.glSupported)
    // A saved shader mode can't run without WebGL: the engine would quietly draw
    // Aurora while the toolbar kept the shader's name. Show what's actually
    // drawn - unsaved, so the same choice still works where WebGL does.
    if (!viz.glSupported) {
      const { activeMode: cur, selectMode } = useVizStore.getState()
      if (VISUALIZERS.find((v) => v.id === cur)?.engine === 'gl') selectMode('aurora', false)
    }
    // Entering fullscreen is a click, which is the one moment a suspended
    // context is allowed to resume.
    resumeEffectsContext()
    const tap = getAnalysisTap()
    if (tap) viz.enableAudioNode(tap.ctx, tap.node)
    return () => {
      viz.dispose()
      vizRef.current = null
      host.replaceChildren()
    }
  }, [rootRef, off])

  useEffect(() => { vizRef.current?.setQuality(vizQuality) }, [vizQuality, off])
  useEffect(() => { vizRef.current?.setBoost(vizBoost) }, [vizBoost, off])
  useEffect(() => { vizRef.current?.setUsePalette(vizUseArtwork) }, [vizUseArtwork, off])
  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    const era = artUrl ? eraAssetPath(artUrl) : null
    // An era image the bake hasn't seen yet gets the accent colours.
    if (era) viz.setArtworkPalette(ERA_PALETTES[era] ?? null)
    // Sampled at 48px, so the degraded cover is all it needs.
    else void viz.setArtwork(artUrl ? (smallCoverUrl(artUrl) ?? artUrl) : '')
  }, [artUrl, off])

  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    viz.setPlaying(isPlaying)
    // The graph is built when the player first attaches its elements; pick it
    // up here in case this mounted before that happened.
    if (!viz.audioActive) {
      const tap = getAnalysisTap()
      if (tap) viz.enableAudioNode(tap.ctx, tap.node)
    }
  }, [isPlaying, off])

  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    viz.setMode(activeMode)
    if (activeMode === 'none') {
      viz.stop()
      return
    }
    viz.syncAccent()
    viz.start()
  }, [activeMode, off])

  // --accent is written to <html>'s inline style by several paths (accent
  // picker, skins, the chat /theme command), so follow the style itself rather
  // than guessing which store fields feed it.
  useEffect(() => {
    const mo = new MutationObserver(() => vizRef.current?.syncAccent())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => mo.disconnect()
  }, [])

  // ── On-screen label ────────────────────────────────────────────────────────
  const [osd, setOsd] = useState({ text: '', show: false })
  const osdTimer = useRef(0)
  const announce = useCallback((text: string): void => {
    setOsd({ text, show: true })
    window.clearTimeout(osdTimer.current)
    osdTimer.current = window.setTimeout(() => setOsd((o) => ({ ...o, show: false })), OSD_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(osdTimer.current), [])

  // ── Idle: toolbar and cursor fade when the mouse rests ─────────────────────
  const [idle, setIdle] = useState(false)
  const overToolbar = useRef(false)
  const idleTimer = useRef(0)
  const wake = useCallback((): void => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (!overToolbar.current) setIdle(true)
    }, IDLE_MS)
  }, [])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.addEventListener('mousemove', wake)
    wake()
    return () => {
      root.removeEventListener('mousemove', wake)
      window.clearTimeout(idleTimer.current)
      root.removeAttribute('data-viz-idle')
    }
  }, [rootRef, wake])
  // On the root rather than in state here, so the cursor and WRLD's own
  // chrome can fade with the toolbar without WRLD re-rendering.
  // Cursor hiding and the chrome fade are fullscreen-only; on the tab only the toolbar fades.
  useEffect(() => { rootRef.current?.toggleAttribute('data-viz-idle', idle && fullscreen) }, [rootRef, idle, fullscreen])

  // ── Actions ────────────────────────────────────────────────────────────────
  // Everything the keys can reach reads the stores fresh, since the key
  // listener is registered once.
  const glRef = useRef(glSupported)
  glRef.current = glSupported
  const usableModes = (): string[] =>
    VISUALIZERS.filter((v) => v.id !== 'none' && (v.engine !== 'gl' || glRef.current)).map((v) => v.id)

  const cycle = useCallback((dir: 1 | -1): void => {
    // Unlike auto-switch, the arrows also stop on "Off".
    const ids = VISUALIZERS.filter((v) => v.engine !== 'gl' || glRef.current).map((v) => v.id)
    const { activeMode: cur, selectMode } = useVizStore.getState()
    let i = ids.indexOf(cur)
    if (i < 0) i = dir > 0 ? -1 : 0
    const next = ids[(i + dir + ids.length) % ids.length]
    selectMode(next, true)
    announce(vizName(next))
  }, [announce])

  const toggleMinimal = useCallback((): void => {
    const { immMinimal: cur, setImmMinimal } = useVizStore.getState()
    setImmMinimal(!cur)
    announce(cur ? 'Player' : 'Visualizer only')
  }, [announce])

  // Lyrics are toggled by the app's own "Toggle lyrics" hotkey as well as the
  // toolbar, so the state follows the stores rather than the button. The button
  // cycles off -> lyrics -> queue, or off -> radio -> lyrics during FM.
  const showQueue = useStore((s) => s.showQueue)
  const lyricsVisible = fm.active ? !lyricsOverride : hasLyrics !== lyricsOverride
  const panel: 'off' | 'lyrics' | 'queue' | 'radio' = fm.active
    ? (lyricsVisible ? fm.tab : 'off')
    : showQueue ? 'queue' : lyricsVisible ? 'lyrics' : 'off'

  const toggleLyrics = (): void => {
    const s = useStore.getState()
    if (fm.active) {
      if (panel === 'off') { fm.setTab('radio'); s.setLyricsOverride(false) }
      else if (panel === 'radio') fm.setTab('lyrics')
      else s.setLyricsOverride(true)
      return
    }
    // Lyrics show when hasLyrics !== override, so these pick the override that
    // hides or shows them for the current track.
    if (panel === 'off') { s.setShowQueue(false); s.setLyricsOverride(!hasLyrics) }
    else if (panel === 'lyrics') s.setShowQueue(true)
    else { s.setShowQueue(false); s.setLyricsOverride(hasLyrics) }
  }

  const seenPanel = useRef(panel)
  useEffect(() => {
    if (seenPanel.current === panel) return
    seenPanel.current = panel
    announce(panel === 'queue' ? 'Queue' : panel === 'radio' ? 'Radio' : panel === 'lyrics' ? 'Lyrics' : 'Panel off')
  }, [panel, announce])
  // ←/→ and V. Capture phase so these run before the Player's document-level
  // hotkeys and stop them for the keys handled here; anything else (Space,
  // L to like, the lyrics toggle) falls through to the app as usual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // A dialog or menu open over the fullscreen view owns the keyboard.
      if (hasEscapeLayer()) return
      const combo = eventToCombo(e)
      if (!fullscreen) return
      if (combo === 'ArrowLeft') cycle(-1)
      else if (combo === 'ArrowRight') cycle(1)
      else if (combo === 'V') toggleMinimal()
      else return
      e.preventDefault()
      e.stopPropagation()
      wake()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cycle, toggleMinimal, wake, fullscreen])

  // ── Auto-switch: a random mode per track or album, never saved ─────────────
  const prevTrack = useRef<string | null>(null)
  const prevAlbum = useRef<string | null>(null)
  useEffect(() => {
    const first = prevTrack.current === null
    const trackChanged = trackKey !== prevTrack.current
    const albumChanged = albumKey !== prevAlbum.current
    prevTrack.current = trackKey
    prevAlbum.current = albumKey
    if (first || !trackChanged || !trackKey) return
    const { vizCycle, activeMode: cur, selectMode } = useVizStore.getState()
    if (vizCycle === 'off' || cur === 'none') return
    if (vizCycle === 'album' && !albumChanged) return
    const ids = usableModes().filter((id) => id !== cur)
    if (!ids.length) return
    const next = ids[Math.floor(Math.random() * ids.length)]
    selectMode(next, false)
    announce(vizName(next))
  }, [trackKey, albumKey, announce])

  const tool = 'w-9 h-9 flex items-center justify-center rounded-[10px] transition-colors disabled:opacity-30 disabled:pointer-events-none'
  const toolIdle = 'text-white/60 hover:text-white hover:bg-white/10'
  const toolOn = 'text-[var(--accent)] bg-[rgb(var(--accent-rgb)/0.16)]'
  const corner: Record<typeof immCaptionPos, string> = {
    bl: 'left-0 bottom-0',
    br: 'right-0 bottom-0 text-right',
    tl: 'left-0 top-0',
    tr: 'right-0 top-0 text-right',
  }
  const shadow = '0 2px 40px rgba(0,0,0,0.5)'

  return (
    <>
      {/* Above WRLD's blurred-art background, beneath its content. */}
      <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden />

      <div
        className={`absolute top-4 right-4 z-40 flex items-center gap-0.5 p-[5px] rounded-[14px] bg-black/40 backdrop-blur-xl border border-white/10 transition-[opacity,transform] duration-300 ${
          idle && !showSettings ? 'opacity-0 -translate-y-1.5 pointer-events-none' : ''
        }`}
        onMouseEnter={() => { overToolbar.current = true }}
        onMouseLeave={() => { overToolbar.current = false; wake() }}
      >
        <button
          className={`h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[11px] font-bold tracking-[0.1em] uppercase transition-colors disabled:opacity-30 disabled:pointer-events-none ${fm.active ? (fm.live ? 'text-red-400 bg-red-500/15' : toolOn) : toolIdle}`}
          onClick={fm.toggle}
          disabled={fm.disabled}
          title={fm.active ? 'Turn off 999 FM' : 'Turn on 999 FM'}
          aria-label={fm.active ? 'Turn off 999 FM' : 'Turn on 999 FM'}
          aria-pressed={fm.active}
        >
          <Radio size={15} className={fm.active && fm.live ? 'animate-pulse' : ''} />
          <span>{fm.label}</span>
        </button>
        <span className="w-px h-5 mx-1 bg-white/10" />
        <button className={`${tool} ${toolIdle}`} onClick={() => cycle(-1)} title="Previous visualizer (←)" aria-label="Previous visualizer">
          <ChevronLeft size={19} />
        </button>
        <span className="min-w-[74px] text-center text-[11px] font-bold tracking-[0.1em] uppercase text-white/90 select-none" aria-live="polite">
          {vizName(activeMode)}
        </span>
        <button className={`${tool} ${toolIdle}`} onClick={() => cycle(1)} title="Next visualizer (→)" aria-label="Next visualizer">
          <ChevronRight size={19} />
        </button>
        <span className="w-px h-5 mx-1 bg-white/10" />
        <button
          className={`${tool} ${panel !== 'off' && !minimal ? toolOn : toolIdle}`}
          onClick={toggleLyrics}
          title={fm.active ? "Cycle: off / radio / lyrics" : "Cycle: off / lyrics / queue"}
          aria-label="Toggle lyrics"
          aria-pressed={panel !== 'off'}
          disabled={minimal}
        >
          {panel === 'queue' ? <ListMusic size={18} /> : panel === 'radio' ? <Radio size={18} /> : <TextQuote size={18} />}
        </button>
        <button
          className={`${tool} ${immMinimal ? toolOn : toolIdle}`}
          onClick={toggleMinimal}
          title={fullscreen ? 'Visualizer only (V)' : 'Visualizer only'}
          aria-label="Visualizer only"
          aria-pressed={immMinimal}
        >
          <AudioLines size={18} />
        </button>
        <button
          className={`${tool} ${showSettings ? toolOn : toolIdle}`}
          onClick={() => setShowSettings((v) => !v)}
          title="Visualizer settings"
          aria-label="Visualizer settings"
          aria-expanded={showSettings}
        >
          <Settings2 size={17} />
        </button>
        {fullscreen && (
          <>
            <span className="w-px h-5 mx-1 bg-white/10" />
            <button className={`${tool} ${toolIdle}`} onClick={onExit} title="Exit fullscreen (Esc)" aria-label="Exit fullscreen">
              <Minimize2 size={17} />
            </button>
          </>
        )}
        {!fullscreen && (
          <>
            <span className="w-px h-5 mx-1 bg-white/10" />
            <button className={`${tool} ${toolIdle}`} onClick={onEnter} title="Fullscreen" aria-label="Fullscreen">
              <Maximize2 size={16} />
            </button>
          </>
        )}
        {showSettings && (
          <div
            className="absolute top-full right-0 mt-2 w-[380px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto p-4 rounded-[14px] bg-[var(--surface)] border border-[var(--border)] shadow-2xl"
          >
            <VizControls />
            <p className="mt-4 mb-3 pt-4 border-t border-[var(--border)] text-text-secondary text-xs font-semibold">Lyrics</p>
            <LyricsControls />
          </div>
        )}
      </div>

      {minimal && (
        <div
          data-viz="caption"
          className={`absolute z-20 max-w-[46vw] px-[4.5vw] py-[6vh] select-none pointer-events-none ${corner[immCaptionPos]}`}
          // Clear the toolbar, which sits in the top-right corner.
          style={immCaptionPos === 'tr' ? { paddingTop: 'max(6vh, 92px)' } : undefined}
        >
          <p className="font-extrabold leading-[1.04] tracking-[-0.025em]" style={{ fontSize: 'clamp(30px, 4.4vw, 72px)', color: txtPri, textShadow: shadow }}>
            {title}
          </p>
          {artist && (
            <p className="mt-[0.55em] font-semibold" style={{ fontSize: 'clamp(15px, 1.6vw, 26px)', color: txtSec, textShadow: shadow }}>
              {artist}
            </p>
          )}
        </div>
      )}

      <div
        className={`absolute left-1/2 bottom-[7vh] z-40 px-[18px] py-[9px] rounded-[20px] bg-black/45 backdrop-blur-lg text-white text-xs font-bold tracking-[0.12em] uppercase pointer-events-none transition-[opacity,transform] duration-300 ${
          osd.show ? 'opacity-100 -translate-x-1/2 translate-y-0' : 'opacity-0 -translate-x-1/2 translate-y-2'
        }`}
        role="status"
      >
        {osd.text}
      </div>
    </>
  )
}
