// Desktop (iJWA built in): the parts that are pure logic - the light's engine, the lyric timing and scheduling, the
// settings' defaults and merging, the widgets' measurements, the foreground watch - checked without a window.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const RENDERER = path.join(__dirname, '../src/renderer/src')

/** Loads a renderer TypeScript module and the relative modules it imports, transpiled to CommonJS. */
function loadTs(file, mocks = {}, cache = new Map()) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const source = fs.readFileSync(full, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const mod = { exports: {} }
  cache.set(full, mod)
  const localRequire = (name) => {
    if (name in mocks) return mocks[name]
    if (name.endsWith('.css')) return {}
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(full), name)
      const found = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((f) => fs.existsSync(f))
      if (!found) throw new Error(`cannot find ${name} from ${full}`)
      return loadTs(found, mocks, cache)
    }
    return require(name)
  }
  Function('require', 'module', 'exports', compiled.outputText)(localRequire, mod, mod.exports)
  return mod.exports
}

const engine = loadTs(path.join(RENDERER, 'desktop/light/engine.ts'))
const looks = loadTs(path.join(RENDERER, 'desktop/light/looks.ts'))
const timing = loadTs(path.join(RENDERER, 'desktop/lyrics/timing.ts'))

// ---- the light ----

test('every light has a shader function, and an unknown one falls back to the first', () => {
  assert.equal(looks.LOOKS.length, 22)
  for (const look of looks.LOOKS) assert.match(look.fn, /Fragment$/)
  assert.equal(looks.lookOf('nope').id, 'snake')
  assert.equal(looks.lookOf('ticker').words, true)
  assert.equal(looks.placeNumber('corners'), 3)
  assert.equal(looks.placeNumber('nowhere'), 0)
})

test('colors go to RGB and back', () => {
  for (const hsb of [{ hue: 0, saturation: 1, brightness: 1 }, { hue: 0.33, saturation: 0.5, brightness: 0.8 }, { hue: 0.74, saturation: 0.68, brightness: 1 }]) {
    const back = engine.rgbToHsb(engine.hsbToRgb(hsb))
    assert.ok(Math.abs(back.hue - hsb.hue) < 1e-6 && Math.abs(back.saturation - hsb.saturation) < 1e-6 && Math.abs(back.brightness - hsb.brightness) < 1e-6)
  }
  const [r, g, b] = engine.oklabToRgb(engine.rgbToOklab([0.2, 0.6, 0.9]))
  assert.ok(Math.abs(r - 0.2) < 1e-4 && Math.abs(g - 0.6) < 1e-4 && Math.abs(b - 0.9) < 1e-4)
})

test('a beat counts only over the threshold, more with more sensitivity', () => {
  const style = { sensitivity: 0.5 }
  assert.equal(engine.beatOf(style, 1), 0)
  assert.ok(engine.beatOf(style, 2.5) > 0)
  assert.ok(engine.beatOf({ sensitivity: 1 }, 1.6) > engine.beatOf({ sensitivity: 0 }, 1.6))
  assert.equal(engine.musicLevel(style, -200), 0)
  assert.equal(engine.musicLevel(style, 0), 1)
})

test('the artwork gives its vivid colors, and grey artwork none', () => {
  const side = 32
  const grey = new Uint8ClampedArray(side * side * 4).fill(128)
  assert.equal(engine.paletteFromPixels(grey, side), null)
  const red = new Uint8ClampedArray(side * side * 4)
  for (let i = 0; i < red.length; i += 4) { red[i] = 230; red[i + 1] = 20; red[i + 2] = 30; red[i + 3] = 255 }
  const colors = engine.paletteFromPixels(red, side)
  assert.ok(colors)
  assert.ok(colors.primary.hue < 0.05 || colors.primary.hue > 0.95)
})

test('the light fades in over a second, and held still draws the plain rim', () => {
  const light = new engine.LightEngine()
  const style = { ...engine.DEFAULT_LIGHT, motion: 'still' }
  light.fadeTo(1, 0)
  let frame = light.step(0, { decibels: -20, punch: 0 }, true, style, [1920, 1080], 1)
  assert.equal(frame.fn, 'rimFragment')
  frame = light.step(1.2, { decibels: -20, punch: 0 }, true, style, [1920, 1080], 1)
  assert.equal(frame.presence, 1)
  assert.equal(light.frameRate(style, true, 1.2), 0)
})

