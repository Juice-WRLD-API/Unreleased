const fs = require('fs')
const path = require('path')

// Passkeys (WebAuthn) for the desktop app.
//
// The server's relying party is juicewrldapi.com and it only accepts
// responses made on https://juicewrldapi.com or https://player.juicewrldapi.com.
// The app itself loads from file:// (or localhost in dev), where Chromium
// refuses that RP ID. So each ceremony runs in a small window of its own, on a
// separate in-memory session where https://player.juicewrldapi.com/desktop-passkey/
// is answered from the files next to this module instead of the network.
// Chromium then treats the page as that origin and allows the RP ID. Every
// other request from that session gets a 404, so nothing else loads there.
//
// The page only runs navigator.credentials.create/get on options the main
// window fetched, and hands the credential JSON back. It never sees the
// account token and never talks to the API.

const PASSKEY_HOST = 'player.juicewrldapi.com'
const PASSKEY_ORIGIN = `https://${PASSKEY_HOST}`
const PAGE_DIR = '/desktop-passkey/'
const PAGE_URL = `${PASSKEY_ORIGIN}${PAGE_DIR}`
const PARTITION = 'passkey-ceremony'
const RP_IDS = new Set(['juicewrldapi.com', PASSKEY_HOST])
const MAX_JSON = 64 * 1024

const PAGE_FILES = {
  [PAGE_DIR]: { file: 'index.html', type: 'text/html; charset=utf-8' },
  [`${PAGE_DIR}passkey.js`]: { file: 'passkey.js', type: 'text/javascript; charset=utf-8' },
  [`${PAGE_DIR}passkey.css`]: { file: 'passkey.css', type: 'text/css; charset=utf-8' },
}

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Where the ceremony can run. Electron 42 sends WebAuthn to Windows' own API
 * (webauthn.dll, Windows 10 1903+), which brings its own prompt for Windows
 * Hello, security keys (PIN included) and phones. On macOS and Linux Electron
 * uses Chromium's own security-key code with no UI: a key that needs a PIN
 * crashes the main process (electron/electron#54317, fixed from 43.x), there
 * is no phone/QR option, and Touch ID needs a signed build with a keychain
 * entitlement (app.configureWebAuthn). So those two only manage passkeys.
 * @param {{ platform?: NodeJS.Platform, release?: string }} [env]
 * @returns {{ ceremonies: boolean, reason: string | null }}
 */
function passkeySupport({ platform = process.platform, release = require('os').release() } = {}) {
  if (platform === 'win32') {
    const build = Number(String(release).split('.')[2])
    if (Number.isFinite(build) && build >= 18362) return { ceremonies: true, reason: null }
    return { ceremonies: false, reason: 'Passkeys need Windows 10 version 1903 or later.' }
  }
  return {
    ceremonies: false,
    reason: 'The desktop app can only create and use passkeys on Windows for now. On this computer, use player.juicewrldapi.com in your browser.',
  }
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function jsonSize(v) {
  try { return JSON.stringify(v).length } catch { return Infinity }
}

/**
 * Checks what the main window asks for: `mode` is `create` or `get`, and
 * `options` is the server's WebAuthn JSON for a juicewrldapi.com RP ID (any
 * other RP ID would fail on this origin anyway, so it is refused up front with
 * a clearer message).
 * @param {unknown} req
 * @returns {{ ok: true, mode: 'create' | 'get', options: Record<string, unknown> } | { ok: false, error: string }}
 */
function validateCeremonyRequest(req) {
  if (!isObject(req)) return { ok: false, error: 'Invalid passkey request.' }
  const { mode, options } = /** @type {Record<string, any>} */ (req)
  if (mode !== 'create' && mode !== 'get') return { ok: false, error: 'Invalid passkey request.' }
  if (!isObject(options) || typeof options.challenge !== 'string' || jsonSize(options) > MAX_JSON) {
    return { ok: false, error: 'Invalid passkey options.' }
  }
  const rpId = mode === 'create' ? options.rp?.id : options.rpId
  if (typeof rpId !== 'string' || !RP_IDS.has(rpId)) {
    return { ok: false, error: `This server's passkeys belong to ${rpId || 'another site'}. The desktop app can only use juicewrldapi.com passkeys.` }
  }
  return { ok: true, mode, options }
}

/**
 * What the ceremony page reports back, cut down to the three outcomes the
 * renderer understands.
 * @param {unknown} result
 * @returns {{ ok: true, credential: Record<string, unknown> } | { cancelled: true } | { error: string }}
 */
function sanitizeResult(result) {
  if (!isObject(result)) return { cancelled: true }
  const r = /** @type {Record<string, any>} */ (result)
  if (r.ok === true) {
    const c = r.credential
    if (isObject(c) && typeof c.id === 'string' && c.type === 'public-key' && isObject(c.response) && jsonSize(c) <= MAX_JSON) {
      return { ok: true, credential: c }
    }
    return { error: 'The passkey prompt returned something unexpected.' }
  }
  if (typeof r.error === 'string' && r.error) return { error: r.error.slice(0, 300) }
  return { cancelled: true }
}

/** The page file for a request URL, or null for anything else. @param {string} url */
function pageFileFor(url) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || u.host !== PASSKEY_HOST || u.search) return null
  return PAGE_FILES[u.pathname] || null
}

