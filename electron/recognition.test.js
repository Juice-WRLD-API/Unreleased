const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const { canRequestMicrophone, canCaptureSystemAudio, canUseFileSystem } = require('./microphonePermission')

function loadRenderer(name, imports = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib', name + '.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const loaded = { exports: {} }
  Function('require', 'module', 'exports', ...Object.keys(globals), compiled.outputText)(
    (id) => { if (!(id in imports)) throw new Error(`Unexpected import: ${id}`); return imports[id] },
    loaded, loaded.exports, ...Object.values(globals),
  )
  return loaded.exports
}

const contract = loadRenderer('recognitionContract')
const candidate = { song_id: 7, recording_id: 'take-1', title: 'Song', artist: 'Artist', version: null, image_url: null, offset_seconds: 45 }
const result = (status, matches) => ({ contract_version: 1, status, matches })

test('recognition accepts explicit match, ambiguity and abstention contracts', () => {
  assert.equal(contract.parseRecognitionStatus({ contract_version: 1, available: false }), false)
  assert.equal(contract.parseRecognitionStatus({ contract_version: 1, available: true }), true)
  for (const value of [result('match', [candidate]), result('ambiguous', [candidate, { ...candidate, recording_id: 'take-2' }]), result('no_match', [])]) {
    assert.deepEqual(contract.parseRecognitionResult(value), value)
  }
})

test('recognition rejects malformed or misleading matches', () => {
  for (const value of [null, {}, result('match', []), result('no_match', [candidate]), result('ambiguous', [candidate]),
    result('ambiguous', [candidate, candidate]), result('match', [{ ...candidate, song_id: -1 }]),
    result('match', [{ ...candidate, offset_seconds: Infinity }]), result('match', [{ ...candidate, title: '' }]),
    { ...result('match', [candidate]), contract_version: 2 }]) assert.throws(() => contract.parseRecognitionResult(value))
  assert.throws(() => contract.parseRecognitionStatus({ available: true }))
  assert.throws(() => contract.validateRecognitionClip(new Blob()))
  assert.throws(() => contract.validateRecognitionClip(new Blob([new Uint8Array(contract.RECOGNITION_MAX_BYTES + 1)])))
})

test('microphone permission is restricted to the app main frame and audio', () => {
  const request = { url: 'file:///C:/app/dist/index.html', mainUrl: 'file:///C:/app/dist/index.html', appUrl: 'file:///C:/app/dist/index.html', isDev: false, isMainWindow: true, isMainFrame: true, mediaTypes: ['audio'] }
  assert.equal(canRequestMicrophone(request), true)
  // The router's pushState rewrites the frame URL; the loaded document is what counts.
  assert.equal(canRequestMicrophone({ ...request, url: 'file:///C:/tracker' }), true)
  assert.equal(canCaptureSystemAudio({ ...request, url: 'file:///C:/tracker', audioRequested: true, platform: 'win32' }), true)
  for (const patch of [{ mainUrl: 'file:///C:/other/index.html' }, { mainUrl: '' }, { url: 'file://evil-host/C:/tracker' }, { mainUrl: 'https://example.com' }, { isMainFrame: false }, { isMainWindow: false }, { mediaTypes: ['video'] }, { mediaTypes: ['audio', 'video'] }, { mediaTypes: [] }, { url: 'https://example.com' }]) {
    assert.equal(canRequestMicrophone({ ...request, ...patch }), false)
  }
  assert.equal(canRequestMicrophone({ ...request, isDev: true, url: 'http://localhost:3018/tracker', mainUrl: 'http://localhost:3018/' }), true)
  assert.equal(canRequestMicrophone({ ...request, isDev: true, url: 'http://localhost:3018.evil.test/', mainUrl: 'http://localhost:3018/' }), false)
})

test('file system access is limited to the app origin', () => {
  // Checks arrive with the bare origin, requests with the frame URL.
  for (const origin of ['file:///', 'file:///C:/tracker']) assert.equal(canUseFileSystem({ origin, isDev: false }), true)
  for (const origin of ['', 'null', 'file://evil-host/share', 'https://juicewrldapi.com', 'http://localhost:3018']) {
    assert.equal(canUseFileSystem({ origin, isDev: false }), false)
  }
  assert.equal(canUseFileSystem({ origin: 'http://localhost:3018/', isDev: true }), true)
  for (const origin of ['http://localhost:3018.evil.test/', 'file:///', 'https://juicewrldapi.com']) {
    assert.equal(canUseFileSystem({ origin, isDev: true }), false)
  }
})

test('packaged macOS app and helpers declare microphone access', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  assert.match(pkg.build.mac.extendInfo.NSMicrophoneUsageDescription, /microphone/)
  for (const file of [pkg.build.mac.entitlements, pkg.build.mac.entitlementsInherit]) {
    const plist = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.match(plist, /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/)
    assert.match(plist, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/)
  }
})

