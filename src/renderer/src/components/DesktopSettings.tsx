import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, Sun, Palette, MicVocal, Disc3, ListMusic, Clock, Monitor, Sparkles, Check, RotateCcw, LayoutGrid } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useVizStore, useWrldEdgeLook } from '../store/vizStore'
import { DESKTOP_DEFAULTS, type DesktopPatch, type DesktopSettings as Settings } from '../store/desktopSlice'
import { ls } from '../lib/persist'
import { LOOKS, PLACES } from '../desktop/light/looks'
import { beatOf, hsbToRgb, type HSB } from '../desktop/light/engine'
import { LYRIC_LOOKS, FACES, lyricLookOf, lyricFontFor } from '../desktop/lyrics/looks'
import { listenToMeter } from '../desktop/meter'
import { desktopApi, desktopWindowsSupported, type DesktopDisplay } from '../desktop/api'
import { lazyOverlay } from '../lib/lazyView'
import ThemedSelect from './ThemedSelect'
import { Row, Toggle } from './SettingsRow'

// Settings > Desktop: what came over from iJWA. The groups open one at a time, so the tab never grows past the
// window, and the one left open is open next time. Everything that draws outside the app window (the light round the
// screen, the widgets, clear desk, the displays) is Windows only; the light's tuning, the colors and the lyric styles
// also drive WRLD's Edge light and its lyrics on every desktop build (and off Windows, the light picked is WRLD's).

const DesktopPicker = lazyOverlay(() => import('./DesktopPicker'))

type GroupId = 'light' | 'colors' | 'lyrics' | 'player' | 'playlist' | 'clock' | 'displays'

const SELECT_CLASS = 'bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] min-w-0 max-w-[180px]'
const BUTTON_CLASS = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary hover:text-text-primary text-xs font-medium transition-colors shrink-0'

