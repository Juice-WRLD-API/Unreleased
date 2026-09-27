import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { ViewType, Track, FullTrack, LibraryTrack, LocalPlaylist, FollowedPlaylist, DonorPlaylist, OfflineTrackMeta, OfflinePlaylistEntry, ConvertTarget } from '../types'
import { APP_VERSION } from '../lib/appVersion'
import { ls } from '../lib/persist'
import * as userApi from '../lib/userApi'
import type { AccountUser, PlaylistSummary } from '../lib/userApi'
import * as preferencesApi from '../lib/preferencesApi'
import * as profilePushApi from '../lib/profilePushApi'
import { apiFetch, apiPeek, buildStreamUrl, buildImageUrl, parseDuration, resolvePrefCoverUrl, fetchChannels } from '../lib/juicewrldApi'
import type { JWApiSong, JWApiChannel } from '../lib/juicewrldApi'
import {
  emptySongPref, isEmptySongPref, normalizePrefText, setSongPrefsCache,
} from '../lib/songPrefs'
import type { SongPreference, SongPrefMap, SongPrefPatch } from '../lib/songPrefs'

// AdminPage's own tab set (see its local `Tab` type) — duplicated here rather
// than imported so the store doesn't depend on a component file; keep in sync.
export type AdminTab = 'proposals' | 'comp-proposals' | 'applications' | 'reports' | 'users' | 'stats' | 'eras' | 'security' | 'channels' | 'cdn-nodes'
import { peekRotatedCover } from '../lib/coverRotation'
import { advanceRotatedCover, resetCoverRotation } from '../lib/coverSuggestions'
import { peekEraCover, setEraCoverRaw } from '../lib/eraCovers'
import { setActiveChannelCache } from '../lib/activeChannelState'
import {
  appendListeningPlay,
  mergeListeningPlays,
  normalizeListeningPlayEvent,
} from '../lib/listeningPlays'
import type { ListeningPlayEvent } from '../lib/listeningPlays'
import * as reportsApi from '../lib/reportsApi'
import { newReportId, isDeliverable } from '../lib/reports'
import type {
  PendingReport, ReportTarget, FeedbackCategory, SongIssueType,
} from '../lib/reports'
import * as foldersApi from '../lib/foldersApi'
import { newFolderId, normalizeFolderName, pruneFolders } from '../lib/playlistFolders'
import type { PlaylistFolder, ServerPlaylistFolder } from '../lib/playlistFolders'
import { createQueueSlice, QueueSlice } from './queueSlice'
import { getSkin, setCustomSkinsCache, type Skin, type SkinId } from '../lib/skins'
import type { GifResult } from '../lib/gifApi'
import { listDonorFiles } from '../lib/donorFilesApi'
import type { DonorFile } from '../lib/donorFilesApi'
import { getFont } from '../lib/fonts'
import { EQ_BANDS, EQ_PRESETS, FLAT_GAINS } from '../lib/audioEffects'
import type { CommunityEdit } from '../lib/audioEffects'
import { HOTKEY_ACTIONS, effectiveBinding, effectiveGlobalBinding, defaultGlobalBinding } from '../lib/hotkeys'
import { DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY, DEFAULT_NAV_CONTROL_ORDER, DEFAULT_NAV_CONTROL_VISIBILITY } from '../lib/navItems'
import { DEFAULT_HOME_SECTION_VISIBILITY } from '../lib/homeSections'
import { getLastfmSession } from '../lib/lastfm'
import { runWhenIdle } from '../lib/platform'
import { useSandboxStore } from '../components/Modal'

// Key used to track songs downloaded individually (song context menu ?
// "Download offline"), rather than through a synced playlist. It's just
// another entry in `offlinePlaylists`/main's `lib.playlists`, so a song
// downloaded this way survives the same-name pruning that offline-set-playlist
// runs after every real playlist sync � without this, an individually-
// downloaded track would look "unreferenced" the next time any playlist
// resyncs and get deleted out from under the user.
const INDIVIDUAL_DOWNLOADS_KEY = 'individual-downloads'

// True when this renderer is a pop-out window (FloatApp, ?float=<view>).
// Pop-outs share localStorage with the main window, so only the main window
// may flush the report outbox � the live endpoints have no idempotency key,
// so two windows flushing the same queue would double-send every report.
export const IS_FLOAT_WINDOW = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('float')

// Lightweight localStorage persistence helper � see lib/persist.ts (it lives
// there so queueSlice can share it without importing this module back).

// --- Download item (in-session, Electron only) --------------------------------

export interface DownloadItem {
  id: string
  filename: string
  // 'upload' is the one that goes the other way � a comp file proposal's body
  // on its way to the API (see lib/compUploads).
  type: 'file' | 'zip' | 'update' | 'playlist' | 'upload'
  state: 'downloading' | 'done' | 'error' | 'cancelled'
  percent: number
  received?: number
  total?: number
  savePath?: string
  error?: string
  // Byte-level size/throughput info, shown alongside the track-count or
  // percent progress above � `bytesReceived` is cumulative bytes actually
  // written to disk so far (across every file, for multi-file downloads),
  // `speedBps` is a live bytes/sec sample (undefined between samples/when idle).
  bytesReceived?: number
  speedBps?: number
}

// --- Staged file change (in-session) -------------------------------------------
//
// A contributor dragging rows around in ApiFilesView doesn't propose anything
// on drop: the intended move/folder-create is parked here, the Downloads panel
// lists what's queued, and one "Propose" there submits the lot (see
// lib/compStagedChanges). Dragging is cheap to do by accident, and a reorganize
// is usually several drags that only make sense together, so proposing each
// one the instant it lands would spam reviewers with half a move.
export interface StagedFileChange {
  id: string
  /** The subset of comp proposal change types drag-and-drop can produce. */
  changeType: 'move' | 'move_folder' | 'create_folder'
  /** Source path - the file/folder being moved, or the folder to create. */
  path: string
  /** Full destination path; absent for create_folder. */
  destination?: string
  /** Channel slug the change belongs to, since the Files tab can switch
   *  channels with changes still queued and each proposal carries its own. */
  channel: string
  /** Set when a propose attempt failed, so the row can show why and stay
   *  queued for a retry. Cleared on the next attempt. */
  error?: string
}

// Where the desktop nav menu sits � classic left sidebar, mirrored right, or a
// horizontal bar above/below the content. Mobile always uses the bottom tab bar.
export type SidebarPosition = 'left' | 'right' | 'top' | 'bottom'

// Where the File/Edit/View� app-menu button lives (desktop only): the floating
// title-strip pill, tucked inside the side menu, or off entirely.
export type AppMenuPosition = 'title-bar' | 'sidebar' | 'hidden'

// The Settings dialog's tabs � the union Settings.tsx keys its content off, and
// the target for a deep-link open (see settingsTab). Keep in sync with the
// `tab` state there.
export type SettingsTab = 'appearance' | 'playback' | 'shortcuts' | 'library' | 'app' | 'developer' | 'feedback' | 'about'

// The detached ("pop-out") BrowserWindows the desktop build can open instead of
// rendering a view inline (see FloatApp). Each can be turned off individually:
// for settings/songInfo/editor that falls back to the in-app overlay, and for
// miniPlayer (which has no in-app equivalent) it hides the pop-out entry point.
export type PopoutWindowKind = 'settings' | 'songInfo' | 'editor' | 'localEditor' | 'miniPlayer' | 'convert' | 'equalizer' | 'profile'
// `equalizer` defaults OFF � unlike the others (which start life as pop-outs
// and fall back to inline when disabled), the equalizer's normal home is the
// in-app popover; turning it on makes the panel open as its own window.
const POPOUT_WINDOW_DEFAULTS: Record<PopoutWindowKind, boolean> = {
  settings: true, songInfo: true, editor: true, localEditor: true, miniPlayer: true, convert: true, equalizer: false,
  // Review work (proposals, comp files, reports) is the one place people keep
  // a page open *while* using the rest of the app � checking a song against
  // the proposal editing it, playing what they're about to approve. Its own
  // window is the point, so this starts on; the toggle in Settings ? Windows
  // sends it back to the in-app tab.
  profile: true,
}

// --- Non-queue state ----------------------------------------------------------

interface AppState {
  // Playback extras (not queue-managed)
  currentTrackFull: FullTrack | null
  volume: number
  playbackSpeed: number
  // Equalizer / audio effects (see lib/audioEffects.ts for the actual graph).
  // eqGains holds one dB value per EQ_BANDS entry; eqPreset is the preset id
  // those gains came from ('custom' once a slider is moved by hand).
  eqEnabled: boolean
  eqGains: number[]
  eqPreset: string
  // -1 = full left � 1 = full right
  eqBalance: number
  eqMono: boolean
  // 1 = 100% (unity, off) .. EQ_BOOST_MAX = 200%.
  eqBoost: number
  skipSilence: boolean
  // Reverb (convolution tail; see lib/audioEffects.ts) � independently
  // toggleable; mix/decay keep their values while off.
  reverbEnabled: boolean
  reverbMix: number
  reverbDecay: number
  // Let the pitch follow the rate (preservesPitch off) � slowed feel below
  // 1x, sped-up/nightcore feel above. Combine with reverb for slowed+reverb.
  pitchShift: boolean
  // A-B loop: repeat a marked portion of the current track. Both null = no
  // loop. Deliberately NOT persisted to localStorage (a saved position only
  // makes sense for the track it was set on) � cleared on every track change
  // (see Player's currentTrack?.id effect) but still mirrored over
  // window-sync so the pop-out equalizer's controls reach the playing audio.
  abLoopStart: number | null
  abLoopEnd: number | null
  // Community-shared effect configs, shown next to the EQ presets. Stays
  // empty until the API endpoints for them exist � a future fetch populates
  // it; nothing is persisted locally.
  communityEdits: CommunityEdit[]
  // Seconds added to the lookup time when matching synced (LRC) lyric lines �
  // positive shifts lyrics later (delays them), negative shifts them earlier,
  // compensating for lyric files that aren't quite in step with the audio.
  lyricsOffset: number

  // UI
  activeView: ViewType
  // The view that was active immediately before the current one � lets a page
  // like the editor send its back button/redirects to wherever the user
  // actually came from instead of a hardcoded destination.
  previousView: ViewType | null
  // Which AdminPage tab to land on next time activeView becomes 'admin' — set
  // by the Editor/Contributor profile's Admin tile stat boxes so a click deep
  // links straight to that queue instead of always landing on the default tab.
  activeAdminTab: AdminTab | null
  showNowPlaying: boolean
  showSettings: boolean
  // Which Settings tab to show on next open (deep-link from the app menu, e.g.
  // "Keyboard shortcuts" ? the Shortcuts tab). Settings applies it then clears
  // it back to null. Synced so it also reaches the pop-out Settings window.
  settingsTab: SettingsTab | null
  showDiagnostics: boolean
  showQueue: boolean
  // Equalizer popover visibility. Store-level (not Player-local) so the WRLD
  // tab's button and the 'equalizer' hotkey can open it from anywhere � the
  // always-mounted Player owns the actual portal.
  showEqPanel: boolean
  // Pop-out views currently open (from main's 'float-windows' broadcast).
  // Per-window state, deliberately NOT synced: it's pushed to every window
  // already, and mirroring it would fight that.
  openFloatViews: string[]
  // Song whose info modal is shown by the main window's global host (App's
  // <GlobalSongInfoHost>). Only used to "attach" a floating song-info window
  // back into the main window � the per-view list modals keep their own local
  // state. null = nothing shown.
  infoSongId: number | null
  // Desktop bottom player collapsed to a slim strip to reclaim vertical space.
  playerCollapsed: boolean
  // True while the WRLD tab's own in-page fullscreen (album-art focus mode)
  // is active � lets App.tsx hide the frameless-window title bar controls,
  // which would otherwise float over the immersive view.
  wrldFullscreen: boolean
  radioFmActive: boolean
  radioFmIsLive: boolean | null  // null = unknown (not yet checked)
  radioFmNowPlaying: import('../lib/radioLive').RadioTrack | null
  radioFmVote: import('../lib/radioLive').RadioVote | null
  // Shared so dismissing a ballot sticks across the WRLD panel, the floating
  // popup, and pop-out windows. Reset centrally on the rising edge of a new
  // vote (see RadioFmPlayer's onMeta) rather than per component.
  radioFmVoteDismissed: boolean
  radioFmUpNext: import('../lib/radioLive').RadioTrack | null
  radioFmQueuePreview: string[]
  radioFmMatchedSong: { songId: number | null; imageUrl: string | null; path: string | null; lyrics: string | null; syncedLyrics: string | null; era: string | null } | null
  theme: SkinId
  // User-created skins (built in the in-app editor or imported). Local-first
  // and persisted; mirrored into lib/skins' module cache on every write so
  // getSkin() resolves them everywhere. Synced across windows (windowSync).
  customSkins: Skin[]
  sidebarPosition: SidebarPosition
  appMenuPosition: AppMenuPosition
  // User-defined order of the primary side-menu nav items, by view id. Only
  // ever a permutation of the known ids � orderedNavItems() sanitizes it on
  // read, so a stale/partial saved order can't drop or duplicate a tab.
  navOrder: ViewType[]
  // Per-item side-menu visibility (view id ? shown). Sparse overrides merged
  // onto DEFAULT_NAV_VISIBILITY; isNavItemVisible() falls back to each item's
  // own default for anything absent, so lets the user hide built-ins and add
  // the off-by-default extras.
  navVisibility: Record<string, boolean>
  // Per-section show/hide for the Home dashboard, same model as navVisibility.
  homeSectionVisibility: Record<string, boolean>
  // Order + visibility for the foot-of-menu controls (Profile, Log out,
  // Diagnostics, Download, Settings) � same model as navOrder/navVisibility.
  navControlOrder: string[]
  navControlVisibility: Record<string, boolean>

  // Settings
  crossfadeEnabled: boolean
  crossfadeDuration: number
  // Ramp volume down briefly on pause (and back up on resume) instead of
  // cutting the audio off instantly.
  pauseFadeEnabled: boolean
  sleepTimerEnd: number | null
  audioOutput: string
  accentColor: string
  // Text settings. appTextScale multiplies the root font-size (Tailwind's
  // rem-based sizes/spacing follow it, so it acts as an app-wide text zoom);
  // the lyrics* keys style synced/plain lyrics in LyricsDisplay and the WRLD
  // tab's lyrics panel.
  appTextScale: number
  // Font-stack ids from lib/fonts.ts � appFont styles the whole UI,
  // lyricsFont only the lyric panels (so lyrics can differ from the chrome).
  appFont: string
  lyricsFont: string
  lyricsScale: number
  lyricsAlign: 'left' | 'center'
  // Soften every synced line except the one currently playing with a slight
  // blur (on by default) � played and upcoming lines alike.
  lyricsBlur: boolean
  // Manual override of the auto show/hide behavior — Shift+L flips it. XORed
  // against whether the current track actually has lyrics, so it can either
  // hide a lyrics section that would otherwise show, or reveal the "no
  // lyrics" placeholder for a track that has none.
  lyricsOverride: boolean
  // Show eras by their full name ("WRLD On Drugs") instead of the API's
  // abbreviation ("WOD") wherever the Tracker displays one.
  fullEraNames: boolean
  // Strength of that blur, as a multiplier on each surface's own base radius
  // (the WRLD tab blurs less than the now-playing/mini panels, and a
  // multiplier keeps that relationship intact at every setting). 1 = the
  // amount every version before this shipped.
  lyricsBlurAmount: number
  // Custom colors for synced lyric lines � the line currently being sung, and
  // the rest (already-played + upcoming). null = auto, i.e. keep the surface's
  // own colors (theme text vars in LyricsDisplay, art-derived ones in the WRLD
  // tab), which is what every install had before these existed.
  lyricsColorActive: string | null
  lyricsColorInactive: string | null
  // Accent-tinted gradient washes on the app shell/sidebar/player and a sheen
  // on accent buttons (index.css `html.gradients` rules; class applied by
  // useThemeEffects). They ride the accent vars, so the Now Playing skin's
  // song accent recolors them too.
  gradientsEnabled: boolean
  // Same idea as gradientsEnabled but scoped to flat bg-surface-overlay boxes
  // (toggle groups, search bars, badges, menus) � split out as its own toggle
  // since those boxes are everywhere, and someone who likes the shell/sidebar/
  // player gradients may not want every small pill tinted too.
  surfaceGradientsEnabled: boolean
  // WRLD tab only. Off (the default) it paints itself from the playing song's
  // cover � blurred art behind, text color picked from the art's brightness.
  // On, it drops both and uses the app's own skin instead: theme surface
  // behind, theme text colors on top, so the tab stops recoloring itself every
  // track.
  wrldThemeBackground: boolean
  // When enabled, if a track has a linked "OG" version (same song, grouped via
  // the versions system, labeled e.g. "OG"/"OG File"), play that version's
  // file instead of the currently selected one.
  preferOgVersion: boolean
  // When enabled, a song with no cover the user picked themselves shows a
  // different one of the API storage's suggestions on each play (see
  // lib/coverRotation). Songs with a custom cover, and songs the storage has
  // no images for, are unaffected.
  rotateSuggestedCovers: boolean
  // Per-era cover overrides (see lib/eraCovers): a cover the user picks for
  // an era replaces the API's shared placeholder on every unreleased song in
  // that era. Released songs, and songs with their own personal cover or a
  // rotated suggestion, are unaffected � see applyPrefToTrack's precedence.
  eraCovers: Record<string, string>
  // Desktop (Electron/Windows) only. When disabled, the app stops publishing
  // Media Session metadata/action handlers, which stops Windows from popping
  // up its System Media Transport Controls overlay on media-key presses.
  mediaOverlayEnabled: boolean
  // Last.fm scrobbling. `lastfmUser` mirrors the saved session's username
  // (null = not connected; the session key itself lives in lib/lastfm's own
  // localStorage entry). `lastfmEnabled` pauses scrobbling without
  // disconnecting the account.
  lastfmUser: string | null
  lastfmEnabled: boolean
  // Per-kind toggles for the detached pop-out windows (desktop only). Disabling
  // one keeps the feature working � it just renders inline in the main window
  // instead (or, for the mini player, hides the pop-out button).
  popoutWindows: Record<PopoutWindowKind, boolean>

