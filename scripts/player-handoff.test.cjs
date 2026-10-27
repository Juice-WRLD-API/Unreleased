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
function run(code, name, env) {
  vm.createContext(env)
  vm.runInContext(compile(code + `\nglobalThis.fn = ${name}`), env)
  return env.fn
}

test('a recovery reload asks for playback right away instead of waiting on metadata it never fetches', () => {
  const calls = [], listeners = {}
  const audio = { addEventListener: (t, f) => { listeners[t] = f }, removeEventListener() {}, load: () => calls.push('load') }
  const state = { currentTrack: { id: 'song', streamUrl: 'u' }, isPlaying: true, queueIndex: 0 }
  let timer = null
  const reload = run(block('  const scheduleReload =', '  // Reloads the active slot'), 'scheduleReload', {
    Date, isFinite, useStore: { getState: () => state }, window: { setTimeout: f => { timer = f; return 1 } },
    lastRecoveryAt: ref(0), recoveryGeneration: ref(0), recoveryTimer: ref(null), recoveryLoading: ref(null),
    recoveryResumeAt: ref(0), lastProgressAt: ref(0), cfActive: ref(false), volumeRef: ref(1),
    getActive: () => audio, resolvePlaybackUrl: t => t.streamUrl, clearRecoveryTimer() {}, applyRate() {},
    playSlot: a => calls.push(a === audio ? 'play' : 'other'),
  })
  reload(audio, 'song', 'u', 1000); timer()
  assert.equal(audio.src, 'u'); assert.deepEqual(calls, ['load', 'play']); assert.ok(listeners.loadedmetadata)
})

test('the upcoming song is only predicted where nextTrack() is predictable', () => {
  const q = [{ id: 'a' }, { id: 'b' }]
  const upcoming = s => run(block('  const upcomingTrack =', '  const preloadHandoff ='), 'upcomingTrack', {
    useStore: { getState: () => ({ queue: q, queueIndex: 0, repeat: 'none', shuffle: false, radioMode: false, radioNext: null, ...s }) },
  })()
  assert.equal(upcoming({}).id, 'b')
  assert.equal(upcoming({ queueIndex: 1 }), null)
  assert.equal(upcoming({ queueIndex: 1, repeat: 'all' }).id, 'a')
  assert.equal(upcoming({ queueIndex: 1, repeat: 'all', shuffle: true }), null)
  assert.equal(upcoming({ repeat: 'one' }), null)
  assert.equal(upcoming({ radioMode: true, queueIndex: 1, radioNext: { id: 'r' } }).id, 'r')
  assert.equal(upcoming({ radioMode: true }).id, 'b')
})

function handoff({ spareSrc = 'next-url', readyState = 1, error = null } = {}) {
  const calls = [], state = { currentTrack: { id: 'next' }, isPlaying: true }
  let rejected = null
  const slots = {
    A: { name: 'A' },
    B: { name: 'B', readyState, error, getAttribute: () => spareSrc, removeAttribute: () => calls.push('B:clear'), load: () => calls.push('B:load') },
  }
  const env = {
    console: { warn() {}, error() {} }, HTMLMediaElement: { HAVE_METADATA: 1 },
    useStore: { getState: () => state }, activeSlot: ref('A'), skipNextLoad: ref(false), volumeRef: ref(0.5),
    getActive: () => slots[env.activeSlot.current], getNext: () => slots[env.activeSlot.current === 'A' ? 'B' : 'A'],
    resolvePlaybackUrl: () => 'next-url', handoffActive: () => true, applyRate() {},
    playSlot: (a, onRejected) => { calls.push(`play:${a.name}`); rejected = onRejected },
  }
  const fn = run(block('  const handOffToSpare =', '  // iOS lets an <audio> element'), 'handOffToSpare', env)
  fn({ id: 'next' })
  return { env, slots, calls, reject: name => rejected({ name }) }
}

test('the song end hands playback to the spare slot when it already holds the next song', () => {
  const h = handoff()
  assert.equal(h.env.activeSlot.current, 'B'); assert.equal(h.env.skipNextLoad.current, true)
  assert.equal(h.slots.B.volume, 0.5); assert.deepEqual(h.calls, ['play:B'])
})

test('no handoff to a spare holding another song, nothing loaded yet, or a failed load', () => {
  for (const opts of [{ spareSrc: 'other-url' }, { spareSrc: null }, { readyState: 0 }, { error: { code: 2 } }]) {
    const h = handoff(opts)
    assert.equal(h.env.activeSlot.current, 'A'); assert.equal(h.env.skipNextLoad.current, false); assert.deepEqual(h.calls, [])
  }
})

test('a refused handoff loads the song into the slot that just finished', () => {
  const h = handoff(); h.reject('NotAllowedError')
  assert.equal(h.env.activeSlot.current, 'A'); assert.equal(h.slots.A.src, 'next-url')
  assert.deepEqual(h.calls, ['play:B', 'B:clear', 'B:load', 'play:A'])
  const paused = handoff(); paused.reject('AbortError')
  assert.equal(paused.env.activeSlot.current, 'B'); assert.deepEqual(paused.calls, ['play:B'])
})