function Group({ id, open, onToggle, icon: Icon, color, title, sub, children }: {
  id: GroupId
  open: boolean
  onToggle: (id: GroupId) => void
  icon: ElementType
  color: string
  title: string
  sub: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="py-3 border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className={`flex items-center gap-2.5 w-full text-left ${open ? 'mb-1' : ''}`}
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
          <Icon size={13} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-text-primary text-sm">{title}</span>
          <p className="text-text-muted text-[11px]">{sub}</p>
        </div>
        <ChevronDown size={14} className={`text-text-muted transition-transform duration-150 shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pl-[34px]">{children}</div>}
    </div>
  )
}

/** A plain row inside a group: the label on the left, its control on the right - or under it, right-aligned, where
 *  the two don't fit side by side (WRLD's settings popup). */
function Line({ label, sub, dim, children }: { label: string; sub?: string; dim?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 transition-opacity ${dim ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="min-w-0">
        <p className="text-text-primary text-[13px] truncate">{label}</p>
        {sub && <p className="text-text-muted text-[11px]">{sub}</p>}
      </div>
      <div className="ml-auto">{children}</div>
    </div>
  )
}

/** A double-click puts it back to `reset`, its default. */
function Slider({ label, value, reset, onChange, dim, min = 0, max = 1 }: {
  label: string
  value: number
  reset: number
  onChange: (v: number) => void
  dim?: boolean
  min?: number
  max?: number
}): JSX.Element {
  return (
    <Line label={label} dim={dim}>
      <div className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(reset)}
          className="w-32 accent-[var(--accent)]"
          aria-label={label}
          title="Double-click to reset"
        />
        <span className="text-text-muted text-xs tabular-nums w-9 text-right">{Math.round(((value - min) / (max - min)) * 100)}%</span>
      </div>
    </Line>
  )
}

function Segments<T extends string | number | boolean>({ label, value, choices, onChange }: {
  label: string
  value: T
  choices: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <Line label={label}>
      <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
        {choices.map(([v, name]) => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
              v === value ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
    </Line>
  )
}

function Switch({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <Line label={label} sub={sub}>
      <Toggle on={on} onClick={() => onChange(!on)} />
    </Line>
  )
}

/** A widget's lock and its way back to where it first stood. */
function PlaceRow({ locked, onLock, onReset }: { locked: boolean; onLock: (v: boolean) => void; onReset: () => void }): JSX.Element {
  return (
    <Line label="Lock position" sub="Stays put when dragged">
      <div className="flex items-center gap-2">
        <button onClick={onReset} className={BUTTON_CLASS}><RotateCcw size={12} /> Reset position</button>
        <Toggle on={locked} onClick={() => onLock(!locked)} />
      </div>
    </Line>
  )
}

// ---- the color wheel: hue clockwise from three o'clock, saturation climbing quickly away from the white middle ----

const WHEEL = 124

function drawDisc(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const side = canvas.width, r = side / 2
  const image = g.createImageData(side, side)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const dx = x - r, dy = y - r, d = Math.hypot(dx, dy) / r
    const i = (y * side + x) * 4
    if (d > 1) { image.data[i + 3] = 0; continue }
    let hue = Math.atan2(dy, dx) / (2 * Math.PI)
    if (hue < 0) hue += 1
    const [cr, cg, cb] = hsbToRgb({ hue, saturation: Math.pow(d, 0.55), brightness: 1 })
    image.data[i] = cr * 255
    image.data[i + 1] = cg * 255
    image.data[i + 2] = cb * 255
    image.data[i + 3] = d > 0.985 ? ((1 - d) / 0.015) * 255 : 255
  }
  g.putImageData(image, 0, 0)
}

function HueWheel({ title, color, dimmed, onChange }: { title: string; color: HSB; dimmed?: boolean; onChange: (c: HSB) => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (canvasRef.current) drawDisc(canvasRef.current) }, [])
  const half = WHEEL / 2
  const angle = color.hue * 2 * Math.PI, distance = Math.pow(color.saturation, 1 / 0.55) * half
  const knob = hsbToRgb(color).map((v) => Math.round(v * 255)).join(',')

  const pick = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - box.left - box.width / 2, dy = e.clientY - box.top - box.height / 2
    let hue = Math.atan2(dy, dx) / (2 * Math.PI)
    if (hue < 0) hue += 1
    const saturation = Math.pow(Math.min(Math.hypot(dx, dy) / (box.width / 2), 1), 0.55)
    onChange({ hue, saturation, brightness: color.brightness })
  }

  return (
    <div className={`flex flex-col items-center gap-2 transition-opacity ${dimmed ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-text-muted text-[11px] font-medium">{title}</span>
      <div
        className="relative cursor-crosshair touch-none"
        style={{ width: WHEEL, height: WHEEL }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e) }}
      >
        <canvas ref={canvasRef} width={WHEEL * 2} height={WHEEL * 2} className="w-full h-full rounded-full" style={{ filter: `brightness(${color.brightness})` }} />
        <div
          className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow pointer-events-none"
          style={{ left: half + Math.cos(angle) * distance, top: half + Math.sin(angle) * distance, background: `rgb(${knob})` }}
        />
      </div>
      <div className="flex items-center gap-1.5 text-text-muted">
        <Sun size={10} />
        <input
          type="range" min={0.1} max={1} step={0.01}
          value={color.brightness}
          onChange={(e) => onChange({ ...color, brightness: Number(e.target.value) })}
          className="w-20 accent-[var(--accent)]"
          aria-label={`${title} brightness`}
        />
        <Sun size={13} />
      </div>
    </div>
  )
}

