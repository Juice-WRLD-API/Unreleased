import { useStore, IS_FLOAT_WINDOW, type AppStore } from '../store/useStore'
import { staffProfileView } from './userApi'
import { setSongPrefsCache } from './songPrefs'
import { setCustomSkinsCache } from './skins'
import type { ViewType, LibraryTrack } from '../types'

// State mirrored between the main window and pop-out windows (see FloatApp).
// Each window runs its own renderer process with its own store instance, so
// anything a pop-out can read or change has to be relayed over IPC (the main
// process fans 'window-sync' messages out to every other window). Only plain
// serializable keys belong here — per-window UI state (activeView,
// showSettings, downloads…) stays local to each window, and the library
// track list is deliberately absent: it's reloaded from disk instead
// (see the libraryLastScanned handling below).
const SYNC_KEYS = [
  'theme', 'customSkins', 'accentColor', 'sidebarPosition', 'navOrder', 'navVisibility', 'appMenuPosition',
  'navControlOrder', 'navControlVisibility', 'settingsTab',
  'appTextScale', 'lyricsScale', 'lyricsAlign', 'lyricsBlur', 'appFont', 'lyricsFont', 'gradientsEnabled', 'surfaceGradientsEnabled',
  'lyricsColorActive', 'lyricsColorInactive', 'lyricsBlurAmount', 'lyricsOverride', 'fullEraNames',
  'crossfadeEnabled', 'crossfadeDuration', 'pauseFadeEnabled', 'preferOgVersion', 'rememberQueue',
  // Last.fm connect/disconnect can happen in the pop-out Settings window; the
  // session itself is in shared localStorage, but the scrobbler (main window
  // only) keys off these store fields, so they must be mirrored.
  'lastfmUser', 'lastfmEnabled',
  'popoutWindows',
  'hotkeyBindings', 'hotkeySeekSeconds', 'globalHotkeysEnabled',
  'playbackSpeed', 'lyricsOffset', 'audioOutput', 'sleepTimerEnd',
  // Full equalizer/effects state, so the EQ pop-out window's controls drive
  // the main window's audio chain (only the main window owns audio elements).
  'eqEnabled', 'eqGains', 'eqPreset', 'eqBalance', 'eqMono', 'eqBoost', 'audioFx', 'eqUserPresets', 'skipSilence',
  'reverbEnabled', 'reverbMix', 'reverbDecay', 'pitchShift', 'communityEdits',
  // A-B loop points — set from either window, enforced only by the main
  // window's audio (it owns the elements), same reasoning as the effects row
  // above.
  'abLoopStart', 'abLoopEnd',
  // `listeningPlays` is deliberately absent for the same reason libraryTracks
  // is: it's a few thousand rows that grow on every credited play, and only
  // the main window ever appends to it. Pop-outs read it back from shared
  // localStorage when they need it (nothing outside StatsView does).
  'likedTrackIds', 'songPrefs', 'playlistFolders', 'account', 'playlists',
  // Pop-outs (Settings' Feedback tab, a song's "Report issue") queue into
  // their own store instance — without this, that report only ever reaches
  // localStorage and just sits there, since _flushReports deliberately no-ops
  // outside the main window (see the delivery trigger below and the store's
  // report outbox comment for why only the main window may send).
  'pendingReports',
  // "Edit" on one of your own proposals, from the profile pop-out: the target
  // song and the proposal's draft data are staged here, then the main window
  // is asked to open the editor. Without mirroring them it would arrive with
  // nothing pending and prefill from whatever happened to be playing. Both are
  // plain serializable one-shot handoffs, and EditorPage clears them on use.
  'pendingEditorSongId', 'pendingEditProposal',
  'libraryFolders', 'libraryAutoRefresh', 'libraryScanning', 'libraryLastScanned',
  'developerMode', 'updateStatus',
  // Playback mirror for the mini-player pop-out. The MAIN window owns the
  // audio elements and all queue logic — pop-outs treat these keys as
  // read-only display state and send playback *commands* back instead of
  // mutating them (see sendPlayerCommand below). `volume` is the one
  // exception: the main Player's [volume] effect applies remote changes to
  // the audio element, so pop-outs may call setVolume directly.
  'currentTrack', 'currentTrackFull', 'isPlaying', 'progress', 'currentTime',
  'queue', 'queueIndex', 'shuffle', 'repeat', 'volume',
  'radioMode', 'radioNext', 'queueLoadingMore',
  'radioFmActive', 'radioFmNowPlaying', 'radioFmMatchedSong', 'radioFmUpNext', 'radioFmQueuePreview',
  // Without these a pop-out mini-player never sees a ballot at all, and its FM
  // badge can't tell "offline" from "not checked yet".
  'radioFmIsLive', 'radioFmVote', 'radioFmVoteDismissed',
  // Desktop settings: Settings can be popped out, but only the main window
  // drives the light and the desktop widgets.
  'desktop',
] as const satisfies readonly (keyof AppStore)[]