function captureHarness() {
  let grant
  let deny
  let recorder
  let contextClosed = false
  const pending = new Promise((resolve, reject) => { grant = resolve; deny = reject })
  const track = { stopped: false, onended: null, stop() { this.stopped = true } }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const timers = new Map()
  const setTimer = (fn, delay) => { const key = {}; timers.set(key, { fn, delay }); return key }
  const clearTimer = (key) => timers.delete(key)
  class Recorder {
    state = 'inactive'
    mimeType = 'audio/webm;codecs=opus'
    ondataavailable = null
    onstop = null
    onerror = null
    static isTypeSupported() { return true }
    constructor() { recorder = this }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) })
      this.onstop?.()
    }
  }
  class Context {
    createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (samples) => samples.fill(128) } }
    createMediaStreamSource() { return { connect() {} } }
    resume() { return Promise.resolve() }
    close() { contextClosed = true; return Promise.resolve() }
  }
  const capture = loadRenderer('recognitionCapture', { './recognitionContract': contract }, {
    navigator: { mediaDevices: { getUserMedia: () => pending } }, MediaRecorder: Recorder, AudioContext: Context,
    setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, clearInterval: clearTimer,
  })
  return { capture, stream, track, timers, grant: () => grant(stream), deny: (error) => deny(error), recorder: () => recorder, contextClosed: () => contextClosed,
    fire: (delay) => { const entry = [...timers.values()].find(timer => timer.delay === delay); assert.ok(entry); entry.fn() } }
}

test('cancel while permission is pending stops a late-granted microphone', async () => {
  const h = captureHarness()
  const controller = new AbortController()
  const pending = h.capture.recordRecognitionClip(controller.signal, () => assert.fail('Must not start after cancellation'))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  h.grant()
  await Promise.resolve()
  assert.equal(h.track.stopped, true)
  assert.equal(h.timers.size, 0)
})

test('successful recording returns final recorder data and releases all resources', async () => {
  const h = captureHarness()
  const pending = h.capture.recordRecognitionClip(new AbortController().signal, () => {})
  h.grant()
  await Promise.resolve()
  h.fire(contract.RECOGNITION_SECONDS * 1000)
  const clip = await pending
  assert.equal(await clip.text(), 'audio')
  assert.equal(clip.type, 'audio/webm;codecs=opus')
  assert.equal(h.track.stopped, true)
  assert.equal(h.contextClosed(), true)
  assert.equal(h.timers.size, 0)
})

test('cancelling an active recording stops tracks, recorder and meter', async () => {
  const h = captureHarness()
  const controller = new AbortController()
  const pending = h.capture.recordRecognitionClip(controller.signal, () => {})
  h.grant()
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(h.recorder().state, 'inactive')
  assert.equal(h.track.stopped, true)
  assert.equal(h.contextClosed(), true)
  assert.equal(h.timers.size, 0)
})

test('device disconnection fails the recording and releases resources', async () => {
  const h = captureHarness()
  const pending = h.capture.recordRecognitionClip(new AbortController().signal, () => {})
  h.grant()
  await Promise.resolve()
  h.track.onended()
  await assert.rejects(pending, /disconnected/)
  assert.equal(h.track.stopped, true)
  assert.equal(h.timers.size, 0)
})

test('permission denial is actionable and leaves no active timers', async () => {
  const h = captureHarness()
  const pending = h.capture.recordRecognitionClip(new AbortController().signal, () => {})
  h.deny(new DOMException('Denied', 'NotAllowedError'))
  await assert.rejects(pending, /access was denied/)
  assert.equal(h.timers.size, 0)
})

test('permission timeout also stops a stream granted afterwards', async () => {
  const h = captureHarness()
  const pending = h.capture.recordRecognitionClip(new AbortController().signal, () => assert.fail('Timed out'))
  h.fire(30_000)
  await assert.rejects(pending, /took too long/)
  h.grant()
  await Promise.resolve()
  assert.equal(h.track.stopped, true)
  assert.equal(h.timers.size, 0)
})

test('a stalled recorder cannot leave the microphone running indefinitely', async () => {
  const h = captureHarness()
  const pending = h.capture.recordRecognitionClip(new AbortController().signal, () => {})
  h.grant()
  await Promise.resolve()
  h.fire((contract.RECOGNITION_SECONDS + 5) * 1000)
  await assert.rejects(pending, /did not finish/)
  assert.equal(h.track.stopped, true)
  assert.equal(h.contextClosed(), true)
  assert.equal(h.timers.size, 0)
})

function apiHarness(request) {
  return loadRenderer('recognitionApi', {
    './apiClient': { apiRequest: request, authHeaders: (token) => ({ Authorization: `Token ${token}` }) },
    './apiServers': { routeUrl: (route) => `https://configured.test/juicewrld${route}` },
    './userApi': { getToken: () => 'test-token' }, './recognitionContract': contract,
  })
}

