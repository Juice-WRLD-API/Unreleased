const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { NativeSession, registerNativeSessions } = require('./nativeSession')

function child() {
  /** @type {any} Minimal subprocess double: only the streams used by this bridge. */
  const c = new EventEmitter()
  c.stdout = new EventEmitter()
  c.stdout.setEncoding = () => {}
  c.stderr = new EventEmitter()
  c.stdin = new EventEmitter()
  c.writes = []
  c.stdin.write = (data) => { c.writes.push(data); return true }
  c.kill = () => { c.killed = true }
  c.message = (data) => c.stdout.emit('data', JSON.stringify(data) + '\n')
  return c
}

test('native asset header and planar PCM stay together; ack completes the request', async () => {
  const c = child(), events = []
  const host = new NativeSession('host', (e) => events.push(e), () => c)
  c.stdout.emit('data', '{"type":"rea')
  c.stdout.emit('data', 'dy"}\n')
  await host.ready
  const left = new Float32Array([.1, .2]), right = new Float32Array([.3, .4])
  const asset = host.command({ op: 'asset', id: 'a', sampleRate: 48000 }, [left, right])
  const pause = host.command({ op: 'pause' })
  await new Promise((r) => setImmediate(r))
  assert.equal(c.writes.length, 4)
  assert.deepEqual(JSON.parse(c.writes[0]), { op: 'asset', id: 'a', sampleRate: 48000, request: 1, channels: 2, frames: 2 })
  assert.deepEqual(c.writes[1], Buffer.from(left.buffer))
  assert.deepEqual(c.writes[2], Buffer.from(right.buffer))
  assert.equal(JSON.parse(c.writes[3]).op, 'pause')
  c.message({ type: 'ack', request: 1 }); c.message({ type: 'ack', request: 2 })
  await Promise.all([asset, pause])
  assert.equal(host.pending.size, 0)
  host.close()
})

test('a native crash rejects outstanding commands and reports one failure', async () => {
  const c = child(), events = []
  const host = new NativeSession('host', (e) => events.push(e), () => c)
  c.message({ type: 'ready' })
  await host.ready
  const waiting = host.command({ op: 'play' })
  await new Promise((r) => setImmediate(r))
  c.emit('close', 1)
  await assert.rejects(waiting, /stopped unexpectedly/)
  c.emit('error', new Error('second error'))
  assert.equal(events.length, 1)
  assert.equal(c.killed, true)
})

test('closing while starting rejects readiness instead of leaving callers waiting', async () => {
  const c = child()
  const host = new NativeSession('host', () => {}, () => c)
  host.close()
  await assert.rejects(host.ready, /closed/)
  assert.equal(c.killed, true)
})

test('IPC rejects commands from a stale session and refuses opening without a helper', async () => {
  const handlers = new Map()
  registerNativeSessions({ app: new EventEmitter(), ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, helper: () => null })
  const sender = { id: 42 }
  assert.match((await handlers.get('session-native-open')({ sender }, 'a')).error, /Windows/)
  assert.match((await handlers.get('session-native-command')({ sender }, 'a', { op: 'play' })).error, /no longer active/)
})
