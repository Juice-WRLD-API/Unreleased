const assert = require('node:assert/strict')
const test = require('node:test')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { pipeName, cleanSnapshot, createLyricsBridge } = require('./ijwaLyrics')

test('shares only bounded current-song lyrics, never arbitrary renderer state', () => {
  const snapshot = cleanSnapshot({
    track: { id: 'jw-1', title: 'Song', artist: 'Artist', duration: 120, streamUrl: 'private' },
    plainLyrics: 'Words', syncedLyrics: '[00:01.00]Words', offset: 0.5, pending: false,
    account: { token: 'private' },
  })
  assert.deepEqual(snapshot, { track: { id: 'jw-1', title: 'Song', artist: 'Artist', duration: 120 },
    plainLyrics: 'Words', syncedLyrics: '[00:01.00]Words', offset: 0.5, pending: false })
  assert.equal(cleanSnapshot(null), null)
  assert.equal(cleanSnapshot({ track: { title: 123 } }), null)
  assert.equal(pipeName(true), pipeName(false) + '-dev')
})

test('readers get current and late-loaded lyrics; closing clears connections', async (t) => {
  const id = `unreleased-lyrics-test-${process.pid}`
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), id + '.sock')
  const bridge = createLyricsBridge({ endpoint })
  t.after(() => bridge.close())
  await once(bridge.server, 'listening')
  const client = net.createConnection(endpoint)
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const [initial] = await once(client, 'data')
  assert.equal(JSON.parse(initial).snapshot, null)
  const value = { track: { id: 'jw-1', title: 'Song', artist: 'Artist', duration: 120 }, plainLyrics: 'Loaded words' }
  bridge.publish(value)
  const [loaded] = await once(client, 'data')
  assert.equal(JSON.parse(loaded).snapshot.plainLyrics, 'Loaded words')
  bridge.publish(null)
  const [cleared] = await once(client, 'data')
  assert.equal(JSON.parse(cleared).snapshot, null)
})
