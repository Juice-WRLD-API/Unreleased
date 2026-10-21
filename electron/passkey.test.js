const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('fs')
const path = require('path')
const {
  PAGE_URL,
  pageFileFor,
  passkeySupport,
  sanitizeResult,
  validateCeremonyRequest,
} = require('./passkey')

test('ceremonies run on Windows 10 1903 and later only', () => {
  assert.equal(passkeySupport({ platform: 'win32', release: '10.0.19045' }).ceremonies, true)
  assert.equal(passkeySupport({ platform: 'win32', release: '10.0.22631' }).ceremonies, true)
  assert.equal(passkeySupport({ platform: 'win32', release: '10.0.17763' }).ceremonies, false)
  for (const platform of /** @type {NodeJS.Platform[]} */ (['darwin', 'linux'])) {
    const s = passkeySupport({ platform, release: '24.0.0' })
    assert.equal(s.ceremonies, false)
    assert.match(String(s.reason), /Windows/)
  }
})

test('only juicewrldapi.com options are passed to the ceremony window', () => {
  const get = validateCeremonyRequest({ mode: 'get', options: { challenge: 'abc', rpId: 'juicewrldapi.com' } })
  assert.equal(get.ok, true)
  const create = validateCeremonyRequest({ mode: 'create', options: { challenge: 'abc', rp: { id: 'juicewrldapi.com', name: 'x' } } })
  assert.equal(create.ok, true)

  const local = validateCeremonyRequest({ mode: 'get', options: { challenge: 'abc', rpId: 'localhost' } })
  assert.equal(local.ok, false)
  assert.match(local.ok ? '' : local.error, /localhost/)

  assert.equal(validateCeremonyRequest({ mode: 'sign', options: { challenge: 'abc', rpId: 'juicewrldapi.com' } }).ok, false)
  assert.equal(validateCeremonyRequest({ mode: 'get', options: { rpId: 'juicewrldapi.com' } }).ok, false)
  assert.equal(validateCeremonyRequest(null).ok, false)
  const huge = { challenge: 'abc', rpId: 'juicewrldapi.com', pad: 'x'.repeat(70 * 1024) }
  assert.equal(validateCeremonyRequest({ mode: 'get', options: huge }).ok, false)
})

test('ceremony results are reduced to ok, cancelled or error', () => {
  const credential = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'x' } }
  assert.deepEqual(sanitizeResult({ ok: true, credential }), { ok: true, credential })
  assert.deepEqual(sanitizeResult({ cancelled: true }), { cancelled: true })
  assert.deepEqual(sanitizeResult(undefined), { cancelled: true })
  assert.deepEqual(sanitizeResult({ error: 'nope' }), { error: 'nope' })
  assert.ok('error' in sanitizeResult({ ok: true, credential: { id: 'cred', type: 'password' } }))
  assert.equal(/** @type {{ error: string }} */ (sanitizeResult({ error: 'e'.repeat(1000) })).error.length, 300)
})

test('the intercepted origin serves the page files and nothing else', () => {
  assert.equal(pageFileFor(PAGE_URL)?.file, 'index.html')
  assert.equal(pageFileFor(`${PAGE_URL}passkey.js`)?.file, 'passkey.js')
  assert.equal(pageFileFor(`${PAGE_URL}passkey.css`)?.file, 'passkey.css')
  assert.equal(pageFileFor('https://player.juicewrldapi.com/'), null)
  assert.equal(pageFileFor('https://player.juicewrldapi.com/.well-known/webauthn'), null)
  assert.equal(pageFileFor(`${PAGE_URL}../passkey.js`), null)
  assert.equal(pageFileFor(`${PAGE_URL}?x=1`), null)
  assert.equal(pageFileFor('https://juicewrldapi.com/desktop-passkey/'), null)
  assert.equal(pageFileFor('http://player.juicewrldapi.com/desktop-passkey/'), null)
  for (const url of [PAGE_URL, `${PAGE_URL}passkey.js`, `${PAGE_URL}passkey.css`]) {
    const file = pageFileFor(url)?.file
    assert.ok(file && fs.existsSync(path.join(__dirname, 'passkey', file)), `${file} exists`)
  }
})

test('the ceremony page has no inline scripts or styles', () => {
  const html = fs.readFileSync(path.join(__dirname, 'passkey', 'index.html'), 'utf8')
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/)
  assert.doesNotMatch(html, /<style/)
  assert.doesNotMatch(html, /\sstyle=/)
  assert.doesNotMatch(html, /\son[a-z]+=/)
})
