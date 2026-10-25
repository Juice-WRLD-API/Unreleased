const assert = require('node:assert/strict')
const test = require('node:test')
const { createLaunchGate } = require('./launchUpdate')

// Timers that only fire when the test says so.
function fakeTimers() {
  /** @type {Map<number, { fn: () => void, ms: number }>} */
  const pending = new Map()
  let next = 1
  return {
    setTimer: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { const id = next++; pending.set(id, { fn, ms }); return id },
    clearTimer: (/** @type {any} */ id) => { pending.delete(id) },
    // Runs the one live timer and returns its delay.
    fire() {
      assert.equal(pending.size, 1, 'expected exactly one live timer')
      const [[id, { fn, ms }]] = pending
      pending.delete(id)
      fn()
      return ms
    },
    get count() { return pending.size },
  }
}

const TIMEOUTS = { checkTimeoutMs: 10, stallTimeoutMs: 20, installTimeoutMs: 30 }
const tick = () => new Promise((resolve) => setImmediate(resolve))

/** @param {Promise<unknown>} p */
async function isSettled(p) {
  let done = false
  void p.then(() => { done = true })
  await tick()
  return done
}

/** Resolvable stand-in for the update check. */
function deferred() {
  /** @type {(v?: unknown) => void} */
  let resolve = () => {}
  /** @type {(e: unknown) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('opens as soon as the check finds nothing', async () => {
  const timers = fakeTimers()
  const gate = createLaunchGate({ check: async () => {}, install: () => assert.fail('nothing to install'), ...TIMEOUTS, ...timers })
  assert.equal(await isSettled(gate.opened), true)
  assert.equal(gate.active, false)
  assert.equal(timers.count, 0)
})

test('opens when the check fails', async () => {
  const logs = /** @type {string[]} */ ([])
  const gate = createLaunchGate({
    check: async () => { throw new Error('offline') }, install: () => {}, log: (m) => logs.push(m), ...TIMEOUTS, ...fakeTimers(),
  })
  assert.equal(await isSettled(gate.opened), true)
  assert.match(logs.join('\n'), /offline/)
})

test('a slow check opens the app and later events are ignored', async () => {
  const timers = fakeTimers()
  const check = deferred()
  let installs = 0
  const gate = createLaunchGate({ check: () => check.promise, install: () => { installs++ }, ...TIMEOUTS, ...timers })
  await tick()
  assert.equal(timers.fire(), TIMEOUTS.checkTimeoutMs)
  assert.equal(await isSettled(gate.opened), true)
  assert.equal(gate.active, false)

  // The background check finds an update after the app opened: main.js's
  // prompt handles it, the gate doesn't.
  gate.progress()
  gate.install()
  check.resolve()
  await tick()
  assert.equal(installs, 0)
  assert.equal(timers.count, 0)
})

test('progress swaps the check timeout for the stall timeout', async () => {
  const timers = fakeTimers()
  const check = deferred()
  const gate = createLaunchGate({ check: () => check.promise, install: () => {}, ...TIMEOUTS, ...timers })
  await tick()
  gate.progress()
  gate.progress()
  assert.equal(timers.count, 1)
  assert.equal(await isSettled(gate.opened), false)
  assert.equal(timers.fire(), TIMEOUTS.stallTimeoutMs)
  assert.equal(await isSettled(gate.opened), true)
})

test('a downloaded update installs without opening the app', async () => {
  const timers = fakeTimers()
  const check = deferred()
  let installs = 0
  const gate = createLaunchGate({ check: () => check.promise, install: () => { installs++ }, ...TIMEOUTS, ...timers })
  await tick()
  gate.progress()
  gate.install()
  gate.install()
  // The download promise resolves after update-downloaded.
  check.resolve()
  assert.equal(installs, 1)
  assert.equal(await isSettled(gate.opened), false)
  assert.equal(gate.active, true)
  // Progress after the handoff must not push the install fallback back.
  gate.progress()
  assert.equal(timers.count, 1)
})

test('opens the app when the installer never takes over', async () => {
  const timers = fakeTimers()
  const gate = createLaunchGate({ check: () => new Promise(() => {}), install: () => {}, ...TIMEOUTS, ...timers })
  await tick()
  gate.install()
  assert.equal(timers.fire(), TIMEOUTS.installTimeoutMs)
  assert.equal(await isSettled(gate.opened), true)
})

test('the check starts after the gate is returned', async () => {
  /** @type {any} */
  let seen = 'not called'
  /** @type {any} */
  let gate = null
  gate = createLaunchGate({ check: async () => { seen = gate }, install: () => {}, ...TIMEOUTS, ...fakeTimers() })
  await tick()
  assert.equal(seen, gate)
})
