// What every desktop window shares, on Windows: a tool window, so it has no taskbar button, stays out of Alt+Tab and
// Task View, and Unreleased still shows up once.
//
// And one process for the widgets' pages. Chromium gives every window a process of its own, 20–40 MB apiece; a
// page's popups live in the page's process instead. So the player, the playlist, the clock and the curtains are
// opened as popups of one hidden page and share its process. The light's windows keep their own, so nothing else
// ever holds up a frame of it.
const { BrowserWindow } = require('electron')

const TOOL = process.platform === 'win32' ? { type: 'toolbar' } : {}

let host = null
let hostReady = null
let count = 0
const asked = new Map() // window name -> { options, made, cancelled }

function startHost(url, preload) {
  host = new BrowserWindow({ ...TOOL, show: false, title: 'Unreleased', webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } })
  host.webContents.setWindowOpenHandler(({ frameName }) => {
    const one = asked.get(frameName)
    return one ? { action: 'allow', overrideBrowserWindowOptions: one.options } : { action: 'deny' }
  })
  host.webContents.on('did-create-window', (win, { frameName }) => {
    const one = asked.get(frameName)
    if (!one) return
    asked.delete(frameName)
    if (one.cancelled) win.destroy(); else one.made(win)
  })
  host.webContents.on('render-process-gone', (_e, details) => {
    console.error('[desktop] the widgets\' shared process ended:', details.reason)
    host = null
  })
  hostReady = host.loadURL(url).catch((error) => console.error('[desktop] host:', error.message))
}

/** Opens `url` in a new window made with `options`, in the shared process; `made(window)` once it's there. Returns a
 *  function that calls it off: a window asked for and no longer wanted is closed as it arrives. */
function openShared({ hostUrl, preload }, url, options, made) {
  if (!host || host.isDestroyed()) startHost(hostUrl, preload)
  const name = `w${++count}`
  const one = { options, made, cancelled: false }
  asked.set(name, one)
  hostReady.then(() => host?.webContents.executeJavaScript(`void window.open(${JSON.stringify(url)}, ${JSON.stringify(name)})`, true))
    .catch((error) => console.error('[desktop] open', url, error.message))
  return () => { one.cancelled = true }
}

function closeHost() {
  if (host && !host.isDestroyed()) host.destroy()
  host = null
}

module.exports = { TOOL, openShared, closeHost }
