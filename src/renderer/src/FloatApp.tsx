import { Suspense, lazy, useEffect, useState, CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore, useStorePick } from './store/useStore'
import { useThemeEffects } from './lib/themeEffects'
import { getSongById, JWApiSong } from './lib/juicewrldApi'
import { showStaffProfile, staffProfileView } from './lib/userApi'
import ErrorBoundary from './components/ErrorBoundary'
import type { AdminTab } from './hooks/useAdminQueue'

const Settings = lazy(() => import('./components/Settings'))
const EditorProfileView = lazy(() => import('./components/EditorProfileView'))
const ContributorProfileView = lazy(() => import('./components/ContributorProfileView'))
const EditorPage = lazy(() => import('./components/EditorPage'))
const AdminPage = lazy(() => import('./components/AdminPage'))
const LocalEditorPage = lazy(() => import('./components/LocalEditorPage'))
const MiniPlayer = lazy(() => import('./components/MiniPlayer'))
const EqualizerPanel = lazy(() => import('./components/EqualizerPanel'))
const LyricsGenModal = lazy(() => import('./components/LyricsGenModal'))
// Not lazy: every list view already imports the info modal statically, so
// it lives in the main chunk regardless — a dynamic import here would just
// trigger Vite's mixed-import warning without splitting anything.
import SongInfoModal from './components/SongInfoModal'
import ReportModal from './components/ReportModal'
import CoverArtSubmitModal from './components/CoverArtSubmitModal'
import ConvertFormatModal from './components/ConvertFormatModal'
import AppToastHost from './components/AppToastHost'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const el = (window as any).electron

function initialParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

// Drag strip + window buttons for pop-outs that render a full view (Settings
// and song-info have modal chrome of their own that doubles as the handle).
// Mirrors App's WindowControls but through the sender-scoped *Self IPC —
// the plain variants would minimize/close the MAIN window.
function FloatTitleBar({ bordered = true }: { bordered?: boolean }): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const btn = 'flex items-center justify-center w-11 h-7 text-text-muted hover:text-text-primary transition-colors'
  return (
    <div className={`shrink-0 flex h-7 ${bordered ? 'border-b border-[var(--border)]' : ''}`}>
      <div className="flex-1 select-none" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />
      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <button className={btn} onClick={() => el?.minimizeSelf()} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg>
        </button>
        <button className={btn} onClick={async () => setMaximized(!!(await el?.maximizeSelf()))} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized
            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M2.5 0.5H9.5V7.5"/><rect x="0.5" y="2.5" width="7" height="7"/></svg>
            : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>}
        </button>
        <button className={`${btn} hover:bg-red-600 hover:text-white`} onClick={() => el?.closeSelf()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>
        </button>
      </div>
    </div>
  )
}

function FloatSongInfo(): JSX.Element | null {
  const { account } = useStorePick('account')
  const [songId, setSongId] = useState<number | null>(() => {
    const raw = initialParam('songId')
    return raw ? Number(raw) : null
  })
  const [song, setSong] = useState<JWApiSong | null>(null)

  // "Info" clicked on another song while this window is open — swap content.
  useEffect(() => el?.onFloatParams?.((p: Record<string, string>) => {
    if (p?.songId) setSongId(Number(p.songId))
  }), [])

  useEffect(() => {
    if (!songId) return
    let stale = false
    getSongById(songId).then((s) => { if (!stale) setSong(s) }).catch(() => {})
    return () => { stale = true }
  }, [songId])

  const canEdit = !!account && (account.is_editor || account.is_administrator)
  if (!song) return null
  return (
    <SongInfoModal
      floating
      song={song}
      onClose={() => el?.closeSelf?.()}
      onEdit={canEdit ? (id) => useStore.getState().openSongEditor(id) : undefined}
    />
  )
}

function FloatEditor(): JSX.Element {
  // The boot song rides in as a prop rather than through pendingEditorSongId:
  // child effects run before the parent's, so seeding the store from an effect
  // here happened *after* EditorPage's own mount effects had already looked,
  // found nothing pending, and prefilled from whatever was playing — the two
  // loads then raced and the wrong song often won.
  const [bootSongId] = useState<number | null>(() => {
    const raw = initialParam('songId')
    return raw ? Number(raw) : null
  })

  // Retargeting an already-open window still goes through the store, which is
  // fine — EditorPage is mounted by then and picks the change up directly.
  useEffect(() => el?.onFloatParams?.((p: Record<string, string>) => {
    if (p?.songId) useStore.setState({ pendingEditorSongId: Number(p.songId) })
  }), [])

  // The lyrics box's Sync opens the Synced lyrics dialog, which hands its
  // result back to this editor, so it opens in this window, toasts and all.
  const lyricsGenOpen = useStore((s) => s.lyricsGenModal !== null)

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <EditorPage initialSongId={bootSongId} />
      {lyricsGenOpen && (
        <ErrorBoundary variant="overlay" onDismiss={() => useStore.getState().closeLyricsGen()}>
          <Suspense fallback={null}><LyricsGenModal /></Suspense>
        </ErrorBoundary>
      )}
      <AppToastHost />
    </div>
  )
}

function FloatLocalEditor(): JSX.Element {
  // LocalEditorPage picks its track up from pendingLocalEditTrack, which (unlike
  // the API editor's plain songId) is a full LibraryTrack object — there's no
  // API to re-fetch it from, so this window loads the local library from disk
  // (see FloatApp below) and looks the track up by id once that resolves.
  const { libraryTracks } = useStorePick('libraryTracks')
  const [trackId, setTrackId] = useState<string | null>(() => initialParam('trackId'))

  // "Edit metadata" clicked on another track while this window is open — swap content.
  useEffect(() => el?.onFloatParams?.((p: Record<string, string>) => {
    if (p?.trackId) setTrackId(p.trackId)
  }), [])

  useEffect(() => {
    if (!trackId) return
    const track = libraryTracks.find((t) => t.id === trackId)
    if (track) useStore.setState({ pendingLocalEditTrack: track })
  }, [trackId, libraryTracks])

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <LocalEditorPage />
    </div>
  )
}

