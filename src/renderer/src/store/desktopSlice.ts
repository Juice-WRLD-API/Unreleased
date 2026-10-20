// Desktop: what came over from iJWA - the light round the screen, the player, playlist and clock on the desktop, the
// desk cleared, and the lyric styles. Every part is off until it's switched on in Settings > Desktop.
//
// Kept on this device rather than synced to the account: where the widgets stand and which displays they live on
// only make sense on the PC they were set on. Mirrored between windows (windowSync's SYNC_KEYS), since Settings can
// be popped out while the main window drives the desktop windows.
import type { StateCreator } from 'zustand'
import { ls } from '../lib/persist'
import { DEFAULT_LIGHT, type LightStyle } from '../desktop/light/engine'

export interface DesktopLight extends LightStyle {
  /** The light round the screens' edges (Windows). Its tuning and colors also drive WRLD's Edge light. */
  isOn: boolean
  /** Shown only while the desktop (or one of Unreleased's own windows) is in front. */
  onlyOnDesktop: boolean
}

/** Where a widget stands: its center as fractions of its display's work area, and that display's label. */
export interface WidgetPlace { x: number; y: number; display: string }
/** Where a widget stands in the WRLD tab's Widgets layout: its center as fractions of the tab. */
export interface TabPlace { x: number; y: number }

/** What every widget has besides its own look: whether it's out, and where it stands on the desktop and in WRLD. */
interface WidgetCommon {
  /** Out on the desktop (Windows). */
  isOn: boolean
  /** Shown in the WRLD tab's Widgets layout. */
  inWrld: boolean
  locked: boolean
  place: WidgetPlace | null
  tabPlace: TabPlace | null
}

export interface DesktopPlayer extends WidgetCommon {
  /** 0...1: from 80% to 125% of the design's size. */
  size: number
  /** 0...1: how far the side cards turn away. */
  tilt: number
  /** Cards shown on each side of the middle one, 1...3. */
  sideCards: number
  /** 0...1: from plain glass to bright milky glass. */
  glassBrightness: number
  /** 0...1: how blurred the wallpaper looks through the cards' glass. */
  frost: number
  /** Made small: only a capsule with the song and back, play, forward. */
  mini: boolean
  /** With the lyrics open, the album card folds away to the left. */
  hidesLyricsCard: boolean
  /** The player's own lyrics are showing instead of the cards. */
  lyricsOpen: boolean
}

export type PlaylistSource = 'queue' | 'liked' | `playlist:${string}`

export interface DesktopPlaylist extends WidgetCommon {
  side: 'left' | 'right'
  /** 0...1: how far the list turns away, from 10 to 45 degrees. */
  tilt: number
  /** 0...1: from 80% to 130% of the design's size. */
  size: number
  /** Songs shown at once, 4...12; the rest scroll. */
  rows: number
  source: PlaylistSource
}

export interface DesktopClock extends WidgetCommon {
  /** 0...1: how tall the digits stand. */
  size: number
  /** 0...1: how far the digits stretch up, as a lock screen's clock does. */
  stretch: number
  /** 0...1: from hairline to bold digits. */
  weight: number
  /** 0...1: how much color the glass takes. */
  tint: number
  /** The glass takes the color of the song's artwork while one plays. */
  useArtworkColor: boolean
  showDate: boolean
}

export interface DesktopLyrics {
  /** 'classic' is the app's own list; anything else is one of the iJWA styles (desktop/lyrics/looks.ts). */
  look: string
  /** The face picked for each style, by its id; a style not picked for is set in its own. */
  fonts: Record<string, string>
}

export interface DesktopSettings {
  light: DesktopLight
  player: DesktopPlayer
  playlist: DesktopPlaylist
  clock: DesktopClock
  lyrics: DesktopLyrics
  /** Displays the light and the widgets keep off, by label. */
  hiddenDisplays: string[]
}

type Groups = Omit<DesktopSettings, 'hiddenDisplays'>
export type DesktopPatch = { [K in keyof Groups]?: Partial<Groups[K]> } & { hiddenDisplays?: string[] }

const GROUPS = ['light', 'player', 'playlist', 'clock', 'lyrics'] as const

export const DESKTOP_DEFAULTS: DesktopSettings = {
  light: { ...DEFAULT_LIGHT, isOn: false, onlyOnDesktop: false },
  player: {
    isOn: false, inWrld: true, size: 0.45, tilt: 0.5, sideCards: 2, glassBrightness: 0.6, frost: 0.35,
    locked: false, mini: false, hidesLyricsCard: false, lyricsOpen: false, place: null, tabPlace: null,
  },
  playlist: { isOn: false, inWrld: true, side: 'left', tilt: 1.0, size: 0.4, rows: 8, locked: false, source: 'queue', place: null, tabPlace: null },
  clock: {
    isOn: false, inWrld: true, size: 0.5, stretch: 0.55, weight: 0.3, tint: 0.45, useArtworkColor: true, showDate: true,
    locked: false, place: null, tabPlace: null,
  },
  lyrics: { look: 'classic', fonts: {} },
  hiddenDisplays: [],
}

/** Saved settings over the defaults, group by group, so a setting added later gets its default. */
export function mergeDesktop(base: DesktopSettings, patch: DesktopPatch | null | undefined): DesktopSettings {
  if (!patch || typeof patch !== 'object') return base
  const next = { ...base } as DesktopSettings
  for (const key of GROUPS) {
    const part = patch[key]
    if (part && typeof part === 'object') (next as unknown as Record<string, unknown>)[key] = { ...base[key], ...part }
  }
  if (Array.isArray(patch.hiddenDisplays)) next.hiddenDisplays = patch.hiddenDisplays.filter((d) => typeof d === 'string')
  return next
}

export interface DesktopSlice {
  desktop: DesktopSettings
  setDesktop: (patch: DesktopPatch) => void
  /** Puts one widget back where it first stood, on the desktop and in WRLD. */
  resetDesktopPlace: (which: 'player' | 'playlist' | 'clock') => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
// A dragged slider changes it 60 times a second.
function save(value: DesktopSettings): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => ls.set('desktop', value), 300)
}

export const createDesktopSlice: StateCreator<DesktopSlice, [], [], DesktopSlice> = (set, get) => ({
  desktop: mergeDesktop(DESKTOP_DEFAULTS, ls.get<DesktopPatch>('desktop')),
  setDesktop: (patch) => {
    const desktop = mergeDesktop(get().desktop, patch)
    set({ desktop })
    save(desktop)
  },
  resetDesktopPlace: (which) => get().setDesktop({ [which]: { place: null, tabPlace: null } }),
})
