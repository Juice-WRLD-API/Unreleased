import assert from 'node:assert/strict'
import test from 'node:test'
import { createSharedFlight } from '../src/renderer/src/lib/sharedFlight.ts'

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })
const micro = (): Promise<void> => Promise.resolve()

test('a second wait joins the job the first wait just aborted', async () => {
  const shared = createSharedFlight<string>()
  let starts = 0
  let jobSignal: AbortSignal | null = null
  let finish: (value: string) => void = () => {}
  const first = new AbortController()
  const lost = shared.join('song', (signal) => {
    starts += 1
    jobSignal = signal
    return new Promise((resolve) => { finish = resolve })
  }, first.signal).then(() => null, (err: unknown) => err)
  first.abort()
  // Release runs as a microtask and only schedules the drop. The remount joins
  // on a later microtask, still before that timer.
  await micro()
  const second = shared.join('song', () => {
    starts += 1
    return Promise.resolve('other')
  })
  await micro()
  await tick()
  assert.equal(starts, 1)
  assert.equal(jobSignal?.aborted, false)
  finish('sync')
  assert.equal(await second, 'sync')
  const err = await lost
  assert.ok(err instanceof DOMException && err.name === 'AbortError')
})

test('the job is dropped once the last wait stays gone', async () => {
  const shared = createSharedFlight<string>()
  let jobSignal: AbortSignal | null = null
  const first = new AbortController()
  const lost = shared.join('song', (signal) => {
    jobSignal = signal
    return new Promise(() => {})
  }, first.signal).then(() => null, (err: unknown) => err)
  first.abort()
  await micro()
  assert.equal(jobSignal?.aborted, false)
  await tick()
  assert.equal(jobSignal?.aborted, true)
  const err = await lost
  assert.ok(err instanceof DOMException && err.name === 'AbortError')
  let starts = 0
  const again = shared.join('song', () => {
    starts += 1
    return Promise.resolve('fresh')
  })
  assert.equal(starts, 1)
  assert.equal(await again, 'fresh')
})

test('one of two waits aborting leaves the job for the other', async () => {
  const shared = createSharedFlight<string>()
  let starts = 0
  let jobSignal: AbortSignal | null = null
  let finish: (value: string) => void = () => {}
  const start = (signal: AbortSignal): Promise<string> => {
    starts += 1
    jobSignal = signal
    return new Promise((resolve) => { finish = resolve })
  }
  const first = new AbortController()
  const lost = shared.join('song', start, first.signal).then(() => null, (err: unknown) => err)
  const second = shared.join('song', start)
  first.abort()
  await micro()
  await tick()
  assert.equal(starts, 1)
  assert.equal(jobSignal?.aborted, false)
  finish('sync')
  assert.equal(await second, 'sync')
  const err = await lost
  assert.ok(err instanceof DOMException && err.name === 'AbortError')
})
