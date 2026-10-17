const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'AlbumArtThumbnail.tsx'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Exercise image error events without a browser. The single state hook is
// retained on rerender and reset at the component's keyed boundary.
function mount(initialProps) {
  let state
  let key
  let props = initialProps
  const loaded = { exports: {} }
  const variant = (url, size) => url?.startsWith('https:') ? `${url}?size=${size}` : url
  const mockRequire = (name) => {
    if (name === 'react') return { useState: (initial) => {
      if (state === undefined) state = initial
      return [state, (next) => { state = next }]
    } }
    if (name === 'lucide-react') return { Music2: 'music-icon' }
    if (name === '../lib/juicewrldApi') return {
      smallCoverUrl: (url) => variant(url, 128),
      sizedCoverUrl: variant,
      fullCoverUrl: (url) => variant(url, 1024),
    }
    return require(name)
  }
  Function('require', 'module', 'exports', compiled)(mockRequire, loaded, loaded.exports)
  return (nextProps = props) => {
    props = nextProps
    const component = loaded.exports.AlbumArtThumbnail(props)
    if (component.key !== key) { state = undefined; key = component.key }
    return component.type(component.props)
  }
}

const track = { id: 'jw-1', title: 'Burn (v2)', imageUrl: 'https://covers.example/burn.png' }

test('a failed Home resize recovers with a small cover, then the 1024px copy', () => {
  const render = mount({ track, fill: true, res: 512 })
  let image = render()
  assert.equal(image.props.src, `${track.imageUrl}?size=512`)
  image.props.onError()
  image = render()
  assert.equal(image.type, 'img')
  assert.equal(image.props.src, `${track.imageUrl}?size=128`)
  assert.equal(image.props.style, undefined)
  image.props.onError()
  image = render()
  assert.equal(image.props.src, `${track.imageUrl}?size=1024`)
  image.props.onError()
  const fallback = render()
  assert.equal(fallback.type, 'div')
  assert.equal(fallback.props.children.type, 'music-icon')
})

test('row thumbnails skip duplicate small variants', () => {
  const render = mount({ track })
  render().props.onError()
  assert.equal(render().props.src, `${track.imageUrl}?size=1024`)
  render().props.onError()
  assert.equal(render().type, 'div')
})

test('local covers are attempted once and missing covers immediately show an icon', () => {
  const render = mount({ track: { ...track, imageUrl: 'data:image/png;base64,test' }, res: 512 })
  render().props.onError()
  assert.equal(render().type, 'div')
  const fallback = render({ track: { ...track, imageUrl: undefined } })
  assert.equal(fallback.type, 'div')
  assert.equal(fallback.props.children.type, 'music-icon')
})

test('changing the cover or resolution resets failures', () => {
  const render = mount({ track, res: 512 })
  render().props.onError()
  render().props.onError()
  render().props.onError()
  assert.equal(render().type, 'div')
  const replacement = { ...track, imageUrl: 'https://covers.example/game.png' }
  assert.equal(render({ track: replacement, res: 512 }).props.src, `${replacement.imageUrl}?size=512`)
  render().props.onError()
  assert.equal(render({ track: replacement, res: 256 }).props.src, `${replacement.imageUrl}?size=256`)
})

test('fallback attempts preserve sizing, title, classes and eager loading', () => {
  const render = mount({ track, size: 48, eager: true, className: 'rounded-lg' })
  render().props.onError()
  const image = render()
  assert.deepEqual(image.props.style, { width: '3rem', height: '3rem' })
  assert.equal(image.props.alt, track.title)
  assert.equal(image.props.loading, 'eager')
  assert.match(image.props.className, /rounded-lg/)
})
