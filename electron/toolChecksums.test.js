const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

// main.js can't be required outside Electron, so read the pinned table as text.
// Every entry was once a character or two short, which failed every ffmpeg
// download with "Checksum mismatch" (and with it ALAC playback).
test('pinned ffmpeg checksums are full SHA-256 digests', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const table = /const FFMPEG_SHA256 = \{([\s\S]*?)\}/.exec(src)
  assert.ok(table, 'FFMPEG_SHA256 table not found')
  const entries = [...table[1].matchAll(/'([\w-]+)':\s*'([^']*)'/g)]
  assert.ok(entries.length >= 5)
  for (const [, key, hash] of entries) {
    assert.match(hash, /^[0-9a-f]{64}$/, `${key} checksum is not 64 hex characters`)
  }
})
