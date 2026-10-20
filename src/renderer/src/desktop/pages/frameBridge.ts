// A widget's page in a frame in the WRLD tab rather than a window on the desktop: the same bridge electron/
// desktopPreload.js gives a window, over messages to the tab that frames it.
import { FRAME_MARK, isOurs, type FromFrame, type ToFrame } from '../frame'
import type { Bridge } from './page'

/** How long a question to the tab waits for its answer. */
const ASK_MS = 10000

export function frameBridge(): Bridge {
  const tab = window.parent
  const heard = new Map<string, Set<(value: unknown) => void>>()
  const waiting = new Map<number, (value: unknown) => void>()
  let asked = 0

  const post = (message: FromFrame): void => tab.postMessage({ ...message, [FRAME_MARK]: true }, '*')
  window.addEventListener('message', (event) => {
    if (event.source !== tab || !isOurs<ToFrame>(event.data)) return
    const message = event.data as ToFrame
    if (message.type === 'reply') waiting.get(message.id)?.(message.value)
    else if (message.type === 'event') heard.get(message.channel)?.forEach((cb) => cb(message.value))
  })
  // Clicked, the frame has the keys: what isn't typing (the player's search) or pressing a focused button goes on to
  // the app, so Space still plays and pauses.
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (event.defaultPrevented || tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return
    const { key, code, ctrlKey, shiftKey, altKey, metaKey } = event
    post({ type: 'key', key, code, ctrlKey, shiftKey, altKey, metaKey })
  })

  const ask = <T>(message: { type: 'hello' } | { type: 'request'; kind: string; arg?: unknown }): Promise<T | null> => new Promise((resolve) => {
    const id = ++asked
    const timer = window.setTimeout(() => { waiting.delete(id); resolve(null) }, ASK_MS)
    waiting.set(id, (value) => { window.clearTimeout(timer); waiting.delete(id); resolve((value ?? null) as T | null) })
    post({ ...message, id })
  })

  const bridge = {
    hello: () => ask({ type: 'hello' }),
    on: (channel: string, cb: (value: unknown) => void) => {
      let set = heard.get(channel)
      if (!set) heard.set(channel, (set = new Set()))
      set.add(cb)
      return () => { set.delete(cb) }
    },
    command: (cmd: string, arg?: unknown) => post({ type: 'command', cmd: String(cmd), arg }),
    request: (kind: string, arg?: unknown) => ask({ type: 'request', kind: String(kind), arg }),
    solid: (on: boolean) => post({ type: 'solid', on: Boolean(on) }),
    drag: (phase: 'start' | 'end') => post({ type: 'drag', phase }),
    dragTo: (x: number, y: number) => post({ type: 'drag-to', x, y }),
    // A frame has the keys whenever it's pressed: nothing to ask for.
    keys: () => {},
    size: (width: number, height: number) => post({ type: 'size', width: Number(width) || 0, height: Number(height) || 0 }),
    curtainOpened: () => {},
  }
  return bridge as unknown as Bridge
}
