const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/ijwaLyrics.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
const loaded = { exports: {} }
let subscribe
let state = { currentTrack: { id: 'jw-1', title: 'Song', artist: 'Artist', duration: 120 }, currentTrackFull: null, lyricsOffset: 0.5, radioFmActive: false }
const sent = []
Function('require', 'module', 'exports', 'window', compiled.outputText)(
  () => ({ useStore: { getState: () => state, subscribe: fn => { subscribe = fn } } }), loaded, loaded.exports,
  { electron: { platform: 'win32', setIjwaLyrics: value => sent.push(value) } },
)
const { lyricsSnapshot, initIjwaLyrics } = loaded.exports

test('publishes loaded metadata and offsets, but never the previous song or FM queue', () => {
  assert.equal(lyricsSnapshot(state).pending, true)
  const previous = { id: 'jw-0', lyrics: 'Wrong song', syncedLyrics: '' }
  assert.equal(lyricsSnapshot({ ...state, currentTrackFull: previous }).plainLyrics, '')
  assert.equal(lyricsSnapshot({ ...state, radioFmActive: true }), null)
  assert.equal(lyricsSnapshot({ ...state, currentTrack: null }), null)
  initIjwaLyrics()
  assert.equal(sent.length, 1)
  subscribe({ ...state, currentTime: 20 }, state)
  assert.equal(sent.length, 1)
  const next = { ...state, currentTrackFull: { id: 'jw-1', lyrics: 'Offline words', syncedLyrics: '[00:12.50]Offline words' } }
  subscribe(next, state)
  assert.equal(sent[1].plainLyrics, 'Offline words')
  assert.equal(sent[1].offset, 0.5)
  assert.equal(sent[1].pending, false)
})