  // Keyboard shortcuts. `hotkeyBindings` holds only user *overrides* of the
  // defaults in lib/hotkeys.ts (actionId ? combo; an explicit '' means the
  // user cleared that shortcut). `hotkeySeekSeconds` is the jump size for the
  // skip-forward / skip-backward shortcuts.
  hotkeyBindings: Record<string, string>
  hotkeySeekSeconds: number
  // When on (desktop only), the global bindings below are also registered
  // OS-wide so they work while the app is in the background.
  globalHotkeysEnabled: boolean
  // The OS-global binding per action, independent of `hotkeyBindings` (the
  // in-app one) � actionId ? combo override, same shape and semantics as
  // hotkeyBindings (an explicit '' means the user cleared it). See
  // lib/hotkeys effectiveGlobalBinding / defaultGlobalBinding.
  globalHotkeyBindings: Record<string, string>

  // Liked songs
  likedTrackIds: string[]

  // Per-song user overrides (custom name, custom cover, preferred version,
  // playcount), keyed by numeric API song id. Local-first like likedTrackIds:
  // usable logged out, merged up to the server on login. Every write goes
  // through _setSongPrefs so the lib/songPrefs cache � which songToTrack reads
  // and which can't import this store without a cycle � stays in step.
  songPrefs: SongPrefMap

  // Timestamped play history � one row per credited play (see
  // lib/listeningPlays). songPrefs' aggregate playcounts remain the all-time
  // source of truth; this exists so StatsView can answer "last 7/30 days" and
  // show a recent-plays timeline, which absolute counters can't.
  listeningPlays: ListeningPlayEvent[]

  // In-app reports (feedback + song issue reports). `pendingReports` is a
  // persisted outbox: a report is queued locally on submit and delivered when
  // the endpoints exist and the network is reachable (see lib/reportsApi's
  // reportsApiEnabled), so nothing is lost while the backend is still pending.
  // `reportModal` is the open report dialog's target (null = closed).
  pendingReports: PendingReport[]
  reportModal: ReportTarget | null

  // `convertModal` is the local track whose "Convert format" dialog is open
  // (null = closed). See components/ConvertFormatModal.
  convertModal: ConvertTarget | null

  // Whether the "Import from URL" dialog is open. See
  // components/UrlImportModal.
  urlImportModal: boolean

  // Playlist folders � a local-first grouping over both synced and local
  // playlists (keyed by "api:<id>"/"local:<id>"). Persisted to localStorage and
  // usable logged out; synced-playlist membership syncs to the account once the
  // endpoints exist (see lib/foldersApi). See lib/playlistFolders.
  playlistFolders: PlaylistFolder[]

  // API tracker extras
  apiTrackerCategory: string
  apiTrackerEra: string
  // One-shot deep link consumed by ApiTrackerView on mount to pick which tab
  // (Songs/Lyrics/Overview/Producers) opens - see StatisticsView's tab bar,
  // the only current setter.
  apiTrackerTab: string
  apiFilesPath: string
  apiFilesLastPath: string

  channels: JWApiChannel[]
  activeChannel: string
  setActiveChannel: (slug: string) => void
  loadChannels: () => Promise<void>

  // Account
  account: AccountUser | null
  playlists: PlaylistSummary[]
  showUserAuth: boolean

  // Sidebar ? PlaylistsView: open a specific playlist without needing a URL
  // round-trip (works whether PlaylistsView is already mounted or not).
  pendingPlaylistId: number | null

  // Which playlist (API-backed or local) PlaylistsView currently has open �
  // lives here rather than as local component state because App.tsx unmounts
  // PlaylistsView whenever you switch to another tab, which would otherwise
  // silently drop back to the playlist list every time you navigate away and
  // back. Cleared by the "playlists:back" event (tapping the tab again).
  playlistsSelectedId: number | null
  playlistsSelectedLocalId: string | null

  // The open playlist's track sort � same "lives in the store, not local
  // state" reasoning as playlistsSelectedId above: without this, tabbing
  // away from Playlists and back would silently drop the sort back to
  // playlist order every time, since the component remounts from scratch.
  playlistsSort: { field: string; dir: 'asc' | 'desc' }

  // Which folder (if any) is "open" in the library grid, showing just its
  // member playlists � same reasoning as playlistsSelectedId: without this,
  // tabbing away and back would silently kick you back out to the top-level
  // grid instead of leaving you inside the folder you were looking at.
  playlistsOpenFolderId: string | null

  // A comp proposal started from the Files page's context menu � the
   // contributor page reads it once on mount and clears it, the same
   // hand-off pendingEditorSongId does for the song editor.
  pendingCompProposal: { paths: string[]; changeType: 'delete' | 'replace' | 'upload' } | null

  // Editor
  pendingEditorSongId: number | null
  pendingEditProposal: { id: number; songId: number | null; proposedData: Record<string, unknown>; editorNotes: string } | null
  // Local-file metadata editor � the track being edited on the 'local-editor' view
  pendingLocalEditTrack: LibraryTrack | null
  // What the bulk editor dialog has open (null = closed) � either a Tracker
  // multi-selection of API songs (submits edit proposals) or a Library
  // multi-selection of local files (writes ID3 tags). Holds the full objects
  // the caller already had rather than ids, so the dialog can show "same
  // across all"/"mixed" per field without re-fetching. See BulkEditModal.
  bulkEdit:
    | { kind: 'api'; songs: JWApiSong[] }
    | { kind: 'local'; tracks: LibraryTrack[] }
    | null


  // Library (Electron only)
  libraryTracks: LibraryTrack[]
  // Lazily-read cover art, keyed by track id, kept OUT of libraryTracks so a
  // cover streaming in never changes the libraryTracks reference (which the
  // album/artist/song derivations memoize on). `undefined`/absent = not read
  // yet, `null` = read and artless, string = data URI. See applyLibraryArt.
  libraryArt: Record<string, string | null>
  // True once the on-disk track list has been read into memory this session.
  // loadLibrary short-circuits when it's set (the store is already the source
  // of truth), so revisiting the Library/Playlists tab doesn't re-read, re-ship
  // over IPC, and rebuild the whole list every time. Reset only by a forced
  // reload (another window changed the data) � see loadLibrary.
  libraryLoaded: boolean
  libraryFolders: string[]
  libraryScanning: boolean
  libraryLastScanned: number | null
  // When enabled, periodically re-checks library files against their cached
  // size/mtime and reloads tags for any that changed on disk (e.g. edited in
  // an external tag editor) without a full manual "Scan Now".
  libraryAutoRefresh: boolean
  // Reveals the Developer tab in Settings (cache/diagnostics tools normal
  // users don't need cluttering the main App tab).
  developerMode: boolean
  localPlaylists: LocalPlaylist[]
  activeLocalPlaylistId: string | null

  // Other people's playlists followed from a share link � see FollowedPlaylist.
  // Local-only (localStorage), so this list is per-device.
  followedPlaylists: FollowedPlaylist[]

  // Donor cloud-file playlists - see DonorPlaylist. Local-only (localStorage),
  // unlike web-dev's, which syncs through user_settings.donor_playlists - app
  // has no cross-device settings sync yet. donorFiles is the resolved file
  // list those playlists point into (null until loaded).
  donorPlaylists: DonorPlaylist[]
  donorFiles: DonorFile[] | null

  // Offline playlist sync (Electron only) � API-backed playlists downloaded
  // for offline playback, kept in sync with the API's song metadata.
  offlineTracks: Record<string, OfflineTrackMeta>
  offlinePlaylists: Record<string, OfflinePlaylistEntry>
  offlineSync: Record<string, { state: 'syncing' | 'done' | 'error'; current: number; total: number }>

  // Downloads (Electron only)
  downloads: DownloadItem[]
  showDownloadManager: boolean
  updateStatus: { type: string; version?: string; percent?: number; bytesPerSecond?: number; message?: string } | null

  stagedFileChanges: StagedFileChange[]
}

interface AppActions {
  setCurrentTrackFull: (full: FullTrack | null | ((prev: FullTrack | null) => FullTrack | null)) => void
  setVolume: (vol: number) => void
  setPlaybackSpeed: (speed: number) => void
  setLyricsOffset: (offset: number) => void
  setEqEnabled: (enabled: boolean) => void
  // Single-band slider move � flips eqPreset to 'custom'.
  setEqBand: (index: number, gain: number) => void
  // Applies a preset by id (gains looked up from EQ_PRESETS).
  setEqPreset: (id: string) => void
  setEqBalance: (balance: number) => void
  setEqMono: (mono: boolean) => void
  setEqBoost: (boost: number) => void
  setSkipSilence: (enabled: boolean) => void
  setReverbEnabled: (enabled: boolean) => void
  setReverbMix: (mix: number) => void
  setReverbDecay: (seconds: number) => void
  setPitchShift: (enabled: boolean) => void
  /** Cycles the A-B loop through its three states using the current playback
   *  position: unset ? point A set ? looping (A and B set) ? unset again.
   *  Mirrors the classic single-button "A-B repeat" control. */
  setAbLoopPoint: () => void
  clearAbLoop: () => void
  playCommunityEdit: (edit: CommunityEdit) => void

  setActiveView: (view: ViewType) => void
  setActiveAdminTab: (tab: AdminTab | null) => void
  setShowNowPlaying: (show: boolean) => void
  setRadioFmActive: (active: boolean) => void
  setRadioFmIsLive: (live: boolean | null) => void
  setRadioFmNowPlaying: (track: import('../lib/radioLive').RadioTrack | null) => void
  setRadioFmVote: (vote: import('../lib/radioLive').RadioVote | null) => void
  setRadioFmVoteDismissed: (dismissed: boolean) => void
  setRadioFmUpNext: (track: import('../lib/radioLive').RadioTrack | null) => void
  setRadioFmQueuePreview: (preview: string[]) => void
  setRadioFmMatchedSong: (song: { songId: number | null; imageUrl: string | null; path: string | null; lyrics: string | null; syncedLyrics: string | null; era: string | null } | null) => void
  setShowSettings: (show: boolean) => void
  setSettingsTab: (tab: SettingsTab | null) => void
  // Open Settings, optionally jumping straight to a tab (e.g. 'shortcuts').
  openSettings: (tab?: SettingsTab) => void
  // For the settings launcher icon: closes it if already open (in either
  // form) instead of just focusing the pop-out again. setShowSettings(true)
  // stays "always open/focus" for callers that never want to close it
  // (the open-settings hotkey, the library empty-state CTA).
  toggleSettings: () => void
  /** Single entry point for every "go to my profile" control (sidebar row,
   *  bottom nav tab, the player's profile hotkey). Opens the pop-out window
   *  when that's enabled, otherwise navigates in-app. */
  openProfile: () => void
  /** Opens the signed-in user's own public profile (/u/<id>). */
  openOwnPublicProfile: () => void
  /** Opens any user's public profile by id. */
  openPublicProfile: (userId: number) => void
  // Account ids of users whose chat messages are hidden from this account.
  mutedUserIds: number[]
  muteUser: (userId: number) => void
  unmuteUser: (userId: number) => void
  toggleMuteUser: (userId: number) => void
  // Mirror of chatStore's mutedServers/mutedConversations (that store owns
  // them; this is just a copy chatStore keeps in sync via _syncChatMutes so
  // other surfaces can read it without importing chatStore back).
  chatMutedServers: number[]
  chatMutedConversations: number[]
  /** Called from chatStore whenever its local mutedServers/mutedConversations
   *  change, so this store's mirror of them stays current. */
  _syncChatMutes: (mutedServers: number[], mutedConversations: number[]) => void
  // GIFs favorited from the chat GIF picker (see lib/gifApi).
  favoriteGifs: GifResult[]
  toggleFavoriteGif: (gif: GifResult) => void
  setShowDiagnostics: (show: boolean) => void
  setShowQueue: (show: boolean) => void
  setShowEqPanel: (show: boolean) => void
  setOpenFloatViews: (views: string[]) => void
  /** Single entry point for every equalizer opener (player bar, WRLD tab,
   *  hotkey): focuses the pop-out when one is open instead of showing a
   *  second copy of the same panel in-app. */
  toggleEqPanel: () => void
  setInfoSongId: (id: number | null) => void
  setPlayerCollapsed: (collapsed: boolean) => void
  setWrldFullscreen: (fullscreen: boolean) => void
  setTheme: (theme: SkinId) => void
  /** Creates or updates a custom skin (upsert by id). Since editing the active
   *  skin's palette re-runs the theme effect, the editor uses this for live
   *  preview � every color change saves through here. */
  saveCustomSkin: (skin: Skin) => void
  /** Removes a custom skin; if it was the active theme, falls back to dark. */
  deleteCustomSkin: (id: string) => void
  setSidebarPosition: (position: SidebarPosition) => void
  setAppMenuPosition: (position: AppMenuPosition) => void
  setNavOrder: (order: ViewType[]) => void
  setNavItemVisible: (view: ViewType, visible: boolean) => void
  setHomeSectionVisible: (id: string, visible: boolean) => void
  setNavControlOrder: (order: string[]) => void
  setNavControlVisible: (id: string, visible: boolean) => void

  setCrossfade: (enabled: boolean, duration: number) => void
  setPauseFade: (enabled: boolean) => void
  setSleepTimer: (endTimestamp: number | null) => void
  setAudioOutput: (deviceId: string) => void
  setAccentColor: (color: string) => void
  setAppTextScale: (scale: number) => void
  setAppFont: (id: string) => void
  setLyricsFont: (id: string) => void
  setLyricsScale: (scale: number) => void
  setLyricsAlign: (align: 'left' | 'center') => void
  setLyricsBlur: (enabled: boolean) => void
  setLyricsOverride: (enabled: boolean) => void
  setFullEraNames: (enabled: boolean) => void
  setLyricsBlurAmount: (amount: number) => void
  setLyricsColorActive: (color: string | null) => void
  setLyricsColorInactive: (color: string | null) => void
  setGradientsEnabled: (enabled: boolean) => void
  setSurfaceGradientsEnabled: (enabled: boolean) => void
  setWrldThemeBackground: (enabled: boolean) => void
  setPreferOgVersion: (enabled: boolean) => void
  setRotateSuggestedCovers: (enabled: boolean) => void
  /** Sets (or, with raw = null, clears) the cover override for one era and
   *  redraws any visible tracks it affects. */
  setEraCoverOverride: (era: string, raw: string | null) => void
  /** Rotates a song onto its next suggested cover, if the setting is on and
   *  the user hasn't set a cover of their own. Called when a track starts. */
  _maybeRotateCover: (songId: number) => void
  setMediaOverlayEnabled: (enabled: boolean) => void
  setLastfmUser: (name: string | null) => void
  setLastfmEnabled: (enabled: boolean) => void
  setPopoutWindow: (kind: PopoutWindowKind, enabled: boolean) => void
  // Bind (or, with combo === '', clear) a shortcut. Passing a combo already in
  // use elsewhere transfers it � the previous owner is cleared � so bindings
  // stay unique. Resets restore every action to its default.
  setHotkeyBinding: (actionId: string, combo: string) => void
  resetHotkeyBindings: () => void
  resetGlobalHotkeyBindings: () => void
  setHotkeySeekSeconds: (seconds: number) => void
  setGlobalHotkeysEnabled: (enabled: boolean) => void
  setGlobalHotkeyBinding: (actionId: string, combo: string) => void

  toggleLike: (trackId: string) => void

  /** Custom display name for a song, or null to fall back to its own title. */
  setSongName: (songId: number, name: string | null) => void
  /** Custom cover, as a pointer into the API's storage (see
   *  resolvePrefCoverUrl), or null to fall back to the song's own image. */
  setSongCover: (songId: number, coverUrl: string | null) => void
  /** Preferred version *label* within this song's version group (e.g. "v1") �
   *  playing any member of the group then plays this one. Null clears it. */
  setSongDefaultVersion: (songId: number, version: string | null) => void
  /** Replaces a song's own excluded-versions list outright — callers (the
   *  Change-version menu) work out which row(s) to patch themselves, the same
   *  way they already do for default_version, since an excluded label can
   *  live on a different member's row than the one being toggled from. */
  setSongExcludedVersions: (songId: number, versions: string[]) => void
  /** Drops every override for a song, playcount included. */
  clearSongPref: (songId: number) => void
  /** Credits one play. Called by the Player once a track passes the listened
   *  threshold � not on every start. */
  bumpSongPlaycount: (songId: number) => void
  /** Merges the profile's `user_preferences` blob (from getMe) with local
   *  state � profile wins per song except playcount, which takes the max �
   *  then pushes the merged array back up. Runs on login. */
  syncSongPrefs: (serverPrefs?: SongPreference[]) => Promise<void>
  /** Same shape as syncSongPrefs, but a union rather than a per-key merge �
   *  play events are immutable, so the two sides just get deduped. */
  syncListeningPlays: (serverPlays?: ListeningPlayEvent[]) => Promise<void>
  /** Internal � the single write path for songPrefs (state + localStorage +
   *  lib/songPrefs' cache). */
  _setSongPrefs: (next: SongPrefMap) => void
  /** Internal � the single write path for listeningPlays (state + localStorage). */
  _setListeningPlays: (next: ListeningPlayEvent[]) => void
  /** Internal � patches one song's row and syncs it to the server. */
  _writeSongPref: (songId: number, patch: SongPrefPatch) => void
  /** Internal � pushes a row's name/cover onto Tracks already in the queue. */
  _reapplySongPref: (songId: number) => void

  /** Opens the report dialog for general feedback or a specific song. */
  openReport: (target: ReportTarget) => void
  closeReport: () => void
  /** Opens / closes the "Convert format" dialog for a local track. */
  openConvert: (target: ConvertTarget) => void
  closeConvert: () => void
  /** Opens / closes the "Import from URL" dialog. */
  openUrlImport: () => void
  closeUrlImport: () => void
  /** Queues a general feedback report and tries to deliver it. `contact` is
   *  the optional reach-me field the endpoint accepts. Resolves once that
   *  delivery attempt settles: `true` if it actually reached the server this
   *  round, `false` if it's still sitting in the outbox (offline, rejected,
   *  or the API is disabled) � the caller can surface which happened. */
  submitFeedback: (category: FeedbackCategory, message: string, contact?: string) => Promise<boolean>
  /** Queues a song issue report (wrong/missing info or lyrics) and tries to
   *  deliver it. `issues` is the set of checked problem types. Same delivered
   *  vs. still-queued resolution as `submitFeedback`. */
  reportSong: (songId: number, songName: string, issues: SongIssueType[], message: string, contact?: string) => Promise<boolean>
  /** Drops a queued report from the outbox (e.g. one stuck failing). */
  dismissReport: (id: string) => void
  /** Internal � appends a report to the outbox, kicks off delivery, and
   *  resolves to whether this particular report was delivered this round. */
  _enqueueReport: (report: PendingReport) => Promise<boolean>
  /** Internal � attempts to deliver every deliverable queued report. */
  _flushReports: () => Promise<void>

