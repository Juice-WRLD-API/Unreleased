import { lazyView } from './lazyView'
import { tabEntryView } from './navItems'
import { ViewType } from '../types'
import ApiTrackerView from '../components/ApiTrackerView'
import EditorPage from '../components/EditorPage'
import AdminPage from '../components/AdminPage'
import EditorProfileView from '../components/EditorProfileView'
import DocsPage from '../components/DocsPage'
import WrldView from '../components/WrldView'
import HeardleView from '../components/HeardleView'
import WordleView from '../components/WordleView'
import TierlistView from '../components/TierlistView'
import StatsView from '../components/StatsView'
import StatisticsView from '../components/StatisticsView'
import HomeView from '../components/HomeView'
import Settings from '../components/Settings'
import PlaylistsView from '../components/PlaylistsView'
import ApiFilesView from '../components/ApiFilesView'

// Every view, none of which is part of the startup bundle. These live here
// rather than in App.tsx so the nav chrome (Sidebar, BottomNav, MoreNavSheet)
// can warm a chunk on hover/tap without importing App and pulling the whole
// shell in with it.
//
// Views with a shell per breakpoint are imported statically: each wrapper is a
// few lines (see responsiveView in lib/lazyView) and lazy-loads only the half
// the viewport renders, so importing it here costs nothing and avoids a
// wrapper-chunk -> half-chunk waterfall. That includes ApiTrackerView - `/`
// opens Home on desktop and installed apps, so shipping both tracker layouts
// in the entry bundle only ever helped a mobile browser's first paint, while
// every other visitor downloaded ~125 KB they didn't render.
//
// lazyView (not React's lazy) so a chunk that vanished in a redeploy triggers
// a reload instead of an error card - see lib/lazyView.
export {
  ApiTrackerView, EditorPage, AdminPage, EditorProfileView, DocsPage, WrldView, HeardleView,
  WordleView, TierlistView, StatsView, StatisticsView, HomeView, Settings, PlaylistsView, ApiFilesView,
}

export const SharedPlaylistView = lazyView(() => import('../components/SharedPlaylistView'))
export const TrackView = lazyView(() => import('../components/TrackView'))
export const PublicProfileView = lazyView(() => import('../components/PublicProfileView'))
export const NotFoundView = lazyView(() => import('../components/NotFoundView'))
export const NewsView = lazyView(() => import('../components/NewsView'))
export const DownloadAppView = lazyView(() => import('../components/DownloadAppView'))
export const ThankYouView = lazyView(() => import('../components/ThankYouView'))
export const AlbumsAdminView = lazyView(() => import('../components/AlbumsAdminView'))
export const ContributorPage = lazyView(() => import('../components/ContributorPage'))
export const ContributorProfileView = lazyView(() => import('../components/ContributorProfileView'))
// Also a static import inside PlaylistsView.desktop/.mobile, so Rollup hoists
// it into a chunk shared with Playlists rather than duplicating it. Splitting
// the route is still worth it - it's off the startup path either way.
export const LikedSongsView = lazyView(() => import('../components/LikedSongsView'))
export const DiagnosticsModal = lazyView(() => import('../components/DiagnosticsModal'))
export const ChatView = lazyView(() => import('../components/ChatView'))

// The same import() factories again, keyed by view, for warming a chunk ahead
// of the navigation that needs it. Deliberately a second reference to the same
// specifier rather than something clever: Vite resolves both to one chunk, and
// calling the factory is exactly what React would do on render - so a warmed
// chunk makes the later render resolve from the module cache synchronously.
// Split views warm only the half the current viewport will render.
const LOADERS: Partial<Record<ViewType, () => Promise<unknown>>> = {
  'api-tracker': ApiTrackerView.preload,
  editor: EditorPage.preload,
  admin: AdminPage.preload,
  'shared-playlist': () => import('../components/SharedPlaylistView'),
  track: () => import('../components/TrackView'),
  'public-profile': () => import('../components/PublicProfileView'),
  'editor-profile': EditorProfileView.preload,
  'not-found': () => import('../components/NotFoundView'),
  docs: DocsPage.preload,
  wrld: WrldView.preload,
  news: () => import('../components/NewsView'),
  heardle: HeardleView.preload,
  wordle: WordleView.preload,
  tierlist: TierlistView.preload,
  stats: StatsView.preload,
  statistics: StatisticsView.preload,
  download: () => import('../components/DownloadAppView'),
  thanks: () => import('../components/ThankYouView'),
  'albums-admin': () => import('../components/AlbumsAdminView'),
  contributor: () => import('../components/ContributorPage'),
  'contributor-profile': () => import('../components/ContributorProfileView'),
  home: HomeView.preload,
  settings: Settings.preload,
  playlists: PlaylistsView.preload,
  'api-files': ApiFilesView.preload,
  liked: () => import('../components/LikedSongsView'),
  chat: () => import('../components/ChatView'),
}

const started = new Set<ViewType>()

// Chromium-only; absent elsewhere, which reads as "no constraint known".
interface NetworkInfo { saveData?: boolean; effectiveType?: string }

/** True when the browser is telling us not to spend bandwidth speculatively -
 *  Data Saver on, or a connection slow enough that a prefetch would compete
 *  with the request the user is actually waiting for. */
function shouldSkipPrefetch(): boolean {
  const conn = (navigator as unknown as { connection?: NetworkInfo }).connection
  if (!conn) return false
  return conn.saveData === true || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g'
}

/** Start loading `view`'s chunk without rendering it. Safe to call on every
 *  hover/pointerdown: it runs at most once per view, and a failure is
 *  swallowed - the real navigation still goes through lazyView's retry +
 *  reload recovery, so a failed warm-up must never surface anything. */
export function preloadView(view: ViewType): void {
  // Not always `view` itself: a tab holding several views (Games) opens on
  // whichever one was last played, so warm the chunk that will actually render.
  const target = tabEntryView(view)
  if (started.has(target)) return
  const load = LOADERS[target]
  if (!load) return
  if (shouldSkipPrefetch()) return
  started.add(target)
  load().catch(() => { started.delete(target) })
}
