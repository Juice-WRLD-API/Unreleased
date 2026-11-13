import React, { useEffect, useLayoutEffect, useRef, useState, Suspense } from 'react'
import { useStore, useStorePick } from './store/useStore'
import { useCatalogSync } from './store/catalogSyncStore'
import { initCatalogSync } from './lib/catalogSync'
import { setToken, getToken } from './lib/userApi'
import { useThemeEffects } from './lib/themeEffects'
import { runWhenIdle, ELECTRON_TITLEBAR_CLEARANCE_X } from './lib/platform'
import { applySeo } from './lib/seo'
import { lazyOverlay, lazyView } from './lib/lazyView'
import { preloadAllViews } from './lib/lazyViews'
import { ViewType } from './types'
import ViewFade from './components/ViewFade'
import { captureLeaving, dashboardSwap, isWholePageSwap, reducedMotion } from './lib/dashboardSwap'
import { useWrldExpandUnder } from './lib/wrldExpand'

// Views that stay mounted (hidden) underneath the terminal so their local
// state survives opening and closing it. Only form-like views with no
// route-driven side effects - Admin pushes its own history entries and Heardle/
// Wordle play audio, so those are left to remount.
const HOLD_UNDER_TERMINAL: ViewType[] = ['editor', 'contributor', 'albums-admin', 'playlists', 'chat']

// Views whose content scrolls under the floating glass player. Each pads its
// main scroller(s) with `.pb-player` (and lifts a `sticky bottom-0` bar with
// `.sticky-dock`). Every other view simply ends above the player, so a view
// left off this list never has anything hidden under it.
// Home and the staff dashboards are on it so their scrollers reach the window
// bottom: ending at the bar's top edge clipped the tiles' drop shadows into a
// hard line beside the bar.
const SCROLL_UNDER: ViewType[] = ['home', 'editor-profile', 'contributor-profile', 'playlists', 'albums', 'liked', 'library', 'api-tracker', 'api-files', 'news', 'stats', 'docs', 'shared-playlist', 'public-profile', 'track']

function getViewFromPath(pathname: string): ViewType {
  if (pathname === '/' || pathname === '/tracker') return 'api-tracker'
  if (pathname.startsWith('/files')) return 'api-files'
  if (pathname === '/editor') return 'editor'
  if (pathname === '/contributor') return 'contributor'
  if (pathname === '/admin') return 'admin'
  if (pathname === '/liked') return 'liked'
  if (pathname === '/playlists') return 'playlists'
  if (pathname === '/albums') return 'albums'
  if (pathname === '/docs') return 'docs'
  if (pathname === '/wrld') return 'wrld'
  if (pathname === '/news') return 'news'
  if (pathname === '/heardle') return 'heardle'
  if (pathname === '/wordle') return 'wordle'
  if (pathname === '/tierlist') return 'tierlist'
  if (pathname === '/stats' || pathname === '/wrapped') return 'stats'
  if (pathname === '/thank-you') return 'thanks'
  if (pathname === '/statistics') return 'statistics'
  if (pathname.startsWith('/u/')) return 'public-profile'
  if (pathname.startsWith('/chat')) return 'chat'
  if (pathname === '/terminal') return 'terminal'
  if (pathname.startsWith('/shared/')) return 'shared-playlist'
  if (pathname.startsWith('/track/') && /^[0-9]+$/.test(pathname.split('/')[2] ?? '')) return 'track'
  if (pathname === '/library') return 'library'
  if (pathname === '/auth/discord/callback') return 'api-tracker'
  return 'not-found'
}

