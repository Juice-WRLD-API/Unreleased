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
    resolvePlaybackUrl: track => track.streamUrl, probeSource: async () => verdict,
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
test('source probing distinguishes HTTP outages, missing files and playable audio', async () => {
  for (const [status, expected] of [[503, 'down'], [429, 'down'], [404, 'broken'], [206, 'playable']]) {
    let cleared = false, cancelled = false
    const env = { AbortController, window: { setTimeout: () => 1 }, clearTimeout: () => { cleared = true },
      fetch: async () => ({ status, ok: status < 400, headers: { get: () => 'audio/mpeg' }, body: { cancel: async () => { cancelled = true } } }),
      document: { createElement: () => ({ canPlayType: () => 'probably' }) },
    }
    vm.createContext(env)
    vm.runInContext(compile(block('type SourceVerdict', '// How long the pause-fade') || ''), env)
    assert.equal(await env.probeSource('https://audio.test/song'), expected)
    assert.ok(cleared && cancelled)
  }
})
