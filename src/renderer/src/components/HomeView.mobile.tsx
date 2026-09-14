import { ChevronRight, MoreHorizontal, Play, ListMusic, Gamepad2, Flame, Music2, Disc3, User, Newspaper, Radio } from 'lucide-react'
import { useStore } from '../store/useStore'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { useHomeData } from '../hooks/useHomeData'

// The mobile landing screen. All of its data comes from useHomeData, which the
// desktop shell shares — this file is layout only: a stack of horizontally
// scrolling rails sized for a phone.

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

function Section({ title, icon, action, children }: {
  title: string
  icon: JSX.Element
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 px-4 mb-2.5">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-text-primary text-[15px] font-bold flex-1 min-w-0 truncate">{title}</h2>
        {action && (
          <button onClick={action.onClick} className="flex items-center gap-0.5 text-text-muted text-xs font-medium active:text-text-primary shrink-0">
            {action.label}<ChevronRight size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function StatCard({ value, label, onClick }: { value: string; label: string; onClick?: () => void }): JSX.Element {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className="flex-1 min-w-0 rounded-xl bg-[var(--surface-overlay)] px-3 py-2.5 text-left active:bg-surface-highest transition-colors"
    >
      <p className="text-text-primary text-lg font-bold tabular-nums truncate">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted truncate">{label}</p>
    </Tag>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="px-4 text-text-muted text-xs">{children}</p>
}

export default function HomeViewMobile(): JSX.Element {
  const {
    account, likedTrackIds, radioFmIsLive, radioFmNowPlaying, setActiveView,
    openProfile, showSection, recent, newsItems, games, playlistRow,
    totalPlays, distinctSongs, weekPlays, siteStats, openTrack, openNewsItem, openRadioFm,
  } = useHomeData()
  // Whatever doesn't fit the bottom nav directly — its old in-bar "More" tab
  // moved here, since fitting it AND a Home tab both in the bar pushed the
  // cap down by one more real destination. Mobile-only, so it stays here
  // rather than in the shared hook.
  const { moreTabs } = useMobileNavSplit()
  const setShowMoreNav = useStore((s) => s.setShowMoreNav)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-4">
      <div className="flex items-center gap-2 px-4 pb-4">
        <button
          onClick={openProfile}
          aria-label="Profile"
          className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-[var(--surface-overlay)] flex items-center justify-center text-text-muted active:bg-surface-highest transition-colors"
        >
          {account?.discord_avatar
            ? <img src={account.discord_avatar} alt="" className="w-full h-full object-cover" />
            : <User size={17} />}
        </button>
        <h1 className="flex-1 min-w-0 text-text-primary text-[26px] font-bold leading-tight">Home</h1>
        {moreTabs.length > 0 && (
          <button
            onClick={() => setShowMoreNav(true)}
            aria-label="More"
            className="w-9 h-9 shrink-0 rounded-full bg-[var(--surface-overlay)] flex items-center justify-center text-text-primary active:bg-surface-highest transition-colors"
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </div>

      {showSection('recent') && recent.length > 0 && (
        <Section title="Recently played" icon={<Disc3 size={15} />}>
          <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
            {recent.map((track) => (
              <button
                key={track.id}
                onClick={() => openTrack(track)}
                className="w-[116px] shrink-0 text-left active:opacity-70 transition-opacity"
              >
                <div className="relative w-[116px] h-[116px] rounded-xl overflow-hidden bg-surface-overlay mb-1.5">
                  <AlbumArtThumbnail track={track} fill className="w-full h-full object-cover" />
                  <span className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-black/65 flex items-center justify-center">
                    <Play size={13} className="text-white ml-0.5" fill="currentColor" />
                  </span>
                </div>
                <p className="text-text-primary text-xs leading-snug truncate">{track.title}</p>
                <p className="text-text-muted text-[11px] truncate mt-0.5">{track.artist}</p>
              </button>
            ))}
          </div>
        </Section>
      )}

      {showSection('news') && newsItems.length > 0 && (
        <Section
          title="News"
          icon={<Newspaper size={15} />}
          action={{ label: 'All', onClick: () => setActiveView('news') }}
        >
          <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
            {newsItems.slice(0, 8).map((item) => (
              <button
                key={item.id}
                onClick={() => openNewsItem(item)}
                className="w-[200px] shrink-0 text-left active:opacity-70 transition-opacity"
              >
                <div className="w-[200px] h-[112px] rounded-xl overflow-hidden bg-surface-overlay mb-1.5 flex items-center justify-center">
                  {item.image_url
                    ? <ProgressiveCover src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                    : <Newspaper size={26} className="text-text-muted" />}
                </div>
                <p className="text-text-primary text-xs leading-snug line-clamp-2">{item.title}</p>
                {item.category && <p className="text-text-muted text-[11px] truncate mt-0.5">{item.category}</p>}
              </button>
            ))}
          </div>
        </Section>
      )}

      {showSection('playlists') && (
        <Section
          title="Playlists"
          icon={<ListMusic size={15} />}
          action={{ label: 'All', onClick: () => setActiveView('playlists') }}
        >
          {playlistRow.length === 0 ? (
            <EmptyNote>No playlists yet — build one from any song&apos;s menu.</EmptyNote>
          ) : (
            <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
              {playlistRow.map((p) => (
                <button key={p.key} onClick={p.open} className="w-[116px] shrink-0 text-left active:opacity-70 transition-opacity">
                  <div className="w-[116px] h-[116px] rounded-xl overflow-hidden bg-surface-overlay mb-1.5 flex items-center justify-center">
                    <PlaylistCoverThumb cover={p.cover} mosaic={p.mosaic} alt={p.name} />
                  </div>
                  <p className="text-text-primary text-xs leading-snug truncate">{p.name}</p>
                  <p className="text-text-muted text-[11px] truncate mt-0.5">{p.subtitle}</p>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {showSection('games') && (
        <Section title="Games" icon={<Gamepad2 size={15} />}>
          <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
            {games.map((g) => (
              <button
                key={g.view}
                onClick={() => setActiveView(g.view)}
                className="w-[140px] shrink-0 rounded-xl bg-[var(--surface-overlay)] px-3.5 py-3 text-left active:bg-surface-highest transition-colors"
              >
                <p className="text-text-primary text-sm font-semibold truncate">{g.label}</p>
                {g.kind === 'daily' ? (
                  <>
                    <div className="flex items-center gap-1 mt-1 text-text-muted">
                      <Flame size={12} className={g.streak > 0 ? 'text-accent' : ''} />
                      <span className="text-[11px] tabular-nums">{g.streak} day streak</span>
                    </div>
                    <p className={`text-[11px] mt-1.5 font-medium ${g.done ? 'text-accent' : 'text-text-muted'}`}>
                      {g.done ? 'Played today' : 'Not played today'}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] mt-1.5 text-text-muted">{g.sub}</p>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}

      {showSection('radio') && (
        <button
          onClick={openRadioFm}
          className="mx-4 mb-6 w-[calc(100%-2rem)] flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-3.5 py-3 active:bg-surface-highest transition-colors"
        >
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${radioFmIsLive ? 'bg-red-600/15' : 'bg-accent/15'}`}>
            <Radio size={17} className={radioFmIsLive ? 'text-red-500 animate-pulse' : 'text-accent'} />
          </span>
          <span className="flex-1 min-w-0 text-left">
            <span className="flex items-center gap-1.5">
              <span className="text-text-primary text-sm font-semibold">999 FM</span>
              {radioFmIsLive && <span className="text-red-500 text-[10px] font-bold uppercase tracking-widest">Live</span>}
            </span>
            <span className="block text-text-muted text-xs truncate">
              {radioFmIsLive && radioFmNowPlaying
                ? `${radioFmNowPlaying.title} — ${radioFmNowPlaying.artist}`
                : 'Juice WRLD radio, live 24/7'}
            </span>
          </span>
          <ChevronRight size={16} className="text-text-muted shrink-0" />
        </button>
      )}

      {showSection('listening') && (
        <Section
          title="Your listening"
          icon={<Music2 size={15} />}
          action={{ label: 'Wrapped', onClick: () => setActiveView('stats') }}
        >
          {totalPlays === 0 ? (
            <EmptyNote>Play something and your stats will show up here.</EmptyNote>
          ) : (
            <div className="px-4 flex gap-3">
              <StatCard value={totalPlays.toLocaleString()} label="Plays" />
              <StatCard value={distinctSongs.toLocaleString()} label="Songs" />
              <StatCard value={weekPlays.toLocaleString()} label="This week" />
            </div>
          )}
          {siteStats && (
            <div className="px-4 pt-3">
              <StatCard
                value={siteStats.total_songs.toLocaleString()}
                label="In the catalog"
                onClick={() => setActiveView('statistics')}
              />
            </div>
          )}
        </Section>
      )}

      {showSection('liked') && likedTrackIds.length > 0 && (
        <button
          onClick={() => setActiveView('liked')}
          className="mx-4 w-[calc(100%-2rem)] flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-3.5 py-3 active:bg-surface-highest transition-colors"
        >
          <span className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Music2 size={17} className="text-accent" />
          </span>
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-text-primary text-sm font-semibold">Liked songs</span>
            <span className="block text-text-muted text-xs">{likedTrackIds.length} song{likedTrackIds.length === 1 ? '' : 's'}</span>
          </span>
          <ChevronRight size={16} className="text-text-muted shrink-0" />
        </button>
      )}
    </div>
  )
}
