import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { ViewType, Track, FullTrack, LibraryTrack, LocalPlaylist, GuestPlaylist, FollowedPlaylist } from '../types'
import { APP_VERSION } from '../lib/appVersion'
import { ls } from '../lib/persist'
import * as userApi from '../lib/userApi'
import type { AccountUser, PlaylistSummary, UserSettings } from '../lib/userApi'
import type { GifResult } from '../lib/gifApi'
import * as preferencesApi from '../lib/preferencesApi'
import * as profilePushApi from '../lib/profilePushApi'
import { apiFetch, apiPeek, buildStreamUrl, buildImageUrl, parseDuration, resolvePrefCoverUrl, fetchChannels } from '../lib/juicewrldApi'
import type { JWApiSong, JWApiChannel } from '../lib/juicewrldApi'
import {
  emptySongPref, isEmptySongPref, normalizePrefText, setSongPrefsCache, normalizeSongPref,
} from '../lib/songPrefs'
import type { SongPreference, SongPrefMap, SongPrefPatch, WireSongPreference } from '../lib/songPrefs'
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
import { ADMIN_TAB_PATHS } from '../hooks/useAdminQueue'
import type { AdminTab } from '../hooks/useAdminQueue'
import { newFolderId, normalizeFolderName, pruneFolders } from '../lib/playlistFolders'
import type { PlaylistFolder, ServerPlaylistFolder } from '../lib/playlistFolders'
import { createQueueSlice, QueueSlice } from './queueSlice'
import { getSkin, setCustomSkinsCache, type Skin, type SkinId } from '../lib/skins'
import { getFont } from '../lib/fonts'
import { EQ_BANDS, EQ_PRESETS, FLAT_GAINS } from '../lib/audioEffects'
import type { CommunityEdit } from '../lib/audioEffects'
import { HOTKEY_ACTIONS, effectiveBinding, effectiveGlobalBinding, defaultGlobalBinding } from '../lib/hotkeys'
import { DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY, DEFAULT_NAV_CONTROL_ORDER, DEFAULT_NAV_CONTROL_VISIBILITY } from '../lib/navItems'
import { DEFAULT_HOME_SECTION_VISIBILITY } from '../lib/homeSections'
import { getLastfmSession } from '../lib/lastfm'
import { useSandboxStore } from '../components/Modal'
import { runWhenIdle } from '../lib/platform'

// Lightweight localStorage persistence helper - see lib/persist.ts (it lives
// there so queueSlice can share it without importing this module back).

// ─── Upload item (in-session) ────────────────────────────────

export interface UploadItem {
  id: string
  filename: string
  // Comp file proposal uploads (see lib/compUploads) - the only kind of
  // transfer in the Uploads panel.
  type: 'upload'
  state: 'downloading' | 'done' | 'error' | 'cancelled'
  percent: number
  received?: number
  total?: number
  error?: string
  // Byte-level size/throughput info, shown alongside the percent progress
  // above - `bytesReceived` is cumulative bytes sent so far, `speedBps` is a
  // live bytes/sec sample (undefined between samples/when idle).
  bytesReceived?: number
  speedBps?: number
}

// ─── Staged comp file change (in-session) ────────────────────
//
// Drag-and-drop in the Files tab doesn't propose anything on drop - it parks
// the intended change here, the Uploads panel lists what's queued, and one
// "Propose" there submits the lot (see lib/compStagedChanges). Dragging is
// cheap to do by accident, and a reorganize is usually several drags that
// only make sense together, so proposing each one the instant it lands would
// spam reviewers with half a move.
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

// ─── Staged song edit proposal (in-session) ──────────────────
//
// Same idea as StagedFileChange, applied to the Tracker's song editor, bulk
// editor and "propose new song" modal: editing a song's metadata, proposing
// its deletion, or proposing a brand new song doesn't submit anything on its
// own - it parks the proposal here, the Uploads panel lists what's queued,
// and one "Propose" there sends the lot (see lib/compStagedSongChanges).
// Editing an *already-submitted* pending proposal (editingPropId set in
// EditorPage) is a different action - that proposal already exists
// server-side, so it's still updated immediately.
export interface StagedSongChange {
  id: string
  /** Null for a 'create' change - a new song has no id yet. */
  songId: number | null
  changeType: 'update' | 'delete' | 'create'
  /** Song title, for the queue row - not sent as part of proposed_data. */
  title: string
  proposedData: Record<string, unknown>
  editorNotes: string
  /** Channel slug the proposal belongs to. Absent lets the server pick a
   *  default (the AddSongModal can be opened without one). */
  channel?: string
  /** Set when a propose attempt failed, so the row can show why and stay
   *  queued for a retry. Cleared on the next attempt. */
  error?: string
}

// Where the desktop nav menu sits - classic left sidebar, mirrored right, or a
// horizontal bar above/below the content. Mobile always uses the bottom tab bar.
export type SidebarPosition = 'left' | 'right' | 'top' | 'bottom'

// The Settings dialog's tabs - the union Settings.tsx keys its content off, and
// the target for a deep-link open (see settingsTab). Keep in sync with the
// `tab` state there.
export type SettingsTab = 'account' | 'appearance' | 'playback' | 'shortcuts' | 'app' | 'developer' | 'feedback' | 'about'