import Sidebar from './components/Sidebar'
import AmbientBackdrop from './components/AmbientBackdrop'
import AutoHideNav from './components/AutoHideNav'
import BottomNav from './components/BottomNav'
import ApiTrackerView from './components/ApiTrackerView'
import ApiFilesView from './components/ApiFilesView'
import LikedSongsView from './components/LikedSongsView'
import PlaylistsView from './components/PlaylistsView'
import RadioFmPlayer from './components/RadioFmPlayer'
import RadioVotePopup from './components/RadioVotePopup'
import DiscordRpcSync from './components/DiscordRpcSync'
import LastfmScrobbler from './components/LastfmScrobbler'
import NowPlayingSharer from './components/NowPlayingSharer'
import NewsNotifier from './components/NewsNotifier'
import BroadcastNotifier from './components/BroadcastNotifier'
import AppToastHost from './components/AppToastHost'
import DebugRecordingPill from './components/DebugRecorder'
import { useDebugLogViewer } from './lib/debugLog'
import ChatNotificationBanner from './components/ChatNotificationBanner'
import UserAuthModal from './components/UserAuthModal'
import ReportModal from './components/ReportModal'
import CoverArtSubmitModal from './components/CoverArtSubmitModal'
import CommunityEditSubmitModal from './components/CommunityEditSubmitModal'
import ConvertFormatModal from './components/ConvertFormatModal'
import BulkEditModal from './components/BulkEditModal'
import UrlImportModal from './components/UrlImportModal'
import InstallPrompt from './components/InstallPrompt'
import CookieNotice from './components/CookieNotice'
import DonationNotice from './components/DonationNotice'
import { GlobalSongInfoHost } from './components/SongInfoModal'
import Player from './components/Player'
import SidePanels from './components/SidePanels'
import DownloadManager from './components/DownloadManager'
import LibraryTab from './components/LibraryTab'
import AppMenu from './components/AppMenu'
import ErrorBoundary from './components/ErrorBoundary'
import SandboxNotch from './components/SandboxNotch'
import { UserCardHost } from './components/chat/UserCard'
import { useIsMobile } from './hooks/useIsMobile'
import { useChatBootstrap } from './hooks/useChatBootstrap'

// Rarely-visited views load on first navigation instead of inflating the
// startup bundle. Suspense fallback is null: these chunks are local (Electron)
// or small (web), so a spinner would just flash. lazyView (not React's lazy)
// so a chunk that vanished in a redeploy triggers a reload instead of an
// error card — see lib/lazyView.
const HomeView = lazyView(() => import('./components/HomeView'))
const EditorPage = lazyView(() => import('./components/EditorPage'))
const AdminPage = lazyView(() => import('./components/AdminPage'))
const SharedPlaylistView = lazyView(() => import('./components/SharedPlaylistView'))
const EditorProfileView = lazyView(() => import('./components/EditorProfileView'))
const NotFoundView = lazyView(() => import('./components/NotFoundView'))
const DocsPage = lazyView(() => import('./components/DocsPage'))
const WrldView = lazyView(() => import('./components/WrldView'))
const AlbumsView = lazyView(() => import('./components/AlbumsView'))
const NewsView = lazyView(() => import('./components/NewsView'))
const HeardleView = lazyView(() => import('./components/HeardleView'))
const WordleView = lazyView(() => import('./components/WordleView'))
const TierlistView = lazyView(() => import('./components/TierlistView'))
const StatsView = lazyView(() => import('./components/StatsView'))
// Donors and administrators only - fetched the first time it opens.
const LyricsGenModal = lazyOverlay(() => import('./components/LyricsGenModal'))
// Desktop only - fetched the first time Sync is opened.
const SyncModal = lazyOverlay(() => import('./components/SyncModal'))
const NotificationCenter = lazyOverlay(() => import('./components/NotificationCenter'))
const StatisticsView = lazyView(() => import('./components/StatisticsView'))
const PublicProfileView = lazyView(() => import('./components/PublicProfileView'))
const ChatView = lazyView(() => import('./components/ChatView'))
const AlbumsAdminView = lazyView(() => import('./components/AlbumsAdminView'))
const LocalEditorPage = lazyView(() => import('./components/LocalEditorPage'))
const ContributorPage = lazyView(() => import('./components/ContributorPage'))
const ContributorProfileView = lazyView(() => import('./components/ContributorProfileView'))
const Settings = lazyView(() => import('./components/Settings'))
const DiagnosticsModal = lazyView(() => import('./components/DiagnosticsModal'))
const DebugLogViewer = lazyView(() => import('./components/DebugLogViewer'))
const RecognitionModal = lazyView(() => import('./components/RecognitionModal'))
const TerminalPage = lazyView(() => import('./components/TerminalPage'))
const TrackView = lazyView(() => import('./components/TrackView'))
const ThankYouView = lazyView(() => import('./components/ThankYouView'))
const LoginApprovalPrompt = lazyView(() => import('./components/LoginApprovalPrompt'))

