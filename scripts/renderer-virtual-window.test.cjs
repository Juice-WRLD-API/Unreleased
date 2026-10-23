const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/hooks/useVirtualWindow.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

// A deterministic hook/event harness: no renderer, browser, or wall-clock waits.
function mount(name, args) {
  const slots = []
  const effects = []
  const frames = new Map()
  const observers = new Set()
  let cursor = 0
  let frameId = 0
  let dirty = false
  let writes = 0
  let result
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (Object.is(value, slots[i].value)) return
        slots[i].value = value
        writes++
        dirty = true
      }]
    },
    useRef(initial) {
      const i = cursor++
      return slots[i] ??= { current: initial }
    },
    useCallback(fn, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }
      return slots[i].value
    },
    useLayoutEffect(fn, deps) {
      const i = cursor++
      if (same(slots[i]?.deps, deps)) return
      effects.push(() => {
        slots[i]?.cleanup?.()
        slots[i] = { deps, cleanup: fn() }
      })
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => name === 'react' ? react : require(name),
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; observers.add(this) }
      observe() {}
      disconnect() { observers.delete(this) }
    },
  })
  const render = (next = args) => {
    args = next
    let commits = 0
    do {
      assert.ok(++commits < 20, 'hook must settle')
      dirty = false
      cursor = 0
      result = module.exports[name](...args)
      effects.splice(0).forEach(fn => fn())
    } while (dirty)
    return result
  }
  render()
  return {
    render,
    get result() { return result },
    get writes() { return writes },
    get pendingFrames() { return frames.size },
    frame() {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(fn => fn())
      if (dirty) render()
    },
    resize() { observers.forEach(o => o.fn()); if (dirty) render() },
    unmount() { slots.forEach(s => s.cleanup?.()) },
  }
}

function elements(height = 500, header = 0) {
  const listeners = new Map()
  const scroll = {
    scrollTop: 0, clientHeight: height, clientTop: 2,
    getBoundingClientRect: () => ({ top: 120 }),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) },
  }
  const content = {
    // Deliberately unrelated: its offset parent is outside the scroller.
    offsetTop: 999,
    getBoundingClientRect: () => ({ top: 122 + header - scroll.scrollTop }),
  }
  return {
    scroll, content,
    refs: [{ current: scroll }, { current: content }],
    to(top) { scroll.scrollTop = top; listeners.get('scroll')?.() },
    get listening() { return listeners.has('scroll') },
  }
}

test('scrolling within a row publishes no new React state; bursts share one frame', () => {
  const el = elements(450)
  const hook = mount('useVirtualWindow', [...el.refs, 1000, 50])
  el.to(101)
  hook.frame()
  const writes = hook.writes
  for (let y = 102; y < 149; y++) el.to(y)
  assert.equal(hook.pendingFrames, 1)
  hook.frame()
  assert.equal(hook.writes, writes)
  el.to(201)
  hook.frame()
  assert.equal(hook.writes, writes + 1)
  assert.equal(hook.result.end, 18)
})

test('content coordinates account for a header and a different offset parent', () => {
  const el = elements(400, 200)
  const hook = mount('useVirtualWindow', [...el.refs, 1000, 50])
  el.to(700)
  hook.frame()
  assert.equal(hook.result.start, 6)
  assert.equal(hook.result.end, 22)
})

test('filtering a deeply scrolled list never exposes an inverted range', () => {
  const el = elements()
  const hook = mount('useVirtualWindow', [...el.refs, 1000, 50])
  el.to(40000)
  hook.frame()
  const filtered = hook.render([...el.refs, 3, 50])
  assert.ok(filtered.start <= filtered.end)
  assert.ok(filtered.end <= 3)
  el.to(0) // browser clamps after the content shrinks
  hook.frame()
  assert.equal(hook.result.start, 0)
  assert.equal(hook.result.end, 3)
  assert.equal(hook.render([...el.refs, 0, 50]).end, 0)
})

test('resize and row scale changes refresh the window without a scroll event', () => {
  const el = elements(400)
  const hook = mount('useVirtualWindow', [...el.refs, 100, 50])
  assert.equal(hook.result.end, 12)
  el.scroll.clientHeight = 800
  hook.resize()
  assert.equal(hook.result.end, 20)
  hook.render([...el.refs, 100, 100])
  assert.equal(hook.result.end, 12)
})

test('playlist elements can mount later and pending frames are removed on unmount', () => {
  const el = elements(400)
  const hook = mount('useVirtualWindowEl', [null, null, 100, 50])
  hook.render([el.scroll, el.content, 100, 50])
  assert.equal(hook.result.end, 12)
  el.to(1000)
  assert.equal(hook.pendingFrames, 1)
  hook.unmount()
  assert.equal(hook.pendingFrames, 0)
  assert.equal(el.listening, false)
})

test('variable rows match visible intersections, including expanded cards and exact edges', () => {
  const el = elements(200)
  const offsets = [0, 250, 500, 1000, 1250, 1800, 2050, 2300]
  const hook = mount('useVariableVirtualWindow', [...el.refs, offsets, 2300])
  for (const top of [0, 50, 250, 450, 501, 800, 1000, 1600, 2300]) {
    el.to(top)
    hook.frame()
    const expected = offsets.slice(0, -1).map((_, i) => i)
      .filter(i => offsets[i + 1] >= top - 200 && offsets[i] <= top + 400)
    assert.deepEqual(Array.from({ length: hook.result.end - hook.result.start }, (_, i) => i + hook.result.start), expected)
  }
  hook.render([...el.refs, [0], 0])
  assert.equal(hook.result.start, 0)
  assert.equal(hook.result.end, 0)
})

test('large variable grids locate visible rows without scanning the catalogue', () => {
  const el = elements(500)
  let reads = 0
  const offsets = new Proxy(Array.from({ length: 100001 }, (_, i) => i * 250), {
    get(target, key) {
      if (/^\d+$/.test(String(key))) reads++
      return target[key]
    },
  })
  const hook = mount('useVariableVirtualWindow', [...el.refs, offsets, 25000000])
  reads = 0
  el.to(12500000)
  hook.frame()
  assert.ok(hook.result.start <= 50000 && hook.result.end > 50000)
  assert.ok(reads < 100, `expected logarithmic lookup, got ${reads} offset reads`)
})
