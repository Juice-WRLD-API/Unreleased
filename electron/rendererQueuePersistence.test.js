const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const { createStore } = require('zustand/vanilla')

const root = path.join(__dirname, '..', 'src', 'renderer', 'src')
const sources = new Map()
for (const file of ['lib/persist.ts', 'store/queuePersistence.ts', 'store/queueContext.ts', 'store/queueSlice.ts']) {
  sources.set(file, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)
}

function harness(saved = new Map(), search = '') {
  const storage = new Map(saved)
  const writes = []
  const requests = []
  const microtasks = []
  const warnings = []
  // Fake timers: the fake requests below never settle, so the radio prefetch's
  // give-up-and-retry timeout would otherwise keep the test process alive.
  const timers = new Map()
  let now = 0
  let nextTimer = 1
  const setTimeout = (fn, ms = 0) => { timers.set(nextTimer, { at: now + ms, fn }); return nextTimer++ }
  const clearTimeout = (id) => { timers.delete(id) }
  const advance = (ms) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = end
  }
  const window = Object.assign(new EventTarget(), { location: { search } })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); writes.push(key) },
    removeItem: (key) => storage.delete(key),
  }
  const modules = new Map()
  const load = (file) => {
    if (modules.has(file)) return modules.get(file)
    const loaded = { exports: {} }
    const mockRequire = (name) => {
      const real = {
        '../lib/persist': 'lib/persist.ts',
        './queuePersistence': 'store/queuePersistence.ts',
        './queueContext': 'store/queueContext.ts',
      }[name]
      if (real) return load(real)
      if (name === '../lib/songPrefs') return { hasAnyDefaultVersion: () => false, hasAnyExcludedVersion: () => false }
      if (name === '../lib/compactGroups') return { groupPlaylistBySong: () => new Promise(() => {}) }
      if (name === '../lib/juicewrldApi') return {
        apiFetch: (...args) => { requests.push(args); return new Promise(() => {}) },
        songToTrack: (song) => song,
      }
      return {}
    }
    Function('require', 'module', 'exports', 'localStorage', 'window', 'document', 'queueMicrotask', 'console', 'setTimeout', 'clearTimeout', sources.get(file))(
      mockRequire, loaded, loaded.exports, localStorage, window, document, (fn) => microtasks.push(fn), { warn: (...args) => warnings.push(args) },
      setTimeout, clearTimeout,
    )
    modules.set(file, loaded.exports)
    return loaded.exports
  }
  const persistence = load('store/queuePersistence.ts')
  const { createQueueSlice } = load('store/queueSlice.ts')
  const store = createStore((set, get, api) => ({ ...createQueueSlice(set, get, api), preferOgVersion: false, currentTrackFull: null }))
  return {
    store, storage, writes, requests, persistence, localStorage, warnings, advance,
    flushStartup: () => { while (microtasks.length) microtasks.shift()() },
    hide: () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) },
    close: () => window.dispatchEvent(new Event('beforeunload')),
  }
}

function track(id, extra = {}) {
  return {
    id, path: `Compilation/${id}.mp3`, streamUrl: `https://media.example/${id}.mp3`,
    title: id, artist: 'Juice WRLD', album: '', albumArtist: '', year: null,
    trackNumber: null, duration: 180, genre: '', hasAlbumArt: false, ...extra,
  }
}
const ids = (tracks) => tracks.map((t) => t.id)
const read = (h, key) => JSON.parse(h.storage.get(`unreleased:${key}`) ?? 'null')

test('remember queue is opt-in and ordinary playback writes no session', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setCurrentTime(35)
  h.close()
  assert.equal(h.store.getState().rememberQueue, false)
  assert.equal(read(h, 'queue-session'), null)
  assert.equal(read(h, 'queue-position'), null)
  assert.equal(harness(h.storage).store.getState().currentTrack, null)
})

