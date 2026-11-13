import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, ListMusic, Gamepad2, Flame, Music2, Disc3, Newspaper, Radio, Heart, Album, Music, Wrench, MicVocal, RefreshCw, AudioLines, ImagePlus, FileAudio } from 'lucide-react'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { Tile } from './Tile'
import HomeHero from './HomeHero'
import OnThisDayTile from './OnThisDayTile'
import { useHomeData, HOME_ALBUMS_SHOWN, type GameCard, type HomePlaylistCard, type HomeAlbumCard } from '../hooks/useHomeData'
import { useElementSize } from '../hooks/useElementSize'
import { useStore, useStorePick } from '../store/useStore'
import { useCanEdit } from '../hooks/useChannelRoles'
import * as userApi from '../lib/userApi'
import type { SongContextMenuState } from './SongContextMenu'
import type { PlaylistContextMenuState } from './PlaylistContextMenu'
import type { NewsMenuState } from './NewsContextMenu'
import type { NewsItem } from '../lib/newsApi'
import type { Track } from '../types'
import { hasChatAccess } from '../lib/chatAccess'
import { lazyOverlay } from '../lib/lazyView'
import { PlaylistCoverThumb } from '../lib/homeViewShared'

// Staff-only, and it reads the chat store - loading it lazily keeps the chat
// client out of Home's chunk for everyone else.
const HomeChatCard = lazyOverlay(() => import('./chat/HomeChatCard'))
// Right-click only. Home is the desktop landing page, so anything it imports
// statically is startup cost - these load on the first right-click instead.
const SongContextMenu = lazyOverlay(() => import('./SongContextMenu'))
const PlaylistContextMenu = lazyOverlay(() => import('./PlaylistContextMenu'))
const NewsContextMenu = lazyOverlay(() => import('./NewsContextMenu'))
const ShareNewsModal = lazyOverlay(() => import('./chat/ShareNewsModal'))

// The desktop landing screen - same sections, same data (useHomeData) and the
// same Settings → Home screen toggles as the mobile shell, laid out as a bento
// that fills the window instead of a stack that scrolls out of it.
//
// Section ids map 1:1 to one place on screen, so hiding a section in
// Settings removes exactly one thing. News, 999 FM and Liked share one
// narrow right-hand rail (compact cards, News taking whatever height they
// leave it) rather than each claiming a full-height column of their own, so
// Recently played and Playlists - the two sections actually worth spending
// width on - get the rest of the page. "Your listening" is the hero's row
// of numbers, where it costs no vertical space of its own.

const GAP = 12          // matches gap-3 on the cover grids
const MIN_TILE = 104    // narrowest a cover may get before dropping a column
const MAX_NEWS = 20

// Cover strips scroll sideways. The column width sets how big a cover is
// (as many as fit at MIN_TILE or wider), and the strip then stacks as many
// rows as the tile has height for, never fewer than `minRows`. A strip only
// asks for `minRows` worth of height itself, so it never makes its bento row
// taller; when its neighbour (On this day) does, the strip grows its covers
// and adds rows into that space instead of leaving it empty.
const COVER_TEXT_H = 41 // mb-1.5 + title line + subtitle line under a cover

function stripGeometry(width: number, height: number, minRows: number): { cover: number; rows: number; minHeight: number } {
  if (width <= 0) return { cover: MIN_TILE, rows: minRows, minHeight: minRows * (MIN_TILE + COVER_TEXT_H) + (minRows - 1) * GAP }
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const base = (width - (cols - 1) * GAP) / cols
  const item = base + COVER_TEXT_H
  const minHeight = minRows * item + (minRows - 1) * GAP
  if (height <= minHeight) return { cover: base, rows: minRows, minHeight }
  const rows = Math.max(minRows, Math.floor((height + GAP) / (item + GAP)))
  const cover = (height - (rows - 1) * GAP) / rows - COVER_TEXT_H
  return { cover, rows, minHeight }
}

