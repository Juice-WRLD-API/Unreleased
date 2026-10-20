// The see-through playlist on the desktop: a header with the list's covers and name, then its songs, the whole of it
// turned away in 3D. It shows the queue - the song playing first, then what follows - or the user's Liked Songs or
// one of their playlists, picked from a shelf under its name. The song playing stands out of the list as a lens of
// glass; a row clicked plays, the queue kept, or the list from that song.
import './base.css'
import '../cards/cards.css'
import './playlist.css'
import { PlayingGlass } from '../cards/glass'
import { hsbToRgb } from '../light/engine'
import { Live, page, dragToMove, justDragged, escapeText, type DesktopTrack } from './page'
import { icons } from './icons'

const live = new Live()

document.body.innerHTML = `<div id="stage"><div id="catcher"></div>
  <div id="header"><div class="mosaic"></div><div class="names"><button class="title"><span></span>${icons.forward}</button><div class="subtitle"></div></div>
    <button id="play-list" class="gone" aria-label="Play the list">${icons.playSmall}</button></div>
  <div id="list"></div><div id="quiet" class="hidden"></div>
  <div id="shelf" class="gone"></div></div>`

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector(selector) as T

interface ShelfItem { id: string; name: string; count: number; covers: string[] }
interface ListAnswer { id: string; name: string; rows: DesktopTrack[] }

let list: ListAnswer | null = null
let shelf: ShelfItem[] = []
let shelfOpen = false
let asking = 0
let askedFor = ''

const source = (): string => live.settings?.playlist.source ?? 'queue'

function applyMetrics(): void {
  const style = live.settings?.playlist
  const s = (0.8 + 0.5 * (style?.size ?? 0.4)) * live.fit
  const width = 300 * s, headerHeight = 66 * s, gap = 8 * s, rowHeight = 50 * s
  const rows = style?.rows ?? 8
  const root = document.documentElement.style
  const px = (v: number): string => `${v}px`
  root.setProperty('--s', String(s))
  root.setProperty('--width', px(width))
  root.setProperty('--header-height', px(headerHeight))
  root.setProperty('--gap', px(gap))
  root.setProperty('--row-height', px(rowHeight))
  root.setProperty('--list-height', px(rows * rowHeight))
  root.setProperty('--stage-height', px(headerHeight + gap + rows * rowHeight))
  // Turned away from 10 to 45 degrees, on the covers' edge: the side nearest the middle of the screen.
  const angle = 10 + 35 * (style?.tilt ?? 1)
  const right = style?.side === 'right'
  root.setProperty('--angle', `${right ? -angle : angle}deg`)
  root.setProperty('--hinge', right ? '100%' : '0%')
  root.setProperty('--depth', px(width * 3))
}

function cover(url: string | null | undefined, className = ''): HTMLElement {
  if (!url) return Object.assign(document.createElement('span'), { className })
  const img = document.createElement('img')
  img.src = url
  img.className = className
  img.draggable = false
  img.decoding = 'async'
  img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className }))
  return img
}

function mosaic(el: HTMLElement, covers: string[]): void {
  const key = covers.slice(0, 4).join('|')
  if (el.dataset.covers === key) return
  el.dataset.covers = key
  el.classList.toggle('one', covers.length < 4)
  el.replaceChildren(...(covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1)).map((c) => cover(c)))
}

/** The rows shown: the queue from what plays now, or the list asked for. */
function rows(): { rows: DesktopTrack[]; playingIndex: number; queueFrom: number } {
  if (source() === 'queue') {
    const cards = live.state.cards
    if (!cards || cards.current < 0) return { rows: [], playingIndex: -1, queueFrom: 0 }
    const start = cards.current - cards.from
    return { rows: cards.items.slice(start), playingIndex: 0, queueFrom: cards.current }
  }
  const items = list?.id === source() ? list.rows : []
  const playing = live.state.track?.id
  return { rows: items, playingIndex: items.findIndex((r) => r.id === playing), queueFrom: 0 }
}

async function fetchList(): Promise<void> {
  const id = source()
  const key = `${id}|${live.state.listsVersion ?? 0}`
  if (id === 'queue' || key === askedFor) return
  askedFor = key
  const turn = ++asking
  const answer = await page.request<ListAnswer>('list', id)
  if (turn !== asking) return
  list = answer
  draw()
}

async function fetchShelf(): Promise<void> {
  shelf = (await page.request<ShelfItem[]>('lists')) ?? []
  drawShelf()
}

