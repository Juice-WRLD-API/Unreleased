import { useState } from 'react'
import { ChevronRight, Play, ListMusic, Gamepad2, Flame, Music2, Disc3, User, Newspaper, Radio, Heart, Search, MoreHorizontal } from 'lucide-react'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { Tile } from './Tile'
import { useHomeData, type GameCard, type HomePlaylistCard } from '../hooks/useHomeData'
import { useElementSize } from '../hooks/useElementSize'
import { useStorePick } from '../store/useStore'
import { orderedNavItems, isNavItemVisible } from '../lib/navItems'
import type { NewsItem } from '../lib/newsApi'
import type { Track, ViewType } from '../types'

// The desktop landing screen — same sections, same data (useHomeData) and the
// same Settings → Home screen toggles as the mobile shell, laid out as a bento
// that fills the window instead of a stack that scrolls out of it.
//
// The whole point of the desktop layout is that a desktop screen can hold the
// entire dashboard at once: the view is height-bound (h-full inside App's
// fixed-height <main>). Cover grids clamp to whole rows and size to their own
// content (however many rows the actual items need, capped per section — see
// fitCount's callers) rather than stretching to fill whatever space is left —
// a card whose border runs on well past its last cover reads as broken the
// same way a half-visible row would. News, the one section where the extra
// headlines are worth keeping
// reachable, is the exception: it fills its rail and scrolls internally.
//
// Section ids map 1:1 to one place on screen, so hiding a section in Settings
// removes exactly one thing. Three move relative to mobile: News, 999 FM and
// Liked share one narrow right-hand rail (compact cards, News taking whatever
// height they leave it) rather than each claiming a full-height column of
// their own, so Recently played and Playlists — the two sections actually
// worth spending width on — get the rest of the page. "Your listening" is the
// hero's row of numbers, where it costs no vertical space of its own.

const GAP = 12          // matches gap-3 on the cover grids
const MIN_TILE = 104    // narrowest a cover may get before dropping a column
const MAX_NEWS = 20

// Whole rows only — see the header note. `width` decides how many columns
// fit; the row count then follows the content itself (capped at `maxRows`)
// rather than however much vertical space happens to be on offer, so the
// card's height always matches what's actually inside it.
function fitCount(width: number, total: number, maxRows: number): { cols: number; count: number } {
  if (width <= 0 || total === 0) return { cols: 1, count: 0 }
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const rows = Math.min(maxRows, Math.ceil(total / cols))
  return { cols, count: Math.min(total, cols * rows) }
}

function EmptyNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-text-muted text-xs">{children}</p>
}

// ─── Row A / B mains: the two clamped cover grids ────────────────────────────

function CoverGrid({ children, cols, bodyRef }: {
  children: React.ReactNode
  cols: number
  bodyRef: (node: HTMLDivElement | null) => void
}): JSX.Element {
  return (
    <div ref={bodyRef}>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  )
}

function RecentTile({ tracks, onPlay, span }: {
  tracks: Track[]
  onPlay: (track: Track) => void
  span: string
}): JSX.Element {
  const [bodyRef, { width }] = useElementSize<HTMLDivElement>()
  const { cols, count } = fitCount(width, tracks.length, 2)
  return (
    <Tile title="Recently played" icon={<Disc3 size={15} />} span={span}>
      <CoverGrid cols={cols} bodyRef={bodyRef}>
        {tracks.slice(0, count).map((track) => (
          <button key={track.id} onClick={() => onPlay(track)} className="group text-left min-w-0">
            <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-raised mb-1.5">
              <AlbumArtThumbnail track={track} fill className="w-full h-full object-cover" />
              <span className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full bg-accent text-black flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all">
                <Play size={13} className="ml-0.5" fill="currentColor" />
              </span>
            </div>
            <p className="text-text-primary text-xs leading-snug truncate group-hover:text-accent transition-colors">{track.title}</p>
            <p className="text-text-muted text-[11px] truncate mt-0.5">{track.artist}</p>
          </button>
        ))}
      </CoverGrid>
    </Tile>
  )
}