function CoverStrip({ minRows, controlsRef, children }: {
  minRows: number
  /** Gets the strip's prev/next buttons, for the Tile header. */
  controlsRef: (controls: React.ReactNode) => void
  children: React.ReactNode
}): JSX.Element {
  const [boxRef, { width, height }] = useElementSize<HTMLDivElement>()
  const [strip, setStrip] = useState<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ prev: false, next: false })
  const { cover, rows, minHeight } = stripGeometry(width, height, minRows)

  useEffect(() => {
    if (!strip) return
    const update = (): void => {
      const max = strip.scrollWidth - strip.clientWidth
      const prev = strip.scrollLeft > 1
      const next = strip.scrollLeft < max - 1
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
    }
    // The wheel scrolls the strip sideways while it can still move that
    // way; at either end it falls through to the page. Each notch moves a
    // target, and the strip eases toward it frame by frame, so a mouse wheel
    // glides instead of jumping 100px at a time.
    let target = strip.scrollLeft
    let frame = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const glide = (): void => {
      const diff = target - strip.scrollLeft
      if (Math.abs(diff) < 0.5) { strip.scrollLeft = target; frame = 0; return }
      strip.scrollLeft += diff * 0.2
      frame = requestAnimationFrame(glide)
    }
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      const max = strip.scrollWidth - strip.clientWidth
      if (max <= 0) return
      const from = frame ? target : strip.scrollLeft
      if ((e.deltaY < 0 && from <= 0) || (e.deltaY > 0 && from >= max - 1)) return
      e.preventDefault()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * strip.clientWidth : e.deltaY
      target = Math.max(0, Math.min(max, from + delta))
      if (reduceMotion) { strip.scrollLeft = target; return }
      if (!frame) frame = requestAnimationFrame(glide)
    }
    // An arrow click or a drag takes over: start the next wheel from there.
    const onScroll = (): void => {
      if (!frame) target = strip.scrollLeft
      update()
    }
    update()
    strip.addEventListener('scroll', onScroll, { passive: true })
    strip.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(update)
    ro.observe(strip)
    return () => {
      cancelAnimationFrame(frame)
      strip.removeEventListener('scroll', onScroll)
      strip.removeEventListener('wheel', onWheel)
      ro.disconnect()
    }
  }, [strip, cover, rows])

  const page = (dir: -1 | 1): void => {
    if (!strip) return
    const step = Math.max(cover + GAP, Math.floor((strip.clientWidth + GAP) / (cover + GAP)) * (cover + GAP))
    strip.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  const showArrows = edges.prev || edges.next
  useEffect(() => {
    controlsRef(showArrows ? (
      <div className="flex items-center gap-0.5 shrink-0">
        <StripArrow dir={-1} disabled={!edges.prev} onClick={() => page(-1)} />
        <StripArrow dir={1} disabled={!edges.next} onClick={() => page(1)} />
      </div>
    ) : null)
    // page() reads the current strip and cover; re-publish when they change.
  }, [showArrows, edges.prev, edges.next, strip, cover]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={boxRef} className="relative flex-1" style={{ minHeight }}>
      <div
        ref={setStrip}
        className="absolute inset-0 overflow-x-auto overflow-y-hidden no-scrollbar grid gap-3 grid-flow-col"
        style={{ gridTemplateRows: `repeat(${rows}, ${cover + COVER_TEXT_H}px)`, gridAutoColumns: `${cover}px` }}
      >
        {children}
      </div>
    </div>
  )
}

function StripArrow({ dir, disabled, onClick }: { dir: -1 | 1; disabled: boolean; onClick: () => void }): JSX.Element {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir < 0 ? 'Scroll back' : 'Scroll forward'}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted transition-colors"
    >
      <Icon size={15} />
    </button>
  )
}

// The main column is a 12-column bento: visible sections pair up two to a row
// in page order, wide/narrow on one row and narrow/wide on the next, so no two
// rows line up. An unpaired last section takes the full row. Below
// BENTO_MIN_WIDTH a narrow half would be too cramped for covers, so every
// section gets its own row again. Class names are spelled out for Tailwind.
type MainSection = 'recent' | 'onthisday' | 'playlists' | 'albums' | 'tools'
const BENTO_MIN_WIDTH = 900
const BENTO_SPLITS: [string, string][] = [
  ['col-span-7', 'col-span-5'],
  ['col-span-5', 'col-span-7'],
]

function bentoSpans(sections: MainSection[], paired: boolean): Partial<Record<MainSection, string>> {
  const spans: Partial<Record<MainSection, string>> = {}
  for (let i = 0; i < sections.length; i += 2) {
    const a = sections[i]
    const b = sections[i + 1]
    if (!paired || !b) {
      spans[a] = 'col-span-12'
      if (b) spans[b] = 'col-span-12'
      continue
    }
    const [wa, wb] = BENTO_SPLITS[(i / 2) % BENTO_SPLITS.length]
    spans[a] = wa
    spans[b] = wb
  }
  return spans
}

function EmptyNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-text-muted text-xs">{children}</p>
}

// ─── Main column: the cover strips ───────────────────────────────────────────

function RecentTile({ tracks, onPlay, onContextMenu, span }: {
  tracks: Track[]
  onPlay: (track: Track) => void
  onContextMenu: (track: Track, e: React.MouseEvent) => void
  span: string
}): JSX.Element {
  const [controls, setControls] = useState<React.ReactNode>(null)
  return (
    <Tile title="Recently played" icon={<Disc3 size={15} />} controls={controls} span={span}>
      <CoverStrip minRows={2} controlsRef={setControls}>
        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => onPlay(track)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(track, e) }}
            className="group text-left min-w-0"
          >
            <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-raised mb-1.5">
              <AlbumArtThumbnail track={track} fill res={512} className="w-full h-full object-cover" />
              <span className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full bg-accent text-black flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all">
                <Play size={13} className="ml-0.5" fill="currentColor" />
              </span>
            </div>
            <p className="text-text-primary text-xs leading-snug truncate group-hover:text-accent transition-colors">{track.title}</p>
            <p className="text-text-muted text-[11px] truncate mt-0.5">{track.artist}</p>
          </button>
        ))}
      </CoverStrip>
    </Tile>
  )
}

function PlaylistsTile({ playlists, onAll, onContextMenu, span }: {
  playlists: HomePlaylistCard[]
  onAll: () => void
  onContextMenu: (p: HomePlaylistCard, e: React.MouseEvent) => void
  span: string
}): JSX.Element {
  const [controls, setControls] = useState<React.ReactNode>(null)
  return (
    <Tile title="Playlists" icon={<ListMusic size={15} />} controls={controls} action={{ label: 'All', onClick: onAll }} span={span}>
      {playlists.length === 0 ? (
        <EmptyNote>No playlists yet - build one from any song&apos;s menu.</EmptyNote>
      ) : (
        <CoverStrip minRows={1} controlsRef={setControls}>
          {playlists.map((p) => (
            <button
              key={p.key}
              onClick={p.open}
              onContextMenu={(e) => { if (p.playlist) { e.preventDefault(); onContextMenu(p, e) } }}
              className="group text-left min-w-0"
            >
              <div className="aspect-square rounded-lg overflow-hidden bg-surface-raised mb-1.5 flex items-center justify-center">
                <PlaylistCoverThumb cover={p.cover} mosaic={p.mosaic} alt={p.name} />
              </div>
              <p className="text-text-primary text-xs leading-snug truncate group-hover:text-accent transition-colors">{p.name}</p>
              <p className="text-text-muted text-[11px] truncate mt-0.5">{p.subtitle}</p>
            </button>
          ))}
        </CoverStrip>
      )}
    </Tile>
  )
}

function AlbumsTile({ albums, onAll, span }: {
  albums: HomeAlbumCard[]
  onAll: () => void
  span: string
}): JSX.Element {
  const [controls, setControls] = useState<React.ReactNode>(null)
  return (
    <Tile title="Albums" icon={<Album size={15} />} controls={controls} action={{ label: 'All', onClick: onAll }} span={span}>
      <CoverStrip minRows={1} controlsRef={setControls}>
        {/* Only on the very first visit, before any album list was cached. */}
        {albums.length === 0 && Array.from({ length: 8 }, (_, i) => (
          <div key={i} aria-hidden="true" className="min-w-0">
            <div className="aspect-square rounded-lg bg-surface-raised animate-pulse mb-1.5" />
            <div className="h-3 w-3/4 rounded bg-surface-raised animate-pulse" />
          </div>
        ))}
        {albums.map((a) => (
          <div key={a.key} className="group text-left min-w-0">
            <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-raised mb-1.5">
              <button onClick={a.open} aria-label={a.title} className="absolute inset-0 flex items-center justify-center">
                {a.cover ? (
                  <img src={a.cover} alt={a.title} className="w-full h-full object-cover" />
                ) : (
                  <Music size={20} className="text-text-muted" />
                )}
              </button>
              <span className="pointer-events-none absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity" />
              <button
                onClick={a.play}
                aria-label={`Play ${a.title}`}
                className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full bg-accent text-black flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100 transition-all"
              >
                <Play size={13} className="ml-0.5" fill="currentColor" />
              </button>
            </div>
            <button onClick={a.open} className="block w-full text-left">
              <p className="text-text-primary text-xs leading-snug truncate group-hover:text-accent transition-colors">{a.title}</p>
              <p className="text-text-muted text-[11px] truncate mt-0.5">{a.subtitle}</p>
            </button>
          </div>
        ))}
      </CoverStrip>
    </Tile>
  )
}

