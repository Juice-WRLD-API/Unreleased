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

test('mixed playlists keep catalogue songs available for offline download', () => {
  const api = load('lib/playlistItems.ts', {
    './userApi': {}, './juicewrldApi': {}, './donorPlayback': {}, './fileTypes': {},
    '../hooks/useChannelRoles': {}, '../store/useStore': {},
  })
  const ids = api.playlistSongIds([
    { source: 'song', song: { id: 42 } },
    { source: 'comp', song: null, filepath: 'Comp/file.mp3' },
    { source: 'donor', song: null },
    { source: 'local', song: null },
    { source: 'song', song: null },
    { song: { id: 99 } },
  ])
  assert.deepEqual(Array.from(ids), [42, 99])
})

test('native ZIP exports wait for the device save and reject failed writes', async () => {
  let finishSave
  let savedName
  let rejectSave = false
  const api = load('lib/clientZip.ts', {
    './platform': { IS_NATIVE_APP: true },
    './fileSave': { saveFile: (name) => {
      savedName = name
      if (rejectSave) return Promise.reject(new Error('Disk full'))
      return new Promise(resolve => { finishSave = resolve })
    } },
    'client-zip': { downloadZip: () => ({ blob: async () => new Blob(['zip']) }) },
    './cdn': { default: {} },
    './downloadEmbed': { embedForDownload: async () => null },
    './apiFilesShared': {}, './format': {}, './appToast': {},
    '../store/useStore': {}, '../hooks/useIsMobile': {},
  }, { fetch: async () => new Response('audio'), Response })
  const target = await api.openZipTarget('Playlist')
  assert.equal(target.kind, 'memory')
  let settled = false
  const items = [{ name: 'song.mp3', url: 'https://example.test/song.mp3' }]
  const writing = api.writeZip(target, items).then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(savedName, 'Playlist.zip')
  assert.equal(settled, false)
  finishSave()
  assert.equal((await writing).saved, 1)
  rejectSave = true
  await assert.rejects(api.writeZip(target, items), /Disk full/)
})