// ---- the lyrics ----

test('a line\'s words are spread over it in order, and adlibs kept apart', () => {
  const lyrics = timing.timedFromLines([{ time: 12, text: 'second line here' }, { time: 10, text: 'all girls are the same (yeah)' }], 0.5)
  assert.deepEqual(lyrics.lines.map((l) => l.time), [10.5, 12.5])
  const first = lyrics.lines[0]
  assert.deepEqual(first.words.map((w) => w.text), ['all', 'girls', 'are', 'the', 'same'])
  assert.deepEqual(first.adlibs.map((a) => a.text), ['yeah'])
  // Every word as written too, for a style that sings the adlibs in the line (Karaoke).
  assert.deepEqual(first.all.map((w) => w.text), ['all', 'girls', 'are', 'the', 'same', '(yeah)'])
  for (let i = 1; i < first.words.length; i++) assert.ok(first.words[i].start >= first.words[i - 1].end - 1e-9)
  assert.ok(first.words[first.words.length - 1].end <= 12.5)
})

test('an adlib never closed counts as the line\'s own words', () => {
  const { words, adlibs } = timing.separate(timing.spread('one (two three', 0, 2))
  assert.deepEqual(words.map((w) => w.text), ['one', '(two', 'three'])
  assert.equal(adlibs.length, 0)
})

test('untimed lyrics are paced evenly over the song', () => {
  const lyrics = timing.pacedFromText('a b\n\nc d\ne f', 90)
  assert.deepEqual(lyrics.lines.map((l) => l.time), [0, 30, 60])
})

test('the scene\'s clock runs at the song\'s speed, and stands still paused', () => {
  const scene = loadTs(path.join(RENDERER, 'desktop/lyrics/scene.ts'))
  const now = scene.epochNow()
  assert.ok(Math.abs(scene.clockTime({ seconds: 10, at: now - 2, running: true, rate: 1.5 }) - 13) < 0.05)
  assert.equal(scene.clockTime({ seconds: 10, at: now - 2, running: false }), 10)
})

test('the line sung is found by its start, and a long break shows the song\'s name', () => {
  const { LyricScene } = loadTs(path.join(RENDERER, 'desktop/lyrics/scene.ts'))
  const line = (index, start, end) => ({ index, words: [{ text: 'x', start, end }] })
  const self = { lines: [line(0, 5, 6), line(1, 7, 8), line(2, 30, 31)], resting: LyricScene.prototype.resting }
  const lineAt = (t) => LyricScene.prototype.lineAt.call(self, t)
  assert.equal(lineAt(1), -1)
  assert.equal(lineAt(5.5), 0)
  assert.equal(lineAt(7.5), 1)
  // Past the second line's end by 2.5 s with the next far off: a break.
  assert.equal(lineAt(12), -1)
  assert.equal(lineAt(30), 2)
})

// ---- the settings ----

test('everything Desktop starts off, and saved settings keep defaults added later', () => {
  const store = new Map()
  const slice = loadTs(path.join(RENDERER, 'store/desktopSlice.ts'), {
    '../lib/persist': { ls: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) } },
  })
  const d = slice.DESKTOP_DEFAULTS
  assert.equal(d.light.isOn, false)
  assert.equal(d.player.isOn, false)
  assert.equal(d.playlist.isOn, false)
  assert.equal(d.clock.isOn, false)
  assert.equal(d.lyrics.look, 'karaoke')
  // The cleared desk shows WRLD's visualizer once there's one to show; settings saved before it get that too.
  assert.equal(d.clear.visualizer, true)
  assert.equal(slice.mergeDesktop(d, { light: { look: 'lava' } }).clear.visualizer, true)
  assert.equal(slice.mergeDesktop(d, { clear: { visualizer: false } }).clear.visualizer, false)
  // Out of the desktop, but all three in WRLD's Widgets layout once that's picked.
  for (const which of ['player', 'playlist', 'clock']) { assert.equal(d[which].inWrld, true); assert.equal(d[which].tabPlace, null) }
  const merged = slice.mergeDesktop(d, { light: { look: 'lava' }, player: { size: 1 }, hiddenDisplays: ['DELL', 3] })
  assert.equal(merged.light.look, 'lava')
  assert.equal(merged.light.glow, d.light.glow)
  assert.equal(merged.player.size, 1)
  assert.equal(merged.player.tilt, d.player.tilt)
  assert.deepEqual(merged.hiddenDisplays, ['DELL'])
  assert.equal(slice.mergeDesktop(d, null), d)
})