// ─── Non-queue state ──────────────────────────────────────────────────────────

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
  // -1 = full left … 1 = full right
  eqBalance: number
  eqMono: boolean
  // 1 = 100% (unity, off) .. EQ_BOOST_MAX = 200%.
  eqBoost: number
  skipSilence: boolean
  // Reverb (convolution tail; see lib/audioEffects.ts) - independently
  // toggleable; mix/decay keep their values while off.
  reverbEnabled: boolean
  reverbMix: number
  reverbDecay: number
  // Let the pitch follow the rate (preservesPitch off) - slowed feel below
  // 1x, sped-up/nightcore feel above. Combine with reverb for slowed+reverb.
  pitchShift: boolean
  // A-B loop: repeat a marked portion of the current track. Both null = no
  // loop. Deliberately NOT persisted to localStorage (a saved position only
  // makes sense for the track it was set on) - cleared on every track change
  // (see Player's currentTrack?.id effect) but still mirrored over
  // window-sync so the pop-out equalizer's controls reach the playing audio.
  abLoopStart: number | null
  abLoopEnd: number | null
  // Community-shared effect configs, shown next to the EQ presets. Stays
  // empty until the API endpoints for them exist - a future fetch populates
  // it; nothing is persisted locally.
  communityEdits: CommunityEdit[]
  // Seconds added to the lookup time when matching synced (LRC) lyric lines -
  // positive shifts lyrics later (delays them), negative shifts them earlier,
  // compensating for lyric files that aren't quite in step with the audio.
  lyricsOffset: number

  // UI
  activeView: ViewType
  // The view that was active immediately before the current one - lets a page
  // like the editor send its back button/redirects to wherever the user
  // actually came from instead of a hardcoded destination.
  previousView: ViewType | null
  // Which section the standalone admin console (activeView === 'admin')
  // should land on - drives that page's own deep-link URLs (/users,
  // /security, etc., see ADMIN_TAB_PATHS) the same way settingsTab drives
  // Settings' single URL. Read on mount/back-forward, written whenever the
  // admin console's own section changes so the address bar stays in sync;
  // untouched by the embedded admin panel inside the editor/manager profile,
  // which has no URL of its own to keep in sync.
  activeAdminTab: AdminTab | null
  showNowPlaying: boolean
  // Which Settings tab to show on next open (deep-link from the app menu, e.g.
  // "Keyboard shortcuts" → the Shortcuts tab). Settings applies it then clears
  // it back to null. Synced so it also reaches the pop-out Settings window.
  settingsTab: SettingsTab | null
  showDiagnostics: boolean
  showQueue: boolean
  // The bottom nav's overflow sheet - its trigger button lives on Home now,
  // not in the nav bar itself, so the open/close state has to live somewhere
  // both can reach.
  showMoreNav: boolean
  // Equalizer popover visibility. Store-level (not Player-local) so the WRLD
  // tab's button and the 'equalizer' hotkey can open it from anywhere - the
  // always-mounted Player owns the actual portal.
  showEqPanel: boolean
  // Song whose info modal is shown by the main window's global host (App's
  // <GlobalSongInfoHost>). Only used to "attach" a floating song-info window
  // back into the main window - the per-view list modals keep their own local
  // state. null = nothing shown.
  infoSongId: number | null
  // Desktop bottom player collapsed to a slim strip to reclaim vertical space.
  playerCollapsed: boolean
  // True while the WRLD tab's own in-page fullscreen (album-art focus mode)
  // is active - lets App.tsx hide the frameless-window title bar controls,
  // which would otherwise float over the immersive view.
  wrldFullscreen: boolean
  // Lets a view's sub-state paint a hero image full-bleed behind the app bar
  // and up under the status bar, instead of sitting on the shell's flat
  // reserved inset strip. The view that raises it MUST clear it on the way
  // out, or the shell stays bled after navigating elsewhere.
  heroBleedTop: boolean
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
  // getSkin() resolves them everywhere.
  customSkins: Skin[]
  sidebarPosition: SidebarPosition
  // User-defined order of the primary side-menu nav items, by view id. Only
  // ever a permutation of the known ids - orderedNavItems() sanitizes it on
  // read, so a stale/partial saved order can't drop or duplicate a tab.
  navOrder: ViewType[]
  // Per-item side-menu visibility (view id → shown). Sparse overrides merged
  // onto DEFAULT_NAV_VISIBILITY; isNavItemVisible() falls back to each item's
  // own default for anything absent, so lets the user hide built-ins and add
  // the off-by-default extras.
  navVisibility: Record<string, boolean>
  // Order + visibility for the foot-of-menu controls (Profile, Log out,
  // Diagnostics, Download, Settings) - same model as navOrder/navVisibility.
  navControlOrder: string[]
  navControlVisibility: Record<string, boolean>
  // Per-section visibility on the mobile Home dashboard (section id → shown).
  // Sparse overrides merged onto DEFAULT_HOME_SECTION_VISIBILITY, same model
  // as navVisibility.
  homeSectionVisibility: Record<string, boolean>

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
  // Font-stack ids from lib/fonts.ts - appFont styles the whole UI,
  // lyricsFont only the lyric panels (so lyrics can differ from the chrome).
  appFont: string
  lyricsFont: string
  lyricsScale: number
  lyricsAlign: 'left' | 'center'
  // Soften every synced line except the one currently playing with a slight
  // blur (on by default) - played and upcoming lines alike.
  lyricsBlur: boolean
  // Manual override of the auto show/hide behavior - Shift+L flips it. XORed
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
  // Custom colors for synced lyric lines - the line currently being sung, and
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
  // (toggle groups, search bars, badges, menus) - split out as its own toggle
  // since those boxes are everywhere, and someone who likes the shell/sidebar/
  // player gradients may not want every small pill tinted too.
  surfaceGradientsEnabled: boolean
  // WRLD tab only. Off (the default) it paints itself from the playing song's
  // cover - blurred art behind, text color picked from the art's brightness.
  // On, it drops both and uses the app's own skin instead: theme surface
  // behind, theme text colors on top, so the tab stops recoloring itself every
  // track.
  wrldThemeBackground: boolean
  // Playlist detail header's full-bleed blurred-cover backdrop (Apple Music
  // style). Off falls back to a plain flat surface header. Tracked
  // separately per skin darkness (not one flag) - the backdrop was designed
  // dark-first and defaults off on a light skin, on for a dark one, and a
  // choice made while on, say, a dark skin shouldn't silently carry over and
  // turn it on the next time a light skin is active. setPlaylistHeroEnabled
  // writes whichever of these matches the *current* skin; components read
  // the matching one via isDarkSkin rather than a combined getter, since they
  // already need isDarkSkin themselves to pair the hero's text colors.
  playlistHeroEnabledDark: boolean
  playlistHeroEnabledLight: boolean
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
  // rotated suggestion, are unaffected - see applyPrefToTrack's precedence.
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

  // Keyboard shortcuts. `hotkeyBindings` holds only user *overrides* of the
  // defaults in lib/hotkeys.ts (actionId → combo; an explicit '' means the
  // user cleared that shortcut). `hotkeySeekSeconds` is the jump size for the
  // skip-forward / skip-backward shortcuts.
  hotkeyBindings: Record<string, string>
  hotkeySeekSeconds: number
  // When on (desktop only), the global bindings below are also registered
  // OS-wide so they work while the app is in the background.
  globalHotkeysEnabled: boolean
  // The OS-global binding per action, independent of `hotkeyBindings` (the
  // in-app one) - actionId → combo override, same shape and semantics as
  // hotkeyBindings (an explicit '' means the user cleared it). See
  // lib/hotkeys effectiveGlobalBinding / defaultGlobalBinding.
  globalHotkeyBindings: Record<string, string>

  // Liked songs
  likedTrackIds: string[]

  // Account ids of users whose chat messages are hidden from this account.
  // Local-first like likedTrackIds, synced to the server's `user_settings`
  // blob (see lib/userApi's UserSettings) on login and on every change.
  mutedUserIds: number[]
  // Mirror of chatStore's mutedServers/mutedConversations (that store owns
  // them; this is just a copy so buildUserSettings can include them in the
  // synced `user_settings` push - see _syncChatMutes).
  chatMutedServers: number[]
  chatMutedConversations: number[]

  // GIFs favorited from the chat GIF picker. Local-first like likedTrackIds,
  // synced to the server's `user_settings` blob (favorite_gifs) so favorites
  // follow the account across devices.
  favoriteGifs: GifResult[]

  // Per-song user overrides (custom name, custom cover, preferred version,
  // playcount), keyed by numeric API song id. Local-first like likedTrackIds:
  // usable logged out, merged up to the server on login. Every write goes
  // through _setSongPrefs so the lib/songPrefs cache - which songToTrack reads
  // and which can't import this store without a cycle - stays in step.
  songPrefs: SongPrefMap

  // Timestamped play history - one row per credited play (see
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
  // Whether ErrorBoundary auto-submits a crash report the moment it catches
  // an error, through the same feedback pipeline (submitFeedback) the manual
  // "Report this error" button uses. On by default; Settings can turn it off
  // for anyone who'd rather report manually (or not at all).
  autoReportErrors: boolean

  // Playlist folders - a local-first grouping over both synced and local
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

  // Sidebar → PlaylistsView: open a specific playlist without needing a URL
  // round-trip (works whether PlaylistsView is already mounted or not).
  pendingPlaylistId: number | null

  // Which playlist (API-backed or local) PlaylistsView currently has open -
  // lives here rather than as local component state because App.tsx unmounts
  // PlaylistsView whenever you switch to another tab, which would otherwise
  // silently drop back to the playlist list every time you navigate away and
  // back. Cleared by the "playlists:back" event (tapping the tab again).
  playlistsSelectedId: number | null
  playlistsSelectedLocalId: string | null

  // The open playlist's track sort - same "lives in the store, not local
  // state" reasoning as playlistsSelectedId above: without this, tabbing
  // away from Playlists and back would silently drop the sort back to
  // playlist order every time, since the component remounts from scratch.
  playlistsSort: { field: string; dir: 'asc' | 'desc' }

  // Which folder (if any) is "open" in the library grid, showing just its
  // member playlists - same reasoning as playlistsSelectedId: without this,
  // tabbing away and back would silently kick you back out to the top-level
  // grid instead of leaving you inside the folder you were looking at.
  playlistsOpenFolderId: string | null

  // A comp proposal started from the Files page's context menu - the
   // contributor page reads it once on mount and clears it, the same
   // hand-off pendingEditorSongId does for the song editor.
  pendingCompProposal: { paths: string[]; changeType: 'delete' | 'replace' | 'upload' } | null

  // Editor
  pendingEditorSongId: number | null
  pendingEditProposal: { id: number; songId: number | null; proposedData: Record<string, unknown>; editorNotes: string } | null
  // What the bulk editor dialog has open (null = closed) - a Tracker
  // multi-selection of API songs, which submits one edit proposal per song.
  // Holds the full objects the caller already had rather than ids, so the
  // dialog can show "same across all"/"mixed" per field without re-fetching.
  // See BulkEditModal.
  bulkEdit: { kind: 'api'; songs: JWApiSong[] } | null


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
  // reload (another window changed the data) - see loadLibrary.
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

  // Playlists for signed-out users - see GuestPlaylist. Persisted to
  // localStorage, so unlike localPlaylists these aren't tied to scanned
  // library tracks and work identically on every platform.
  guestPlaylists: GuestPlaylist[]

  // Other people's playlists followed from a share link - see FollowedPlaylist.
  // Local-only (localStorage), so this list is per-device.
  followedPlaylists: FollowedPlaylist[]

  // Uploads (comp upload progress - see lib/compUploads)
  uploads: UploadItem[]
  showUploadManager: boolean
  // Comp file changes staged by Files drag-and-drop, proposed as a batch from
  // the Uploads panel (see lib/compStagedChanges).
  stagedFileChanges: StagedFileChange[]
  // Song edit/delete proposals staged by the Tracker's editors, proposed as a
  // batch from the Uploads panel (see lib/compStagedSongChanges).
  stagedSongChanges: StagedSongChange[]
}

interface AppActions {
  setCurrentTrackFull: (full: FullTrack | null | ((prev: FullTrack | null) => FullTrack | null)) => void
  setVolume: (vol: number) => void
  setPlaybackSpeed: (speed: number) => void
  setLyricsOffset: (offset: number) => void
  setEqEnabled: (enabled: boolean) => void
  // Single-band slider move - flips eqPreset to 'custom'.
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
   *  position: unset → point A set → looping (A and B set) → unset again.
   *  Mirrors the classic single-button "A-B repeat" control. */
  setAbLoopPoint: () => void
  clearAbLoop: () => void
  playCommunityEdit: (edit: CommunityEdit) => void

  setActiveView: (view: ViewType) => void
  /** Sets which section the standalone admin console should show, and - when
   *  it's the active view - updates the address bar to that section's own
   *  deep-link path (via replaceState, not pushState: switching sections
   *  inside the console isn't a new place to land on back-button, same as
   *  switching Settings tabs isn't). No-op on the URL when the embedded
   *  admin panel (inside the editor/manager profile) is what changed tabs. */
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
  // For the settings launcher icon: closes it if already open instead of
  // just re-opening. setShowSettings(true) stays "always open" for callers
  // that never want to close it (the open-settings hotkey, empty-state CTAs).
  toggleSettings: () => void
  /** Single entry point for every "go to my profile" control (sidebar row,
   *  bottom nav tab, the player's profile hotkey). */
  openProfile: () => void
  /** Navigates to the signed-in account's own public profile (/u/<id>) -
   *  used by the Home hero avatar. Editor/staff access lives on its own
   *  button on Home now (openProfile), not behind the avatar. */
  openOwnPublicProfile: () => void
  /** Navigates to any user's public profile (/u/<id>) - used by avatar/name
   *  clicks in chat messages and member lists. */
  openPublicProfile: (userId: number) => void
  setShowDiagnostics: (show: boolean) => void
  setShowQueue: (show: boolean) => void
  setShowMoreNav: (show: boolean) => void
  setShowEqPanel: (show: boolean) => void
  toggleEqPanel: () => void
  setInfoSongId: (id: number | null) => void
  setPlayerCollapsed: (collapsed: boolean) => void
  setWrldFullscreen: (fullscreen: boolean) => void
  setHeroBleedTop: (heroBleedTop: boolean) => void
  setTheme: (theme: SkinId) => void
  /** Creates or updates a custom skin (upsert by id). Since editing the active
   *  skin's palette re-runs the theme effect, the editor uses this for live
   *  preview - every color change saves through here. */
  saveCustomSkin: (skin: Skin) => void
  /** Removes a custom skin; if it was the active theme, falls back to dark. */
  deleteCustomSkin: (id: string) => void
  setSidebarPosition: (position: SidebarPosition) => void
  setNavOrder: (order: ViewType[]) => void
  setNavItemVisible: (view: ViewType, visible: boolean) => void
  setNavControlOrder: (order: string[]) => void
  setNavControlVisible: (id: string, visible: boolean) => void
  setHomeSectionVisible: (id: string, visible: boolean) => void

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
  // Writes to playlistHeroEnabledDark or ...Light, whichever matches the
  // skin active right now.
  setPlaylistHeroEnabled: (enabled: boolean) => void
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
  // Bind (or, with combo === '', clear) a shortcut. Passing a combo already in
  // use elsewhere transfers it - the previous owner is cleared - so bindings
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
  /** Preferred version *label* within this song's version group (e.g. "v1") -
   *  playing any member of the group then plays this one. Null clears it. */
  setSongDefaultVersion: (songId: number, version: string | null) => void
  /** Replaces a song's own excluded-versions list outright - callers (the
   *  Change-version menu) work out which row(s) to patch themselves, the same
   *  way they already do for default_version, since an excluded label can
   *  live on a different member's row than the one being toggled from. */
  setSongExcludedVersions: (songId: number, versions: string[]) => void
  /** Drops every override for a song, playcount included. */
  clearSongPref: (songId: number) => void
  /** Credits one play. Called by the Player once a track passes the listened
   *  threshold - not on every start. */
  bumpSongPlaycount: (songId: number) => void
  /** Mutes/unmutes a chat user's messages for this account, persisting the
   *  change locally and (if signed in) to the server's `user_settings` blob. */
  muteUser: (userId: number) => void
  unmuteUser: (userId: number) => void
  toggleMuteUser: (userId: number) => void
  /** Favorites/unfavorites a GIF from the chat GIF picker, persisting the
   *  change locally and (if signed in) to the server's `user_settings` blob. */
  toggleFavoriteGif: (gif: GifResult) => void
  /** Merges the profile's `user_settings` blob (from getMe) with local state -
   *  muted users union, everything else adopts the server's value if it has
   *  one (a field the server has never seen keeps the local value instead of
   *  resetting to a default) - then pushes the merged result back up. Runs
   *  on login. */
  syncUserSettings: (serverSettings?: UserSettings) => Promise<void>
  /** Mirrors chatStore's mutedServers/mutedConversations (per-account, local
   *  in chatStore) into this store so buildUserSettings can include them in
   *  the synced blob, and schedules the push. Called from chatStore, which
   *  already imports useStore (this store can't import chatStore back
   *  without a cycle). */
  _syncChatMutes: (mutedServers: number[], mutedConversations: number[]) => void
  /** Merges the profile's `user_preferences` blob (from getMe) with local
   *  state - profile wins per song except playcount, which takes the max -
   *  then pushes the merged array back up. Runs on login. */
  syncSongPrefs: (serverPrefs?: WireSongPreference[]) => Promise<void>
  /** Same shape as syncSongPrefs, but a union rather than a per-key merge -
   *  play events are immutable, so the two sides just get deduped. */
  syncListeningPlays: (serverPlays?: ListeningPlayEvent[]) => Promise<void>
  /** Internal - the single write path for songPrefs (state + localStorage +
   *  lib/songPrefs' cache). */
  _setSongPrefs: (next: SongPrefMap) => void
  /** Internal - the single write path for listeningPlays (state + localStorage). */
  _setListeningPlays: (next: ListeningPlayEvent[]) => void
  /** Internal - patches one song's row and syncs it to the server. */
  _writeSongPref: (songId: number, patch: SongPrefPatch) => void
  /** Internal - pushes a row's name/cover onto Tracks already in the queue. */
  _reapplySongPref: (songId: number) => void