type SyncKey = (typeof SYNC_KEYS)[number]
type SyncPatch = Partial<Pick<AppStore, SyncKey>>

// A floating pop-out asking the main window to re-open its page docked in-app
// (the "attach" button — inverse of detach). The main window opens the in-app
// equivalent and the float then closes itself.
type AttachTarget =
  | { view: 'settings' }
  | { view: 'editor'; songId: number }
  | { view: 'song-info'; songId: number }
  | { view: 'local-editor'; trackId: string }
  // The staff profile carries no target of its own — which of the two profile
  // views to show is derived from the account, so the main window works it out
  // rather than trusting a view name off the wire.
  | { view: 'profile' }

type SyncMessage =
  | { type: 'patch'; payload: SyncPatch }
  | { type: 'snapshot'; payload: SyncPatch }
  | { type: 'request' }
  | { type: 'navigate'; view: ViewType }
  | { type: 'attach'; target: AttachTarget }
  | { type: 'command'; cmd: string; arg?: unknown }
  // A local-file metadata edit saved in one window — libraryTracks itself is
  // too big for the blanket SYNC_KEYS mirror, but a single-track patch is
  // cheap, so this keeps other open windows (e.g. the main window's Library
  // tab behind a pop-out local editor) from showing stale metadata until
  // their next rescan.
  | { type: 'library-patch'; id: string; updates: Partial<LibraryTrack> }
  // A brand-new local file appearing in one window (the convert pop-out writing
  // a transcoded file). Same reasoning as library-patch — one whole track is
  // cheap to ship, and without it the main window's Library wouldn't show the
  // new file until its next rescan.
  | { type: 'library-add'; track: LibraryTrack }

// Playback commands from pop-outs land here — the main window's Player
// registers its dispatch table (the same one the tray menu uses) so remote
// controls go through the exact same code paths as the on-screen buttons.
let playerCommandHandler: ((cmd: string, arg?: unknown) => void) | null = null

export function registerPlayerCommandHandler(handler: (cmd: string, arg?: unknown) => void): () => void {
  playerCommandHandler = handler
  return () => { if (playerCommandHandler === handler) playerCommandHandler = null }
}

// Run a playback command inside the main renderer. Views such as WRLD render
// their own transport controls, but the Player owns the real audio elements,
// crossfade state, and restart semantics. Routing through this bridge keeps
// those controls on the same path as the tray, hotkeys, and mini-player.
export function runPlayerCommand(cmd: string, arg?: unknown): void {
  playerCommandHandler?.(cmd, arg)
}

// Ask the main window to perform a playback action (play-pause, next, seek…).
// Pop-outs never drive the queue/audio themselves — the main window executes
// the command and the resulting state syncs back through the patch channel.
export function sendPlayerCommand(cmd: string, arg?: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  el?.windowSyncSend?.({ type: 'command', cmd, arg })
}

// True while applying a remote patch, so the store subscription below doesn't
// echo it straight back and ping-pong between windows forever.
let applyingRemote = false

function snapshot(): SyncPatch {
  const state = useStore.getState()
  const out: Record<string, unknown> = {}
  for (const key of SYNC_KEYS) out[key] = state[key]
  return out as SyncPatch
}

