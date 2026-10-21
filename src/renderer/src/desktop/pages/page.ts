// What every desktop window's page shares: the bridge to the app (electron/desktopPreload.js, or in a frame in the
// WRLD tab, frameBridge.ts), the shapes of what it hears, and the two habits of a window on the desktop - letting
// clicks through its clear parts, and moving when its empty glass is dragged.
import { frameBridge } from './frameBridge'
import type { DesktopSettings } from '../../store/desktopSlice'
import type { AlbumColors, Meter } from '../light/engine'
import type { LyricTune, StageClock } from '../lyrics/scene'
import type { TimedLine } from '../lyrics/timing'
import type { DesktopTrack } from '../../lib/desktopBridge'
import type { WidgetPart } from '../widgetMenu'

export type { DesktopTrack }

export interface NowTrack { id: string; title: string; artist: string; album: string; duration: number; cover: string | null }

/** What's playing, as the main window tells it (lib/desktopBridge.ts). */
export interface DesktopState {
  playing?: boolean
  clock?: StageClock | null
  track?: NowTrack | null
  colors?: AlbumColors | null
  liked?: boolean
  canLike?: boolean
  volume?: number
  repeat?: 'none' | 'all' | 'one'
  shuffle?: boolean
  /** Anything in the equalizer set away from neutral: its button lights up, as the app's does. */
  eq?: boolean
  /** The song's other versions that can be played (WRLD's version notch's list), labeled by version alone. */
  versions?: { songId: number; label: string | null }[]
  fm?: boolean
  /** Whether 999 FM is on the air (null: not known yet). */
  fmLive?: boolean | null
  cards?: { from: number; current: number; items: DesktopTrack[] }
  lyrics?: { id: string; lines: TimedLine[] } | null
  /** The app's lyric size and colors, for the lyric styles that follow them. */
  lyricTune?: LyricTune
  listsVersion?: number
}

export interface Hello {
  which: string
  settings: DesktopSettings | null
  state: DesktopState
  fit: number
  frost: string | null
  isClear: boolean
  hidden: boolean
  /** The main display, whose wallpaper the frost is; none in the WRLD tab. */
  primary: Bounds | null
  /** On the desktop in a window of its own, or in the WRLD tab. */
  where?: 'desktop' | 'tab'
}

export interface Bounds { x: number; y: number; width: number; height: number }

export interface Bridge {
  hello(): Promise<Hello | null>
  on(channel: 'desktop:state', cb: (patch: DesktopState) => void): () => void
  on(channel: 'desktop:settings', cb: (value: { settings: DesktopSettings; fit: number }) => void): () => void
  on(channel: 'desktop:frost', cb: (url: string | null) => void): () => void
  on(channel: 'desktop:pointer', cb: (at: { x: number; y: number } | null) => void): () => void
  on(channel: 'desktop:clear-state', cb: (on: boolean) => void): () => void
  on(channel: 'desktop:meter', cb: (meter: Meter) => void): () => void
  on(channel: 'desktop:hidden', cb: (hidden: boolean) => void): () => void
  on(channel: 'desktop:curtain-close', cb: (look: { picture: string | null }) => void): () => void
  on(channel: 'desktop:curtain-open', cb: () => void): () => void
  on(channel: 'desktop:primary', cb: (bounds: Bounds) => void): () => void
  /** In the WRLD tab: put away (true) while the tab's closed or its old style is showing, the page kept for coming back. */
  on(channel: 'desktop:shelved', cb: (on: boolean) => void): () => void
  command(cmd: string, arg?: unknown): void
  request<T = unknown>(kind: string, arg?: unknown): Promise<T | null>
  solid(on: boolean): void
  drag(phase: 'start' | 'end'): void
  /** In the WRLD tab: where the pointer is while dragging, on the screen. A window follows the pointer itself. */
  dragTo?(x: number, y: number): void
  keys(on: boolean): void
  size(width: number, height: number): void
  curtainOpened(): void
  /** Right-clicked at this point: the widget's menu, from the app - the lyrics' own when it was on them (`part`). */
  menu?(x: number, y: number, part?: WidgetPart): void
}

export const page = (window as unknown as { desktopPage?: Bridge }).desktopPage ?? frameBridge()

/** Everything the page shows, kept up to date: the state merged patch by patch, the settings, the frost. */
export class Live {
  state: DesktopState = {}
  settings: DesktopSettings | null = null
  fit = 1
  frost: string | null = null
  isClear = false
  hidden = false
  primary: Bounds | null = null
  /** In a frame in the WRLD tab: no desk to clear, no app to open. The page's root has the in-tab class too. */
  inTab = false
  /** In the WRLD tab, put away until the widgets show again: nothing hears it, so nothing moves. */
  shelved = false
  meter: Meter = { decibels: -120, punch: 0 }
  private listeners = new Set<(what: 'state' | 'settings' | 'frost' | 'clear' | 'hidden' | 'shelved', patch?: DesktopState) => void>()

  /** Out of sight: the window's hidden, or the frame's put away. */
  get unseen(): boolean { return document.hidden || this.shelved }

