// Told the wallpaper and to close or open: closing, the curtain comes in; opening, it goes - and says so, for its
// window to go too. With a visualizer to draw (desktop/deskViz.ts), it's WRLD's backdrop instead of the wallpaper:
// the cover blurred, and the visualizer over it, moving to the frames the main window sends.
import './base.css'
import './curtain.css'
import { page } from './page'
import { Visualizer } from '../../lib/viz'
import type { DeskVizLook } from '../deskViz'

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
stage.append(backdrop, wash, host)
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

/** Draws what `look` says - the visualizer, or the wallpaper under it again - fading over while the curtain's in. */
async function applyViz(look: DeskVizLook | null, fade: boolean): Promise<void> {
  const mine = ++vizTurn
  if (look?.mode) {
    const v = visualizer()
    if (look.mode !== mode) { v.setMode(look.mode); mode = look.mode }
    v.setQuality(look.quality)
    v.setUsePalette(look.usePalette)
    v.syncAccent(look.accent)
    v.setArtworkPalette(look.palette)
    v.setPlaying(look.playing)
    v.start()
    await showBackdrop(look.cover)
    if (mine !== vizTurn) return
  }
  const on = Boolean(look?.mode)
  stage.classList.toggle('instant', !fade)
  curtain.classList.toggle('viz', on)
  if (!fade) { void stage.offsetWidth; stage.classList.remove('instant') }
  if (!on && viz) {
    // Off once it has faded.
    if (fade) await wait(700)
    if (mine !== vizTurn) return
    viz.stop()
    mode = null
  }
}

page.on('desktop:curtain-frame', (frame) => { viz?.feedAudio(frame) })
page.on('desktop:curtain-viz', (look) => { void applyViz(look, curtain.classList.contains('shown')) })

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
