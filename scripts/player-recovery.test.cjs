const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const source = fs.readFileSync('src/renderer/src/components/Player.tsx', 'utf8').replaceAll('\r\n', '\n')
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, start)
  return source.slice(from, to)
}
const ref = current => ({ current })
function recovery(verdict, elapsed = 1000) {
  const audio = {}, state = { currentTrack: { id: 'song', title: 'Song', streamUrl: 'https://audio.test/song' }, isPlaying: true }
  const calls = [], timers = []
  const env = { console: { warn() {}, error() {} }, Date: { now: () => 400000 }, navigator: { onLine: true },
    useStore: { getState: () => state }, getActive: () => audio, cfActive: ref(false),
    recoveryTimer: ref(null), recoveryProbe: ref(null), recoveryAttempts: ref(4),
    recoveryStartedAt: ref(400000 - elapsed), recoveryGeneration: ref(0), recoveryLoading: ref(null),
    resolvePlaybackUrl: track => track.streamUrl, probeSource: async () => ({ verdict, reason: 'why', detail: 'detail' }),
    runLog() {}, describeMediaError: () => '', describeSource: () => '', lastProgressTime: ref(0),
    MAX_RECOVERY_ATTEMPTS: 4, SLOW_RETRY_MS: 10000, RECOVERY_WINDOW_MS: 300000,
    scheduleReload: (...args) => timers.push(args), skipUnplayableTrack: () => calls.push('skip'),
    showAppToast: text => calls.push(text), setIsPlaying: value => calls.push(value),
  }
  vm.createContext(env)
  vm.runInContext(compile(block('  const recoverPlayback =', '  // A source the browser') + '\nglobalThis.recover = recoverPlayback'), env)
  return { env, state, calls, timers }
}
test('outage recovery retries slowly within five minutes, then pauses without skipping', async () => {
  const active = recovery('down'); active.env.recover('error'); await new Promise(setImmediate)
  assert.equal(active.timers.length, 1); assert.equal(active.timers[0][3], 10000); assert.deepEqual(active.calls, [])
  const expired = recovery('down', 300001); expired.env.recover('error'); await new Promise(setImmediate)
  assert.equal(expired.timers.length, 0); assert.equal(expired.calls.at(-1), false)
})
test('a reachable file that exhausts recovery skips instead of stopping the queue', async () => {
  for (const verdict of ['playable', 'broken']) {
    const r = recovery(verdict); r.env.recover('error'); await new Promise(setImmediate)
    assert.deepEqual(r.calls, ['skip']); assert.equal(r.timers.length, 0)
  }
})
test('an old probe cannot reload a different track or resume after pausing', async () => {
  for (const change of [r => { r.state.currentTrack = { id: 'next' } }, r => { r.state.isPlaying = false }, r => { r.env.recoveryGeneration.current++ }]) {
    const r = recovery('down'); r.env.recover('error'); change(r); await new Promise(setImmediate)
    assert.deepEqual(r.calls, []); assert.equal(r.timers.length, 0)
  }
})
test('offline playback does not spend the recovery budget', () => {
  const r = recovery('down'); r.env.navigator.onLine = false; r.env.recover('error')
  assert.equal(r.env.recoveryAttempts.current, 4); assert.equal(r.env.recoveryProbe.current, null)
})
function probeEnv(status, type = 'audio/mpeg', text = '') {
  const seen = { cleared: false, cancelled: false }
  const env = { AbortController, URL, window: { setTimeout: () => 1 }, clearTimeout: () => { seen.cleared = true },
    fetch: async () => ({ status, ok: status < 400, text: async () => text, headers: { get: () => type }, body: { cancel: async () => { seen.cancelled = true } } }),
    document: { createElement: () => ({ canPlayType: (t) => (t.startsWith('audio/') ? 'probably' : '') }) },
  }
  vm.createContext(env)
  vm.runInContext(compile(block('type SourceVerdict', '// How long the pause-fade')), env)
  return { env, seen }
}
test('source probing distinguishes HTTP outages, missing files and playable audio', async () => {
  for (const [status, expected] of [[503, 'down'], [429, 'down'], [404, 'broken'], [206, 'playable']]) {
    const { env, seen } = probeEnv(status)
    assert.equal((await env.probeSource('https://audio.test/song')).verdict, expected)
    assert.ok(seen.cleared && seen.cancelled)
  }
  const refused = await probeEnv(403).env.probeSource('https://audio.test/song')
  assert.equal(refused.reason, 'the server refused them: HTTP 403')
  const page = await probeEnv(200, 'text/html').env.probeSource('https://audio.test/song')
  assert.deepEqual([page.verdict, page.reason], ['broken', "the server didn't send audio: text/html"])
})
test('files on this computer are probed too, and are never an outage', async () => {
  const src = 'local-media://play/?p=C%3A%5Coffline%5Cjw-1.mp3'
  const missing = await probeEnv(500, 'text/plain', "Error: ENOENT: no such file or directory, stat 'C:\offline\jw-1.mp3'").env.probeSource(src)
  assert.deepEqual([missing.verdict, missing.reason], ['broken', 'their files are missing from this computer'])
  assert.match(missing.detail, /ENOENT/)
  assert.equal((await probeEnv(500, 'text/plain', 'Error: EBUSY').env.probeSource(src)).reason, "their files couldn't be read")
  assert.equal((await probeEnv(206).env.probeSource(src)).verdict, 'playable')
  const { env } = probeEnv(206)
  env.fetch = async () => { throw new TypeError('Failed to fetch') }
  assert.equal((await env.probeSource(src)).verdict, 'broken')
})
test('the stop toast says why the songs could not be played', () => {
  const calls = []
  const env = { useStore: { getState: () => ({ currentTrack: { id: 'jw-1', title: 'Song' } }) }, consecutiveSkips: ref(3),
    MAX_CONSECUTIVE_SKIPS: 3, runLog: (...a) => calls.push(['log', ...a]), showAppToast: (t) => calls.push(t),
    setIsPlaying: (v) => calls.push(v), nextTrack: () => true }
  vm.createContext(env)
  vm.runInContext(compile(block('  const skipUnplayableTrack =', '  // A downloaded copy') + '\nglobalThis.skip = skipUnplayableTrack'), env)
  env.skip('their files are missing from this computer', 'MediaError 4')
  assert.ok(calls.includes("Stopped: 4 songs in a row couldn't be played (their files are missing from this computer)"))
  assert.equal(calls.at(-1), false)
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'log' && /MediaError 4/.test(c[2])))
})
function fallback({ next = 'https://audio.test/song', moveOn } = {}) {
  const audio = { currentSrc: 'local-media://play/?p=C%3A%5Cold%5Cjw-1.mp3' }
  const state = { currentTrack: { id: 'jw-1', title: 'Song' }, isPlaying: true }
  const out = { marked: [], reloads: [], skips: [] }
  const env = { useStore: { getState: () => state }, recoveryProbe: ref(null), recoveryAttempts: ref(3), getActive: () => audio,
    clearRecoveryTimer() {}, probeSource: async () => ({ verdict: 'broken', reason: 'their files are missing from this computer', detail: 'HTTP 500 ENOENT' }),
    markOfflineCopyUnreadable: (id) => out.marked.push(id), rereadOfflineIndex: async () => { moveOn?.(state) },
    resolvePlaybackUrl: () => next, runLog() {}, describeSource: (u) => u, sameMediaSrc: (a, b) => a === b,
    skipUnplayableTrack: (reason) => out.skips.push(reason), scheduleReload: (...a) => out.reloads.push(a) }
  vm.createContext(env)
  vm.runInContext(compile(block('  const fallBackFromOfflineCopy =', '  // Data still arriving') + '\nglobalThis.fallback = fallBackFromOfflineCopy'), env)
  return { env, out, run: () => env.fallback(audio, state.currentTrack, { localPath: 'C:\old\jw-1.mp3', downloadedAt: 1 }, 'MediaError 4') }
}
test('a downloaded copy that will not open plays from the server instead of being skipped', async () => {
  const f = fallback(); await f.run()
  assert.deepEqual(f.out.marked, ['jw-1']); assert.deepEqual(f.out.skips, [])
  assert.equal(f.out.reloads.length, 1); assert.deepEqual(f.out.reloads[0].slice(1), ['jw-1', 'https://audio.test/song', 0])
  assert.equal(f.env.recoveryAttempts.current, 0); assert.equal(f.env.recoveryProbe.current, null)
})
test('a downloaded copy with nothing else to play is skipped with the real reason', async () => {
  const f = fallback({ next: '' }); await f.run()
  assert.deepEqual(f.out.skips, ['their files are missing from this computer']); assert.equal(f.out.reloads.length, 0)
})
test('the copy fallback does nothing once the user has moved on', async () => {
  for (const moveOn of [(s) => { s.currentTrack = { id: 'jw-2' } }, (s) => { s.isPlaying = false }]) {
    const f = fallback({ moveOn }); await f.run()
    assert.equal(f.out.reloads.length + f.out.skips.length, 0)
  }
})
