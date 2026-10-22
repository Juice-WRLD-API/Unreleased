// The desktop player: the queue as a row of glass cards curving away to both sides of the song playing - played
// songs to the left, what's next to the right - with a glass control bar beneath. Clicking a card plays it, the queue
// kept; scrolling turns the cards and, after a quiet moment, they turn back to the song playing; hovering lifts a card.
// The lyrics open beside the playing card, in the iJWA style picked; search lays the catalog's songs and eras over the
// cards, an era opening into its own page. Every press goes to the app, which does it as its own buttons do.
import './base.css'
import '../cards/cards.css'
import './player.css'
import { CardStack, cardMetrics, lyricsLayout, metricsStyle, placements, type Card, type CardMetrics } from '../cards/ring'
import { Aura } from '../cards/aura'
import { LyricStage, type StageSong } from '../lyrics/stage'
import { lyricFontFor } from '../lyrics/looks'
import { clockTime } from '../lyrics/scene'
import { DEFAULT_LIGHT, hsbToRgb, type HSB } from '../light/engine'
import { Live, page, seeThrough, dragToMove, menuOnRightClick, frosted, justDragged, escapeText, clockText, type DesktopTrack } from './page'
import { icons } from './icons'

const live = new Live()

document.body.innerHTML = `<div id="player" data-clear>
  <div id="carousel" data-clear><div id="aura" class="dk-aura"></div><div id="stage" class="dk-stage" data-clear></div>
    <div id="empty" class="gone">Play a song, and your queue shows up here</div></div>
  <div id="lyrics" class="gone" data-clear><div class="lyric-host"></div><div class="quiet gone"><div class="quiet-icon"></div><div class="quiet-text"></div></div></div>
  <div id="search-grid" class="gone"><div class="glass"></div><div class="scroll"><div class="content"></div></div><div class="note"></div></div>
  <div id="tools" data-clear>
    <button class="circle quiet gone" data-tool="lyricsCard" aria-label="Hide the card"></button>
    <div id="notice-slot" data-clear></div>
    <button class="circle" data-tool="fm" aria-label="999 FM"></button>
    <button class="circle away" data-tool="versions" data-menu-button aria-label="Other versions" title="Other versions"></button>
    <button class="circle" data-tool="more" data-menu-button aria-label="More options" title="More options"></button>
    <div id="searchbar" class="circle"><span class="mag"></span><input type="text" placeholder="Search songs and eras" spellcheck="false" aria-label="Search"><span class="spin"></span><button class="clear" aria-label="Clear"></button></div>
    <button class="circle" data-tool="mini" aria-label="Make the player small" title="Make the player small"></button>
  </div>
  <div id="bar"></div>
  <div id="mini" class="gone"></div>
  <div id="menu" class="hidden"></div>
</div>`

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector(selector) as T

// ---- measurements ----

interface PlayerMetrics extends CardMetrics { barWidth: number; toolsTop: number; barTop: number; edge: number }

function metricsNow(): PlayerMetrics {
  const p = live.settings?.player
  const s = (0.8 + 0.45 * (p?.size ?? 0.45)) * live.fit
  const m = cardMetrics(s, p?.glassBrightness ?? 0.6) as PlayerMetrics
  m.barWidth = 690 * s
  m.edge = 40 * s
  m.toolsTop = m.edge + m.carouselHeight + 10 * s
  m.barTop = m.toolsTop + 42 * s + 8 * s
  return m
}

let m = metricsNow()
function applyMetrics(): void {
  m = metricsNow()
  const root = document.documentElement.style
  for (const [name, value] of Object.entries(metricsStyle(m))) root.setProperty(name, value)
  const px = (v: number): string => `${v}px`
  root.setProperty('--carousel-height', px(m.carouselHeight))
  root.setProperty('--bar-width', px(m.barWidth))
  root.setProperty('--tools-top', px(m.toolsTop))
  root.setProperty('--bar-top', px(m.barTop))
  const lyricsPlace = lyricsLayout(m)
  root.setProperty('--lyrics-x', px(lyricsPlace.wordsX))
  root.setProperty('--lyrics-width', px(lyricsPlace.width))
  root.setProperty('--card-x', px(lyricsPlace.cardX))
}

// ---- small helpers ----

const button = (name: string, size: number, { quiet = false, label = '' } = {}): string =>
  `<button class="bar-button${quiet ? ' quiet' : ''}" data-action="${name}" data-size="${size}" aria-label="${escapeText(label || name)}"><span class="disc"></span><span class="glyph"></span></button>`
/** Sizes as data, then set through the page's own styles: the CSP lets no style attribute through. */
function sizeButtons(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-size]')) el.style.setProperty('--size', el.dataset.size ?? '16')
}

/** A title too long to fit runs along on its own, twice over with a gap, while the song plays. */
function marquee(box: HTMLElement): void {
  const span = box.firstElementChild as HTMLElement | null
  if (!span) return
  box.querySelectorAll('.copy').forEach((c) => c.remove())
  box.classList.remove('overflowing')
  if (span.scrollWidth - box.clientWidth <= 1) return
  const copy = span.cloneNode(true) as HTMLElement
  copy.classList.add('copy')
  box.appendChild(copy)
  box.classList.add('overflowing')
  box.style.setProperty('--travel', `${span.scrollWidth + 40}px`)
  box.style.setProperty('--duration', `${(span.scrollWidth + 40) / 30}s`)
}

function coverImage(url: string | null | undefined, empty = icons.note): HTMLElement {
  if (!url) return Object.assign(document.createElement('span'), { className: 'no-art', innerHTML: empty })
  const img = document.createElement('img')
  img.src = url
  img.draggable = false
  img.decoding = 'async'
  img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'no-art', innerHTML: empty })) }
  return img
}