/** Fourteen bars that jump with every beat the light hears, after the sensitivity, in the light's own colors. */
function MusicMeter({ settings }: { settings: Settings['light'] }): JSX.Element {
  const barsRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef(settings)
  styleRef.current = settings
  useEffect(() => {
    let lit = 0
    let frame = 0
    const off = listenToMeter((m) => { lit = Math.max(lit, beatOf(styleRef.current, m.punch) * 14) })
    const draw = (): void => {
      frame = requestAnimationFrame(draw)
      const host = barsRef.current
      if (!host) return
      const s = styleRef.current
      const from = hsbToRgb(s.primary), to = s.twoColors ? hsbToRgb(s.secondary) : from
      const bars = host.children
      for (let i = 0; i < bars.length; i++) {
        const t = i / (bars.length - 1)
        const rgb = from.map((v, k) => Math.round((v + (to[k] - v) * t) * 255))
        ;(bars[i] as HTMLElement).style.background = i < lit ? `rgb(${rgb.join(',')})` : ''
      }
      lit *= 0.9
    }
    draw()
    return () => { cancelAnimationFrame(frame); off() }
  }, [])
  return (
    <Line label="Music" sub="Lights up with every beat Unreleased plays">
      <div ref={barsRef} className="flex gap-[3px]">
        {Array.from({ length: 14 }, (_, i) => <i key={i} className="block w-[5px] h-3.5 rounded-sm bg-[var(--surface-overlay)]" />)}
      </div>
    </Line>
  )
}

