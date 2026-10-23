const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, dependencies, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib', relative), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, FormData, Headers,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

test('existing-server lyrics jobs work with a multipart-only endpoint without uploading audio', async () => {
  const requests = []
  const apiClient = load('apiClient.ts', { './apiCache': {} }, {
    fetch: async (url, init) => {
      const request = new Request(url, init)
      if (!request.headers.get('content-type')?.startsWith('multipart/form-data; boundary=')) {
        return Response.json({ detail: 'Unsupported media type "application/json" in request.' }, { status: 415 })
      }
      requests.push({ request, fields: Object.fromEntries(await request.formData()) })
      return Response.json({ id: 'job', status: 'queued' }, { status: 202 })
    },
  })
  const api = load('lyricsGenApi.ts', {
    './apiServers': { routeUrl: route => `https://example.test${route}` },
    './apiClient': apiClient,
    './userApi': { getToken: () => 'test-token' },
    './juicewrldApi': {},
    './donorFilesApi': { DONOR_ALLOWED_EXTENSIONS: [] },
    './donorPlayback': {},
  })
  const signal = new AbortController().signal
  const job = await api.createLyricsJobFromServer(
    { songId: 94316, path: 'Compilation/song.mp3' },
    { mode: 'synced', plainLyrics: 'First line\nSecond line', language: 'en' }, signal,
  )
  assert.equal(job.status, 'queued')
  assert.equal(requests[0].request.url, 'https://example.test/accounts/donor/lyrics/jobs/')
  assert.equal(requests[0].request.method, 'POST')
  assert.equal(requests[0].request.headers.get('authorization'), 'Token test-token')
  assert.deepEqual(requests[0].fields, {
    song_id: '94316', mode: 'synced', plain_lyrics: 'First line\r\nSecond line', language: 'en',
  })
  await api.createLyricsJobFromServer(
    { path: 'Comp/Some song.mp3', channel: 'legacy' },
    { mode: 'synced', syncedLyrics: '[00:01.00]Line' },
  )
  assert.deepEqual(requests[1].fields, {
    file_path: 'Comp/Some song.mp3', channel: 'legacy', mode: 'synced', synced_lyrics: '[00:01.00]Line',
  })
  await api.createLyricsJobFromServer({ path: 'Comp/song.mp3' }, { mode: 'plain' })
  assert.deepEqual(requests[2].fields, { file_path: 'Comp/song.mp3', mode: 'plain' })
})
