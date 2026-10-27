const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'renderer', 'src', 'store', 'queueContext.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
})
const loaded = { exports: {} }
Function('require', 'module', 'exports', compiled.outputText)(require, loaded, loaded.exports)
const { resolveQueueContext } = loaded.exports

test('no-context playback creates an explicit standalone queue', () => {
  const track = { id: 'answer' }
  assert.deepEqual(resolveQueueContext(track), { tracks: [track], index: 0 })
})

test('explicit collection context preserves its queue and selected position', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const result = resolveQueueContext(tracks[1], tracks)
  assert.equal(result.tracks, tracks)
  assert.equal(result.index, 1)
})

test('a malformed context is repaired so queue and current track stay aligned', () => {
  const track = { id: 'requested' }
  const context = [{ id: 'other' }]
  assert.deepEqual(resolveQueueContext(track, context), {
    tracks: [track, ...context],
    index: 0,
  })
})