export function initWindowSync(isFloat: boolean): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  if (!el?.onWindowSync) return

  useStore.subscribe((state, prev) => {
    if (applyingRemote) return
    const patch: Record<string, unknown> = {}
    for (const key of SYNC_KEYS) {
      if (state[key] !== prev[key]) patch[key] = state[key]
    }
    if (Object.keys(patch).length > 0) el.windowSyncSend({ type: 'patch', payload: patch })
  })

  el.onWindowSync((msg: SyncMessage) => {
    if (msg.type === 'patch' || msg.type === 'snapshot') {
      applyingRemote = true
      try { useStore.setState(msg.payload) } finally { applyingRemote = false }
      // A scan finishing in the other window just saved library-data.json —
      // reload it so this window's track list isn't stale (the tracks
      // themselves are far too big to ship through the sync channel).
      if ('libraryLastScanned' in msg.payload) useStore.getState().loadLibrary(true)
      // setState writes the store directly, bypassing _setSongPrefs — so the
      // module cache songToTrack reads has to be mirrored by hand here, or a
      // rename made in one window would leave every other window converting
      // songs against stale overrides.
      if ('songPrefs' in msg.payload) setSongPrefsCache(msg.payload.songPrefs ?? {})
      // Same as songPrefs: setState bypasses saveCustomSkin, so mirror the
      // module cache getSkin() reads or the other window would style custom
      // skins against a stale (or empty) list.
      if ('customSkins' in msg.payload) setCustomSkinsCache(msg.payload.customSkins ?? [])
      // A pop-out just queued (or the main window's own outbox otherwise
      // changed) — only the main window actually sends (see _flushReports),
      // so it's the one that needs to react and attempt delivery.
      if (!isFloat && 'pendingReports' in msg.payload) useStore.getState()._flushReports()
    } else if (msg.type === 'request') {
      // Pop-outs boot with localStorage-persisted values only; the main
      // window answers with the live session state (account, update status…).
      if (!isFloat) el.windowSyncSend({ type: 'snapshot', payload: snapshot() })
    } else if (msg.type === 'command') {
      if (!isFloat) playerCommandHandler?.(msg.cmd, msg.arg)
    } else if (msg.type === 'navigate') {
      if (!isFloat) useStore.getState().setActiveView(msg.view)
    } else if (msg.type === 'attach') {
      if (!isFloat) {
        const s = useStore.getState()
        const t = msg.target
        // setState directly (not the setShowSettings/openSongEditor actions)
        // so we force the in-app view even when that page's auto-pop-out is on.
        if (t.view === 'settings') useStore.setState({ showSettings: true })
        else if (t.view === 'profile') s.setActiveView(staffProfileView(useStore.getState().account))
        else if (t.view === 'editor') { useStore.setState({ pendingEditorSongId: t.songId }); s.setActiveView('editor') }
        else if (t.view === 'song-info') s.setInfoSongId(t.songId)
        else if (t.view === 'local-editor') {
          // The main window may not have the library loaded yet (e.g. it never
          // visited the Library tab this session) — loadLibrary() no-ops if it
          // already has it, so this is cheap in the common case.
          s.loadLibrary().then(() => {
            const track = useStore.getState().libraryTracks.find((tr) => tr.id === t.trackId)
            if (track) useStore.setState({ pendingLocalEditTrack: track })
          })
          s.setActiveView('local-editor')
        }
      }
    } else if (msg.type === 'library-patch') {
      useStore.getState().updateLibraryTrack(msg.id, msg.updates)
    } else if (msg.type === 'library-add') {
      useStore.getState().addLibraryTrack(msg.track)
    }
  })

  if (isFloat) el.windowSyncSend({ type: 'request' })
}

// Tell every other open window about a local-file metadata edit, so a Library
// tab left open behind a pop-out local editor doesn't show stale data once
// the pop-out saves. Caller applies the same patch to its own store first —
// this only relays it onward.
export function broadcastLibraryTrackUpdate(id: string, updates: Partial<LibraryTrack>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  el?.windowSyncSend?.({ type: 'library-patch', id, updates })
}

// Tell every other open window about a newly created local file (a converted
// track), so a Library tab open elsewhere picks it up without a rescan. Caller
// adds it to its own store first — this only relays it onward.
export function broadcastLibraryTrackAdd(track: LibraryTrack): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  el?.windowSyncSend?.({ type: 'library-add', track })
}

// Ask the main window to switch views (e.g. the pop-out Settings' "API Docs"
// button) — a pop-out renders a single view and can't navigate itself.
export function navigateMainWindow(view: ViewType): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  el?.windowSyncSend?.({ type: 'navigate', view })
  el?.focusMainWindow?.()
}

/** Navigate to `view` from whichever window is asking.
 *
 *  In the main window this is a plain setActiveView. In a pop-out — which
 *  renders the single view its URL names and has no router — setActiveView
 *  would silently do nothing, so this hands the navigation to the main window
 *  and focuses it. Use it for any in-page link that leaves the current view
 *  from a component that can render inside a pop-out. */
export function navigateFromWindow(view: ViewType): void {
  if (IS_FLOAT_WINDOW) { navigateMainWindow(view); return }
  useStore.getState().setActiveView(view)
}

// "Attach" a floating pop-out back into the main window: ask the main window to
// open the docked in-app equivalent, then focus it. The caller closes its own
// float window afterwards (el.closeSelf).
export function attachToMainWindow(target: AttachTarget): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  el?.windowSyncSend?.({ type: 'attach', target })
  el?.focusMainWindow?.()
}
