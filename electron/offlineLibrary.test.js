const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { loadOfflineLibraryFile, updateOfflineLibraryFile } = require('./offlineLibrary')

test('download completions merge into the latest offline library index', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-offline-library-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const dataPath = path.join(tempDir, 'offline-library.json')

  updateOfflineLibraryFile(dataPath, (library) => {
    library.playlists.favorites = { songIds: ['jw-existing'], name: 'Favorites' }
  })

  const finishDownload = async (id, delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    updateOfflineLibraryFile(dataPath, (library) => {
      library.tracks[id] = { localPath: path.join(tempDir, `${id}.mp3`) }
    })
  }

  await Promise.all([
    finishDownload('jw-first', 20),
    finishDownload('jw-second', 0),
  ])

  const library = loadOfflineLibraryFile(dataPath)
  assert.deepEqual(Object.keys(library.tracks).sort(), ['jw-first', 'jw-second'])
  assert.deepEqual(library.playlists.favorites.songIds, ['jw-existing'])
})

test('an unchanged index is parsed once, and a change on disk is read fresh', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-offline-library-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const dataPath = path.join(tempDir, 'offline-library.json')

  updateOfflineLibraryFile(dataPath, (library) => {
    library.tracks['jw-1'] = { localPath: 'a.mp3' }
  })
  assert.equal(loadOfflineLibraryFile(dataPath), loadOfflineLibraryFile(dataPath))

  fs.writeFileSync(dataPath, JSON.stringify({ tracks: { 'jw-2': { localPath: 'bb.mp3' } }, playlists: {} }))
  assert.deepEqual(Object.keys(loadOfflineLibraryFile(dataPath).tracks), ['jw-2'])
})

test('a mutation that throws leaves the index as it is on disk', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-offline-library-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const dataPath = path.join(tempDir, 'offline-library.json')

  updateOfflineLibraryFile(dataPath, (library) => {
    library.tracks['jw-1'] = { localPath: 'a.mp3' }
  })
  assert.throws(() => updateOfflineLibraryFile(dataPath, (library) => {
    library.tracks['jw-2'] = { localPath: 'b.mp3' }
    throw new Error('stop')
  }))
  assert.deepEqual(Object.keys(loadOfflineLibraryFile(dataPath).tracks), ['jw-1'])
})