  /** Opens the report dialog for general feedback or a specific song. */
  openReport: (target: ReportTarget) => void
  closeReport: () => void
  setAutoReportErrors: (enabled: boolean) => void
  /** Queues a general feedback report and tries to deliver it. `contact` is
   *  the optional reach-me field the endpoint accepts. `automated` flags a
   *  crash report ErrorBoundary sent on its own rather than one the user
   *  actually wrote (the API's `automated` field). Resolves once that
   *  delivery attempt settles: `true` if it actually reached the server this
   *  round, `false` if it's still sitting in the outbox (offline, rejected,
   *  or the API is disabled) - the caller can surface which happened. */
  submitFeedback: (category: FeedbackCategory, message: string, contact?: string, automated?: boolean) => Promise<boolean>
  /** Queues a song issue report (wrong/missing info or lyrics) and tries to
   *  deliver it. `issues` is the set of checked problem types. Same delivered
   *  vs. still-queued resolution as `submitFeedback`. */
  reportSong: (songId: number, songName: string, issues: SongIssueType[], message: string, contact?: string) => Promise<boolean>
  /** Drops a queued report from the outbox (e.g. one stuck failing). */
  dismissReport: (id: string) => void
  /** Internal - appends a report to the outbox, kicks off delivery, and
   *  resolves to whether this particular report was delivered this round. */
  _enqueueReport: (report: PendingReport) => Promise<boolean>
  /** Internal - attempts to deliver every deliverable queued report. */
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
   *  state - the profile is the source of truth for synced membership, and
   *  device-local members re-attach by folder id - then pushes the merge back
   *  up. Runs on login. */
  syncFolders: (serverFolders?: ServerPlaylistFolder[]) => Promise<void>
  /** Internal - the single write path for playlistFolders. */
  _setFolders: (next: PlaylistFolder[]) => void
  /** Internal - marks the given profile-blob field(s) dirty and (re)schedules
   *  the single shared debounced PATCH that pushes all dirty fields together
   *  in one request, whole-array, rather than one PATCH per field. */
  _scheduleProfilePush: (fields: ('songPrefs' | 'listeningPlays' | 'folders' | 'userSettings')[]) => void

  setApiTrackerCategory: (cat: string) => void
  setApiTrackerEra: (era: string) => void
  setApiTrackerTab: (tab: string) => void
  setApiFilesPath: (path: string) => void
  setApiFilesLastPath: (path: string) => void

  setShowUserAuth: (show: boolean) => void
  loadAccount: () => Promise<void>
  loginWithDiscord: () => Promise<void>
  completeDiscordLogin: (code: string, state: string) => Promise<void>
  signupWithPassword: (username: string, password: string, displayName?: string) => Promise<void>
  loginWithPassword: (username: string, password: string) => Promise<void>
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
  openSongEditor: (songId: number) => void
  setPendingEditProposal: (p: { id: number; songId: number | null; proposedData: Record<string, unknown>; editorNotes: string } | null) => void
  // "Edit" on a multi-song selection - opens the bulk editor dialog, which
  // submits one update proposal per song.
  openBulkEditor: (songs: JWApiSong[]) => void
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

  // Guest playlists (see GuestPlaylist) - createGuestPlaylist returns the new
  // playlist's id so the caller can navigate straight to it.
  createGuestPlaylist: (name: string) => string
  deleteGuestPlaylist: (id: string) => void
  renameGuestPlaylist: (id: string, name: string) => void
  addToGuestPlaylist: (playlistId: string, track: Track) => void
  removeFromGuestPlaylist: (playlistId: string, trackId: string) => void
  reorderGuestPlaylist: (playlistId: string, tracks: Track[]) => void
  // Import an .m3u/.m3u8 into a new local playlist, matching its file paths to
  // scanned library tracks. Resolves a summary (matched/total + names of the
  // paths that weren't in the library) so the UI can report skips.
  // Commit already-parsed .m3u entries to a new local playlist, matching their
  // file paths to the scanned library. The file is opened/parsed in the UI
  // first so the user can choose local-vs-API import before anything is created.
  importM3uEntriesLocal: (name: string, entries: { path: string; title: string | null; duration?: number | null }[]) => { ok: true; playlistId: string; name: string; matched: number; total: number; unmatched: string[] } | { ok: false; canceled?: boolean; error?: string }
  exportLocalPlaylistM3u: (id: string) => Promise<{ ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }>
  loadLibrary: (force?: boolean) => Promise<void>

  // Follow/unfollow someone else's playlist (see FollowedPlaylist) - a local
  // pointer, not a copy. followPlaylist is idempotent (following twice just
  // refreshes the cached display fields). updateFollowedPlaylistMeta patches
  // the cached name/trackCount/coverUrl after a live re-fetch; no-op if the
  // id isn't followed.
  followPlaylist: (meta: { id: number; name: string; trackCount: number; coverUrl: string | null }) => void
  unfollowPlaylist: (id: number) => void
  updateFollowedPlaylistMeta: (id: number, meta: { name: string; trackCount: number; coverUrl: string | null }) => void

  addUpload: (item: UploadItem) => void
  updateUpload: (id: string, updates: Partial<UploadItem>) => void
  removeUpload: (id: string) => void
  clearCompletedUploads: () => void
  setShowUploadManager: (show: boolean) => void

  /** Queues drag-and-drop file changes; ids are assigned here. Returns nothing
   *  - the Uploads panel is where they're reviewed and proposed. */
  stageFileChanges: (changes: Omit<StagedFileChange, 'id'>[]) => void
  updateStagedFileChange: (id: string, updates: Partial<StagedFileChange>) => void
  unstageFileChange: (id: string) => void
  clearStagedFileChanges: () => void

  /** Queues a song edit/delete proposal; ids are assigned here. Replaces any
   *  queued change of the same type already staged for that song/channel, so
   *  editing a song again before proposing it just updates the queued patch
   *  rather than piling up duplicates. */
  stageSongChanges: (changes: Omit<StagedSongChange, 'id'>[]) => void
  updateStagedSongChange: (id: string, updates: Partial<StagedSongChange>) => void
  unstageSongChange: (id: string) => void
  clearStagedSongChanges: () => void
}

export type AppStore = QueueSlice & AppState & AppActions

// ─── Store ────────────────────────────────────────────────────────────────────

// Dedup flag: prevents concurrent /playlists/ fetches
let _playlistsInFlight = false
// Dedup flag: prevents the startup detail/cover prefetch from running twice
// (e.g. loadAccount racing with a later refreshPlaylists on the same session)
let _detailsPrefetchInFlight = false
// Dedup flag: same idea for the Tracker/Files offline-cache warm-up
let _apiPrefetchInFlight = false
// Shares one loadAccount() run across overlapping callers instead of each
// re-running the whole sync (and its handful of PATCH /me/ pushes) from
// scratch - App.tsx alone calls loadAccount() from two separate mount
// effects, and React 18 StrictMode double-invokes both in dev, so without
// this a cold load could fire the sync 3-4x and turn 3 PATCH /me/ requests
// into 9-12.
let _loadAccountInFlight: Promise<void> | null = null

// Pending cover-art results awaiting a batched flush (see applyLibraryArt).
// Covers arrive in bursts - one per visible row - and applying each through
// its own set() meant a full libraryTracks copy and list re-render per cover.
let _pendingArt: Map<string, string | null> | null = null

// ─── Song preferences helpers ─────────────────────────────────────────────────

/** Merges `patch` into one song's row, dropping the row once nothing is left
 *  on it. Pure - callers persist the result through _setSongPrefs. */
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
  // override (unreleased songs only - track.genre holds the API category for
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
 *  before any song → Track conversion can happen, so overrides survive a
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
 *  before the store's `theme` initializer resolves the active id via getSkin -
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

// ─── Report outbox helpers ────────────────────────────────────────────────────

// Guards _flushReports against overlapping runs (boot + login + a fresh submit
// can all fire it close together) - without this, the same queued report could
// be POSTed twice before the first response removed it.
let _reportsFlushing = false

// ─── Profile-blob push debounce ───────────────────────────────────────────────

// Preferences, listening plays, folders, and settings each live as one JSON
// field on /account/me/, PATCHed whole. A single shared timer/dirty-set
// collapses a burst of edits across ANY of the four fields (typing a
// rename, a run of playcount bumps, a song skip that touches both prefs and
// listening plays) into one combined PATCH instead of one request per field.
// Failures are swallowed: state is local-first, and the next push - or the
// next login's merge - re-sends everything anyway.
const PROFILE_PUSH_DEBOUNCE_MS = 1500
let _profilePushTimer: ReturnType<typeof setTimeout> | null = null
let _profilePushDirty = { songPrefs: false, listeningPlays: false, folders: false, userSettings: false }

