import { useEffect, Suspense } from 'react'
import { useStore, useStorePick } from './store/useStore'
import { setToken, getToken } from './lib/userApi'
import { useThemeEffects } from './lib/themeEffects'
import { runWhenIdle, isStandalonePWA } from './lib/platform'
import { applySeo } from './lib/seo'
import { orderedNavItems, isNavItemVisible } from './lib/navItems'
import { loadSessionEditLinks } from './lib/sessionEditsApi'
import { useIsMobile, isMobileViewport } from './hooks/useIsMobile'
import ViewSkeleton from './components/ViewSkeleton'
import { ViewType } from './types'
import { ADMIN_PATH_TABS } from './hooks/useAdminQueue'

// Minimum gap between window-focus-triggered refetches (playlists, news) -
// alt-tabbing back and forth shouldn't refire a request on every focus event.
const FOCUS_REFRESH_MIN_INTERVAL_MS = 60 * 1000

function getViewFromPath(pathname: string): ViewType {
  if (pathname === '/home') return 'home'
  // Desktop and installed apps land on Home; a mobile browser tab still gets
  // the Tracker. `/` is the canonical, indexed URL for the catalog
  // (lib/seo.ts) and Google crawls mobile-first, so a phone-width crawler
  // keeps seeing the catalog there rather than a personal dashboard -
  // applySeo also pins `/`'s metadata to the catalog entry regardless of
  // which view renders, so the root can never go noindex.
  if (pathname === '/') return isStandalonePWA() || !isMobileViewport() ? 'home' : 'api-tracker'
  if (pathname === '/tracker') return 'api-tracker'
  if (pathname.startsWith('/files')) return 'api-files'
  if (pathname === '/editor') return 'editor'
  if (pathname === '/contributor') return 'contributor'
  // '/admin' plus one path per admin section (see ADMIN_TAB_PATHS) - all of
  // them land on the same standalone admin console, just pre-selecting a
  // different tab; see the syncFromPath effect below for the tab half of it.
  if (pathname === '/admin' || pathname in ADMIN_PATH_TABS) return 'admin'
  if (pathname === '/editor-profile') return 'editor-profile'
  if (pathname === '/contributor-profile') return 'contributor-profile'
  if (pathname === '/albums-admin') return 'albums-admin'
  if (pathname === '/liked') return 'liked'
  if (pathname === '/playlists') return 'playlists'
  if (pathname === '/docs') return 'docs'
  if (pathname === '/wrld') return 'wrld'
  if (pathname === '/news' || pathname.startsWith('/news/')) return 'news'
  if (pathname === '/heardle') return 'heardle'
  if (pathname === '/wordle') return 'wordle'
  if (pathname === '/tierlist') return 'tierlist'
  if (pathname === '/wrapped') return 'stats'
  if (pathname === '/statistics') return 'statistics'
  if (pathname === '/download') return 'download'
  if (pathname === '/thank-you') return 'thanks'
  if (pathname === '/settings') return 'settings'
  if (pathname.startsWith('/shared/')) return 'shared-playlist'
  if (pathname === '/auth/discord/callback') return 'api-tracker'
  return 'not-found'
}

import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import ApiTrackerView from './components/ApiTrackerView'
import RadioFmPlayer from './components/RadioFmPlayer'
import RadioVotePopup from './components/RadioVotePopup'
import LastfmScrobbler from './components/LastfmScrobbler'
import NewsNotifier from './components/NewsNotifier'
import UserAuthModal from './components/UserAuthModal'
import ReportModal from './components/ReportModal'
import BulkEditModal from './components/BulkEditModal'
import InstallPrompt from './components/InstallPrompt'
import CookieNotice from './components/CookieNotice'
import DonationNotice from './components/DonationNotice'
import { GlobalSongInfoHost } from './components/SongInfoModal'
import Player from './components/Player'
import NowPlaying from './components/NowPlaying'
import QueuePanel from './components/QueuePanel'
import UploadManager from './components/UploadManager'
import ErrorBoundary from './components/ErrorBoundary'
import SandboxNotch from './components/SandboxNotch'
import MoreNavSheet from './components/MoreNavSheet'

