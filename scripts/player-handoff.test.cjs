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
    useStore: { getState: () => state }, activeSlot: ref('A'), skipNextLoadUrl: ref(null), volumeRef: ref(0.5),
    getActive: () => slots[env.activeSlot.current], getNext: () => slots[env.activeSlot.current === 'A' ? 'B' : 'A'],
    resolvePlaybackUrl: () => 'next-url', handoffActive: () => true, applyRate() {},
    playSlot: (a, onRejected) => { calls.push(`play:${a.name}`); rejected = onRejected },
  }
  const fn = run(block('  const handOffToSpare =', '  // Route both slots'), 'handOffToSpare', env)
  fn({ id: 'next' })
  return { env, slots, calls, reject: name => rejected({ name }) }
}

test('the song end hands playback to the spare slot when it already holds the next song', () => {
  const h = handoff()
  assert.equal(h.env.activeSlot.current, 'B'); assert.equal(h.env.skipNextLoadUrl.current, 'next-url')
  assert.equal(h.slots.B.volume, 0.5); assert.deepEqual(h.calls, ['play:B'])
})

test('no handoff to a spare holding another song, nothing loaded yet, or a failed load', () => {
  for (const opts of [{ spareSrc: 'other-url' }, { spareSrc: null }, { readyState: 0 }, { error: { code: 2 } }]) {
    const h = handoff(opts)
    assert.equal(h.env.activeSlot.current, 'A'); assert.equal(h.env.skipNextLoadUrl.current, null); assert.deepEqual(h.calls, [])
  }
})

test('a refused handoff loads the song into the slot that just finished', () => {
  const h = handoff(); h.reject('NotAllowedError')
  assert.equal(h.env.activeSlot.current, 'A'); assert.equal(h.slots.A.src, 'next-url')
  assert.deepEqual(h.calls, ['play:B', 'B:clear', 'B:load', 'play:A'])
  const paused = handoff(); paused.reject('AbortError')
  assert.equal(paused.env.activeSlot.current, 'B'); assert.deepEqual(paused.calls, ['play:B'])
})

test('native loop detection advances once per wrap, ignores source changes and explicit seeks', () => {
  const env = { loopPositions: new WeakMap() }
  const code = block('  const observeNativeLoop =', '  const [prevMute,')
  const { observe, seek } = run(code, '({ observe: observeNativeLoop, seek: seekSlot })', env)
  const audio = { src: 'a', currentTime: 179, loop: true }
  assert.equal(observe(audio), false)
  audio.currentTime = 0.2
  assert.equal(observe(audio), true)
  assert.equal(observe(audio), false)
  audio.currentTime = 179; observe(audio)
  seek(audio, 0)
  assert.equal(observe(audio), false)
  audio.currentTime = 179; observe(audio)
  audio.src = 'b'; audio.currentTime = 0
  assert.equal(observe(audio), false)
  audio.currentTime = 179; observe(audio)
  audio.loop = false; audio.currentTime = 0
  assert.equal(observe(audio), false)
})

test('iOS starts the next source synchronously on the same element without a render or spare', () => {
  const calls = []
  const audio = { src: 'old', pause: () => calls.push('pause') }
  const state = { repeat: 'none', queue: [], queueIndex: 0, currentTrack: { id: 'old' }, isPlaying: true }
  const env = {
    IS_IOS: true, useStore: { getState: () => state }, getActive: () => audio,
    cfActive: ref(false), loopPositions: new WeakMap(), recoveryResumeAt: ref(179), volumeRef: ref(0.5),
    nextTrack: () => { state.currentTrack = { id: 'next' }; return state.currentTrack },
    resolvePlaybackUrl: () => 'next-url', applyRate() {}, playSlot: a => calls.push(['play', a.src]),
    setIsPlaying: v => { state.isPlaying = v }, seekSlot: (a, t) => { a.currentTime = t },
    handOffToSpare: () => assert.fail('iOS must reuse the unlocked element'),
  }
  const ended = run(block('  const onAudioEnded =', '  const restartCurrentTrack ='), 'onAudioEnded', env)
  ended(audio)
  assert.equal(audio.src, 'next-url')
  assert.deepEqual(calls, [['play', 'next-url']])
  assert.equal(env.recoveryResumeAt.current, 0)
  calls.length = 0
  env.nextTrack = () => null
  ended(audio)
  assert.deepEqual(calls, ['pause'])
  assert.equal(state.isPlaying, false)
  calls.length = 0
  state.repeat = 'one'; state.isPlaying = true
  ended(audio)
  assert.equal(audio.currentTime, 0)
  assert.deepEqual(calls, [['play', 'next-url']])
  calls.length = 0
  state.isPlaying = false
  ended(audio)
  assert.deepEqual(calls, [])
})
