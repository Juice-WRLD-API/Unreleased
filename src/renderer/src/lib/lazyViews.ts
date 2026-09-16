import { lazyView } from './lazyView'
import { tabEntryView } from './navItems'
import { ViewType } from '../types'

// Every view that isn't part of the startup bundle. These live here rather
// than in App.tsx so the nav chrome (Sidebar, BottomNav, MoreNavSheet) can warm
// a chunk on hover/tap without importing App and pulling the whole shell in
// with it.
//
// The only view NOT here is ApiTrackerView: `/` lands on it (see
// getViewFromPath in App.tsx), so splitting it would just put a round-trip in
// front of first paint.
//
// lazyView (not React's lazy) so a chunk that vanished in a redeploy triggers
// a reload instead of an error card - see lib/lazyView.
export const EditorPage = lazyView(() => import('../components/EditorPage'))
export const AdminPage = lazyView(() => import('../components/AdminPage'))
export const SharedPlaylistView = lazyView(() => import('../components/SharedPlaylistView'))
export const PublicProfileView = lazyView(() => import('../components/PublicProfileView'))
export const EditorProfileView = lazyView(() => import('../components/EditorProfileView'))
export const NotFoundView = lazyView(() => import('../components/NotFoundView'))
export const DocsPage = lazyView(() => import('../components/DocsPage'))
export const WrldView = lazyView(() => import('../components/WrldView'))
export const NewsView = lazyView(() => import('../components/NewsView'))
export const HeardleView = lazyView(() => import('../components/HeardleView'))
export const WordleView = lazyView(() => import('../components/WordleView'))
export const TierlistView = lazyView(() => import('../components/TierlistView'))
export const StatsView = lazyView(() => import('../components/StatsView'))
export const StatisticsView = lazyView(() => import('../components/StatisticsView'))
export const DownloadAppView = lazyView(() => import('../components/DownloadAppView'))
export const ThankYouView = lazyView(() => import('../components/ThankYouView'))
export const AlbumsAdminView = lazyView(() => import('../components/AlbumsAdminView'))
export const ContributorPage = lazyView(() => import('../components/ContributorPage'))
export const ContributorProfileView = lazyView(() => import('../components/ContributorProfileView'))
export const HomeView = lazyView(() => import('../components/HomeView'))
export const Settings = lazyView(() => import('../components/Settings'))
export const PlaylistsView = lazyView(() => import('../components/PlaylistsView'))
export const ApiFilesView = lazyView(() => import('../components/ApiFilesView'))
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
const LOADERS: Partial<Record<ViewType, () => Promise<unknown>>> = {
  editor: () => import('../components/EditorPage'),
  admin: () => import('../components/AdminPage'),
  'shared-playlist': () => import('../components/SharedPlaylistView'),
  'public-profile': () => import('../components/PublicProfileView'),
  'editor-profile': () => import('../components/EditorProfileView'),
  'not-found': () => import('../components/NotFoundView'),
  docs: () => import('../components/DocsPage'),
  wrld: () => import('../components/WrldView'),
  news: () => import('../components/NewsView'),
  heardle: () => import('../components/HeardleView'),
  wordle: () => import('../components/WordleView'),
  tierlist: () => import('../components/TierlistView'),
  stats: () => import('../components/StatsView'),
  statistics: () => import('../components/StatisticsView'),
  download: () => import('../components/DownloadAppView'),
  thanks: () => import('../components/ThankYouView'),
  'albums-admin': () => import('../components/AlbumsAdminView'),
  contributor: () => import('../components/ContributorPage'),
  'contributor-profile': () => import('../components/ContributorProfileView'),
  home: () => import('../components/HomeView'),
  settings: () => import('../components/Settings'),
  playlists: () => import('../components/PlaylistsView'),
  'api-files': () => import('../components/ApiFilesView'),
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