  async start(): Promise<Hello | null> {
    page.on('desktop:state', (patch) => { this.state = { ...this.state, ...patch }; this.emit('state', patch) })
    page.on('desktop:settings', ({ settings, fit }) => { this.settings = settings; this.fit = fit || 1; this.emit('settings') })
    page.on('desktop:frost', (url) => { this.frost = url; this.emit('frost') })
    page.on('desktop:clear-state', (on) => { this.isClear = on; this.emit('clear') })
    page.on('desktop:hidden', (hidden) => { this.hidden = hidden; this.emit('hidden') })
    page.on('desktop:meter', (meter) => { this.meter = meter })
    page.on('desktop:primary', (bounds) => { this.primary = bounds; this.emit('frost') })
    page.on('desktop:shelved', (on) => { this.shelved = on; this.emit('shelved') })
    const hello = await page.hello()
    if (hello) {
      this.state = { ...hello.state, ...this.state }
      this.settings = hello.settings ?? this.settings
      this.fit = hello.fit || 1
      this.frost = hello.frost
      this.isClear = hello.isClear
      this.hidden = hello.hidden
      this.primary = hello.primary
      this.inTab = hello.where === 'tab'
      document.documentElement.classList.toggle('in-tab', this.inTab)
    }
    this.emit('settings')
    this.emit('state', this.state)
    return hello
  }

  on(fn: (what: 'state' | 'settings' | 'frost' | 'clear' | 'hidden' | 'shelved', patch?: DesktopState) => void): void { this.listeners.add(fn) }
  private emit(what: 'state' | 'settings' | 'frost' | 'clear' | 'hidden' | 'shelved', patch?: DesktopState): void { for (const fn of this.listeners) fn(what, patch) }
}

/** A window clear but where its widget is: clicks on the clear parts go through to the desktop. Told where the pointer
 *  is while it lets clicks through, the page answers whether that's over something solid; taking clicks, it hears the
 *  pointer itself and gives them back once it moves off the solid parts. */
export function seeThrough(isSolid: (x: number, y: number) => boolean): void {
  let solid = false
  const say = (on: boolean): void => {
    if (on === solid) return
    solid = on
    page.solid(on)
  }
  page.on('desktop:pointer', (at) => { say(Boolean(at) && isSolid(at!.x, at!.y)) })
  document.addEventListener('pointermove', (e) => { if (!e.buttons) say(isSolid(e.clientX, e.clientY)) })
  document.addEventListener('pointerleave', () => say(false))
}

/** A right-click opens the widget's menu - its settings, its place, hiding it - which the app shows: its own menu in
 *  the WRLD tab, the system's on the desktop. Not one the page answers itself (a song's menu), nor in a field.
 *  `partAt` names a part with a menu of its own at a point (the player's lyrics). */
export function menuOnRightClick(partAt?: (x: number, y: number) => WidgetPart | null): void {
  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented || (event.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
    page.menu?.(event.clientX, event.clientY, partAt?.(event.clientX, event.clientY) ?? undefined)
  })
}

let draggedAt = 0
/** A drag just ended: the click it ends with isn't a click. */
export const justDragged = (): boolean => performance.now() - draggedAt < 350

/** The window moves with the pointer when its empty glass is pressed and dragged: `from` says where a drag may begin. */
export function dragToMove(from: (target: Element) => boolean): void {
  let press: { x: number; y: number; dragging: boolean } | null = null
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element) || !from(e.target)) return
    press = { x: e.screenX, y: e.screenY, dragging: false }
  })
  document.addEventListener('pointermove', (e) => {
    if (!press || !e.buttons) return
    if (!press.dragging) {
      if (Math.hypot(e.screenX - press.x, e.screenY - press.y) <= 4) return
      press.dragging = true
      page.drag('start')
      page.dragTo?.(press.x, press.y)
    }
    // In the WRLD tab the frame is moved by the tab, told where the pointer goes.
    page.dragTo?.(e.screenX, e.screenY)
  })
  const end = (): void => {
    if (press?.dragging) { page.drag('end'); draggedAt = performance.now() }
    press = null
  }
  document.addEventListener('pointerup', end)
  document.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}

export const escapeText = (text: unknown): string => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
export const clockText = (seconds: number): string => { const whole = Math.max(0, Math.round(seconds || 0)); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` }

/** Frosted glass over the desktop: the wallpaper's copy (the main display's) laid in `el` where it lies behind it on
 *  the screen, blurred. A transparent window's glass can't blur what's behind it, so this is what it shows instead;
 *  without a wallpaper to read, the glass is a darker one of its own. Kept lined up as the window moves. */
export function frosted(el: HTMLElement, live: Live, amount: () => number): void {
  const layer = document.createElement('div')
  layer.className = 'frost-layer'
  el.prepend(layer)
  let key = ''
  const place = (): void => {
    const url = live.frost, display = live.primary
    el.classList.toggle('frosted', Boolean(url && display))
    if (!url || !display) { if (key) { key = ''; layer.style.backgroundImage = '' } return }
    const box = el.getBoundingClientRect()
    const x = display.x - (window.screenX + box.left), y = display.y - (window.screenY + box.top)
    const next = `${url}|${display.width}x${display.height}@${Math.round(x)},${Math.round(y)}|${amount()}`
    if (next === key) return
    key = next
    Object.assign(layer.style, {
      backgroundImage: `url("${url.replace(/"/g, '%22')}")`,
      backgroundSize: `${display.width}px ${display.height}px`,
      backgroundPosition: `${x}px ${y}px`,
      // From a light haze to heavy frost.
      filter: `blur(${((2 + 10 * amount()) * display.width / 640).toFixed(1)}px) saturate(1.35)`,
    })
  }
  live.on((what) => { if (what === 'frost' || what === 'settings') place() })
  window.setInterval(place, 400)
  place()
}
