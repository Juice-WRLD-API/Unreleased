import { useState } from 'react'
import { ChevronRight, MoreHorizontal, Play, Flame, Heart, User, Newspaper, Radio, Music, Search, MicVocal, AudioLines, Bell, BarChart3 } from 'lucide-react'
import { useStore } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { useHomeData } from '../hooks/useHomeData'
import { useUnreadNotificationCount } from '../hooks/useNotificationHistory'
import { hasChatAccess } from '../lib/chatAccess'
import OnThisDayTile from './OnThisDayTile'
import { lazyOverlay } from '../lib/lazyView'
import { PlaylistCoverThumb } from '../lib/homeViewShared'
import { BarButton, CompactBar, LARGE_TITLE_COLLAPSE, LargeTitle, useScrolledPast } from './mobile/NavBar'
import { GroupedRow, GroupedSection } from './mobile/Grouped'

// Staff-only, and it reads the chat store - loading it lazily keeps the chat
// client out of Home's chunk for everyone else.
const HomeChatCard = lazyOverlay(() => import('./chat/HomeChatCard'))

// The mobile landing screen. All of its data comes from useHomeData, which the
// desktop shell shares - this file is layout only: Apple Music-style rails
// under a large title, with the one-off entry points (radio, liked songs,
// tools) as inset-grouped rows.

// iOS system colors for the grouped rows' icon badges.
const RED = '#ff3b30'
const PINK = '#ff2d55'
const PURPLE = '#af52de'
const BLUE = '#007aff'

/** A rail's tile width: about two and a half tiles to a phone screen, so the
 *  rail reads as scrollable. */
const TILE = 'w-[150px]'

function Section({ title, onMore, children }: {
  title: string
  /** Makes the heading itself the way in ("Title ›"), as Apple Music does. */
  onMore?: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mb-7">
      {onMore ? (
        <button onClick={onMore} className="flex items-center gap-0.5 px-4 mb-2 max-w-full active:opacity-60 transition-opacity">
          <h2 className="text-title2 text-text-primary truncate">{title}</h2>
          <ChevronRight size={22} strokeWidth={2.5} className="shrink-0 text-text-muted" />
        </button>
      ) : (
        <h2 className="px-4 mb-2 text-title2 text-text-primary truncate">{title}</h2>
      )}
      {children}
    </section>
  )
}