/** The light's two colors: the cover's, or the user's own. */
function lightColors(): [HSB, HSB] {
  const light = { ...DEFAULT_LIGHT, ...(live.settings?.light ?? {}) }
  const album = light.useArtworkColors ? live.state.colors : null
  const first = album?.primary ?? light.primary
  const second = light.twoColors ? (album?.secondary ?? light.secondary) : first
  return [first, second]
}

/** The heart's color: the song's own, bright enough to read on the glass; white while it isn't known. */
function likeTint(): string {
  const c = live.state.colors?.primary
  if (!c) return '#fff'
  const rgb = hsbToRgb({ hue: c.hue, saturation: Math.min(c.saturation, 0.85), brightness: Math.max(c.brightness, 0.92) })
  return `rgb(${rgb.map((v) => Math.round(v * 255)).join(', ')})`
}

let noticeTimer = 0
/** A word over the bar for a while. */
function notice(title: string, detail: string): void {
  const slot = $('#notice-slot')
  slot.innerHTML = `<div class="notice"><div class="note">${icons.list}</div><div class="text"><b>${escapeText(title)}</b><span>${escapeText(detail)}</span></div></div>`
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    slot.firstElementChild?.classList.add('leaving')
    window.setTimeout(() => { if (slot.querySelector('.leaving')) slot.innerHTML = '' }, 350)
  }, 3400)
}

// ---- the bar ----

class Bar {
  host: HTMLElement
  title: HTMLElement
  subtitle: HTMLElement
  cover: HTMLElement
  timeLeft: HTMLElement
  progress: HTMLElement
  fill: HTMLElement
  slider: HTMLInputElement
  heart: HTMLElement
  hovered = false
  scrub: number | null = null
  volumeOpen = false
  volumeTouched = false
  pendingVolume = 0
  ticker = 0
  shownTitle = ''
  shownCover: string | null | undefined = undefined
  wasLiked = false

