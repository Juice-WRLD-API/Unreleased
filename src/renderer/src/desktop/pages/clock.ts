// The clock on the desktop: it changes once a minute and costs nothing in between. It measures itself and tells the
// window its size; anywhere on it drags it.
import './base.css'
import './clock.css'
import { hsbToRgb, type RGB } from '../light/engine'
import { Live, dragToMove, page } from './page'

const live = new Live()
const SVG = 'http://www.w3.org/2000/svg'

document.body.innerHTML = `<div id="clock"><div id="date"></div>
  <svg id="digits" xmlns="${SVG}">
    <defs>
      <linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop id="b0" offset="0"/><stop id="b1" offset="1"/></linearGradient>
      <linearGradient id="light" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.22" stop-color="#fff" stop-opacity="0.05"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.8"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#fff" stop-opacity="0.45"/>
      </linearGradient>
    </defs>
    <text id="time" x="0" y="0" fill="url(#body)" stroke="url(#rim)" stroke-width="1.2" vector-effect="non-scaling-stroke"></text>
    <text id="sheen" x="0" y="0" fill="url(#light)" stroke="none"></text>
  </svg></div>`

const $ = <T extends Element>(s: string): T => document.querySelector(s) as T

/** "Thu Oct 8". */
const day = (date: Date): string => date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
/** "10:19": no seconds, and in 12-hour regions no AM or PM. */
function time(date: Date): string {
  const twelve = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12
  const h = date.getHours(), m = String(date.getMinutes()).padStart(2, '0')
  return twelve ? `${h % 12 || 12}:${m}` : `${String(h).padStart(2, '0')}:${m}`
}

/** The cover's two colors while a song plays and the user wants them; milky white glass otherwise. */
function tones(): [RGB, RGB] {
  const style = live.settings?.clock
  const colors = live.state.colors
  if (!style?.useArtworkColor || !live.state.playing || !colors) return [[1, 1, 1], [1, 1, 1]]
  return [hsbToRgb(colors.primary), hsbToRgb(colors.secondary)]
}

let pen: CanvasRenderingContext2D | null = null
function draw(): void {
  const style = live.settings?.clock
  if (!style) return
  const fontSize = (60 + 150 * style.size) * live.fit
  const stretch = (100 + 400 * style.stretch) / 100 / 1.45
  const weight = Math.round(250 + 600 * style.weight)
  const date = new Date()
  const text = $<SVGTextElement>('#time')
  const sheen = $<SVGTextElement>('#sheen')
  // The sheen is a second text, not a <use>: a clone lays its glyphs out on its own and drifts off the first.
  for (const t of [text, sheen]) {
    t.textContent = time(date)
    Object.assign(t.style, { fontSize: `${fontSize}px`, fontWeight: String(weight), fontStretch: 'condensed', fontVariationSettings: `'wght' ${weight}, 'wdth' 75` })
  }
  // Every digit stands as tall as the figures: their ink, measured once per look, keeps the clock the same size
  // whatever the time ("00:00" for the width).
  const family = getComputedStyle(text).fontFamily
  pen ??= document.createElement('canvas').getContext('2d')
  if (!pen) return
  pen.font = `${weight} condensed ${fontSize}px ${family}`
  const ascent = pen.measureText('0123456789').actualBoundingBoxAscent
  const wide = pen.measureText('00:00').width
  const width = pen.measureText(text.textContent).width
  const place = `scale(1, ${stretch}) translate(${(wide - width) / 2}, ${ascent})`
  text.setAttribute('transform', place)
  sheen.setAttribute('transform', place)
  const svg = $<SVGSVGElement>('#digits')
  svg.setAttribute('width', String(Math.ceil(wide)))
  svg.setAttribute('height', String(Math.ceil(ascent * stretch)))
  const dateSize = Math.max(fontSize * 0.13, 11)
  const label = $<HTMLDivElement>('#date')
  label.style.display = style.showDate ? '' : 'none'
  label.style.fontSize = `${dateSize}px`
  label.style.marginBottom = `${fontSize * 0.08}px`
  label.textContent = day(date)
  const [first, second] = tones()
  const css = (rgb: RGB, a: number): string => `rgba(${rgb.map((v) => Math.round(v * 255)).join(', ')}, ${a})`
  const white = first.every((v) => v === 1) && second.every((v) => v === 1)
  label.style.backgroundImage = white ? 'linear-gradient(rgba(255,255,255,0.8), rgba(255,255,255,0.8))' : `linear-gradient(90deg, ${css(first, 1)}, ${css(second, 1)})`
  // Glass: the color fuller at the top-left, fading toward the bottom-right, where the glass is nearly clear.
  $('#b0').setAttribute('stop-color', css(first, 1))
  $('#b0').setAttribute('stop-opacity', String(0.2 + 0.34 * style.tint))
  $('#b1').setAttribute('stop-color', css(second, 1))
  $('#b1').setAttribute('stop-opacity', String(0.03 + 0.18 * style.tint))
  const clock = $<HTMLDivElement>('#clock').getBoundingClientRect()
  page.size(Math.ceil(Math.max(wide, dateSize * 6) + 48), Math.ceil(clock.height + 48))
}

function everyMinute(): void {
  draw()
  window.setTimeout(everyMinute, 60000 - (Date.now() % 60000) + 50)
}

dragToMove(() => true)
live.on((what, patch) => {
  if (what === 'state' && patch && !('playing' in patch) && !('colors' in patch)) return
  draw()
})
void live.start().then(() => document.fonts.ready.then(everyMinute))
