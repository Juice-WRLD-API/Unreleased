// Headless native mixer regressions. Never opens an audio device or plugin UI.
// Build vsthost first, then: node --test scripts/test-native-session.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const exe = resolve('build/vsthost/vsthost.exe')
const sr = 48000
const tone = Float32Array.from({ length: sr }, (_, i) => .1 * Math.sin(2 * Math.PI * 1000 * i / sr))
const baseClip = { asset: 'a', start: 0, offset: 0, length: 1, rate: 1, gain: 1 }
const lane = (patch = {}) => ({ id: 'one', gain: 1, clips: [baseClip], ...patch })
function render(tracks, duration = 1, overrides = {}) {
  const input = Buffer.concat([
    Buffer.from(JSON.stringify({ op: 'asset', id: 'a', channels: 1, frames: tone.length, sampleRate: sr }) + '\n'),
    Buffer.from(tone.buffer),
    Buffer.from(JSON.stringify({ op: 'render', sampleRate: sr, duration, project: { tracks, masterGain: 1, bpm: 120, ...overrides } }) + '\n'),
  ])
  const result = spawnSync(exe, ['session-render'], { input, maxBuffer: 16 * 1024 * 1024, timeout: 10000, windowsHide: true })
  if (result.error) throw result.error
  const split = result.stdout.indexOf(10)
  const header = JSON.parse(result.stdout.subarray(0, split).toString())
  assert.equal(header.ok, true, header.error)
  assert.equal(result.status, 0)
  const pcm = result.stdout.subarray(split + 1)
  assert.equal(pcm.length, header.frames * 8)
  const read = (channel) => Float32Array.from({ length: header.frames }, (_, i) => pcm.readFloatLE((channel * header.frames + i) * 4))
  return [read(0), read(1)]
}
const rms = (data, start = .1, end = .9) => {
  const samples = data.slice(Math.floor(start * sr), Math.floor(end * sr))
  return Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length)
}

test('native clip timing preserves silence before a delayed clip', () => {
  const [audio] = render([lane({ clips: [{ ...baseClip, start: .25, offset: .1, length: .5 }] })])
  assert.equal(rms(audio, 0, .25), 0)
  assert.ok(rms(audio, .3, .7) > .06)
  assert.ok(audio.every(Number.isFinite))
})

test('native lane mute, solo and master gain', () => {
  assert.equal(rms(render([lane({ muted: true })])[0]), 0)
  const baseline = rms(render([lane()])[0])
  const solo = rms(render([lane({ solo: true }), lane({ id: 'two', gain: 4 })])[0])
  assert.ok(Math.abs(solo - baseline) < 1e-6)
  const half = rms(render([lane()], 1, { masterGain: .5 })[0])
  assert.ok(Math.abs(half / baseline - .5) < 1e-6)
})

test('native panning and comp silence', () => {
  const [left, right] = render([lane({ pan: -1 })])
  assert.ok(rms(left) > .1)
  assert.equal(rms(right), 0)
  const [comp] = render([lane({ clips: [{ ...baseClip, silence: [[.3, .6]] }] })])
  assert.ok(rms(comp, .4, .5) < .0001)
  assert.ok(rms(comp, .7, .8) > .06)
})

test('native clip gain, fades, and playback rate', () => {
  const [full] = render([lane()])
  const [half] = render([lane({ clips: [{ ...baseClip, gain: .5 }] })])
  assert.ok(Math.abs(rms(half) / rms(full) - .5) < .001)
  const [fade] = render([lane({ clips: [{ ...baseClip, fadeIn: .5, fadeOut: .5 }] })])
  assert.ok(rms(fade, .05, .1) < rms(fade, .4, .45) * .3)
  assert.ok(rms(fade, .9, .95) < rms(fade, .5, .55) * .3)
  const [fast] = render([lane({ clips: [{ ...baseClip, rate: 2, length: .5 }] })])
  assert.ok(rms(fast, .1, .4) > .05)
  assert.ok(rms(fast, .7, .9) < .0001)
})

test('native effect returns ring beyond the source clip and export stays finite', () => {
  const [dry] = render([lane({ clips: [{ ...baseClip, length: .2 }] })])
  const [wet] = render([lane({ clips: [{ ...baseClip, length: .2 }], fx: { echo: .7, reverb: .4, chorus: .3 } })])
  assert.ok(rms(wet, .4, .5) > rms(dry, .4, .5) + .001)
  assert.ok(wet.every(Number.isFinite))
})
