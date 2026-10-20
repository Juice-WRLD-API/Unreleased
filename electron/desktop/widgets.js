// The player, the playlist and the clock on the desktop: see-through windows that sit among the others, never come
// forward and never take focus (the player only while its search has the keys). Each remembers where the user left
// it as a place on a display - fractions of its usable area - so it lands in the same spot however the display's size
// or scale changes; a display switched off in the settings, or gone, sends it to the main one.
const { screen } = require('electron')
const { TOOL, openShared } = require('./windows')
const { fitAt } = require('./fit')
const { follow } = require('./drag')
const { watchPresses } = require('./presses')

/** The player's measurements at the user's size, as the page lays it out. The renderer's copy of these sums, for the
 *  widgets in the WRLD tab, is src/renderer/src/desktop/metrics.ts: change both together. */
function playerMetrics(size, fit = 1) {
  const s = (0.8 + 0.45 * size) * fit
  const cardWidth = 232 * s, cardInset = 9 * s, coverSide = cardWidth - 2 * cardInset, captionHeight = 66 * s
  const cardHeight = cardInset + coverSide + captionHeight
  const carouselHeight = cardHeight + 44 * s
  const edge = 40 * s
  const height = edge + carouselHeight + 10 * s + 42 * s + 8 * s + 64 * s + edge
  return { s, width: Math.round(900 * s), height: Math.round(height), edge }
}

/** The playlist's measurements: its list, its header, and a clear margin round them for the turned list to swing in. */
function playlistMetrics(style, fit = 1) {
  const s = (0.8 + 0.5 * style.size) * fit
  const width = 300 * s, headerHeight = 66 * s, gap = 8 * s, rowHeight = 50 * s
  const listHeight = style.rows * rowHeight
  const margin = 24
  return { s, edge: margin, width: Math.ceil(width + 2 * margin), height: Math.ceil(headerHeight + gap + listHeight + 2 * margin) }
}

/** A display's name as the settings keep it. */
const displayName = (d) => d.label || `Display ${d.id}`

const DEFAULT_PLACES = {
  player: () => [0.5, 0.64],
  playlist: (style) => [style.side === 'right' ? 0.86 : 0.14, 0.5],
  clock: () => [0.5, 0.26],
}

class Widget {
  /**
   * @param {'player' | 'playlist' | 'clock'} which
   * @param {{
   *   pageUrl: (name: string) => string, shared: { hostUrl: string, preload: string }, preload: string,
   *   settings: () => any, displays: () => Electron.Display[],
   *   onPlace: (which: string, place: { x: number, y: number, display: string }) => void,
   *   onWindow: (win: Electron.BrowserWindow, which: string) => void,
   *   seeThrough?: boolean,
   * }} options
   */
  constructor(which, options) {
    this.which = which
    this.options = options
    /** @type {Electron.BrowserWindow | null} */
    this.window = null
    /** @type {(() => void) | null} */
    this.opening = null
    /** @type {{ end: () => void } | null} */
    this.drag = null
    /** The size the page measured itself at (the clock), until the window is made. */
    /** @type {{ width: number, height: number } | null} */
    this.measured = null
    this.seeThrough = false
    /** @type {string | null | undefined} */
    this.pointerAt = undefined
    /** @type {NodeJS.Timeout | null} */
    this.feeling = null
    /** Where it was let go, until the settings say so too: kept meanwhile, it doesn't jump back. */
    /** @type {{ x: number, y: number, display: string } | null} */
    this.dropPlace = null
  }

  /** Its place: where it was just let go, else the settings'. */
  place() {
    const saved = this.style.place || null
    if (this.dropPlace && saved && saved.x === this.dropPlace.x && saved.y === this.dropPlace.y && saved.display === this.dropPlace.display) this.dropPlace = null
    return this.dropPlace || saved
  }

  get style() { return this.options.settings()?.[this.which] || {} }

  /** The display it stands on: the one its place names when that's shown, else the main one, else any shown. */
  display() {
    const shown = this.options.displays()
    const named = this.place()?.display
    return shown.find((d) => displayName(d) === named) || shown.find((d) => d.id === screen.getPrimaryDisplay().id) || shown[0] || screen.getPrimaryDisplay()
  }

  fit() { return fitAt(this.display().workArea) }

  size() {
    if (this.which === 'player') return playerMetrics(this.style.size ?? 0.45, this.fit())
    if (this.which === 'playlist') return playlistMetrics(this.style, this.fit())
    return { ...(this.measured || { width: 400, height: 420 }), edge: 24 }
  }

  /** Where it stands: centered on its place, kept on the screen - all but its clear margin, which may hang over. */
  frame() {
    const area = this.display().workArea
    const m = this.size()
    const kept = this.place()
    const place = kept ? [kept.x, kept.y] : DEFAULT_PLACES[this.which](this.style)
    return this.clamped({ x: Math.round(area.x + area.width * place[0] - m.width / 2), y: Math.round(area.y + area.height * place[1] - m.height / 2),
      width: Math.round(m.width), height: Math.round(m.height) }, area, m.edge)
  }