test('a widget\'s right-click menu hides and shows it where it was clicked, and sets what the settings do', () => {
  const slice = loadTs(path.join(RENDERER, 'store/desktopSlice.ts'), { '../lib/persist': { ls: { get: () => null, set: () => {} } } })
  const { widgetMenu } = loadTs(path.join(RENDERER, 'desktop/widgetMenu.ts'), { '../lib/persist': { ls: { get: () => null, set: () => {} } } })
  const d = slice.mergeDesktop(slice.DESKTOP_DEFAULTS, { playlist: { isOn: true, source: 'playlist:7' } })
  const rows = (entries) => entries.filter((e) => e !== 'divider')
  const find = (entries, label) => rows(entries).find((e) => e.label === label)

  const inTab = widgetMenu('playlist', d, { where: 'tab', desktopToo: true, playlists: [{ id: '7', name: 'Night & Day' }] })
  assert.deepEqual(find(inTab, 'Hide playlist from WRLD').arg, { playlist: { inWrld: false } })
  assert.deepEqual(find(inTab, 'Reset position').arg, { playlist: { tabPlace: null } })
  assert.deepEqual(find(inTab, 'Also on the desktop'), { label: 'Also on the desktop', checked: true, cmd: 'set', arg: { playlist: { isOn: false } } })
  const shown = find(find(inTab, 'Show').children, 'Night & Day')
  assert.equal(shown.checked, true)
  assert.deepEqual(find(inTab, 'Widgets').children.map((w) => w.checked), [true, true, true])
  assert.equal(find(inTab, 'Clear the desk'), undefined)
  // Medium is the widget's own default size; a size between the stops ticks none.
  assert.equal(find(find(inTab, 'Size').children, 'Medium').checked, true)
  const between = slice.mergeDesktop(d, { playlist: { size: 0.6 } })
  assert.equal(find(widgetMenu('playlist', between, { where: 'tab', desktopToo: true, playlists: [] }), 'Size').children.some((s) => s.checked), false)
  // Only on Windows can a widget go out on the desktop.
  assert.equal(find(widgetMenu('clock', d, { where: 'tab', desktopToo: false, playlists: [] }), 'Also on the desktop'), undefined)

  const onDesktop = widgetMenu('player', d, { where: 'desktop', desktopToo: true, isClear: true, playlists: [] })
  assert.deepEqual(find(onDesktop, 'Hide player from the desktop').arg, { player: { isOn: false } })
  assert.deepEqual(find(onDesktop, 'Reset position').arg, { player: { place: null } })
  assert.deepEqual(find(onDesktop, 'Widgets').children.map((w) => w.checked), [false, true, false])
  assert.deepEqual(find(onDesktop, 'Mini player').arg, { player: { mini: true } })
  assert.equal(find(onDesktop, 'Bring everything back').cmd, 'clear')
  assert.deepEqual(find(onDesktop, 'Visualizer on the cleared desk'), { label: 'Visualizer on the cleared desk', checked: true, cmd: 'set', arg: { clear: { visualizer: false } } })
  assert.equal(find(inTab, 'Visualizer on the cleared desk'), undefined)

  // On the lyrics: theirs in place of the player's own, the widget's place and the rest still after.
  const onLyrics = widgetMenu('player', d, { where: 'tab', desktopToo: true, playlists: [], part: 'lyrics', lyrics: { has: true, timed: false } })
  assert.equal(find(onLyrics, 'Copy lyrics').cmd, 'copy-lyrics')
  assert.equal(find(onLyrics, 'Download synced lyrics'), undefined)
  assert.equal(find(onLyrics, 'Mini player'), undefined)
  assert.deepEqual(find(find(onLyrics, 'Style').children, 'Karaoke'), { label: 'Karaoke', radio: true, checked: true, cmd: 'set', arg: { lyrics: { look: 'karaoke' } } })
  assert.deepEqual(find(onLyrics, 'Hide lyrics').arg, { player: { lyricsOpen: false } })
  assert.ok(find(onLyrics, 'Lock position'))
  const noLyrics = widgetMenu('player', d, { where: 'tab', desktopToo: true, playlists: [], part: 'lyrics', lyrics: { has: false, timed: false } })
  assert.equal(find(noLyrics, 'Copy lyrics').disabled, true)
})

