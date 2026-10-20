// The widgets in the WRLD tab are the desktop's own pages in frames: what passes between a frame and the tab
// (components/WrldWidgets.tsx), which answers it as the main process answers a window on the desktop.

/** Every message either way carries this, set to true: anything else posted to the page isn't ours. */
export const FRAME_MARK = '__unreleasedDesktop'

/** From a widget's page to the tab. */
export type FromFrame =
  | { type: 'hello'; id: number }
  | { type: 'request'; id: number; kind: string; arg?: unknown }
  | { type: 'command'; cmd: string; arg?: unknown }
  | { type: 'solid'; on: boolean }
  | { type: 'drag'; phase: 'start' | 'end' }
  | { type: 'drag-to'; x: number; y: number }
  | { type: 'size'; width: number; height: number }
  /** A key pressed in the frame that the page doesn't use itself: the app's hotkeys still work after a click on it. */
  | { type: 'key'; key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }

/** From the tab to a widget's page: an answer, or something it hears on a channel. */
export type ToFrame =
  | { type: 'reply'; id: number; value: unknown }
  | { type: 'event'; channel: string; value: unknown }

export function isOurs<T>(data: unknown): data is T & { type: string } {
  return !!data && typeof data === 'object' && (data as Record<string, unknown>)[FRAME_MARK] === true
}
