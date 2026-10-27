// The desk cleared: on every display showing the desktop, its icons and the taskbar go, and only the desktop's own -
// the player, the playlist, the clock and the light - and the wallpaper stay, or WRLD's visualizer in its place. A
// display with another app's window on it is left as it is, and with an app on every one, nothing is cleared. Pressed
// again, all comes back as it was; going to an app under it (Alt+Tab, the Start menu, a click on the taskbar's last
// glimpse) brings it all back too.
//
// No window is hidden, minimized or moved: the wallpaper (or the visualizer) is laid over all of them like a curtain,
// fading in, with the desktop's windows lifted over it, and fades away again. Every window waits under it exactly
// where it was, the taskbar too, so nothing of Windows itself is ever changed, and nothing is left changed should
// Unreleased stop.
const { screen } = require('electron')
const EventEmitter = require('events')
const { TOOL, openShared } = require('./windows')
const { ScreenWatch, screenWatch } = require('./screenwatch')

/** How long a press waits to be told where the apps' windows are (the helper starting): then every display is cleared. */
const WINDOWS_WAIT_MS = 2500
/** How far into a display an app's window reaches before the display is the app's: a window's edge over the line isn't. */
const MIN_OVERLAP = 48

const overlaps = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= MIN_OVERLAP
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= MIN_OVERLAP

/** The displays no app's window is on. `rects` are the windows' places in the displays' own coordinates; null when
 *  they aren't known, and then every display.
 *  @template {{ bounds: Electron.Rectangle }} D
 *  @param {D[]} displays @param {Electron.Rectangle[] | null} rects @returns {D[]} */
function freeDisplays(displays, rects) {
  if (!rects) return displays
  return displays.filter((d) => !rects.some((r) => overlaps(d.bounds, r)))
}

/** A window's place in real pixels, in Electron's own coordinates. */
const toDip = (rect) => (process.platform === 'win32' ? screen.screenToDipRect(null, rect) : rect)

class ClearDesk extends EventEmitter {
  /**
   * @param {{ pageUrl: (name: string) => string, shared: { hostUrl: string, preload: string }, preload: string,
   *   widgets: () => Electron.BrowserWindow[], lights: () => Electron.BrowserWindow[], wallpaper: () => string | null,
   *   viz: () => unknown, onWindow: (win: Electron.BrowserWindow) => void }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.isOn = false
    /** Pressed, and finding out which displays are free. */
    this.starting = false
    /** @type {Electron.Rectangle[]} the displays the curtains cover */
    this.covered = []
    /** The desktop's windows held over the curtain: from the press until the curtain has opened again. */
    this.holding = false
    /** @type {{ win: Electron.BrowserWindow | null, ready: Promise<void> }[]} */
    this.curtains = []
    this.turn = 0
    this.since = 0
    this.onFront = (front) => {
      if (!this.isOn) return
      // Pressing the button itself brings the player's own window or the desktop forward a moment: let be. And an
      // app on a display left uncleared is just that app in use.
      if (Date.now() - this.since < 1500 || !ScreenWatch.isOtherApp(front)) return
      if (front.rect && !this.covered.some((c) => overlaps(c, toDip(front.rect)))) return
      this.end()
    }
    screenWatch.on('front', this.onFront)
  }

  /** Clears the desk, or brings it all back; undefined turns it over. */
  set(on) {
    const now = this.isOn || this.starting
    const want = on === undefined ? !now : Boolean(on)
    if (want === now) return
    if (want) { void this.begin(); return }
    if (this.isOn) { this.end(); return }
    // Pressed again before anything was cleared.
    this.starting = false
    ++this.turn
    screenWatch.need('cleardesk', false)
  }

  async begin() {
    this.starting = true
    const turn = ++this.turn
    screenWatch.need('cleardesk', true)
    const windows = await screenWatch.windowsSoon(WINDOWS_WAIT_MS)
    if (turn !== this.turn) return
    this.starting = false
    // Unreleased's own windows go under the curtain with the rest, as when the press is in the app's settings.
    const rects = windows && windows.filter((w) => ScreenWatch.isOtherApp(w)).map((w) => toDip(w.rect))
    const displays = freeDisplays(screen.getAllDisplays(), rects)
    if (!displays.length) {
      screenWatch.need('cleardesk', false)
      this.emit('refused')
      return
    }
    this.isOn = true
    this.holding = true
    this.since = Date.now()
    this.covered = displays.map((d) => d.bounds)
    this.emit('change', true)
    const look = { picture: this.options.wallpaper(), viz: this.options.viz() }
    for (const display of displays) {
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
    this.covered = []
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

  /** Something for every curtain's page there is: what its visualizer draws, and its frames. */
  send(channel, value) {
    for (const one of this.curtains) if (one.win && !one.win.isDestroyed()) one.win.webContents.send(channel, value)
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

  /** Whether `win` is on a display the curtains cover: a widget on a display left as it was stays among the apps. */
  over(win) {
    return this.covered.some((c) => overlaps(c, win.getBounds()))
  }

  lift() {
    for (const win of [...this.options.widgets(), ...this.options.lights()].filter((w) => w && !w.isDestroyed() && this.over(w))) {
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
    if (!this.holding || !win || win.isDestroyed() || !this.over(win)) return
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

module.exports = { ClearDesk, freeDisplays }