  constructor(host: HTMLElement) {
    this.host = host
    host.innerHTML = `
      <div class="bar-glass"></div>
      <div class="bar-left">${button('shuffle', 13, { quiet: true, label: 'Shuffle' })}${button('previous', 16)}${button('toggle', 22)}${button('next', 16)}${button('repeat', 13, { quiet: true })}</div>
      <div class="strip">
        <div class="strip-row">
          <button class="cover-button" data-action="open" aria-label="Open Unreleased"><span class="cover-art"></span><span class="cover-arrow">${icons.arrowOut}</span></button>
          <div class="strip-texts"><div class="marquee title"><span></span></div><div class="marquee subtitle"><span></span></div></div>
          <div class="time-left"></div>
          <button class="heart" data-action="like" aria-label="Like">${icons.heart}${icons.heartFill}</button>
          <button class="more" data-action="more" data-menu-button aria-label="More options" title="More options">${icons.ellipsis}</button>
        </div>
        <div class="progress"><div class="rail"></div><div class="fill"></div></div>
      </div>
      <div class="bar-right">${button('equalizer', 15, { label: 'Equalizer' })}${button('lyrics', 15, { label: 'Lyrics' })}${button('clear', 14, { label: 'Clear the desk' })}<div class="volume"><input type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Volume">${button('volume', 15, { label: 'Volume' })}</div></div>`
    sizeButtons(host)
    const glyph = (action: string): HTMLElement => $(`[data-action="${action}"] .glyph`, host)
    glyph('shuffle').innerHTML = icons.shuffle
    glyph('previous').innerHTML = icons.backward
    glyph('next').innerHTML = icons.forward
    glyph('equalizer').innerHTML = icons.equalizer
    glyph('lyrics').innerHTML = icons.lyrics
    glyph('clear').innerHTML = icons.moon
    glyph('volume').innerHTML = icons.speaker2
    this.title = $('.marquee.title', host)
    this.subtitle = $('.marquee.subtitle', host)
    this.cover = $('.cover-art', host)
    this.timeLeft = $('.time-left', host)
    this.progress = $('.progress', host)
    this.fill = $('.fill', host)
    this.slider = $('.volume input', host)
    this.heart = $('.heart', host)
    frosted($('.bar-glass', host), live, () => live.settings?.player.frost ?? 0.35)

    host.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-action]')
      if (!target || justDragged()) return
      const action = target.dataset.action
      if (action === 'lyrics') { page.command('set', { player: { lyricsOpen: !live.settings?.player.lyricsOpen } }); return }
      if (action === 'volume') { this.toggleVolume(); return }
      if (action === 'clear') { page.command('clear'); return }
      if (action === 'open') { if (!live.inTab) page.command('open-app'); return }
      if (action === 'more') { if (songMenuOpen()) closeMenu(); else void openSongMenu(); return }
      // Where the button is, for the WRLD tab to open the equalizer beside it; on the desktop it gets its own window.
      if (action === 'equalizer') {
        const r = target.getBoundingClientRect()
        page.command('equalizer', { x: r.left, y: r.top, width: r.width, height: r.height })
        return
      }
      page.command(action ?? '')
    })
    this.slider.addEventListener('input', () => {
      this.volumeTouched = true
      this.paintVolume(Number(this.slider.value))
      window.clearTimeout(this.pendingVolume)
      this.pendingVolume = window.setTimeout(() => page.command('volume', Number(this.slider.value)), 80)
    })
    const strip = $('.strip', host)
    strip.addEventListener('pointerenter', () => { this.hovered = true; this.paintTime(); this.timeLeft.classList.add('shown'); this.progress.classList.add('thick') })
    strip.addEventListener('pointerleave', () => { this.hovered = false; if (this.scrub == null) { this.timeLeft.classList.remove('shown'); this.progress.classList.remove('thick') } })
    this.progress.addEventListener('pointerdown', (event) => {
      if (!((live.state.track?.duration ?? 0) > 0)) return
      event.stopPropagation()
      this.progress.setPointerCapture(event.pointerId)
      this.dragTo(event)
    })
    this.progress.addEventListener('pointermove', (event) => { if (this.scrub != null) this.dragTo(event) })
    this.progress.addEventListener('pointerup', () => {
      if (this.scrub == null) return
      const fraction = this.scrub
      this.scrub = null
      page.command('seek', fraction)
      if (!this.hovered) { this.timeLeft.classList.remove('shown'); this.progress.classList.remove('thick') }
      this.paintTime()
    })
    window.setInterval(() => { if (this.hovered || this.scrub != null) this.paintTime() }, 1000)
  }

  dragTo(event: PointerEvent): void {
    const r = this.progress.getBoundingClientRect()
    this.scrub = Math.min(Math.max((event.clientX - r.left) / Math.max(r.width, 1), 0), 1)
    this.placeLine()
    this.paintTime()
  }

  update(): void {
    const state = live.state
    const t = state.track
    $('[data-action="toggle"] .glyph', this.host).innerHTML = state.playing ? icons.pause : icons.play
    $('[data-action="repeat"] .glyph', this.host).innerHTML = state.repeat === 'one' ? icons.repeatOne : icons.repeat
    $('[data-action="repeat"]', this.host).classList.toggle('active', !!state.repeat && state.repeat !== 'none')
    const shuffle = $('[data-action="shuffle"]', this.host)
    shuffle.classList.toggle('active', !!state.shuffle)
    shuffle.title = state.shuffle ? 'Shuffle on' : 'Shuffle'
    $('[data-action="equalizer"]', this.host).classList.toggle('active', !!state.eq)
    const clear = $('[data-action="clear"]', this.host)
    clear.classList.toggle('active', live.isClear)
    clear.title = live.isClear ? 'Bring everything back' : 'Clear the desk'
    $('[data-action="lyrics"]', this.host).classList.toggle('active', !!live.settings?.player.lyricsOpen)
    const title = t?.title || 'Not Playing'
    const subtitle = !t ? 'Play something in Unreleased' : t.album && t.album !== t.artist ? `${t.artist} — ${t.album}` : t.artist
    if (`${title}\n${subtitle}` !== this.shownTitle) {
      this.shownTitle = `${title}\n${subtitle}`
      ;(this.title.firstElementChild as HTMLElement).textContent = title
      ;(this.subtitle.firstElementChild as HTMLElement).textContent = subtitle
      requestAnimationFrame(() => { marquee(this.title); marquee(this.subtitle) })
    }
    this.title.classList.toggle('running', !!state.playing)
    this.subtitle.classList.toggle('running', !!state.playing)
    if (t?.cover !== this.shownCover) {
      this.shownCover = t?.cover
      this.cover.replaceChildren(coverImage(t?.cover))
    }
    this.host.style.setProperty('--like', likeTint())
    // The heart: there where the song can be liked, beating once as it fills.
    this.heart.classList.toggle('shown', !!state.canLike)
    this.heart.classList.toggle('liked', !!state.liked)
    this.heart.title = state.liked ? 'Liked' : 'Like'
    if (state.liked && !this.wasLiked) { this.heart.classList.remove('beat'); void this.heart.offsetWidth; this.heart.classList.add('beat') }
    this.wasLiked = !!state.liked
    // The song's menu: there while something plays.
    $('[data-action="more"]', this.host).classList.toggle('gone', !t)
    if (this.volumeOpen && !this.volumeTouched && typeof state.volume === 'number') { this.slider.value = String(state.volume); this.paintVolume(state.volume) }
    this.restartLine()
  }

  toggleVolume(): void {
    this.volumeOpen = !this.volumeOpen
    $('.volume', this.host).classList.toggle('open', this.volumeOpen)
    $('[data-action="volume"]', this.host).classList.toggle('active', this.volumeOpen)
    if (this.volumeOpen) {
      this.volumeTouched = false
      const v = live.state.volume ?? 0.8
      this.slider.value = String(v)
      this.paintVolume(v)
    }
  }

  paintVolume(value: number): void {
    $('[data-action="volume"] .glyph', this.host).innerHTML = value < 0.01 ? icons.speaker0 : value < 0.5 ? icons.speaker1 : icons.speaker2
    this.slider.style.setProperty('--fill', `${value * 100}%`)
  }

  fraction(): number {
    const duration = live.state.track?.duration || 0
    if (this.scrub != null) return this.scrub
    const clock = live.state.clock
    return duration > 0 && clock ? Math.min(Math.max(clockTime(clock) / duration, 0), 1) : 0
  }

  placeLine(): number {
    const f = this.fraction()
    this.fill.style.transform = `scaleX(${Math.max(f, 0.0001)})`
    return f
  }

  /** The line only moves when it would move by a whole pixel (every 0.25 to 1 s), and stops while paused. */
  restartLine(): void {
    window.clearTimeout(this.ticker)
    if (this.scrub != null) return
    const fraction = this.placeLine()
    const duration = live.state.track?.duration || 0
    if (!live.state.clock?.running || !(duration > 0) || fraction >= 1 || live.unseen) return
    const pixels = Math.max(this.progress.clientWidth * devicePixelRatio, 1)
    const interval = Math.min(Math.max(duration / pixels, 0.25), 1) * 1000
    const tick = (): void => { if (this.placeLine() < 1) this.ticker = window.setTimeout(tick, interval) }
    this.ticker = window.setTimeout(tick, interval)
  }

  paintTime(): void {
    const duration = live.state.track?.duration || 0
    if (!(duration > 0)) { this.timeLeft.textContent = '--:--'; return }
    const clock = live.state.clock
    const at = clock ? clockTime(clock) : 0
    this.timeLeft.textContent = this.scrub != null ? clockText(this.scrub * duration) : '-' + clockText(Math.max(duration - at, 0))
    this.timeLeft.classList.toggle('scrubbing', this.scrub != null)
  }
}

