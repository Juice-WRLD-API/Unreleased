const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createDiscordBrowserLogin, redirectUriFor } = require('./discordLogin')

// A free port each run, so tests don't depend on 47613 being idle.
function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('net').AddressInfo} */ (s.address())
      s.close(() => resolve(port))
    })
  })
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

function authorizeUrl(redirectUri, state) {
  const u = new URL('https://discord.com/api/oauth2/authorize')
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

test('finishes with the code once the matching state comes back', async () => {
  const port = await freePort()
  const opened = []
  let done = null
  const login = createDiscordBrowserLogin({ port, openExternal: async (u) => { opened.push(u) }, onDone: (r) => { done = r } })
  const started = await login.start()
  assert.equal(started.redirectUri, redirectUriFor(port))
  const url = authorizeUrl(started.redirectUri, 'good')
  const waiting = login.wait(url)
  assert.deepEqual(opened, [url])

  // A different state is turned away and the login keeps waiting.
  const stale = await get(`${started.redirectUri}?code=x&state=other`)
  assert.equal(stale.status, 400)

  const ok = await get(`${started.redirectUri}?code=abc&state=good`)
  assert.equal(ok.status, 200)
  assert.deepEqual(await waiting, { code: 'abc', state: 'good' })
  assert.deepEqual(done, { code: 'abc', state: 'good' })

  // The port is released afterwards.
  await assert.rejects(get(`${started.redirectUri}?code=abc&state=good`))
})

test('a denied consent resolves as cancelled', async () => {
  const port = await freePort()
  const login = createDiscordBrowserLogin({ port, openExternal: async () => {} })
  const { redirectUri } = await login.start()
  const waiting = login.wait(authorizeUrl(redirectUri, 's'))
  await get(`${redirectUri}?error=access_denied&state=s`)
  assert.deepEqual(await waiting, { cancelled: true })
})

test('cancel resolves null and frees the port', async () => {
  const port = await freePort()
  const login = createDiscordBrowserLogin({ port, openExternal: async () => {} })
  const { redirectUri } = await login.start()
  const waiting = login.wait(authorizeUrl(redirectUri, 's'))
  login.cancel()
  assert.equal(await waiting, null)
  const again = await login.start()
  assert.ok(again)
  login.cancel()
})

test('refuses authorize URLs that are not Discord or point elsewhere', async () => {
  const port = await freePort()
  const opened = []
  const login = createDiscordBrowserLogin({ port, openExternal: async (u) => { opened.push(u) } })
  let { redirectUri } = await login.start()
  assert.equal(await login.wait(authorizeUrl(redirectUri, 's').replace('discord.com', 'evil.example')), null)
  ;({ redirectUri } = await login.start())
  assert.equal(await login.wait(authorizeUrl('https://player.juicewrldapi.com/auth/discord/callback', 's')), null)
  assert.deepEqual(opened, [])
})

test('start returns null when the port is taken', async () => {
  const port = await freePort()
  const blocker = http.createServer().listen(port, '127.0.0.1')
  await new Promise((r) => blocker.once('listening', r))
  try {
    const login = createDiscordBrowserLogin({ port, openExternal: async () => {} })
    assert.equal(await login.start(), null)
  } finally {
    blocker.close()
  }
})

test('times out', async () => {
  const port = await freePort()
  const login = createDiscordBrowserLogin({ port, waitMs: 30, openExternal: async () => {} })
  const { redirectUri } = await login.start()
  assert.equal(await login.wait(authorizeUrl(redirectUri, 's')), null)
})
