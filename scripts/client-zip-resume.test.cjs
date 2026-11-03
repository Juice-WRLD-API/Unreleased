const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const source = fs.readFileSync('src/renderer/src/lib/clientZip.ts', 'utf8').replaceAll('\r\n', '\n')
const from = source.indexOf('async function fetchItemRaw'), to = source.indexOf('/** Two selected folders')
assert.ok(from >= 0 && to > from)
// Same code, shorter clocks.
const block = source.slice(from, to)
  .replace('const STALL_MS = 30_000', 'const STALL_MS = 60')
  .replace('}, 5000)', '}, 10)')
  .replace('Math.min(2000 * 2 ** (attempt - 1), 20_000)', '1')

const FILE = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)
const ETAG = '"v1"'

/** A served copy of FILE from `start`: sends `cut` bytes then stalls ('hang'), errors ('drop') or ends early ('close'). */
function serve(start, opts = {}) {
  const { status = start ? 206 : 200, cut, after = 'hang', etag = ETAG, rangeStart = start } = opts
  return (signal) => {
    const bytes = FILE.slice(start, cut == null ? FILE.length : start + cut)
    // Pull-based, like a socket: what arrived is read before the failure is.
    let at = 0
    const body = new ReadableStream({
      start(c) { signal?.addEventListener('abort', () => { try { c.error(signal.reason) } catch {} }) },
      pull(c) {
        if (at < bytes.length) { c.enqueue(bytes.slice(at, at + 100)); at += 100; return }
        if (cut == null || after === 'close') c.close()
        else if (after === 'drop') c.error(new TypeError('network error'))
        else return new Promise(() => {})
      },
    })
    const headers = { 'content-length': String(FILE.length - start), etag }
    if (status === 206) headers['content-range'] = `bytes ${rangeStart}-${FILE.length - 1}/${FILE.length}`
    return new Response(status === 503 || status === 404 ? null : body, { status, headers })
  }
}

function load(responses) {
  const calls = []
  const logs = []
  const env = {
    AbortController, DOMException, ReadableStream, Response, Error, TypeError, Number, String, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { warn: (m) => logs.push(m) }, runLog() {},
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { onLine: true },
    cdnService: { tryDownload: async () => null },
    fetch: async (url, init = {}) => {
      calls.push(init.headers?.Range ?? 'full')
      const next = responses.shift()
      assert.ok(next, `unexpected request ${init.headers?.Range ?? ''}`)
      return next(init.signal)
    },
  }
  vm.createContext(env)
  vm.runInContext(`${compile(block)}\nglobalThis.fetchItemRaw = fetchItemRaw`, env)
  return { env, calls, logs }
}
const item = { name: 'Folder/Song.wav', url: 'https://audio.test/song.wav' }
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer())

test('a whole file passes through untouched, with its headers', async () => {
  const { env, calls } = load([serve(0)])
  const res = await env.fetchItemRaw(item)
  assert.equal(res.headers.get('content-length'), '1000')
  assert.deepEqual(await bytesOf(res), FILE)
  assert.deepEqual(calls, ['full'])
})
test('a file that stops sending resumes where it stopped', async () => {
  const { env, calls, logs } = load([serve(0, { cut: 400 }), serve(400)])
  assert.deepEqual(await bytesOf(await env.fetchItemRaw(item)), FILE)
  assert.deepEqual(calls, ['full', 'bytes=400-'])
  assert.ok(logs.some((l) => /no data for/.test(l) && /resuming \(1\/5\)/.test(l)))
})
test('a dropped or cut-short connection resumes too, more than once', async () => {
  const { env, calls } = load([serve(0, { cut: 300, after: 'drop' }), serve(300, { cut: 300, after: 'close' }), serve(600)])
  assert.deepEqual(await bytesOf(await env.fetchItemRaw(item)), FILE)
  assert.deepEqual(calls, ['full', 'bytes=300-', 'bytes=600-'])
})
test('a resume that is not the same file fails with the reason instead of joining wrong bytes', async () => {
  for (const wrong of [serve(0, { status: 200 }), serve(400, { etag: '"v2"' }), serve(400, { rangeStart: 0 })]) {
    const { env } = load([serve(0, { cut: 400, after: 'drop' }), wrong])
    const res = await env.fetchItemRaw(item)
    await assert.rejects(res.arrayBuffer(), /Couldn't download "Song.wav": the server sent the file again/)
  }
})
test('it gives up after five resumes and says why', async () => {
  const flaky = [serve(0, { cut: 100, after: 'drop' })]
  for (let i = 1; i <= 5; i++) flaky.push(serve(i * 100, { cut: 100, after: 'drop' }))
  const { env } = load(flaky)
  await assert.rejects((await env.fetchItemRaw(item)).arrayBuffer(), /the connection kept dropping \(network error\)/)
})
test('the first request is retried on 503 and left out on 404', async () => {
  const retried = load([serve(0, { status: 503 }), serve(0)])
  assert.deepEqual(await bytesOf(await retried.env.fetchItemRaw(item)), FILE)
  const missing = load([serve(0, { status: 404 })])
  assert.equal(await missing.env.fetchItemRaw(item), null)
  assert.ok(missing.logs.some((l) => /HTTP 404, left out/.test(l)))
})
test('cancelling the ZIP stops a resume instead of retrying', async () => {
  const ctrl = new AbortController()
  const { env, calls } = load([serve(0, { cut: 400 })])
  const res = await env.fetchItemRaw(item, ctrl.signal)
  const read = res.arrayBuffer()
  setTimeout(() => ctrl.abort(new DOMException('Cancelled', 'AbortError')), 20)
  await assert.rejects(read, /Cancelled/)
  assert.deepEqual(calls, ['full'])
})