// A playlist with no cover of its own falls back to a 2×2 mosaic of its first
// four tracks' art — same fallback PlaylistsView uses — before the plain icon.
function PlaylistCoverThumb({ cover, mosaic, alt }: { cover: string | null; mosaic: string[] | null; alt: string }): JSX.Element {
  if (cover) return <ProgressiveCover src={cover} alt={alt} className="w-full h-full object-cover" />
  if (mosaic && mosaic.length >= 4) {
    return (
      <div className="grid grid-cols-2 w-full h-full" style={{ overflow: 'hidden' }}>
        {mosaic.slice(0, 4).map((url, i) => <ProgressiveCover key={i} src={url} alt="" className="w-full h-full object-cover" />)}
      </div>
    )
  }
  return <ListMusic size={26} className="text-text-muted" />
}

function PlaylistsTile({ playlists, onAll, span }: {
  playlists: HomePlaylistCard[]
  onAll: () => void
  span: string
}): JSX.Element {
  const [bodyRef, { width }] = useElementSize<HTMLDivElement>()
  // One row only — Playlists is capped at 10 items upstream (useHomeData), so
  // a lone leftover on a second row was common and looked unfinished; the
  // rest is a click away via "All".
  const { cols, count } = fitCount(width, playlists.length, 1)
  return (
    <Tile title="Playlists" icon={<ListMusic size={15} />} action={{ label: 'All', onClick: onAll }} span={span}>
      {playlists.length === 0 ? (
        <EmptyNote>No playlists yet — build one from any song&apos;s menu.</EmptyNote>
      ) : (
        <CoverGrid cols={cols} bodyRef={bodyRef}>
          {playlists.slice(0, count).map((p) => (
            <button key={p.key} onClick={p.open} className="group text-left min-w-0">
              <div className="aspect-square rounded-lg overflow-hidden bg-surface-raised mb-1.5 flex items-center justify-center">
                <PlaylistCoverThumb cover={p.cover} mosaic={p.mosaic} alt={p.name} />
              </div>
              <p className="text-text-primary text-xs leading-snug truncate group-hover:text-accent transition-colors">{p.name}</p>
              <p className="text-text-muted text-[11px] truncate mt-0.5">{p.subtitle}</p>
            </button>
          ))}
        </CoverGrid>
      )}
    </Tile>
  )
}

// ─── Row A side: the one tile that scrolls ───────────────────────────────────