/** The player made small: the song's cover, its name and artist, back, play and forward, on one capsule of glass;
 *  the arrows at its end bring the whole player back. */
class MiniBar {
  host: HTMLElement
  shown = ''

  constructor(host: HTMLElement) {
    this.host = host
    host.innerHTML = `<div class="bar-glass"></div>
      <div class="mini-art"></div>
      <div class="mini-texts"><div class="marquee title"><span></span></div><div class="marquee subtitle"><span></span></div></div>
      <div class="mini-buttons">${button('previous', 13)}${button('toggle', 17)}${button('next', 13)}</div>
      ${button('expand', 12, { quiet: true, label: 'Make the player big again' })}`
    sizeButtons(host)
    $('[data-action="previous"] .glyph', host).innerHTML = icons.backward
    $('[data-action="next"] .glyph', host).innerHTML = icons.forward
    $('[data-action="expand"] .glyph', host).innerHTML = icons.expand
    frosted($('.bar-glass', host), live, () => live.settings?.player.frost ?? 0.35)
    host.addEventListener('click', (event) => {
      const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action
      if (!action || justDragged()) return
      if (action === 'expand') page.command('set', { player: { mini: false } })
      else page.command(action)
    })
  }

  update(): void {
    const t = live.state.track
    $('[data-action="toggle"] .glyph', this.host).innerHTML = live.state.playing ? icons.pause : icons.play
    const key = `${t?.title}|${t?.artist}|${t?.cover}`
    if (key !== this.shown) {
      this.shown = key
      $('.mini-art', this.host).replaceChildren(coverImage(t?.cover))
      const title = $('.marquee.title', this.host), subtitle = $('.marquee.subtitle', this.host)
      ;(title.firstElementChild as HTMLElement).textContent = t?.title || 'Not Playing'
      ;(subtitle.firstElementChild as HTMLElement).textContent = t?.artist || ''
      requestAnimationFrame(() => { marquee(title); marquee(subtitle) })
    }
    for (const el of this.host.querySelectorAll('.marquee')) el.classList.toggle('running', !!live.state.playing)
  }
}

// ---- search, and an era's page ----

interface SearchAnswer { songs: DesktopTrack[]; eras: { name: string; cover: string | null; count: number }[] }
interface EraAnswer { name: string; about: string; cover: string | null; songs: DesktopTrack[] }

class Search {
  bar: HTMLElement
  input: HTMLInputElement
  grid: HTMLElement
  content: HTMLElement
  note: HTMLElement
  isOpen = false
  query = ''
  turn = 0
  timer = 0
  answer: SearchAnswer | null = null
  era: EraAnswer | null = null

