const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { codecFromSource } = require('./alac')
const { sniffFile, liveBody, createAlacPlayback } = require('./alacPlayback')

function box(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const out = Buffer.alloc(8 + body.length)
  out.writeUInt32BE(out.length, 0)
  out.write(type, 4, 4, 'latin1')
  body.copy(out, 8)
  return out
}

function stsd(format) {
  const entry = Buffer.alloc(16)
  entry.writeUInt32BE(16, 0)
  entry.write(format, 4, 4, 'latin1')
  const head = Buffer.alloc(8)
  head.writeUInt32BE(1, 4)
  return box('stsd', Buffer.concat([head, entry]))
}

function trak(format) {
  return box('trak', box('mdia', box('minf', box('stbl', stsd(format)))))
}

function mp4(tracks, leading) {
  const moov = box('moov', Buffer.concat(tracks.map(trak)))
  const ftyp = box('ftyp', Buffer.from('M4A '))
  return Buffer.concat(leading ? [ftyp, ...leading, moov] : [ftyp, moov])
}

function caf(format) {
  const desc = Buffer.alloc(32)
  desc.writeDoubleBE(44100, 0)
  desc.write(format, 8, 4, 'latin1')
  const head = Buffer.alloc(12)
  head.write('desc', 0, 4, 'latin1')
  head.writeBigInt64BE(BigInt(desc.length), 4)
  const file = Buffer.alloc(8 + head.length + desc.length)
  file.write('caff', 0)
  file.writeUInt16BE(1, 4)
  head.copy(file, 8)
  desc.copy(file, 20)
  return file
}

function reader(buf) {
  return async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length))
}

test('mp4 sample entry distinguishes ALAC from AAC', async () => {
  assert.equal(await codecFromSource(reader(mp4(['alac'])), mp4(['alac']).length), 'alac')
  assert.equal(await codecFromSource(reader(mp4(['mp4a'])), mp4(['mp4a']).length), 'aac')
})

test('an attached cover does not hide an ALAC track', async () => {
  const buf = mp4(['jpeg', 'alac'])
  assert.equal(await codecFromSource(reader(buf), buf.length), 'alac')
})

test('moov after mdat is still found', async () => {
  const buf = mp4(['alac'], [box('mdat', Buffer.alloc(64))])
  assert.equal(await codecFromSource(reader(buf), buf.length), 'alac')
})

test('caf desc chunk names alac and pcm apart', async () => {
  const alac = caf('alac')
  const pcm = caf('lpcm')
  assert.equal(await codecFromSource(reader(alac), alac.length), 'alac')
  assert.equal(await codecFromSource(reader(pcm), pcm.length), 'other')
})

test('a live transcode can be read while it is still being written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alac-tail-'))
  const file = path.join(dir, 'out.flac')
  /** @type {(value?: void) => void} */
  let release = () => {}
  const job = new Promise((resolve) => { release = resolve })
  const body = await liveBody(file, job, null)
  assert.equal(body.status, 200)
  const chunks = []
  const done = new Promise((resolve, reject) => {
    body.stream.on('data', (chunk) => chunks.push(chunk))
    body.stream.on('end', resolve)
    body.stream.on('error', reject)
  })
  body.stream.resume()
  await new Promise((r) => setTimeout(r, 20))
  fs.writeFileSync(file, Buffer.from('hello'))
  await new Promise((r) => setTimeout(r, 50))
  fs.appendFileSync(file, Buffer.from(' world'))
  release()
  await done
  assert.equal(Buffer.concat(chunks).toString(), 'hello world')
  fs.rmSync(dir, { recursive: true, force: true })
})

/** @type {string | null} */
let ffmpeg = null
try {
  const resolved = require('ffmpeg-static')
  ffmpeg = typeof resolved === 'string' ? resolved : null
} catch { /* devDependency, absent in a packaged tree */ }

test('a real ALAC m4a is sniffed and played back as FLAC', { skip: !ffmpeg }, async () => {
  if (!ffmpeg) return
  const bin = ffmpeg
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alac-real-'))
  const pcm = path.join(dir, 'tone.pcm')
  const alac = path.join(dir, 'tone.m4a')
  const aac = path.join(dir, 'tone-aac.m4a')
  const caf = path.join(dir, 'tone.caf')
  fs.writeFileSync(pcm, Buffer.alloc(44100)) // one second of silence, s16le mono
  const raw = ['-hide_banner', '-y', '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', pcm]
  const enc = (args) => spawnSync(bin, [...raw, ...args], { encoding: 'utf8' })
  assert.equal(enc(['-c:a', 'alac', alac]).status, 0, 'encode alac')
  assert.equal(enc(['-c:a', 'aac', '-b:a', '64k', aac]).status, 0, 'encode aac')
  assert.equal(enc(['-c:a', 'alac', caf]).status, 0, 'encode caf')
  assert.equal(await sniffFile(alac), 'alac')
  assert.equal(await sniffFile(aac), 'aac')
  assert.equal(await sniffFile(caf), 'alac')

  const playback = createAlacPlayback({
    cacheDir: () => path.join(dir, 'cache'),
    ffmpegPath: () => bin,
  })
  assert.equal(await playback.startLocal(aac), null)
  const started = await playback.startLocal(alac)
  if (!started || !('live' in started)) throw new Error('expected a live transcode')
  await started.job
  assert.equal(fs.existsSync(started.live + '.ok'), true)
  const probe = spawnSync(bin, ['-hide_banner', '-i', started.live], { encoding: 'utf8' })
  assert.match(probe.stderr, /Audio:\s+flac/i)
  // A second request for the same file serves the finished transcode.
  const again = await playback.startLocal(alac)
  if (!again || !('ready' in again)) throw new Error('expected the cached transcode')
  assert.equal(again.ready, true)
  assert.equal(again.path, started.live)
  fs.rmSync(dir, { recursive: true, force: true })
})