// Everything off the startup path loads on first navigation instead of
// inflating the initial bundle - including Playlists and Files, which are big
// enough (~5.8k and ~2.6k lines across their desktop/mobile halves) that
// shipping them to every visitor of the Tracker landing page was most of the
// eager bundle. Definitions live in lib/lazyViews so the nav chrome can warm a
// chunk on hover/tap without importing this file; preloadView is the warmer.
import {
  EditorPage, AdminPage, SharedPlaylistView, EditorProfileView, NotFoundView,
  DocsPage, WrldView, NewsView, HeardleView, WordleView, TierlistView,
  StatsView, StatisticsView, DownloadAppView, ThankYouView, AlbumsAdminView, ContributorPage,
  ContributorProfileView, HomeView, Settings, PlaylistsView, ApiFilesView,
  LikedSongsView, DiagnosticsModal, preloadView,
} from './lib/lazyViews'

export default function App(): JSX.Element {
  const { showNowPlaying, showQueue, showDiagnostics, setShowDiagnostics, showUploadManager, setShowUploadManager, activeView, previousView, sidebarPosition, loadAccount, completeDiscordLogin, showUserAuth, setShowUserAuth, prefetchApiData, refreshPlaylists, heroBleedTop, navOrder, navVisibility, activeChannel } = useStorePick(
    'showNowPlaying', 'showQueue', 'showDiagnostics', 'setShowDiagnostics', 'showUploadManager', 'setShowUploadManager', 'activeView', 'previousView', 'sidebarPosition', 'loadAccount', 'completeDiscordLogin', 'showUserAuth', 'setShowUserAuth', 'prefetchApiData', 'refreshPlaylists', 'heroBleedTop', 'navOrder', 'navVisibility', 'activeChannel')
  // What renders behind WRLD - WRLD is a full-screen overlay on top of
  // wherever you were (Spotify-style "now playing" sheet), not a real nav
  // destination, so dragging it down should reveal that page like a curtain
  // instead of empty space. Everywhere else this is just activeView itself.
  const bgView = activeView === 'wrld' ? (previousView ?? 'api-tracker') : activeView
  const isMobile = useIsMobile()
  useThemeEffects()
  // Seed auth token from env in local dev only - import.meta.env.DEV is false in production
  // builds, so this never runs for real users even if the token is baked into the bundle.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const devToken = import.meta.env.VITE_AUTH_TOKEN as string | undefined
    if (devToken) { setToken(devToken); loadAccount() }
  }, [])

  useEffect(() => { loadSessionEditLinks(activeChannel).catch(() => {}) }, [activeChannel])

  // Sync view from URL on mount + handle back/forward
  useEffect(() => {
    const syncFromPath = (state?: unknown): void => {
      // The embedded admin panel inside the editor/manager profile pushes
      // its own history entries (see EditorProfileView's openAdmin/exitAdmin)
      // tagged `{ view: 'editor-profile' }` so its section deep links (e.g.
      // /users) have a real, shareable URL without actually leaving that
      // page - activeView never changed to 'admin' when those were pushed,
      // so a back/forward through them must not reroute here either; that
      // component's own popstate listener handles resyncing its embedded
      // panel instead.
      if (state && typeof state === 'object' && (state as { view?: string }).view === 'editor-profile') return
      const view = getViewFromPath(window.location.pathname)
      useStore.setState({ activeView: view })
      // Playlists keeps its open playlist selected across tab switches (it
      // doesn't unmount cleanly otherwise), so a mount-time read of ?id=
      // alone can't catch a bare back/forward navigation while already on
      // the tab - resync it here too, same as the view itself.
      if (window.location.pathname === '/playlists') {
        const id = new URLSearchParams(window.location.search).get('id')
        useStore.setState({ playlistsSelectedId: id ? Number(id) : null })
      }
      // Same idea for Admin's own per-section deep links (/users, /security,
      // ...) - land on the section the URL names, or the base queue for
      // plain /admin and for a back/forward hop that leaves the console
      // entirely (activeAdminTab only matters while view === 'admin').
      if (view === 'admin') {
        useStore.setState({ activeAdminTab: ADMIN_PATH_TABS[window.location.pathname] ?? null })
      }
    }
    syncFromPath()
    const onPopState = (e: PopStateEvent): void => syncFromPath(e.state)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Give each route its own title/description/canonical. Web only - no-op in
  // the desktop app, including electron:dev (see lib/seo.ts).
  useEffect(() => { applySeo(activeView) }, [activeView])

  // Complete Discord OAuth redirect, then load the public account
  useEffect(() => {
    if (window.location.pathname === '/auth/discord/callback') {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const state = params.get('state')
      const finish = (): void => {
        window.history.replaceState({}, '', '/tracker')
        useStore.setState({ activeView: 'api-tracker' })
      }
      if (code && state) {
        completeDiscordLogin(code, state).catch(() => undefined).finally(finish)
      } else {
        finish()
      }
      return
    }
    loadAccount()
  }, [loadAccount, completeDiscordLogin])

  // Re-fetch playlists on window focus - playlist edits made elsewhere (the
  // web player, another device, or a playlist saved from a shared link) don't
  // otherwise reach this window until it's restarted. refreshPlaylists() is a
  // no-op while signed out. Throttled so alt-tabbing back and forth doesn't
  // refire the request on every focus - only refetch if it's actually been a
  // while since the last one.
  useEffect(() => {
    let lastRun = 0
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastRun < FOCUS_REFRESH_MIN_INTERVAL_MS) return
      lastRun = now
      refreshPlaylists()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshPlaylists])

  // Warm the Tracker/Files offline cache on startup (public data - no auth
  // needed), so those views are ready before the user first opens them.
  // Deferred to idle: none of it is needed to paint, and running it in the
  // mount commit put four requests in front of the ones the visible view was
  // making at that same moment. Overlap with those is still free - apiRequest
  // dedupes identical in-flight GETs.
  useEffect(() => runWhenIdle(() => { prefetchApiData() }), [prefetchApiData])

  // Warm the chunks for the nav destinations the user can actually reach, so
  // switching tabs doesn't wait on a download. Scheduled at a longer idle
  // timeout than the data prefetch above so it queues behind it - a chunk for
  // a view nobody has asked for yet must never get in front of the requests
  // the visible view is making right now.
  //
  // Driven by the user's own menu (order + show/hide), not a fixed list: a
  // tab they've hidden isn't somewhere they navigate, so downloading it would
  // be pure waste. Capped, and skipped entirely on Data Saver / 2G - see
  // preloadView. The active view is already loaded by definition.
  useEffect(() => runWhenIdle(() => {
    orderedNavItems(navOrder)
      .filter((i) => isNavItemVisible(i, navVisibility, false) && i.view !== activeView)
      .slice(0, 4)
      .forEach((i) => preloadView(i.view))
  }, 4000), [navOrder, navVisibility, activeView])

  // Deliver any reports queued in a previous session. loadAccount also flushes
  // after login (to attach the token), but this covers a signed-out user whose
  // loadAccount returns early. No-op until the reporting endpoints exist.
  useEffect(() => { useStore.getState()._flushReports() }, [])

  return (
    <div className="app-shell flex flex-col bg-surface overflow-hidden">
      {/* Sidebar stays first in the DOM; reverse variants place it visually
          on the right/bottom without reordering focus/tab order. */}
      <div className={`flex flex-1 overflow-hidden ${
        sidebarPosition === 'right' ? 'flex-row-reverse'
          : sidebarPosition === 'top' ? 'flex-col'
          : sidebarPosition === 'bottom' ? 'flex-col-reverse'
          : 'flex-row'
      }`}>
        <Sidebar />
        <main
          className="flex-1 overflow-hidden flex flex-col relative"
          // Reserve the phone status-bar inset by default; a mobile view that
          // wants a hero image to bleed full-bleed behind its own header
          // (Playlists' detail screens) raises heroBleedTop and paints that
          // strip itself instead - see the store field's doc comment.
          //
          // Deliberately NOT conditioned on `activeView === 'wrld'`: bgView
          // (below) stays mounted and visible the whole time WRLD is open -
          // through the curtain-drag reveal, and permanently once WRLD closes
          // - so it needs this padding applied consistently regardless of
          // WRLD's state, or it visibly "nudges" into place the instant WRLD
          // finishes closing and this padding would otherwise reappear. WRLD
          // still gets its own full-bleed for free - its overlay below is
          // absolutely positioned, and an absolutely positioned element's
          // offsets resolve against the containing block's padding edge,
          // which sits before (outside) this padding, so no compensation is
          // needed there.
          // Mobile's nav bar is bottom-only (no per-platform top option any
          // more - see BottomNav), so on mobile this only ever depends on
          // heroBleedTop. sidebarPosition still gates it on desktop, where
          // Sidebar itself can sit at the top and already reserves the space.
          style={(isMobile || sidebarPosition !== 'top') && !heroBleedTop
            ? { paddingTop: 'var(--top-inset)' } : undefined}
        >
          <div className="flex-1 overflow-hidden flex">
            <ErrorBoundary>
            <Suspense fallback={<ViewSkeleton />}>
            {bgView === 'home' ? <HomeView />
              : bgView === 'settings' ? <Settings />
              : bgView === 'api-tracker' ? <ApiTrackerView />
              : bgView === 'api-files' ? <ApiFilesView />
              : bgView === 'editor' ? <EditorPage />
              : bgView === 'contributor' ? <ContributorPage />
              : bgView === 'contributor-profile' ? <ContributorProfileView />
              : bgView === 'admin' ? <AdminPage />
              : bgView === 'liked' ? <LikedSongsView />
              : bgView === 'playlists' ? <PlaylistsView />
              : bgView === 'shared-playlist' ? <SharedPlaylistView />
              : bgView === 'editor-profile' ? <EditorProfileView />
              : bgView === 'docs' ? <DocsPage />
              : bgView === 'news' ? <NewsView />
              : bgView === 'heardle' ? <HeardleView />
              : bgView === 'wordle' ? <WordleView />
              : bgView === 'tierlist' ? <TierlistView />
              : bgView === 'stats' ? <StatsView />
              : bgView === 'statistics' ? <StatisticsView />
              : bgView === 'download' ? <DownloadAppView />
              : bgView === 'thanks' ? <ThankYouView />
              : bgView === 'albums-admin' ? <AlbumsAdminView />
              : bgView === 'not-found' ? <NotFoundView />
              : <ApiTrackerView />}
            </Suspense>
          </ErrorBoundary>
            {/* WRLD is a full-screen overlay on top of bgView above, not a
                slot in that ternary - so bgView (whatever you had open before)
                stays mounted and visible underneath while WRLD drags down,
                curtain-style, instead of revealing empty space. */}
            {activeView === 'wrld' && (
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <div className="absolute inset-0 z-30">
                    {/* No compensation needed for main's padding here: an
                        absolutely positioned element's offsets resolve
                        against its containing block's padding edge, which
                        sits BEFORE (outside) that padding - so `inset-0`
                        already reaches the true top of `main` regardless of
                        whatever padding-top `main` itself has. (An earlier
                        version of this added a negative top offset to
                        "compensate," which was wrong and clipped the top of
                        WRLD - including its header row - behind `main`'s
                        own overflow-hidden.) */}
                    <WrldView />
                  </div>
                </Suspense>
              </ErrorBoundary>
            )}
            {/* Desktop only - on mobile the WRLD tab is the only "now playing"
                screen (the mini player expands straight into it), so this
                would only ever be a redundant second one. Nothing on mobile
                can actually open it (its trigger button lives in the
                desktop-only bottom bar), but excluding it here is the real
                guarantee rather than relying on that. */}
            {!isMobile && showNowPlaying && activeView !== 'wrld' && <ErrorBoundary><NowPlaying /></ErrorBoundary>}
            {showQueue && activeView !== 'wrld' && <ErrorBoundary><QueuePanel /></ErrorBoundary>}
          </div>
        </main>
      </div>
      {/* Everything below is a loose sibling of the main content rather than a
          child of the pane boundary above, so an uncaught render error here
          used to unmount the entire app (a blank window). Each gets its own
          boundary: the chrome keeps a compact inline notice, the invisible
          background workers fail silently, and the modals/overlays show a
          centered, dismissible card. */}
      <ErrorBoundary fallback={<div className="h-20 shrink-0 border-t border-[var(--border)] flex items-center justify-center text-text-muted text-xs">Player crashed - reload the app to restore playback controls.</div>}>
        <Player />
      </ErrorBoundary>
      <ErrorBoundary fallback={null}><RadioFmPlayer /></ErrorBoundary>
      <ErrorBoundary fallback={null}><RadioVotePopup /></ErrorBoundary>
      <ErrorBoundary fallback={null}><LastfmScrobbler /></ErrorBoundary>
      <ErrorBoundary fallback={null}><NewsNotifier /></ErrorBoundary>
      <ErrorBoundary fallback={null}><BottomNav /></ErrorBoundary>
      <ErrorBoundary fallback={null}><MoreNavSheet /></ErrorBoundary>
      {showDiagnostics && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowDiagnostics(false)}>
          <Suspense fallback={null}><DiagnosticsModal /></Suspense>
        </ErrorBoundary>
      )}
      {showUploadManager && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowUploadManager(false)}>
          <UploadManager />
        </ErrorBoundary>
      )}
      {showUserAuth && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowUserAuth(false)}>
          <UserAuthModal onClose={() => setShowUserAuth(false)} />
        </ErrorBoundary>
      )}
      <ErrorBoundary variant="overlay"><ReportModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><BulkEditModal /></ErrorBoundary>
      <ErrorBoundary fallback={null}><InstallPrompt /></ErrorBoundary>
      <ErrorBoundary fallback={null}><CookieNotice /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DonationNotice /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><GlobalSongInfoHost /></ErrorBoundary>
      <ErrorBoundary fallback={null}><SandboxNotch /></ErrorBoundary>
    </div>
  )
}