function Rail({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">{children}</div>
}

/** Square-art tile in a rail: artwork, then a title and a secondary line. */
function ArtTile({ onClick, art, title, subtitle, playBadge }: {
  onClick: () => void
  art: React.ReactNode
  title: string
  subtitle?: string
  playBadge?: boolean
}): JSX.Element {
  return (
    <button onClick={onClick} className={`${TILE} shrink-0 text-left active:opacity-70 transition-opacity`}>
      <div className="relative aspect-square rounded-[10px] overflow-hidden bg-[var(--fill)] mb-1.5 flex items-center justify-center">
        {art}
        {playBadge && (
          <span className="glass-button absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-text-primary">
            <Play size={13} className="ml-0.5" fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
      <p className="text-footnote text-text-primary truncate">{title}</p>
      {subtitle && <p className="text-footnote text-text-secondary truncate">{subtitle}</p>}
    </button>
  )
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className="min-w-0 px-3 py-3">
      <p className="text-title2 text-text-primary tabular-nums truncate">{value}</p>
      <p className="text-footnote text-text-secondary truncate">{label}</p>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="px-4 text-subhead text-text-muted">{children}</p>
}

export default function HomeViewMobile(): JSX.Element {
  const {
    account, likedTrackIds, radioFmIsLive, radioFmNowPlaying, setActiveView,
    openProfile, openOwnPublicProfile, showSection, recent, newsItems, games, playlistRow, albumRow,
    totalPlays, distinctSongs, weekPlays, siteStats, openTrack, openNewsItem, openRadioFm,
  } = useHomeData()
  // Whatever doesn't fit the bottom nav directly - its old in-bar "More" tab
  // moved here, since fitting it AND a Home tab both in the bar pushed the
  // cap down by one more real destination. Mobile-only, so it stays here
  // rather than in the shared hook.
  const { moreTabs } = useMobileNavSplit()
  const setShowMoreNav = useStore((s) => s.setShowMoreNav)
  const showNotifications = useStore((s) => s.showNotifications)
  const setShowNotifications = useStore((s) => s.setShowNotifications)
  const unreadNotifications = useUnreadNotificationCount()
  const setApiTrackerTab = useStore((s) => s.setApiTrackerTab)
  const setFocusApiTrackerSearch = useStore((s) => s.setFocusApiTrackerSearch)
  const openTrackerSearch = (): void => {
    setApiTrackerTab('songs')
    setFocusApiTrackerSearch(true)
    setActiveView('api-tracker')
  }

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const collapsed = useScrolledPast(scrollEl, LARGE_TITLE_COLLAPSE)

  const showLiked = showSection('liked') && likedTrackIds.length > 0
  const showTools = showSection('tools')

  return (
    <div className="relative flex-1 min-w-0 min-h-0 flex flex-col">
      <CompactBar title="Home" shown={collapsed} />
      <div ref={setScrollEl} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-dock">
        <LargeTitle
          title="Home"
          // The staff page, for accounts that have one. A link under the
          // title rather than one more button beside it: the title's line is
          // already full on a phone.
          subtitle={account && userApi.showStaffProfile(account) ? (
            <button onClick={openProfile} className="text-accent active:opacity-60 transition-opacity">
              {userApi.staffProfileLabel(account)} ›
            </button>
          ) : undefined}
          trailing={<>
            <BarButton label="Search the catalog" onClick={openTrackerSearch}>
              <Search size={20} strokeWidth={2.25} />
            </BarButton>
            {/* The notification area; on desktop it's a side-menu control. */}
            <span data-notifications-toggle className="contents">
              <BarButton
                label={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} new` : 'Notifications'}
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell size={20} strokeWidth={2.25} />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-accent text-white text-caption2 font-bold flex items-center justify-center px-1">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </BarButton>
            </span>
            {moreTabs.length > 0 && (
              <BarButton label="More" onClick={() => setShowMoreNav(true)}>
                <MoreHorizontal size={20} strokeWidth={2.25} />
              </BarButton>
            )}
            <button
              onClick={openOwnPublicProfile}
              aria-label="Your public profile"
              className="glass-button w-11 h-11 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-text-secondary active:opacity-60 transition-opacity"
            >
              {account?.avatar
                ? <img src={account.avatar} alt="" className="w-full h-full object-cover" />
                : <User size={20} />}
            </button>
          </>}
        />

        <div className="pt-3">
          {showSection('chat') && hasChatAccess(account) && <HomeChatCard variant="mobile" />}

          {showSection('recent') && recent.length > 0 && (
            <Section title="Recently Played">
              <Rail>
                {recent.map((track) => (
                  <ArtTile
                    key={track.id}
                    onClick={() => openTrack(track)}
                    art={<AlbumArtThumbnail track={track} fill res={384} className="w-full h-full object-cover" />}
                    title={track.title}
                    subtitle={track.artist}
                    playBadge
                  />
                ))}
              </Rail>
            </Section>
          )}

          {showSection('onthisday') && (
            <div className="px-4 mb-7">
              <OnThisDayTile onContextMenu={() => {}} span="shrink-0" />
            </div>
          )}

          {showSection('news') && newsItems.length > 0 && (
            <Section title="News" onMore={() => setActiveView('news')}>
              <Rail>
                {newsItems.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openNewsItem(item)}
                    className="w-[240px] shrink-0 text-left active:opacity-70 transition-opacity"
                  >
                    <div className="w-[240px] aspect-video rounded-[10px] overflow-hidden bg-[var(--fill)] mb-1.5 flex items-center justify-center">
                      {item.image_url
                        ? <ProgressiveCover src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                        : <Newspaper size={26} className="text-text-muted" />}
                    </div>
                    <p className="text-footnote text-text-primary line-clamp-2">{item.title}</p>
                    {item.category && <p className="text-footnote text-text-secondary truncate">{item.category}</p>}
                  </button>
                ))}
              </Rail>
            </Section>
          )}

          {showSection('playlists') && (
            <Section title="Playlists" onMore={() => setActiveView('playlists')}>
              {playlistRow.length === 0 ? (
                <EmptyNote>No playlists yet - build one from any song&apos;s menu.</EmptyNote>
              ) : (
                <Rail>
                  {playlistRow.map((p) => (
                    <ArtTile
                      key={p.key}
                      onClick={p.open}
                      art={<PlaylistCoverThumb cover={p.cover} mosaic={p.mosaic} alt={p.name} />}
                      title={p.name}
                      subtitle={p.subtitle}
                    />
                  ))}
                </Rail>
              )}
            </Section>
          )}

          {/* TEMP: albums hidden on the home page */}
          {false && showSection('albums') && albumRow.length > 0 && (
            <Section title="Albums" onMore={() => setActiveView('wrld')}>
              <Rail>
                {albumRow.map((a) => (
                  <ArtTile
                    key={a.key}
                    onClick={a.open}
                    art={a.cover
                      ? <img src={a.cover} alt={a.title} className="w-full h-full object-cover" />
                      : <Music size={22} className="text-text-muted" />}
                    title={a.title}
                    subtitle={a.subtitle}
                    playBadge
                  />
                ))}
              </Rail>
            </Section>
          )}

          {showSection('games') && (
            <Section title="Games">
              <Rail>
                {games.map((g) => (
                  <button
                    key={g.view}
                    onClick={() => setActiveView(g.view)}
                    className={`${TILE} shrink-0 rounded-[20px] bg-[var(--grouped)] px-4 py-3.5 text-left active:bg-[var(--fill-strong)] transition-colors`}
                  >
                    <p className="text-headline text-text-primary truncate">{g.label}</p>
                    {g.kind === 'daily' ? (
                      <>
                        <div className="flex items-center gap-1 mt-1 text-text-secondary">
                          <Flame size={13} className={g.streak > 0 ? 'text-accent' : ''} />
                          <span className="text-footnote tabular-nums">{g.streak} day streak</span>
                        </div>
                        <p className={`text-footnote mt-0.5 ${g.done ? 'text-accent font-medium' : 'text-text-muted'}`}>
                          {g.done ? 'Played today' : 'Not played today'}
                        </p>
                      </>
                    ) : (
                      <p className="text-footnote mt-1 text-text-secondary">{g.sub}</p>
                    )}
                  </button>
                ))}
              </Rail>
            </Section>
          )}

          {showSection('radio') && (
            <GroupedSection className="px-4 mb-7">
              <GroupedRow
                icon={Radio}
                iconColor={radioFmIsLive ? RED : PINK}
                label={<span className="flex items-center gap-2">
                  999 FM
                  {radioFmIsLive && <span className="px-1.5 rounded bg-[#ff3b30] text-white text-caption2 font-bold">LIVE</span>}
                </span>}
                sub={radioFmIsLive && radioFmNowPlaying
                  ? `${radioFmNowPlaying.title} - ${radioFmNowPlaying.artist}`
                  : 'Juice WRLD radio, live 24/7'}
                onClick={openRadioFm}
              />
            </GroupedSection>
          )}

          {showSection('listening') && (
            <Section title="Your Listening" onMore={() => setActiveView('stats')}>
              {totalPlays === 0 ? (
                <EmptyNote>Play something and your stats will show up here.</EmptyNote>
              ) : (
                <div className="px-4">
                  <div className="grid grid-cols-3 rounded-[20px] bg-[var(--grouped)] divide-x divide-[color:var(--separator)]">
                    <Stat value={totalPlays.toLocaleString()} label="Plays" />
                    <Stat value={distinctSongs.toLocaleString()} label="Songs" />
                    <Stat value={weekPlays.toLocaleString()} label="This week" />
                  </div>
                </div>
              )}
              {siteStats && (
                <GroupedSection className="px-4 pt-3">
                  <GroupedRow
                    icon={BarChart3}
                    iconColor={BLUE}
                    label="In the catalog"
                    detail={siteStats.total_songs.toLocaleString()}
                    onClick={() => setActiveView('statistics')}
                  />
                </GroupedSection>
              )}
            </Section>
          )}

          {(showLiked || showTools) && (
            <GroupedSection className="px-4 mb-7">
              {showLiked && (
                <GroupedRow
                  icon={Heart}
                  iconColor={PINK}
                  label="Liked Songs"
                  sub={`${likedTrackIds.length} song${likedTrackIds.length === 1 ? '' : 's'}`}
                  onClick={() => setActiveView('liked')}
                />
              )}
              {showTools && (
                <>
                <GroupedRow
                  icon={MicVocal}
                  iconColor={PURPLE}
                  label="Synced Lyrics"
                  sub="Time a song's lyrics by the line or the word"
                  onClick={() => useStore.getState().openLyricsGen()}
                />
                <GroupedRow
                  icon={AudioLines}
                  iconColor={PURPLE}
                  label="Identify Song"
                  sub="Name a song from the mic or a file"
                  onClick={() => useStore.getState().setShowRecognition(true)}
                />
                </>
              )}
            </GroupedSection>
          )}
        </div>
      </div>
    </div>
  )
}
