// Told the wallpaper and to close or open: closing, the curtain comes in; opening, it goes - and says so, for its
// window to go too. With a visualizer to draw (desktop/deskViz.ts), it's WRLD's backdrop instead of the wallpaper:
// the cover blurred, and the visualizer over it, moving to the frames the main window sends - and the song's video
// over that, as in WRLD, following the song's clock the main window sends with the look.
import './base.css'
import './curtain.css'
import { page } from './page'
import { Visualizer } from '../../lib/viz'
import type { DeskVizLook } from '../deskViz'
import { followVideo, type SongClock } from '../../lib/videoFollow'

const curtain = document.createElement('div')
curtain.id = 'curtain'
const picture = document.createElement('img')
picture.alt = ''
curtain.appendChild(picture)
const stage = document.createElement('div')
stage.className = 'stage'
const backdrop = document.createElement('img')
backdrop.className = 'backdrop hidden'
backdrop.alt = ''
const wash = document.createElement('div')
wash.className = 'wash'
const host = document.createElement('div')
host.className = 'full'
const film = document.createElement('div')
film.className = 'film'
stage.append(backdrop, wash, host, film)
curtain.appendChild(stage)
document.body.appendChild(curtain)

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
let turn = 0

// ---- the visualizer ----

let viz: Visualizer | null = null
let mode: string | null = null
let vizTurn = 0

function visualizer(): Visualizer {
  if (viz) return viz
  const canvas = (): HTMLCanvasElement => {
    const c = document.createElement('canvas')
    c.className = 'full'
    host.appendChild(c)
    return c
  }
  viz = new Visualizer(canvas(), canvas())
  return viz
}

/** The cover behind the visualizer; ready (or given up on) when this resolves. */
async function showBackdrop(url: string | null): Promise<void> {
  if (!url) { backdrop.classList.add('hidden'); backdrop.removeAttribute('src'); return }
  if (backdrop.getAttribute('src') === url) return
  backdrop.onerror = () => backdrop.classList.add('hidden')
  backdrop.src = url
  backdrop.classList.remove('hidden')
  // A moment's wait at most: the curtain doesn't hold back for a slow cover.
  await Promise.race([backdrop.decode().catch(() => {}), wait(500)])
}

/** Draws what `look` says - the visualizer and the song's video, or the wallpaper under them again - fading over while
 *  the curtain's in. */
async function applyViz(look: DeskVizLook | null, fade: boolean): Promise<void> {
  const mine = ++vizTurn
  clock = look?.clock ?? null
  showFilm(look?.video ?? null)
  if (look?.mode) {
    const v = visualizer()
    if (look.mode !== mode) { v.setMode(look.mode); mode = look.mode }
    v.setQuality(look.quality)
    v.setUsePalette(look.usePalette)
    v.syncAccent(look.accent)
    v.setArtworkPalette(look.palette)
    v.setPlaying(look.playing)
    if (!filmShown) v.start()
  }
  host.classList.toggle('hidden', !look?.mode)
  const on = Boolean(look?.mode || look?.video)
  if (on) {
    await showBackdrop(look?.cover ?? null)
    if (mine !== vizTurn) return
  }
  stage.classList.toggle('instant', !fade)
  curtain.classList.toggle('viz', on)
  if (!fade) { void stage.offsetWidth; stage.classList.remove('instant') }
  if (!look?.mode && viz && mode) {
    // Off once it has faded (at once when the video stays up over the cover).
    if (fade && !on) await wait(700)
    if (mine !== vizTurn) return
    viz.stop()
    mode = null
  }
}

page.on('desktop:curtain-frame', (frame) => { viz?.feedAudio(frame) })
page.on('desktop:curtain-viz', (look) => { void applyViz(look, curtain.classList.contains('shown')) })

// ---- the song's video ----

/** The visualizer stops once the video has faded in over it (as long as the fade in curtain.css), and starts again as
 *  it begins to fade out. */
const FILM_FADE_MS = 600
let clock: DeskVizLook['clock'] = null
let filmUrl: string | null = null
let stopFilm: (() => void) | null = null
let filmShown = false
let filmTimer = 0

const epochNow = (): number => performance.timeOrigin / 1000 + performance.now() / 1000
const songClock = (): SongClock => {
  const c = clock
  if (!c) return { song: 0, playing: false, rate: 1 }
  const rate = c.rate ?? 1
  return { song: c.running ? c.seconds + (epochNow() - c.at) * rate : c.seconds, playing: c.running, rate }
}

/** Whether the visualizer should be drawing: there's one, and no video covers it. */
function vizRuns(): void {
  if (!viz || !mode) return
  if (filmShown) viz.stop()
  else viz.start()
}

function showFilm(video: DeskVizLook['video']): void {
  const url = video?.url ?? null
  if (url === filmUrl) return
  filmUrl = url
  stopFilm?.()
  stopFilm = null
  window.clearTimeout(filmTimer)
  filmShown = false
  vizRuns()
  // A new element per video: reusing one shows the last song's frame while the next one loads.
  const old = film.querySelector('video')
  if (old) { film.classList.remove('shown'); old.removeAttribute('src'); old.load(); old.remove() }
  if (!video) return
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.disablePictureInPicture = true
  v.src = video.url
  film.prepend(v)
  stopFilm = followVideo(v, video.sync, songClock, (next) => {
    film.classList.toggle('shown', next)
    window.clearTimeout(filmTimer)
    if (next) filmTimer = window.setTimeout(() => { filmShown = true; vizRuns() }, FILM_FADE_MS)
    else { filmShown = false; vizRuns() }
  })
}

// ---- in and out ----

page.on('desktop:curtain-close', async ({ picture: url, viz: look }) => {
  const mine = ++turn
  if (url) { picture.src = url; await picture.decode().catch(() => {}) }
  await applyViz(look ?? null, false)
  if (mine !== turn) return
  curtain.classList.add('shown')
})

page.on('desktop:curtain-open', async () => {
  const mine = ++turn
  curtain.classList.remove('shown')
  await wait(700)
  if (mine !== turn) return
  page.curtainOpened()
})
