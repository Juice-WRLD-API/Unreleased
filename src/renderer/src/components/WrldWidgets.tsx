import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import { useCanEdit } from '../hooks/useChannelRoles'
import * as userApi from '../lib/userApi'
import type { Track } from '../types'
import { FRAME_MARK, isOurs, type FromFrame, type ToFrame } from '../desktop/frame'
import { DEFAULT_PLACES, fitOf, playerMetrics, playlistMetrics } from '../desktop/metrics'
import { listenToMeter } from '../desktop/meter'
import { SHARE_LYRICS_EVENT, answerDesktopRequest, runDesktopCommand, watchDesktopState, widgetMenuOf } from '../lib/desktopBridge'
import { WIDGET_TITLES, type WidgetMenuEntry, type WidgetPart } from '../desktop/widgetMenu'
import { setEqAnchor } from '../lib/eqAnchor'
import ContextMenu, { type ContextMenuEntry } from './ContextMenu'
import SongContextMenu from './SongContextMenu'

// WRLD's Widgets layout: the desktop's player, playlist and clock (Settings > Desktop) standing in the tab instead of on
// the desktop, for the web and for anyone who'd rather keep them in the app. They're the very pages the desktop's
// windows show, each in a frame, and this answers them as the main process answers a window: it tells them the
// settings, what's playing and the music, does what they press with the app's own code, lets clicks through the
// player's clear parts, moves them when they're dragged, keeps where they were left, and shows a widget's menu when
// it's right-clicked - or, on one of the player's cards, the app's menu for that card's song.

type Which = 'player' | 'playlist' | 'clock'
/** Back to front. */
const WIDGETS: Which[] = ['clock', 'playlist', 'player']
/** At most this often is the meter passed on. */
const METER_MS = 16
/** The clock's size until it has measured itself. */
const CLOCK_SIZE = { width: 400, height: 420 }

/** A widget's page, beside the app's own: over file:// in the desktop build, from the site's root on the web. */
const pageUrl = (which: Which): string => new URL(`desktop/${which}.html`, document.baseURI).href

// ---- the frames, kept between visits ----
// A frame taken out of the page unloads, so leaving the tab or switching to the old style used to mean every page
// loading again on the way back: a couple of seconds with no widgets. Instead the frames wait on a shelf out of sight
// and are put back with moveBefore, which moves a frame without reloading it. Where there's no moveBefore they're
// made again each time.

const canKeep = typeof Element !== 'undefined' && 'moveBefore' in Element.prototype
/** Moves a frame already in the page to the end of `parent`, its page kept. (TypeScript's DOM types lack moveBefore.) */
const moveInto = (parent: Element, frame: HTMLIFrameElement): void =>
  (parent as unknown as { moveBefore(node: Node, child: Node | null): void }).moveBefore(frame, null)
/** The frames, standing in the tab or on the shelf. */
const kept: Partial<Record<Which, HTMLIFrameElement>> = {}
/** Frames whose page said hello and was answered. One left before then would wait out its hello on the shelf and start
 *  without knowing it's in the tab, so it isn't kept. */
const greeted = new WeakSet<HTMLIFrameElement>()
/** The clock's last measure: a kept clock has no reason to say it again. */
let keptClockSize = CLOCK_SIZE
let shelf: HTMLDivElement | null = null

const postTo = (frame: HTMLIFrameElement | undefined, message: ToFrame): void => {
  try {
    frame?.contentWindow?.postMessage({ ...message, [FRAME_MARK]: true }, '*')
  } catch (e) {
    console.warn('[wrld widgets] message not sent', message.type, e)
  }
}

function makeFrame(which: Which): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.src = pageUrl(which)
  frame.title = WIDGET_TITLES[which]
  frame.className = 'absolute border-0 bg-transparent'
  // The pages are drawn dark: a frame whose color scheme differed from its page's would get an opaque backdrop.
  frame.style.colorScheme = 'dark'
  // Back to front, whatever order they're put back in.
  frame.style.zIndex = String(WIDGETS.indexOf(which))
  // The player starts letting clicks through; its page says when the pointer is over something solid.
  frame.style.pointerEvents = which === 'player' ? 'none' : 'auto'
  return frame
}