function drawShelf(): void {
  const el = $('#shelf')
  el.classList.toggle('gone', !shelfOpen)
  $('.names .title').classList.toggle('open', shelfOpen)
  el.replaceChildren(...shelf.map((item) => {
    const row = document.createElement('button')
    row.className = `shelf-row${item.id === source() ? ' chosen' : ''}`
    row.dataset.list = item.id
    row.innerHTML = `<div class="mosaic"></div><div class="texts"><div class="t">${escapeText(item.name)}</div><div class="a">${item.count} ${item.count === 1 ? 'song' : 'songs'}</div></div>`
    mosaic($('.mosaic', row), item.covers)
    return row
  }))
}

// ---- the list ----

const listEl = $('#list')
let glass: PlayingGlass | null = null
let shownKeys = ''

function draw(): void {
  const { rows: items, playingIndex } = rows()
  const id = source()
  const name = id === 'queue' ? 'Queue' : list?.id === id ? list.name : shelf.find((s) => s.id === id)?.name ?? 'Playlist'
  $('.names .title span').textContent = name
  $('.names .subtitle').textContent = id === 'queue'
    ? (items.length > 1 ? `${items.length - 1} up next` : 'Nothing up next')
    : `${items.length} ${items.length === 1 ? 'song' : 'songs'}`
  mosaic($('#header > .mosaic'), items.map((r) => r.cover).filter((c): c is string => !!c))
  $('#play-list').classList.toggle('gone', id === 'queue' || !items.length)
  const quiet = $('#quiet')
  quiet.classList.toggle('hidden', items.length > 0)
  quiet.textContent = id === 'queue' ? 'Play something, and what follows shows up here' : list?.id === id ? 'No songs here yet' : 'Loading…'

  // The rows made again only when they changed; the glass follows the playing row.
  const keys = items.map((r) => r.key).join('\n')
  if (keys !== shownKeys) {
    shownKeys = keys
    glass?.destroy()
    glass = null
    listEl.replaceChildren(...items.map((r, index) => {
      const row = document.createElement('div')
      row.className = 'row'
      row.dataset.index = String(index)
      row.innerHTML = `<div class="face"><div class="cover-slot"></div><div class="texts"><div class="t">${escapeText(r.title)}</div><div class="a">${escapeText(r.artist || r.album)}</div></div></div>`
      $('.cover-slot', row).replaceWith(cover(r.cover, 'cover'))
      return row
    }))
    if (id === 'queue') listEl.scrollTop = 0
  }
  const playingRow = playingIndex >= 0 ? listEl.children[playingIndex] as HTMLElement | undefined : undefined
  if (glass && glass.row !== playingRow) { glass.destroy(); glass = null }
  if (playingRow) {
    glass ??= new PlayingGlass(playingRow)
    const song = items[playingIndex]
    const colors = live.state.colors
    glass.update({
      playing: true,
      running: !!live.state.playing,
      face: { title: song.title, line: song.artist || song.album, cover: song.cover },
      colors: colors ? [colors.primary, colors.secondary].map((c) => hsbToRgb(c).map((v) => v * 255) as [number, number, number]) : null,
      s: Number(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1,
    })
  }
}

listEl.addEventListener('click', (event) => {
  if (justDragged()) return
  const row = (event.target as Element).closest<HTMLElement>('.row')
  if (!row) return
  const index = Number(row.dataset.index)
  const { queueFrom } = rows()
  if (source() === 'queue') page.command('jump', queueFrom + index)
  else page.command('play-list', { id: source(), index })
})
$('#play-list').addEventListener('click', () => { if (!justDragged()) page.command('play-list', { id: source(), index: 0 }) })
$('.names .title').addEventListener('click', () => {
  if (justDragged()) return
  shelfOpen = !shelfOpen
  drawShelf()
  if (shelfOpen) void fetchShelf()
})
$('#shelf').addEventListener('click', (event) => {
  const id = (event.target as Element).closest<HTMLElement>('[data-list]')?.dataset.list
  if (!id) return
  shelfOpen = false
  drawShelf()
  if (id !== source()) {
    list = null
    shownKeys = ''
    page.command('set', { playlist: { source: id } })
  }
})
window.addEventListener('pointerdown', (event) => {
  if (shelfOpen && !(event.target as Element).closest('#shelf, .names .title')) { shelfOpen = false; drawShelf() }
}, true)

// The header's and the list's empty glass move it.
dragToMove((target) => !target.closest('button, .row, #shelf'))

live.on((what, patch) => {
  if (what === 'settings') { applyMetrics(); void fetchList() }
  if (what === 'state' && patch && 'listsVersion' in patch) void fetchList()
  if (what === 'state' && patch && !('cards' in patch) && !('track' in patch) && !('colors' in patch) && !('playing' in patch) && !('listsVersion' in patch)) return
  draw()
})
void live.start().then(() => { applyMetrics(); void fetchList(); void fetchShelf(); draw() })
