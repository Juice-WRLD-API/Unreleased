// Discord sign-in in the user's own browser. The in-app window starts with no
// Discord cookies and no password manager, so the user had to type their
// Discord login every time. Instead the app listens on a fixed loopback port,
// opens Discord's authorize page with the default browser, and takes the code
// from the redirect. The backend allows any http://127.0.0.1:<port> redirect on
// /auth/discord/callback; Discord only allows the exact URI registered for the
// application, so REDIRECT_URI must be listed in the Discord developer portal.
const http = require('http')

const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PORT = 47613
const CALLBACK_PATH = '/auth/discord/callback'
// The server signs `state` for 10 minutes; waiting longer can't succeed.
const WAIT_MS = 10 * 60 * 1000

function redirectUriFor(port) {
  return `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f12;color:#e8e8ec;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:340px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#a0a0aa}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

/**
 * @param {{ openExternal: (url: string) => Promise<unknown>, onDone?: (result: any) => void, port?: number, waitMs?: number }} opts
 */
function createDiscordBrowserLogin({ openExternal, onDone = (_result) => {}, port = CALLBACK_PORT, waitMs = WAIT_MS }) {
  const redirectUri = redirectUriFor(port)
  // { server, state, resolve, timer } while a login is open.
  /** @type {{ server: any, state: string | null, resolve: ((r: any) => void) | null, timer: any, result: any } | null} */
  let pending = null

  function finish(result) {
    if (!pending) return
    const p = pending
    pending = null
    clearTimeout(p.timer)
    p.server.close()
    // Drop the browser's keep-alive socket so the port frees at once.
    if (typeof p.server.closeAllConnections === 'function') setImmediate(() => p.server.closeAllConnections())
    if (p.resolve) p.resolve(result)
    else p.result = result
    if (result) onDone(result)
  }

  function handle(p, req, res) {
    const send = (status, title, body) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
      res.end(page(title, body))
    }
    let url
    try { url = new URL(req.url || '/', redirectUri) } catch { return send(400, 'Bad request', '') }
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) return send(404, 'Not found', '')
    const state = url.searchParams.get('state')
    // Only the login this app started may finish it. Anything else (an old
    // tab, another page poking the port) is turned away without ending it.
    if (pending !== p || !p.state || state !== p.state) {
      return send(400, 'This sign-in link has expired', 'Start again from Unreleased.')
    }
    if (url.searchParams.get('error')) {
      send(200, 'Sign-in cancelled', 'You can close this tab and go back to Unreleased.')
      return finish({ cancelled: true })
    }
    const code = url.searchParams.get('code')
    if (!code) return send(400, 'Something went wrong', 'Discord sent no code. Start again from Unreleased.')
    send(200, 'Signed in to Unreleased', 'You can close this tab and go back to the app.')
    finish({ code, state })
  }

  // Binds the port and returns the redirect URI to ask the API for, or null
  // when the port can't be used (the caller falls back to the in-app window).
  function start() {
    cancel()
    return new Promise((resolve) => {
      /** @type {{ server: any, state: string | null, resolve: ((r: any) => void) | null, timer: any, result: any }} */
      const p = { server: null, state: null, resolve: null, timer: null, result: undefined }
      const server = http.createServer((req, res) => handle(p, req, res))
      p.server = server
      server.once('error', () => resolve(null))
      server.listen(port, CALLBACK_HOST, () => {
        pending = p
        p.timer = setTimeout(() => finish(null), waitMs)
        resolve({ redirectUri })
      })
    })
  }

  // Opens the authorize URL in the default browser and resolves with
  // { code, state }, { cancelled: true }, or null (timed out, cancelled here,
  // or the URL isn't one this login can finish).
  async function wait(authorizeUrl) {
    const p = pending
    if (!p) return null
    let parsed
    try { parsed = new URL(authorizeUrl) } catch { finish(null); return null }
    const state = parsed.searchParams.get('state')
    if (parsed.origin !== 'https://discord.com' || parsed.searchParams.get('redirect_uri') !== redirectUri || !state) {
      finish(null)
      return null
    }
    p.state = state
    const result = new Promise((resolve) => {
      if (p.result !== undefined) resolve(p.result)
      else p.resolve = resolve
    })
    try {
      await openExternal(authorizeUrl)
    } catch {
      finish(null)
    }
    return result
  }

  function cancel() {
    finish(null)
  }

  return { start, wait, cancel, redirectUri }
}

module.exports = { createDiscordBrowserLogin, CALLBACK_PORT, CALLBACK_PATH, redirectUriFor }