  constructor() {
    this.bar = $('#searchbar')
    this.input = $('input', this.bar)
    this.grid = $('#search-grid')
    this.content = $('.content', this.grid)
    this.note = $('.note', this.grid)
    $('.mag', this.bar).innerHTML = icons.search
    $('.clear', this.bar).innerHTML = icons.clear
    frosted($('.glass', this.grid), live, () => live.settings?.player.frost ?? 0.35)
    this.bar.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.clear')) {
        if (this.input.value) { this.input.value = ''; this.typed(); this.input.focus() } else this.close()
        return
      }
      if (!this.isOpen) this.open()
    })
    this.input.addEventListener('input', () => this.typed())
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (this.era) this.showAnswer(); else this.close() }
      if (event.key === 'Enter') { const first = this.answer?.songs[0]; if (first) play(first, this.answer!.songs) }
    })
    this.content.addEventListener('click', (event) => this.clicked(event))
    this.content.addEventListener('contextmenu', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-song]')
      if (!row) return
      event.preventDefault()
      const song = this.songOf(row)
      if (song) openMenu(event.clientX, event.clientY, song, this.list(row))
    })
  }

  get showsGrid(): boolean { return this.isOpen && (this.query.length > 0 || !!this.era) }

  open(): void {
    this.isOpen = true
    this.bar.classList.add('open')
    $('#tools').classList.add('searching')
    page.keys(true)
    window.setTimeout(() => this.input.focus(), 60)
    render()
  }

  close(): void {
    this.isOpen = false
    this.query = ''
    this.input.value = ''
    this.answer = null
    this.era = null
    this.turn++
    this.bar.classList.remove('open', 'busy')
    $('#tools').classList.remove('searching')
    page.keys(false)
    closeMenu()
    render()
  }

  typed(): void {
    this.query = this.input.value.trim()
    this.era = null
    window.clearTimeout(this.timer)
    if (!this.query) { this.answer = null; this.paint(); render(); return }
    // Once the typing stops for a moment: a word typed asks once, not once a letter.
    this.timer = window.setTimeout(() => void this.ask(this.query), 350)
    render()
  }

  async ask(query: string): Promise<void> {
    const turn = ++this.turn
    this.bar.classList.add('busy')
    const answer = await page.request<SearchAnswer>('search', query)
    if (turn !== this.turn) return
    this.bar.classList.remove('busy')
    this.answer = answer ?? { songs: [], eras: [] }
    this.paint()
  }

  async openEra(name: string): Promise<void> {
    const turn = ++this.turn
    this.bar.classList.add('busy')
    const era = await page.request<EraAnswer>('era', name)
    if (turn !== this.turn) return
    this.bar.classList.remove('busy')
    if (!era) { notice('Couldn’t open that era', name); return }
    this.era = era
    this.paint()
    render()
  }

  showAnswer(): void {
    this.era = null
    this.paint()
    render()
  }

  row(song: DesktopTrack, index: number, playingId: string | undefined): string {
    return `<div class="result row${song.id === playingId ? ' playing' : ''}" data-song="${index}">
      <div class="art"><span class="cover-slot" data-cover="${escapeText(song.cover ?? '')}"></span><span class="play">${icons.playSmall}</span></div>
      <div class="words"><b>${escapeText(song.title)}</b><span>${escapeText(song.artist || song.album)}</span></div>
      <span class="time">${song.duration ? clockText(song.duration) : ''}</span></div>`
  }

  paint(): void {
    const playingId = live.state.track?.id
    this.content.replaceChildren()
    this.note.classList.remove('shown')
    if (this.era) {
      const era = this.era
      this.content.innerHTML = `<div class="era-head"><button class="back" data-back aria-label="Back">${icons.arrowOut}</button>
        <div class="era-art"><span class="cover-slot" data-cover="${escapeText(era.cover ?? '')}"></span></div>
        <div class="era-words"><b>${escapeText(era.name)}</b><span>${escapeText(era.about || `${era.songs.length} songs`)}</span>
          <div class="era-buttons"><button class="pill" data-era-play>${icons.playSmall}Play</button><button class="pill ghost" data-era-shuffle>Shuffle</button></div></div></div>
        <div class="songs one">${era.songs.map((s, i) => this.row(s, i, playingId)).join('')}</div>`
    } else if (this.answer) {
      const { songs, eras } = this.answer
      if (!songs.length && !eras.length) { this.note.textContent = `Nothing found for “${this.query}”`; this.note.classList.add('shown'); return }
      this.content.innerHTML = `${songs.length ? `<div class="section">Songs</div><div class="songs">${songs.slice(0, 16).map((s, i) => this.row(s, i, playingId)).join('')}</div>` : ''}
        ${eras.length ? `<div class="section">Eras</div><div class="tiles">${eras.map((e) => `<div class="result tile" data-era="${escapeText(e.name)}">
          <div class="art"><span class="cover-slot" data-cover="${escapeText(e.cover ?? '')}"></span></div><div class="words"><b>${escapeText(e.name)}</b><span>${e.count} ${e.count === 1 ? 'song' : 'songs'}</span></div></div>`).join('')}</div>` : ''}`
    } else if (this.query) {
      this.note.textContent = 'Searching…'
      this.note.classList.add('shown')
    }
    // Covers and the results' rise, set through the page's own styles (the CSP lets no style attribute through).
    this.content.querySelectorAll<HTMLElement>('.cover-slot').forEach((slot) => { const url = slot.dataset.cover; slot.replaceWith(coverImage(url || null)) })
    this.content.querySelectorAll<HTMLElement>('.result').forEach((el, i) => el.style.setProperty('--delay', `${Math.min(i, 20) * 0.025}s`))
  }

  list(row: HTMLElement): DesktopTrack[] {
    return row.closest('.songs.one') && this.era ? this.era.songs : this.answer?.songs ?? []
  }

  songOf(row: HTMLElement): DesktopTrack | undefined {
    return this.list(row)[Number(row.dataset.song)]
  }

  clicked(event: MouseEvent): void {
    const target = event.target as Element
    if (target.closest('[data-back]')) { this.showAnswer(); return }
    if (target.closest('[data-era-play]') && this.era) { page.command('play-era', { name: this.era.name, shuffle: false }); return }
    if (target.closest('[data-era-shuffle]') && this.era) { page.command('play-era', { name: this.era.name, shuffle: true }); return }
    const eraTile = target.closest<HTMLElement>('[data-era]')
    if (eraTile) { void this.openEra(eraTile.dataset.era ?? ''); return }
    const row = target.closest<HTMLElement>('[data-song]')
    if (row) { const song = this.songOf(row); if (song) play(song, this.list(row)) }
  }
}

function play(song: DesktopTrack, list: DesktopTrack[]): void {
  page.command('play-track', { track: song.track, context: list.map((s) => s.track) })
}

// ---- a song's menu ----

/** Which menu is open: a search result's, the song's other versions, or the song playing's own (the ⋯). */
type MenuKind = 'result' | 'versions' | 'song'
let menuKind: MenuKind | null = null
/** Goes up as the ⋯ menu is asked for or any menu closes: an answer for a menu since closed is dropped. */
let songMenuTurn = 0
let menuFor: { song: DesktopTrack; list: DesktopTrack[] } | null = null
const menuOpen = (kind: MenuKind): boolean => menuKind === kind

/** The menu filled and shown as `kind`: the result's at the pointer, the others over their buttons. */
function showMenu(kind: MenuKind, html: string, at: { x: number; y: number } | HTMLElement): void {
  const menu = $('#menu')
  menuKind = kind
  menu.classList.toggle('listing', kind !== 'result')
  menu.innerHTML = html
  menu.classList.remove('hidden')
  const r = menu.getBoundingClientRect()
  if (at instanceof HTMLElement) {
    // Above the button, its right edge on the button's; below it if there's no room.
    const b = at.getBoundingClientRect()
    menu.style.left = `${Math.min(Math.max(b.right - r.width, 8), window.innerWidth - r.width - 8)}px`
    menu.style.top = `${b.top - r.height - 8 >= 8 ? b.top - r.height - 8 : b.bottom + 8}px`
  } else {
    menu.style.left = `${Math.min(at.x, window.innerWidth - r.width - 8)}px`
    menu.style.top = `${Math.min(at.y, window.innerHeight - r.height - 8)}px`
  }
}

function openMenu(x: number, y: number, song: DesktopTrack, list: DesktopTrack[]): void {
  menuFor = { song, list }
  showMenu('result', `<button data-menu="play">Play</button><button data-menu="next">Play next</button><button data-menu="queue">Add to queue</button>`, { x, y })
}
function closeMenu(): void { $('#menu').classList.add('hidden'); menuKind = null; menuFor = null; songMenuTurn++ }

