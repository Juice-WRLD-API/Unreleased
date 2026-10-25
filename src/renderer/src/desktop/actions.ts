// Desktop's switches, for the hotkeys, the terminal and the tray: the light on or off, the widgets out or away, the
// desk cleared, the next light or lyric style. Each says what it did, for whoever asked to show.
import { useStore } from '../store/useStore'
import { useVizStore, wrldEdgeLook } from '../store/vizStore'
import { ls } from '../lib/persist'
import { LOOKS, lookOf } from './light/looks'
import { LYRIC_LOOKS, lyricLookOf } from './lyrics/looks'
import { desktopApi, desktopWindowsSupported } from './api'

type Widget = 'player' | 'playlist' | 'clock'
const WIDGETS: Widget[] = ['player', 'playlist', 'clock']

export function setLight(on?: boolean): string {
  const s = useStore.getState()
  const isOn = on ?? !s.desktop.light.isOn
  s.setDesktop({ light: { isOn } })
  return isOn ? 'Screen-edge light on' : 'Screen-edge light off'
}

/** All the widgets away, or those that were out last time back out (the player, the first time). */
export function setWidgets(on?: boolean): string {
  const s = useStore.getState()
  const out = WIDGETS.filter((w) => s.desktop[w].isOn)
  const show = on ?? out.length === 0
  if (!show) {
    ls.set('desktopWidgetsOut', out)
    s.setDesktop({ player: { isOn: false }, playlist: { isOn: false }, clock: { isOn: false } })
    return 'Desktop widgets away'
  }
  const saved = (ls.get<Widget[]>('desktopWidgetsOut') ?? []).filter((w) => WIDGETS.includes(w))
  const back = saved.length ? saved : (['player'] as Widget[])
  s.setDesktop({ player: { isOn: back.includes('player') }, playlist: { isOn: back.includes('playlist') }, clock: { isOn: back.includes('clock') } })
  return `Desktop ${back.join(', ')} out`
}

export function setWidget(which: Widget, on?: boolean): string {
  const s = useStore.getState()
  const isOn = on ?? !s.desktop[which].isOn
  s.setDesktop({ [which]: { isOn } })
  return `Desktop ${which} ${isOn ? 'on' : 'off'}`
}

export function clearDesk(on?: boolean): string {
  const api = desktopApi()
  if (!api) return 'Clear desk needs the desktop app on Windows'
  api.clearDesk(on)
  return on === false ? 'Everything back' : on === true ? 'Desk cleared' : 'Clear desk toggled'
}

/** A light picked: the screen light's look, or off Windows, where there's no screen light, WRLD's Edge light. */
export function pickLight(id: string): string {
  const look = lookOf(id)
  if (desktopWindowsSupported()) useStore.getState().setDesktop({ light: { look: look.id } })
  else useVizStore.getState().setVizEdgeOverlay(look.id)
  return `Light: ${look.title}`
}

/** The light after the one picked (or before it), round the list. */
export function stepLight(step = 1): string {
  const current = desktopWindowsSupported() ? useStore.getState().desktop.light.look : wrldEdgeLook()
  const at = current ? lookOf(current).number : step > 0 ? -1 : 0
  return pickLight(LOOKS[(at + step + LOOKS.length) % LOOKS.length].id)
}

/** The lyric style after the one picked, Classic among them. */
export function stepLyricStyle(step = 1): string {
  const s = useStore.getState()
  const ids = ['classic', ...LYRIC_LOOKS.map((l) => l.id)]
  const at = Math.max(ids.indexOf(s.desktop.lyrics.look), 0)
  const next = ids[(at + step + ids.length) % ids.length]
  s.setDesktop({ lyrics: { look: next } })
  return `Lyric style: ${next === 'classic' ? 'Classic' : lyricLookOf(next).title}`
}
