// The desktop's windows' bridge (the light, the player, the playlist, the clock, the curtains): what they hear from
// the app, and what they may ask of it. Nothing more - no files, no settings of their own, no account.
const { contextBridge, ipcRenderer } = require('electron')

const HEARD = new Set([
  'desktop:state', 'desktop:settings', 'desktop:frost', 'desktop:pointer', 'desktop:clear-state', 'desktop:meter',
  'desktop:hidden', 'desktop:curtain-close', 'desktop:curtain-open', 'desktop:primary',
])

contextBridge.exposeInMainWorld('desktopPage', {
  /** Who this window is, and everything it shows, at once. */
  hello: () => ipcRenderer.invoke('desktop:page-hello'),
  /** Listens on one of the channels the app sends on; returns the way to stop. */
  on: (channel, callback) => {
    if (!HEARD.has(channel)) return () => {}
    const listener = (_event, value) => callback(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  /** A press, for the app to act on as its own buttons do. */
  command: (cmd, arg) => ipcRenderer.send('desktop:command', String(cmd), arg),
  /** A question for the app (search, the lists, an era's songs); answered with null when it can't. */
  request: (kind, arg) => ipcRenderer.invoke('desktop:request', String(kind), arg),
  /** The pointer is over the window's solid part (true) or its clear part (false). */
  solid: (on) => ipcRenderer.send('desktop:solid', Boolean(on)),
  /** The window follows the pointer ('start') until let go ('end'). */
  drag: (phase) => ipcRenderer.send('desktop:drag', phase === 'start' ? 'start' : 'end'),
  /** The window takes the keys (its search open), or gives them back. */
  keys: (on) => ipcRenderer.send('desktop:keys', Boolean(on)),
  /** The page measured itself: the window's size to be. */
  size: (width, height) => ipcRenderer.send('desktop:size', { width: Number(width) || 0, height: Number(height) || 0 }),
  curtainOpened: () => ipcRenderer.send('desktop:curtain-opened'),
})