function FloatConvert(): JSX.Element {
  // Unlike the local editor, this needs no library load — the convert dialog
  // only wants id/path/title, and all three ride the URL params as strings
  // (see ConvertTarget). Seed the store's convertModal from them, and keep
  // following float-params so "Convert format" on another track retargets
  // this window instead of stacking a second one.
  useEffect(() => {
    const apply = (p: Record<string, string | null>): void => {
      if (!p?.trackId || !p?.filePath) return
      useStore.setState({ convertModal: { id: p.trackId, path: p.filePath, title: p.title || '' } })
    }
    apply({ trackId: initialParam('trackId'), filePath: initialParam('filePath'), title: initialParam('title') })
    return el?.onFloatParams?.((p: Record<string, string>) => apply(p))
  }, [])

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <ConvertFormatModal floating />
    </div>
  )
}

// The staff profile in its own window: proposals, comp files, reports and the
// admin panel, all of which live inside EditorProfileView / ContributorProfile-
// View exactly as they do in-app. Which of the two renders is derived from the
// account, so a role change (or the account arriving late over windowSync)
// lands on the right one without the window being reopened.
function FloatProfile(): JSX.Element {
  const { account } = useStorePick('account')

  // The account normally arrives in the boot snapshot from the main window,
  // but a pop-out can outlive a sign-out/refresh — reload it here so the
  // window recovers on its own instead of sitting empty.
  useEffect(() => { useStore.getState().loadAccount() }, [])

  if (!account) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }
  if (!showStaffProfile(account)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
        <p className="text-text-primary text-sm font-semibold">No staff profile on this account</p>
        <p className="text-text-muted text-xs">Sign in with an editor, contributor, manager or admin account.</p>
      </div>
    )
  }
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      {staffProfileView(account) === 'contributor-profile' ? <ContributorProfileView /> : <EditorProfileView />}
    </div>
  )
}

// The admin console in its own window. The section rides in as ?tab= and,
// for a window that's already open, over float-params - AdminPage follows
// activeAdminTab while floating, so retargeting switches the section in place
// instead of remounting every tab's loaded data.
function FloatAdmin(): JSX.Element {
  const { account } = useStorePick('account')
  const [bootTab] = useState(() => (initialParam('tab') as AdminTab | null) ?? undefined)

  useEffect(() => { useStore.getState().loadAccount() }, [])
  useEffect(() => el?.onFloatParams?.((p: Record<string, string>) => {
    if (p?.tab) useStore.getState().setActiveAdminTab(p.tab as AdminTab)
  }), [])

  if (!account) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <AdminPage initialTab={bootTab} />
      <AppToastHost />
    </div>
  )
}

// Shell for floating pop-out windows: main.js createFloatWindow opens a second
// frameless BrowserWindow on the same bundle with ?float=<view> (+ params),
// and main.tsx mounts this instead of <App/> — a single view filling the whole
// window, with store state mirrored to the main window by lib/windowSync.
export default function FloatApp({ view }: { view: string }): JSX.Element {
  useThemeEffects()

  // The library track list is too big to mirror through the sync channel —
  // load it from disk so Settings → Library shows real track counts, and so
  // the local editor pop-out can look its target track up by id.
  useEffect(() => {
    if (view === 'settings' || view === 'local-editor') useStore.getState().loadLibrary()
  }, [view])

  return (
    // The equalizer pop-out matches the in-app popover's surface (bg-surface-
    // highest) so detaching it doesn't visibly change the panel's color.
    <div className={`h-dvh overflow-hidden flex flex-col ${view === 'equalizer' ? 'bg-surface-highest' : 'bg-surface'}`}>
      {(view === 'editor' || view === 'local-editor' || view === 'equalizer' || view === 'profile' || view === 'admin') && <FloatTitleBar bordered={view !== 'editor'} />}
      {/* A pop-out's view is the whole window's content, so an uncaught render
          error left nothing but a blank window with no way back — the boundary
          keeps the error (and its stack) visible and reloadable in place. */}
      <ErrorBoundary>
        <Suspense fallback={null}>
          {view === 'settings' ? <Settings floating />
            : view === 'song-info' ? <FloatSongInfo />
            : view === 'editor' ? <FloatEditor />
            : view === 'local-editor' ? <FloatLocalEditor />
            : view === 'mini-player' ? <MiniPlayer />
            : view === 'convert' ? <FloatConvert />
            : view === 'profile' ? <FloatProfile />
            : view === 'admin' ? <FloatAdmin />
            : view === 'equalizer' ? (
              <div className="flex-1 min-h-0 overflow-y-auto flex justify-center">
                <EqualizerPanel floating />
              </div>
            )
            : null}
        </Suspense>
      </ErrorBoundary>
      {/* Report dialog opened from a pop-out (Settings feedback, or a song
          info report) — reportModal is per-window state, so the pop-out mounts
          its own instance rather than routing to the main window. */}
      <ReportModal />
      {/* Same for "Submit cover art" from a pop-out's song info. */}
      <CoverArtSubmitModal />
      {/* Convert dialog opened from *another* pop-out (with the convert pop-out
          setting off, openConvert falls back to an in-app dialog). The convert
          window itself renders it as its own view above, so skip it there. */}
      {view !== 'convert' && <ConvertFormatModal />}
    </div>
  )
}