test('API uses route configuration, optional auth and anonymous multipart filename', async () => {
  const calls = []
  const api = apiHarness(async (url, options) => { calls.push({ url, options }); return result('match', [candidate]) })
  await api.identifyClip(new File(['audio'], 'private-filename.wav', { type: 'audio/wav' }), new AbortController().signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://configured.test/juicewrld/recognition/')
  assert.equal(calls[0].options.headers.Authorization, 'Token test-token')
  assert.equal(calls[0].options.headers['Content-Type'], undefined)
  assert.equal(calls[0].options.body.get('audio').name, 'clip')
  assert.equal(calls[0].options.body.get('audio').type, 'audio/wav')
})

test('missing backend is reported as unavailable, without automatic retries', async () => {
  let calls = 0
  const api = apiHarness(async (_url, options) => {
    calls++
    throw new Error(await options.parseError(new Response(null, { status: 404 })))
  })
  await assert.rejects(api.checkRecognition(new AbortController().signal), /not available yet/)
  assert.equal(calls, 1)
})

test('API abort propagates to the in-flight upload', async () => {
  const controller = new AbortController()
  const api = apiHarness((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
  }))
  const pending = api.identifyClip(new Blob(['audio']), controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('an HTML fallback response produces a useful error instead of parser output', async () => {
  const api = apiHarness(async () => { throw new SyntaxError('Unexpected token <') })
  await assert.rejects(api.checkRecognition(new AbortController().signal), /unsupported response/)
})

test('device audio capture is Windows-only and restricted to the app main frame', () => {
  const request = { url: 'file:///C:/app/dist/index.html', mainUrl: 'file:///C:/app/dist/index.html', appUrl: 'file:///C:/app/dist/index.html', isDev: false, isMainWindow: true, isMainFrame: true, audioRequested: true, platform: 'win32' }
  assert.equal(canCaptureSystemAudio(request), true)
  for (const patch of [{ platform: 'darwin' }, { platform: 'linux' }, { audioRequested: false }, { isMainFrame: false }, { isMainWindow: false }, { url: 'https://example.com' }, { mainUrl: 'file:///C:/other/index.html' }]) {
    assert.equal(canCaptureSystemAudio({ ...request, ...patch }), false)
  }
})

test('device audio drops the screen track and records only audio', async () => {
  const audio = { kind: 'audio', stopped: false, onended: null, stop() { this.stopped = true } }
  const video = { kind: 'video', stopped: false, onended: null, stop() { this.stopped = true } }
  const display = { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] }
  /** @type {any} */
  let recorded
  /** @type {any} */
  let asked
  const timers = new Map()
  const setTimer = (fn, delay) => { const key = {}; timers.set(key, { fn, delay }); return key }
  const clearTimer = (key) => timers.delete(key)
  class Recorder {
    state = 'inactive'
    mimeType = 'audio/webm;codecs=opus'
    /** @type {any} */ ondataavailable = null
    /** @type {any} */ onstop = null
    static isTypeSupported() { return true }
    /** @param {any} stream */
    constructor(stream) { recorded = stream }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() }
  }
  class Stream { constructor(tracks) { this.tracks = tracks } getTracks() { return this.tracks } getAudioTracks() { return this.tracks } }
  const capture = loadRenderer('recognitionCapture', { './recognitionContract': contract }, {
    navigator: { mediaDevices: { getDisplayMedia: async (options) => { asked = options; return display } } },
    MediaRecorder: Recorder, MediaStream: Stream, AudioContext: undefined,
    setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, clearInterval: clearTimer,
  })
  const pending = capture.recordRecognitionClip(new AbortController().signal, () => {}, 'system')
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(asked.audio && asked.video)
  assert.equal(video.stopped, true)
  assert.deepEqual(recorded.getTracks(), [audio])
  ;[...timers.values()].find(timer => timer.delay === contract.RECOGNITION_SECONDS * 1000).fn()
  assert.equal(await (await pending).text(), 'audio')
  assert.equal(audio.stopped, true)
  assert.equal(timers.size, 0)
})

const file = loadRenderer('recognitionFile', { './recognitionContract': contract })

test('files pick the loudest window and slice it into a short mono WAV', async () => {
  const rate = 100
  const samples = new Float32Array(60 * rate).fill(0.01)
  samples.fill(0.8, 30 * rate, 42 * rate)
  const start = file.loudestStart(samples, rate, 10)
  assert.ok(start >= 30 && start <= 32, `start ${start}`)
  const peaks = file.computePeaks(samples, 12)
  assert.equal(peaks.length, 12)
  assert.equal(Math.max(...peaks), 1)
  const clip = file.sliceRecognitionClip({ samples, sampleRate: rate, duration: 60 }, start, 10)
  const bytes = new DataView(await clip.arrayBuffer())
  assert.equal(clip.type, 'audio/wav')
  assert.equal(clip.size, 44 + 10 * rate * 2)
  assert.equal(bytes.getUint16(22, true), 1)
  assert.equal(bytes.getUint32(24, true), rate)
  assert.ok(clip.size <= contract.RECOGNITION_MAX_BYTES)
  assert.equal(file.loudestStart(new Float32Array(5 * rate), rate, 10), 0)
  assert.deepEqual([...file.mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])], [0.5, 0.5])
})