/**
 * @param {{
 *   ipcMain: Electron.IpcMain,
 *   BrowserWindow: typeof Electron.BrowserWindow,
 *   session: typeof Electron.session,
 *   getMainWindow: () => Electron.BrowserWindow | null,
 *   iconPath?: string,
 *   isDev?: boolean,
 * }} deps
 */
function registerPasskeyIpc({ ipcMain, BrowserWindow, session, getMainWindow, iconPath, isDev = false }) {
  const support = passkeySupport()
  const pageRoot = path.join(__dirname, 'passkey')
  /** @type {{ win: Electron.BrowserWindow, mode: 'create' | 'get', options: Record<string, unknown>, finish: (r: any) => void } | null} */
  let active = null
  /** @type {Electron.Session | null} */
  let ses = null

  function ceremonySession() {
    if (ses) return ses
    ses = session.fromPartition(PARTITION)
    ses.protocol.handle('https', (request) => {
      const page = pageFileFor(request.url)
      if (!page || request.method !== 'GET') return new Response('Not found', { status: 404 })
      try {
        return new Response(fs.readFileSync(path.join(pageRoot, page.file)), {
          headers: { 'content-type': page.type, 'content-security-policy': PAGE_CSP, 'cache-control': 'no-store' },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    // Windows shows its own account picker, so this only fires if Chromium's
    // own security-key code finds several passkeys. With one there is nothing
    // to ask; with more, cancel rather than pick for the user.
    ses.on('select-webauthn-account', (_event, details, callback) => {
      if (details.accounts.length === 1) callback(details.accounts[0].credentialId)
      else callback()
    })
    return ses
  }

  ipcMain.handle('passkey-support', () => support)

  ipcMain.handle('passkey-ceremony', (event, req) => {
    const main = getMainWindow()
    if (!main || main.isDestroyed() || event.sender !== main.webContents) return { error: 'Not allowed.' }
    if (!support.ceremonies) return { error: support.reason }
    const checked = validateCeremonyRequest(req)
    if (checked.ok === false) return { error: checked.error }
    if (active) {
      if (!active.win.isDestroyed()) active.win.focus()
      return { error: 'A passkey prompt is already open.' }
    }

    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 420, height: 300,
        parent: main, modal: false,
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        title: checked.mode === 'create' ? 'Add a passkey' : 'Sign in with a passkey',
        backgroundColor: '#121212',
        icon: iconPath,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          session: ceremonySession(),
          preload: path.join(__dirname, 'passkeyPreload.js'),
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
          spellcheck: false, devTools: isDev,
        },
      })
      win.setMenu(null)
      win.on('page-title-updated', (e) => e.preventDefault())
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (e) => e.preventDefault())
      win.webContents.on('will-redirect', (e) => e.preventDefault())

      let done = false
      const finish = (result) => {
        if (done) return
        done = true
        active = null
        resolve(sanitizeResult(result))
        if (!win.isDestroyed()) win.close()
      }
      active = { win, mode: checked.mode, options: checked.options, finish }
      win.on('closed', () => finish({ cancelled: true }))
      win.webContents.on('render-process-gone', () => finish({ error: 'The passkey window stopped unexpectedly.' }))
      win.once('ready-to-show', () => { win.show(); win.focus() })
      win.loadURL(PAGE_URL).catch(() => finish({ error: 'Could not open the passkey window.' }))
    })
  })

  // The ceremony page asks for its job once, then reports how it went.
  ipcMain.handle('passkey-window:request', (event) => {
    if (!active || active.win.isDestroyed() || event.sender !== active.win.webContents) return null
    if (event.senderFrame?.url !== PAGE_URL) return null
    return { mode: active.mode, options: active.options }
  })

  ipcMain.on('passkey-window:result', (event, result) => {
    if (!active || active.win.isDestroyed() || event.sender !== active.win.webContents) return
    active.finish(result)
  })
}

module.exports = {
  PASSKEY_ORIGIN,
  PAGE_URL,
  passkeySupport,
  validateCeremonyRequest,
  sanitizeResult,
  pageFileFor,
  registerPasskeyIpc,
}
