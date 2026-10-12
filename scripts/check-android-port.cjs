// Native bridge contracts, without a browser or attached device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, imports = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src', file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports, URL, Blob, console,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`)
      return imports[name]
    },
    ...globals,
  })
  return exports
}

test('native sharing and startup use the public site and installed-app behavior', () => {
  const platform = load('lib/platform.ts', {}, {
    window: { Capacitor: { isNativePlatform: () => true }, location: { origin: 'https://localhost' } },
    navigator: { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 1 },
  })
  assert.equal(platform.shareOrigin(), 'https://player.juicewrldapi.com')
  assert.equal(platform.isStandalonePWA(), true)
})

test('native tablets select mobile while browser desktop viewports stay desktop', () => {
  for (const native of [true, false]) {
    const hooks = load('hooks/useIsMobile.ts', {
      '../lib/platform': { IS_NATIVE_APP: native },
      react: { useState: (init) => [init(), () => {}], useEffect: () => {} },
    }, { window: { matchMedia: () => ({ matches: false }) } })
    assert.equal(hooks.isMobileViewport(), native)
    assert.equal(hooks.useIsMobile(), native)
  }
})

test('offline queue tracks use the local audio URI and retain the public source path', () => {
  const offline = { path: 'songs/example.mp3', localPath: 'file:///data/example.mp3', imageUrl: 'https://example.com/art.jpg' }
  const types = load('lib/fileTypes.ts', {
    '../store/useStore': { useStore: { getState: () => ({ libraryArt: {}, offlineTracks: { 'jw-1': offline } }) } },
    './localLibrary': { toStreamUrl: (uri) => `converted:${uri}` },
    './platform': { IS_NATIVE_APP: true },
  })
  assert.equal(types.toFileUrl('content://music/1'), 'converted:content://music/1')
  const track = types.libraryTrackToTrack({ id: 'jw-1', filePath: offline.localPath })
  assert.equal(track.path, offline.path)
  assert.equal(track.streamUrl, `converted:${offline.localPath}`)
  assert.equal(track.imageUrl, offline.imageUrl)
})

test('native save waits for the device write and propagates failures', async () => {
  let complete
  let saved
  const plugin = { save: (opts) => { saved = opts; return new Promise((resolve) => { complete = resolve }) } }
  class FileReader {
    readAsDataURL() { this.result = 'data:text/plain;base64,aGVsbG8='; this.onload() }
  }
  const api = load('lib/fileSave.ts', {
    './androidUpdate': { isAndroidApp: () => true },
    '../store/useStore': { useStore: { getState: () => ({ downloadFolder: { uri: 'content://downloads' } }) } },
  }, { window: { Capacitor: { Plugins: { Downloads: plugin } } }, FileReader })
  let settled = false
  const saving = api.saveFile('hello.txt', new Blob(['hello'], { type: 'text/plain' })).then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(saved.folderUri, 'content://downloads')
  assert.equal(saved.base64, 'aGVsbG8=')
  complete()
  await saving
  plugin.save = async () => { throw new Error('Disk full') }
  await assert.rejects(api.saveFile('hello.txt', new Blob(['hello'])), /Disk full/)
})

test('media listener cleanup handles unmount before async registration completes', async () => {
  let registered
  let removals = 0
  const api = load('lib/mediaControl.ts', { './androidUpdate': { isAndroidApp: () => true } }, {
    window: { Capacitor: { Plugins: { MediaControl: {
      addListener: () => new Promise((resolve) => { registered = resolve }),
    } } } },
  })
  const unsubscribe = api.onMediaControlEvent('play', () => {})
  unsubscribe()
  registered({ remove: () => { removals++ } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(removals, 1)
})