// ---- the song's other versions: WRLD's version notch, as a menu over the versions button ----

const versionsOpen = (): boolean => menuOpen('versions')
function openVersions(): void {
  const versions = live.state.versions ?? []
  if (!versions.length) return
  menuFor = null
  showMenu('versions', `<div class="menu-title">Other versions</div>${versions.map((v, i) =>
    `<button data-version="${v.songId}">${escapeText(v.label ?? `Version ${i + 1}`)}</button>`).join('')}`, $<HTMLElement>('[data-tool="versions"]'))
}

// ---- the song playing's own menu (the ⋯ by the heart): what of the app's song menu a widget can do ----

interface SongMenu { title: string; info: boolean; link: boolean; download: boolean; edit: boolean; lyrics: boolean; playlists: { id: number; name: string }[] | null }
let songMenu: SongMenu | null = null
const songMenuOpen = (): boolean => menuOpen('song')

let songMenuAnchor: HTMLElement | null = null

async function openSongMenu(anchor: HTMLElement | null = null): Promise<void> {
  songMenuAnchor = anchor
  const turn = ++songMenuTurn
  const answer = await page.request<SongMenu>('song-menu')
  if (turn !== songMenuTurn || !answer) return
  songMenu = answer
  paintSongMenu(false)
}

/** Its rows, or (`playlists`) the playlists to add the song to. */
function paintSongMenu(playlists: boolean): void {
  const m = songMenu
  if (!m) return
  menuFor = null
  const row = (what: string, label: string): string => `<button data-more="${what}">${label}</button>`
  let html: string
  if (playlists && m.playlists) {
    html = `<button class="menu-title back" data-more="back">‹ Add to playlist</button>${m.playlists.length
      ? m.playlists.map((p) => `<button data-playlist="${p.id}">${escapeText(p.name)}</button>`).join('')
      : '<div class="menu-note">No playlists yet</div>'}`
  } else {
    const rows = [m.info && row('info', 'Song info'), m.playlists && row('playlists', 'Add to playlist…'), m.lyrics && live.inTab && row('share-lyrics', 'Share lyrics'), m.link && row('link', 'Copy link'),
      m.download && row('download', 'Download'), m.edit && row('edit', 'Edit')].filter(Boolean).join('')
    html = `<div class="menu-title">${escapeText(m.title)}</div>${rows || '<div class="menu-note">Nothing more for this song</div>'}`
  }
  showMenu('song', html, songMenuAnchor ?? $<HTMLElement>('[data-action="more"]'))
}

/** A row picked. The quick ones show done at once, and say so if the app couldn't. */
function songMenuPick(what: string): void {
  const title = songMenu?.title ?? ''
  if (what === 'back' || what === 'playlists') { paintSongMenu(what === 'playlists'); return }
  closeMenu()
  if (what === 'info') page.command('song-info')
  if (what === 'edit') page.command('edit-song')
  if (what === 'share-lyrics') page.command('share-lyrics')
  if (what === 'download') { page.command('download-song'); notice('Downloading', title) }
  if (what === 'link') {
    notice('Link copied', title)
    void page.request<boolean>('copy-link').then((ok) => { if (!ok) notice('Couldn’t copy the link', title) })
  }
}

function addToPlaylist(id: number): void {
  const name = songMenu?.playlists?.find((p) => p.id === id)?.name ?? 'Playlist'
  closeMenu()
  notice('Added to playlist', name)
  void page.request<boolean>('add-to-playlist', id).then((ok) => { if (!ok) notice('Couldn’t add to playlist', name) })
}

$('#menu').addEventListener('click', (event) => {
  const target = event.target as Element
  const more = target.closest<HTMLElement>('[data-more]')?.dataset.more
  if (more) { songMenuPick(more); return }
  const playlist = target.closest<HTMLElement>('[data-playlist]')?.dataset.playlist
  if (playlist) { addToPlaylist(Number(playlist)); return }
  const version = target.closest<HTMLElement>('[data-version]')?.dataset.version
  if (version) { closeMenu(); page.command('play-version', Number(version)); return }
  const what = target.closest<HTMLElement>('[data-menu]')?.dataset.menu
  const chosen = menuFor
  closeMenu()
  if (!what || !chosen) return
  if (what === 'play') play(chosen.song, chosen.list)
  if (what === 'next') { page.command('play-next', chosen.song.track); notice('Playing next', chosen.song.title) }
  if (what === 'queue') { page.command('add-to-queue', chosen.song.track); notice('Added to queue', chosen.song.title) }
})
// The versions button and the ⋯ toggle their own menus, so a press on one is left to its click.
window.addEventListener('pointerdown', (event) => { if (!(event.target as Element).closest('#menu, [data-menu-button]')) closeMenu() }, true)

// ---- the lyrics ----

const lyricHost = $('#lyrics .lyric-host')
const stage = new LyricStage(lyricHost)
/** The song as the stage is shown it, made once per lyrics: a new one each render would set the scene afresh. */
let stageSong: { from: unknown; title: string; song: StageSong } | null = null
function songForStage(): StageSong | null {
  const lyrics = live.state.lyrics
  const track = live.state.track
  if (!lyrics || !track) return null
  if (stageSong?.from !== lyrics || stageSong.title !== track.title) {
    stageSong = { from: lyrics, title: track.title, song: { id: lyrics.id, title: track.title, artist: track.artist, lyrics: { lines: lyrics.lines, isSynced: true } } }
  }
  return stageSong.song
}

