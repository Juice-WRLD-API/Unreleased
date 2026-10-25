// What a right-click on a widget offers - its own settings, its place, hiding it and showing the others; on the
// player's lyrics, what's theirs: copying them, their style - as plain
// data, so the one list serves both: the app's own menu over the WRLD tab (components/WrldWidgets.tsx), and the
// system's menu over a window on the desktop (electron/desktop, which asks the main window for it). Picking a row
// sends its command as a widget's press does (lib/desktopBridge's runDesktopCommand; 'clear' is the main process's).
import { DESKTOP_DEFAULTS, type DesktopSettings, type PlaylistSource } from '../store/desktopSlice'
import { LYRIC_LOOKS } from './lyrics/looks'

export type WidgetWhich = 'player' | 'playlist' | 'clock'
/** A part of a widget with a menu of its own: the player's lyrics. */
export type WidgetPart = 'lyrics'

export interface WidgetMenuItem {
  label: string
  /** A toggle (true or false), or the one picked of a choice. */
  checked?: boolean
  /** One of a choice rather than a toggle. */
  radio?: boolean
  disabled?: boolean
  cmd?: string
  arg?: unknown
  children?: WidgetMenuEntry[]
}
export type WidgetMenuEntry = WidgetMenuItem | 'divider'

export interface WidgetMenuContext {
  /** Right-clicked on the desktop, or in the WRLD tab. */
  where: 'desktop' | 'tab'
  /** The widgets can go out on the desktop (Windows). */
  desktopToo: boolean
  /** The desk is cleared just now. */
  isClear?: boolean
  /** What the playlist can show besides the queue and liked songs. */
  playlists: { id: string; name: string }[]
  /** Right-clicked on this part of the widget. */
  part?: WidgetPart
  /** The song playing has lyrics, and whether they're timed (LRC). */
  lyrics?: { has: boolean; timed: boolean }
}

export const WIDGET_TITLES: Record<WidgetWhich, string> = { player: 'Player', playlist: 'Playlist', clock: 'Clock' }

/** The size slider's stops a menu offers, Medium being the widget's own default; a size between them ticks none. */
const sizes = (which: WidgetWhich): [number, string][] =>
  [[0, 'Smallest'], [0.2, 'Small'], [DESKTOP_DEFAULTS[which].size, 'Medium'], [0.75, 'Large'], [1, 'Largest']]

export function widgetMenu(which: WidgetWhich, desktop: DesktopSettings, ctx: WidgetMenuContext): WidgetMenuEntry[] {
  const set = (patch: Record<string, unknown>): Pick<WidgetMenuItem, 'cmd' | 'arg'> => ({ cmd: 'set', arg: { [which]: patch } })
  const toggle = (label: string, key: string, on: boolean): WidgetMenuItem => ({ label, checked: on, ...set({ [key]: !on }) })
  const choice = <T>(label: string, key: string, now: T, options: [T, string][]): WidgetMenuItem => ({
    label,
    children: options.map(([value, name]) => ({ label: name, radio: true, checked: value === now, ...set({ [key]: value }) })),
  })
  const style = desktop[which]
  const size: WidgetMenuItem = {
    label: 'Size',
    children: sizes(which).map(([value, name]) => ({ label: name, radio: true, checked: Math.abs(style.size - value) < 0.02, ...set({ size: value }) })),
  }

  const own: WidgetMenuEntry[] = []
  if (which === 'player' && ctx.part === 'lyrics') {
    const p = desktop.player
    // The widget sings the app's style, or the fisheye where the app has its plain list.
    const look = desktop.lyrics.look !== 'classic' ? desktop.lyrics.look : 'fisheye'
    own.push(
      { label: 'Copy lyrics', cmd: 'copy-lyrics', disabled: !ctx.lyrics?.has },
      // The share card is WRLD's own modal, so only the tab can open it.
      ...(ctx.where === 'tab' && ctx.lyrics?.has ? [{ label: 'Share lyrics', cmd: 'share-lyrics' }] : []),
      ...(ctx.lyrics?.timed ? [{ label: 'Download synced lyrics', cmd: 'download-lyrics' }] : []),
      'divider',
      { label: 'Style', children: LYRIC_LOOKS.map((l) => ({ label: l.title, radio: true, checked: l.id === look, cmd: 'set', arg: { lyrics: { look: l.id } } })) },
      toggle('Fold the card away with lyrics', 'hidesLyricsCard', p.hidesLyricsCard),
      { label: 'Hide lyrics', ...set({ lyricsOpen: false }) },
    )
  } else if (which === 'player') {
    const p = desktop.player
    own.push(
      toggle('Mini player', 'mini', p.mini),
      toggle('Lyrics', 'lyricsOpen', p.lyricsOpen),
      toggle('Fold the card away with lyrics', 'hidesLyricsCard', p.hidesLyricsCard),
      choice('Cards each side', 'sideCards', p.sideCards, [[1, '1'], [2, '2'], [3, '3']]),
    )
  } else if (which === 'playlist') {
    const p = desktop.playlist
    const sources: [PlaylistSource, string][] = [['queue', 'Queue'], ['liked', 'Liked Songs'],
      ...ctx.playlists.map(({ id, name }): [PlaylistSource, string] => [`playlist:${id}`, name])]
    own.push(
      choice('Show', 'source', p.source, sources),
      choice('Side', 'side', p.side, [['left', 'Left'], ['right', 'Right']]),
      choice('Songs shown', 'rows', p.rows, [[4, '4'], [6, '6'], [8, '8'], [10, '10'], [12, '12']]),
    )
  } else {
    const c = desktop.clock
    own.push(toggle('Show date', 'showDate', c.showDate), toggle('Artwork color', 'useArtworkColor', c.useArtworkColor))
  }
  own.push(size)

  // Showing and hiding is of this place: the desktop's widgets on the desktop, WRLD's in the tab.
  const onDesktop = ctx.where === 'desktop'
  const shownKey = onDesktop ? 'isOn' : 'inWrld'
  const widgets: WidgetMenuItem = {
    label: 'Widgets',
    children: (['player', 'playlist', 'clock'] as const).map((w) => {
      const on = desktop[w][shownKey]
      return { label: WIDGET_TITLES[w], checked: on, cmd: 'set', arg: { [w]: { [shownKey]: !on } } }
    }),
  }
  const elsewhere: WidgetMenuItem | null = onDesktop
    ? toggle('Also in WRLD', 'inWrld', style.inWrld)
    : ctx.desktopToo ? toggle('Also on the desktop', 'isOn', style.isOn) : null

  return [
    ...own,
    'divider',
    toggle('Lock position', 'locked', style.locked),
    { label: 'Reset position', ...set(onDesktop ? { place: null } : { tabPlace: null }) },
    'divider',
    { label: onDesktop ? `Hide ${WIDGET_TITLES[which].toLowerCase()} from the desktop` : `Hide ${WIDGET_TITLES[which].toLowerCase()} from WRLD`, ...set({ [shownKey]: false }) },
    widgets,
    ...(elsewhere ? [elsewhere] : []),
    'divider',
    ...(onDesktop ? [{ label: ctx.isClear ? 'Bring everything back' : 'Clear the desk', cmd: 'clear' }] : []),
    { label: 'Desktop settings…', cmd: 'open-settings' },
  ]
}
