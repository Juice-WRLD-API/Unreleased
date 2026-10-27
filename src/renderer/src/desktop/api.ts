// The main window's side of the desktop windows' channel (electron/preload.js `desktop`): settings and what's playing
// go out, the widgets' presses come back. Absent outside Electron, and the desktop windows themselves only on Windows.
import type { DesktopSettings } from '../store/desktopSlice'
import type { DeskVizLook } from './deskViz'

export interface DesktopDisplay { label: string; primary: boolean }

export interface DesktopApi {
  setSettings: (settings: DesktopSettings) => void
  setState: (patch: Record<string, unknown>) => void
  /** What the meter hears, for the light and the player's glow. */
  meter: (value: { decibels: number; punch: number }) => void
  /** What the cleared desk draws behind the widgets (desktop/deskViz.ts), whenever that changes. */
  vizLook: (look: DeskVizLook) => void
  /** One frame of what the app plays, analysed for the cleared desk's visualizer (lib/viz/audio's packFrame). */
  vizFrame: (frame: Float32Array) => void
  displays: () => Promise<DesktopDisplay[]>
  /** Clears the desk, or brings it all back: `on` undefined toggles. */
  clearDesk: (on?: boolean) => void
  onCommand: (cb: (cmd: string, arg?: unknown) => void) => () => void
  onRequest: (cb: (id: number, kind: string, arg: unknown) => void) => () => void
  reply: (id: number, value: unknown) => void
  /** A widget let go somewhere new: its place, for the settings to keep. */
  onPlace: (cb: (which: 'player' | 'playlist' | 'clock', place: { x: number; y: number; display: string }) => void) => () => void
  onClearState: (cb: (on: boolean) => void) => () => void
}

interface ElectronWindow { electron?: { platform?: string; desktop?: DesktopApi } }

export function desktopApi(): DesktopApi | null {
  return (window as unknown as ElectronWindow).electron?.desktop ?? null
}

/** The light round the screen, the widgets and clear desk: Windows only. */
export function desktopWindowsSupported(): boolean {
  const el = (window as unknown as ElectronWindow).electron
  return el?.platform === 'win32' && !!el.desktop
}
