const assert = require('node:assert/strict')
const test = require('node:test')
const { buildActivity } = require('./discordRpc')

const NOW = 1_700_000_000_000

test('a playing activity is anchored to the playhead, even with no duration yet', () => {
  const playing = buildActivity({
    title: 'Lucid Dreams',
    artist: 'Juice WRLD',
    isPlaying: true,
    currentTime: 495,
    duration: 240,
  }, NOW)
  assert.equal(playing.startTimestamp, NOW - 495_000)
  assert.equal(playing.endTimestamp, NOW - 495_000 + 240_000)
  assert.equal(playing.state, 'Juice WRLD')

  const unknownLength = buildActivity({
    title: 'Lucid Dreams',
    artist: 'Juice WRLD',
    isPlaying: true,
    currentTime: 3,
    duration: 0,
  }, NOW)
  assert.equal(unknownLength.startTimestamp, NOW - 3_000)
  assert.equal(unknownLength.endTimestamp, undefined)
  assert.equal(unknownLength.state, 'Juice WRLD')
})

test('a paused activity freezes the position as text and sends no timestamps', () => {
  const paused = buildActivity({
    title: 'Lucid Dreams',
    artist: 'Juice WRLD',
    isPlaying: false,
    currentTime: 3,
    duration: 240,
  }, NOW)
  assert.equal(paused.startTimestamp, undefined)
  assert.equal(paused.endTimestamp, undefined)
  assert.equal(paused.state, '⏸ 0:03 / 4:00 · Juice WRLD')
})