function NewsTile({ items, onOpen, onAll, span }: {
  items: NewsItem[]
  onOpen: (item: NewsItem) => void
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

function ShortcutCard({ icon, title, subtitle, tone = 'accent', onClick }: {
  icon: JSX.Element
  title: React.ReactNode
  subtitle: React.ReactNode
  tone?: 'accent' | 'live'
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="group shrink-0 w-full flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3.5 py-3 text-left hover:border-[var(--accent)] hover:bg-surface-highest transition-colors"
    >
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
    <div className="w-full flex items-stretch gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-2 py-2.5">
      {games.map((g) => (
        <button
          key={g.view}
          onClick={() => onOpen(g.view)}
          title={g.label}
          className="group flex-1 min-w-0 flex flex-col items-center gap-1 rounded-lg py-1 hover:bg-surface-highest transition-colors"
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

// ─── Hero ────────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <span className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-text-primary text-base font-bold tabular-nums">{value}</span>
      <span className="text-text-muted text-xs truncate">{label}</span>
    </span>
  )
}

// Desktop counterpart to mobile Home's "More" button. Mobile's opens a sheet
// of nav tabs that don't fit the bottom bar's cap — the sidebar has no such
// cap, so there's nothing to overflow into it. This lists the destinations
// that ship off by default instead (Wrapped, News, Liked Songs, API Docs —
// see `defaultHidden` in navItems.tsx): still one click away without having
// to turn them on in Settings first, just like mobile's sheet lets you reach
// an overflowed tab without adding it to the bar.
function MoreMenu({ open, onClose, items, onSelect }: {
  open: boolean
  onClose: () => void
  items: { view: ViewType; label: string; icon: React.ReactNode }[]
  onSelect: (view: ViewType) => void
}): JSX.Element | null {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 z-20 min-w-[190px] rounded-xl border border-[var(--border)] bg-surface py-1 shadow-2xl">
        {items.length === 0 ? (
          <p className="px-3.5 py-2.5 text-xs text-text-muted whitespace-nowrap">Nothing else to show</p>
        ) : items.map((item) => (
          <button
            key={item.view}
            onClick={() => { onSelect(item.view); onClose() }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-text-primary transition-colors hover:bg-[var(--surface-overlay)]"
          >
            <span className="flex items-center justify-center text-text-muted [&_svg]:w-4 [&_svg]:h-4">{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}

export default function HomeViewDesktop(): JSX.Element {
  const {
    account, likedTrackIds, radioFmIsLive, radioFmNowPlaying, setActiveView,
    openProfile, showSection, recent, newsItems, games, playlistRow,
    totalPlays, distinctSongs, weekPlays, siteStats, openTrack, openNewsItem,
  } = useHomeData()
  const { navOrder, navVisibility } = useStorePick('navOrder', 'navVisibility')
  const [showMore, setShowMore] = useState(false)
  const hiddenNavItems = orderedNavItems(navOrder).filter(
    (i) => i.defaultHidden && !isNavItemVisible(i, navVisibility, false),
  )

  const showRecent = showSection('recent') && recent.length > 0
  const showNews = showSection('news') && newsItems.length > 0
  const showPlaylists = showSection('playlists')
  const showRadio = showSection('radio')
  const showLiked = showSection('liked') && likedTrackIds.length > 0
  const showGames = showSection('games')
  const showListening = showSection('listening')

  const mainShown = showRecent || showPlaylists
  const sideShown = showNews || showRadio || showLiked || showGames

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="h-full min-h-[600px] w-full max-w-[1800px] mx-auto px-6 py-5 flex flex-col gap-4">
        {/* ── Hero: one line, with "Your listening" folded in as numbers ── */}
        <div className="shrink-0 flex items-center gap-3.5 flex-wrap">
          <button
            onClick={openProfile}
            aria-label="Profile"
            className="w-11 h-11 shrink-0 rounded-full overflow-hidden bg-[var(--surface-overlay)] flex items-center justify-center text-text-muted hover:bg-surface-highest transition-colors"
          >
            {account?.discord_avatar
              ? <img src={account.discord_avatar} alt="" className="w-full h-full object-cover" />
              : <User size={19} />}
          </button>
          <h1 className="text-text-primary text-xl font-bold leading-tight truncate min-w-0">
            {greeting()}{account ? `, ${account.display_name}` : ''}
          </h1>
          <button
            onClick={() => setActiveView('api-tracker')}
            aria-label="Search the catalog"
            title="Search the catalog"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <Search size={17} />
          </button>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowMore((v) => !v)}
              aria-label="More"
              title="More"
              className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <MoreHorizontal size={19} />
            </button>
            <MoreMenu
              open={showMore}
              onClose={() => setShowMore(false)}
              items={hiddenNavItems}
              onSelect={setActiveView}
            />
          </div>
          {showListening && (
            <div className="ml-auto flex items-center gap-4 min-w-0">
              {totalPlays === 0 ? (
                <span className="text-text-muted text-xs truncate">Play something and your stats will show up here.</span>
              ) : (
                <>
                  <Stat value={totalPlays.toLocaleString()} label={totalPlays === 1 ? 'play' : 'plays'} />
                  <Stat value={distinctSongs.toLocaleString()} label={distinctSongs === 1 ? 'song' : 'songs'} />
                  <Stat value={weekPlays.toLocaleString()} label="this week" />
                </>
              )}
              {siteStats && (
                <>
                  <div className="w-px h-6 bg-[var(--border)] shrink-0" />
                  <Stat value={siteStats.total_songs.toLocaleString()} label="in the catalog" />
                </>
              )}
              <button
                onClick={() => setActiveView('stats')}
                className="flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-text-muted text-xs font-semibold hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0"
              >
                Wrapped<ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>

        {/* ── Main: recently played + playlists stacked, full width ──
            ── Side rail: news, 999 FM, liked, games — compact, narrow ── */}
        {(mainShown || sideShown) && (
          <div className="flex-1 min-h-0 flex gap-4">
            {mainShown && (
              <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col gap-4">
                {showRecent && <RecentTile tracks={recent} onPlay={openTrack} span="shrink-0" />}
                {showPlaylists && (
                  <PlaylistsTile playlists={playlistRow} onAll={() => setActiveView('playlists')} span="shrink-0" />
                )}
              </div>
            )}

            {sideShown && (
              <div className="w-[300px] shrink-0 min-h-0 flex flex-col gap-3">
                {showNews && (
                  <NewsTile
                    items={newsItems}
                    onOpen={openNewsItem}
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
                        ? `${radioFmNowPlaying.title} — ${radioFmNowPlaying.artist}`
                        : 'Juice WRLD radio, live 24/7'
                    }
                    onClick={() => setActiveView('wrld')}
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
    </div>
  )
}