// ─── Row A side: the one tile that scrolls ───────────────────────────────────

function NewsTile({ items, onOpen, onContextMenu, onAll, span }: {
  items: NewsItem[]
  onOpen: (item: NewsItem) => void
  onContextMenu: (item: NewsItem, e: React.MouseEvent) => void
  onAll: () => void
  span: string
}): JSX.Element {
  return (
    <Tile title="News" icon={<Newspaper size={15} />} action={{ label: 'All', onClick: onAll }} span={span}>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1 space-y-1">
        {items.slice(0, MAX_NEWS).map((item) => (
          <button
            key={item.id}
            onClick={() => onOpen(item)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(item, e) }}
            className="group w-full flex items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-[var(--surface-raised)] transition-colors"
          >
            <span className="w-12 h-12 shrink-0 rounded-md overflow-hidden bg-surface-raised flex items-center justify-center">
              {item.image_url
                ? <ProgressiveCover src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                : <Newspaper size={16} className="text-text-muted" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-text-primary text-xs leading-snug line-clamp-2 group-hover:text-accent transition-colors">{item.title}</span>
              {item.category && <span className="block text-text-muted text-[11px] truncate mt-0.5">{item.category}</span>}
            </span>
          </button>
        ))}
      </div>
    </Tile>
  )
}

// ─── Row B side + row C: the compact shortcut tiles ──────────────────────────

