import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { FRAME_MARK, isOurs, type FromFrame, type ToFrame } from '../desktop/frame'
import { DEFAULT_PLACES, fitOf, playerMetrics, playlistMetrics } from '../desktop/metrics'
import { listenToMeter } from '../desktop/meter'
import { answerDesktopRequest, runDesktopCommand, watchDesktopState, widgetMenuOf } from '../lib/desktopBridge'
import { WIDGET_TITLES, type WidgetMenuEntry } from '../desktop/widgetMenu'
import ContextMenu, { type ContextMenuEntry } from './ContextMenu'

// WRLD's Widgets layout: the desktop's player, playlist and clock (Settings > Desktop) standing in the tab instead of on
// the desktop, for the web and for anyone who'd rather keep them in the app. They're the very pages the desktop's
// windows show, each in a frame, and this answers them as the main process answers a window: it tells them the
// settings, what's playing and the music, does what they press with the app's own code, lets clicks through the
// player's clear parts, moves them when they're dragged, keeps where they were left, and shows a widget's menu when
// it's right-clicked.

type Which = 'player' | 'playlist' | 'clock'
/** Back to front. */
const WIDGETS: Which[] = ['clock', 'playlist', 'player']
/** At most this often is the meter passed on. */
const METER_MS = 16
/** The clock's size until it has measured itself. */
const CLOCK_SIZE = { width: 400, height: 420 }

/** A widget's page, beside the app's own: over file:// in the desktop build, from the site's root on the web. */
const pageUrl = (which: Which): string => new URL(`desktop/${which}.html`, document.baseURI).href

/** A widget's menu, as the app's own menu has it: each row sends its command as the widget's presses do. */
const menuItems = (entries: WidgetMenuEntry[]): ContextMenuEntry[] => entries.map((e) => e === 'divider' ? e : {
  label: e.label,
  checked: e.checked,
  disabled: e.disabled,
  children: e.children ? menuItems(e.children) : undefined,
  onSelect: e.cmd ? () => void runDesktopCommand(e.cmd!, e.arg).catch((err) => console.warn('[wrld widgets] menu command failed', e.cmd, err)) : undefined,
})