// Assembles the *entire* `user_settings` object from current state - every
// push has to carry every known field (see UserSettings' doc comment: it's a
// whole-object PATCH, so an omitted field reads as cleared on other devices).
function buildUserSettings(s: AppStore): UserSettings {
  return {
    muted_user_ids: s.mutedUserIds,
    theme: s.theme,
    custom_skins: s.customSkins,
    accent_color: s.accentColor,
    app_text_scale: s.appTextScale,
    app_font: s.appFont,
    lyrics_font: s.lyricsFont,
    lyrics_scale: s.lyricsScale,
    lyrics_align: s.lyricsAlign,
    lyrics_blur: s.lyricsBlur,
    lyrics_blur_amount: s.lyricsBlurAmount,
    lyrics_color_active: s.lyricsColorActive,
    lyrics_color_inactive: s.lyricsColorInactive,
    lyrics_override: s.lyricsOverride,
    full_era_names: s.fullEraNames,
    gradients_enabled: s.gradientsEnabled,
    surface_gradients_enabled: s.surfaceGradientsEnabled,
    wrld_theme_background: s.wrldThemeBackground,
    playlist_hero_enabled_dark: s.playlistHeroEnabledDark,
    playlist_hero_enabled_light: s.playlistHeroEnabledLight,
    sidebar_position: s.sidebarPosition,
    nav_order: s.navOrder,
    nav_visibility: s.navVisibility,
    nav_control_order: s.navControlOrder,
    nav_control_visibility: s.navControlVisibility,
    home_section_visibility: s.homeSectionVisibility,
    playback_speed: s.playbackSpeed,
    crossfade_enabled: s.crossfadeEnabled,
    crossfade_duration: s.crossfadeDuration,
    pause_fade_enabled: s.pauseFadeEnabled,
    prefer_og_version: s.preferOgVersion,
    rotate_suggested_covers: s.rotateSuggestedCovers,
    media_overlay_enabled: s.mediaOverlayEnabled,
    lastfm_enabled: s.lastfmEnabled,
    auto_report_errors: s.autoReportErrors,
    eq_enabled: s.eqEnabled,
    eq_gains: s.eqGains,
    eq_preset: s.eqPreset,
    eq_balance: s.eqBalance,
    eq_mono: s.eqMono,
    eq_boost: s.eqBoost,
    skip_silence: s.skipSilence,
    reverb_enabled: s.reverbEnabled,
    reverb_mix: s.reverbMix,
    reverb_decay: s.reverbDecay,
    pitch_shift: s.pitchShift,
    hotkey_bindings: s.hotkeyBindings,
    hotkey_seek_seconds: s.hotkeySeekSeconds,
    global_hotkeys_enabled: s.globalHotkeysEnabled,
    muted_servers: s.chatMutedServers,
    muted_conversations: s.chatMutedConversations,
    favorite_gifs: s.favoriteGifs,
  }
}