function ShortcutCard({ icon, title, subtitle, tone = 'accent', progress = null, onClick }: {
  icon: JSX.Element
  title: React.ReactNode
  subtitle: React.ReactNode
  tone?: 'accent' | 'live'
  /** 0-1: a thin bar along the card's foot (Sync's progress). */
  progress?: number | null
  onClick: () => void
}): JSX.Element {
  return (
    <button
      data-swap
      onClick={onClick}
      className="group relative overflow-hidden shrink-0 w-full flex items-center gap-3 rounded-xl glass-pane glass-press px-3.5 py-3 text-left"
    >
      {progress !== null && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-accent/15">
          <span
            className="block h-full bg-accent origin-left transition-transform duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress})` }}
          />
        </span>
      )}
      <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tone === 'live' ? 'bg-red-600/15' : 'bg-accent/15'}`}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 text-text-primary text-sm font-semibold">{title}</span>
        <span className="block text-text-muted text-xs truncate mt-0.5">{subtitle}</span>
      </span>
      <ChevronRight size={15} className="text-text-muted shrink-0 group-hover:text-text-primary transition-colors" />
    </button>
  )
}

function GamesCard({ games, onOpen }: {
  games: GameCard[]
  onOpen: (view: GameCard['view']) => void
}): JSX.Element {
  return (
    <div data-swap className="w-full flex items-stretch gap-1.5 rounded-xl glass-pane px-2 py-2.5">
      {games.map((g) => (
        <button
          key={g.view}
          onClick={() => onOpen(g.view)}
          title={g.label}
          className="group flex-1 min-w-0 flex flex-col items-center gap-1 rounded-lg py-1 hover:bg-[var(--fill)] transition-colors"
        >
          <span className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Gamepad2 size={16} className="text-accent" />
          </span>
          <span className="text-text-primary text-[11px] font-semibold leading-tight truncate max-w-full">{g.label}</span>
          {g.kind === 'daily' ? (
            <span className="flex items-center gap-1 text-[10px] text-text-muted">
              <Flame size={10} className={g.streak > 0 ? 'text-accent' : ''} />
              <span className="tabular-nums">{g.streak}</span>
            </span>
          ) : (
            <span className="text-[10px] text-text-muted truncate max-w-full">{g.sub}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Main column foot: Tools ─────────────────────────────────────────────────

// Shortcuts into the app's tool dialogs. Cards keep a readable width and wrap
// onto more rows as tools are added, rather than stretching one across the page.
// The title sits beside the cards rather than above them: Tools is the last
// row of the bento, and a header line of its own pushed it past the window.
function ToolsTile({ children, span }: { children: React.ReactNode; span: string }): JSX.Element {
  return (
    <Tile span={span}>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Wrench size={15} className="text-text-muted" />
          <h2 className="text-text-primary text-sm font-bold uppercase tracking-wider">Tools</h2>
        </div>
        <div className="flex-1 min-w-0 grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {children}
        </div>
      </div>
    </Tile>
  )
}

export default function HomeView(): JSX.Element {
  const {
    account, likedTrackIds, radioFmIsLive, radioFmNowPlaying, setActiveView,
    showSection, recent, newsItems, games, playlistRow, albumRow, albumsPending,
    openTrack, openNewsItem, openRadioFm,
  } = useHomeData()
  const { playTrack, playNext } = useStorePick('playTrack', 'playNext')
  const canEdit = useCanEdit()
  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)
  const [playlistMenu, setPlaylistMenu] = useState<PlaylistContextMenuState | null>(null)
  const [newsMenu, setNewsMenu] = useState<NewsMenuState | null>(null)
  const [sharingNews, setSharingNews] = useState<NewsItem | null>(null)
  const [mainRef, { width: mainWidth }] = useElementSize<HTMLDivElement>()

  const showRecent = showSection('recent') && recent.length > 0
  const showOnThisDay = showSection('onthisday')
  const showNews = showSection('news') && newsItems.length > 0
  const showPlaylists = showSection('playlists')
  const showAlbums = HOME_ALBUMS_SHOWN && showSection('albums') && (albumRow.length > 0 || albumsPending)
  const showRadio = showSection('radio')
  const showLiked = showSection('liked') && likedTrackIds.length > 0
  const showGames = showSection('games')
  const showChat = showSection('chat') && hasChatAccess(account)
  const showTools = showSection('tools')

  const mainShown = showRecent || showOnThisDay || showPlaylists || showAlbums || showTools
  const sideShown = showChat || showNews || showRadio || showLiked || showGames
  const mainSections = ([
    showRecent && 'recent',
    showOnThisDay && 'onthisday',
    showPlaylists && 'playlists',
    showAlbums && 'albums',
    showTools && 'tools',
  ] as const).filter((s): s is MainSection => !!s)
  const spans = bentoSpans(mainSections, mainWidth >= BENTO_MIN_WIDTH)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto glass-scroll pb-player">
      <div className="h-full min-h-[600px] w-full px-6 py-5 flex flex-col gap-4">
        {/* Shared with the staff dashboards, so it stays put while the
            widgets swipe between them. */}
        <HomeHero on="home" />

        {/* ── Main: recently played, on this day, playlists, albums, tools as a bento ──
            ── Side rail: news, 999 FM, liked, games - compact, narrow ── */}
        {(mainShown || sideShown) && (
          <div className="flex-1 min-h-0 flex gap-7">
            {mainShown && (
              <div className="flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar -mx-6 px-6 -mt-4 pt-4 -mb-5 pb-5 md:-mb-16 md:pb-16">
              {/* A scroller clips its children's shadows at its edge, which drew a
                  hard seam where each gap between tiles met the column's side.
                  The padding gives the tiles' glass shadow room inside, and the
                  matching negative margin keeps the layout where it was. On md+
                  the bottom room reaches past the shadow (12px + 36px blur) into
                  the page's space under the player bar; 20px cut it off in a
                  line beside the bar.
                  The grid sits inside the scroller, not on it: a grid of definite
                  height squeezes its auto rows to fit, and tiles then scroll inside. */}
              <div ref={mainRef} className="grid grid-cols-12 gap-4">
                {showRecent && (
                  <RecentTile
                    tracks={recent}
                    onPlay={openTrack}
                    onContextMenu={(track, e) => setCtxMenu({ track, songId: userApi.trackIdToSongId(track.id), x: e.clientX, y: e.clientY })}
                    span={spans.recent ?? 'col-span-12'}
                  />
                )}
                {showOnThisDay && (
                  <OnThisDayTile
                    onContextMenu={(track, e) => setCtxMenu({ track, songId: userApi.trackIdToSongId(track.id), x: e.clientX, y: e.clientY })}
                    span={spans.onthisday ?? 'col-span-12'}
                  />
                )}
                {showPlaylists && (
                  <PlaylistsTile
                    playlists={playlistRow}
                    onAll={() => setActiveView('playlists')}
                    onContextMenu={(p, e) => { if (p.playlist) setPlaylistMenu({ playlist: p.playlist, x: e.clientX, y: e.clientY }) }}
                    span={spans.playlists ?? 'col-span-12'}
                  />
                )}
                {showAlbums && (
                  <AlbumsTile
                    albums={albumRow}
                    onAll={() => setActiveView('albums')}
                    span={spans.albums ?? 'col-span-12'}
                  />
                )}
                {showTools && (
                  <ToolsTile span={spans.tools ?? 'col-span-12'}>
                    <ShortcutCard
                      icon={<MicVocal size={18} className="text-accent" />}
                      title="Synced lyrics"
                      subtitle="Time a song's lyrics by the line or the word"
                      onClick={() => useStore.getState().openLyricsGen()}
                    />
                    <ShortcutCard
                      icon={<AudioLines size={18} className="text-accent" />}
                      title="Identify song"
                      subtitle="Name a song from the mic, this PC or a file"
                      onClick={() => useStore.getState().setShowRecognition(true)}
                    />
                    <ShortcutCard
                      icon={<ImagePlus size={18} className="text-accent" />}
                      title="Submit cover art"
                      subtitle="Send in better art for any song"
                      onClick={() => useStore.getState().openCoverArtSubmit()}
                    />
                    <ShortcutCard
                      icon={<FileAudio size={18} className="text-accent" />}
                      title="Submit a remix or edit"
                      subtitle="Share your remix or stem edit in Files"
                      onClick={() => useStore.getState().openCommunityEditSubmit()}
                    />
                  </ToolsTile>
                )}
              </div>
              </div>
            )}

            {sideShown && (
              <div className="w-[300px] shrink-0 min-h-0 flex flex-col gap-3">
                {showChat && <HomeChatCard variant="desktop" />}
                {showNews && (
                  <NewsTile
                    items={newsItems}
                    onOpen={openNewsItem}
                    onContextMenu={(item, e) => setNewsMenu({ item, x: e.clientX, y: e.clientY })}
                    onAll={() => setActiveView('news')}
                    span="flex-1 min-h-0"
                  />
                )}
                {showRadio && (
                  <ShortcutCard
                    tone={radioFmIsLive ? 'live' : 'accent'}
                    icon={<Radio size={18} className={radioFmIsLive ? 'text-red-500 animate-pulse' : 'text-accent'} />}
                    title={
                      <>
                        999 FM
                        {radioFmIsLive && <span className="text-red-500 text-[10px] font-bold uppercase tracking-widest">Live</span>}
                      </>
                    }
                    subtitle={
                      radioFmIsLive && radioFmNowPlaying
                        ? `${radioFmNowPlaying.title} - ${radioFmNowPlaying.artist}`
                        : 'Juice WRLD radio, live 24/7'
                    }
                    onClick={openRadioFm}
                  />
                )}
                {showLiked && (
                  <ShortcutCard
                    icon={<Heart size={18} className="text-accent" fill="currentColor" />}
                    title="Liked songs"
                    subtitle={`${likedTrackIds.length} song${likedTrackIds.length === 1 ? '' : 's'}`}
                    onClick={() => setActiveView('liked')}
                  />
                )}
                {showGames && (
                  <GamesCard games={games} onOpen={(view) => setActiveView(view)} />
                )}
              </div>
            )}
          </div>
        )}

        {!mainShown && !sideShown && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Music2 size={34} className="text-text-muted mb-3" />
            <p className="text-text-primary text-sm font-semibold mb-1">Nothing to show</p>
            <p className="text-text-muted text-xs max-w-xs leading-relaxed">
              Every Home section is switched off. Turn some back on in
              Settings → Appearance → Home screen.
            </p>
          </div>
        )}
      </div>

      {ctxMenu && (
        <SongContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          canEdit={canEdit}
          onInfo={() => ctxMenu.songId != null && useStore.getState().setInfoSongId(ctxMenu.songId)}
          onPlay={() => playTrack(ctxMenu.track)}
          onPlayNext={() => playNext(ctxMenu.track)}
        />
      )}
      {playlistMenu && (
        <PlaylistContextMenu state={playlistMenu} onClose={() => setPlaylistMenu(null)} />
      )}
      {newsMenu && (
        <NewsContextMenu
          state={newsMenu}
          onClose={() => setNewsMenu(null)}
          onOpen={() => openNewsItem(newsMenu.item)}
          onShare={hasChatAccess(account) ? () => setSharingNews(newsMenu.item) : undefined}
        />
      )}
      {sharingNews && <ShareNewsModal item={sharingNews} onClose={() => setSharingNews(null)} />}
    </div>
  )
}
