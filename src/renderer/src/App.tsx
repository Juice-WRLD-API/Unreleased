import React, { useEffect, useState, Suspense } from 'react'
import { useStore, useStorePick } from './store/useStore'
import { setToken, getToken } from './lib/userApi'
import { useThemeEffects } from './lib/themeEffects'
import { runWhenIdle } from './lib/platform'
import { applySeo } from './lib/seo'
import { loadSessionEditLinks } from './lib/sessionEditsApi'
import { lazyView } from './lib/lazyView'
import { ViewType } from './types'

function getViewFromPath(pathname: string): ViewType {
  if (pathname === '/' || pathname === '/tracker') return 'api-tracker'
  if (pathname.startsWith('/files')) return 'api-files'
  if (pathname === '/editor') return 'editor'
  if (pathname === '/contributor') return 'contributor'
  if (pathname === '/admin') return 'admin'
  if (pathname === '/liked') return 'liked'
  if (pathname === '/playlists') return 'playlists'
  if (pathname === '/docs') return 'docs'
  if (pathname === '/wrld') return 'wrld'
  if (pathname === '/news') return 'news'
  if (pathname === '/heardle') return 'heardle'
  if (pathname === '/wordle') return 'wordle'
  if (pathname === '/tierlist') return 'tierlist'
  if (pathname === '/stats') return 'stats'
  if (pathname === '/statistics') return 'statistics'
  if (pathname.startsWith('/u/')) return 'public-profile'
  if (pathname.startsWith('/chat')) return 'chat'
  if (pathname.startsWith('/shared/')) return 'shared-playlist'
  if (pathname === '/library') return 'library'
  if (pathname === '/auth/discord/callback') return 'api-tracker'
  return 'not-found'
}

import Sidebar from './components/Sidebar'
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
import ChatNotificationBanner from './components/ChatNotificationBanner'
import UserAuthModal from './components/UserAuthModal'
import ReportModal from './components/ReportModal'
import ConvertFormatModal from './components/ConvertFormatModal'
import BulkEditModal from './components/BulkEditModal'
import UrlImportModal from './components/UrlImportModal'
import InstallPrompt from './components/InstallPrompt'
import CookieNotice from './components/CookieNotice'
import DonationNotice from './components/DonationNotice'
import { GlobalSongInfoHost } from './components/SongInfoModal'
import Player from './components/Player'
import NowPlaying from './components/NowPlaying'
import QueuePanel from './components/QueuePanel'
import DownloadManager from './components/DownloadManager'
import LibraryTab from './components/LibraryTab'
import AppMenu from './components/AppMenu'
import ErrorBoundary from './components/ErrorBoundary'
import SandboxNotch from './components/SandboxNotch'

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
const NewsView = lazyView(() => import('./components/NewsView'))
const HeardleView = lazyView(() => import('./components/HeardleView'))
const WordleView = lazyView(() => import('./components/WordleView'))
const TierlistView = lazyView(() => import('./components/TierlistView'))
const StatsView = lazyView(() => import('./components/StatsView'))
const StatisticsView = lazyView(() => import('./components/StatisticsView'))
const PublicProfileView = lazyView(() => import('./components/PublicProfileView'))
const ChatView = lazyView(() => import('./components/ChatView'))
const AlbumsAdminView = lazyView(() => import('./components/AlbumsAdminView'))
const LocalEditorPage = lazyView(() => import('./components/LocalEditorPage'))
const ContributorPage = lazyView(() => import('./components/ContributorPage'))
const ContributorProfileView = lazyView(() => import('./components/ContributorProfileView'))
const Settings = lazyView(() => import('./components/Settings'))
const DiagnosticsModal = lazyView(() => import('./components/DiagnosticsModal'))

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