// ── M3U import helpers (shared by the file-picker and drag-drop paths) ──────
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
  // ── Queue slice (all queue + playback logic) ───────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...createQueueSlice(set, get, store as any),

  // ── Playback extras ───────────────────────────────────────────────────────
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
  setPlaybackSpeed: (speed) => { set({ playbackSpeed: speed }); ls.set('playbackSpeed', speed); get()._scheduleProfilePush(['userSettings']) },
  setLyricsOffset: (offset) => { set({ lyricsOffset: offset }); ls.set('lyricsOffset', offset) },

  // ── Equalizer / audio effects ─────────────────────────────────────────────
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
  setEqEnabled: (eqEnabled) => { set({ eqEnabled }); ls.set('eqEnabled', eqEnabled); get()._scheduleProfilePush(['userSettings']) },
  setEqBand: (index, gain) => {
    const eqGains = [...get().eqGains]
    eqGains[index] = gain
    set({ eqGains, eqPreset: 'custom' })
    ls.set('eqGains', eqGains); ls.set('eqPreset', 'custom')
    get()._scheduleProfilePush(['userSettings'])
  },
  setEqPreset: (id) => {
    const preset = EQ_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const eqGains = [...preset.gains]
    set({ eqGains, eqPreset: id })
    ls.set('eqGains', eqGains); ls.set('eqPreset', id)
    get()._scheduleProfilePush(['userSettings'])
  },
  setEqBalance: (eqBalance) => { set({ eqBalance }); ls.set('eqBalance', eqBalance); get()._scheduleProfilePush(['userSettings']) },
  setEqMono: (eqMono) => { set({ eqMono }); ls.set('eqMono', eqMono); get()._scheduleProfilePush(['userSettings']) },
  setEqBoost: (eqBoost) => { set({ eqBoost }); ls.set('eqBoost', eqBoost); get()._scheduleProfilePush(['userSettings']) },
  setSkipSilence: (skipSilence) => { set({ skipSilence }); ls.set('skipSilence', skipSilence); get()._scheduleProfilePush(['userSettings']) },
  // 'slowedReverb' is the feature's short-lived bundled-toggle predecessor -
  // carry an existing on-state over so it doesn't silently switch off.
  reverbEnabled: ls.get<boolean>('reverbEnabled') ?? ls.get<boolean>('slowedReverb') ?? false,
  reverbMix: ls.get<number>('reverbMix') ?? 0.4,
  reverbDecay: ls.get<number>('reverbDecay') ?? 3,
  pitchShift: ls.get<boolean>('pitchShift') ?? ls.get<boolean>('slowedReverb') ?? false,
  setReverbEnabled: (reverbEnabled) => { set({ reverbEnabled }); ls.set('reverbEnabled', reverbEnabled); get()._scheduleProfilePush(['userSettings']) },
  setReverbMix: (reverbMix) => { set({ reverbMix }); ls.set('reverbMix', reverbMix); get()._scheduleProfilePush(['userSettings']) },
  setReverbDecay: (reverbDecay) => { set({ reverbDecay }); ls.set('reverbDecay', reverbDecay); get()._scheduleProfilePush(['userSettings']) },
  setPitchShift: (pitchShift) => { set({ pitchShift }); ls.set('pitchShift', pitchShift); get()._scheduleProfilePush(['userSettings']) },
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
      // phrase - and clicking "B" at (accidentally) almost the same spot as
      // "A" is the easy mistake this guards against. Treat a too-close click
      // as re-picking point A there instead of creating a degenerate loop.
      const MIN_LOOP_S = 0.5
      if (currentTime > abLoopStart + MIN_LOOP_S) {
        set({ abLoopEnd: currentTime })
      } else if (currentTime < abLoopStart - MIN_LOOP_S) {
        // Clicked "B" earlier in the track than "A" - swap so start < end.
        set({ abLoopStart: currentTime, abLoopEnd: abLoopStart })
      } else {
        set({ abLoopStart: currentTime })
      }
      return
    }
    // Both already set - third press clears it.
    set({ abLoopStart: null, abLoopEnd: null })
  },
  clearAbLoop: () => set({ abLoopStart: null, abLoopEnd: null }),
  communityEdits: [],
  // A community edit is a real audio file, so playing one goes through the
  // normal queue machinery as a single-track play - the effects chain, prefs,
  // scrobbling etc. all apply to it like any other track.
  playCommunityEdit: (edit) => {
    const track: Track = {
      id: `community-edit-${edit.id}`,
      path: edit.path,
      title: edit.name,
      artist: edit.author ? `Community edit · ${edit.author}` : 'Community edit',
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

  // ── UI ────────────────────────────────────────────────────────────────────
  activeView: 'api-tracker',
  previousView: null,
  activeAdminTab: null,
  showNowPlaying: false,
  settingsTab: null,
  showDiagnostics: false,
  showQueue: false,
  showMoreNav: false,
  showEqPanel: false,
  infoSongId: null,
  playerCollapsed: ls.get<boolean>('playerCollapsed') ?? false,
  wrldFullscreen: false,
  heroBleedTop: false,
  radioFmActive: false,
  radioFmIsLive: null,
  radioFmNowPlaying: null,
  radioFmVote: null,
  radioFmVoteDismissed: false,
  radioFmUpNext: null,
  radioFmQueuePreview: [],
  radioFmMatchedSong: null,
  // Seeds lib/skins' cache as a side effect - MUST stay above `theme` so a
  // persisted custom skin id resolves (getSkin) instead of falling back to dark.
  customSkins: hydrateCustomSkins(),
  // getSkin() maps unknown persisted ids (renamed/removed skins) back to dark.
  theme: getSkin(ls.get<string>('theme') ?? 'dark').id,
  sidebarPosition: ls.get<SidebarPosition>('sidebarPosition') ?? 'left',
  navOrder: (() => {
    // Only users who actually reordered their menu have this key at all -
    // everyone else falls through to DEFAULT_NAV_ORDER and picks up new
    // destinations in their intended position for free. For the ones who did,
    // orderedNavItems appends anything missing at the *end*, which would bury
    // Home in the "More" sheet, so front-load it instead. The `includes` guard
    // makes this idempotent, and a later drag persists whatever they choose.
    const saved = ls.get<ViewType[]>('navOrder')
    if (!saved) return DEFAULT_NAV_ORDER
    return saved.includes('home') ? saved : ['home' as ViewType, ...saved]
  })(),
  navVisibility: { ...DEFAULT_NAV_VISIBILITY, ...(ls.get<Record<string, boolean>>('navVisibility') ?? {}) },
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
  homeSectionVisibility: { ...DEFAULT_HOME_SECTION_VISIBILITY, ...(ls.get<Record<string, boolean>>('homeSectionVisibility') ?? {}) },

  setActiveView: (view) => {
    // Already there: skip, so a repeat call can't stack duplicate history
    // entries or churn subscribers that key off previousView.
    if (get().activeView === view) return
    const paths: Partial<Record<ViewType, string>> = {
      'home': '/home',
      'api-tracker': '/tracker',
      'api-files': '/files',
      'editor': '/editor',
      'contributor': '/contributor',
      'admin': '/admin',
      'editor-profile': '/editor-profile',
      'contributor-profile': '/contributor-profile',
      'albums-admin': '/albums-admin',
      'liked': '/liked',
      'playlists': '/playlists',
      'docs': '/docs',
      'wrld': '/wrld',
      'news': '/news',
      'heardle': '/heardle',
      'wordle': '/wordle',
      'tierlist': '/tierlist',
      'stats': '/wrapped',
      'statistics': '/statistics',
      'download': '/download',
      'thanks': '/thank-you',
      'settings': '/settings',
      'chat': '/chat',
    }
    // Returning to Playlists with a playlist already open (it stays selected
    // across tab switches - see playlistsSelectedId above) should restore its
    // ?id= too, not just land on the bare list. Same idea for Admin: land
    // back on whichever section (Users, Security, ...) was last open there
    // instead of always resetting to the base /admin.
    const selectedPlaylistId = get().playlistsSelectedId
    const activeAdminTab = get().activeAdminTab
    const path = view === 'playlists' && selectedPlaylistId != null
      ? `/playlists?id=${selectedPlaylistId}`
      : view === 'admin' && activeAdminTab
        ? ADMIN_TAB_PATHS[activeAdminTab] ?? '/admin'
        : paths[view] ?? '/tracker'
    window.history.pushState({ view }, '', path)
    set((s) => ({ activeView: view, previousView: view === s.activeView ? s.previousView : s.activeView }))
  },
  setActiveAdminTab: (tab) => {
    set({ activeAdminTab: tab })
    if (get().activeView !== 'admin') return
    const path = (tab && ADMIN_TAB_PATHS[tab]) || '/admin'
    window.history.replaceState({ view: 'admin', adminTab: tab }, '', path)
  },
  setShowNowPlaying: (showNowPlaying) => set({ showNowPlaying }),
  setRadioFmActive: (radioFmActive) => set({ radioFmActive }),
  setRadioFmIsLive: (radioFmIsLive) => set({ radioFmIsLive }),
  setRadioFmNowPlaying: (radioFmNowPlaying) => set({ radioFmNowPlaying }),
  setRadioFmVote: (radioFmVote) => set({ radioFmVote }),
  setRadioFmVoteDismissed: (radioFmVoteDismissed) => set({ radioFmVoteDismissed }),
  setRadioFmUpNext: (radioFmUpNext) => set({ radioFmUpNext }),
  setRadioFmQueuePreview: (radioFmQueuePreview) => set({ radioFmQueuePreview }),
  setRadioFmMatchedSong: (radioFmMatchedSong) => set({ radioFmMatchedSong }),
  setShowSettings: (show) => {
    const s = get()
    if (show) { s.setActiveView('settings'); return }
    // "Close" means go back to whatever was showing before Settings opened -
    // there's no other view underneath anymore now that Settings is a real
    // page in the same activeView slot as everything else, not an overlay
    // sitting on top of it.
    const fallback = s.previousView && s.previousView !== 'settings' ? s.previousView : 'api-tracker'
    s.setActiveView(fallback)
  },
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  openSettings: (tab) => {
    if (tab) set({ settingsTab: tab })
    get().setShowSettings(true)
  },
  toggleSettings: () => {
    const s = get()
    s.setShowSettings(s.activeView !== 'settings')
  },
  openProfile: () => {
    // Which profile view depends on the account's roles, not on the caller -
    // staffProfileView is the same helper the sidebar/bottom-nav tabs label
    // themselves from, so the two can't drift apart.
    const view = userApi.staffProfileView(get().account)
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
  setShowDiagnostics: (showDiagnostics) => set({ showDiagnostics }),
  setShowQueue: (showQueue) => set({ showQueue }),
  setShowMoreNav: (showMoreNav) => set({ showMoreNav }),
  setShowEqPanel: (showEqPanel) => set({ showEqPanel }),
  toggleEqPanel: () => set((s) => ({ showEqPanel: !s.showEqPanel })),
  setInfoSongId: (infoSongId) => {
    // Mirrors setShowSettings: re-opening while already docked wouldn't
    // otherwise re-expand a collapsed sandbox notch.
    if (infoSongId != null) useSandboxStore.getState().expand()
    set({ infoSongId })
  },
  setPlayerCollapsed: (playerCollapsed) => { set({ playerCollapsed }); ls.set('playerCollapsed', playerCollapsed) },
  setWrldFullscreen: (wrldFullscreen) => set({ wrldFullscreen }),
  setHeroBleedTop: (heroBleedTop) => set({ heroBleedTop }),
  setTheme: (theme) => { set({ theme }); ls.set('theme', theme); get()._scheduleProfilePush(['userSettings']) },
  saveCustomSkin: (skin) => {
    const list = get().customSkins
    const idx = list.findIndex((s) => s.id === skin.id)
    const next = idx >= 0 ? list.map((s) => (s.id === skin.id ? skin : s)) : [...list, skin]
    set({ customSkins: next })
    ls.set('customSkins', next)
    // Keep the module cache getSkin() reads in step - the theme effect reruns
    // on this state change and repaints from the cache (live preview when the
    // edited skin is the active one).
    setCustomSkinsCache(next)
    get()._scheduleProfilePush(['userSettings'])
  },
  deleteCustomSkin: (id) => {
    const next = get().customSkins.filter((s) => s.id !== id)
    set({ customSkins: next })
    ls.set('customSkins', next)
    setCustomSkinsCache(next)
    if (get().theme === id) get().setTheme('dark')
    get()._scheduleProfilePush(['userSettings'])
  },
  setSidebarPosition: (sidebarPosition) => { set({ sidebarPosition }); ls.set('sidebarPosition', sidebarPosition); get()._scheduleProfilePush(['userSettings']) },
  setNavOrder: (navOrder) => { set({ navOrder }); ls.set('navOrder', navOrder); get()._scheduleProfilePush(['userSettings']) },
  setNavItemVisible: (view, visible) => {
    const navVisibility = { ...get().navVisibility, [view]: visible }
    set({ navVisibility })
    ls.set('navVisibility', navVisibility)
    get()._scheduleProfilePush(['userSettings'])
  },
  setNavControlOrder: (navControlOrder) => { set({ navControlOrder }); ls.set('navControlOrder', navControlOrder); get()._scheduleProfilePush(['userSettings']) },
  setNavControlVisible: (id, visible) => {
    const navControlVisibility = { ...get().navControlVisibility, [id]: visible }
    set({ navControlVisibility })
    ls.set('navControlVisibility', navControlVisibility)
    get()._scheduleProfilePush(['userSettings'])
  },
  setHomeSectionVisible: (id, visible) => {
    const homeSectionVisibility = { ...get().homeSectionVisibility, [id]: visible }
    set({ homeSectionVisibility })
    ls.set('homeSectionVisibility', homeSectionVisibility)
    get()._scheduleProfilePush(['userSettings'])
  },

  // ── Settings ──────────────────────────────────────────────────────────────
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
  surfaceGradientsEnabled: ls.get<boolean>('surfaceGradientsEnabled') ?? false,
  wrldThemeBackground: ls.get<boolean>('wrldThemeBackground') ?? false,
  playlistHeroEnabledDark: ls.get<boolean>('playlistHeroEnabledDark') ?? true,
  playlistHeroEnabledLight: ls.get<boolean>('playlistHeroEnabledLight') ?? false,
  preferOgVersion: ls.get<boolean>('preferOgVersion') ?? false,
  rotateSuggestedCovers: ls.get<boolean>('rotateSuggestedCovers') ?? false,
  eraCovers: ls.get<Record<string, string>>('eraCovers') ?? {},
  mediaOverlayEnabled: ls.get<boolean>('mediaOverlayEnabled') ?? true,
  lastfmUser: getLastfmSession()?.name ?? null,
  lastfmEnabled: ls.get<boolean>('lastfmEnabled') ?? true,
  hotkeyBindings: ls.get<Record<string, string>>('hotkeyBindings') ?? {},
  hotkeySeekSeconds: ls.get<number>('hotkeySeekSeconds') ?? 10,
  globalHotkeysEnabled: ls.get<boolean>('globalHotkeysEnabled') ?? false,
  globalHotkeyBindings: ls.get<Record<string, string>>('globalHotkeyBindings') ?? {},

  setCrossfade: (enabled, duration) => {
    set({ crossfadeEnabled: enabled, crossfadeDuration: duration })
    ls.set('crossfadeEnabled', enabled)
    ls.set('crossfadeDuration', duration)
    get()._scheduleProfilePush(['userSettings'])
  },
  setPauseFade: (enabled) => { set({ pauseFadeEnabled: enabled }); ls.set('pauseFadeEnabled', enabled); get()._scheduleProfilePush(['userSettings']) },
  setSleepTimer: (sleepTimerEnd) => set({ sleepTimerEnd }),
  setAudioOutput: (deviceId) => { set({ audioOutput: deviceId }); ls.set('audioOutput', deviceId) },
  setPreferOgVersion: (enabled) => { set({ preferOgVersion: enabled }); ls.set('preferOgVersion', enabled); get()._scheduleProfilePush(['userSettings']) },

  setRotateSuggestedCovers: (enabled) => {
    set({ rotateSuggestedCovers: enabled })
    ls.set('rotateSuggestedCovers', enabled)
    get()._scheduleProfilePush(['userSettings'])
    if (enabled) return
    // Turning it off has to forget the chosen covers, or every song stays
    // frozen on whichever suggestion it happened to land on. Re-derive the
    // visible tracks afterwards so the current song snaps back immediately
    // rather than at the next track change.
    resetCoverRotation()
    const { queue, currentTrack, currentTrackFull, songPrefs } = get()
    // Only API songs - a local file has no apiImageUrl to fall back on, so
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
    // A cover the user picked always wins - rotation fills gaps, it doesn't
    // override choices.
    if (get().songPrefs[songId]?.cover_url) return
    advanceRotatedCover(songId)
      // The rotated URL lives outside the store (lib/coverRotation), so the
      // re-derive is what actually moves it onto the visible tracks.
      .then((url) => { if (url) get()._reapplySongPref(songId) })
      .catch(() => {})
  },
  setMediaOverlayEnabled: (enabled) => { set({ mediaOverlayEnabled: enabled }); ls.set('mediaOverlayEnabled', enabled); get()._scheduleProfilePush(['userSettings']) },
  setLastfmUser: (lastfmUser) => set({ lastfmUser }),
  setLastfmEnabled: (enabled) => { set({ lastfmEnabled: enabled }); ls.set('lastfmEnabled', enabled); get()._scheduleProfilePush(['userSettings']) },
  setAccentColor: (color) => { set({ accentColor: color }); ls.set('accentColor', color); get()._scheduleProfilePush(['userSettings']) },
  setAppTextScale: (appTextScale) => { set({ appTextScale }); ls.set('appTextScale', appTextScale); get()._scheduleProfilePush(['userSettings']) },
  setAppFont: (appFont) => { set({ appFont }); ls.set('appFont', appFont); get()._scheduleProfilePush(['userSettings']) },
  setLyricsFont: (lyricsFont) => { set({ lyricsFont }); ls.set('lyricsFont', lyricsFont); get()._scheduleProfilePush(['userSettings']) },
  setLyricsScale: (lyricsScale) => { set({ lyricsScale }); ls.set('lyricsScale', lyricsScale); get()._scheduleProfilePush(['userSettings']) },
  setLyricsAlign: (lyricsAlign) => { set({ lyricsAlign }); ls.set('lyricsAlign', lyricsAlign); get()._scheduleProfilePush(['userSettings']) },
  setLyricsBlur: (lyricsBlur) => { set({ lyricsBlur }); ls.set('lyricsBlur', lyricsBlur); get()._scheduleProfilePush(['userSettings']) },
  setLyricsOverride: (lyricsOverride) => { set({ lyricsOverride }); ls.set('lyricsOverride', lyricsOverride); get()._scheduleProfilePush(['userSettings']) },
  setFullEraNames: (fullEraNames) => { set({ fullEraNames }); ls.set('fullEraNames', fullEraNames); get()._scheduleProfilePush(['userSettings']) },
  setLyricsBlurAmount: (lyricsBlurAmount) => { set({ lyricsBlurAmount }); ls.set('lyricsBlurAmount', lyricsBlurAmount); get()._scheduleProfilePush(['userSettings']) },
  setLyricsColorActive: (lyricsColorActive) => { set({ lyricsColorActive }); ls.set('lyricsColorActive', lyricsColorActive); get()._scheduleProfilePush(['userSettings']) },
  setLyricsColorInactive: (lyricsColorInactive) => { set({ lyricsColorInactive }); ls.set('lyricsColorInactive', lyricsColorInactive); get()._scheduleProfilePush(['userSettings']) },
  setGradientsEnabled: (gradientsEnabled) => { set({ gradientsEnabled }); ls.set('gradientsEnabled', gradientsEnabled); get()._scheduleProfilePush(['userSettings']) },
  setSurfaceGradientsEnabled: (surfaceGradientsEnabled) => { set({ surfaceGradientsEnabled }); ls.set('surfaceGradientsEnabled', surfaceGradientsEnabled); get()._scheduleProfilePush(['userSettings']) },
  setWrldThemeBackground: (wrldThemeBackground) => { set({ wrldThemeBackground }); ls.set('wrldThemeBackground', wrldThemeBackground); get()._scheduleProfilePush(['userSettings']) },
  setPlaylistHeroEnabled: (enabled) => {
    if (getSkin(get().theme).dark) {
      set({ playlistHeroEnabledDark: enabled }); ls.set('playlistHeroEnabledDark', enabled)
    } else {
      set({ playlistHeroEnabledLight: enabled }); ls.set('playlistHeroEnabledLight', enabled)
    }
    get()._scheduleProfilePush(['userSettings'])
  },

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
    // Store an override only when it differs from the default - if the user
    // sets it back to the default (or clears one that had no default), drop the
    // entry entirely so the persisted map stays minimal.
    if (combo === (action?.defaultBinding ?? '')) delete next[actionId]
    else next[actionId] = combo
    set({ hotkeyBindings: next })
    ls.set('hotkeyBindings', next)
    get()._scheduleProfilePush(['userSettings'])
  },
  resetHotkeyBindings: () => { set({ hotkeyBindings: {} }); ls.set('hotkeyBindings', {}); get()._scheduleProfilePush(['userSettings']) },
  resetGlobalHotkeyBindings: () => { set({ globalHotkeyBindings: {} }); ls.set('globalHotkeyBindings', {}) },
  setHotkeySeekSeconds: (seconds) => { set({ hotkeySeekSeconds: seconds }); ls.set('hotkeySeekSeconds', seconds); get()._scheduleProfilePush(['userSettings']) },
  setGlobalHotkeysEnabled: (enabled) => { set({ globalHotkeysEnabled: enabled }); ls.set('globalHotkeysEnabled', enabled); get()._scheduleProfilePush(['userSettings']) },
  setGlobalHotkeyBinding: (actionId, combo) => {
    const current = get().globalHotkeyBindings
    const next = { ...current }
    // Same one-combo-one-action rule as setHotkeyBinding, but scoped to the
    // global namespace - an in-app and a global binding are free to share a
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

  // ── Liked songs ───────────────────────────────────────────────────────────
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

  // ── Muted users ───────────────────────────────────────────────────────────
  mutedUserIds: ls.get<number[]>('mutedUserIds') ?? [],
  // Mirrors chatStore's own local mutedServers/mutedConversations (that
  // store owns them; see chatStore's loadMuted/saveMuted) so they can ride
  // along in the same user_settings push. Empty until chatStore's account
  // hydrate calls _syncChatMutes.
  chatMutedServers: [],
  chatMutedConversations: [],

  // ── Favorite GIFs ─────────────────────────────────────────────────────────
  favoriteGifs: ls.get<GifResult[]>('favoriteGifs') ?? [],

  toggleFavoriteGif: (gif) => {
    const { favoriteGifs } = get()
    const next = favoriteGifs.some((g) => g.id === gif.id)
      ? favoriteGifs.filter((g) => g.id !== gif.id)
      : [gif, ...favoriteGifs]
    set({ favoriteGifs: next })
    ls.set('favoriteGifs', next)
    get()._scheduleProfilePush(['userSettings'])
  },

  muteUser: (userId) => {
    const { mutedUserIds } = get()
    if (mutedUserIds.includes(userId)) return
    const next = [...mutedUserIds, userId]
    set({ mutedUserIds: next })
    ls.set('mutedUserIds', next)
    get()._scheduleProfilePush(['userSettings'])
  },
  unmuteUser: (userId) => {
    const { mutedUserIds } = get()
    if (!mutedUserIds.includes(userId)) return
    const next = mutedUserIds.filter((id) => id !== userId)
    set({ mutedUserIds: next })
    ls.set('mutedUserIds', next)
    get()._scheduleProfilePush(['userSettings'])
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
    get()._scheduleProfilePush(['userSettings'])
  },
  // Merges every field of the server's `user_settings` blob into local state,
  // then schedules a push so the merge (and anything local-only that's never
  // reached the server yet) makes it back up. Runs on login.
  //
  // muted_user_ids is unioned rather than "server wins" - muting someone
  // should stick regardless of which device did it. Everything else adopts
  // the server's value only when it differs from local: these are personal
  // settings that follow the account, and the server only changes when some
  // device just pushed a real edit, so treating that as authoritative is
  // simpler (and less surprising) than trying to reconcile two device-local
  // histories. A field the server has never set (undefined - a brand new
  // field, or an account that's never synced) leaves the local value alone.
  syncUserSettings: async (serverSettings) => {
    const s = get()
    if (!serverSettings) { get()._scheduleProfilePush(['userSettings']); return }

    const mergedMuted = Array.from(new Set([...(serverSettings.muted_user_ids ?? []), ...s.mutedUserIds]))
    if (mergedMuted.length !== s.mutedUserIds.length) { set({ mutedUserIds: mergedMuted }); ls.set('mutedUserIds', mergedMuted) }

    // Favorite GIFs union like muted_user_ids - favoriting on one device
    // shouldn't be erasable by a stale sync from another.
    const serverFavGifs = serverSettings.favorite_gifs ?? []
    const mergedFavGifs = [...s.favoriteGifs, ...serverFavGifs.filter((g) => !s.favoriteGifs.some((f) => f.id === g.id))]
    if (mergedFavGifs.length !== s.favoriteGifs.length) { set({ favoriteGifs: mergedFavGifs }); ls.set('favoriteGifs', mergedFavGifs) }

    if (serverSettings.theme && serverSettings.theme !== s.theme) s.setTheme(getSkin(serverSettings.theme).id)
    if (serverSettings.custom_skins && JSON.stringify(serverSettings.custom_skins) !== JSON.stringify(s.customSkins)) {
      set({ customSkins: serverSettings.custom_skins })
      ls.set('customSkins', serverSettings.custom_skins)
      setCustomSkinsCache(serverSettings.custom_skins)
    }
    if (serverSettings.accent_color !== undefined && serverSettings.accent_color !== s.accentColor) s.setAccentColor(serverSettings.accent_color)
    if (serverSettings.app_text_scale !== undefined && serverSettings.app_text_scale !== s.appTextScale) s.setAppTextScale(serverSettings.app_text_scale)
    if (serverSettings.app_font && serverSettings.app_font !== s.appFont) s.setAppFont(getFont(serverSettings.app_font).id)
    if (serverSettings.lyrics_font && serverSettings.lyrics_font !== s.lyricsFont) s.setLyricsFont(getFont(serverSettings.lyrics_font).id)
    if (serverSettings.lyrics_scale !== undefined && serverSettings.lyrics_scale !== s.lyricsScale) s.setLyricsScale(serverSettings.lyrics_scale)
    if (serverSettings.lyrics_align && serverSettings.lyrics_align !== s.lyricsAlign) s.setLyricsAlign(serverSettings.lyrics_align)
    if (serverSettings.lyrics_blur !== undefined && serverSettings.lyrics_blur !== s.lyricsBlur) s.setLyricsBlur(serverSettings.lyrics_blur)
    if (serverSettings.lyrics_blur_amount !== undefined && serverSettings.lyrics_blur_amount !== s.lyricsBlurAmount) s.setLyricsBlurAmount(serverSettings.lyrics_blur_amount)
    if (serverSettings.lyrics_color_active !== undefined && serverSettings.lyrics_color_active !== s.lyricsColorActive) s.setLyricsColorActive(serverSettings.lyrics_color_active)
    if (serverSettings.lyrics_color_inactive !== undefined && serverSettings.lyrics_color_inactive !== s.lyricsColorInactive) s.setLyricsColorInactive(serverSettings.lyrics_color_inactive)
    if (serverSettings.lyrics_override !== undefined && serverSettings.lyrics_override !== s.lyricsOverride) s.setLyricsOverride(serverSettings.lyrics_override)
    if (serverSettings.full_era_names !== undefined && serverSettings.full_era_names !== s.fullEraNames) s.setFullEraNames(serverSettings.full_era_names)
    if (serverSettings.gradients_enabled !== undefined && serverSettings.gradients_enabled !== s.gradientsEnabled) s.setGradientsEnabled(serverSettings.gradients_enabled)
    if (serverSettings.surface_gradients_enabled !== undefined && serverSettings.surface_gradients_enabled !== s.surfaceGradientsEnabled) s.setSurfaceGradientsEnabled(serverSettings.surface_gradients_enabled)
    if (serverSettings.wrld_theme_background !== undefined && serverSettings.wrld_theme_background !== s.wrldThemeBackground) s.setWrldThemeBackground(serverSettings.wrld_theme_background)
    if (serverSettings.playlist_hero_enabled_dark !== undefined && serverSettings.playlist_hero_enabled_dark !== s.playlistHeroEnabledDark) {
      set({ playlistHeroEnabledDark: serverSettings.playlist_hero_enabled_dark }); ls.set('playlistHeroEnabledDark', serverSettings.playlist_hero_enabled_dark)
    }
    if (serverSettings.playlist_hero_enabled_light !== undefined && serverSettings.playlist_hero_enabled_light !== s.playlistHeroEnabledLight) {
      set({ playlistHeroEnabledLight: serverSettings.playlist_hero_enabled_light }); ls.set('playlistHeroEnabledLight', serverSettings.playlist_hero_enabled_light)
    }
    if (serverSettings.sidebar_position && serverSettings.sidebar_position !== s.sidebarPosition) s.setSidebarPosition(serverSettings.sidebar_position as SidebarPosition)
    if (serverSettings.nav_order && JSON.stringify(serverSettings.nav_order) !== JSON.stringify(s.navOrder)) s.setNavOrder(serverSettings.nav_order)
    if (serverSettings.nav_visibility) { set({ navVisibility: { ...s.navVisibility, ...serverSettings.nav_visibility } }); ls.set('navVisibility', get().navVisibility) }
    if (serverSettings.nav_control_order && JSON.stringify(serverSettings.nav_control_order) !== JSON.stringify(s.navControlOrder)) s.setNavControlOrder(serverSettings.nav_control_order)
    if (serverSettings.nav_control_visibility) { set({ navControlVisibility: { ...s.navControlVisibility, ...serverSettings.nav_control_visibility } }); ls.set('navControlVisibility', get().navControlVisibility) }
    if (serverSettings.home_section_visibility) { set({ homeSectionVisibility: { ...s.homeSectionVisibility, ...serverSettings.home_section_visibility } }); ls.set('homeSectionVisibility', get().homeSectionVisibility) }
    if (serverSettings.playback_speed !== undefined && serverSettings.playback_speed !== s.playbackSpeed) s.setPlaybackSpeed(serverSettings.playback_speed)
    if (serverSettings.crossfade_enabled !== undefined && (serverSettings.crossfade_enabled !== s.crossfadeEnabled || serverSettings.crossfade_duration !== s.crossfadeDuration)) {
      s.setCrossfade(serverSettings.crossfade_enabled, serverSettings.crossfade_duration ?? s.crossfadeDuration)
    }
    if (serverSettings.pause_fade_enabled !== undefined && serverSettings.pause_fade_enabled !== s.pauseFadeEnabled) s.setPauseFade(serverSettings.pause_fade_enabled)
    if (serverSettings.prefer_og_version !== undefined && serverSettings.prefer_og_version !== s.preferOgVersion) s.setPreferOgVersion(serverSettings.prefer_og_version)
    if (serverSettings.rotate_suggested_covers !== undefined && serverSettings.rotate_suggested_covers !== s.rotateSuggestedCovers) s.setRotateSuggestedCovers(serverSettings.rotate_suggested_covers)
    if (serverSettings.media_overlay_enabled !== undefined && serverSettings.media_overlay_enabled !== s.mediaOverlayEnabled) s.setMediaOverlayEnabled(serverSettings.media_overlay_enabled)
    if (serverSettings.lastfm_enabled !== undefined && serverSettings.lastfm_enabled !== s.lastfmEnabled) s.setLastfmEnabled(serverSettings.lastfm_enabled)
    if (serverSettings.auto_report_errors !== undefined && serverSettings.auto_report_errors !== s.autoReportErrors) s.setAutoReportErrors(serverSettings.auto_report_errors)
    if (serverSettings.eq_enabled !== undefined && serverSettings.eq_enabled !== s.eqEnabled) s.setEqEnabled(serverSettings.eq_enabled)
    if (serverSettings.eq_gains && serverSettings.eq_gains.length === EQ_BANDS.length && JSON.stringify(serverSettings.eq_gains) !== JSON.stringify(s.eqGains)) {
      set({ eqGains: serverSettings.eq_gains, eqPreset: serverSettings.eq_preset ?? 'custom' })
      ls.set('eqGains', serverSettings.eq_gains); ls.set('eqPreset', serverSettings.eq_preset ?? 'custom')
    }
    if (serverSettings.eq_balance !== undefined && serverSettings.eq_balance !== s.eqBalance) s.setEqBalance(serverSettings.eq_balance)
    if (serverSettings.eq_mono !== undefined && serverSettings.eq_mono !== s.eqMono) s.setEqMono(serverSettings.eq_mono)
    if (serverSettings.eq_boost !== undefined && serverSettings.eq_boost !== s.eqBoost) s.setEqBoost(serverSettings.eq_boost)
    if (serverSettings.skip_silence !== undefined && serverSettings.skip_silence !== s.skipSilence) s.setSkipSilence(serverSettings.skip_silence)
    if (serverSettings.reverb_enabled !== undefined && serverSettings.reverb_enabled !== s.reverbEnabled) s.setReverbEnabled(serverSettings.reverb_enabled)
    if (serverSettings.reverb_mix !== undefined && serverSettings.reverb_mix !== s.reverbMix) s.setReverbMix(serverSettings.reverb_mix)
    if (serverSettings.reverb_decay !== undefined && serverSettings.reverb_decay !== s.reverbDecay) s.setReverbDecay(serverSettings.reverb_decay)
    if (serverSettings.pitch_shift !== undefined && serverSettings.pitch_shift !== s.pitchShift) s.setPitchShift(serverSettings.pitch_shift)
    if (serverSettings.hotkey_bindings && JSON.stringify(serverSettings.hotkey_bindings) !== JSON.stringify(s.hotkeyBindings)) {
      set({ hotkeyBindings: serverSettings.hotkey_bindings }); ls.set('hotkeyBindings', serverSettings.hotkey_bindings)
    }
    if (serverSettings.hotkey_seek_seconds !== undefined && serverSettings.hotkey_seek_seconds !== s.hotkeySeekSeconds) s.setHotkeySeekSeconds(serverSettings.hotkey_seek_seconds)
    if (serverSettings.global_hotkeys_enabled !== undefined && serverSettings.global_hotkeys_enabled !== s.globalHotkeysEnabled) s.setGlobalHotkeysEnabled(serverSettings.global_hotkeys_enabled)

    // muted_servers/muted_conversations aren't merged here - chatStore owns
    // that local per-account data and already imports this store, so it
    // reads serverSettings itself (via account.user_settings) and calls
    // _syncChatMutes once it's merged, on the same account-hydrate pass that
    // loads its local copy. See chatStore's account effect.

    if (!get().account) return
    get()._scheduleProfilePush(['userSettings'])
  },

  // ── Song preferences ──────────────────────────────────────────────────────
  songPrefs: hydrateSongPrefs(),
  listeningPlays: hydrateListeningPlays(),

  // Every write lands in three places: Zustand state (so React re-renders),
  // localStorage (so overrides survive a restart and work logged out), and
  // lib/songPrefs' module cache (so songToTrack - which can't import this
  // store without a cycle - resolves overrides for Tracks built later).
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
      // only rebuilds when the track id changes - without this fan-out a cover
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
    if (!get().account) return
    if (fields.some((f) => f !== 'userSettings') && !preferencesApi.preferencesApiEnabled) return
    for (const f of fields) _profilePushDirty[f] = true
    if (_profilePushTimer) clearTimeout(_profilePushTimer)
    _profilePushTimer = setTimeout(() => {
      _profilePushTimer = null
      const dirty = _profilePushDirty
      _profilePushDirty = { songPrefs: false, listeningPlays: false, folders: false, userSettings: false }
      const state = get()
      profilePushApi.pushProfile({
        songPrefs: dirty.songPrefs ? Object.values(state.songPrefs) : undefined,
        listeningPlays: dirty.listeningPlays ? state.listeningPlays : undefined,
        folders: dirty.folders ? state.playlistFolders : undefined,
        userSettings: dirty.userSettings ? buildUserSettings(state) : undefined,
      }).catch(() => {})
    }, PROFILE_PUSH_DEBOUNCE_MS)
  },

  _writeSongPref: (songId, patch) => {
    get()._setSongPrefs(patchPrefMap(get().songPrefs, songId, patch))
    if (patch.name !== undefined || patch.cover_url !== undefined) get()._reapplySongPref(songId)
    // No rollback on push failure: the local write is already durable, and the
    // profile blob is replaced wholesale on the next push or login merge - a
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
    // appended alongside it is additive instead - merges union the two sides.
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
      // edited them since this one last pushed) - except playcount, where
      // max() is the only merge that never loses plays made here offline.
      for (const wire of rows) {
        // Wire rows omit fields they have no value for (see serializeSongPref),
        // so they're filled out before anything downstream reads them.
        const row = normalizeSongPref(wire)
        const mine = local[row.song]
        merged[row.song] = mine
          ? { ...row, playcount: Math.max(row.playcount, mine.playcount ?? 0) }
          : row
      }
      // Rows that exist only on this device (set before signing in, or on
      // songs the profile blob dropped at the 500 cap) are kept and pushed.
      for (const pref of Object.values(local)) {
        if (!merged[pref.song]) merged[pref.song] = pref
      }
      get()._setSongPrefs(merged)
      // Goes through the shared debounced scheduler rather than pushing
      // immediately - loadAccount calls this alongside syncListeningPlays and
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

  // ── Reports (feedback + song issue reports) ────────────────────────────────
  pendingReports: ls.get<PendingReport[]>('pendingReports') ?? [],
  reportModal: null,
  autoReportErrors: ls.get<boolean>('autoReportErrors') ?? true,
  setAutoReportErrors: (autoReportErrors) => { set({ autoReportErrors }); ls.set('autoReportErrors', autoReportErrors); get()._scheduleProfilePush(['userSettings']) },

  openReport: (target) => set({ reportModal: target }),
  closeReport: () => set({ reportModal: null }),

  _enqueueReport: async (report: PendingReport) => {
    const next = [...get().pendingReports, report]
    set({ pendingReports: next })
    ls.set('pendingReports', next)
    // Wait for this round of delivery so the caller can tell the user whether
    // it actually reached the server or is just sitting in the outbox.
    await get()._flushReports()
    return !get().pendingReports.some((r) => r.id === report.id)
  },

  submitFeedback: async (category, message, contact, automated) => {
    const text = message.trim()
    if (!text) return false
    return get()._enqueueReport({
      id: newReportId(), kind: 'feedback', category, message: text,
      contact: contact?.trim() || undefined,
      ...(automated ? { automated: true } : {}),
      appVersion: APP_VERSION, createdAt: Date.now(), attempts: 0,
    })
  },

  reportSong: async (songId, songName, issues, message, contact) => {
    // A report needs at least a flagged issue or a written note to be worth
    // sending - the form enforces this too, but guard here so no empty report
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
          // Delivered - drop it, re-reading current state so a report queued
          // mid-flush isn't lost.
          const remaining = get().pendingReports.filter((r) => r.id !== report.id)
          set({ pendingReports: remaining })
          ls.set('pendingReports', remaining)
        } catch {
          // Delivery failed - count the attempt so a permanently-rejected
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

  // ── Playlist folders ───────────────────────────────────────────────────────
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
      // Remove the moving keys from every folder first…
      const without = f.playlistKeys.filter((k) => !moving.has(k))
      // …then append them to the target (dedup preserved by the removal above).
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
        // Nothing on the account yet - push what's here so this device's
        // folders become the starting point.
        if (local.length > 0) get()._scheduleProfilePush(['folders'])
        return
      }
      // The profile's list is the source of truth for synced-playlist
      // membership. Folder ids are client-generated and round-trip through
      // the blob unchanged, so a same-id local folder IS the same folder -
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
      // members it's a device-only folder - keep it. If it holds synced
      // members, its absence from the profile means another device deleted it
      // after this device last pushed - honour the delete by dropping it.
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

  // ── API tracker extras ────────────────────────────────────────────────────
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

  // Cached so the file browser's liked/unliked hearts render correctly on the
  // first paint instead of resolving against an empty list (which reads as
  // "primary" - see useTrackChannel). Refreshed by loadChannels below.
  channels: ls.get<JWApiChannel[]>('channels') ?? [],
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
    ls.set('channels', list)
    ls.set('activeChannel', next)
    setActiveChannelCache(next)
  },

  // ── Account ───────────────────────────────────────────────────────────────
  account: null,
  playlists: [],
  showUserAuth: false,
  pendingPlaylistId: null,
  setPendingPlaylistId: (id) => set({ pendingPlaylistId: id }),
  playlistsSelectedId: null,
  playlistsSelectedLocalId: null,
  playlistsSort: { field: 'default', dir: 'asc' },
  setPlaylistsSort: (sort) => set({ playlistsSort: sort }),
  setPlaylistsSelectedId: (id) => {
    set({ playlistsSelectedId: id })
    // Keep /playlists?id=<id> in sync with whatever's open, the same way News
    // syncs /news/<id> - so the address bar is always shareable and
    // survives a refresh. Only touch the URL while actually on the
    // Playlists page (this setter also fires from background hand-offs like
    // pendingPlaylistId, whose own effect drives the tab switch + URL).
    if (window.location.pathname !== '/playlists') return
    const params = new URLSearchParams(window.location.search)
    if (id != null) params.set('id', String(id))
    else { params.delete('id'); params.delete('view') }
    const qs = params.toString()
    const path = qs ? `/playlists?${qs}` : '/playlists'
    if (path !== window.location.pathname + window.location.search) window.history.pushState({}, '', path)
  },
  setPlaylistsSelectedLocalId: (id) => set({ playlistsSelectedLocalId: id }),
  playlistsOpenFolderId: null,
  setPlaylistsOpenFolderId: (id) => set({ playlistsOpenFolderId: id }),

  setShowUserAuth: (showUserAuth) => {
    if (showUserAuth) useSandboxStore.getState().expand()
    set({ showUserAuth })
  },

  loadAccount: async () => {
    // Overlapping callers (see the flag's comment above) await the same run
    // instead of each kicking off their own - the GET /me itself dedupes via
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
        // Only clear token on auth errors - network/server errors should not log the user out
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
      // The preference/folder blobs ride on the getMe() response - merge them
      // with local state and push the result back, no extra requests needed.
      const profile = get().account
      await get().syncUserSettings(profile?.user_settings)
      await get().syncSongPrefs(profile?.user_preferences)
      get().syncListeningPlays(profile?.listening_plays)
      get().syncFolders(profile?.playlist_folders)
      // Deliver any reports queued while signed out - a logged-in flush can
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
    window.location.href = authorize_url
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

  signupWithPassword: async (username, password, displayName) => {
    const { token, user } = await userApi.registerAccount({
      username,
      password,
      display_name: displayName,
    })
    userApi.setToken(token)
    set({ account: user })
    await get().loadAccount()
  },

  loginWithPassword: async (username, password) => {
    const { token, user } = await userApi.passwordLogin({ username, password })
    userApi.setToken(token)
    set({ account: user })
    await get().loadAccount()
  },

  logoutAccount: async () => {
    await userApi.logout()
    const localLikes = ls.get<string[]>('likedTrackIds') ?? []
    set({ account: null, playlists: [], likedTrackIds: localLikes })
    // Overrides stay on this device after signing out, the same way likes do -
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
  // playlist's tracks + cover right after the summaries load - so opening the
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
          // swallowed - a prefetch miss just means the normal on-open fetch
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
  // pages are ready - and render instantly when offline - before the user ever
  // navigates to them. These calls go through apiFetch's cacheKey, which is the
  // same offline fallback the views themselves read from on a network failure,
  // and the URLs/params match the views' own first fetches exactly so the cache
  // keys line up (tracker: stats + eras + first unfiltered song page; files:
  // the root folder listing). Fire-and-forget and failure-tolerant - a miss
  // just means the view does its normal fetch later.
  //
  // Anything already in the cache is skipped. This runs at idle, by which point
  // the view that's actually on screen has usually fetched (and cached) three
  // of these four itself - re-requesting them would make the prefetch a source
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
        ['/eras/', { page: 2 }],
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

  // ── Editor ────────────────────────────────────────────────────────────────
  pendingCompProposal: null,
  pendingEditorSongId: null,
  pendingEditProposal: null,
  bulkEdit: null,
  openBulkEditor: (songs) => set({ bulkEdit: songs.length ? { kind: 'api', songs } : null }),
  closeBulkEditor: () => set({ bulkEdit: null }),
  setPendingCompProposal: (pendingCompProposal) => set({ pendingCompProposal }),
  setPendingEditorSongId: (pendingEditorSongId) => set({ pendingEditorSongId }),
  openSongEditor: (songId) => {
    set({ pendingEditorSongId: songId })
    get().setActiveView('editor')
  },
  setPendingEditProposal: (pendingEditProposal) => set({ pendingEditProposal }),

  // ── Library ───────────────────────────────────────────────────────────────
  libraryTracks: [],
  libraryArt: {},
  libraryLoaded: false,
  libraryFolders: ls.get<string[]>('libraryFolders') ?? [],
  libraryScanning: false,
  libraryLastScanned: ls.get<number>('libraryLastScanned') ?? null,
  // Off by default - periodic disk scans of a large library aren't free, so
  // this is opt-in rather than always re-checking every file's mtime/size.
  libraryAutoRefresh: ls.get<boolean>('libraryAutoRefresh') ?? false,
  developerMode: ls.get<boolean>('developerMode') ?? false,
  localPlaylists: [],
  activeLocalPlaylistId: null,
  guestPlaylists: ls.get<GuestPlaylist[]>('guestPlaylists') ?? [],
  followedPlaylists: ls.get<FollowedPlaylist[]>('followedPlaylists') ?? [],

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
    // from "playing" a trashed file, and releases our own read handle - Windows
    // refuses to move a file that's still open. The confirm prompt itself lives
    // in the main process (see the delete-library-file handler).
    if (get().currentTrack?.id === id && get().isPlaying) get().setIsPlaying(false)

    const res = await el.deleteLibraryFile(track.filePath)
    // Cancelled, or the delete failed - main already surfaced the error dialog.
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
    // Windows - same reasoning as deleteLibraryTrack.
    if (get().currentTrack?.id === id && get().isPlaying) get().setIsPlaying(false)

    const res = await el.moveLibraryFile(track.filePath)
    // Cancelled, or the move failed - main already surfaced the error dialog.
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
    // it from the new path - see its `track.streamUrl ?? toFileUrl(track.path)`.
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
    // Cover art lives in libraryArt, never on the track objects - keep the
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
  // Batched form of updateLibraryTrack(id, { albumArt }) - collects results
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
          // Covers land in their own map - NOT in libraryTracks - so a burst of
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
      // re-parsing tags for files whose size/mtime haven't changed - makes
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
  createGuestPlaylist: (name) => {
    const id = `gp-${Date.now()}`
    const playlist: GuestPlaylist = { id, name, tracks: [], createdAt: Date.now() }
    const next = [...get().guestPlaylists, playlist]
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
    return id
  },
  deleteGuestPlaylist: (id) => {
    const next = get().guestPlaylists.filter((p) => p.id !== id)
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
  },
  renameGuestPlaylist: (id, name) => {
    const next = get().guestPlaylists.map((p) => p.id === id ? { ...p, name } : p)
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
  },
  addToGuestPlaylist: (playlistId, track) => {
    const next = get().guestPlaylists.map((p) =>
      p.id === playlistId ? { ...p, tracks: [...p.tracks, track] } : p)
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
  },
  removeFromGuestPlaylist: (playlistId, trackId) => {
    const next = get().guestPlaylists.map((p) =>
      p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p)
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
  },
  reorderGuestPlaylist: (playlistId, tracks) => {
    const next = get().guestPlaylists.map((p) => p.id === playlistId ? { ...p, tracks } : p)
    set({ guestPlaylists: next })
    ls.set('guestPlaylists', next)
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
    // Already have the list in memory - skip the disk read + IPC + full re-set.
    // The store is authoritative in-session (scans and local-playlist edits
    // write it directly); only a forced reload after another window changed the
    // data needs to re-read. This is what makes tab revisits instant.
    if (!force && get().libraryLoaded) return
    try {
      const [libData, playlists] = await Promise.all([el.loadLibraryData(), el.loadLocalPlaylists()])
      // Cover art lives in libraryArt (keyed by track id) and is left untouched
      // here, so the loaded covers survive a Library-tab remount without any
      // per-track merge - just swap in the fresh metadata list.
      if (libData?.tracks) set({ libraryTracks: libData.tracks })
      if (playlists) set({ localPlaylists: playlists })
      set({ libraryLoaded: true })
    } catch(e) { console.error('loadLibrary error:', e) }
  },

  // ── Followed playlists (local-only - see FollowedPlaylist) ─────────────────
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

  // ── Uploads ────────────────────────────────────────────────────────────────
  uploads: [],
  showUploadManager: false,

  addUpload: (item) => set((s) => ({ uploads: [item, ...s.uploads] })),
  updateUpload: (id, updates) => set((s) => ({
    uploads: s.uploads.map((d) => d.id === id ? { ...d, ...updates } : d),
  })),
  removeUpload: (id) => set((s) => ({ uploads: s.uploads.filter((d) => d.id !== id) })),
  clearCompletedUploads: () => set((s) => ({
    uploads: s.uploads.filter((d) => d.state === 'downloading'),
  })),
  setShowUploadManager: (show) => set({ showUploadManager: show }),

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

  stagedSongChanges: [],
  // One queued change per song/channel/type: editing a song again before it's
  // proposed replaces the queued patch rather than piling up duplicates. A
  // 'create' has no song id to key off of - each new-song draft is its own
  // proposal, so those never collapse into each other.
  stageSongChanges: (changes) => set((s) => ({
    stagedSongChanges: [
      ...s.stagedSongChanges.filter((c) => !changes.some((n) =>
        n.songId != null && n.songId === c.songId && n.channel === c.channel && n.changeType === c.changeType)),
      ...changes.map((c, i) => ({ ...c, id: `staged-song-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}` })),
    ],
  })),
  updateStagedSongChange: (id, updates) => set((s) => ({
    stagedSongChanges: s.stagedSongChanges.map((c) => c.id === id ? { ...c, ...updates } : c),
  })),
  unstageSongChange: (id) => set((s) => ({
    stagedSongChanges: s.stagedSongChanges.filter((c) => c.id !== id),
  })),
  clearStagedSongChanges: () => set({ stagedSongChanges: [] }),
}))

// Dev-only console handle for driving store state while debugging (e.g.
// forcing auth-gated views to render without an account). Never set in
// production builds.
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__store = useStore
}

// Subscribe to a shallow-compared subset of the store. A bare `useStore()`
// re-renders the component on EVERY store write - including the ~4x/sec
// timeupdate ticks and per-chunk download progress - so components must pick
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