test('enabling during playback restores the selected duplicate, source order and position paused', () => {
  const h = harness()
  const a = track('a'), b = track('b'), c = track('c')
  h.store.getState().playTrack(a, [a, b, a, c])
  h.store.getState().jumpToTrack(a, 2)
  h.store.getState().setCurrentTime(42.5)
  h.store.getState().setRememberQueue(true)
  const restored = harness(h.storage).store.getState()
  assert.deepEqual(ids(restored.queue), ['a', 'b', 'a', 'c'])
  assert.deepEqual(ids(restored.queueOriginal), ['a', 'b', 'a', 'c'])
  assert.equal(restored.queueIndex, 2)
  assert.equal(restored.currentTrack.id, 'a')
  assert.equal(restored.currentTime, 42.5)
  assert.equal(restored.progress, 42.5 / 180)
  assert.equal(restored.isPlaying, false)
  assert.equal(restored.currentTrackFull, null)
})

test('queue edits, shuffle source order, compact song pool and history survive reopening', () => {
  const h = harness()
  const a = track('a'), b = track('b'), c = track('c'), version = track('a-v2')
  h.store.getState().setRememberQueue(true)
  h.store.getState().playTrack(a, [a, b, c], null, 'playlist', { songPool: [a, version, b, c] })
  h.store.getState().toggleShuffle()
  h.store.getState().reorderQueue(0, 1)
  const before = h.store.getState()
  const reopened = harness(h.storage)
  assert.deepEqual(ids(reopened.store.getState().queue), ids(before.queue))
  assert.deepEqual(ids(reopened.store.getState().queueSongPool), ['a', 'a-v2', 'b', 'c'])
  assert.equal(reopened.store.getState().queueSource, 'playlist')
  assert.equal(reopened.store.getState().shuffle, true)
  reopened.store.getState().toggleShuffle()
  assert.deepEqual(ids(reopened.store.getState().queue), ['a', 'b', 'c'])
  reopened.store.getState().nextTrack()
  assert.deepEqual(ids(harness(reopened.storage).store.getState().playHistory), ['a'])
})

test('position checkpoints and closing do not rewrite the whole queue', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setRememberQueue(true)
  h.writes.length = 0
  for (let time = 0.25; time <= 6.25; time += 0.25) h.store.getState().setCurrentTime(time)
  assert.equal(read(h, 'queue-position').time, 5)
  assert.equal(h.writes.filter((key) => key.endsWith('queue-session')).length, 0)
  h.hide()
  assert.equal(read(h, 'queue-position').time, 6.25)
  h.store.getState().setCurrentTime(7)
  h.store.getState().setIsPlaying(false)
  assert.equal(read(h, 'queue-position').time, 7)
  h.store.getState().setCurrentTime(9)
  h.close()
  assert.equal(harness(h.storage).store.getState().currentTime, 9)
})

test('disabling forgets saved playback without clearing or pausing the live queue', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setRememberQueue(true)
  h.store.getState().setRememberQueue(false)
  h.store.getState().setCurrentTime(30)
  h.close()
  assert.equal(h.store.getState().currentTrack.id, 'a')
  assert.equal(h.store.getState().isPlaying, true)
  assert.equal(read(h, 'queue-session'), null)
  assert.equal(read(h, 'queue-position'), null)
  assert.equal(harness(h.storage).store.getState().currentTrack, null)
})

test('clearing a lazy queue cannot repopulate it on reopening', () => {
  const h = harness()
  const a = track('a'), b = track('b')
  h.store.getState().setRememberQueue(true)
  h.store.getState().playTrack(a, [a, b], {
    page: 2, hasMore: true, total: 200, category: '', era: '', search: '',
  }, 'tracker')
  h.store.getState().clearQueue()
  const reopened = harness(h.storage)
  reopened.flushStartup()
  assert.deepEqual(ids(reopened.store.getState().queue), ['a'])
  assert.equal(reopened.store.getState().currentTrack.id, 'a')
  assert.equal(reopened.store.getState().queueFilter, null)
  assert.equal(reopened.requests.length, 0)
})