export default function WrldWidgets(): JSX.Element {
  const desktop = useStore((s) => s.desktop)
  const layerRef = useRef<HTMLDivElement>(null)
  const frames = useRef<Partial<Record<Which, HTMLIFrameElement | null>>>({})
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [clockSize, setClockSize] = useState(CLOCK_SIZE)
  /** A widget being dragged: its center in the layer, followed until it's let go. */
  const [moving, setMoving] = useState<{ which: Which; x: number; y: number } | null>(null)
  /** The player's frame takes clicks (the pointer is over something solid), and whether the pointer is over it. */
  const playerSolid = useRef(false)
  const pointerIn = useRef(false)
  /** A widget right-clicked: its menu, at that point in the tab's window. */
  const [menu, setMenu] = useState<{ which: Which; x: number; y: number } | null>(null)

  // A click in a frame doesn't reach the menu's outside-click check, but the window loses the focus to the frame.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [menu])

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const measure = (): void => setArea({ width: layer.clientWidth, height: layer.clientHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(layer)
    return () => watch.disconnect()
  }, [])

  const fit = area.width && area.height ? fitOf(area.width, area.height) : 1
  const sizeOf = (which: Which): { width: number; height: number; edge: number } => {
    if (which === 'player') return playerMetrics(desktop.player.size, fit)
    if (which === 'playlist') return playlistMetrics(desktop.playlist, fit)
    return { ...clockSize, edge: 24 }
  }
  const centerOf = (which: Which): { x: number; y: number } => {
    if (moving?.which === which) return moving
    const place = desktop[which].tabPlace
    const [fx, fy] = place ? [place.x, place.y] : which === 'playlist' ? DEFAULT_PLACES.playlist(desktop.playlist) : DEFAULT_PLACES[which]()
    return { x: area.width * fx, y: area.height * fy }
  }
  /** Where it stands: centered on its place, kept in the tab - all but its clear margin, which may hang over. */
  const frameOf = (which: Which): { left: number; top: number; width: number; height: number } => {
    const m = sizeOf(which)
    const c = centerOf(which)
    const keep = (at: number, size: number, room: number): number => Math.min(Math.max(at, -m.edge), Math.max(room - size + m.edge, -m.edge))
    return { left: Math.round(keep(c.x - m.width / 2, m.width, area.width)), top: Math.round(keep(c.y - m.height / 2, m.height, area.height)),
      width: Math.round(m.width), height: Math.round(m.height) }
  }

  // What the message handler reads fresh: it's set up once.
  const live = useRef({ desktop, fit, frameOf, area })
  live.current = { desktop, fit, frameOf, area }

  const post = (which: Which, message: ToFrame): void => {
    try {
      frames.current[which]?.contentWindow?.postMessage({ ...message, [FRAME_MARK]: true }, '*')
    } catch (e) {
      console.warn('[wrld widgets] message not sent', message.type, e)
    }
  }
  const tell = (channel: string, value: unknown, only?: Which): void => {
    for (const which of only ? [only] : WIDGETS) post(which, { type: 'event', channel, value })
  }

  // The settings, again whenever they or the tab's size change.
  useEffect(() => { tell('desktop:settings', { settings: desktop, fit }) }, [desktop, fit])

  useEffect(() => {
    let state: Record<string, unknown> = {}
    const stopState = watchDesktopState((patch) => {
      state = { ...state, ...patch }
      tell('desktop:state', patch)
    })
    // The player's glow hears the music.
    let meterAt = 0
    const stopMeter = listenToMeter((meter) => {
      const now = performance.now()
      if (now - meterAt < METER_MS) return
      meterAt = now
      tell('desktop:meter', meter, 'player')
    })

    // ---- the player's clear parts let clicks through ----
    // Its frame takes no clicks until its page, told where the pointer is, says it's over something solid; then the
    // page hears the pointer itself, and gives the clicks back once it's off the solid parts.
    const setSolid = (on: boolean): void => {
      playerSolid.current = on
      const frame = frames.current.player
      if (frame) frame.style.pointerEvents = on ? 'auto' : 'none'
    }
    const onPointer = (event: PointerEvent): void => {
      const frame = frames.current.player
      if (playerSolid.current || !frame) return
      const r = frame.getBoundingClientRect()
      const inside = event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom
      if (!inside && !pointerIn.current) return
      pointerIn.current = inside
      tell('desktop:pointer', inside ? { x: event.clientX - r.left, y: event.clientY - r.top } : null, 'player')
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    // ---- dragged ----
    let drag: { which: Which; base: { x: number; y: number }; from: { x: number; y: number } | null; at: { x: number; y: number } } | null = null
    const dropped = (): void => {
      if (!drag) return
      const { which, at } = drag
      drag = null
      const { area: a } = live.current
      const clamp = (v: number): number => Math.min(Math.max(v, 0), 1)
      if (a.width && a.height) useStore.getState().setDesktop({ [which]: { tabPlace: { x: clamp(at.x / a.width), y: clamp(at.y / a.height) } } })
      setMoving(null)
    }

    const whichOf = (source: MessageEventSource | null): Which | null => WIDGETS.find((w) => !!source && frames.current[w]?.contentWindow === source) ?? null
    const onMessage = (event: MessageEvent): void => {
      const which = whichOf(event.source)
      if (!which || !isOurs<FromFrame>(event.data)) return
      const message = event.data as FromFrame
      const { desktop: settings, fit: scale, frameOf: frameNow } = live.current
      switch (message.type) {
        case 'hello':
          post(which, { type: 'reply', id: message.id, value: { which, settings, state, fit: scale, frost: null, isClear: false, hidden: false, primary: null, where: 'tab' } })
          break
        case 'request':
          void answerDesktopRequest(message.kind, message.arg).then(
            (value) => post(which, { type: 'reply', id: message.id, value: value ?? null }),
            (e) => { console.warn('[wrld widgets] request failed', message.kind, e); post(which, { type: 'reply', id: message.id, value: null }) },
          )
          break
        case 'command':
          // No desk to clear in the tab, and the app it would open is this one.
          if (message.cmd === 'clear' || message.cmd === 'open-app') break
          void runDesktopCommand(message.cmd, message.arg).catch((e) => console.warn('[wrld widgets] command failed', message.cmd, e))
          break
        case 'solid':
          if (which === 'player') setSolid(message.on)
          break
        case 'drag': {
          if (message.phase === 'end') { dropped(); break }
          if (settings[which].locked) break
          const f = frameNow(which)
          const center = { x: f.left + f.width / 2, y: f.top + f.height / 2 }
          drag = { which, base: center, from: null, at: center }
          break
        }
        case 'drag-to': {
          if (!drag || drag.which !== which) break
          drag.from ??= { x: message.x, y: message.y }
          drag.at = { x: drag.base.x + message.x - drag.from.x, y: drag.base.y + message.y - drag.from.y }
          setMoving({ which, ...drag.at })
          break
        }
        case 'size':
          if (which === 'clock' && message.width > 0 && message.height > 0) {
            setClockSize((was) => (was.width === Math.ceil(message.width) && was.height === Math.ceil(message.height) ? was : { width: Math.ceil(message.width), height: Math.ceil(message.height) }))
          }
          break
        case 'menu': {
          const r = frames.current[which]?.getBoundingClientRect()
          if (r) setMenu({ which, x: r.left + message.x, y: r.top + message.y })
          break
        }
        case 'key': {
          // As if pressed in the app: its hotkeys (and WRLD's own keys) hear it.
          const { key, code, ctrlKey, shiftKey, altKey, metaKey } = message
          frames.current[which]?.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey, shiftKey, altKey, metaKey, bubbles: true, cancelable: true }))
          break
        }
      }
    }
    window.addEventListener('message', onMessage)

    return () => {
      stopState()
      stopMeter()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('message', onMessage)
    }
  }, [])

  return (
    <div ref={layerRef} className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
      {area.width > 0 && WIDGETS.filter((which) => desktop[which].inWrld).map((which) => {
        const f = frameOf(which)
        return (
          <iframe
            key={which}
            ref={(el) => {
              frames.current[which] = el
              // The player starts letting clicks through; its page says when the pointer is over something solid.
              if (el && which === 'player' && !el.dataset.ready) {
                el.dataset.ready = '1'
                el.style.pointerEvents = 'none'
                playerSolid.current = false
                pointerIn.current = false
              }
            }}
            src={pageUrl(which)}
            title={WIDGET_TITLES[which]}
            className="absolute border-0 bg-transparent"
            // The pages are drawn dark: a frame whose color scheme differed from its page's would get an opaque backdrop.
            style={{ left: f.left, top: f.top, width: f.width, height: f.height, colorScheme: 'dark', ...(which === 'player' ? {} : { pointerEvents: 'auto' }) }}
          />
        )
      })}
      {menu && desktop[menu.which].inWrld && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={WIDGET_TITLES[menu.which]}
          items={menuItems(widgetMenuOf(menu.which, 'tab'))}
          checkColumn="auto"
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
