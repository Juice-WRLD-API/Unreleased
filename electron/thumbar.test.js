const test = require('node:test')
const assert = require('node:assert')
const { rasterize, SHAPES } = require('./thumbar')

const coverage = (buf) => {
  let sum = 0
  for (let i = 3; i < buf.length; i += 4) sum += buf[i]
  return sum / (255 * (buf.length / 4))
}

test('every thumbnail icon draws something and leaves a margin', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const buf = rasterize(shape, 32, [255, 255, 255])
    assert.equal(buf.length, 32 * 32 * 4, name)
    const c = coverage(buf)
    assert.ok(c > 0.08 && c < 0.7, `${name} covers ${c.toFixed(2)}`)
    // Corners stay clear.
    for (const i of [0, 31, 32 * 31, 32 * 32 - 1]) assert.equal(buf[i * 4 + 3], 0, `${name} corner`)
  }
})

test('the liked heart is filled and the like heart is an outline', () => {
  const filled = coverage(rasterize(SHAPES.liked, 32, [255, 255, 255]))
  const outline = coverage(rasterize(SHAPES.like, 32, [255, 255, 255]))
  assert.ok(outline < filled * 0.75)
  // The outline's middle is empty.
  assert.equal(SHAPES.like(8, 8.5), false)
  assert.equal(SHAPES.liked(8, 8.5), true)
})

test('pixels are premultiplied', () => {
  const buf = rasterize(SHAPES.play, 32, [255, 255, 255])
  for (let i = 0; i < buf.length; i += 4) assert.ok(buf[i] <= buf[i + 3])
})