/** Put away still in the page, which a frame needs to keep its page: hidden, out of the way, and told so it rests. */
function shelve(which: Which, frame: HTMLIFrameElement): void {
  if (!shelf) {
    shelf = document.createElement('div')
    shelf.inert = true
    shelf.setAttribute('aria-hidden', 'true')
    Object.assign(shelf.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' })
    document.body.appendChild(shelf)
  }
  // The app's keys aren't left with a frame no one can see.
  if (document.activeElement === frame) frame.blur()
  // The clicks come back to the tab and the page hears the pointer's gone, so the two agree when it's put back.
  if (which === 'player') {
    frame.style.pointerEvents = 'none'
    postTo(frame, { type: 'event', channel: 'desktop:pointer', value: null })
  }
  postTo(frame, { type: 'event', channel: 'desktop:shelved', value: true })
  moveInto(shelf, frame)
}

/** A widget's menu, as the app's own menu has it: each row sends its command as the widget's presses do. */
const menuItems = (entries: WidgetMenuEntry[]): ContextMenuEntry[] => entries.map((e) => e === 'divider' ? e : {
  label: e.label,
  checked: e.checked,
  disabled: e.disabled,
  children: e.children ? menuItems(e.children) : undefined,
  onSelect: e.cmd ? () => void runDesktopCommand(e.cmd!, e.arg).catch((err) => console.warn('[wrld widgets] menu command failed', e.cmd, err)) : undefined,
})

/** A card's song, for the app's song menu: the song at that place in the queue, or the one playing (999 FM's on the
 *  air, which has no queue of ours). `place` is null for the song playing, which has no Play of its own. */
interface CardSong { track: Track; songId: number | null; place: number | null; fm: boolean; x: number; y: number }

function cardSong(place: number, id: string, x: number, y: number): CardSong | null {
  const s = useStore.getState()
  if (s.radioFmActive) {
    const r = s.radioFmNowPlaying
    const songId = r?.song_id ?? s.radioFmMatchedSong?.songId ?? null
    if (songId == null) return null
    // FM gives only the title, artist and album: a track of its own, as WRLD's ⋯ menu makes it.
    const track: Track = { id: `fm-${songId}`, path: '', title: r?.title ?? '', artist: r?.artist ?? '', album: r?.album ?? '',
      albumArtist: '', year: null, trackNumber: null, duration: 0, genre: '', hasAlbumArt: false }
    return { track, songId, place: null, fm: true, x, y }
  }
  const track = s.queue.length ? s.queue[place] : place === 0 ? s.currentTrack : null
  // The queue moved since the card was drawn.
  if (!track || track.id !== id) return null
  const playing = s.queue.length ? place === s.queueIndex : true
  return { track, songId: userApi.trackIdToSongId(track.id), place: playing ? null : place, fm: false, x, y }
}

export default function WrldWidgets(): JSX.Element {
  const desktop = useStore((s) => s.desktop)
  /** The frames stand in here, put in and taken out by hand: React renders nothing inside it. */
  const layerRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [clockSize, setClockSize] = useState(keptClockSize)
  /** A widget being dragged: its center in the layer, followed until it's let go. */
  const [moving, setMoving] = useState<{ which: Which; x: number; y: number } | null>(null)
  /** Whether the pointer is over the player's frame. */
  const pointerIn = useRef(false)
  /** A widget right-clicked: its menu, at that point in the tab's window. */
  const [menu, setMenu] = useState<{ which: Which; x: number; y: number; part?: WidgetPart } | null>(null)
  /** A card of the player's right-clicked: the app's menu for its song. */
  const [songMenu, setSongMenu] = useState<CardSong | null>(null)
  const likedTrackIds = useStore((s) => s.likedTrackIds)
  const canEdit = useCanEdit()

  // A click in a frame doesn't reach the menu's outside-click check, but the window loses the focus to the frame.
  useEffect(() => {
    if (!menu && !songMenu) return
    const close = (): void => { setMenu(null); setSongMenu(null) }
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [menu, songMenu])

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

  const post = (which: Which, message: ToFrame): void => postTo(kept[which], message)
  const tell = (channel: string, value: unknown, only?: Which): void => {
    for (const which of only ? [only] : WIDGETS) post(which, { type: 'event', channel, value })
  }

  // The frames: made, or put back from the shelf, and stood in place - every render, so a dragged one follows.
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer || !area.width) return
    for (const which of WIDGETS) {
      let frame = kept[which]
      if (!desktop[which].inWrld) {
        frame?.remove()
        delete kept[which]
        continue
      }
      if (!frame) {
        frame = kept[which] = makeFrame(which)
        layer.appendChild(frame)
      } else if (frame.parentNode !== layer) {
        moveInto(layer, frame)
        post(which, { type: 'event', channel: 'desktop:shelved', value: false })
      }
      const f = frameOf(which)
      Object.assign(frame.style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` })
    }
  })

  // Leaving: onto the shelf while the layer's still in the page, or gone where they can't be kept.
  useLayoutEffect(() => () => {
    for (const which of WIDGETS) {
      const frame = kept[which]
      if (!frame) continue
      if (canKeep && greeted.has(frame)) shelve(which, frame)
      else { frame.remove(); delete kept[which] }
    }
  }, [])

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
    // page hears the pointer itself, and gives the clicks back once it's off the solid parts. Which of the two it is
    // stays with the frame, kept or not.
    const setSolid = (on: boolean): void => {
      const frame = kept.player
      if (frame) frame.style.pointerEvents = on ? 'auto' : 'none'
    }
    const onPointer = (event: PointerEvent): void => {
      const frame = kept.player
      if (!frame || frame.style.pointerEvents !== 'none') return
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

    const whichOf = (source: MessageEventSource | null): Which | null => WIDGETS.find((w) => !!source && kept[w]?.contentWindow === source) ?? null
    const onMessage = (event: MessageEvent): void => {
      const which = whichOf(event.source)
      if (!which || !isOurs<FromFrame>(event.data)) return
      const message = event.data as FromFrame
      const { desktop: settings, fit: scale, frameOf: frameNow } = live.current
      switch (message.type) {
        case 'hello':
          post(which, { type: 'reply', id: message.id, value: { which, settings, state, fit: scale, frost: null, isClear: false, hidden: false, primary: null, where: 'tab' } })
          greeted.add(kept[which]!)
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
          // The app's own equalizer, over the tab, beside the button pressed.
          if (message.cmd === 'equalizer') {
            const r = kept[which]?.getBoundingClientRect()
            const b = message.arg as { x?: number; y?: number; width?: number; height?: number } | null
            if (r && b && [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(v))) {
              const at = new DOMRect(r.left + b.x!, r.top + b.y!, b.width, b.height)
              setEqAnchor({ isConnected: true, getBoundingClientRect: () => at })
            }
            useStore.getState().toggleEqPanel()
            break
          }
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
            const size = { width: Math.ceil(message.width), height: Math.ceil(message.height) }
            if (size.width !== keptClockSize.width || size.height !== keptClockSize.height) {
              keptClockSize = size
              setClockSize(size)
            }
          }
          break
        case 'menu': {
          const r = kept[which]?.getBoundingClientRect()
          if (r) { setSongMenu(null); setMenu({ which, x: r.left + message.x, y: r.top + message.y, part: message.part === 'lyrics' ? 'lyrics' : undefined }) }
          break
        }
        case 'song-menu': {
          const r = kept[which]?.getBoundingClientRect()
          const song = r && which === 'player' && Number.isInteger(message.place) ? cardSong(message.place, message.id, r.left + message.x, r.top + message.y) : null
          setMenu(null)
          setSongMenu(song)
          break
        }
        case 'key': {
          // As if pressed in the app: its hotkeys (and WRLD's own keys) hear it.
          const { key, code, ctrlKey, shiftKey, altKey, metaKey } = message
          kept[which]?.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey, shiftKey, altKey, metaKey, bubbles: true, cancelable: true }))
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
      {/* The menu draws itself over the window, so nothing of React's is in here beside the frames. */}
      {menu && desktop[menu.which].inWrld && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.part === 'lyrics' ? 'Lyrics' : WIDGET_TITLES[menu.which]}
          items={menuItems(widgetMenuOf(menu.which, 'tab', false, menu.part))}
          checkColumn="auto"
          onClose={() => setMenu(null)}
        />
      )}
      {songMenu && desktop.player.inWrld && createPortal(
        <SongContextMenu
          state={{ track: songMenu.track, songId: songMenu.songId, x: songMenu.x, y: songMenu.y }}
          onClose={() => setSongMenu(null)}
          canEdit={canEdit}
          onInfo={() => { if (songMenu.songId != null) useStore.getState().setInfoSongId(songMenu.songId) }}
          // A card of the queue plays where it is in it; the song playing and 999 FM's have no Play.
          onPlay={songMenu.place != null ? () => void runDesktopCommand('jump', songMenu.place) : undefined}
          onPlayNext={songMenu.fm ? undefined : () => useStore.getState().playNext(songMenu.track)}
          onAddToQueue={songMenu.fm ? undefined : () => useStore.getState().addToQueue(songMenu.track)}
          liked={likedTrackIds.includes(songMenu.fm ? `jw-${songMenu.songId}` : songMenu.track.id)}
          onToggleLike={() => useStore.getState().toggleLike(songMenu.fm ? `jw-${songMenu.songId}` : songMenu.track.id)}
          disableChangeVersion={songMenu.fm}
          onShareLyrics={songMenu.place == null ? () => window.dispatchEvent(new Event(SHARE_LYRICS_EVENT)) : undefined}
        />,
        document.body,
      )}
    </div>
  )
}