function Displays({ hidden, onChange }: { hidden: string[]; onChange: (next: string[]) => void }): JSX.Element {
  const [displays, setDisplays] = useState<DesktopDisplay[] | null>(null)
  useEffect(() => {
    let live = true
    desktopApi()?.displays().then((d) => { if (live) setDisplays(d) }).catch(() => { if (live) setDisplays([]) })
    return () => { live = false }
  }, [])
  if (!displays) return <p className="text-text-muted text-xs py-2">Looking for displays…</p>
  return (
    <div className="flex flex-col gap-1.5 py-2">
      {displays.map((d) => {
        const on = !hidden.includes(d.label)
        return (
          <button
            key={d.label}
            onClick={() => onChange(on ? [...hidden, d.label] : hidden.filter((h) => h !== d.label))}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-[13px] transition-colors ${
              on ? 'border-[var(--accent)] bg-accent/10 text-text-primary' : 'border-[var(--border)] text-text-muted hover:text-text-primary'
            }`}
          >
            <Monitor size={14} className="shrink-0" />
            <span className="flex-1 truncate">{d.label}{d.primary ? ' (main)' : ''}</span>
            {on && <Check size={14} className="text-accent shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

/** `heading` off where a tab already names it (WRLD's settings popup). */
export default function DesktopSettings({ heading = true }: { heading?: boolean }): JSX.Element {
  const { desktop, setDesktop, resetDesktopPlace } = useStore(useShallow((s) => ({
    desktop: s.desktop, setDesktop: s.setDesktop, resetDesktopPlace: s.resetDesktopPlace,
  })))
  const windows = desktopWindowsSupported()
  const [open, setOpen] = useState<GroupId | ''>(() => ls.get<GroupId | ''>('desktopSettingsGroup') ?? 'light')
  const toggle = (id: GroupId): void => {
    const next = open === id ? '' : id
    setOpen(next)
    ls.set('desktopSettingsGroup', next)
  }
  const [picker, setPicker] = useState<'light' | 'overlay' | 'lyrics' | null>(null)
  // Without the screen light (off Windows) the light chosen here is WRLD's Edge light.
  const edge = useWrldEdgeLook()
  const setEdge = useVizStore((s) => s.setVizEdgeOverlay)

  const { light, player, playlist, clock, lyrics } = desktop
  const set = (patch: DesktopPatch): void => setDesktop(patch)
  const still = light.motion === 'still'
  const lyricLook = lyricLookOf(lyrics.look)
  const face = lyricFontFor(lyrics.fonts, lyricLook.id)

  return (
    <div>
      {heading && <h3 className="text-text-primary text-lg font-bold mb-1">Desktop</h3>}
      <p className="text-text-muted text-xs mb-3">
        {windows
          ? 'Light round your screens, a player, playlist and clock on the desktop, and new lyric styles. Everything follows what Unreleased plays.'
          : 'New lyric styles and an Edge light for the WRLD tab. The light round the screen and the desktop widgets are on Windows.'}
      </p>

      {windows && (
        <Row icon={Sparkles} iconColor="#0f766e" label="Clear desk" sub="Hides every other window and the taskbar; any other app coming forward brings it all back">
          <button onClick={() => desktopApi()?.clearDesk()} className={BUTTON_CLASS}>Clear desk</button>
        </Row>
      )}

      <Group id="light" open={open === 'light'} onToggle={toggle} icon={Sun} color="#f59e0b" title={windows ? 'Light' : 'Edge light'}
        sub={windows ? 'A glow round your screens that moves with the music' : 'The light round the WRLD visualizer, and how it looks'}>
        {windows && <Switch label="Screen-edge light" sub="Shows while a song plays, fades when it stops" on={light.isOn} onChange={(isOn) => set({ light: { isOn } })} />}
        <Line label="Light" sub={windows ? 'Also WRLD\'s Edge light, when it\'s on' : undefined}>
          <div className="flex items-center gap-2">
            {windows
              ? <ThemedSelect value={light.look} onChange={(look) => set({ light: { look } })}
                  options={LOOKS.map((l) => ({ value: l.id, label: l.title }))} className={SELECT_CLASS} />
              : <ThemedSelect value={edge ?? ''} onChange={(look) => setEdge(look || null)}
                  options={[{ value: '', label: 'None' }, ...LOOKS.map((l) => ({ value: l.id, label: l.title }))]} className={SELECT_CLASS} />}
            <button onClick={() => setPicker(windows ? 'light' : 'overlay')} className={BUTTON_CLASS} title="See every light playing"><LayoutGrid size={12} /> Browse</button>
          </div>
        </Line>
        <Segments label="Place" value={light.place} choices={PLACES.map((p) => [p.id, p.title] as const)} onChange={(place) => set({ light: { place } })} />
        {windows && <Switch label="Only on the desktop" sub="Hidden while another app's window is in front" on={light.onlyOnDesktop} onChange={(onlyOnDesktop) => set({ light: { onlyOnDesktop } })} />}
        <Segments label="Animation" value={light.motion} choices={[['flow', 'Flow'], ['still', 'Still'], ['music', 'Music Sync']] as const} onChange={(motion) => set({ light: { motion } })} />
        {light.motion === 'music' && (
          <>
            <MusicMeter settings={light} />
            <Slider label="Sensitivity" value={light.sensitivity} reset={DESKTOP_DEFAULTS.light.sensitivity} onChange={(sensitivity) => set({ light: { sensitivity } })} />
            <Slider label="Reaction" value={light.reaction} reset={DESKTOP_DEFAULTS.light.reaction} onChange={(reaction) => set({ light: { reaction } })} />
            <Slider label="Smoothness" value={light.smoothness} reset={DESKTOP_DEFAULTS.light.smoothness} onChange={(smoothness) => set({ light: { smoothness } })} />
          </>
        )}
        <Slider label="Tail length" value={light.tailLength} reset={DESKTOP_DEFAULTS.light.tailLength} dim={still} onChange={(tailLength) => set({ light: { tailLength } })} />
        <Slider label="Thickness" value={light.thickness} reset={DESKTOP_DEFAULTS.light.thickness} onChange={(thickness) => set({ light: { thickness } })} />
        <Slider label="Glow" value={light.glow} reset={DESKTOP_DEFAULTS.light.glow} onChange={(glow) => set({ light: { glow } })} />
        <Slider label="Particles" value={light.particles} reset={DESKTOP_DEFAULTS.light.particles} dim={still} onChange={(particles) => set({ light: { particles } })} />
      </Group>

      <Group id="colors" open={open === 'colors'} onToggle={toggle} icon={Palette} color="#db2777" title="Colors" sub="The light's colors, or the playing cover's">
        <Segments label="Colors" value={light.twoColors} choices={[[false, '1 Color'], [true, '2 Colors']] as const} onChange={(twoColors) => set({ light: { twoColors } })} />
        <Switch label="Use artwork colors" sub="The cover's two strongest colors while a song plays" on={light.useArtworkColors} onChange={(useArtworkColors) => set({ light: { useArtworkColors } })} />
        <div className={`flex justify-center gap-8 py-3 transition-opacity ${light.useArtworkColors ? 'opacity-60' : ''}`}>
          <HueWheel title="Primary" color={light.primary} onChange={(primary) => set({ light: { primary } })} />
          <HueWheel title="Secondary" color={light.secondary} dimmed={!light.twoColors} onChange={(secondary) => set({ light: { secondary } })} />
        </div>
      </Group>

      <Group id="lyrics" open={open === 'lyrics'} onToggle={toggle} icon={MicVocal} color="#7c3aed" title="Lyric style"
        sub={windows ? 'How WRLD and the desktop player sing the lyrics' : 'How the WRLD tab sings the lyrics'}>
        <Line label="Style" sub={lyrics.look === 'classic' ? 'The scrolling list' : 'Word by word, as a lyric video'}>
          <div className="flex items-center gap-2">
            <ThemedSelect value={lyrics.look} onChange={(look) => set({ lyrics: { look } })}
              options={[{ value: 'classic', label: 'Classic' }, ...LYRIC_LOOKS.map((l) => ({ value: l.id, label: l.title }))]} className={SELECT_CLASS} />
            <button onClick={() => setPicker('lyrics')} className={BUTTON_CLASS} title="See every style playing"><LayoutGrid size={12} /> Browse</button>
          </div>
        </Line>
        {lyrics.look !== 'classic' && (
          <>
            <p className="text-text-muted text-[11px] mt-2 mb-1.5">Font for {lyricLook.title}</p>
            <div className="grid grid-cols-3 gap-1.5 pb-2">
              {FACES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => set({ lyrics: { fonts: { ...lyrics.fonts, [lyricLook.id]: f.key } } })}
                  className={`px-2 py-1.5 rounded-lg border text-text-primary truncate transition-colors ${
                    f.key === face ? 'border-[var(--accent)] bg-accent/10' : 'border-[var(--border)] hover:bg-[var(--surface-overlay)]'
                  }`}
                  style={{ font: f.css.replace('{size}', '14') }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </>
        )}
      </Group>

      {/* The widgets stand on the desktop (Windows) and in WRLD's Widgets layout (everywhere), looking the same in both. */}
      <Group id="player" open={open === 'player'} onToggle={toggle} icon={Disc3} color="#2563eb" title={windows ? 'Desktop player' : 'Player'}
        sub={windows ? 'Your queue as glass cards on the desktop or in WRLD, with a control bar' : "Your queue as glass cards in WRLD's Widgets layout, with a control bar"}>
        {windows && <Switch label="On the desktop" on={player.isOn} onChange={(isOn) => set({ player: { isOn } })} />}
        <Switch label="In WRLD" sub="In the tab's Widgets layout" on={player.inWrld} onChange={(inWrld) => set({ player: { inWrld } })} />
        <Slider label="Size" value={player.size} reset={DESKTOP_DEFAULTS.player.size} onChange={(size) => set({ player: { size } })} />
        <Slider label="Tilt" value={player.tilt} reset={DESKTOP_DEFAULTS.player.tilt} onChange={(tilt) => set({ player: { tilt } })} />
        <Slider label="Glass brightness" value={player.glassBrightness} reset={DESKTOP_DEFAULTS.player.glassBrightness} onChange={(glassBrightness) => set({ player: { glassBrightness } })} />
        <Slider label="Frost" value={player.frost} reset={DESKTOP_DEFAULTS.player.frost} onChange={(frost) => set({ player: { frost } })} />
        <Segments label="Cards each side" value={player.sideCards} choices={[[1, '1'], [2, '2'], [3, '3']] as const} onChange={(sideCards) => set({ player: { sideCards } })} />
        <Switch label="Mini player" sub="Only a capsule with the song and back, play, next" on={player.mini} onChange={(mini) => set({ player: { mini } })} />
        <Switch label="Fold the card away with lyrics" on={player.hidesLyricsCard} onChange={(hidesLyricsCard) => set({ player: { hidesLyricsCard } })} />
        <PlaceRow locked={player.locked} onLock={(locked) => set({ player: { locked } })} onReset={() => resetDesktopPlace('player')} />
      </Group>

      <Group id="playlist" open={open === 'playlist'} onToggle={toggle} icon={ListMusic} color="#059669" title={windows ? 'Desktop playlist' : 'Playlist'}
        sub="A see-through list beside the player: your queue, playlists or liked songs">
        {windows && <Switch label="On the desktop" on={playlist.isOn} onChange={(isOn) => set({ playlist: { isOn } })} />}
        <Switch label="In WRLD" sub="In the tab's Widgets layout" on={playlist.inWrld} onChange={(inWrld) => set({ playlist: { inWrld } })} />
        <Segments label="Side" value={playlist.side} choices={[['left', 'Left'], ['right', 'Right']] as const} onChange={(side) => set({ playlist: { side } })} />
        <Slider label="Tilt" value={playlist.tilt} reset={DESKTOP_DEFAULTS.playlist.tilt} onChange={(tilt) => set({ playlist: { tilt } })} />
        <Slider label="Size" value={playlist.size} reset={DESKTOP_DEFAULTS.playlist.size} onChange={(size) => set({ playlist: { size } })} />
        <Segments label="Songs shown" value={playlist.rows} choices={[[4, '4'], [6, '6'], [8, '8'], [10, '10'], [12, '12']] as const} onChange={(rows) => set({ playlist: { rows } })} />
        <PlaceRow locked={playlist.locked} onLock={(locked) => set({ playlist: { locked } })} onReset={() => resetDesktopPlace('playlist')} />
      </Group>

      <Group id="clock" open={open === 'clock'} onToggle={toggle} icon={Clock} color="#0891b2" title={windows ? 'Desktop clock' : 'Clock'}
        sub="Tall glass digits, tinted by the cover">
        {windows && <Switch label="On the desktop" on={clock.isOn} onChange={(isOn) => set({ clock: { isOn } })} />}
        <Switch label="In WRLD" sub="In the tab's Widgets layout" on={clock.inWrld} onChange={(inWrld) => set({ clock: { inWrld } })} />
        <Slider label="Size" value={clock.size} reset={DESKTOP_DEFAULTS.clock.size} onChange={(size) => set({ clock: { size } })} />
        <Slider label="Height" value={clock.stretch} reset={DESKTOP_DEFAULTS.clock.stretch} onChange={(stretch) => set({ clock: { stretch } })} />
        <Slider label="Weight" value={clock.weight} reset={DESKTOP_DEFAULTS.clock.weight} onChange={(weight) => set({ clock: { weight } })} />
        <Slider label="Glass color" value={clock.tint} reset={DESKTOP_DEFAULTS.clock.tint} onChange={(tint) => set({ clock: { tint } })} />
        <Switch label="Artwork color" sub="The glass takes the cover's color while a song plays" on={clock.useArtworkColor} onChange={(useArtworkColor) => set({ clock: { useArtworkColor } })} />
        <Switch label="Show date" on={clock.showDate} onChange={(showDate) => set({ clock: { showDate } })} />
        <PlaceRow locked={clock.locked} onLock={(locked) => set({ clock: { locked } })} onReset={() => resetDesktopPlace('clock')} />
      </Group>

      {windows && (
        <>
          <Group id="displays" open={open === 'displays'} onToggle={toggle} icon={Monitor} color="#475569" title="Displays" sub="Which screens get the light and the widgets">
            <Displays hidden={desktop.hiddenDisplays} onChange={(hiddenDisplays) => set({ hiddenDisplays })} />
          </Group>
        </>
      )}

      {picker && (
        <DesktopPicker
          kind={picker}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