function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = React.useState(false)
  const el = (window as any).electron

  React.useEffect(() => {
    el?.isMaximized().then((v: boolean) => setMaximized(v))
  }, [])

  // Idle/hover colors resolve to --titlebar-icon / --titlebar-icon-hover when a
  // (custom) skin sets them, otherwise fall back to muted/primary text.
  const btn = "flex items-center justify-center w-11 h-7 text-[var(--titlebar-icon,var(--text-muted))] hover:text-[var(--titlebar-icon-hover,var(--text-primary))] transition-colors"
  return (
    <div className="fixed top-0 right-0 z-[10000] flex" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button className={btn} onClick={() => el?.minimizeWindow()} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg>
      </button>
      <button className={btn} onClick={async () => { await el?.maximizeWindow(); el?.isMaximized().then((v: boolean) => setMaximized(v)) }} title={maximized ? "Restore" : "Maximize"}>
        {maximized
          ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M2.5 0.5H9.5V7.5"/><rect x="0.5" y="2.5" width="7" height="7"/></svg>
          : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>}
      </button>
      <button className={`${btn} hover:bg-red-600 hover:text-white`} onClick={() => el?.closeWindow()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>
      </button>
    </div>
  )
}

// Window focus fires on every alt-tab and every click between the main window
// and a pop-out. The refreshes it triggers are heavy (every playlist with its
// items, a GET per offline playlist, a library walk), so focus runs each at
// most this often; startup has just done them all.
const FOCUS_REFRESH_MS = 30_000
function throttledFocus(fn: () => void): () => void {
  let last = Date.now()
  return () => {
    const now = Date.now()
    if (now - last < FOCUS_REFRESH_MS) return
    last = now
    fn()
  }
}

/** Every view but WRLD and the ones held under the terminal, by name. */
function renderView(v: ViewType): JSX.Element {
  return (
    v === 'home' ? <HomeView />
      : v === 'api-tracker' ? <ApiTrackerView />
      : v === 'api-files' ? <ApiFilesView />
      : v === 'contributor-profile' ? <ContributorProfileView />
      : v === 'admin' ? <AdminPage />
      : v === 'liked' ? <LikedSongsView />
      : v === 'shared-playlist' ? <SharedPlaylistView />
      : v === 'track' ? <TrackView />
      : v === 'thanks' ? <ThankYouView />
      : v === 'editor-profile' ? <EditorProfileView />
      : v === 'docs' ? <DocsPage />
      : v === 'albums' ? <AlbumsView />
      : v === 'news' ? <NewsView />
      : v === 'heardle' ? <HeardleView />
      : v === 'wordle' ? <WordleView />
      : v === 'tierlist' ? <TierlistView />
      : v === 'stats' ? <StatsView />
      : v === 'statistics' ? <StatisticsView />
      : v === 'public-profile' ? <PublicProfileView />
      : v === 'terminal' ? <TerminalPage />
      : v === 'library' ? <LibraryTab />
      : v === 'local-editor' ? <LocalEditorPage />
      : v === 'not-found' ? <NotFoundView />
      : <ApiTrackerView />
  )
}