function drawLyrics(open: boolean): void {
  const box = $('#lyrics')
  box.classList.toggle('gone', !open)
  const quiet = $('#lyrics .quiet')
  const track = live.state.track
  const lyrics = live.state.lyrics
  const has = open && !!track && lyrics?.id === track.id && lyrics.lines.length > 0
  if (!has) {
    stage.stop()
    quiet.classList.toggle('gone', !open)
    $('.quiet-icon', quiet).innerHTML = icons.lyrics
    $('.quiet-text', quiet).textContent = track ? 'No lyrics for this song' : 'Nothing playing'
    return
  }
  quiet.classList.add('gone')
  const look = live.settings?.lyrics.look && live.settings.lyrics.look !== 'classic' ? live.settings.lyrics.look : 'fisheye'
  stage.use(look)
  const song = songForStage()
  if (!song) return
  stage.show(song, { clock: live.state.clock ?? null, isSeen: !live.unseen, colors: live.state.colors ?? null, face: lyricFontFor(live.settings?.lyrics.fonts, stage.look), scale: m.s, tune: live.state.lyricTune,
    seek: live.state.fm ? undefined : seekToLine })
}
function seekToLine(seconds: number): void { page.command('seek-to', seconds) }
// The wheel on a line scrolls the lyrics (between the lines, it's the carousel's, which passes it on).
$('#lyrics').addEventListener('wheel', (event) => stage.scrollBy(event.deltaY), { passive: true })

/** The lyrics are drawn at this point: words (or the note between them, or "No lyrics") in sight there. The lyrics
 *  take no pointer themselves, so what's under them is what's hit; this says the point is theirs all the same. */
function onLyrics(x: number, y: number): boolean {
  if ($('#lyrics').classList.contains('gone')) return false
  const over = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  const quiet = $('#lyrics .quiet')
  if (!quiet.classList.contains('gone')) return [...quiet.children].some(over)
  // Only what's drawn: a picture, letters or a painted box, not an empty box round them; and not faded out.
  const drawn = (el: Element): boolean => el instanceof HTMLCanvasElement || el instanceof SVGElement || !!el.textContent?.trim()
    || getComputedStyle(el).backgroundImage !== 'none'
  const seen = (el: Element): boolean => {
    let opacity = 1
    for (let at: Element | null = el; at && at !== lyricHost; at = at.parentElement) {
      const style = getComputedStyle(at)
      if (style.visibility === 'hidden' || style.display === 'none') return false
      opacity *= Number(style.opacity)
    }
    return opacity > 0.05
  }
  for (const el of lyricHost.querySelectorAll('*')) {
    if (el.childElementCount || !over(el)) continue
    if (drawn(el) && seen(el)) return true
  }
  return false
}

// ---- the cards ----

const cards = new CardStack($('#stage'))
const aura = new Aura($('#aura'), { meter: () => live.meter, style: () => ({ ...DEFAULT_LIGHT, ...(live.settings?.light ?? {}) }) })
let hoveredKey: string | null = null
let browseKey: string | null = null
let closedByCover = false
let returnHome = 0

function cardList(): { list: Card[]; items: DesktopTrack[]; home: number } {
  const shown = live.state.cards
  const items = shown?.items ?? []
  return {
    items,
    list: items.map((t) => ({ key: t.key, title: t.title, line: t.artist || t.album || 'Unknown artist', image: t.cover })),
    home: shown && shown.current >= 0 ? shown.current - shown.from : -1,
  }
}

/** Browsed away from the song playing: after a quiet moment the cards turn back to it. */
function goHome(after = 8000): void {
  window.clearTimeout(returnHome)
  returnHome = window.setTimeout(() => { browseKey = null; render() }, after)
}

function render(): void {
  const settings = live.settings
  const p = settings?.player
  const mini = !!p?.mini
  const lyricsOut = !!p?.lyricsOpen && !mini
  if (lyricsOut) closedByCover = false
  const { list, home } = cardList()
  const lyricsCard = lyricsOut && home >= 0 ? list[home]?.key ?? null : null
  const folded = !!p?.hidesLyricsCard && lyricsCard != null
  const beside = !folded && lyricsCard != null

  // The versions button: there while the song has other versions.
  const hasVersions = !!live.state.versions?.length
  $('[data-tool="versions"]').classList.toggle('away', !hasVersions)
  if (!hasVersions && versionsOpen()) closeMenu()
  // 999 FM: lit while it's on, and not to be tuned in while it's off the air.
  const fm = $<HTMLButtonElement>('[data-tool="fm"]')
  const offAir = live.state.fmLive === false && !live.state.fm
  fm.classList.toggle('on', !!live.state.fm)
  fm.disabled = offAir
  fm.title = live.state.fm ? 'Leave 999 FM' : offAir ? '999 FM is off the air' : 'Listen to 999 FM'

  const eye = $('[data-tool="lyricsCard"]')
  eye.classList.toggle('gone', !lyricsCard)
  eye.innerHTML = folded ? icons.eyeSlash : icons.eye
  eye.title = folded ? 'Show the card' : 'Hide the card'

  $('#lyrics').classList.toggle('beside', beside)
  $('#bar').classList.toggle('gone', mini)
  $('#mini').classList.toggle('gone', !mini)
  $('#tools').classList.toggle('gone', mini)
  const searching = search.showsGrid && !mini
  $('#search-grid').classList.toggle('gone', !searching)
  const cardsGone = mini || searching || (lyricsOut && !beside)
  $('#stage').style.pointerEvents = cardsGone ? 'none' : ''

  const browsed = browseKey ? list.findIndex((c) => c.key === browseKey) : -1
  const focus = browsed >= 0 ? browsed : home >= 0 ? home : list.length ? 0 : -1
  $('#empty').classList.toggle('gone', focus >= 0 || cardsGone)
  if (focus < 0) {
    cards.show([], { m, turn: 0, hoveredKey: null, receded: cardsGone })
    aura.update(lightColors(), false, { width: m.cardWidth, height: m.cardHeight, radius: m.cardRadius })
  } else {
    const absolute = (live.state.cards?.from ?? 0) + focus
    const entries = placements(list, focus, lyricsOut ? null : hoveredKey, p?.sideCards ?? 2, p?.tilt ?? 0.5, m)
    cards.show(entries, { m, turn: absolute, hoveredKey: lyricsOut ? null : hoveredKey, receded: cardsGone, focusedKey: lyricsCard, floating: beside && !live.unseen, folded })
    // The song playing comes alive in the middle; beside the lyrics the card only floats.
    aura.update(lightColors(), !!live.state.playing && focus === home && !cardsGone && !lyricsOut && !live.unseen,
      { width: m.cardWidth, height: m.cardHeight, radius: m.cardRadius })
  }
  drawLyrics(lyricsOut)
  bar.update()
  miniBar.update()
}

