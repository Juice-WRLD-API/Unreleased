// Exercise native bridge boundaries without a browser, Xcode, or a device.
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
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`)
      return imports[name]
    },
    ...globals,
  })
  return exports
}

test('native iPad uses public share links and installed mobile behavior', () => {
  const platform = load('lib/platform.ts', {}, {
    window: { Capacitor: { isNativePlatform: () => true }, location: { origin: 'capacitor://localhost' } },
    navigator: { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 },
  })
  assert.equal(platform.IS_IOS, true)
  assert.equal(platform.shareOrigin(), 'https://player.juicewrldapi.com')
  assert.equal(platform.isStandalonePWA(), true)
  const viewport = load('hooks/useIsMobile.ts', {
    '../lib/platform': platform,
    react: { useState: (init) => [init(), () => {}], useEffect: () => {} },
  }, { window: { matchMedia: () => ({ matches: false }) } })
  assert.equal(viewport.isMobileViewport(), true)
})

test('volume capability detects both read-only and writable audio elements', () => {
  for (const writable of [false, true]) {
    const platform = load('lib/platform.ts', {}, {
      document: { createElement: () => writable ? { volume: 1 } : { get volume() { return 1 }, set volume(_) {} } },
    })
    assert.equal(platform.CAN_SET_VOLUME, writable)
  }
})

function fileApi(writeFile) {
  class FileReader {
    readAsDataURL() { this.result = 'data:text/plain;base64,aGVsbG8='; this.onload() }
  }
  return load('lib/fileSave.ts', {
    './androidUpdate': { isAndroidApp: () => false },
    '../store/useStore': {},
    './platform': { IS_NATIVE_APP: true, IS_IOS: true },
    '@capacitor/filesystem': { Filesystem: { writeFile }, Directory: { Documents: 'DOCUMENTS' } },
  }, { FileReader })
}

test('iOS export waits for Documents write and contains filenames within it', async () => {
  let complete
  let saved
  const api = fileApi((opts) => { saved = opts; return new Promise((resolve) => { complete = resolve }) })
  let settled = false
  const pending = api.saveFile('../hello.txt', new Blob(['hello'])).then(() => { settled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(saved.directory, 'DOCUMENTS')
  assert.equal(saved.path, '.._hello.txt')
  assert.equal(saved.data, 'aGVsbG8=')
  complete()
  await pending
})

test('iOS export surfaces native write errors', async () => {
  const api = fileApi(async () => { throw new Error('Disk full') })
  await assert.rejects(api.saveFile('hello.txt', new Blob(['hello'])), /Disk full/)
})

test('declarative iOS downloads use the native save path', async () => {
  let click
  let filename
  class Element { closest() { return { download: 'chat.txt', href: 'blob:chat' } } }
  const api = load('lib/fileSave.ts', {
    './androidUpdate': { isAndroidApp: () => false },
    '../store/useStore': {},
    './platform': { IS_NATIVE_APP: true, IS_IOS: true },
    '@capacitor/filesystem': { Filesystem: { writeFile: async (opts) => { filename = opts.path } }, Directory: { Documents: 'DOCUMENTS' } },
  }, {
    document: { addEventListener: (_, cb) => { click = cb } },
    Element,
    fetch: async () => ({ ok: true, blob: async () => new Blob(['hello']) }),
    FileReader: class FileReader { readAsDataURL() { this.result = 'data:;base64,aGVsbG8='; this.onload() } },
  })
  api.installNativeDownloads()
  let prevented = false
  click({ target: new Element(), defaultPrevented: false, preventDefault() { prevented = true } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(prevented, true)
  assert.equal(filename, 'chat.txt')
})
