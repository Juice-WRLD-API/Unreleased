// Windows taskbar thumbnail toolbar: the like / previous / play-pause / next
// buttons under the main window's taskbar preview, the way Spotify has them.
// The renderer owns playback; the buttons send the same commands as the tray
// menu. Icons are drawn here at startup, so there are no image files to ship.

const { nativeImage, nativeTheme } = require('electron')

// Shapes in a 16x16 box. `inside(x, y)` is true for a covered point.
const triangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}
const rect = (x0, y0, w, h) => (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h
const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y))

// The classic heart curve, (x² + y² - 1)³ - x²y³ ≤ 0, centred in the box.
const heartAt = (scale) => (px, py) => {
  const x = (px - 8) / scale
  const y = -(py - 8.6) / scale
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y <= 0
}
const heartFilled = heartAt(6.4)
const heartOutline = (x, y) => heartFilled(x, y) && !heartAt(4.4)(x, y)

const SHAPES = {
  play: triangle(4.5, 2.5, 13.5, 8, 4.5, 13.5),
  pause: union(rect(3.5, 2.5, 3.2, 11), rect(9.3, 2.5, 3.2, 11)),
  next: union(triangle(2.5, 2.5, 10, 8, 2.5, 13.5), rect(10.6, 2.5, 2.4, 11)),
  previous: union(triangle(13.5, 2.5, 6, 8, 13.5, 13.5), rect(3, 2.5, 2.4, 11)),
  like: heartOutline,
  liked: heartFilled,
}

const SAMPLES = 4 // per axis, for anti-aliasing

/** Rasterize a shape into a BGRA buffer of `size`x`size` pixels. */
function rasterize(inside, size, [r, g, b]) {
  const buf = Buffer.alloc(size * size * 4)
  const step = 16 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inside((px + (sx + 0.5) / SAMPLES) * step, (py + (sy + 0.5) / SAMPLES) * step)) hits++
        }
      }
      const i = (py * size + px) * 4
      // Premultiplied BGRA, which is what Windows bitmaps expect.
      const a = hits / (SAMPLES * SAMPLES)
      buf[i] = Math.round(b * a)
      buf[i + 1] = Math.round(g * a)
      buf[i + 2] = Math.round(r * a)
      buf[i + 3] = Math.round(255 * a)
    }
  }
  return buf
}

function makeIcon(name, color) {
  const img = nativeImage.createEmpty()
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor)
    img.addRepresentation({ scaleFactor, width: size, height: size, buffer: rasterize(SHAPES[name], size, color) })
  }
  return img
}

/**
 * @param {{ getWindow: () => Electron.BrowserWindow | null, send: (cmd: string) => void, log?: (...a: any[]) => void }} opts
 */
function createThumbar({ getWindow, send, log = () => {} }) {
  if (process.platform !== 'win32') return { update() {}, attach() {} }

  let icons = null
  let iconsDark = null
  let state = { hasTrack: false, isPlaying: false, liked: false }

  // The preview flyout follows the taskbar's theme, not the app's.
  const darkTaskbar = () => nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors
  const iconSet = () => {
    const dark = darkTaskbar()
    if (!icons || iconsDark !== dark) {
      const color = dark ? [255, 255, 255] : [24, 24, 24]
      icons = Object.fromEntries(Object.keys(SHAPES).map((n) => [n, makeIcon(n, color)]))
      iconsDark = dark
    }
    return icons
  }

  function update(next) {
    if (next) state = { hasTrack: !!next.hasTrack, isPlaying: !!next.isPlaying, liked: !!next.liked }
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const i = iconSet()
    const flags = state.hasTrack ? [] : ['disabled']
    // Always the same four buttons: Windows can't add or remove thumbnail
    // buttons once the toolbar exists, only change them.
    try {
      win.setThumbarButtons([
        { tooltip: state.liked ? 'Unlike' : 'Like', icon: state.liked ? i.liked : i.like, flags, click: () => send('toggle-like') },
        { tooltip: 'Previous', icon: i.previous, flags, click: () => send('previous') },
        { tooltip: state.isPlaying ? 'Pause' : 'Play', icon: state.isPlaying ? i.pause : i.play, flags, click: () => send('play-pause') },
        { tooltip: 'Next', icon: i.next, flags, click: () => send('next') },
      ])
    } catch (e) {
      log('Thumbnail toolbar failed:', e.message)
    }
  }

  // Windows drops the buttons when a window is hidden (minimize to tray), so
  // put them back whenever it shows again.
  function attach(win) {
    win.on('show', () => update())
    win.once('ready-to-show', () => update())
  }

  nativeTheme.on('updated', () => update())

  return { update, attach }
}

module.exports = { createThumbar, rasterize, SHAPES }