test('a visualizer frame sent to the cleared desk arrives as it was analysed', () => {
  const audio = loadTs(path.join(RENDERER, 'lib/viz/audio.ts'))
  const here = new audio.AudioEngine()
  // The gentle signal of no audio, a few frames in, so every part has moved.
  let frame
  for (let i = 0; i < 30; i++) frame = here.analyze(1 / 60, true)
  const packed = audio.packFrame(frame)
  assert.equal(packed.length, audio.PACKED_LENGTH)
  const there = new audio.AudioEngine()
  there.feed(packed)
  const got = there.analyze(1 / 60, false)
  for (const key of ['spec', 'peaks', 'wave', 'waveL', 'waveR', 'notes', 'chroma']) assert.deepEqual(Array.from(got[key]), Array.from(frame[key]), key)
  for (const key of ['bass', 'mid', 'treble', 'energy', 'beat']) assert.equal(got[key], Math.fround(frame[key]), key)
  // Anything else is turned away.
  there.feed(new Float32Array(3))
  assert.equal(there.frame.spec[0], got.spec[0])
})

// ---- the main process ----

test('the widgets are measured as their pages lay themselves out', () => {
  const { playerMetrics, playlistMetrics, displayName } = require('./desktop/widgets')
  const small = playerMetrics(0, 1), big = playerMetrics(1, 1)
  assert.ok(big.width > small.width && big.height > small.height)
  assert.equal(playerMetrics(0.45, 1).width, Math.round(900 * (0.8 + 0.45 * 0.45)))
  const list = playlistMetrics({ size: 0.4, rows: 8 }, 1)
  const s = 0.8 + 0.5 * 0.4
  assert.equal(list.height, Math.ceil(66 * s + 8 * s + 8 * 50 * s + 48))
  assert.equal(displayName({ label: '', id: 7 }), 'Display 7')
  assert.equal(displayName({ label: 'DELL U2720Q', id: 7 }), 'DELL U2720Q')
})

test('the widgets in the WRLD tab are measured as the desktop\'s windows are', () => {
  const desktop = require('./desktop/widgets')
  const tab = loadTs(path.join(RENDERER, 'desktop/metrics.ts'))
  for (const size of [0, 0.45, 1]) for (const fit of [0.55, 0.8, 1]) {
    assert.deepEqual(tab.playerMetrics(size, fit), desktop.playerMetrics(size, fit))
    assert.deepEqual(tab.playlistMetrics({ size, rows: 8 }, fit), desktop.playlistMetrics({ size, rows: 8 }, fit))
  }
  assert.equal(tab.fitOf(1440, 900), 1)
  assert.equal(tab.fitOf(400, 300), 0.55)
  assert.equal(tab.fitOf(1080, 900), 0.75)
})

test('another app in front ends the clear desk; the desktop, the taskbar and our own windows don\'t', () => {
  const { ScreenWatch, SCRIPT } = require('./desktop/screenwatch')
  assert.equal(ScreenWatch.isOtherApp({ pid: 4242, className: 'Chrome_WidgetWin_1' }), true)
  assert.equal(ScreenWatch.isOtherApp({ pid: 4242, className: 'Progman' }), false)
  assert.equal(ScreenWatch.isOtherApp({ pid: 4242, className: 'Shell_TrayWnd' }), false)
  assert.equal(ScreenWatch.isOtherApp({ pid: process.pid, className: 'Chrome_WidgetWin_1' }), false)
  const watch = new ScreenWatch()
  assert.equal(watch.desktopInFront(), true)
  watch.front = { pid: 4242, className: 'Notepad' }
  assert.equal(watch.desktopInFront(), false)
  // PowerShell's here-string opens at a line's end and closes at the start of one.
  const lines = SCRIPT.split('\r\n')
  assert.ok(lines.some((l) => l.endsWith('@"')) && lines.includes('"@'))
  assert.ok(lines.includes('$parent = __PARENT__'))
})
