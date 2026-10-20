// The desk cleared: the other apps' windows, the desktop's icons and the taskbar go, and only the desktop's own - the
// player, the playlist, the clock and the light - and the wallpaper stay. Pressed again, all comes back as it was;
// going to another app (Alt+Tab, the Start menu, a click on the taskbar's last glimpse) brings it all back too.
//
// No window is hidden, minimized or moved: the wallpaper is laid over all of them like a curtain, fading in, with the
// desktop's windows lifted over it, and fades away again. Every window waits under it exactly where it was, the
// taskbar too, so nothing of Windows itself is ever changed, and nothing is left changed should Unreleased stop.
const { screen } = require('electron')
const EventEmitter = require('events')
const { TOOL, openShared } = require('./windows')
const { ScreenWatch, screenWatch } = require('./screenwatch')

class ClearDesk extends EventEmitter {
  /**
   * @param {{ pageUrl: (name: string) => string, shared: { hostUrl: string, preload: string }, preload: string,
   *   widgets: () => Electron.BrowserWindow[], lights: () => Electron.BrowserWindow[], wallpaper: () => string | null,
   *   onWindow: (win: Electron.BrowserWindow) => void }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.isOn = false
    /** The desktop's windows held over the curtain: from the press until the curtain has opened again. */
    this.holding = false
    /** @type {{ win: Electron.BrowserWindow | null, ready: Promise<void> }[]} */
    this.curtains = []
    this.turn = 0
    this.since = 0
    this.onFront = (front) => {
      if (!this.isOn) return
      // Pressing the button itself brings the player's own window or the desktop forward a moment: let be.
      if (Date.now() - this.since < 1500 || !ScreenWatch.isOtherApp(front)) return
      this.end()
    }
    screenWatch.on('front', this.onFront)
  }

  /** Clears the desk, or brings it all back; undefined turns it over. */
  set(on) {
    const want = on === undefined ? !this.isOn : Boolean(on)
    if (want === this.isOn) return
    if (want) this.begin(); else this.end()
  }

  begin() {
    this.isOn = true
    this.holding = true
    this.since = Date.now()
    const turn = ++this.turn
    this.emit('change', true)
    screenWatch.need('cleardesk', true)
    const look = { picture: this.options.wallpaper() }
    for (const display of screen.getAllDisplays()) {
      /** @type {{ win: Electron.BrowserWindow | null, ready: Promise<void> }} */
      const one = { win: null, ready: Promise.resolve() }
      one.ready = new Promise((done) => {
        openShared(this.options.shared, this.options.pageUrl('curtain'), {
          ...TOOL, ...display.bounds, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
          maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, focusable: false,
          alwaysOnTop: true, enableLargerThanScreen: true, backgroundColor: '#00000000', title: 'Unreleased',
          webPreferences: { preload: this.options.preload, backgroundThrottling: false, contextIsolation: true },
        }, (win) => {
          one.win = win
          this.options.onWindow(win)
          win.setAlwaysOnTop(true, 'screen-saver')
          win.once('ready-to-show', () => {
            if (turn !== this.turn || !this.isOn) { this.close(one); done(); return }
            win.showInactive()
            win.setBounds(display.bounds)
            // The desktop's own over it: the last brought to the top is the highest. Again a moment later, should
            // anything have come up meanwhile.
            this.lift()
            setTimeout(() => { if (this.isOn) this.lift() }, 600)
            win.webContents.send('desktop:curtain-close', look)
            done()
          })
        })
      })
      this.curtains.push(one)
    }
  }

  /** Everything back: the curtain opens, then the desktop's windows go back down among the others. */
  end() {
    this.isOn = false
    ++this.turn
    this.emit('change', false)
    screenWatch.need('cleardesk', false)
    for (const one of this.curtains) {
      void one.ready.then(() => {
        if (!one.win || one.win.isDestroyed()) return
        one.win.webContents.send('desktop:curtain-open')
        // Should the page never answer, it goes all the same.
        setTimeout(() => this.close(one), 2000)
      })
    }
    if (!this.curtains.length) this.lower()
  }

  /** The curtain's page said it has opened: its window goes. */
  opened(webContents) {
    const one = this.curtains.find((c) => c.win && !c.win.isDestroyed() && c.win.webContents === webContents)
    if (one) this.close(one)
  }

  close(one) {
    if (one.win && !one.win.isDestroyed()) one.win.destroy()
    one.win = null
    this.curtains = this.curtains.filter((c) => c !== one)
    if (!this.curtains.length && !this.isOn) this.lower()
  }

  lift() {
    for (const win of [...this.options.widgets(), ...this.options.lights()].filter((w) => w && !w.isDestroyed())) {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    }
  }

  lower() {
    if (!this.holding) return
    this.holding = false
    // The widgets go back among the other windows; the light stays above everything.
    for (const win of this.options.widgets().filter((w) => w && !w.isDestroyed())) win.setAlwaysOnTop(false)
    this.emit('lowered')
  }

  /** A desktop window made while the desk is clear: over the curtain too. */
  adopt(win) {
    if (!this.holding || !win || win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }

  dispose() {
    screenWatch.off('front', this.onFront)
    screenWatch.need('cleardesk', false)
    for (const one of this.curtains) if (one.win && !one.win.isDestroyed()) one.win.destroy()
    this.curtains = []
  }
}

module.exports = { ClearDesk }