test('snapshots omit artwork blobs and FullTrack payloads but preserve playable file identities', () => {
  const h = harness()
  const local = track('local-C:\\Music\\a.mp3', {
    path: 'C:\\Music\\a.mp3', streamUrl: undefined, imageUrl: 'data:image/png;base64,huge',
    albumArt: 'data:image/png;base64,huge', lyrics: 'large lyrics', syncedLyrics: 'large lyrics',
  })
  const donor = track('donor-file-1', { streamUrl: 'donor://1', imageUrl: 'blob:old-cover' })
  const session = track('jw-1', { streamUrl: 'sessionedit://1' })
  h.store.getState().playTrack(local, [local, donor, session])
  h.store.getState().setRememberQueue(true)
  const saved = read(h, 'queue-session')
  assert.equal(saved.tracks.length, 3)
  assert.equal(JSON.stringify(saved).includes('base64'), false)
  assert.equal(JSON.stringify(saved).includes('lyrics'), false)
  const restored = harness(h.storage).store.getState()
  assert.equal(restored.queue[0].path, local.path)
  assert.equal(restored.queue[0].streamUrl, undefined)
  assert.equal(restored.queue[1].streamUrl, 'donor://1')
  assert.equal(restored.queue[1].imageUrl, undefined)
  assert.equal(restored.queue[2].streamUrl, 'sessionedit://1')
})

test('pop-out boot and mirrored playback never overwrite the main session', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setRememberQueue(true)
  const float = harness(h.storage, '?float=settings')
  assert.equal(float.store.getState().currentTrack, null)
  float.store.setState({ queue: [track('other')], currentTrack: track('other'), queueIndex: 0, currentTime: 30 })
  float.close()
  assert.deepEqual(read(float, 'queue-session'), read(h, 'queue-session'))
  float.store.getState().setRememberQueue(false)
  assert.equal(read(float, 'queue-session'), null)
})

test('reopening resumes lazy page preparation and random-radio preparation without playing', () => {
  const h = harness()
  h.store.getState().setRememberQueue(true)
  h.store.getState().playTrack(track('a'), [track('a')], {
    page: 3, hasMore: true, total: 200, category: 'unreleased', era: '', search: 'test',
  }, 'tracker')
  const reopened = harness(h.storage)
  assert.equal(reopened.store.getState().queueLoadingMore, false)
  reopened.flushStartup()
  assert.equal(reopened.requests[0][1].page, 3)
  assert.equal(reopened.requests[0][1].searchall, 'test')
  assert.equal(reopened.store.getState().isPlaying, false)
  h.store.getState().startRadio(track('a'))
  const radio = harness(h.storage)
  assert.equal(radio.store.getState()._radioWaiting, false)
  radio.flushStartup()
  assert.equal(radio.requests[0][0], '/radio/random/')
  assert.equal(radio.store.getState().radioMode, true)
  assert.equal(radio.store.getState().isPlaying, false)
  // A pick that never answers is abandoned after 15 s and asked for again.
  assert.equal(radio.requests.length, 1)
  radio.advance(14999)
  assert.equal(radio.requests.length, 1)
  radio.advance(1)
  assert.equal(radio.requests[0][2].aborted, true)
  assert.equal(radio.requests.length, 2)
  assert.equal(radio.requests[1][0], '/radio/random/')
  assert.equal(radio.store.getState().isPlaying, false)
})

test('malformed snapshots and positions cannot corrupt startup state', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setRememberQueue(true)
  h.storage.set('unreleased:queue-position', JSON.stringify({ trackId: 'other', queueIndex: 0, time: 60 }))
  assert.equal(harness(h.storage).store.getState().currentTime, 0)
  h.storage.set('unreleased:queue-position', JSON.stringify({ trackId: 'a', queueIndex: 0, time: 9999 }))
  assert.equal(harness(h.storage).store.getState().currentTime, 180)
  const snapshot = read(h, 'queue-session')
  for (const broken of ['{', 'null', '[]', JSON.stringify({ ...snapshot, queue: ['missing'] }), JSON.stringify({ ...snapshot, queueIndex: 100 })]) {
    h.storage.set('unreleased:queue-session', broken)
    assert.equal(harness(h.storage).store.getState().currentTrack, null)
  }
})

test('storage failure leaves playback usable and removes a stale snapshot', () => {
  const h = harness()
  h.store.getState().playTrack(track('a'))
  h.store.getState().setRememberQueue(true)
  h.localStorage.setItem = () => { throw new Error('quota exceeded') }
  h.store.getState().playTrack(track('b'))
  assert.equal(h.store.getState().currentTrack.id, 'b')
  assert.equal(read(h, 'queue-session'), null)
  assert.ok(h.warnings.length > 0)
})
