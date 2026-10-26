const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const test = require('node:test')

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const model = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/syncedLyrics.ts', 'utf8')), {
  module: model, exports: model.exports,
})
const source = fs.readFileSync('src/renderer/src/components/SyncedLyricsTool.tsx', 'utf8').replaceAll('\r\n', '\n')
const block = (start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Missing control block: ${start}`)
  return source.slice(from, to)
}

function controls(mode, text) {
  const state = {
    ...model.exports, mode, lines: model.exports.linesFromPlain(text),
    sel: null, lastStamped: null, stampFinished: false, readOnly: false,
    time: 1.38, seeks: [], toggles: [],
    keyOwners: ['tool'], me: { current: 'tool' }, keyHandler: {},
    isTyping: () => false, flashOn: () => {},
  }
  state.clock = {
    ready: true, playing: true, now: () => state.time,
    seek: t => state.seeks.push(t), setPlaying: on => state.toggles.push(on),
  }
  state.onChange = lines => { state.lines = lines }
  state.setRawSel = next => { state.sel = typeof next === 'function' ? next(state.sel) : next }
  state.setLastStamped = next => { state.lastStamped = next }
  state.setStampFinished = next => { state.stampFinished = next }
  const context = vm.createContext(state)
  vm.runInContext(compile([
    block('const setSel =', '  const [lit,'),
    block('const hear =', '  const pick ='),
    block('const stamp =', '  // A nudge'),
  ].join('\n')), context)
  const render = () => vm.runInContext(compile([
    block('const cursor =', '  const order =').replaceAll('const ', 'var '),
    block('keyHandler.current =', '  useEffect(() => {\n    const id = me.current'),
  ].join('\n')), context)
  const key = (key, extra = {}) => {
    render()
    state.keyHandler.current({ key, preventDefault() {}, stopImmediatePropagation() {}, ...extra })
  }
  return { state, key, pick: target => { state.nextPick = target; vm.runInContext('setSel(nextPick)', context) } }
}

for (const mode of ['lines', 'words']) {
  test(`${mode}: final stamp stops, R replays it, and a manual pick overrides replay`, () => {
    const { state, key, pick } = controls(mode, 'First\nSecond')
    key(' ')
    key('r')
    assert.equal(state.seeks.at(-1), 1.38)
    state.time = 3
    key(' ')
    const saved = state.serializeSyncedLyrics(state.lines)
    state.time = 5
    key(' ')
    assert.equal(state.serializeSyncedLyrics(state.lines), saved)
    key('r')
    assert.equal(state.seeks.at(-1), 3)
    pick({ line: 0, word: mode === 'words' ? 0 : null })
    key('r')
    assert.equal(state.seeks.at(-1), 1.38)
    key(' ')
    assert.equal(state.lines[0].start, 5)
  })
}

test('held Space does not stamp or repeatedly toggle playback', () => {
  const { state, key } = controls('lines', 'First\nSecond')
  key(' ', { repeat: true })
  assert.equal(state.lines[0].start, null)
  key(' ', { ctrlKey: true })
  key(' ', { ctrlKey: true, repeat: true })
  assert.equal(state.toggles.length, 1)
  state.readOnly = true
  key(' ')
  key(' ', { repeat: true })
  assert.equal(state.toggles.length, 2)
})
