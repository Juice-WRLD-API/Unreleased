// The desktop's wallpaper, for the glass: a 640-pixel copy laid out the way Windows lays it on the main display, which
// the widgets blur and show under their glass, and a copy at the display's size, which the desk's curtain shows over
// every window. Both are files in the app's folder, reached through the local-media scheme. A new wallpaper makes new
// copies; with none to read, the glass is a darker one of its own and the curtain plain black.
const { app, screen, nativeImage } = require('electron')
const { execFile } = require('child_process')
const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')

const events = new EventEmitter()
/** @type {{ frost: string, full: string, version: number } | null} the files, once made */
let made = null
let version = 0
/** @type {Promise<unknown> | null} */
let making = null
let watching = false

const folder = () => path.join(app.getPath('userData'), 'desktop')
const themes = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes')

/** @returns {Promise<string | null>} */
function registry(name, key = 'HKCU\\Control Panel\\Desktop') {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true }, (error, out) => {
      resolve(error ? null : (String(out).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`)) || [])[1]?.trim() || null)
    })
  })
}

/** Windows' background color ("R G B" in the registry), as [r, g, b]. */
async function backgroundColor() {
  const value = await registry('Background', 'HKCU\\Control Panel\\Colors')
  const rgb = String(value || '0 0 0').split(/\s+/).map(Number)
  /** @type {[number, number, number]} */
  const color = rgb.length === 3 && rgb.every((n) => n >= 0 && n <= 255) ? [rgb[0], rgb[1], rgb[2]] : [0, 0, 0]
  return color
}

/** A picture of one color. */
function solid([r, g, b], width, height) {
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r; pixels[i + 3] = 255 }
  return nativeImage.createFromBitmap(pixels, { width, height })
}

/** The wallpaper's file and how it is laid out ('fill' or 'stretch'), or its solid color. */
async function source() {
  if (process.platform !== 'win32') return null
  // A solid color: Windows keeps the last picture's copy all the same - a picture the user no longer has.
  const type = await registry('BackgroundType', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers')
  if (type !== null && Number(type) === 1) return { color: await backgroundColor() }
  const style = await registry('WallpaperStyle')
  const layout = style === '2' ? 'stretch' : 'fill'
  const transcoded = path.join(themes(), 'TranscodedWallpaper')
  if (fs.existsSync(transcoded)) return { file: transcoded, layout }
  const file = await registry('WallPaper')
  return file && fs.existsSync(file) ? { file, layout } : null
}

/** The picture laid out over `width` × `height` as Windows lays it. */
function laidOut(image, layout, width, height) {
  if (layout === 'stretch') return image.resize({ width, height, quality: 'good' })
  // Filled: the picture covers the display, its middle kept.
  const size = image.getSize()
  const scale = Math.max(width / size.width, height / size.height)
  const w = Math.max(width, Math.round(size.width * scale)), h = Math.max(height, Math.round(size.height * scale))
  return image.resize({ width: w, height: h, quality: 'good' }).crop({ x: Math.floor((w - width) / 2), y: Math.floor((h - height) / 2), width, height })
}

async function make() {
  const found = await source()
  if (!found) return null
  const display = screen.getPrimaryDisplay()
  const frostSize = { width: 640, height: Math.round(640 * display.bounds.height / display.bounds.width) }
  const fullSize = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) }
  let frost, full
  if (found.color) {
    frost = solid(found.color, frostSize.width, frostSize.height)
    full = solid(found.color, 64, 64)
  } else {
    const image = nativeImage.createFromBuffer(fs.readFileSync(found.file))
    if (image.isEmpty()) return null
    frost = laidOut(image, found.layout, frostSize.width, frostSize.height)
    full = laidOut(image, found.layout, fullSize.width, fullSize.height)
  }
  const next = ++version
  fs.mkdirSync(folder(), { recursive: true })
  // Last time's copies go: only the newest pair is ever kept.
  for (const name of fs.readdirSync(folder())) if (/^(frost|wallpaper)-\d+\.jpg$/.test(name)) fs.rmSync(path.join(folder(), name), { force: true })
  const frostFile = path.join(folder(), `frost-${next}.jpg`)
  const fullFile = path.join(folder(), `wallpaper-${next}.jpg`)
  fs.writeFileSync(frostFile, frost.toJPEG(85))
  fs.writeFileSync(fullFile, full.toJPEG(90))
  return { frost: frostFile, full: fullFile, version: next }
}

/** Makes the copies again, and says so when they changed. */
function refresh() {
  if (making) return making
  making = make().catch((error) => { console.warn('[desktop] frost:', error.message); return null }).then((files) => {
    making = null
    const had = Boolean(made)
    made = files
    if (files || had) events.emit('change')
    return made
  })
  return making
}

/** Starts reading the wallpaper, and keeps up with a new one. */
function start() {
  if (!made) void refresh()
  if (watching || process.platform !== 'win32') return
  watching = true
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 800) }
  try { fs.watch(themes(), later) } catch { /* no folder: the frost stays as it is */ }
  screen.on('display-metrics-changed', later)
}

const asUrl = (file) => {
  const url = new URL('local-media://play/')
  url.searchParams.set('p', file)
  return url.toString()
}

/** The frost's address, or null with no wallpaper to frost. */
function frostUrl() { return made ? asUrl(made.frost) : null }
/** The wallpaper at the display's size, for the curtain. */
function wallpaperUrl() { return made ? asUrl(made.full) : null }

module.exports = { start, refresh, frostUrl, wallpaperUrl, on: (name, fn) => events.on(name, fn) }
