const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/terminal/fullscreenStore.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function load(electron) {
  const calls = []
  const document = {
    fullscreenElement: null,
    documentElement: { requestFullscreen: async () => { calls.push('browser-enter') } },
    exitFullscreen: async () => { calls.push('browser-exit') },
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, require: () => ({ useSyncExternalStore: () => {} }),
    window: { electron: electron?.(calls) }, document,
  })
  return { ...exports, calls, document }
}

test('terminal toggles the Electron window instead of DOM fullscreen', () => {
  const store = load((calls) => ({ setFullscreen: async (value) => { calls.push(value) } }))
  store.setTermFullscreen(true)
  assert.equal(store.getTermFullscreen(), true)
  store.setTermFullscreen(false)
  assert.equal(store.getTermFullscreen(), false)
  assert.deepEqual(store.calls, [true, false])
})

test('closing and reopening can sync the native window without clearing the preference', () => {
  const store = load((calls) => ({ setFullscreen: async (value) => { calls.push(value) } }))
  store.setTermFullscreen(true)
  store.syncBrowserFullscreen(false)
  assert.equal(store.getTermFullscreen(), true)
  store.syncBrowserFullscreen(true)
  assert.deepEqual(store.calls, [true, false, true])
})

test('browser fullscreen still enters and exits without Electron', () => {
  const store = load()
  store.setTermFullscreen(true)
  store.document.fullscreenElement = {}
  store.setTermFullscreen(false)
  assert.deepEqual(store.calls, ['browser-enter', 'browser-exit'])
})

test('a rejected native request leaves the in-page mode usable', async () => {
  const store = load(() => ({ setFullscreen: async () => { throw new Error('unavailable') } }))
  store.setTermFullscreen(true)
  await new Promise(setImmediate)
  assert.equal(store.getTermFullscreen(), true)
})
