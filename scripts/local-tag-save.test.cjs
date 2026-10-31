const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/store/useStore.ts', 'utf8')
const start = source.indexOf('  saveLocalTags: async (id, changes) => {')
const end = source.indexOf('  scanLibrary: async () => {', start)
assert.ok(start >= 0 && end > start)
const js = ts.transpileModule(`const actions = { ${source.slice(start, end)} }; globalThis.save = actions.saveLocalTags`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText

function setup(write) {
  const track = { id: 'local-1', filePath: 'content://music/1', title: 'Before', addedAt: 123 }
  const state = { libraryTracks: [track], libraryFolders: ['content://music'], libraryLastScanned: 99,
    queue: [track, { id: 'other', title: 'Other' }], currentTrack: track,
    currentTrackFull: { ...track, lyrics: 'Keep me' }, libraryScanning: false, libraryTagSaving: false, isPlaying: false }
  const persisted = []
  const env = { get: () => state, set: value => Object.assign(state, typeof value === 'function' ? value(state) : value),
    localLibrary: { writeLocalTags: write, saveLibrary: async value => persisted.push(value) } }
  vm.createContext(env); vm.runInContext(js, env)
  return { state, persisted, save: env.save }
}

test('successful native write updates library and playback snapshots before persisting', async () => {
  const r = setup(async () => ({ id: 'local-1', title: 'After', addedAt: 999 }))
  await r.save('local-1', { title: 'After' })
  assert.equal(r.state.libraryTracks[0].title, 'After')
  assert.equal(r.state.libraryTracks[0].addedAt, 123)
  assert.equal(r.state.currentTrack.title, 'After')
  assert.equal(r.state.currentTrackFull.lyrics, 'Keep me')
  assert.equal(r.state.queue[0].title, 'After')
  assert.equal(r.state.queue[1].title, 'Other')
  assert.equal(r.persisted[0].tracks[0].title, 'After')
  assert.equal(r.state.libraryTagSaving, false)
})

test('failed native write keeps the library unchanged and releases save lock', async () => {
  const r = setup(async () => { throw new Error('Write access is needed') })
  await assert.rejects(r.save('local-1', { title: 'After' }), /Write access/)
  assert.equal(r.state.libraryTracks[0].title, 'Before')
  assert.equal(r.state.currentTrack.title, 'Before')
  assert.equal(r.persisted.length, 0)
  assert.equal(r.state.libraryTagSaving, false)
})

test('playing, scanning and overlapping saves cannot start a file write', async () => {
  for (const flag of ['isPlaying', 'libraryScanning', 'libraryTagSaving']) {
    let writes = 0
    const r = setup(async () => { writes++; return {} })
    r.state[flag] = true
    await assert.rejects(r.save('local-1', { title: 'After' }))
    assert.equal(writes, 0)
  }
})
