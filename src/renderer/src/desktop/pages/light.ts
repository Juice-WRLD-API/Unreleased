// One display's light: a transparent full-screen canvas round its edges, drawn with WebGL, moving with what the app
// plays. It fades in while a song plays and out once it stops, or while another app is in front when it shows only
// on the desktop; a lost graphics device (a driver update, sleep) starts it again from scratch.
import './base.css'
import { EdgeLight } from '../light/renderer'
import { DEFAULT_LIGHT, type LightStyle } from '../light/engine'
import { clockTime } from '../lyrics/scene'
import { Live } from './page'

const live = new Live()
const canvas = document.createElement('canvas')
canvas.className = 'full'
document.body.appendChild(canvas)

const style = (): LightStyle => ({ ...DEFAULT_LIGHT, ...(live.settings?.light ?? {}) })

/** The Lyrics Ticker's line: the one being sung now, else the song's name and artist. */
function ticker(): string {
  const track = live.state.track
  const name = track ? `${track.title}${track.artist ? ` — ${track.artist}` : ''}` : 'Unreleased'
  const lines = live.state.lyrics?.lines
  const clock = live.state.clock
  if (!lines?.length || !clock || live.state.lyrics?.id !== track?.id) return name
  const now = clockTime(clock)
  let sung = ''
  for (const line of lines) { if (line.time <= now) sung = line.text; else break }
  return sung.trim() || name
}

let light: EdgeLight
try {
  light = new EdgeLight(canvas, {
    style,
    meter: () => live.meter,
    playing: () => Boolean(live.state.playing),
    ticker,
    fit: () => live.fit,
  })
} catch (e) {
  console.error('[light] unavailable', e)
  throw e
}
canvas.addEventListener('webglcontextlost', () => setTimeout(() => location.reload(), 1000))

/** Shown while a song plays (a few seconds after it stops, the window itself going later) and not hidden. */
let pausedAt = 0
let fadeTimer = 0
function follow(): void {
  window.clearTimeout(fadeTimer)
  const playing = Boolean(live.state.playing)
  if (playing) pausedAt = 0
  else if (!pausedAt) pausedAt = Date.now()
  const resting = !playing && Date.now() - pausedAt > 3000
  light.fadeTo(live.settings?.light?.isOn && !live.hidden && !resting ? 1 : 0)
  if (!playing && !resting) fadeTimer = window.setTimeout(follow, 3000 - (Date.now() - pausedAt) + 30)
  light.wake()
}

let lastColors: string | null = null
live.on((what, patch) => {
  if (what === 'state' && patch && 'colors' in patch) {
    const key = JSON.stringify(live.state.colors ?? null)
    if (key !== lastColors) { lastColors = key; light.engine.setAlbum(live.state.colors ?? null) }
  }
  follow()
})
// Music sync: every meter reading may move it.
let lastMeter = 0
window.setInterval(() => {
  if (style().motion === 'music' && live.meter.decibels !== lastMeter) { lastMeter = live.meter.decibels; light.wake() }
  // The ticker's words move on with the song even while nothing else does.
  if (style().look === 'ticker') light.wake()
}, 33)
window.addEventListener('resize', () => light.wake())
void live.start().then(follow)