export default function App(): JSX.Element {
  const showRecognition = useStore((s) => s.showRecognition)
  const { showNowPlaying, showQueue, showSettings, setShowSettings, showDiagnostics, setShowDiagnostics, activeView, sidebarPosition, navStyle, appMenuPosition, loadAccount, completeDiscordLogin, showUserAuth, setShowUserAuth, loadLibrary, wrldFullscreen, loadOfflineLibrary, syncOfflinePlaylists, libraryAutoRefresh, libraryFolders, scanLibrary, prefetchApiData, refreshPlaylists, previousView, autoHideNav, showNotifications, setShowNotifications } = useStorePick(
    'showNowPlaying', 'showQueue', 'showSettings', 'setShowSettings', 'showDiagnostics', 'setShowDiagnostics', 'activeView', 'sidebarPosition', 'navStyle', 'appMenuPosition', 'loadAccount', 'completeDiscordLogin', 'showUserAuth', 'setShowUserAuth', 'loadLibrary', 'wrldFullscreen', 'loadOfflineLibrary', 'syncOfflinePlaylists', 'libraryAutoRefresh', 'libraryFolders', 'scanLibrary', 'prefetchApiData', 'refreshPlaylists', 'previousView', 'autoHideNav', 'showNotifications', 'setShowNotifications')
  // Opening the terminal from a view that holds unsaved local state (the song
  // editor's draft, a half-filled submission, an open playlist...) must not
  // unmount it - closing the terminal would otherwise remount it empty. Derived
  // during render, not in an effect, so the held view is never unmounted for
  // even one commit.
  const heldViewRef = useRef<ViewType | null>(null)
  if (activeView === 'terminal') {
    if (previousView && HOLD_UNDER_TERMINAL.includes(previousView)) heldViewRef.current = previousView
  } else if (activeView !== heldViewRef.current) {
    heldViewRef.current = null
  }
  const heldView = heldViewRef.current
  // The page left for WRLD, kept on screen under it while it slides up from
  // the player bar (lib/wrldExpand.ts).
  const expandUnder = useWrldExpandUnder()
  const wrldUnder = activeView === 'wrld' ? expandUnder : null
  const underWrld = wrldUnder && !HOLD_UNDER_TERMINAL.includes(wrldUnder) ? wrldUnder : null
  const shownViews: ViewType[] = HOLD_UNDER_TERMINAL.includes(activeView) ? [] : underWrld ? [underWrld, 'wrld'] : [activeView]
  // The view on screen before this one, for the Home / browse / dashboard swipe
  // (lib/dashboardSwap.ts). Tracked here rather than read from previousView,
  // which history steps don't always update. The leaving page is copied during
  // this render, the last moment its DOM is still on screen, and the copy is
  // swiped out in the layout effect below, in the same commit as the new
  // page's widgets start swiping in (ViewFade).
  const viewBoxRef = useRef<HTMLDivElement>(null)
  const lastViewRef = useRef<ViewType>(activeView)
  const fromViewRef = useRef<ViewType | null>(null)
  const leavingRef = useRef<(() => void) | null>(null)
  // This switch's swipe direction (dashboardSwap), for the incoming view's ViewFade.
  const swapDirRef = useRef<0 | 1 | -1>(0)
  if (lastViewRef.current !== activeView) {
    const from = lastViewRef.current
    fromViewRef.current = from
    lastViewRef.current = activeView
    const dir = dashboardSwap(from, activeView, useStore.getState().navOrder)
    swapDirRef.current = dir
    const box = viewBoxRef.current
    const page = box?.querySelector(`:scope [data-view="${from}"]`)?.firstElementChild
    leavingRef.current = dir && box && page && !reducedMotion() ? captureLeaving(box, page, dir, isWholePageSwap(from, activeView)) : null
  }
  useLayoutEffect(() => {
    const play = leavingRef.current
    leavingRef.current = null
    play?.()
  }, [activeView])
  const isMobile = useIsMobile()
  const debugLogOpen = useDebugLogViewer((s) => s.log !== null)
  const lyricsGenOpen = useStore((s) => s.lyricsGenModal !== null)
  const syncOpen = useCatalogSync((s) => s.open)
  useThemeEffects()
  useChatBootstrap()

  // Seed auth token from env in local dev only — import.meta.env.DEV is false in production
  // builds, so this never runs for real users even if the token is baked into the bundle.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const devToken = import.meta.env.VITE_AUTH_TOKEN as string | undefined
    if (devToken) { setToken(devToken); loadAccount() }
  }, [])

  // Sync view from URL on mount + handle back/forward
  useEffect(() => {
    // In Electron (file:// protocol) skip URL routing — always start on tracker
    if (window.location.protocol === 'file:') {
      useStore.setState({ activeView: 'api-tracker' })
      return
    }
    const syncFromPath = (): void => {
      useStore.setState({ activeView: getViewFromPath(window.location.pathname) })
    }
    syncFromPath()
    window.addEventListener('popstate', syncFromPath)
    return () => window.removeEventListener('popstate', syncFromPath)
  }, [])

  // Mouse back/forward buttons (3 and 4) step through the views visited.
  useEffect(() => {
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      useStore.getState().navigateHistory(e.button === 3 ? 'back' : 'forward')
    }
    // Stop the browser's own history jump (web) from firing on top of ours.
    const onDown = (e: MouseEvent): void => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])

  // Give each route its own title/description/canonical. Web only — no-op in
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

  // Load the offline-downloaded playlist cache, then refresh it against the
  // live API in the background — keeps downloaded songs' metadata/audio in
  // sync without blocking anything on the network round-trip. Re-run on
  // window focus (catches "edited on the site, alt-tabbed back") and on an
  // interval as a fallback for long-lived sessions, since the app doesn't
  // otherwise learn about API-side edits while it's already running.
  useEffect(() => {
    if (!(window as any).electron) return
    loadOfflineLibrary().then(() => syncOfflinePlaylists())
    const onFocus = throttledFocus(() => { syncOfflinePlaylists() })
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => syncOfflinePlaylists(), 15 * 60 * 1000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(interval) }
  }, [loadOfflineLibrary, syncOfflinePlaylists])

  // Sync (Home → Tools): while it's on, keeps the whole catalogue offline.
  useEffect(() => initCatalogSync(), [])

  // Re-fetch playlists on window focus — playlist edits made elsewhere (the
  // web player, another device, or a playlist saved from a shared link) don't
  // otherwise reach this window until it's restarted. refreshPlaylists() is a
  // no-op while signed out.
  useEffect(() => {
    const onFocus = throttledFocus(() => { refreshPlaylists() })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshPlaylists])

  // "Auto-refresh changed files" (Settings → Library) — opt-in background
  // rescan so tags edited in an external tool (Mp3tag, etc.) show up without
  // an explicit "Scan Now". scanLibrary skips re-parsing anything whose
  // size/mtime hasn't changed, so this stays cheap even on a large library.
  useEffect(() => {
    if (!(window as any).electron) return
    if (!libraryAutoRefresh || libraryFolders.length === 0) return
    loadLibrary().then(() => scanLibrary())
    const onFocus = throttledFocus(() => { scanLibrary() })
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => scanLibrary(), 15 * 60 * 1000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(interval) }
  }, [libraryAutoRefresh, libraryFolders, loadLibrary, scanLibrary])

  // Warm the Tracker/Files offline cache on startup (public data — no auth
  // needed), so those views are ready before the user first opens them.
  // Deferred to idle: none of it is needed to paint, and running it in the
  // mount commit put four requests in front of the ones the visible view was
  // making at that same moment. Overlap with those is still free — apiRequest
  // dedupes identical in-flight GETs.
  useEffect(() => runWhenIdle(() => { prefetchApiData() }), [prefetchApiData])

  // Warm every view's chunk in the background, one per idle slot, so no
  // navigation (or opening Settings) ever waits on loading one. Queued behind
  // the data prefetch above. Re-runs when the account resolves so staff views
  // join the queue; anything already warmed is skipped.
  const account = useStore((s) => s.account)
  useEffect(() => preloadAllViews(account), [account])

  // Warm the local library into the store during idle after boot, so the first
  // Library/Playlists open is instant instead of paying a cold disk read + IPC.
  // loadLibrary is idempotent (see its guard), so this never double-reads with
  // the tab-mount / auto-refresh calls — whichever runs first wins. Skipped when
  // the user has no library folders (nothing to read).
  useEffect(() => {
    if (!(window as any).electron || libraryFolders.length === 0) return
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => number)
    const id = ric ? ric(() => loadLibrary()) : window.setTimeout(() => loadLibrary(), 1500)
    return () => { if (ric && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id); else clearTimeout(id) }
    // Folders rarely change; re-warming when they do is harmless (guard skips it
    // if already loaded). loadLibrary identity is stable.
  }, [libraryFolders, loadLibrary])

  // Deliver any reports queued in a previous session. loadAccount also flushes
  // after login (to attach the token), but this covers a signed-out user whose
  // loadAccount returns early. No-op until the reporting endpoints exist.
  useEffect(() => { useStore.getState()._flushReports() }, [])

  const isElectron = navigator.userAgent.includes("Electron")

  const titleBarMenu = isElectron && !wrldFullscreen && appMenuPosition === 'title-bar'
  // While WRLD slides up, the box keeps the shape of the page left under it
  // (WRLD fills it absolutely either way). Taking it from activeView dropped
  // `scroll-under` and added the bar's padding mid-slide, so that page got
  // shorter and reflowed under WRLD (On this day lost a column).
  const scrollUnder = SCROLL_UNDER.includes(wrldUnder ?? activeView)

  return (
    <UserCardHost>
    <div className="app-shell flex flex-col h-dvh overflow-hidden">
      {/* What the glass chrome frosts: the playing cover, blurred, behind the
          whole window. */}
      <ErrorBoundary fallback={null}><AmbientBackdrop /></ErrorBoundary>
      {/* Reserved title bar — only when the app-menu button is parked here. A
          real row (not an overlay) so content flows BELOW it and the menu can
          never overlap a view's top-left corner. It carries the window's drag
          region; the fixed WindowControls/menu button sit within its height. */}
      {titleBarMenu && (
        // No fill or border of its own: it reads as part of the window, with
        // the glass sidebar and panes floating below it.
        <div
          className="shrink-0 h-9 flex items-center px-1 select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <AppMenu variant="titlebar" />
        </div>
      )}
      {/* Frameless-window drag strip. Skipped only when the nav bar sits on
          top as a real in-flow bar (md+; it's hidden on narrow windows),
          which touches the window edge and carries its own strip. The pill
          and auto-hide bars float over the page and don't, so they keep it.
          Rendered before the nav in the DOM: the later of two overlapping
          app-region rects wins, so the pill's no-drag still punches through.
          ELECTRON_TITLEBAR_CLEARANCE_X clears the min/max/close buttons
          (132px). */}
      {isElectron && appMenuPosition !== 'title-bar' && (
        <div
          className={`fixed top-0 left-0 right-0 h-7 z-20 select-none pointer-events-none ${sidebarPosition === 'top' && navStyle !== 'pill' && !autoHideNav ? 'md:hidden' : ''}`}
          style={{ WebkitAppRegion: 'drag', marginRight: ELECTRON_TITLEBAR_CLEARANCE_X } as React.CSSProperties}
        />
      )}
      {/* Sidebar stays first in the DOM; reverse variants place it visually
          on the right/bottom without reordering focus/tab order. */}
      <div className={`flex flex-1 overflow-hidden ${
        sidebarPosition === 'right' ? 'flex-row-reverse'
          : sidebarPosition === 'top' ? 'flex-col'
          : sidebarPosition === 'bottom' ? 'flex-col-reverse'
          : 'flex-row'
      }`}>
        {!isMobile && (autoHideNav || navStyle === 'pill')
          ? <AutoHideNav position={sidebarPosition} autoHide={autoHideNav && navStyle !== 'pill'} pill={navStyle === 'pill'}><Sidebar /></AutoHideNav>
          : <Sidebar />}
        <main className="flex-1 overflow-hidden flex flex-col relative">
          <div className="flex-1 overflow-hidden flex relative">
            {/* The view's own box. A view on SCROLL_UNDER runs under the
                floating player and pads its scroller (.pb-player); any other
                ends above it. */}
            <div
              ref={viewBoxRef}
              className={`flex-1 min-w-0 flex relative overflow-hidden ${scrollUnder ? 'scroll-under' : ''}`}
              style={scrollUnder ? undefined : { paddingBottom: 'var(--player-dock, 0px)' }}
            >
            <ErrorBoundary>
            <Suspense fallback={null}>
            {/* Holdable views live in their own keyed slots so toggling between
                "shown" and "hidden under the terminal" never remounts them.
                `contents` keeps the wrapper out of the flex layout. */}
            {/* ViewFade: each view fades/lifts in as it comes on screen. */}
            {HOLD_UNDER_TERMINAL.map((v) => (activeView === v || heldView === v || wrldUnder === v) && (
              <ViewFade key={v} view={v} active={activeView === v || wrldUnder === v}
                swap={v === activeView ? swapDirRef.current : 0} wholePageSwap={isWholePageSwap(fromViewRef.current, v)}>
                {v === 'editor' ? <EditorPage />
                  : v === 'contributor' ? <ContributorPage />
                  : v === 'albums-admin' ? <AlbumsAdminView />
                  : v === 'playlists' ? <PlaylistsView />
                  : <ChatView />}
              </ViewFade>
            ))}
            {/* Opening WRLD from the player bar keeps the page you were on
                mounted under it while WRLD slides up (lib/wrldExpand.ts). WRLD
                fills the box absolutely, with its own Suspense, so that page
                stays on screen while WRLD's chunk loads. */}
            {shownViews.map((v) => (
            <ViewFade key={v} view={v} active swap={v === activeView ? swapDirRef.current : 0}
              wholePageSwap={isWholePageSwap(fromViewRef.current, v)}>
              {v === 'wrld' ? (
                <div className={`absolute inset-0 flex ${wrldUnder ? 'z-10' : ''}`}>
                  <Suspense fallback={null}><WrldView /></Suspense>
                </div>
              ) : renderView(v)}
            </ViewFade>
            ))}
            </Suspense>
          </ErrorBoundary>
            </div>
            <SidePanels nowPlaying={showNowPlaying && activeView !== 'wrld'} queue={showQueue && activeView !== 'wrld'} />
          </div>
          {/* Inside <main>: the desktop bar floats over the bottom of this
              area (views and side panels), clear of the sidebar. The phone
              bar stays an in-flow row below the views. */}
          <ErrorBoundary fallback={<div className="h-20 shrink-0 border-t border-[var(--border)] flex items-center justify-center text-text-muted text-xs">Player crashed — reload the app to restore playback controls.</div>}>
            <Player />
          </ErrorBoundary>
        </main>
      </div>
      {/* Everything below is a loose sibling of the main content rather than a
          child of the pane boundary above, so an uncaught render error here
          used to unmount the entire app (a blank window). Each gets its own
          boundary: the chrome keeps a compact inline notice, the invisible
          background workers fail silently, and the modals/overlays show a
          centered, dismissible card. */}
      <ErrorBoundary fallback={null}><RadioFmPlayer /></ErrorBoundary>
      <ErrorBoundary fallback={null}><RadioVotePopup /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DiscordRpcSync /></ErrorBoundary>
      <ErrorBoundary fallback={null}><LastfmScrobbler /></ErrorBoundary>
      <ErrorBoundary fallback={null}><NowPlayingSharer /></ErrorBoundary>
      <ErrorBoundary fallback={null}><NewsNotifier /></ErrorBoundary>
      <ErrorBoundary fallback={null}><BroadcastNotifier /></ErrorBoundary>
      <ErrorBoundary fallback={null}><AppToastHost /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DebugRecordingPill /></ErrorBoundary>
      <ErrorBoundary fallback={null}><ChatNotificationBanner /></ErrorBoundary>
      <ErrorBoundary fallback={null}><BottomNav /></ErrorBoundary>
      {showSettings && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowSettings(false)}>
          <Suspense fallback={null}><Settings /></Suspense>
        </ErrorBoundary>
      )}
      {showDiagnostics && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowDiagnostics(false)}>
          <Suspense fallback={null}><DiagnosticsModal /></Suspense>
        </ErrorBoundary>
      )}
      {debugLogOpen && (
        <ErrorBoundary variant="overlay" onDismiss={() => useDebugLogViewer.getState().close()}>
          <Suspense fallback={null}><DebugLogViewer /></Suspense>
        </ErrorBoundary>
      )}
      {showUserAuth && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowUserAuth(false)}>
          <UserAuthModal onClose={() => setShowUserAuth(false)} />
        </ErrorBoundary>
      )}
      <ErrorBoundary fallback={null}><Suspense fallback={null}><LoginApprovalPrompt /></Suspense></ErrorBoundary>
      <ErrorBoundary variant="overlay"><ReportModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><CoverArtSubmitModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><CommunityEditSubmitModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><ConvertFormatModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><BulkEditModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><UrlImportModal /></ErrorBoundary>
      {lyricsGenOpen && (
        <ErrorBoundary variant="overlay" onDismiss={() => useStore.getState().closeLyricsGen()}>
          <LyricsGenModal />
        </ErrorBoundary>
      )}
      {syncOpen && (
        <ErrorBoundary variant="overlay" onDismiss={() => useCatalogSync.getState().setOpen(false)}>
          <SyncModal />
        </ErrorBoundary>
      )}
      {showRecognition && <ErrorBoundary variant="overlay"><Suspense fallback={null}><RecognitionModal /></Suspense></ErrorBoundary>}
      <ErrorBoundary fallback={null}><InstallPrompt /></ErrorBoundary>
      <ErrorBoundary fallback={null}><CookieNotice /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DonationNotice /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><GlobalSongInfoHost /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DownloadManager /></ErrorBoundary>
      {showNotifications && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowNotifications(false)}>
          <NotificationCenter />
        </ErrorBoundary>
      )}
      {/* Rendered last on purpose: Chromium builds the frameless window's
          draggable region in DOM order (drag rects unite, no-drag rects
          subtract, later entries win). The buttons' no-drag carve-out must
          come after any drag strip that can extend under them — with the nav
          on top/right, the sidebar's strip does, and when this rendered first
          clicking min/max/close dragged the window instead. */}
      {/* The title-bar menu is rendered inside its reserved row above (not
          here) so content flows below it; the 'sidebar' option renders it
          inside Sidebar. WindowControls stays last — Chromium builds the
          draggable region in DOM order, so its no-drag carve-out must come
          after every drag strip that can extend under the buttons. */}
      {isElectron && !wrldFullscreen && <WindowControls />}
      <ErrorBoundary fallback={null}><SandboxNotch /></ErrorBoundary>
    </div>
    </UserCardHost>
  )
}