  /** Creates a folder (optionally seeded with playlist keys) and returns its id. */
  createFolder: (name: string, playlistKeys?: string[]) => string | null
  renameFolder: (id: string, name: string) => void
  /** Deletes the folder; its playlists become ungrouped (they aren't deleted). */
  deleteFolder: (id: string) => void
  /** Files playlists under a folder (or `null` to remove them from any folder).
   *  A playlist lives in at most one folder, so this clears prior membership. */
  movePlaylistsToFolder: (playlistKeys: string[], folderId: string | null) => void
  /** Drops folder members that no longer exist (playlists deleted since). */
  pruneFolders: (validKeys: string[]) => void
  /** Merges the profile's `playlist_folders` blob (from getMe) with local
   *  state � the profile is the source of truth for synced membership, and
   *  device-local members re-attach by folder id � then pushes the merge back
   *  up. Runs on login. */
  syncFolders: (serverFolders?: ServerPlaylistFolder[]) => Promise<void>
  /** Internal � the single write path for playlistFolders. */
  _setFolders: (next: PlaylistFolder[]) => void
  /** Internal � marks the given profile-blob field(s) dirty and (re)schedules
   *  the single shared debounced PATCH that pushes all dirty fields together
   *  in one request, whole-array, rather than one PATCH per field. */
  _scheduleProfilePush: (fields: ('songPrefs' | 'listeningPlays' | 'folders')[]) => void

  setApiTrackerCategory: (cat: string) => void
  setApiTrackerEra: (era: string) => void
  setApiTrackerTab: (tab: string) => void
  setApiFilesPath: (path: string) => void
  setApiFilesLastPath: (path: string) => void

  setShowUserAuth: (show: boolean) => void
  loadAccount: () => Promise<void>
  loginWithDiscord: () => Promise<void>
  completeDiscordLogin: (code: string, state: string) => Promise<void>
  logoutAccount: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  prefetchPlaylistDetails: () => Promise<void>
  prefetchApiData: () => Promise<void>
  setPendingPlaylistId: (id: number | null) => void
  setPlaylistsSelectedId: (id: number | null) => void
  setPlaylistsSelectedLocalId: (id: string | null) => void
  setPlaylistsSort: (sort: { field: string; dir: 'asc' | 'desc' }) => void
  setPlaylistsOpenFolderId: (id: string | null) => void

  setPendingCompProposal: (v: { paths: string[]; changeType: 'delete' | 'replace' | 'upload' } | null) => void
  setPendingEditorSongId: (id: number | null) => void
  // "Edit this song" from anywhere � desktop opens the pop-out editor
  // window, web navigates to the in-app editor view.
  openSongEditor: (songId: number) => void
  setPendingEditProposal: (p: { id: number; songId: number | null; proposedData: Record<string, unknown>; editorNotes: string } | null) => void
  setPendingLocalEditTrack: (track: LibraryTrack | null) => void
  // "Edit metadata" on a local track from anywhere � desktop opens the
  // pop-out local editor window, web navigates to the in-app view.
  openLocalEditor: (track: LibraryTrack) => void
  // "Edit" on a multi-song selection � opens the bulk editor dialog, which
  // submits one update proposal per song.
  openBulkEditor: (songs: JWApiSong[]) => void
  // "Edit tags" on a multi-file selection in the Library � same dialog, but
  // writing ID3 tags to each file instead.
  openBulkTrackEditor: (tracks: LibraryTrack[]) => void
  closeBulkEditor: () => void


  setLibraryTracks: (tracks: LibraryTrack[]) => void
  addLibraryTrack: (track: LibraryTrack) => void
  /** Sends the file to the OS trash (after a confirm prompt raised by the main
   *  process) and purges it from the library, art cache, local playlists and
   *  queue. Resolves false if the user cancelled or the delete failed. */
  deleteLibraryTrack: (id: string) => Promise<boolean>
  /** Prompts for a destination folder, moves the file there, and re-keys it
   *  everywhere (the track id is derived from its path). Resolves false if the
   *  user cancelled or the move failed. */
  moveLibraryTrack: (id: string) => Promise<boolean>
  updateLibraryTrack: (id: string, updates: Partial<LibraryTrack>) => void
  applyLibraryArt: (id: string, art: string | null) => void
  addLibraryFolder: (folder: string) => void
  removeLibraryFolder: (folder: string) => void
  setLibraryLastScanned: (ts: number | null) => void
  setLibraryAutoRefresh: (enabled: boolean) => void
  setDeveloperMode: (enabled: boolean) => void
  scanLibrary: () => Promise<void>

  createLocalPlaylist: (name: string) => void
  deleteLocalPlaylist: (id: string) => void
  renameLocalPlaylist: (id: string, name: string) => void
  updateLocalPlaylist: (id: string, updates: { name?: string; coverImage?: string | null }) => void
  addToLocalPlaylist: (playlistId: string, trackId: string) => void
  removeFromLocalPlaylist: (playlistId: string, trackId: string) => void
  reorderLocalPlaylist: (playlistId: string, trackIds: string[]) => void
  // Import an .m3u/.m3u8 into a new local playlist, matching its file paths to
  // scanned library tracks. Resolves a summary (matched/total + names of the
  // paths that weren't in the library) so the UI can report skips.
  // Commit already-parsed .m3u entries to a new local playlist, matching their
  // file paths to the scanned library. The file is opened/parsed in the UI
  // first so the user can choose local-vs-API import before anything is created.
  importM3uEntriesLocal: (name: string, entries: { path: string; title: string | null; duration?: number | null }[]) => { ok: true; playlistId: string; name: string; matched: number; total: number; unmatched: string[] } | { ok: false; canceled?: boolean; error?: string }
  exportLocalPlaylistM3u: (id: string) => Promise<{ ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }>
  loadLibrary: (force?: boolean) => Promise<void>

  // Follow/unfollow someone else's playlist (see FollowedPlaylist) � a local
  // pointer, not a copy. followPlaylist is idempotent (following twice just
  // refreshes the cached display fields). updateFollowedPlaylistMeta patches
  // the cached name/trackCount/coverUrl after a live re-fetch; no-op if the
  // id isn't followed.
  followPlaylist: (meta: { id: number; name: string; trackCount: number; coverUrl: string | null }) => void
  unfollowPlaylist: (id: number) => void
  updateFollowedPlaylistMeta: (id: number, meta: { name: string; trackCount: number; coverUrl: string | null }) => void

  loadDonorFiles: () => Promise<void>
  setDonorFiles: (files: DonorFile[]) => void
  createDonorPlaylist: (name: string, fileIds?: string[]) => string
  deleteDonorPlaylist: (id: string) => void
  renameDonorPlaylist: (id: string, name: string) => void
  addToDonorPlaylist: (playlistId: string, fileId: string) => void
  removeFromDonorPlaylist: (playlistId: string, fileId: string) => void
  reorderDonorPlaylist: (playlistId: string, fileIds: string[]) => void
  // A re-tagged file re-uploads under a new file_id; a deleted one just goes
  // away. Either way, any donor playlist pointing at the old id needs fixing
  // up so it doesn't silently drop a track next time it's opened.
  replaceDonorFileId: (oldId: string, newId: string | null) => void
  _setDonorPlaylists: (next: DonorPlaylist[]) => void

  loadOfflineLibrary: () => Promise<void>
  downloadPlaylistOffline: (key: string, name: string, songIds: number[], opts?: { silent?: boolean }) => Promise<void>
  removePlaylistOffline: (key: string) => Promise<void>
  downloadTrackOffline: (songId: number) => Promise<void>
  removeOfflineTrack: (trackId: string) => Promise<void>
  syncOfflinePlaylists: () => Promise<void>
  autoDownloadIfOffline: (playlistId: number, addedSongIds: number[]) => Promise<void>

  addDownload: (item: DownloadItem) => void
  updateDownload: (id: string, updates: Partial<DownloadItem>) => void
  removeDownload: (id: string) => void
  clearCompletedDownloads: () => void
  setShowDownloadManager: (show: boolean) => void
  setUpdateStatus: (status: { type: string; version?: string; percent?: number; bytesPerSecond?: number; message?: string } | null) => void

  /** Queues drag-and-drop file changes; ids are assigned here. Returns nothing
   *  - the Downloads panel is where they're reviewed and proposed. */
  stageFileChanges: (changes: Omit<StagedFileChange, 'id'>[]) => void
  updateStagedFileChange: (id: string, updates: Partial<StagedFileChange>) => void
  unstageFileChange: (id: string) => void
  clearStagedFileChanges: () => void
}

export type AppStore = QueueSlice & AppState & AppActions

// --- Store --------------------------------------------------------------------

// Dedup flag: prevents concurrent /playlists/ fetches
let _playlistsInFlight = false
// Dedup flag: prevents the startup detail/cover prefetch from running twice
// (e.g. loadAccount racing with a later refreshPlaylists on the same session)
let _detailsPrefetchInFlight = false
// Dedup flag: same idea for the Tracker/Files offline-cache warm-up
let _apiPrefetchInFlight = false
// Shares one loadAccount() run across overlapping callers instead of each
// re-running the whole sync (and its handful of PATCH /me/ pushes) from
// scratch — App.tsx alone calls loadAccount() from two separate mount
// effects, and React 18 StrictMode double-invokes both in dev, so without
// this a cold load could fire the sync 3-4x and turn 3 PATCH /me/ requests
// into 9-12.
let _loadAccountInFlight: Promise<void> | null = null

// -- Offline-sync concurrency guards ------------------------------------------
// syncOfflinePlaylists fires from three places (startup, every window focus,
// a 15-min interval) with nothing stopping them from overlapping. Overlapping
// runs each snapshot `offlineTracks` at their start, so both would download
// the same missing songs � two streams writing the same file � and re-announce
// downloads the user already saw ("my playlists redownload on their own").
let _offlineSyncInFlight = false
// Serializes offline writers per playlist key. Without this, a manual download,
// a background resync, and autoDownloadIfOffline can interleave for the same
// playlist; whichever finishes last saves its (possibly stale) song list, and
// offline-set-playlist's prune then deletes freshly-downloaded files that the
// stale list doesn't mention � which the next resync dutifully re-downloads.
const _offlineKeyQueues = new Map<string, Promise<void>>()
// Bumped by removePlaylistOffline. A download that started before the bump
// aborts instead of running offlineSetPlaylist at its end � otherwise removing
// a playlist while a sync was in flight re-registered ("resurrected") it, and
// since removal had already pruned its files, the next background sync
// re-downloaded the entire playlist unprompted.
const _offlineKeyEpochs = new Map<string, number>()

// Pending cover-art results awaiting a batched flush (see applyLibraryArt).
// Covers arrive in bursts � one per visible row � and applying each through
// its own set() meant a full libraryTracks copy and list re-render per cover.
let _pendingArt: Map<string, string | null> | null = null

// --- Song preferences helpers -------------------------------------------------

/** Merges `patch` into one song's row, dropping the row once nothing is left
 *  on it. Pure � callers persist the result through _setSongPrefs. */
function patchPrefMap(prefs: SongPrefMap, songId: number, patch: SongPrefPatch): SongPrefMap {
  const merged = { ...(prefs[songId] ?? emptySongPref(songId)), ...patch }
  const next = { ...prefs }
  if (isEmptySongPref(merged)) delete next[songId]
  else next[songId] = merged
  return next
}

/** Re-derives a Track's name/cover from a preference row. Tracks already in
 *  the queue were built by songToTrack before the override existed and would
 *  otherwise show the old name until something refetched them; deriving from
 *  the canonical apiTitle/apiImageUrl kept on every API Track means an
 *  override can be applied, changed, or removed in place. */
function applyPrefToTrack(track: Track, pref: SongPreference | undefined): Track {
  // Mirrors songToTrack: user cover first, then a rotated suggestion (only
  // ever set while the rotate-covers setting is on), then an era cover
  // override (unreleased songs only � track.genre holds the API category for
  // jw- tracks), then the song's own art.
  const songId = userApi.trackIdToSongId(track.id)
  const coverUrl = resolvePrefCoverUrl(pref?.cover_url)
    ?? (songId != null ? peekRotatedCover(songId) : undefined)
    ?? (songId != null && track.genre !== 'released' ? resolvePrefCoverUrl(peekEraCover(track.era)) : undefined)
  return {
    ...track,
    title: pref?.name || track.apiTitle || track.title,
    imageUrl: coverUrl ?? track.apiImageUrl,
    hasAlbumArt: !!track.apiImageUrl || !!coverUrl,
  }
}

/** Hydrates the persisted preferences and seeds lib/songPrefs' cache with them
 *  before any song ? Track conversion can happen, so overrides survive a
 *  restart and apply to the very first render. */
function hydrateSongPrefs(): SongPrefMap {
  const stored = ls.get<SongPrefMap>('songPrefs') ?? {}
  setSongPrefsCache(stored)
  return stored
}

function hydrateListeningPlays(): ListeningPlayEvent[] {
  const stored = ls.get<unknown[]>('listeningPlays') ?? []
  const out: ListeningPlayEvent[] = []
  for (const row of stored) {
    const event = normalizeListeningPlayEvent(row)
    if (event) out.push(event)
  }
  return out
}

/** Loads the persisted custom skins and seeds lib/skins' module cache with them
 *  before the store's `theme` initializer resolves the active id via getSkin �
 *  so a saved custom skin is the active look on the very first paint. */
function hydrateCustomSkins(): Skin[] {
  const stored = ls.get<Skin[]>('customSkins') ?? []
  // Guard against a corrupted blob: keep only well-formed rows.
  const valid = Array.isArray(stored)
    ? stored.filter((s): s is Skin => !!s && typeof s.id === 'string' && !!s.vars)
    : []
  setCustomSkinsCache(valid)
  return valid
}

// --- Report outbox helpers ----------------------------------------------------

// Guards _flushReports against overlapping runs (boot + login + a fresh submit
// can all fire it close together) � without this, the same queued report could
// be POSTed twice before the first response removed it.
let _reportsFlushing = false

// A pop-out's own _flushReports call is always a no-op (see IS_FLOAT_WINDOW
// above) � delivery actually happens in the main window after `pendingReports`
// syncs over (see windowSync.ts), and the outcome syncs back the same way. So
// instead of claiming "queued" the instant a pop-out enqueues (true then, but
// misleading seconds later once it's actually gone through), wait briefly for
// that round trip to land before answering. Falls back to "still queued" if
// nothing comes back in time (main window closed, sync hiccup, etc.).
function waitForReportSettled(id: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!useStore.getState().pendingReports.some((r) => r.id === id)) { resolve(true); return }
    const unsub = useStore.subscribe((state) => {
      if (!state.pendingReports.some((r) => r.id === id)) {
        clearTimeout(timer)
        unsub()
        resolve(true)
      }
    })
    const timer = setTimeout(() => { unsub(); resolve(false) }, timeoutMs)
  })
}

// --- Profile-blob push debounce -----------------------------------------------

// Preferences, listening plays, and folders each live as one JSON field on
// /account/me/, PATCHed whole. A single shared timer/dirty-set collapses a
// burst of edits across ANY of the three fields (typing a rename, a run of
// playcount bumps, a song skip that touches both prefs and listening plays)
// into one combined PATCH instead of one request per field. Failures are
// swallowed: state is local-first, and the next push � or the next login's
// merge � re-sends everything anyway.
const PROFILE_PUSH_DEBOUNCE_MS = 1500
let _profilePushTimer: ReturnType<typeof setTimeout> | null = null
let _profilePushDirty = { songPrefs: false, listeningPlays: false, folders: false }

// Chains `fn` behind any in-flight offline work for `key` so writers for the
// same playlist never interleave.
function enqueueOfflineWork(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = _offlineKeyQueues.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  _offlineKeyQueues.set(key, run)
  run.finally(() => { if (_offlineKeyQueues.get(key) === run) _offlineKeyQueues.delete(key) }).catch(() => {})
  return run
}

// -- M3U import helpers (shared by the file-picker and drag-drop paths) ------
// Match parsed .m3u entries against scanned library tracks by file path.
// Library paths are the source of truth; the .m3u may use either slash style
// or differ in case (Windows is case-insensitive), so normalise both sides.
type M3uEntry = { path: string; title: string | null }
function matchM3uEntries(
  libraryTracks: LibraryTrack[],
  entries: M3uEntry[],
): { trackIds: string[]; unmatched: string[] } {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const byPath = new Map<string, string>()
  for (const t of libraryTracks) byPath.set(norm(t.filePath), t.id)
  const trackIds: string[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    const id = byPath.get(norm(e.path))
    if (id) { if (!seen.has(id)) { seen.add(id); trackIds.push(id) } }
    else unmatched.push(e.title || e.path.split(/[\\/]/).pop() || e.path)
  }
  return { trackIds, unmatched }
}

type M3uImportResult =
  | { ok: true; playlistId: string; name: string; matched: number; total: number; unmatched: string[] }
  | { ok: false; canceled?: boolean; error?: string }

// Shared tail for both import paths: takes whatever the main process returned
// ({ ok, name, entries } | { canceled } | { error }), builds a local playlist,
// persists it, and returns the summary the UI reports.
function commitM3uImport(
  get: () => AppStore,
  set: (partial: Partial<AppStore>) => void,
  res: { canceled?: boolean; error?: string; name?: string; entries?: M3uEntry[] } | null,
): M3uImportResult {
  if (!res || res.canceled) return { ok: false, canceled: true }
  if (res.error || !Array.isArray(res.entries)) return { ok: false, error: res.error || 'Import failed' }
  const entries = res.entries
  const { trackIds, unmatched } = matchM3uEntries(get().libraryTracks, entries)
  const playlist: LocalPlaylist = { id: `lp-${Date.now()}`, name: res.name || 'Imported Playlist', trackIds, createdAt: Date.now() }
  const next = [...get().localPlaylists, playlist]
  set({ localPlaylists: next, activeLocalPlaylistId: playlist.id })
  ;(window as unknown as { electron?: { saveLocalPlaylists?: (p: LocalPlaylist[]) => void } }).electron?.saveLocalPlaylists?.(next)
  return { ok: true, playlistId: playlist.id, name: playlist.name, matched: trackIds.length, total: entries.length, unmatched }
}

setActiveChannelCache(ls.get<string>('activeChannel') || '')

