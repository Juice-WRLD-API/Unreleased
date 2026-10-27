// The light round the screens' edges: one transparent, click-through window per display chosen, above everything,
// each drawing its own light with WebGL. Its windows are there only while the light can show - made as a song starts,
// closed half a minute after the music stops (each is a process of its own, 20–30 MB) - and a song paused a moment and
// played on again finds its light still there.
const { BrowserWindow } = require('electron')
const { TOOL } = require('./windows')

const CLOSE_AFTER_MS = 30000

class EdgeLights {
  /** @param {{ pageUrl: (name: string) => string, preload: string, displays: () => Electron.Display[], onWindow: (win: BrowserWindow, display: Electron.Display) => void, onShown?: (win: BrowserWindow) => void }} options */
  constructor(options) {
    this.options = options
    /** @type {{ window: BrowserWindow, displayId: number }[]} */
    this.lights = []
    this.wanted = false
    /** @type {NodeJS.Timeout | undefined} */
    this.going = undefined
  }

  get windows() { return this.lights.map((l) => l.window).filter((w) => !w.isDestroyed()) }

  /** Whether the light can show now; its windows follow, closing only after a while. */
  want(on) {
    this.wanted = on
    clearTimeout(this.going)
    if (on) { if (!this.lights.length) this.build(); return }
    if (this.lights.length) this.going = setTimeout(() => { if (!this.wanted) this.close() }, CLOSE_AFTER_MS)
  }

  /** The displays changed (one added, one taken away, one moved): the light's windows made afresh. */
  rebuild() {
    if (!this.lights.length) return
    this.close()
    if (this.wanted) this.build()
  }

  build() {
    this.close()
    this.lights = this.options.displays().map((display) => ({ window: this.make(display), displayId: display.id }))
  }

  make(display) {
    const { x, y, width, height } = display.bounds
    const win = new BrowserWindow({
      ...TOOL,
      x, y, width, height,
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false, alwaysOnTop: true, fullscreenable: false,
      enableLargerThanScreen: true, backgroundColor: '#00000000', title: 'Unreleased',
      webPreferences: { preload: this.options.preload, backgroundThrottling: false, contextIsolation: true },
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setBounds({ x, y, width, height })
    this.options.onWindow(win, display)
    win.loadURL(this.options.pageUrl('light'))
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.showInactive()
      win.setBounds({ x, y, width, height })
      this.options.onShown?.(win)
    })
    return win
  }

  close() {
    clearTimeout(this.going)
    for (const { window } of this.lights) if (!window.isDestroyed()) window.destroy()
    this.lights = []
  }
}

module.exports = { EdgeLights }