  clamped(frame, area, edge) {
    const e = Math.round(edge)
    return { ...frame,
      x: Math.round(Math.min(Math.max(frame.x, area.x - e), Math.max(area.x + area.width - frame.width + e, area.x - e))),
      y: Math.round(Math.min(Math.max(frame.y, area.y - e), Math.max(area.y + area.height - frame.height + e, area.y - e))) }
  }

  send(channel, ...values) { if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, ...values) }

  /** Shows, hides, moves or resizes it to match the settings. */
  apply() {
    if (!this.style.isOn) { this.hide(); return }
    if (!this.window || this.window.isDestroyed()) { if (!this.opening) this.show(); return }
    if (this.drag) return
    // At a display scale like 125% Windows reports a size or a place a pixel or two off: the window is set again only
    // when it really differs, and always from the place kept in the settings, so it never creeps.
    const want = this.frame()
    const b = this.window.getBounds()
    if (Math.abs(b.width - want.width) > 3 || Math.abs(b.height - want.height) > 3 || Math.abs(b.x - want.x) > 3 || Math.abs(b.y - want.y) > 3) this.window.setBounds(want)
  }

  show() {
    const frame = this.frame()
    this.opening = openShared(this.options.shared, this.options.pageUrl(this.which), {
      ...TOOL,
      ...frame, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, focusable: false, alwaysOnTop: false,
      backgroundColor: '#00000000', title: 'Unreleased',
      webPreferences: { preload: this.options.preload, backgroundThrottling: false, contextIsolation: true },
    }, (win) => {
      this.opening = null
      this.window = win
      this.options.onWindow(win, this.which)
      watchPresses(win)
      if (this.options.seeThrough) {
        // Clear until the pointer is over the widget itself (the page's solidAt); feel() tells it where the pointer is.
        win.setIgnoreMouseEvents(true)
        this.seeThrough = true
        this.feel()
      }
      win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
      win.on('closed', () => { if (this.window === win) this.window = null })
      // The settings may have changed while it was on its way.
      this.apply()
    })
  }

  hide() {
    this.opening?.()
    this.opening = null
    if (this.feeling) clearTimeout(this.feeling)
    this.feeling = null
    this.pointerAt = undefined
    this.drag?.end()
    this.drag = null
    if (!this.window || this.window.isDestroyed()) { this.window = null; return }
    const win = this.window
    this.window = null
    win.destroy()
  }

  /** Over the widget or over its clear window: clicks taken, or let through to the desktop. */
  solid(on) {
    if (!this.window || this.window.isDestroyed()) return
    this.seeThrough = !on
    this.window.setIgnoreMouseEvents(!on)
  }

  // A see-through window hears nothing, so the pointer is looked at here - 25 times a second near the widget, 10 away
  // from it - and the page is told where it is only while the window lets clicks through and the pointer moves over
  // it, or leaves it.
  feel() {
    if (this.feeling) return
    const tick = () => {
      const win = this.window
      if (!win || win.isDestroyed()) { this.feeling = null; return }
      const p = screen.getCursorScreenPoint()
      const b = win.getBounds()
      const dx = Math.max(b.x - p.x, p.x - (b.x + b.width - 1), 0)
      const dy = Math.max(b.y - p.y, p.y - (b.y + b.height - 1), 0)
      const inside = dx === 0 && dy === 0
      const at = inside ? `${p.x - b.x},${p.y - b.y}` : null
      if (at !== this.pointerAt) {
        this.pointerAt = at
        // Taking clicks, the page hears the pointer itself; it's only told when the pointer is gone.
        if (this.seeThrough || !inside) this.send('desktop:pointer', inside ? { x: p.x - b.x, y: p.y - b.y } : null)
      }
      this.feeling = setTimeout(tick, dx < 160 && dy < 160 ? 40 : 100)
    }
    this.feeling = setTimeout(tick, 40)
  }

  /** While search is open the player takes the keys, and gives them back when it closes. */
  keys(on) {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setFocusable(Boolean(on))
    if (on) this.window.focus()
    else this.window.blur()
  }

  /** The page measured itself (the clock): the window takes that size about its place. */
  resize(size) {
    if (!size || !(size.width > 0) || !(size.height > 0)) return
    this.measured = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
    if (this.window && !this.window.isDestroyed()) this.apply()
  }

  /** Empty space moves it: the pointer is followed until it lets go, then the place is kept. */
  dragPhase(phase) {
    if (!this.window || this.window.isDestroyed() || this.style.locked) return
    if (phase === 'start') {
      this.drag?.end()
      this.drag = follow(this.window, () => this.dropped())
    } else if (this.drag) {
      this.drag.end()
    }
  }

  /** Let go: the place is kept as fractions of the usable area of the display it was let go on. */
  dropped() {
    this.drag = null
    const win = this.window
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    const display = screen.getDisplayNearestPoint(center)
    const area = display.workArea
    const clamp = (v) => Math.min(Math.max(v, 0), 1)
    const place = { x: clamp((center.x - area.x) / area.width), y: clamp((center.y - area.y) / area.height), display: displayName(display) }
    this.dropPlace = place
    this.options.onPlace(this.which, place)
  }
}

module.exports = { Widget, playerMetrics, playlistMetrics, displayName }
