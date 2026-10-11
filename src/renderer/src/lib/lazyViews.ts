import type { ViewType } from '../types'
import type { AccountUser } from './userApi'
import { hasChatAccess } from './chatAccess'
import { runWhenIdle } from './platform'

// Loaders for the views App.tsx code-splits with lazyView. Same import()
// specifiers as App.tsx, so they resolve to the same module: warming one here
// means the real lazyView resolves from cache on first open. Views App.tsx
// imports statically (Tracker, Files, Playlists, Liked, Library) aren't listed -
// they're already in the main bundle.
const LOADERS: Partial<Record<ViewType, () => Promise<unknown>>> = {
  home: () => import('../components/HomeView'),
  editor: () => import('../components/EditorPage'),
  admin: () => import('../components/AdminPage'),
  'shared-playlist': () => import('../components/SharedPlaylistView'),
  'editor-profile': () => import('../components/EditorProfileView'),
  'not-found': () => import('../components/NotFoundView'),
  docs: () => import('../components/DocsPage'),
  wrld: () => import('../components/WrldView'),
  news: () => import('../components/NewsView'),
  heardle: () => import('../components/HeardleView'),
  wordle: () => import('../components/WordleView'),
  tierlist: () => import('../components/TierlistView'),
  'session-maker': () => import('../components/SessionMakerView'),
  stats: () => import('../components/StatsView'),
  statistics: () => import('../components/StatisticsView'),
  'public-profile': () => import('../components/PublicProfileView'),
  chat: () => import('../components/ChatView'),
  'albums-admin': () => import('../components/AlbumsAdminView'),
  'local-editor': () => import('../components/LocalEditorPage'),
  contributor: () => import('../components/ContributorPage'),
  'contributor-profile': () => import('../components/ContributorProfileView'),
  settings: () => import('../components/Settings'),
  terminal: () => import('../components/TerminalPage'),
  track: () => import('../components/TrackView'),
  thanks: () => import('../components/ThankYouView'),
}

// Views only staff can reach. Everyone else never opens them, so loading them
// would just be parse time and memory spent for nothing.
const STAFF_VIEWS = new Set<ViewType>(['editor', 'admin', 'albums-admin', 'contributor', 'terminal', 'editor-profile'])

const started = new Set<ViewType>()

/** Start loading `view`'s chunk without rendering it. Safe to call on every
 *  hover/pointerdown: it runs at most once per view, and a failure is
 *  swallowed - the real navigation still goes through lazyView's retry. */
export function preloadView(view: ViewType): void {
  if (started.has(view)) return
  const load = LOADERS[view]
  if (!load) return
  started.add(view)
  load().catch(() => { started.delete(view) })
}

/** Warm every view this account can reach, so no navigation ever waits on a
 *  chunk. The chunks are local (Electron), so the only cost is parsing - one
 *  view per idle slot keeps that off any frame the user is interacting in.
 *  Returns a cancel for the remaining queue. */
export function preloadAllViews(account: AccountUser | null): () => void {
  const isStaff = !!account && !!(account.is_administrator || account.is_manager || account.is_editor || account.is_contributor)
  const queue = (Object.keys(LOADERS) as ViewType[]).filter((v) =>
    !started.has(v) &&
    (v !== 'chat' || hasChatAccess(account)) &&
    (!STAFF_VIEWS.has(v) || isStaff))
  let cancel = (): void => {}
  const next = (): void => {
    const view = queue.shift()
    if (!view) return
    preloadView(view)
    cancel = runWhenIdle(next, 1000)
  }
  cancel = runWhenIdle(next, 4000)
  return () => cancel()
}