export default function App(): JSX.Element {
  const { showNowPlaying, showQueue, showSettings, setShowSettings, showDiagnostics, setShowDiagnostics, activeView, sidebarPosition, appMenuPosition, loadAccount, completeDiscordLogin, showUserAuth, setShowUserAuth, loadLibrary, wrldFullscreen, loadOfflineLibrary, syncOfflinePlaylists, libraryAutoRefresh, libraryFolders, scanLibrary, prefetchApiData, refreshPlaylists, activeChannel } = useStorePick(
    'showNowPlaying', 'showQueue', 'showSettings', 'setShowSettings', 'showDiagnostics', 'setShowDiagnostics', 'activeView', 'sidebarPosition', 'appMenuPosition', 'loadAccount', 'completeDiscordLogin', 'showUserAuth', 'setShowUserAuth', 'loadLibrary', 'wrldFullscreen', 'loadOfflineLibrary', 'syncOfflinePlaylists', 'libraryAutoRefresh', 'libraryFolders', 'scanLibrary', 'prefetchApiData', 'refreshPlaylists', 'activeChannel')
  // Keep the panel mounted after its first open instead of unmounting on
  // close - unmounting destroyed every cover <img>, so reopening the queue
  // made them all reload/re-decode from scratch instead of just reappearing.
  const [queueEverOpened, setQueueEverOpened] = useState(showQueue)
  useEffect(() => { if (showQueue) setQueueEverOpened(true) }, [showQueue])
  useThemeEffects()

  // Warms the session-edit auto-match mirror so any view that resolves a
  // recording_session song's playback (songToTrack, ApiTrackerView, etc.)
  // sees it filled in without depending on the Tracker having been opened
  // first this session.
  useEffect(() => { loadSessionEditLinks(activeChannel).catch(() => {}) }, [activeChannel])
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
    const onFocus = (): void => { syncOfflinePlaylists() }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => syncOfflinePlaylists(), 15 * 60 * 1000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(interval) }
  }, [loadOfflineLibrary, syncOfflinePlaylists])

  // Re-fetch playlists on window focus — playlist edits made elsewhere (the
  // web player, another device, or a playlist saved from a shared link) don't
  // otherwise reach this window until it's restarted. refreshPlaylists() is a
  // no-op while signed out.
  useEffect(() => {
    const onFocus = (): void => { refreshPlaylists() }
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
    const onFocus = (): void => { scanLibrary() }
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

  return (
    <div className="app-shell flex flex-col h-dvh bg-surface overflow-hidden">
      {/* Reserved title bar — only when the app-menu button is parked here. A
          real row (not an overlay) so content flows BELOW it and the menu can
          never overlap a view's top-left corner. It carries the window's drag
          region; the fixed WindowControls/menu button sit within its height. */}
      {titleBarMenu && (
        <div
          className="shrink-0 h-9 flex items-center px-1 bg-sidebar border-b border-[var(--border)] select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <AppMenu variant="titlebar" />
        </div>
      )}
      {/* Sidebar stays first in the DOM; reverse variants place it visually
          on the right/bottom without reordering focus/tab order. */}
      <div className={`flex flex-1 overflow-hidden ${
        sidebarPosition === 'right' ? 'flex-row-reverse'
          : sidebarPosition === 'top' ? 'flex-col'
          : sidebarPosition === 'bottom' ? 'flex-col-reverse'
          : 'flex-row'
      }`}>
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col relative">
          {/* Frameless-window drag strip — when the nav bar sits on top (md+
              only; it's hidden on narrow windows) the bar touches the window
              edge instead and carries its own strip. mr-[188px] clears the
              min/max/close buttons (132px) plus the fixed downloads trigger
              next to them (right: 144px + 36px wide — see DownloadManager). */}
          {isElectron && appMenuPosition !== 'title-bar' && (
            <div
              className={`absolute top-0 left-0 right-0 h-7 z-20 select-none mr-[188px] pointer-events-none ${sidebarPosition === 'top' ? 'md:hidden' : ''}`}
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />
          )}
          <div className="flex-1 overflow-hidden flex">
            <ErrorBoundary>
            <Suspense fallback={null}>
            {activeView === 'home' ? <HomeView />
              : activeView === 'api-tracker' ? <ApiTrackerView />
              : activeView === 'api-files' ? <ApiFilesView />
              : activeView === 'editor' ? <EditorPage />
              : activeView === 'contributor' ? <ContributorPage />
              : activeView === 'contributor-profile' ? <ContributorProfileView />
              : activeView === 'admin' ? <AdminPage />
              : activeView === 'liked' ? <LikedSongsView />
              : activeView === 'playlists' ? <PlaylistsView />
              : activeView === 'shared-playlist' ? <SharedPlaylistView />
              : activeView === 'editor-profile' ? <EditorProfileView />
              : activeView === 'docs' ? <DocsPage />
              : activeView === 'wrld' ? <WrldView />
              : activeView === 'news' ? <NewsView />
              : activeView === 'heardle' ? <HeardleView />
              : activeView === 'wordle' ? <WordleView />
              : activeView === 'tierlist' ? <TierlistView />
              : activeView === 'stats' ? <StatsView />
              : activeView === 'statistics' ? <StatisticsView />
              : activeView === 'public-profile' ? <PublicProfileView />
              : activeView === 'chat' ? <ChatView />
              : activeView === 'library' ? <LibraryTab />
              : activeView === 'local-editor' ? <LocalEditorPage />
              : activeView === 'albums-admin' ? <AlbumsAdminView />
              : activeView === 'not-found' ? <NotFoundView />
              : <ApiTrackerView />}
            </Suspense>
          </ErrorBoundary>
            {showNowPlaying && activeView !== 'wrld' && <ErrorBoundary><NowPlaying /></ErrorBoundary>}
            {queueEverOpened && (
              <ErrorBoundary>
                <div style={showQueue && activeView !== 'wrld' ? undefined : { display: 'none' }}>
                  <QueuePanel />
                </div>
              </ErrorBoundary>
            )}
          </div>
        </main>
      </div>
      {/* Everything below is a loose sibling of the main content rather than a
          child of the pane boundary above, so an uncaught render error here
          used to unmount the entire app (a blank window). Each gets its own
          boundary: the chrome keeps a compact inline notice, the invisible
          background workers fail silently, and the modals/overlays show a
          centered, dismissible card. */}
      <ErrorBoundary fallback={<div className="h-20 shrink-0 border-t border-[var(--border)] flex items-center justify-center text-text-muted text-xs">Player crashed — reload the app to restore playback controls.</div>}>
        <Player />
      </ErrorBoundary>
      <ErrorBoundary fallback={null}><RadioFmPlayer /></ErrorBoundary>
      <ErrorBoundary fallback={null}><RadioVotePopup /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DiscordRpcSync /></ErrorBoundary>
      <ErrorBoundary fallback={null}><LastfmScrobbler /></ErrorBoundary>
      <ErrorBoundary fallback={null}><NowPlayingSharer /></ErrorBoundary>
      <ErrorBoundary fallback={null}><NewsNotifier /></ErrorBoundary>
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
      {showUserAuth && (
        <ErrorBoundary variant="overlay" onDismiss={() => setShowUserAuth(false)}>
          <UserAuthModal onClose={() => setShowUserAuth(false)} />
        </ErrorBoundary>
      )}
      <ErrorBoundary variant="overlay"><ReportModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><ConvertFormatModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><BulkEditModal /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><UrlImportModal /></ErrorBoundary>
      <ErrorBoundary fallback={null}><InstallPrompt /></ErrorBoundary>
      <ErrorBoundary fallback={null}><CookieNotice /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DonationNotice /></ErrorBoundary>
      <ErrorBoundary variant="overlay"><GlobalSongInfoHost /></ErrorBoundary>
      <ErrorBoundary fallback={null}><DownloadManager /></ErrorBoundary>
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
  )
}