export const useStore = create<AppStore>((set, get, store) => ({
  // -- Queue slice (all queue + playback logic) -------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...createQueueSlice(set, get, store as any),

  // -- Playback extras -------------------------------------------------------
  currentTrackFull: null,
  volume: ls.get<number>('volume') ?? 0.8,
  playbackSpeed: ls.get<number>('playbackSpeed') ?? 1,
  lyricsOffset: ls.get<number>('lyricsOffset') ?? 0,

  setCurrentTrackFull: (full) => {
    if (typeof full === 'function') {
      set(state => ({ currentTrackFull: full(state.currentTrackFull) }))
    } else {
      set({ currentTrackFull: full })
    }
  },
  setVolume: (volume) => { set({ volume }); ls.set('volume', volume) },
  setPlaybackSpeed: (speed) => { set({ playbackSpeed: speed }); ls.set('playbackSpeed', speed) },
  setLyricsOffset: (offset) => { set({ lyricsOffset: offset }); ls.set('lyricsOffset', offset) },

  // -- Equalizer / audio effects ---------------------------------------------
  eqEnabled: ls.get<boolean>('eqEnabled') ?? false,
  // Sanitize the stored array against the band list so a build that changes
  // EQ_BANDS can't leave a mismatched gains length behind.
  eqGains: (() => {
    const saved = ls.get<number[]>('eqGains')
    return Array.isArray(saved) && saved.length === EQ_BANDS.length ? saved : [...FLAT_GAINS]
  })(),
  eqPreset: ls.get<string>('eqPreset') ?? 'flat',
  eqBalance: ls.get<number>('eqBalance') ?? 0,
  eqMono: ls.get<boolean>('eqMono') ?? false,
  // 1 = 100% (unity, off) .. EQ_BOOST_MAX = 200%.
  eqBoost: ls.get<number>('eqBoost') ?? 1,
  skipSilence: ls.get<boolean>('skipSilence') ?? false,
  setEqEnabled: (eqEnabled) => { set({ eqEnabled }); ls.set('eqEnabled', eqEnabled) },
  setEqBand: (index, gain) => {
    const eqGains = [...get().eqGains]
    eqGains[index] = gain
    set({ eqGains, eqPreset: 'custom' })
    ls.set('eqGains', eqGains); ls.set('eqPreset', 'custom')
  },
  setEqPreset: (id) => {
    const preset = EQ_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const eqGains = [...preset.gains]
    set({ eqGains, eqPreset: id })
    ls.set('eqGains', eqGains); ls.set('eqPreset', id)
  },
  setEqBalance: (eqBalance) => { set({ eqBalance }); ls.set('eqBalance', eqBalance) },
  setEqMono: (eqMono) => { set({ eqMono }); ls.set('eqMono', eqMono) },
  setEqBoost: (eqBoost) => { set({ eqBoost }); ls.set('eqBoost', eqBoost) },
  setSkipSilence: (skipSilence) => { set({ skipSilence }); ls.set('skipSilence', skipSilence) },
  // 'slowedReverb' is the feature's short-lived bundled-toggle predecessor �
  // carry an existing on-state over so it doesn't silently switch off.
  reverbEnabled: ls.get<boolean>('reverbEnabled') ?? ls.get<boolean>('slowedReverb') ?? false,
  reverbMix: ls.get<number>('reverbMix') ?? 0.4,
  reverbDecay: ls.get<number>('reverbDecay') ?? 3,
  pitchShift: ls.get<boolean>('pitchShift') ?? ls.get<boolean>('slowedReverb') ?? false,
  setReverbEnabled: (reverbEnabled) => { set({ reverbEnabled }); ls.set('reverbEnabled', reverbEnabled) },
  setReverbMix: (reverbMix) => { set({ reverbMix }); ls.set('reverbMix', reverbMix) },
  setReverbDecay: (reverbDecay) => { set({ reverbDecay }); ls.set('reverbDecay', reverbDecay) },
  setPitchShift: (pitchShift) => { set({ pitchShift }); ls.set('pitchShift', pitchShift) },
  abLoopStart: null,
  abLoopEnd: null,
  setAbLoopPoint: () => {
    const { abLoopStart, abLoopEnd, currentTime } = get()
    if (abLoopStart == null) {
      set({ abLoopStart: currentTime, abLoopEnd: null })
      return
    }
    if (abLoopEnd == null) {
      // A loop shorter than this reads as a stutter rather than a musical
      // phrase � and clicking "B" at (accidentally) almost the same spot as
      // "A" is the easy mistake this guards against. Treat a too-close click
      // as re-picking point A there instead of creating a degenerate loop.
      const MIN_LOOP_S = 0.5
      if (currentTime > abLoopStart + MIN_LOOP_S) {
        set({ abLoopEnd: currentTime })
      } else if (currentTime < abLoopStart - MIN_LOOP_S) {
        // Clicked "B" earlier in the track than "A" � swap so start < end.
        set({ abLoopStart: currentTime, abLoopEnd: abLoopStart })
      } else {
        set({ abLoopStart: currentTime })
      }
      return
    }
    // Both already set � third press clears it.
    set({ abLoopStart: null, abLoopEnd: null })
  },
  clearAbLoop: () => set({ abLoopStart: null, abLoopEnd: null }),
  communityEdits: [],
  // A community edit is a real audio file, so playing one goes through the
  // normal queue machinery as a single-track play � the effects chain, prefs,
  // scrobbling etc. all apply to it like any other track.
  playCommunityEdit: (edit) => {
    const track: Track = {
      id: `community-edit-${edit.id}`,
      path: edit.path,
      title: edit.name,
      artist: edit.author ? `Community edit � ${edit.author}` : 'Community edit',
      album: '',
      albumArtist: '',
      year: null,
      trackNumber: null,
      duration: edit.duration ?? 0,
      genre: '',
      hasAlbumArt: !!edit.imageUrl,
      streamUrl: buildStreamUrl(edit.path),
      imageUrl: edit.imageUrl ?? '',
    }
    get().playTrack(track, [track])
  },

  // -- UI --------------------------------------------------------------------
  activeView: 'home',
  previousView: null,
  activeAdminTab: null,
  showNowPlaying: false,
  showSettings: false,
  settingsTab: null,
  showDiagnostics: false,
  showQueue: false,
  showEqPanel: false,
  openFloatViews: [],
  infoSongId: null,
  playerCollapsed: ls.get<boolean>('playerCollapsed') ?? false,
  wrldFullscreen: false,
  radioFmActive: false,
  radioFmIsLive: null,
  radioFmNowPlaying: null,
  radioFmVote: null,
  radioFmVoteDismissed: false,
  radioFmUpNext: null,
  radioFmQueuePreview: [],
  radioFmMatchedSong: null,
  // Seeds lib/skins' cache as a side effect � MUST stay above `theme` so a
  // persisted custom skin id resolves (getSkin) instead of falling back to dark.
  customSkins: hydrateCustomSkins(),
  // getSkin() maps unknown persisted ids (renamed/removed skins) back to dark.
  theme: getSkin(ls.get<string>('theme') ?? 'dark').id,
  sidebarPosition: ls.get<SidebarPosition>('sidebarPosition') ?? 'left',
  appMenuPosition: ls.get<AppMenuPosition>('appMenuPosition') ?? 'sidebar',
  navOrder: ls.get<ViewType[]>('navOrder') ?? DEFAULT_NAV_ORDER,
  navVisibility: { ...DEFAULT_NAV_VISIBILITY, ...(ls.get<Record<string, boolean>>('navVisibility') ?? {}) },
  homeSectionVisibility: { ...DEFAULT_HOME_SECTION_VISIBILITY, ...(ls.get<Record<string, boolean>>('homeSectionVisibility') ?? {}) },
  navControlOrder: (() => {
    const saved = ls.get<string[]>('navControlOrder') ?? DEFAULT_NAV_CONTROL_ORDER
    return saved.filter((id) => id !== 'return-api')
  })(),
  navControlVisibility: (() => {
    const saved = ls.get<Record<string, boolean>>('navControlVisibility') ?? {}
    const merged = { ...DEFAULT_NAV_CONTROL_VISIBILITY, ...saved }
    delete merged['return-api']
    return merged
  })(),

  setActiveView: (view) => {
    // Already there: skip, so a repeat call can't stack duplicate history
    // entries or churn subscribers that key off previousView.
    if (get().activeView === view) return
    const paths: Partial<Record<ViewType, string>> = {
      'api-tracker': '/tracker',
      'api-files': '/files',
      'editor': '/editor',
      'contributor': '/contributor',
      'admin': '/admin',
      'liked': '/liked',
      'playlists': '/playlists',
      'wrld': '/wrld',
      'news': '/news',
      'heardle': '/heardle',
      'wordle': '/wordle',
      'tierlist': '/tierlist',
      'stats': '/stats',
      'statistics': '/statistics',
    }
    window.history.pushState({ view }, '', paths[view] ?? '/tracker')
    set((s) => ({ activeView: view, previousView: view === s.activeView ? s.previousView : s.activeView }))
  },
  setActiveAdminTab: (tab) => set({ activeAdminTab: tab }),
  setShowNowPlaying: (showNowPlaying) => set({ showNowPlaying }),
  setRadioFmActive: (radioFmActive) => set({ radioFmActive }),
  setRadioFmIsLive: (radioFmIsLive) => set({ radioFmIsLive }),
  setRadioFmNowPlaying: (radioFmNowPlaying) => set({ radioFmNowPlaying }),
  setRadioFmVote: (radioFmVote) => set({ radioFmVote }),
  setRadioFmVoteDismissed: (radioFmVoteDismissed) => set({ radioFmVoteDismissed }),
  setRadioFmUpNext: (radioFmUpNext) => set({ radioFmUpNext }),
  setRadioFmQueuePreview: (radioFmQueuePreview) => set({ radioFmQueuePreview }),
  setRadioFmMatchedSong: (radioFmMatchedSong) => set({ radioFmMatchedSong }),
  setShowSettings: (showSettings) => {
    // Desktop: Settings lives in its own pop-out window (see FloatApp) � every
    // "open settings" path routes there, unless the user turned that pop-out
    // off. The in-app overlay is the fallback (and the only path on the web
    // build, where there are no extra OS windows).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (showSettings && el?.openFloatWindow && get().popoutWindows.settings) {
      el.openFloatWindow('settings')
      return
    }
    // Settings docks into the sandbox notch (see Modal.tsx) and stays
    // mounted once opened — collapsing the notch just hides it. Re-opening
    // while it's already mounted (showSettings already true) wouldn't
    // re-trigger the dock/expand in ModalOverlay's mount effect, so expand
    // the notch here too or the button would look like it's doing nothing.
    if (showSettings) useSandboxStore.getState().expand()
    set({ showSettings })
  },
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  // Set the target tab BEFORE opening so a freshly-spawned pop-out Settings
  // window picks it up in its boot snapshot; if one's already open, the change
  // reaches it over windowSync and Settings switches tabs in response.
  openSettings: (tab) => {
    if (tab) set({ settingsTab: tab })
    get().setShowSettings(true)
  },
  toggleSettings: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (el?.toggleFloatWindow && get().popoutWindows.settings) {
      // The pop-out's open/closed state lives in the main process (it's a
      // separate window), not in this renderer's `showSettings` � which
      // never flips true in pop-out mode � so main decides open vs. close.
      el.toggleFloatWindow('settings')
      return
    }
    set((s) => ({ showSettings: !s.showSettings }))
  },
  openProfile: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (el?.openFloatWindow && get().popoutWindows.profile) {
      el.openFloatWindow('profile')
      return
    }
    // Which profile view depends on the account's roles, not on the caller �
    // staffProfileView is the same helper the sidebar/bottom-nav tabs label
    // themselves from, so the two can't drift apart.
    const s = get()
    const account = s.account
    const view = userApi.staffProfileView(account)
    // The profile page's staff tiles are scoped to whichever channel is
    // active - activeChannel is a single global setting shared with the
    // Files tab, so it can easily be left on a channel where this account
    // only holds the contributor role while their actual editor/manager
    // standing is on a different one. Landing there then looks exactly like
    // the contributor page instead of the staff dashboard the pill/tab
    // promised. Steer to a channel where they actually have staff standing
    // first, if the currently active one doesn't and one exists.
    if (view === 'editor-profile' && account && !account.is_administrator) {
      const { channels, activeChannel } = s
      const isPrimary = (slug: string | null | undefined): boolean =>
        channels.length === 0 ? true : !!channels.find((c) => c.slug === slug)?.is_primary
      const hasStaffOn = (slug: string): boolean =>
        userApi.isChannelEditor(account, slug, isPrimary(slug)) || userApi.isChannelManager(account, slug, isPrimary(slug))
      if (!hasStaffOn(activeChannel)) {
        const staffChannel = channels.find((c) => hasStaffOn(c.slug))
        if (staffChannel) s.setActiveChannel(staffChannel.slug)
      }
    }
    if (IS_FLOAT_WINDOW) {
      // A pop-out asking for the profile with the pop-out disabled: it has no
      // router of its own, so the main window takes the navigation.
      el?.windowSyncSend?.({ type: 'navigate', view })
      el?.focusMainWindow?.()
      return
    }
    get().setActiveView(view)
  },
  openOwnPublicProfile: () => {
    const account = get().account
    if (!account) return
    get().openPublicProfile(account.id)
  },
  openPublicProfile: (userId) => {
    // public-profile's userId lives in the URL path itself (/u/<id>), not in
    // store state, so this can't reuse setActiveView's path table - push
    // directly and always set state (even if already on 'public-profile',
    // e.g. navigating there from someone else's page) so the view re-reads
    // the new path.
    const path = `/u/${userId}`
    if (path !== window.location.pathname) window.history.pushState({ view: 'public-profile' }, '', path)
    set((s) => ({ activeView: 'public-profile', previousView: s.activeView === 'public-profile' ? s.previousView : s.activeView }))
  },
  muteUser: (userId) => {
    const { mutedUserIds } = get()
    if (mutedUserIds.includes(userId)) return
    const next = [...mutedUserIds, userId]
    set({ mutedUserIds: next })
    ls.set('mutedUserIds', next)
  },
  unmuteUser: (userId) => {
    const { mutedUserIds } = get()
    if (!mutedUserIds.includes(userId)) return
    const next = mutedUserIds.filter((id) => id !== userId)
    set({ mutedUserIds: next })
    ls.set('mutedUserIds', next)
  },
  toggleMuteUser: (userId) => {
    const { mutedUserIds, muteUser, unmuteUser } = get()
    if (mutedUserIds.includes(userId)) unmuteUser(userId)
    else muteUser(userId)
  },
  _syncChatMutes: (mutedServers, mutedConversations) => {
    const s = get()
    if (mutedServers.length === s.chatMutedServers.length && mutedServers.every((id) => s.chatMutedServers.includes(id))
      && mutedConversations.length === s.chatMutedConversations.length && mutedConversations.every((id) => s.chatMutedConversations.includes(id))) return
    set({ chatMutedServers: mutedServers, chatMutedConversations: mutedConversations })
  },
  toggleFavoriteGif: (gif) => {
    const { favoriteGifs } = get()
    const next = favoriteGifs.some((g) => g.id === gif.id)
      ? favoriteGifs.filter((g) => g.id !== gif.id)
      : [gif, ...favoriteGifs]
    set({ favoriteGifs: next })
    ls.set('favoriteGifs', next)
  },
  setShowDiagnostics: (showDiagnostics) => set({ showDiagnostics }),
  setShowQueue: (showQueue) => set({ showQueue }),
  setShowEqPanel: (showEqPanel) => set({ showEqPanel }),
  setOpenFloatViews: (openFloatViews) => {
    // The equalizer just popped out � retire the in-app copy so the two can
    // never be on screen at once (they drive the same synced state).
    const dismissInApp = openFloatViews.includes('equalizer') && get().showEqPanel
    set(dismissInApp ? { openFloatViews, showEqPanel: false } : { openFloatViews })
  },
  toggleEqPanel: () => {
    const { openFloatViews, showEqPanel, popoutWindows } = get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    // "Open equalizer as a pop-out by default" is on � the button opens/closes
    // its own window instead of the in-app popover.
    if (popoutWindows.equalizer && el?.toggleFloatWindow) {
      el.toggleFloatWindow('equalizer')
      if (showEqPanel) set({ showEqPanel: false })
      return
    }
    // Popover mode, but a pop-out window is already open (opened manually via
    // the panel's detach button) � focus it rather than duplicating the panel.
    if (openFloatViews.includes('equalizer')) {
      el?.openFloatWindow?.('equalizer')
      if (showEqPanel) set({ showEqPanel: false })
      return
    }
    set({ showEqPanel: !showEqPanel })
  },
  setInfoSongId: (infoSongId) => {
    // Mirrors setShowSettings/openConvert: re-opening while already docked
    // wouldn't otherwise re-expand a collapsed sandbox notch.
    if (infoSongId != null) useSandboxStore.getState().expand()
    set({ infoSongId })
  },
  setPlayerCollapsed: (playerCollapsed) => { set({ playerCollapsed }); ls.set('playerCollapsed', playerCollapsed) },
  setWrldFullscreen: (wrldFullscreen) => set({ wrldFullscreen }),
  setTheme: (theme) => { set({ theme }); ls.set('theme', theme) },
  saveCustomSkin: (skin) => {
    const list = get().customSkins
    const idx = list.findIndex((s) => s.id === skin.id)
    const next = idx >= 0 ? list.map((s) => (s.id === skin.id ? skin : s)) : [...list, skin]
    set({ customSkins: next })
    ls.set('customSkins', next)
    // Keep the module cache getSkin() reads in step � the theme effect reruns
    // on this state change and repaints from the cache (live preview when the
    // edited skin is the active one).
    setCustomSkinsCache(next)
  },
  deleteCustomSkin: (id) => {
    const next = get().customSkins.filter((s) => s.id !== id)
    set({ customSkins: next })
    ls.set('customSkins', next)
    setCustomSkinsCache(next)
    if (get().theme === id) get().setTheme('dark')
  },
  setSidebarPosition: (sidebarPosition) => { set({ sidebarPosition }); ls.set('sidebarPosition', sidebarPosition) },
  setAppMenuPosition: (appMenuPosition) => { set({ appMenuPosition }); ls.set('appMenuPosition', appMenuPosition) },
  setNavOrder: (navOrder) => { set({ navOrder }); ls.set('navOrder', navOrder) },
  setHomeSectionVisible: (id, visible) => {
    const homeSectionVisibility = { ...get().homeSectionVisibility, [id]: visible }
    set({ homeSectionVisibility })
    ls.set('homeSectionVisibility', homeSectionVisibility)
  },
  setNavItemVisible: (view, visible) => {
    const navVisibility = { ...get().navVisibility, [view]: visible }
    set({ navVisibility })
    ls.set('navVisibility', navVisibility)
  },
  setNavControlOrder: (navControlOrder) => { set({ navControlOrder }); ls.set('navControlOrder', navControlOrder) },
  setNavControlVisible: (id, visible) => {
    const navControlVisibility = { ...get().navControlVisibility, [id]: visible }
    set({ navControlVisibility })
    ls.set('navControlVisibility', navControlVisibility)
  },

  // -- Settings --------------------------------------------------------------
  crossfadeEnabled: ls.get<boolean>('crossfadeEnabled') ?? false,
  crossfadeDuration: ls.get<number>('crossfadeDuration') ?? 5,
  pauseFadeEnabled: ls.get<boolean>('pauseFadeEnabled') ?? false,
  sleepTimerEnd: null,
  audioOutput: ls.get<string>('audioOutput') ?? '',
  accentColor: ls.get<string>('accentColor') ?? '#1db954',
  appTextScale: ls.get<number>('appTextScale') ?? 1,
  // getFont() maps unknown persisted ids (a renamed/removed stack) to System.
  appFont: getFont(ls.get<string>('appFont')).id,
  lyricsFont: getFont(ls.get<string>('lyricsFont')).id,
  lyricsScale: ls.get<number>('lyricsScale') ?? 1,
  lyricsAlign: ls.get<'left' | 'center'>('lyricsAlign') ?? 'left',
  lyricsBlur: ls.get<boolean>('lyricsBlur') ?? true,
  lyricsOverride: ls.get<boolean>('lyricsOverride') ?? false,
  fullEraNames: ls.get<boolean>('fullEraNames') ?? false,
  lyricsBlurAmount: ls.get<number>('lyricsBlurAmount') ?? 1,
  lyricsColorActive: ls.get<string>('lyricsColorActive'),
  lyricsColorInactive: ls.get<string>('lyricsColorInactive'),
  gradientsEnabled: ls.get<boolean>('gradientsEnabled') ?? true,
  surfaceGradientsEnabled: ls.get<boolean>('surfaceGradientsEnabled') ?? true,
  wrldThemeBackground: ls.get<boolean>('wrldThemeBackground') ?? false,
  preferOgVersion: ls.get<boolean>('preferOgVersion') ?? false,
  rotateSuggestedCovers: ls.get<boolean>('rotateSuggestedCovers') ?? false,
  eraCovers: ls.get<Record<string, string>>('eraCovers') ?? {},
  mediaOverlayEnabled: ls.get<boolean>('mediaOverlayEnabled') ?? true,
  lastfmUser: getLastfmSession()?.name ?? null,
  lastfmEnabled: ls.get<boolean>('lastfmEnabled') ?? true,
  // Merge stored overrides onto the defaults so a kind added in a later version
  // is enabled by default even for installs whose saved object predates it.
  popoutWindows: { ...POPOUT_WINDOW_DEFAULTS, ...(ls.get<Partial<Record<PopoutWindowKind, boolean>>>('popoutWindows') ?? {}) },
  hotkeyBindings: ls.get<Record<string, string>>('hotkeyBindings') ?? {},
  hotkeySeekSeconds: ls.get<number>('hotkeySeekSeconds') ?? 10,
  globalHotkeysEnabled: ls.get<boolean>('globalHotkeysEnabled') ?? false,
  globalHotkeyBindings: ls.get<Record<string, string>>('globalHotkeyBindings') ?? {},

  setCrossfade: (enabled, duration) => {
    set({ crossfadeEnabled: enabled, crossfadeDuration: duration })
    ls.set('crossfadeEnabled', enabled)
    ls.set('crossfadeDuration', duration)
  },
  setPauseFade: (enabled) => { set({ pauseFadeEnabled: enabled }); ls.set('pauseFadeEnabled', enabled) },
  setSleepTimer: (sleepTimerEnd) => set({ sleepTimerEnd }),
  setAudioOutput: (deviceId) => { set({ audioOutput: deviceId }); ls.set('audioOutput', deviceId) },
  setPreferOgVersion: (enabled) => { set({ preferOgVersion: enabled }); ls.set('preferOgVersion', enabled) },

  setRotateSuggestedCovers: (enabled) => {
    set({ rotateSuggestedCovers: enabled })
    ls.set('rotateSuggestedCovers', enabled)
    if (enabled) return
    // Turning it off has to forget the chosen covers, or every song stays
    // frozen on whichever suggestion it happened to land on. Re-derive the
    // visible tracks afterwards so the current song snaps back immediately
    // rather than at the next track change.
    resetCoverRotation()
    const { queue, currentTrack, currentTrackFull, songPrefs } = get()
    // Only API songs � a local file has no apiImageUrl to fall back on, so
    // running it through applyPrefToTrack would blank its album art.
    const redraw = (t: Track): Track => {
      const id = userApi.trackIdToSongId(t.id)
      return id == null ? t : applyPrefToTrack(t, songPrefs[id])
    }
    const nextQueue = queue.map(redraw)
    const nextCurrent = currentTrack ? redraw(currentTrack) : currentTrack
    set({
      queue: nextQueue,
      currentTrack: nextCurrent,
      // Only when the current track was actually re-derived: for a local file
      // currentTrackFull.albumArt is the embedded full-size art, which must not
      // be overwritten with the track's thumbnail URL.
      ...(currentTrackFull && nextCurrent !== currentTrack
        ? { currentTrackFull: { ...currentTrackFull, albumArt: nextCurrent?.imageUrl ?? null } }
        : {}),
    })
  },

  setEraCoverOverride: (era, raw) => {
    setEraCoverRaw(era, raw)
    const nextCovers = { ...get().eraCovers }
    if (raw) nextCovers[era] = raw
    else delete nextCovers[era]
    set({ eraCovers: nextCovers })
    // Redraw every visible API track this era touches so the change shows up
    // immediately instead of at the next track change.
    const { queue, currentTrack, currentTrackFull, songPrefs } = get()
    const redraw = (t: Track): Track => {
      if (t.era !== era) return t
      const id = userApi.trackIdToSongId(t.id)
      return id == null ? t : applyPrefToTrack(t, songPrefs[id])
    }
    const nextQueue = queue.map(redraw)
    const nextCurrent = currentTrack ? redraw(currentTrack) : currentTrack
    set({
      queue: nextQueue,
      currentTrack: nextCurrent,
      ...(currentTrackFull && nextCurrent !== currentTrack
        ? { currentTrackFull: { ...currentTrackFull, albumArt: nextCurrent?.imageUrl ?? null } }
        : {}),
    })
  },

  _maybeRotateCover: (songId) => {
    if (!get().rotateSuggestedCovers) return
    // A cover the user picked always wins � rotation fills gaps, it doesn't
    // override choices.
    if (get().songPrefs[songId]?.cover_url) return
    advanceRotatedCover(songId)
      // The rotated URL lives outside the store (lib/coverRotation), so the
      // re-derive is what actually moves it onto the visible tracks.
      .then((url) => { if (url) get()._reapplySongPref(songId) })
      .catch(() => {})
  },
  setMediaOverlayEnabled: (enabled) => { set({ mediaOverlayEnabled: enabled }); ls.set('mediaOverlayEnabled', enabled) },
  setLastfmUser: (lastfmUser) => set({ lastfmUser }),
  setLastfmEnabled: (enabled) => { set({ lastfmEnabled: enabled }); ls.set('lastfmEnabled', enabled) },
  setPopoutWindow: (kind, enabled) => {
    const popoutWindows = { ...get().popoutWindows, [kind]: enabled }
    set({ popoutWindows })
    ls.set('popoutWindows', popoutWindows)
  },
  setAccentColor: (color) => { set({ accentColor: color }); ls.set('accentColor', color) },
  setAppTextScale: (appTextScale) => { set({ appTextScale }); ls.set('appTextScale', appTextScale) },
  setAppFont: (appFont) => { set({ appFont }); ls.set('appFont', appFont) },
  setLyricsFont: (lyricsFont) => { set({ lyricsFont }); ls.set('lyricsFont', lyricsFont) },
  setLyricsScale: (lyricsScale) => { set({ lyricsScale }); ls.set('lyricsScale', lyricsScale) },
  setLyricsAlign: (lyricsAlign) => { set({ lyricsAlign }); ls.set('lyricsAlign', lyricsAlign) },
  setLyricsBlur: (lyricsBlur) => { set({ lyricsBlur }); ls.set('lyricsBlur', lyricsBlur) },
  setLyricsOverride: (lyricsOverride) => { set({ lyricsOverride }); ls.set('lyricsOverride', lyricsOverride) },
  setFullEraNames: (fullEraNames) => { set({ fullEraNames }); ls.set('fullEraNames', fullEraNames) },
  setLyricsBlurAmount: (lyricsBlurAmount) => { set({ lyricsBlurAmount }); ls.set('lyricsBlurAmount', lyricsBlurAmount) },
  setLyricsColorActive: (lyricsColorActive) => { set({ lyricsColorActive }); ls.set('lyricsColorActive', lyricsColorActive) },
  setLyricsColorInactive: (lyricsColorInactive) => { set({ lyricsColorInactive }); ls.set('lyricsColorInactive', lyricsColorInactive) },
  setGradientsEnabled: (gradientsEnabled) => { set({ gradientsEnabled }); ls.set('gradientsEnabled', gradientsEnabled) },
  setSurfaceGradientsEnabled: (surfaceGradientsEnabled) => { set({ surfaceGradientsEnabled }); ls.set('surfaceGradientsEnabled', surfaceGradientsEnabled) },
  setWrldThemeBackground: (wrldThemeBackground) => { set({ wrldThemeBackground }); ls.set('wrldThemeBackground', wrldThemeBackground) },

  setHotkeyBinding: (actionId, combo) => {
    const current = get().hotkeyBindings
    const next = { ...current }
    // Assigning a combo already bound elsewhere hands it over: clear it from
    // whichever action currently resolves to it, so no two actions share a key.
    if (combo) {
      for (const a of HOTKEY_ACTIONS) {
        if (a.id !== actionId && effectiveBinding(a.id, current) === combo) next[a.id] = ''
      }
    }
    const action = HOTKEY_ACTIONS.find((a) => a.id === actionId)
    // Store an override only when it differs from the default � if the user
    // sets it back to the default (or clears one that had no default), drop the
    // entry entirely so the persisted map stays minimal.
    if (combo === (action?.defaultBinding ?? '')) delete next[actionId]
    else next[actionId] = combo
    set({ hotkeyBindings: next })
    ls.set('hotkeyBindings', next)
  },
  resetHotkeyBindings: () => { set({ hotkeyBindings: {} }); ls.set('hotkeyBindings', {}) },
  resetGlobalHotkeyBindings: () => { set({ globalHotkeyBindings: {} }); ls.set('globalHotkeyBindings', {}) },
  setHotkeySeekSeconds: (seconds) => { set({ hotkeySeekSeconds: seconds }); ls.set('hotkeySeekSeconds', seconds) },
  setGlobalHotkeysEnabled: (enabled) => { set({ globalHotkeysEnabled: enabled }); ls.set('globalHotkeysEnabled', enabled) },
  setGlobalHotkeyBinding: (actionId, combo) => {
    const current = get().globalHotkeyBindings
    const next = { ...current }
    // Same one-combo-one-action rule as setHotkeyBinding, but scoped to the
    // global namespace � an in-app and a global binding are free to share a
    // combo since they're delivered through entirely different paths.
    if (combo) {
      for (const a of HOTKEY_ACTIONS) {
        if (a.id !== actionId && effectiveGlobalBinding(a.id, current) === combo) next[a.id] = ''
      }
    }
    if (combo === defaultGlobalBinding(actionId)) delete next[actionId]
    else next[actionId] = combo
    set({ globalHotkeyBindings: next })
    ls.set('globalHotkeyBindings', next)
  },

  // -- Liked songs -----------------------------------------------------------
  likedTrackIds: ls.get<string[]>('likedTrackIds') ?? [],

  toggleLike: (trackId) => {
    const { likedTrackIds, account } = get()
    const wasLiked = likedTrackIds.includes(trackId)
    const next = wasLiked
      ? likedTrackIds.filter((id) => id !== trackId)
      : [...likedTrackIds, trackId]
    set({ likedTrackIds: next })
    ls.set('likedTrackIds', next)

    if (account) {
      const songId = userApi.trackIdToSongId(trackId)
      if (songId != null) {
        const op = wasLiked ? userApi.removeFavorite(songId) : userApi.addFavorite(songId)
        op.catch(() => {
          const current = get().likedTrackIds
          const reverted = wasLiked
            ? [...current, trackId]
            : current.filter((id) => id !== trackId)
          set({ likedTrackIds: reverted })
          ls.set('likedTrackIds', reverted)
        })
      }
    }
  },

  // -- Song preferences ------------------------------------------------------
  songPrefs: hydrateSongPrefs(),
  listeningPlays: hydrateListeningPlays(),

  // Every write lands in three places: Zustand state (so React re-renders),
  // localStorage (so overrides survive a restart and work logged out), and
  // lib/songPrefs' module cache (so songToTrack � which can't import this
  // store without a cycle � resolves overrides for Tracks built later).
  _setSongPrefs: (next) => {
    set({ songPrefs: next })
    ls.set('songPrefs', next)
    setSongPrefsCache(next)
  },

  _reapplySongPref: (songId) => {
    const { songPrefs, queue, currentTrack, currentTrackFull } = get()
    const pref = songPrefs[songId]
    const trackId = `jw-${songId}`
    const isCurrentTrack = currentTrack?.id === trackId
    const newCurrentTrack = isCurrentTrack ? applyPrefToTrack(currentTrack, pref) : currentTrack
    set({
      queue: queue.map((t: Track) => (t.id === trackId ? applyPrefToTrack(t, pref) : t)),
      currentTrack: newCurrentTrack,
      // currentTrackFull is a separate snapshot (lyrics/metadata) that Player
      // only rebuilds when the track id changes � without this fan-out a cover
      // change wouldn't show until the song replayed, same reasoning as
      // updateLibraryTrack's currentTrackFull sync above.
      ...(isCurrentTrack && currentTrackFull ? { currentTrackFull: { ...currentTrackFull, albumArt: newCurrentTrack?.imageUrl ?? null } } : {}),
    })
  },

  _setListeningPlays: (next) => {
    set({ listeningPlays: next })
    ls.set('listeningPlays', next)
  },

  _scheduleProfilePush: (fields) => {
    if (!get().account || !preferencesApi.preferencesApiEnabled) return
    for (const f of fields) _profilePushDirty[f] = true
    if (_profilePushTimer) clearTimeout(_profilePushTimer)
    _profilePushTimer = setTimeout(() => {
      _profilePushTimer = null
      const dirty = _profilePushDirty
      _profilePushDirty = { songPrefs: false, listeningPlays: false, folders: false }
      const state = get()
      profilePushApi.pushProfile({
        songPrefs: dirty.songPrefs ? Object.values(state.songPrefs) : undefined,
        listeningPlays: dirty.listeningPlays ? state.listeningPlays : undefined,
        folders: dirty.folders ? state.playlistFolders : undefined,
      }).catch(() => {})
    }, PROFILE_PUSH_DEBOUNCE_MS)
  },

  _writeSongPref: (songId, patch) => {
    get()._setSongPrefs(patchPrefMap(get().songPrefs, songId, patch))
    if (patch.name !== undefined || patch.cover_url !== undefined) get()._reapplySongPref(songId)
    // No rollback on push failure: the local write is already durable, and the
    // profile blob is replaced wholesale on the next push or login merge � a
    // transient PATCH failure shouldn't undo an edit the user just made.
    get()._scheduleProfilePush(['songPrefs'])
  },

  setSongName: (songId, name) => get()._writeSongPref(songId, { name: normalizePrefText(name) }),
  setSongCover: (songId, coverUrl) => get()._writeSongPref(songId, { cover_url: normalizePrefText(coverUrl) }),
  setSongDefaultVersion: (songId, version) => get()._writeSongPref(songId, { default_version: normalizePrefText(version) }),

  setSongExcludedVersions: (songId, versions) => get()._writeSongPref(songId, { excluded_versions: versions }),

  clearSongPref: (songId) => {
    const before = get().songPrefs
    if (!before[songId]) return
    const next = { ...before }
    delete next[songId]
    get()._setSongPrefs(next)
    get()._reapplySongPref(songId)
    get()._scheduleProfilePush(['songPrefs'])
  },

  bumpSongPlaycount: (songId) => {
    const prefs = get().songPrefs
    // The profile blob stores absolute counts (there's no server-side
    // increment), so this device just bumps locally and the debounced push
    // sends its totals; login merges take max() per song across devices so
    // one device's push can't erase plays made on another. The play *event*
    // appended alongside it is additive instead � merges union the two sides.
    get()._setSongPrefs(patchPrefMap(prefs, songId, { playcount: (prefs[songId]?.playcount ?? 0) + 1 }))
    get()._setListeningPlays(appendListeningPlay(get().listeningPlays, songId))
    get()._scheduleProfilePush(['songPrefs', 'listeningPlays'])
  },

  syncSongPrefs: async (serverPrefs) => {
    if (!preferencesApi.preferencesApiEnabled) return
    try {
      const rows = serverPrefs ?? []
      const local = get().songPrefs
      const merged: SongPrefMap = {}
      // The profile's copy wins for override fields (another device may have
      // edited them since this one last pushed) � except playcount, where
      // max() is the only merge that never loses plays made here offline.
      for (const row of rows) {
        const mine = local[row.song]
        merged[row.song] = mine
          ? { ...row, playcount: Math.max(row.playcount ?? 0, mine.playcount ?? 0) }
          : row
      }
      // Rows that exist only on this device (set before signing in, or on
      // songs the profile blob dropped at the 500 cap) are kept and pushed.
      for (const pref of Object.values(local)) {
        if (!merged[pref.song]) merged[pref.song] = pref
      }
      get()._setSongPrefs(merged)
      // Goes through the shared debounced scheduler rather than pushing
      // immediately — loadAccount calls this alongside syncListeningPlays and
      // syncFolders right after, and routing all three through the same
      // timer collapses what used to be three separate login-time PATCHes
      // into one.
      get()._scheduleProfilePush(['songPrefs'])
    } catch {}
  },

  syncListeningPlays: async (serverPlays) => {
    if (!preferencesApi.preferencesApiEnabled) return
    try {
      const serverRows = (serverPlays ?? [])
        .map(normalizeListeningPlayEvent)
        .filter((row): row is ListeningPlayEvent => row != null)
      const merged = mergeListeningPlays(get().listeningPlays, serverRows)
      get()._setListeningPlays(merged)
      get()._scheduleProfilePush(['listeningPlays'])
    } catch {}
  },

  // -- Reports (feedback + song issue reports) --------------------------------
  pendingReports: ls.get<PendingReport[]>('pendingReports') ?? [],
  reportModal: null,
  convertModal: null,
  urlImportModal: false,

  openReport: (target) => set({ reportModal: target }),
  closeReport: () => set({ reportModal: null }),
  openConvert: (target) => {
    // Same pop-out-or-dock branch the editors use: with the "Convert format"
    // pop-out enabled, this opens its own window instead of an in-app dialog.
    // Only the three plain fields ride the URL params (see ConvertTarget).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (el?.openFloatWindow && get().popoutWindows.convert) {
      el.openFloatWindow('convert', { trackId: target.id, filePath: target.path, title: target.title })
      return
    }
    // Re-opening while already docked (sandbox notch collapsed) wouldn't
    // otherwise re-expand it — see the matching comment on setShowSettings.
    useSandboxStore.getState().expand()
    set({ convertModal: { id: target.id, path: target.path, title: target.title } })
  },
  closeConvert: () => set({ convertModal: null }),
  openUrlImport: () => set({ urlImportModal: true }),
  closeUrlImport: () => set({ urlImportModal: false }),

  _enqueueReport: async (report: PendingReport) => {
    const next = [...get().pendingReports, report]
    set({ pendingReports: next })
    ls.set('pendingReports', next)
    // This window's own flush is a no-op in a pop-out (only the main window
    // sends) � the enqueue above syncs to it over windowSync, which flushes on
    // receipt and syncs the outcome back. Wait for that instead of the local
    // (always-empty) flush, so the pop-out doesn't report "queued" instantly
    // even for one about to be delivered a moment later.
    if (IS_FLOAT_WINDOW) return waitForReportSettled(report.id)
    // Wait for this round of delivery so the caller can tell the user whether
    // it actually reached the server or is just sitting in the outbox.
    await get()._flushReports()
    return !get().pendingReports.some((r) => r.id === report.id)
  },

  submitFeedback: async (category, message, contact) => {
    const text = message.trim()
    if (!text) return false
    return get()._enqueueReport({
      id: newReportId(), kind: 'feedback', category, message: text,
      contact: contact?.trim() || undefined,
      appVersion: APP_VERSION, createdAt: Date.now(), attempts: 0,
    })
  },

  reportSong: async (songId, songName, issues, message, contact) => {
    // A report needs at least a flagged issue or a written note to be worth
    // sending � the form enforces this too, but guard here so no empty report
    // can reach the outbox.
    if (issues.length === 0 && !message.trim()) return false
    return get()._enqueueReport({
      id: newReportId(), kind: 'song', songId, songName,
      issues, message: message.trim(),
      contact: contact?.trim() || undefined,
      appVersion: APP_VERSION, createdAt: Date.now(), attempts: 0,
    })
  },

  dismissReport: (id) => {
    const next = get().pendingReports.filter((r) => r.id !== id)
    set({ pendingReports: next })
    ls.set('pendingReports', next)
  },

  _flushReports: async () => {
    if (_reportsFlushing) return
    if (!reportsApi.reportsApiEnabled) return
    // Pop-outs share this outbox through localStorage; without an idempotency
    // key on the live endpoints, only the main window may deliver it.
    if (IS_FLOAT_WINDOW) return
    const queue = get().pendingReports.filter(isDeliverable)
    if (queue.length === 0) return
    _reportsFlushing = true
    try {
      for (const report of queue) {
        try {
          // The endpoints are unauthenticated; a logged-in user's Discord
          // username rides along as contact when the form left it blank.
          const contact = report.contact || get().account?.discord_username || undefined
          if (report.kind === 'feedback') await reportsApi.submitFeedback(report, contact)
          else await reportsApi.submitSongReport(report, contact)
          // Delivered � drop it, re-reading current state so a report queued
          // mid-flush isn't lost.
          const remaining = get().pendingReports.filter((r) => r.id !== report.id)
          set({ pendingReports: remaining })
          ls.set('pendingReports', remaining)
        } catch {
          // Delivery failed � count the attempt so a permanently-rejected
          // report eventually stops auto-retrying (see MAX_REPORT_ATTEMPTS).
          const bumped = get().pendingReports.map((r) =>
            r.id === report.id ? { ...r, attempts: r.attempts + 1 } : r,
          )
          set({ pendingReports: bumped })
          ls.set('pendingReports', bumped)
        }
      }
    } finally {
      _reportsFlushing = false
    }
  },

  // -- Playlist folders -------------------------------------------------------
  playlistFolders: ls.get<PlaylistFolder[]>('playlistFolders') ?? [],

  _setFolders: (next) => {
    set({ playlistFolders: next })
    ls.set('playlistFolders', next)
  },

  createFolder: (name, playlistKeys = []) => {
    const clean = normalizeFolderName(name)
    if (!clean) return null
    const now = Date.now()
    const id = newFolderId()
    // A playlist lives in one folder, so pull the seed keys out of any folder
    // they're already in before creating this one.
    const seed = new Set(playlistKeys)
    const existing = get().playlistFolders.map((f) => ({
      ...f, playlistKeys: f.playlistKeys.filter((k) => !seed.has(k)),
    }))
    const folder: PlaylistFolder = { id, name: clean, playlistKeys: [...seed], createdAt: now, updatedAt: now }
    get()._setFolders([...existing, folder])
    get()._scheduleProfilePush(['folders'])
    return id
  },

  renameFolder: (id, name) => {
    const clean = normalizeFolderName(name)
    if (!clean) return
    const next = get().playlistFolders.map((f) =>
      f.id === id ? { ...f, name: clean, updatedAt: Date.now() } : f,
    )
    get()._setFolders(next)
    get()._scheduleProfilePush(['folders'])
  },

  deleteFolder: (id) => {
    get()._setFolders(get().playlistFolders.filter((f) => f.id !== id))
    get()._scheduleProfilePush(['folders'])
  },

  movePlaylistsToFolder: (playlistKeys, folderId) => {
    const moving = new Set(playlistKeys)
    const now = Date.now()
    const next = get().playlistFolders.map((f) => {
      // Remove the moving keys from every folder first�
      const without = f.playlistKeys.filter((k) => !moving.has(k))
      // �then append them to the target (dedup preserved by the removal above).
      if (f.id === folderId) return { ...f, playlistKeys: [...without, ...playlistKeys], updatedAt: now }
      return without.length === f.playlistKeys.length ? f : { ...f, playlistKeys: without, updatedAt: now }
    })
    get()._setFolders(next)
    get()._scheduleProfilePush(['folders'])
  },

  pruneFolders: (validKeys) => {
    const next = pruneFolders(get().playlistFolders, new Set(validKeys))
    if (next !== get().playlistFolders) get()._setFolders(next)
  },

  syncFolders: async (serverFolders) => {
    if (!foldersApi.foldersApiEnabled) return
    try {
      const local = get().playlistFolders
      const server = serverFolders ?? []
      if (server.length === 0) {
        // Nothing on the account yet — push what's here so this device's
        // folders become the starting point.
        if (local.length > 0) get()._scheduleProfilePush(['folders'])
        return
      }
      // The profile's list is the source of truth for synced-playlist
      // membership. Folder ids are client-generated and round-trip through
      // the blob unchanged, so a same-id local folder IS the same folder �
      // re-attach its device-local ("local:") members, which the server
      // never stores.
      const localById = new Map(local.map((f) => [f.id, f]))
      const merged: PlaylistFolder[] = server.map((s) => {
        const mine = localById.get(s.id)
        const localKeys = (mine?.playlistKeys ?? []).filter((k) => k.startsWith('local:'))
        return {
          id: s.id,
          name: s.name,
          playlistKeys: [...s.playlist_ids.map((id) => `api:${id}`), ...localKeys],
          createdAt: mine?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        }
      })
      // A local folder the server doesn't know: if it holds ONLY device-local
      // members it's a device-only folder � keep it. If it holds synced
      // members, its absence from the profile means another device deleted it
      // after this device last pushed � honour the delete by dropping it.
      const serverIds = new Set(server.map((s) => s.id))
      for (const f of local) {
        const hasLocal = f.playlistKeys.some((k) => k.startsWith('local:'))
        const hasApi = f.playlistKeys.some((k) => k.startsWith('api:'))
        if (!serverIds.has(f.id) && hasLocal && !hasApi) merged.push(f)
      }
      get()._setFolders(merged)
      get()._scheduleProfilePush(['folders'])
    } catch {}
  },

  // -- API tracker extras ----------------------------------------------------
  apiTrackerCategory: '',
  apiTrackerEra: '',
  apiTrackerTab: '',
  apiFilesPath: '',
  apiFilesLastPath: '',

  setApiTrackerCategory: (cat) => set({ apiTrackerCategory: cat }),
  setApiTrackerEra: (era) => set({ apiTrackerEra: era }),
  setApiTrackerTab: (tab) => set({ apiTrackerTab: tab }),
  setApiFilesLastPath: (path) => set({ apiFilesLastPath: path }),
  setApiFilesPath: (path) => set({ apiFilesPath: path }),

  channels: [],
  activeChannel: ls.get<string>('activeChannel') || '',
  setActiveChannel: (slug) => { set({ activeChannel: slug }); ls.set('activeChannel', slug); setActiveChannelCache(slug) },
  loadChannels: async () => {
    const list = await fetchChannels()
    if (!list.length) return
    const current = get().activeChannel
    const valid = list.some((c) => c.slug === current)
    const primary = list.find((c) => c.is_primary) ?? list[0]
    const next = valid ? current : primary.slug
    set({ channels: list, activeChannel: next })
    ls.set('activeChannel', next)
    setActiveChannelCache(next)
  },

  // -- Account ---------------------------------------------------------------
  account: null,
  playlists: [],
  showUserAuth: false,
  pendingPlaylistId: null,
  mutedUserIds: ls.get<number[]>('mutedUserIds') ?? [],
  // Mirrors chatStore's own local mutedServers/mutedConversations (that store
  // owns them; see chatStore's loadMuted/saveMuted). Empty until chatStore's
  // account hydrate calls _syncChatMutes.
  chatMutedServers: [],
  chatMutedConversations: [],
  favoriteGifs: ls.get<GifResult[]>('favoriteGifs') ?? [],
  setPendingPlaylistId: (id) => set({ pendingPlaylistId: id }),
  playlistsSelectedId: null,
  playlistsSelectedLocalId: null,
  playlistsSort: { field: 'default', dir: 'asc' },
  setPlaylistsSort: (sort) => set({ playlistsSort: sort }),
  setPlaylistsSelectedId: (id) => set({ playlistsSelectedId: id }),
  setPlaylistsSelectedLocalId: (id) => set({ playlistsSelectedLocalId: id }),
  playlistsOpenFolderId: null,
  setPlaylistsOpenFolderId: (id) => set({ playlistsOpenFolderId: id }),

  setShowUserAuth: (showUserAuth) => {
    // Backdrop clicks intentionally collapse the sandbox without unmounting
    // its modals. Re-opening auth while it is still mounted therefore has to
    // expand the sandbox explicitly; setting an already-true boolean alone
    // would be a no-op and leave the login modal hidden behind the pill.
    if (showUserAuth) useSandboxStore.getState().expand()
    set({ showUserAuth })
  },

  loadAccount: async () => {
    // Overlapping callers (see the flag's comment above) await the same run
    // instead of each kicking off their own -- the GET /me itself dedupes via
    // apiClient's in-flight map, but the PATCH /me pushes further down don't
    // (only GETs with a cacheKey do), so without this each duplicate caller
    // was pushing prefs/plays/folders all over again.
    if (_loadAccountInFlight) return _loadAccountInFlight
    _loadAccountInFlight = (async () => {
      if (!userApi.getToken()) return
      try {
        const account = await userApi.getMe()
        set({ account })
      } catch (err) {
        // Only clear token on auth errors � network/server errors should not log the user out
        const msg = String(err)
        if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
          userApi.clearToken()
          set({ account: null, playlists: [] })
        }
        return
      }
      try {
        const favorites = await userApi.getFavorites()
        const serverIds = favorites.map((f) => `jw-${f.song.id}`)
        const localOnly = get().likedTrackIds.filter((id) => !serverIds.includes(id))
        await Promise.all(
          localOnly
            .map((id) => userApi.trackIdToSongId(id))
            .filter((sid): sid is number => sid != null)
            .map((sid) => userApi.addFavorite(sid).catch(() => undefined)),
        )
        const merged = Array.from(new Set([...serverIds, ...localOnly]))
        set({ likedTrackIds: merged })
        ls.set('likedTrackIds', merged)
      } catch {}
      // The preference/folder blobs ride on the getMe() response � merge them
      // with local state and push the result back, no extra requests needed.
      const profile = get().account
      await get().syncSongPrefs(profile?.user_preferences)
      get().syncListeningPlays(profile?.listening_plays)
      get().syncFolders(profile?.playlist_folders)
      // Deliver any reports queued while signed out � a logged-in flush can
      // attach the account's Discord username as the contact field.
      get()._flushReports()
      await get().refreshPlaylists()
      // Fire-and-forget: warm playlist tracks + covers in the background so the
      // Playlists page is ready before the user ever navigates to it. Two
      // requests per playlist, so it waits for idle rather than piling onto the
      // startup burst.
      runWhenIdle(() => { get().prefetchPlaylistDetails() })
    })().finally(() => { _loadAccountInFlight = null })
    return _loadAccountInFlight
  },

  loginWithDiscord: async () => {
    const redirectUri = userApi.discordRedirectUri()
    const { authorize_url, state } = await userApi.getDiscordAuthUrl(redirectUri)
    // Defense-in-depth CSRF check: the server already validates `state`
    // server-side, but stash the issued value so completeDiscordLogin can
    // also reject a mismatched one before ever calling exchange. sessionStorage
    // (not the in-memory store) survives the full-page redirect the web flow does.
    try { window.sessionStorage.setItem('discord_oauth_state', state) } catch {}
    const el = (window as any).electron
    if (el?.openDiscordLogin) {
      // Electron: open a popup BrowserWindow � intercepts the OAuth callback
      const result = await el.openDiscordLogin(authorize_url) as { code: string; state: string } | null
      if (result?.code && result?.state) {
        await get().completeDiscordLogin(result.code, result.state)
      }
    } else {
      // Web: standard redirect
      window.location.href = authorize_url
    }
  },

  completeDiscordLogin: async (code, state) => {
    let expectedState: string | null = null
    try { expectedState = window.sessionStorage.getItem('discord_oauth_state') } catch {}
    try { window.sessionStorage.removeItem('discord_oauth_state') } catch {}
    if (expectedState && state !== expectedState) {
      throw new Error('Discord OAuth state mismatch')
    }
    const redirectUri = userApi.discordRedirectUri()
    const { token, user } = await userApi.exchangeDiscord(code, state, redirectUri)
    userApi.setToken(token)
    set({ account: user })
    await get().loadAccount()
  },

  logoutAccount: async () => {
    await userApi.logout()
    const localLikes = ls.get<string[]>('likedTrackIds') ?? []
    set({ account: null, playlists: [], likedTrackIds: localLikes, donorFiles: null })
    // Overrides stay on this device after signing out, the same way likes do �
    // they're re-merged upward on the next login.
    get()._setSongPrefs(ls.get<SongPrefMap>('songPrefs') ?? {})
    // Play history does NOT stay: unlike a rename or a cover override, it's a
    // timestamped record of what this person listened to, and the next account
    // to sign in on this machine would merge it in and push it to their own
    // profile. The server copy is authoritative from the next login anyway.
    get()._setListeningPlays([])
  },

  refreshPlaylists: async () => {
    if (!get().account) return
    if (_playlistsInFlight) return
    _playlistsInFlight = true
    try {
      const playlists = await userApi.getPlaylists()
      set({ playlists })
    } catch {}
    finally { _playlistsInFlight = false }
  },

  // Warm the in-memory (and, via the API layer, localStorage) caches for every
  // playlist's tracks + cover right after the summaries load � so opening the
  // Playlists page and any individual playlist renders instantly instead of
  // showing a spinner while it fetches. Runs in the background off startup;
  // skips playlists already cached, so repeat calls are cheap and it never
  // re-fetches what a prior session-warmed peek already holds. Concurrency is
  // capped so this stays low-priority and doesn't stall foreground requests.
  prefetchPlaylistDetails: async () => {
    if (_detailsPrefetchInFlight) return
    const targets = get().playlists.filter(p => !userApi.peekPlaylistDetail(p.id))
    if (!targets.length) return
    _detailsPrefetchInFlight = true
    try {
      const CONCURRENCY = 3
      let idx = 0
      const run = async (): Promise<void> => {
        while (idx < targets.length) {
          const p = targets[idx++]
          // getPlaylist warms the track/detail cache; getPlaylistCover warms
          // the cover cache (and no-ops if already cached). Failures are
          // swallowed � a prefetch miss just means the normal on-open fetch
          // happens later, so it must never surface as an error.
          await userApi.getPlaylist(p.id).catch(() => undefined)
          await userApi.getPlaylistCover(p.id).catch(() => undefined)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, run))
    } finally {
      _detailsPrefetchInFlight = false
    }
  },

  // Warm the offline cache for the Tracker and Files views on startup, so those
  // pages are ready � and render instantly when offline � before the user ever
  // navigates to them. These calls go through apiFetch's cacheKey, which is the
  // same offline fallback the views themselves read from on a network failure,
  // and the URLs/params match the views' own first fetches exactly so the cache
  // keys line up (tracker: stats + eras + first unfiltered song page; files:
  // the root folder listing). Fire-and-forget and failure-tolerant � a miss
  // just means the view does its normal fetch later.
  //
  // Anything already in the cache is skipped. This runs at idle, by which point
  // the view that's actually on screen has usually fetched (and cached) three
  // of these four itself � re-requesting them would make the prefetch a source
  // of duplicate traffic rather than a way to avoid it. Refreshing a warm entry
  // isn't the job here: every view refetches on open anyway, so a stale cache
  // entry only ever shows for the instant before that lands.
  prefetchApiData: async () => {
    if (_apiPrefetchInFlight) return
    _apiPrefetchInFlight = true
    try {
      const targets: Array<[string, Record<string, string | number>]> = [
        ['/stats/', {}],
        ['/eras/', {}],
        ['/songs/', { page: 1, page_size: 50 }],
        ['/files/browse/', {}],
      ]
      await Promise.allSettled(
        targets
          .filter(([path, params]) => apiPeek(path, params) === undefined)
          .map(([path, params]) => apiFetch(path, params)),
      )
      get().loadChannels().catch(() => {})
    } finally {
      _apiPrefetchInFlight = false
    }
  },

  // -- Editor ----------------------------------------------------------------
  pendingCompProposal: null,
  pendingEditorSongId: null,
  pendingEditProposal: null,
  pendingLocalEditTrack: null,
  bulkEdit: null,
  openBulkEditor: (songs) => set({ bulkEdit: songs.length ? { kind: 'api', songs } : null }),
  openBulkTrackEditor: (tracks) => set({ bulkEdit: tracks.length ? { kind: 'local', tracks } : null }),
  closeBulkEditor: () => set({ bulkEdit: null }),
  setPendingCompProposal: (pendingCompProposal) => set({ pendingCompProposal }),
  setPendingEditorSongId: (pendingEditorSongId) => set({ pendingEditorSongId }),
  openSongEditor: (songId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (el?.openFloatWindow && get().popoutWindows.editor) {
      el.openFloatWindow('editor', { songId })
      return
    }
    // Pop-outs render whichever view their URL names � they have no in-app
    // router, so setting activeView here would silently do nothing (this is
    // how "Edit" in a pop-out song-info window used to be a dead button).
    // Hand it to the main window instead, same as the attach button does.
    if (IS_FLOAT_WINDOW) {
      el?.windowSyncSend?.({ type: 'attach', target: { view: 'editor', songId } })
      el?.focusMainWindow?.()
      return
    }
    set({ pendingEditorSongId: songId })
    get().setActiveView('editor')
  },
  setPendingEditProposal: (pendingEditProposal) => set({ pendingEditProposal }),
  setPendingLocalEditTrack: (pendingLocalEditTrack) => set({ pendingLocalEditTrack }),
  openLocalEditor: (track) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).electron
    if (el?.openFloatWindow && get().popoutWindows.localEditor) {
      el.openFloatWindow('local-editor', { trackId: track.id })
      return
    }
    // Same dead-button problem as openSongEditor above � a pop-out can't
    // navigate itself, so the main window opens the editor instead. It looks
    // the track up by id from its own library rather than taking this object.
    if (IS_FLOAT_WINDOW) {
      el?.windowSyncSend?.({ type: 'attach', target: { view: 'local-editor', trackId: track.id } })
      el?.focusMainWindow?.()
      return
    }
    set({ pendingLocalEditTrack: track })
    get().setActiveView('local-editor')
  },


  // -- Library ---------------------------------------------------------------
  libraryTracks: [],
  libraryArt: {},
  libraryLoaded: false,
  libraryFolders: ls.get<string[]>('libraryFolders') ?? [],
  libraryScanning: false,
  libraryLastScanned: ls.get<number>('libraryLastScanned') ?? null,
  // Off by default � periodic disk scans of a large library aren't free, so
  // this is opt-in rather than always re-checking every file's mtime/size.
  libraryAutoRefresh: ls.get<boolean>('libraryAutoRefresh') ?? false,
  developerMode: ls.get<boolean>('developerMode') ?? false,
  localPlaylists: [],
  activeLocalPlaylistId: null,
  followedPlaylists: ls.get<FollowedPlaylist[]>('followedPlaylists') ?? [],
  donorPlaylists: ls.get<DonorPlaylist[]>('donorPlaylists') ?? [],
  donorFiles: null,

  // -- Offline playlist sync ------------------------------------------------
  offlineTracks: {},
  offlinePlaylists: {},
  offlineSync: {},

  setLibraryTracks: (libraryTracks) => set({ libraryTracks }),
  // Insert a single scanned track (e.g. a freshly converted file), replacing any
  // existing entry with the same id so the library reflects it without a rescan.
  addLibraryTrack: (track) => set((s) => {
    const idx = s.libraryTracks.findIndex((t) => t.id === track.id)
    if (idx >= 0) {
      const next = s.libraryTracks.slice()
      next[idx] = track
      return { libraryTracks: next }
    }
    return { libraryTracks: [...s.libraryTracks, track] }
  }),
  deleteLibraryTrack: async (id) => {
    const el = (window as any).electron
    const track = get().libraryTracks.find((t) => t.id === id)
    if (!el?.deleteLibraryFile || !track) return false

    // Stop first when we're deleting what's currently playing: it keeps the app
    // from "playing" a trashed file, and releases our own read handle � Windows
    // refuses to move a file that's still open. The confirm prompt itself lives
    // in the main process (see the delete-library-file handler).
    if (get().currentTrack?.id === id && get().isPlaying) get().setIsPlaying(false)

    const res = await el.deleteLibraryFile(track.filePath)
    // Cancelled, or the delete failed � main already surfaced the error dialog.
    if (!res?.ok) return false

    const { libraryTracks, libraryArt, localPlaylists, queue, queueIndex, libraryFolders, libraryLastScanned } = get()
    const nextTracks = libraryTracks.filter((t) => t.id !== id)
    const nextArt = { ...libraryArt }
    delete nextArt[id]
    // Drop the now-dead id from any local playlist that referenced it.
    const touchedPlaylists = localPlaylists.some((p) => p.trackIds.includes(id))
    const nextPlaylists = touchedPlaylists
      ? localPlaylists.map((p) => p.trackIds.includes(id)
        ? { ...p, trackIds: p.trackIds.filter((t) => t !== id) } : p)
      : localPlaylists
    // Same for the queue, shifting queueIndex by however many copies sat ahead
    // of it so it keeps pointing at the entry it pointed at before.
    const removedBefore = queue.reduce((n, t, i) => n + (t.id === id && i < queueIndex ? 1 : 0), 0)
    const nextQueue = queue.filter((t) => t.id !== id)
    set({
      libraryTracks: nextTracks,
      libraryArt: nextArt,
      localPlaylists: nextPlaylists,
      queue: nextQueue,
      // -1 is the "nothing queued" sentinel the slice starts from.
      queueIndex: nextQueue.length ? Math.max(0, Math.min(queueIndex - removedBefore, nextQueue.length - 1)) : -1,
    })

    // Persist both, or the track reappears from library-data.json next load.
    el.saveLibraryData({ tracks: nextTracks, folders: libraryFolders, lastScanned: libraryLastScanned })
    if (touchedPlaylists) el.saveLocalPlaylists(nextPlaylists)
    return true
  },
  moveLibraryTrack: async (id) => {
    const el = (window as any).electron
    const track = get().libraryTracks.find((t) => t.id === id)
    if (!el?.moveLibraryFile || !track) return false

    // Playing the file holds a read handle open, which blocks the rename on
    // Windows � same reasoning as deleteLibraryTrack.
    if (get().currentTrack?.id === id && get().isPlaying) get().setIsPlaying(false)

    const res = await el.moveLibraryFile(track.filePath)
    // Cancelled, or the move failed � main already surfaced the error dialog.
    if (!res?.ok || !res.path) return false

    const newPath: string = res.path
    const newId = `local-${newPath}`
    const { libraryTracks, libraryArt, localPlaylists, queue, currentTrack, libraryFolders, libraryLastScanned } = get()

    // A track's id is derived from its path, so moving it re-keys the track
    // everywhere it's referenced rather than just editing one field.
    const nextTracks = libraryTracks.map((t) => t.id === id ? { ...t, id: newId, filePath: newPath } : t)
    const nextArt = { ...libraryArt }
    if (id in nextArt) { nextArt[newId] = nextArt[id]; delete nextArt[id] }
    const touchedPlaylists = localPlaylists.some((p) => p.trackIds.includes(id))
    const nextPlaylists = touchedPlaylists
      ? localPlaylists.map((p) => p.trackIds.includes(id)
        ? { ...p, trackIds: p.trackIds.map((t) => t === id ? newId : t) } : p)
      : localPlaylists
    // Clearing streamUrl (rather than rebuilding it) lets the Player re-derive
    // it from the new path � see its `track.streamUrl ?? toFileUrl(track.path)`.
    const rekey = <T extends { id: string }>(t: T): T =>
      t.id === id ? { ...t, id: newId, path: newPath, streamUrl: undefined } : t
    set({
      libraryTracks: nextTracks,
      libraryArt: nextArt,
      localPlaylists: nextPlaylists,
      queue: queue.map(rekey),
      currentTrack: currentTrack ? rekey(currentTrack) : currentTrack,
    })

    el.saveLibraryData({ tracks: nextTracks, folders: libraryFolders, lastScanned: libraryLastScanned })
    if (touchedPlaylists) el.saveLocalPlaylists(nextPlaylists)
    return true
  },
  updateLibraryTrack: (id, updates) => set((s) => {
    const artChanged = updates.albumArt !== undefined
    // Cover art lives in libraryArt, never on the track objects � keep the
    // track list metadata-only so it stays cheap to copy and persist. Route an
    // art edit into the map (the channel thumbnails subscribe to) instead.
    const { albumArt, ...meta } = updates
    const newLib = Object.keys(meta).length
      ? s.libraryTracks.map((t) => t.id === id ? { ...t, ...meta } : t)
      : s.libraryTracks
    const libraryArt = artChanged ? { ...s.libraryArt, [id]: albumArt as string | null } : s.libraryArt
    const newQueue = artChanged
      ? s.queue.map((t) => t.id === id ? { ...t, imageUrl: (albumArt as string) || '' } : t)
      : s.queue
    const isCurrentTrack = s.currentTrack?.id === id
    const newCurrentTrack = (isCurrentTrack && artChanged && s.currentTrack)
      ? { ...s.currentTrack, imageUrl: (albumArt as string) || '' }
      : s.currentTrack
    const newCurrentTrackFull = (isCurrentTrack && artChanged && s.currentTrackFull)
      ? { ...s.currentTrackFull, albumArt: albumArt as string | null }
      : s.currentTrackFull
    return { libraryTracks: newLib, libraryArt, queue: newQueue, currentTrack: newCurrentTrack, currentTrackFull: newCurrentTrackFull }
  }),
  // Batched form of updateLibraryTrack(id, { albumArt }) � collects results
  // for a frame's worth of time and applies them in ONE set(), with the same
  // queue/currentTrack art fan-out.
  applyLibraryArt: (id, art) => {
    if (!_pendingArt) {
      _pendingArt = new Map()
      setTimeout(() => {
        const batch = _pendingArt
        _pendingArt = null
        if (!batch || batch.size === 0) return
        set((s) => {
          // Covers land in their own map � NOT in libraryTracks � so a burst of
          // streaming covers never rebuilds the (potentially multi-thousand
          // entry) track array or invalidates the album/artist/song memos that
          // key on it. Only the per-id thumbnail subscribers re-render.
          const libraryArt = { ...s.libraryArt }
          for (const [k, v] of batch) libraryArt[k] = v
          // Fan the same covers out to the active queue / now-playing so an
          // already-queued local track picks up its art. Guarded so a large
          // queue isn't copied when none of the batched ids are even in it.
          const queue = s.queue.some((t) => batch.has(t.id))
            ? s.queue.map((t) => batch.has(t.id) ? { ...t, imageUrl: batch.get(t.id) || '' } : t)
            : s.queue
          const curId = s.currentTrack?.id
          const currentTrack = (curId && batch.has(curId) && s.currentTrack)
            ? { ...s.currentTrack, imageUrl: batch.get(curId) || '' }
            : s.currentTrack
          const currentTrackFull = (curId && batch.has(curId) && s.currentTrackFull)
            ? { ...s.currentTrackFull, albumArt: batch.get(curId) ?? null }
            : s.currentTrackFull
          return { libraryArt, queue, currentTrack, currentTrackFull }
        })
      }, 40)
    }
    _pendingArt.set(id, art)
  },
  addLibraryFolder: (folder) => {
    const { libraryFolders } = get()
    if (libraryFolders.includes(folder)) return
    const next = [...libraryFolders, folder]
    set({ libraryFolders: next })
    ls.set('libraryFolders', next)
  },
  removeLibraryFolder: (folder) => {
    const next = get().libraryFolders.filter((f) => f !== folder)
    set({ libraryFolders: next })
    ls.set('libraryFolders', next)
  },
  setLibraryLastScanned: (ts) => {
    set({ libraryLastScanned: ts })
    ls.set('libraryLastScanned', ts)
  },
  setLibraryAutoRefresh: (enabled) => {
    set({ libraryAutoRefresh: enabled })
    ls.set('libraryAutoRefresh', enabled)
  },
  setDeveloperMode: (enabled) => {
    set({ developerMode: enabled })
    ls.set('developerMode', enabled)
  },

  scanLibrary: async () => {
    const el = (window as any).electron
    if (!el) return
    const { libraryFolders, libraryTracks } = get()
    if (libraryFolders.length === 0) return
    set({ libraryScanning: true })
    try {
      // Passing the previous scan's tracks lets the main process skip
      // re-parsing tags for files whose size/mtime haven't changed � makes
      // this cheap enough to run automatically (see libraryAutoRefresh)
      // instead of only on an explicit "Scan Now" click.
      const result = await el.scanLibrary(libraryFolders, libraryTracks)
      if (result.error) { console.error('Scan error:', result.error); return }
      const now = Date.now()
      // Drop cached covers only for files that were added or changed this scan
      // (their on-disk art may now differ); unchanged files keep theirs so a
      // routine auto-refresh doesn't force every visible cover to re-read.
      const prevSig = new Map(libraryTracks.map((t) => [t.id, `${t.fileSize}:${t.lastModified}`]))
      set((s) => {
        const libraryArt = { ...s.libraryArt }
        for (const t of result.tracks as LibraryTrack[]) {
          if (prevSig.get(t.id) !== `${t.fileSize}:${t.lastModified}`) delete libraryArt[t.id]
        }
        return { libraryTracks: result.tracks, libraryArt, libraryLastScanned: now, libraryLoaded: true }
      })
      ls.set('libraryLastScanned', now)
      // The scanner returns metadata only (covers are read on demand), so the
      // track list can be persisted as-is without bloating library.json.
      await el.saveLibraryData({ tracks: result.tracks, folders: libraryFolders, lastScanned: now })
    } catch(e) { console.error('scanLibrary error:', e) }
    finally { set({ libraryScanning: false }) }
  },

  createLocalPlaylist: (name) => {
    const el = (window as any).electron
    const playlist: LocalPlaylist = { id: `lp-${Date.now()}`, name, trackIds: [], createdAt: Date.now() }
    const next = [...get().localPlaylists, playlist]
    set({ localPlaylists: next, activeLocalPlaylistId: playlist.id })
    el?.saveLocalPlaylists(next)
  },
  deleteLocalPlaylist: (id) => {
    const el = (window as any).electron
    const next = get().localPlaylists.filter((p) => p.id !== id)
    const active = get().activeLocalPlaylistId
    set({ localPlaylists: next, activeLocalPlaylistId: active === id ? null : active })
    el?.saveLocalPlaylists(next)
  },
  renameLocalPlaylist: (id, name) => {
    const el = (window as any).electron
    const next = get().localPlaylists.map((p) => p.id === id ? { ...p, name } : p)
    set({ localPlaylists: next })
    el?.saveLocalPlaylists(next)
  },
  updateLocalPlaylist: (id, updates) => {
    const el = (window as any).electron
    const next = get().localPlaylists.map((p) => p.id === id ? { ...p, ...updates } : p)
    set({ localPlaylists: next })
    el?.saveLocalPlaylists(next)
  },
  addToLocalPlaylist: (playlistId, trackId) => {
    const el = (window as any).electron
    const next = get().localPlaylists.map((p) =>
      p.id === playlistId && !p.trackIds.includes(trackId)
        ? { ...p, trackIds: [...p.trackIds, trackId] } : p
    )
    set({ localPlaylists: next })
    el?.saveLocalPlaylists(next)
  },
  removeFromLocalPlaylist: (playlistId, trackId) => {
    const el = (window as any).electron
    const next = get().localPlaylists.map((p) =>
      p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p
    )
    set({ localPlaylists: next })
    el?.saveLocalPlaylists(next)
  },
  reorderLocalPlaylist: (playlistId, trackIds) => {
    const el = (window as any).electron
    const next = get().localPlaylists.map((p) => p.id === playlistId ? { ...p, trackIds } : p)
    set({ localPlaylists: next })
    el?.saveLocalPlaylists(next)
  },
  importM3uEntriesLocal: (name, entries) => commitM3uImport(get, set, { name, entries }),
  exportLocalPlaylistM3u: async (id) => {
    const el = (window as any).electron
    if (!el?.exportM3u) return { ok: false as const, error: 'Not supported' }
    const pl = get().localPlaylists.find((p) => p.id === id)
    if (!pl) return { ok: false as const, error: 'Playlist not found' }
    const byId = new Map(get().libraryTracks.map((t) => [t.id, t]))
    const tracks = pl.trackIds
      .map((tid) => byId.get(tid))
      .filter((t): t is LibraryTrack => !!t)
      .map((t) => ({ path: t.filePath, title: t.title, artist: t.artist, duration: t.duration }))
    const res = await el.exportM3u({ name: pl.name, tracks })
    if (!res || res.canceled) return { ok: false as const, canceled: true }
    if (res.error) return { ok: false as const, error: res.error }
    return { ok: true as const, path: res.path }
  },
  loadLibrary: async (force = false) => {
    const el = (window as any).electron
    if (!el) return
    // Already have the list in memory � skip the disk read + IPC + full re-set.
    // The store is authoritative in-session (scans and local-playlist edits
    // write it directly); only a forced reload after another window changed the
    // data needs to re-read. This is what makes tab revisits instant.
    if (!force && get().libraryLoaded) return
    try {
      const [libData, playlists] = await Promise.all([el.loadLibraryData(), el.loadLocalPlaylists()])
      // Cover art lives in libraryArt (keyed by track id) and is left untouched
      // here, so the loaded covers survive a Library-tab remount without any
      // per-track merge � just swap in the fresh metadata list.
      if (libData?.tracks) set({ libraryTracks: libData.tracks })
      if (playlists) set({ localPlaylists: playlists })
      set({ libraryLoaded: true })
    } catch(e) { console.error('loadLibrary error:', e) }
  },

  // -- Followed playlists (local-only � see FollowedPlaylist) -----------------
  followPlaylist: (meta) => {
    const existing = get().followedPlaylists
    const next = existing.some((f) => f.id === meta.id)
      ? existing.map((f) => f.id === meta.id ? { ...f, ...meta } : f)
      : [...existing, { ...meta, followedAt: Date.now() }]
    set({ followedPlaylists: next })
    ls.set('followedPlaylists', next)
  },
  unfollowPlaylist: (id) => {
    const next = get().followedPlaylists.filter((f) => f.id !== id)
    set({ followedPlaylists: next })
    ls.set('followedPlaylists', next)
  },
  updateFollowedPlaylistMeta: (id, meta) => {
    const existing = get().followedPlaylists
    if (!existing.some((f) => f.id === id)) return
    const next = existing.map((f) => f.id === id ? { ...f, ...meta } : f)
    set({ followedPlaylists: next })
    ls.set('followedPlaylists', next)
  },

  // -- Donor cloud files/playlists (local-only - see DonorPlaylist) -----------
  loadDonorFiles: async () => {
    if (!get().account?.is_donor) return
    try {
      const { files } = await listDonorFiles()
      get().setDonorFiles(files)
    } catch { /* keep whatever was loaded; the UI shows its own load error */ }
  },
  setDonorFiles: (files) => set({ donorFiles: files }),
  createDonorPlaylist: (name, fileIds = []) => {
    const id = `dp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    get()._setDonorPlaylists([...get().donorPlaylists, { id, name, fileIds, createdAt: Date.now() }])
    return id
  },
  deleteDonorPlaylist: (id) => get()._setDonorPlaylists(get().donorPlaylists.filter((p) => p.id !== id)),
  renameDonorPlaylist: (id, name) =>
    get()._setDonorPlaylists(get().donorPlaylists.map((p) => p.id === id ? { ...p, name } : p)),
  addToDonorPlaylist: (playlistId, fileId) =>
    get()._setDonorPlaylists(get().donorPlaylists.map((p) =>
      p.id === playlistId && !p.fileIds.includes(fileId) ? { ...p, fileIds: [...p.fileIds, fileId] } : p)),
  removeFromDonorPlaylist: (playlistId, fileId) =>
    get()._setDonorPlaylists(get().donorPlaylists.map((p) =>
      p.id === playlistId ? { ...p, fileIds: p.fileIds.filter((f) => f !== fileId) } : p)),
  reorderDonorPlaylist: (playlistId, fileIds) =>
    get()._setDonorPlaylists(get().donorPlaylists.map((p) => p.id === playlistId ? { ...p, fileIds } : p)),
  replaceDonorFileId: (oldId, newId) => {
    const lists = get().donorPlaylists
    if (!lists.some((p) => p.fileIds.includes(oldId))) return
    get()._setDonorPlaylists(lists.map((p) => {
      if (!p.fileIds.includes(oldId)) return p
      // Re-uploaded copy (tag edit) keeps its slot; a deleted file just leaves.
      const ids = newId
        ? p.fileIds.map((id) => (id === oldId ? newId : id))
        : p.fileIds.filter((id) => id !== oldId)
      return { ...p, fileIds: ids }
    }))
  },
  _setDonorPlaylists: (next) => {
    set({ donorPlaylists: next })
    ls.set('donorPlaylists', next)
  },

  // -- Offline playlist sync ------------------------------------------------
  loadOfflineLibrary: async () => {
    const el = (window as any).electron
    if (!el) return
    try {
      const lib = await el.offlineGetLibrary()
      set({ offlineTracks: lib.tracks || {}, offlinePlaylists: lib.playlists || {} })
    } catch (e) { console.error('loadOfflineLibrary error:', e) }
  },

  downloadPlaylistOffline: async (key, name, songIds, opts) => {
    const el = (window as any).electron
    if (!el) return
    await enqueueOfflineWork(key, async () => {
      const silent = !!opts?.silent
      // Background resync queued behind other work for a playlist that was
      // removed while it waited � nothing to sync anymore.
      if (silent && !get().offlinePlaylists[key]) return
      // Removal mid-download bumps the epoch; checked between tracks and before
      // the final offlineSetPlaylist so an aborted run can't re-register the
      // playlist it raced with.
      const epoch = _offlineKeyEpochs.get(key) ?? 0
      const cancelled = (): boolean => (_offlineKeyEpochs.get(key) ?? 0) !== epoch
      const downloadId = `playlist-${key}`
      // Songs already saved locally only need a quiet metadata refresh, not a
      // real download � so the visible progress total is the count of songs
      // actually missing, not the whole playlist. Otherwise re-downloading a
      // playlist that's mostly already offline showed "Downloading 1/40, 2/40�"
      // and looked like the whole thing was being fetched again.
      const offlineTracksNow = get().offlineTracks
      const missingCount = songIds.filter((id) => !offlineTracksNow[`jw-${id}`]).length
      const total = missingCount
      // Background resyncs (startup/focus/15-min interval � see syncOfflinePlaylists)
      // re-run this for every already-synced playlist just to pick up metadata
      // changes; nearly everything is a fast no-op `skipped` hit. Surfacing that
      // as "syncing" � in the Download Manager, or in the playlist/context-menu's
      // "Downloading� x/y" label (both read `offlineSync`) � made it look like
      // the same playlist was re-downloading every time the app loaded or
      // regained focus. Only flip on the visible "syncing" state when something
      // is actually fetched (tracked below) or when the caller isn't silent and
      // there's actually something missing to fetch.
      let announced = false
      const announce = (): void => {
        if (announced) return
        announced = true
        set((s) => ({ offlineSync: { ...s.offlineSync, [key]: { state: 'syncing', current: 0, total } } }))
        if (get().downloads.some((d) => d.id === downloadId)) {
          get().updateDownload(downloadId, { filename: name, state: 'downloading', percent: 0, received: 0, total, error: undefined })
        } else {
          get().addDownload({ id: downloadId, filename: name, type: 'playlist', state: 'downloading', percent: 0, received: 0, total })
        }
        // Only pop the Download Manager open for downloads the user just asked
        // for. Background catch-ups (new song added on the site, a previously
        // failed track retrying) still track progress in the downloads list and
        // `offlineSync`, but the panel appearing out of nowhere on focus read
        // as "the app is redownloading my playlists on its own".
        if (!silent) get().setShowDownloadManager(true)
      }
      if (!silent && total > 0) announce()

      // Byte-level size/speed tracking across the whole playlist � cumulativeBytes
      // is bytes already settled (finished or skipped tracks); the per-track
      // listener below adds the in-flight file's partial bytes on top so the
      // Download Manager can show a live running total + throughput, even
      // though we never know the playlist's full size up front.
      let cumulativeBytes = 0
      let lastSampleTime = Date.now()
      let lastSampleBytes = 0

      const trackIds: string[] = []
      let hadError = false
      let doneCount = 0
      for (let i = 0; i < songIds.length; i++) {
        if (cancelled()) break
        const songId = songIds[i]
        const id = `jw-${songId}`
        trackIds.push(id)
        // Already downloaded � skip the network round-trip entirely instead of
        // still fetching /songs/{id}/ + hitting the IPC layer just to no-op.
        // Looping through every already-cached song's metadata refresh made
        // downloading a mostly-synced playlist with a few new songs feel like
        // the whole thing was being fetched again.
        if (offlineTracksNow[id]) continue
        const offProgress = el.onOfflineDownloadProgress?.((d: { id: string; percent: number; received?: number; total?: number }) => {
          if (d.id !== id || !announced) return
          const totalBytes = cumulativeBytes + (d.received || 0)
          const now = Date.now()
          const dt = (now - lastSampleTime) / 1000
          const updates: { bytesReceived: number; speedBps?: number } = { bytesReceived: totalBytes }
          if (dt >= 0.4) {
            updates.speedBps = Math.max(0, (totalBytes - lastSampleBytes) / dt)
            lastSampleTime = now
            lastSampleBytes = totalBytes
          }
          get().updateDownload(downloadId, updates)
        })
        try {
          const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
          const ext = (song.path.split('.').pop() || 'mp3').toLowerCase()
          const meta = {
            title: song.name,
            artist: song.credited_artists || 'Juice WRLD',
            album: song.album || song.era?.name || '',
            imageUrl: buildImageUrl(song.image_url) ?? null,
            lyrics: song.lyrics || null,
            syncedLyrics: song.synced_lyrics || null,
            duration: parseDuration(song.length),
          }
          const result = await el.offlineDownloadTrack({ id, url: buildStreamUrl(song.path), ext, path: song.path, meta })
          if (result?.error) throw new Error(result.error)
          if (!result?.skipped) {
            announce()
            doneCount++
          }
          cumulativeBytes += result?.size || 0
          set((s) => ({
            offlineTracks: {
              ...s.offlineTracks,
              [id]: { ...meta, path: song.path, localPath: result.localPath, ext, downloadedAt: Date.now() },
            },
          }))
        } catch (e) {
          hadError = true
          console.error('offline download failed for song', songId, e)
        } finally {
          offProgress?.()
        }
        if (announced) {
          set((s) => ({ offlineSync: { ...s.offlineSync, [key]: { state: 'syncing', current: doneCount, total } } }))
          get().updateDownload(downloadId, { received: doneCount, percent: total ? Math.round((doneCount / total) * 100) : 100, bytesReceived: cumulativeBytes })
        }
      }
      if (announced) get().updateDownload(downloadId, { speedBps: undefined })

      // The playlist was removed while this run was downloading � registering
      // it now would resurrect it and queue every pruned file for re-download
      // on the next background sync. Drop the run's UI traces and stop.
      if (cancelled()) {
        if (announced) get().removeDownload(downloadId)
        set((s) => {
          const nextSync = { ...s.offlineSync }
          delete nextSync[key]
          return { offlineSync: nextSync }
        })
        get().loadOfflineLibrary()
        return
      }

      try {
        await el.offlineSetPlaylist(key, trackIds, name)
        set((s) => ({ offlinePlaylists: { ...s.offlinePlaylists, [key]: { songIds: trackIds, name, updatedAt: Date.now() } } }))
      } catch (e) { console.error('offlineSetPlaylist error:', e) }

      if (announced) set((s) => ({ offlineSync: { ...s.offlineSync, [key]: { state: hadError ? 'error' : 'done', current: total, total } } }))
      if (announced) get().updateDownload(downloadId, { state: hadError ? 'error' : 'done', percent: 100, error: hadError ? 'Some tracks failed to download' : undefined })
      // Refresh from disk truth � pruning may have dropped tracks shared with
      // another playlist that's no longer synced.
      get().loadOfflineLibrary()
    })
  },

  removePlaylistOffline: async (key) => {
    const el = (window as any).electron
    if (!el) return
    // Cancel any in-flight download for this key (epoch bump) and wait for it
    // to notice � it checks between tracks, so this waits at most one file �
    // before pruning. Otherwise the in-flight run would re-register the
    // playlist after removal and the next sync would re-download all of it.
    _offlineKeyEpochs.set(key, (_offlineKeyEpochs.get(key) ?? 0) + 1)
    await (_offlineKeyQueues.get(key) ?? Promise.resolve()).catch(() => {})
    try { await el.offlineRemovePlaylist(key) } catch (e) { console.error('offlineRemovePlaylist error:', e) }
    set((s) => {
      const next = { ...s.offlinePlaylists }
      delete next[key]
      const nextSync = { ...s.offlineSync }
      delete nextSync[key]
      return { offlinePlaylists: next, offlineSync: nextSync }
    })
    get().loadOfflineLibrary()
  },

  // Serialized on the individual-downloads key: two quick downloads used to
  // both read the membership list before either wrote it, so the second
  // offlineSetPlaylist omitted the first song � and the prune deleted its
  // freshly-downloaded file.
  downloadTrackOffline: async (songId) => {
    const el = (window as any).electron
    if (!el) return
    const key = INDIVIDUAL_DOWNLOADS_KEY
    const id = `jw-${songId}`
    await enqueueOfflineWork(key, async () => {
      try {
        const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
        const ext = (song.path.split('.').pop() || 'mp3').toLowerCase()
        const meta = {
          title: song.name,
          artist: song.credited_artists || 'Juice WRLD',
          album: song.album || song.era?.name || '',
          imageUrl: buildImageUrl(song.image_url) ?? null,
          lyrics: song.lyrics || null,
          syncedLyrics: song.synced_lyrics || null,
          duration: parseDuration(song.length),
        }
        const result = await el.offlineDownloadTrack({ id, url: buildStreamUrl(song.path), ext, path: song.path, meta })
        if (result?.error) throw new Error(result.error)
        set((s) => ({
          offlineTracks: {
            ...s.offlineTracks,
            [id]: { ...meta, path: song.path, localPath: result.localPath, ext, downloadedAt: Date.now() },
          },
        }))
        const existingIds = get().offlinePlaylists[key]?.songIds ?? []
        const nextIds = existingIds.includes(id) ? existingIds : [...existingIds, id]
        await el.offlineSetPlaylist(key, nextIds, 'Downloaded songs')
        set((s) => ({ offlinePlaylists: { ...s.offlinePlaylists, [key]: { songIds: nextIds, name: 'Downloaded songs', updatedAt: Date.now() } } }))
      } catch (e) {
        console.error('downloadTrackOffline error:', e)
      }
    })
  },

  // Deletes a single track's downloaded audio (e.g. from a song's context
  // menu), independent of any playlist it belongs to. If the song is still
  // part of a synced offline playlist, the next background resync will just
  // re-download it � this only clears the local copy, not playlist membership.
  removeOfflineTrack: async (trackId) => {
    const el = (window as any).electron
    if (!el) return
    try { await el.offlineRemoveTrack(trackId) } catch (e) { console.error('offlineRemoveTrack error:', e) }
    set((s) => {
      const next = { ...s.offlineTracks }
      delete next[trackId]
      return { offlineTracks: next }
    })
    // If it was only tracked via the individual-downloads bucket (not a real
    // synced playlist), drop it from there too so it doesn't linger forever.
    const key = INDIVIDUAL_DOWNLOADS_KEY
    const entry = get().offlinePlaylists[key]
    if (entry?.songIds.includes(trackId)) {
      const nextIds = entry.songIds.filter((t) => t !== trackId)
      try { await el.offlineSetPlaylist(key, nextIds, entry.name) } catch (e) { console.error('offlineSetPlaylist error:', e) }
      set((s) => ({ offlinePlaylists: { ...s.offlinePlaylists, [key]: { ...entry, songIds: nextIds, updatedAt: Date.now() } } }))
    }
  },

  syncOfflinePlaylists: async () => {
    // Startup, every window focus, and the 15-min interval all call this;
    // without the guard they overlap, and each run re-downloads the songs the
    // other is mid-flight on (two writers to the same file, plus a second
    // round of "downloading" announcements for work already underway).
    if (_offlineSyncInFlight) return
    _offlineSyncInFlight = true
    try {
      const keys = Object.keys(get().offlinePlaylists)
      for (const key of keys) {
        const match = key.match(/^api-(\d+)$/)
        if (!match) continue
        // Removed from offline while this sync was walking earlier keys �
        // syncing it anyway would re-download and re-register it.
        if (!get().offlinePlaylists[key]) continue
        try {
          const detail = await userApi.getPlaylist(Number(match[1]))
          if (!get().offlinePlaylists[key]) continue
          await get().downloadPlaylistOffline(key, detail.name, detail.items.map((i) => i.song.id), { silent: true })
        } catch {
          // Offline, deleted, or no longer accessible � keep the existing cache as-is.
        }
      }
    } finally {
      _offlineSyncInFlight = false
    }
  },

  // Called after songs are added to an API playlist � if that playlist is
  // synced offline, immediately downloads the newly-added songs instead of
  // waiting for the next background resync (startup/focus/15-min interval).
  autoDownloadIfOffline: async (playlistId, addedSongIds) => {
    if (!addedSongIds.length) return
    const key = `api-${playlistId}`
    if (!get().offlinePlaylists[key]) return
    // Wait out any in-flight download for this key before building the merged
    // list � merging from a snapshot taken mid-sync saved a stale membership
    // list, and the prune then deleted files for songs the sync had just added.
    await (_offlineKeyQueues.get(key) ?? Promise.resolve()).catch(() => {})
    const entry = get().offlinePlaylists[key]
    if (!entry) return
    const existingIds = new Set(entry.songIds.map((id) => Number(id.replace('jw-', ''))))
    const nextSongIds = [...existingIds, ...addedSongIds.filter((id) => !existingIds.has(id))]
    await get().downloadPlaylistOffline(key, entry.name, nextSongIds)
  },

  // -- Downloads -------------------------------------------------------------
  downloads: [],
  showDownloadManager: false,
  updateStatus: null,

  addDownload: (item) => set((s) => ({ downloads: [item, ...s.downloads] })),
  updateDownload: (id, updates) => set((s) => ({
    downloads: s.downloads.map((d) => d.id === id ? { ...d, ...updates } : d),
  })),
  removeDownload: (id) => set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) })),
  clearCompletedDownloads: () => set((s) => ({
    downloads: s.downloads.filter((d) => d.state === 'downloading'),
  })),
  setShowDownloadManager: (show) => set({ showDownloadManager: show }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),

  stagedFileChanges: [],
  // One queued change per path: dragging an already-queued file somewhere else
  // is a correction, not a second move, and proposing both would ask reviewers
  // to send the same file to two places.
  stageFileChanges: (changes) => set((s) => ({
    stagedFileChanges: [
      ...s.stagedFileChanges.filter((c) => !changes.some((n) => n.path === c.path && n.channel === c.channel)),
      ...changes.map((c, i) => ({ ...c, id: `staged-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}` })),
    ],
  })),
  updateStagedFileChange: (id, updates) => set((s) => ({
    stagedFileChanges: s.stagedFileChanges.map((c) => c.id === id ? { ...c, ...updates } : c),
  })),
  unstageFileChange: (id) => set((s) => ({
    stagedFileChanges: s.stagedFileChanges.filter((c) => c.id !== id),
  })),
  clearStagedFileChanges: () => set({ stagedFileChanges: [] }),
}))

// Dev-only console handle for driving store state while debugging (e.g.
// forcing auth-gated views to render without an account). Never set in
// production builds.
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__store = useStore
}

// Subscribe to a shallow-compared subset of the store. A bare `useStore()`
// re-renders the component on EVERY store write � including the ~4x/sec
// timeupdate ticks and per-chunk download progress � so components must pick
// only the keys they actually read. Actions are stable references, so
// including them here never causes a re-render on its own.
export function useStorePick<K extends keyof AppStore>(...keys: K[]): Pick<AppStore, K> {
  return useStore(
    useShallow((s: AppStore) => {
      const picked = {} as Pick<AppStore, K>
      for (const k of keys) picked[k] = s[k]
      return picked
    }),
  )
}