// ---- pointer ----

const carousel = $('#carousel')
carousel.addEventListener('pointermove', (event) => {
  if (live.settings?.player.lyricsOpen) { if (hoveredKey) { hoveredKey = null; render() } return }
  const hit = cards.hit(event.clientX, event.clientY)
  if ((hit?.key ?? null) !== hoveredKey) { hoveredKey = hit?.key ?? null; render() }
  cards.lean(hit?.key ?? null, hit?.spot ?? null)
})
carousel.addEventListener('pointerleave', () => { if (hoveredKey) { hoveredKey = null; render() } cards.lean(null, null) })
carousel.addEventListener('click', (event) => {
  // A click on the lyrics themselves is theirs (their menu is a right-click), not the cards'.
  if (justDragged() || onLyrics(event.clientX, event.clientY)) return
  // The lyrics open: a click on the cards goes back to them.
  if (live.settings?.player.lyricsOpen) { page.command('set', { player: { lyricsOpen: false } }); closedByCover = true; return }
  const hit = cards.hit(event.clientX, event.clientY)
  if (!hit) return
  const { items, home } = cardList()
  const index = items.findIndex((t) => t.key === hit.key)
  if (index < 0) return
  if (index === home) {
    // The cover that just closed the lyrics brings them back.
    if (closedByCover) { closedByCover = false; page.command('set', { player: { lyricsOpen: true } }); return }
    page.command('toggle'); browseKey = null; render(); return
  }
  closedByCover = false
  // Played where it is in the queue: the queue is kept.
  page.command('jump', (live.state.cards?.from ?? 0) + index)
  browseKey = null
  render()
})
let scrollDebt = 0
carousel.addEventListener('wheel', (event) => {
  if (live.settings?.player.lyricsOpen) { stage.scrollBy(event.deltaY); return }
  scrollDebt += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (Math.abs(scrollDebt) < 60) return
  const step = scrollDebt > 0 ? 1 : -1
  scrollDebt = 0
  const { list, home } = cardList()
  const at = browseKey ? list.findIndex((c) => c.key === browseKey) : home
  const next = Math.min(Math.max((at < 0 ? 0 : at) + step, 0), list.length - 1)
  browseKey = next === home ? null : list[next]?.key ?? null
  if (browseKey) goHome()
  render()
}, { passive: true })

$('#tools').addEventListener('click', (event) => {
  const tool = (event.target as Element).closest<HTMLElement>('[data-tool]')?.dataset.tool
  if (!tool || justDragged()) return
  if (tool === 'mini') page.command('set', { player: { mini: true } })
  if (tool === 'lyricsCard') page.command('set', { player: { hidesLyricsCard: !live.settings?.player.hidesLyricsCard } })
  if (tool === 'more') { if (songMenuOpen()) closeMenu(); else void openSongMenu($<HTMLElement>('[data-tool="more"]')) }
  if (tool === 'versions') { if (versionsOpen()) closeMenu(); else openVersions() }
  if (tool === 'fm') page.command('fm')
})
$('[data-tool="fm"]').innerHTML = icons.radio
$('[data-tool="versions"]').innerHTML = icons.stack
$('[data-tool="more"]').innerHTML = icons.ellipsis
$('[data-tool="mini"]').innerHTML = icons.mini
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && search.isOpen) search.close() })
window.addEventListener('blur', () => { if (search.isOpen && !search.query) search.close() })

// What takes clicks: everything drawn, but none of the clear containers round it - and the lyrics' words.
seeThrough((x, y) => {
  const el = document.elementFromPoint(x, y)
  return (!!el && el !== document.body && el !== document.documentElement && !el.hasAttribute('data-clear')) || onLyrics(x, y)
})
// The bar's and the capsule's empty glass, and the cards, move the player.
dragToMove((target) => !!target.closest('.bar-glass, .strip-texts, #mini, .dk-card, #empty') && !target.closest('button, input, .progress'))
// The lyrics have their own menu.
menuOnRightClick((x, y) => (onLyrics(x, y) ? 'lyrics' : null))

const bar = new Bar($('#bar'))
const miniBar = new MiniBar($('#mini'))
const search = new Search()

live.on((what, patch) => {
  if (what === 'settings') applyMetrics()
  if (what === 'state' && patch && 'track' in patch) { browseKey = null }
  // A new song's versions: the list open was the last song's.
  if (what === 'state' && patch && 'versions' in patch && versionsOpen()) closeMenu()
  // And the ⋯ menu open was about the song before.
  if (what === 'state' && patch && 'track' in patch && songMenuOpen()) closeMenu()
  if (what === 'state' && search.isOpen && patch && 'track' in patch) search.paint()
  render()
})
document.addEventListener('visibilitychange', render)
page.on('desktop:notice', ({ title, detail }) => notice(title, detail))
void live.start().then(() => { applyMetrics(); render() })
