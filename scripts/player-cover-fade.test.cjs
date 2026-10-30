const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/renderer/src/components/PlayerMotion.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Hook and image-event host: exercise cached images without opening a browser.
function mount(src, cached = new Set()) {
  const slots = []
  const effects = new Map()
  let cursor = 0, dirty = false, writes = 0, tree
  const react = {
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (Object.is(value, slots[i].value)) return
        slots[i].value = value
        writes++
        dirty = true
      }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useLayoutEffect(fn, deps) {
      const i = cursor++
      if (slots[i]?.deps.every((d, j) => Object.is(d, deps[j]))) return
      slots[i] = { deps }
      effects.set(i, fn)
    },
  }
  const module = { exports: {} }
  const jsx = (type, props, key) => ({ type, props, key })
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : require(name),
  })
  const render = (next = src) => {
    src = next
    let passes = 0
    do {
      assert.ok(++passes < 20, 'cover updates must settle')
      dirty = false
      cursor = 0
      tree = module.exports.CoverFade({ src })
      if (dirty) continue
      tree.props.ref.current = { querySelectorAll: () => tree.props.children.map(img => ({
        complete: cached.has(img.props.src), naturalWidth: cached.has(img.props.src) ? 100 : 0,
        getAttribute: () => img.props.src,
      })) }
      const pending = [...effects.values()]
      effects.clear()
      pending.forEach(fn => fn())
    } while (dirty)
  }
  render()
  return {
    render,
    images: () => tree.props.children,
    writes: () => writes,
    event(img, name) { img.props[name](); render() },
  }
}

test('a cached cover returning before the replacement loads becomes visible without a load event', () => {
  const cover = mount('a', new Set(['a']))
  cover.render('b')
  assert.equal(cover.images().at(-1).props.style.opacity, 0)
  cover.render('a')
  assert.equal(cover.images().length, 1)
  assert.equal(cover.images()[0].props.src, 'a')
  assert.equal(cover.images()[0].props.style.opacity, 1)
  const settled = cover.writes()
  for (let i = 0; i < 100; i++) cover.render()
  assert.equal(cover.writes(), settled)
})

test('load and transition events are idempotent, including events from removed layers', () => {
  const cover = mount('a')
  const a = cover.images()[0]
  cover.event(a, 'onLoad')
  assert.equal(cover.images()[0].props.style.opacity, 1)
  let settled = cover.writes()
  cover.event(a, 'onLoad')
  assert.equal(cover.writes(), settled)
  cover.render('b')
  const b = cover.images().at(-1)
  cover.event(b, 'onLoad')
  cover.event(a, 'onTransitionEnd')
  assert.equal(cover.images().length, 1)
  assert.equal(cover.images()[0].props.src, 'b')
  assert.equal(cover.images()[0].props.style.opacity, 1)
  settled = cover.writes()
  cover.event(a, 'onTransitionEnd')
  cover.event(a, 'onLoad')
  cover.event(b, 'onTransitionEnd')
  assert.equal(cover.writes(), settled)
})
