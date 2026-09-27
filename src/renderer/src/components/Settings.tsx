import { useState, useEffect, useRef, ReactNode, ElementType, CSSProperties } from 'react'
import {
  X, Brush, Palette, Volume2, Zap, Clock, Info, Github, MessageCircle,
  PenLine, BookOpen, Copy, Eye, EyeOff, ChevronDown, KeyRound, Globe, RefreshCw, DownloadCloud,
  FolderOpen, FolderPlus, Monitor, BellOff, Minus, Loader2, Plus, AlignLeft, FileText, Trash2, Wrench, FlaskConical,
  PanelLeft, PanelRight, PanelTop, PanelBottom, Waves, Keyboard, RotateCcw, AppWindow, PictureInPicture2, Minimize2,
  ListOrdered, GripVertical, CloudUpload, Type, AlignCenter, Menu, Pencil, Upload,
  ScrollText, ShieldCheck, Disc, Images, Search, Cloud, Server, Home,
} from 'lucide-react'
import DonorFiles from './DonorFiles'
import MyCdnNodes from './MyCdnNodes'
import { useStore, useStorePick, type SidebarPosition, type AppMenuPosition, type PopoutWindowKind } from '../store/useStore'
import { HOTKEY_ACTIONS, HOTKEY_CATEGORIES, effectiveBinding, effectiveGlobalBinding, comboTokens, eventToCombo, isGloballyRegistrable } from '../lib/hotkeys'
import { SKINS, getSkin, createCustomSkin, parseSkinFile } from '../lib/skins'
import SkinEditorModal from './SkinEditorModal'
import { FONTS } from '../lib/fonts'
import { orderedNavItems, isNavItemVisible, DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY, orderedNavControls, isNavControlAvailable, DEFAULT_NAV_CONTROL_ORDER, DEFAULT_NAV_CONTROL_VISIBILITY } from '../lib/navItems'
import { HOME_SECTIONS, isHomeSectionVisible } from '../lib/homeSections'
import { hasChatAccess } from '../store/chatStore'
import { getToken, CONTRIBUTOR_ENABLED, staffProfileLabel, staffProfileView, showStaffProfile } from '../lib/userApi'
import { APP_VERSION } from '../lib/appVersion'
import {
  lastfmConfigured, lastfmGetAuthToken, lastfmAuthUrl, lastfmTryGetSession, lastfmDisconnect,
} from '../lib/lastfm'
import { cacheClearAll } from '../lib/apiCache'
import cdnService from '../lib/cdn'
import { formatBytes } from '../lib/format'
import { navigateMainWindow, attachToMainWindow } from '../lib/windowSync'
import type { ViewType } from '../types'
import ReportForm from './ReportForm'
import LegalModal, { type LegalDoc } from './LegalModal'
import { ModalOverlay, LockToggle, useSandboxStore } from './Modal'
import EraCoversSection from './EraCoversSection'

const ACCENT_PRESETS = [
  '#1db954', '#7c3aed', '#2563eb', '#dc2626',
  '#ea580c', '#d97706', '#059669', '#db2777',
]

const APP_TEXT_SIZES: { label: string; value: number }[] = [
  { label: 'Small', value: 0.9 },
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.1 },
  { label: 'Larger', value: 1.2 },
]

// Swatches offered for the lyric line colors. The sung line wants bright,
// high-contrast tones; the rest want dimmer ones that still read against the
// WRLD tab's blurred cover art.
const LYRIC_ACTIVE_PRESETS = ['#ffffff', '#1db954', '#a78bfa', '#60a5fa', '#f472b6', '#facc15']
const LYRIC_INACTIVE_PRESETS = ['#9ca3af', '#6b7280', '#94a3b8', '#c4b5fd', '#7dd3fc', '#fda4af']

const LYRIC_TEXT_SIZES: { label: string; value: number }[] = [
  { label: 'Small', value: 0.85 },
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.2 },
  { label: 'Huge', value: 1.4 },
]

const NAV_POSITIONS: { id: SidebarPosition; label: string; icon: ElementType }[] = [
  { id: 'left', label: 'Left', icon: PanelLeft },
  { id: 'right', label: 'Right', icon: PanelRight },
  { id: 'top', label: 'Top', icon: PanelTop },
  { id: 'bottom', label: 'Bottom', icon: PanelBottom },
]

const APP_MENU_POSITIONS: { id: AppMenuPosition; label: string; icon: ElementType }[] = [
  { id: 'sidebar', label: 'Side menu', icon: PanelLeft },
  { id: 'title-bar', label: 'Title bar', icon: PanelTop },
  { id: 'hidden', label: 'Hidden', icon: EyeOff },
]

// The detached pop-out windows the user can turn on/off individually. Order =
// display order. `sub` only where a kind behaves differently from the default
// "opens in the main window when off" — the mini player has no in-app version.
const POPOUT_KINDS: { key: PopoutWindowKind; label: string; sub?: string }[] = [
  { key: 'settings', label: 'Settings' },
  { key: 'songInfo', label: 'Song info' },
  { key: 'editor', label: 'Song editor' },
  { key: 'localEditor', label: 'Local metadata editor' },
  { key: 'convert', label: 'Convert format' },
  { key: 'profile', label: 'Profile', sub: 'Proposals, comp files, reports and admin in their own window' },
  { key: 'miniPlayer', label: 'Mini player', sub: 'No in-app version — off hides the pop-out button' },
]

type UpdateState = 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'error'
type Tab = 'appearance' | 'playback' | 'shortcuts' | 'library' | 'app' | 'donor' | 'developer' | 'feedback' | 'about'

// A hand-maintained index of every setting row, used by the search bar to
// jump straight to the tab a match lives on. `electronOnly`/`devOnly` mirror
// the same gates the rows themselves are rendered behind, so a search never
// offers to jump somewhere the tab doesn't actually exist.
const SETTINGS_SEARCH_INDEX: { tab: Tab; label: string; sub?: string; electronOnly?: boolean; devOnly?: boolean }[] = [
  // Appearance
  { tab: 'appearance', label: 'Skin', sub: 'Custom skin colors and presets' },
  { tab: 'appearance', label: 'Accent color' },
  { tab: 'appearance', label: 'Gradient surfaces', sub: 'Accent-tinted gradients behind the app, sidebar, and player' },
  { tab: 'appearance', label: 'Surface gradients', sub: 'Accent-tinted gradients on toggle groups, search bars, badges, and menus' },
  { tab: 'appearance', label: 'Theme background in WRLD', sub: "Use the app's theme behind the WRLD tab instead of the playing song's cover" },
  { tab: 'appearance', label: 'App font' },
  { tab: 'appearance', label: 'Lyrics font' },
  { tab: 'appearance', label: 'App text size' },
  { tab: 'appearance', label: 'Lyrics text size' },
  { tab: 'appearance', label: 'Lyrics alignment' },
  { tab: 'appearance', label: 'Blur inactive lyrics', sub: 'Soften every synced line except the one playing' },
  { tab: 'appearance', label: 'Lyric colors', sub: 'Current line and other lines' },
  { tab: 'appearance', label: 'Full era names', sub: 'Show eras spelled out instead of abbreviated' },
  { tab: 'appearance', label: 'Navigation position', sub: 'Where the nav menu sits — left, right, top, bottom' },
  { tab: 'appearance', label: 'App menu button', sub: 'Where the File / Edit / View… menu opens from', electronOnly: true },
  { tab: 'appearance', label: 'Menu items', sub: 'Reorder or hide sidebar tabs' },
  { tab: 'appearance', label: 'Menu controls', sub: 'Reorder or hide the buttons at the foot of the menu' },
  // Playback
  { tab: 'playback', label: 'Audio output' },
  { tab: 'playback', label: 'Lyrics sync', sub: 'Offset lyrics timing' },
  { tab: 'playback', label: 'Crossfade' },
  { tab: 'playback', label: 'Smooth fade when pausing' },
  { tab: 'playback', label: 'Prefer OG version' },
  { tab: 'playback', label: 'Rotate suggested covers' },
  { tab: 'playback', label: 'Era covers', sub: 'Custom cover art per era, used when a song has no cover of its own' },
  { tab: 'playback', label: 'Sleep timer' },
  { tab: 'playback', label: 'Last.fm scrobbling' },
  { tab: 'playback', label: 'Distributed CDN downloads', sub: 'Use the peer-to-peer CDN network for faster downloads' },
  // Shortcuts
  { tab: 'shortcuts', label: 'Skip amount', sub: 'How far skip-forward / skip-backward jump' },
  { tab: 'shortcuts', label: 'Global shortcuts', sub: 'Work while the app is in the background', electronOnly: true },
  { tab: 'shortcuts', label: 'Keyboard shortcuts', sub: 'Rebind any in-app or global hotkey' },
  // Library
  { tab: 'library', label: 'Library folders', sub: 'Local folders scanned into your library', electronOnly: true },
  { tab: 'library', label: 'Auto-refresh changed files', electronOnly: true },
  // App
  { tab: 'app', label: 'Download folder', electronOnly: true },
  { tab: 'app', label: 'Offline songs folder', electronOnly: true },
  { tab: 'app', label: 'Offline downloads' , electronOnly: true },
  { tab: 'app', label: 'Start on', sub: 'Which view opens on launch', electronOnly: true },
  { tab: 'app', label: 'Auto-download updates', electronOnly: true },
  { tab: 'app', label: 'Beta updates', electronOnly: true },
  { tab: 'app', label: 'Minimize to', sub: 'Taskbar or tray', electronOnly: true },
  { tab: 'app', label: 'Minimize to tray on close', electronOnly: true },
  { tab: 'app', label: 'Show current song in the window title', electronOnly: true },
  { tab: 'app', label: 'Remember window sizes', electronOnly: true },
  { tab: 'app', label: 'Confirm before quitting while playing', electronOnly: true },
  { tab: 'app', label: 'Media key overlay', electronOnly: true },
  { tab: 'app', label: 'Solo mini player', electronOnly: true },
  { tab: 'app', label: 'Show Discord Status', sub: 'Discord Rich Presence', electronOnly: true },
  { tab: 'app', label: 'Developer options', sub: 'Shows a Developer tab with cache & diagnostics tools', electronOnly: true },
  { tab: 'app', label: 'Pop-out windows', sub: 'Which panels open in their own window', electronOnly: true },
  { tab: 'app', label: 'Equalizer as pop-out', sub: 'Open the equalizer in its own window instead of an in-app panel', electronOnly: true },
  // Developer
  { tab: 'developer', label: 'Diagnostic logs', electronOnly: true, devOnly: true },
  { tab: 'developer', label: 'Clear cache', sub: 'Removes cached API responses and cover art', electronOnly: true, devOnly: true },
  { tab: 'developer', label: 'Update source', electronOnly: true, devOnly: true },
  { tab: 'developer', label: 'Online installer', sub: 'Repairs or reinstalls the app', electronOnly: true, devOnly: true },
  // Feedback / About
  { tab: 'feedback', label: 'Feedback', sub: 'Report a bug or share an idea' },
  { tab: 'about', label: 'About', sub: 'Version, GitHub, Discord, API links' },
  { tab: 'about', label: 'Auth Token', sub: 'View and copy your account token' },
  { tab: 'about', label: 'API Docs' },
  { tab: 'about', label: 'GitHub' },
  { tab: 'about', label: 'Discord' },
  { tab: 'about', label: 'Terms of Service' },
  { tab: 'about', label: 'Privacy Policy' },
  { tab: 'about', label: 'Become an Editor' },
  { tab: 'about', label: 'Become a Contributor' },
  { tab: 'about', label: 'FAQ', sub: 'What is this? Who are you? Why did you build this? Technical stuff?' },
]

// ── Flat row primitive — no card/box, just an icon + label on the left and
// a control on the right, separated by a hairline. Used inside each tab's
// content pane (macOS System Settings' detail-pane idiom, not the boxed
// inset-grouped list). The icon sits in a colored badge (iOS Settings-style)
// — a fixed color + white icon reads correctly in both themes, unlike the
// plain `text-muted` icon this replaced, which nearly disappeared in light
// mode. ──

function Row({ icon: Icon, iconColor, label, sub, labelExtra, children }: {
  icon: ElementType
  iconColor: string
  label: string
  sub?: string
  // Rendered immediately after the label, on the left — for controls that
  // are conceptually part of the label (e.g. an on/off toggle right next
  // to "Crossfade"), as opposed to `children`, which sits at the row's
  // right edge (e.g. the crossfade duration slider).
  labelExtra?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
          <Icon size={13} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <p className="text-text-primary text-sm truncate">{label}</p>
          {sub && <p className="text-text-muted text-[11px] truncate">{sub}</p>}
        </div>
        {labelExtra}
      </div>
      {children}
    </div>
  )
}

// One line of the "Lyric colors" setting: presets + a custom picker, with
// "Auto" (value === null) meaning "leave it to the surface's own colors" —
// the theme's text vars in the mini/now-playing lyrics, the cover-art-derived
// ones in the WRLD tab. The <input type="color"> always needs a concrete hex,
// so `fallback` is what it shows while the setting is on Auto.
function LyricColorRow({ label, presets, value, fallback, onChange }: {
  label: string
  presets: string[]
  value: string | null
  fallback: string
  onChange: (color: string | null) => void
}): JSX.Element {
  const [custom, setCustom] = useState(value ?? fallback)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-text-muted text-[11px] w-[86px] shrink-0">{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
          value === null
            ? 'bg-accent/15 text-accent border-[var(--accent)]'
            : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
        }`}
      >
        Auto
      </button>
      {presets.map((c) => (
        <button
          key={c}
          onClick={() => { onChange(c); setCustom(c) }}
          className="w-6 h-6 rounded-full border border-[var(--border)] transition-transform hover:scale-110"
          style={{ backgroundColor: c, outline: value?.toLowerCase() === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
          title={c}
        />
      ))}
      <input
        type="color"
        value={custom}
        onChange={(e) => {
          const next = e.target.value
          setCustom(next)
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => onChange(next), 80)
        }}
        className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent"
        title="Custom color"
      />
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative w-10 h-5 rounded-full shrink-0 transition-colors appearance-none border-0 p-0 leading-none ${on ? 'bg-accent' : 'bg-[var(--surface-overlay)]'}`}
    >
      {/* Vertically centered with inset-y-0 + my-auto (an auto-margin flex/
          block centering trick) instead of a manual top offset — a fixed
          `top-0.5` still relied on the button having zero padding/border to
          land exactly right, and browsers don't zero those out on <button>
          by default. auto-margin centering can't drift regardless of the
          button's own box model. No shadow on the knob either — its default
          downward offset (0 1px 3px) reads as visual weight sitting low,
          making it look off-center even when it's geometrically centered. */}
      <span className={`absolute inset-y-0 my-auto w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

interface AppSettings {
  downloadPath: string
  autoDownload: boolean
  minimizeToTray: boolean
  minimizeTo: 'taskbar' | 'tray'
  startupView: string
  discordRpcEnabled: boolean
  discordRpcLabel: 'app' | 'artist' | 'song'
  offlineLibraryPath: string
  miniPlayerHidesWindows: boolean
  confirmCloseWhilePlaying: boolean
  windowTitleNowPlaying: boolean
  rememberWindowSizes: boolean
}

// `floating` — rendered as the sole content of a pop-out BrowserWindow (see
// FloatApp) rather than as an in-app overlay: the panel fills the window, the
// header doubles as the window's drag handle, closing closes the OS window,
// and view links (Docs, Editor) navigate the MAIN window instead.
export default function Settings({ floating = false }: { floating?: boolean }): JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [cdnEnabled, setCdnEnabled] = useState(cdnService.enabled)
  const [openAbout, setOpenAbout] = useState<string | null>(null)
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)
  // Re-opening while already docked (sandbox notch collapsed) wouldn't
  // otherwise re-expand it — see the matching comment on setShowSettings.
  const openLegal = (doc: LegalDoc): void => { useSandboxStore.getState().expand(); setLegalDoc(doc) }
  const sandboxEnabled = useSandboxStore((s) => s.sandboxEnabled)
  const setSandboxEnabled = useSandboxStore((s) => s.setSandboxEnabled)
  const {
    setShowSettings, setActiveView,
    account,
    theme, setTheme,
    customSkins, saveCustomSkin, deleteCustomSkin,
    accentColor, setAccentColor,
    settingsTab, setSettingsTab,
    sidebarPosition, setSidebarPosition,
    appMenuPosition, setAppMenuPosition,
    navOrder, setNavOrder,
    navVisibility, setNavItemVisible,
    homeSectionVisibility, setHomeSectionVisible,
    navControlOrder, setNavControlOrder,
    navControlVisibility, setNavControlVisible,
    audioOutput, setAudioOutput,
    crossfadeEnabled, crossfadeDuration, setCrossfade,
    pauseFadeEnabled, setPauseFade,
    preferOgVersion, setPreferOgVersion,
    rotateSuggestedCovers, setRotateSuggestedCovers,
    mediaOverlayEnabled, setMediaOverlayEnabled,
    popoutWindows, setPopoutWindow,
    lyricsOffset, setLyricsOffset,
    sleepTimerEnd, setSleepTimer,
    hotkeyBindings, setHotkeyBinding, resetHotkeyBindings, resetGlobalHotkeyBindings, hotkeySeekSeconds, setHotkeySeekSeconds,
    globalHotkeysEnabled, setGlobalHotkeysEnabled,
    globalHotkeyBindings, setGlobalHotkeyBinding,
    updateStatus,
    libraryFolders, addLibraryFolder, removeLibraryFolder, scanLibrary, libraryScanning, libraryTracks, libraryLastScanned,
    libraryAutoRefresh, setLibraryAutoRefresh,
    developerMode, setDeveloperMode,
    lastfmUser, setLastfmUser, lastfmEnabled, setLastfmEnabled,
    appTextScale, setAppTextScale,
    lyricsScale, setLyricsScale,
    lyricsAlign, setLyricsAlign,
    lyricsBlur, setLyricsBlur,
    lyricsBlurAmount, setLyricsBlurAmount,
    lyricsColorActive, setLyricsColorActive,
    lyricsColorInactive, setLyricsColorInactive,
    appFont, setAppFont,
    lyricsFont, setLyricsFont,
    gradientsEnabled, setGradientsEnabled,
    surfaceGradientsEnabled, setSurfaceGradientsEnabled,
    wrldThemeBackground, setWrldThemeBackground,
    refreshPlaylists,
    fullEraNames, setFullEraNames,
  } = useStorePick('setShowSettings', 'setActiveView', 'account', 'theme', 'setTheme', 'customSkins', 'saveCustomSkin', 'deleteCustomSkin', 'accentColor', 'setAccentColor', 'settingsTab', 'setSettingsTab', 'sidebarPosition', 'setSidebarPosition', 'appMenuPosition', 'setAppMenuPosition', 'navOrder', 'setNavOrder', 'navVisibility', 'setNavItemVisible', 'homeSectionVisibility', 'setHomeSectionVisible', 'navControlOrder', 'setNavControlOrder', 'navControlVisibility', 'setNavControlVisible', 'audioOutput', 'setAudioOutput', 'crossfadeEnabled', 'crossfadeDuration', 'setCrossfade', 'pauseFadeEnabled', 'setPauseFade', 'preferOgVersion', 'setPreferOgVersion', 'rotateSuggestedCovers', 'setRotateSuggestedCovers', 'mediaOverlayEnabled', 'setMediaOverlayEnabled', 'popoutWindows', 'setPopoutWindow', 'lyricsOffset', 'setLyricsOffset', 'sleepTimerEnd', 'setSleepTimer', 'hotkeyBindings', 'setHotkeyBinding', 'resetHotkeyBindings', 'resetGlobalHotkeyBindings', 'hotkeySeekSeconds', 'setHotkeySeekSeconds', 'globalHotkeysEnabled', 'setGlobalHotkeysEnabled', 'globalHotkeyBindings', 'setGlobalHotkeyBinding', 'updateStatus', 'libraryFolders', 'addLibraryFolder', 'removeLibraryFolder', 'scanLibrary', 'libraryScanning', 'libraryTracks', 'libraryLastScanned', 'libraryAutoRefresh', 'setLibraryAutoRefresh', 'developerMode', 'setDeveloperMode', 'lastfmUser', 'setLastfmUser', 'lastfmEnabled', 'setLastfmEnabled', 'appTextScale', 'setAppTextScale', 'lyricsScale', 'setLyricsScale', 'lyricsAlign', 'setLyricsAlign', 'lyricsBlur', 'setLyricsBlur', 'lyricsBlurAmount', 'setLyricsBlurAmount', 'lyricsColorActive', 'setLyricsColorActive', 'lyricsColorInactive', 'setLyricsColorInactive', 'appFont', 'setAppFont', 'lyricsFont', 'setLyricsFont', 'gradientsEnabled', 'setGradientsEnabled', 'surfaceGradientsEnabled', 'setSurfaceGradientsEnabled', 'wrldThemeBackground', 'setWrldThemeBackground', 'refreshPlaylists', 'fullEraNames', 'setFullEraNames')

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [customAccent, setCustomAccent] = useState(accentColor)
  // Drag-to-reorder state for the "Menu order" list — indices into the visible
  // nav list (see shownNav below). null = nothing being dragged / hovered.
  const [navDragIdx, setNavDragIdx] = useState<number | null>(null)
  const [navOverIdx, setNavOverIdx] = useState<number | null>(null)
  // Same, for the separate "Menu controls" list below.
  const [ctrlDragIdx, setCtrlDragIdx] = useState<number | null>(null)
  const [ctrlOverIdx, setCtrlOverIdx] = useState<number | null>(null)
  const [sleepMinutes, setSleepMinutes] = useState(30)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updatePercent, setUpdatePercent] = useState(0)
  // Sticky companion to updateState === 'error': that state self-clears back to
  // 'idle' after a few seconds, which is fine for the red flash but useless as a
  // gate for the recovery button. This stays set until a check actually succeeds,
  // so someone whose updater is wedged keeps a visible way out.
  const [updateFailed, setUpdateFailed] = useState(false)
  const accentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Custom skins — which one the editor modal is open on (null = closed), the
  // hidden file input for Import, and a transient "that file wasn't a skin"
  // message shown under the section.
  const [editingSkinId, setEditingSkinId] = useState<string | null>(null)
  const skinImportRef = useRef<HTMLInputElement>(null)
  const [skinImportError, setSkinImportError] = useState<string | null>(null)

  // Clone the current look into a new editable skin, make it active (so the
  // editor previews live), and open the editor on it.
  const createSkin = (): void => {
    const skin = createCustomSkin(getSkin(theme), 'My skin')
    saveCustomSkin(skin)
    setTheme(skin.id)
    if (skin.accent) setCustomAccent(skin.accent)
    setEditingSkinId(skin.id)
  }

  const importSkinFile = async (file: File): Promise<void> => {
    setSkinImportError(null)
    const skin = parseSkinFile(await file.text())
    if (!skin) { setSkinImportError('That file isn’t a valid skin.'); return }
    saveCustomSkin(skin)
    setTheme(skin.id)
    if (skin.accent) { setAccentColor(skin.accent); setCustomAccent(skin.accent) }
    setEditingSkinId(skin.id)
  }
  const isElectron = navigator.userAgent.includes('Electron')
  const el = (window as any).electron
  // Master pop-out switch reflects "any kind still on"; flipping it turns them
  // all off (or, from all-off, back on).
  const anyPopout = POPOUT_KINDS.some((k) => popoutWindows[k.key])

  // ── Menu items (Appearance) ──────────────────────────────────────────────
  // Every platform-eligible nav item in saved order — visible ones and the
  // toggled-off extras alike — so the list is where you both reorder and
  // show/hide. Web-only tabs (Library) are dropped on web.
  const navRows = orderedNavItems(navOrder).filter((i) => isElectron || !i.electronOnly)
  const navOrderIsDefault = navOrder.length === DEFAULT_NAV_ORDER.length && navOrder.every((v, i) => v === DEFAULT_NAV_ORDER[i])
  const navVisIsDefault = navRows.every((i) => (navVisibility[i.view] ?? true) === (DEFAULT_NAV_VISIBILITY[i.view] ?? true))
  const navIsDefault = navOrderIsDefault && navVisIsDefault
  const resetNav = (): void => {
    setNavOrder(DEFAULT_NAV_ORDER)
    for (const item of navRows) {
      const def = DEFAULT_NAV_VISIBILITY[item.view] ?? true
      if ((navVisibility[item.view] ?? true) !== def) setNavItemVisible(item.view, def)
    }
  }
  // Move a row to sit adjacent to a target row. Reordering happens on the FULL
  // order (including any web-hidden items) so their relative spots are preserved
  // even when a web user rearranges the visible ones.
  const moveNavItem = (fromRow: number, toRow: number): void => {
    if (fromRow === toRow) return
    const full = orderedNavItems(navOrder).map((i) => i.view)
    const dragView = navRows[fromRow].view
    const targetView = navRows[toRow].view
    const from = full.indexOf(dragView)
    const next = [...full]
    next.splice(from, 1)
    const targetIdx = next.indexOf(targetView)
    next.splice(toRow > fromRow ? targetIdx + 1 : targetIdx, 0, dragView)
    setNavOrder(next)
  }

  // ── Menu controls — the foot-of-menu buttons (Profile, Log out, Diagnostics,
  // Download, Settings). Same reorder/hide model, filtered to the controls
  // that actually apply to this session (account state, platform, dev mode).
  const controlCtx = { account: !!account, isElectron, developerMode }
  const ctrlRows = orderedNavControls(navControlOrder).filter((c) => isNavControlAvailable(c.id, controlCtx))
  const ctrlOrderIsDefault = navControlOrder.length === DEFAULT_NAV_CONTROL_ORDER.length && navControlOrder.every((v, i) => v === DEFAULT_NAV_CONTROL_ORDER[i])
  const ctrlVisIsDefault = ctrlRows.every((c) => (navControlVisibility[c.id] ?? true) === (DEFAULT_NAV_CONTROL_VISIBILITY[c.id] ?? true))
  const ctrlIsDefault = ctrlOrderIsDefault && ctrlVisIsDefault
  const resetControls = (): void => {
    setNavControlOrder(DEFAULT_NAV_CONTROL_ORDER)
    for (const c of ctrlRows) {
      const def = DEFAULT_NAV_CONTROL_VISIBILITY[c.id] ?? true
      if ((navControlVisibility[c.id] ?? true) !== def) setNavControlVisible(c.id, def)
    }
  }
  const moveNavControl = (fromRow: number, toRow: number): void => {
    if (fromRow === toRow) return
    const full = orderedNavControls(navControlOrder).map((c) => c.id as string)
    const dragId = ctrlRows[fromRow].id
    const targetId = ctrlRows[toRow].id
    const from = full.indexOf(dragId)
    const next = [...full]
    next.splice(from, 1)
    const targetIdx = next.indexOf(targetId)
    next.splice(toRow > fromRow ? targetIdx + 1 : targetIdx, 0, dragId)
    setNavControlOrder(next)
  }

  const closeSettings = (): void => {
    if (floating) el?.closeSelf?.()
    else setShowSettings(false)
  }
  const openMainView = (view: ViewType): void => {
    if (floating) navigateMainWindow(view)
    else { setShowSettings(false); setActiveView(view) }
  }
  // Interactive elements inside the floating header must opt back out of the
  // drag region or they'd be unclickable.
  const noDrag = floating ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : undefined

  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadPath: '',
    autoDownload: true,
    minimizeToTray: false,
    minimizeTo: 'taskbar',
    startupView: 'api-tracker',
    discordRpcEnabled: true,
    discordRpcLabel: 'artist',
    offlineLibraryPath: '',
    miniPlayerHidesWindows: false,
    confirmCloseWhilePlaying: true,
    windowTitleNowPlaying: true,
    rememberWindowSizes: true,
  })
  const [movingOfflinePath, setMovingOfflinePath] = useState(false)
  const [offlinePathError, setOfflinePathError] = useState<string | null>(null)
  const [cacheCleared, setCacheCleared] = useState<number | null>(null)
  const [offlineStats, setOfflineStats] = useState<{ count: number; totalSize: number } | null>(null)
  const [offlineStatsLoading, setOfflineStatsLoading] = useState(false)

  // ── Last.fm connect flow (desktop token auth): fetch a token, send the user
  // to last.fm to approve it, then poll getSession until approval lands (it
  // returns null while the token is still unapproved). window.open reaches the
  // system browser in every context — the Electron windows' window-open
  // handlers route it through shell.openExternal.
  const [lastfmBusy, setLastfmBusy] = useState(false)
  const [lastfmWaiting, setLastfmWaiting] = useState(false)
  const [lastfmError, setLastfmError] = useState<string | null>(null)
  const lastfmPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopLastfmPoll = (): void => {
    if (lastfmPollRef.current) clearInterval(lastfmPollRef.current)
    lastfmPollRef.current = null
    setLastfmWaiting(false)
  }
  useEffect(() => () => { if (lastfmPollRef.current) clearInterval(lastfmPollRef.current) }, [])

  const connectLastfm = async (): Promise<void> => {
    setLastfmError(null)
    setLastfmBusy(true)
    try {
      const token = await lastfmGetAuthToken()
      window.open(lastfmAuthUrl(token), '_blank', 'noopener')
      setLastfmWaiting(true)
      const startedAt = Date.now()
      lastfmPollRef.current = setInterval(() => {
        // Tokens live ~60 minutes but nobody waits that long — give up well before.
        if (Date.now() - startedAt > 5 * 60_000) {
          stopLastfmPoll()
          setLastfmError('Authorization timed out — try again.')
          return
        }
        lastfmTryGetSession(token).then((session) => {
          if (session) { stopLastfmPoll(); setLastfmUser(session.name) }
        }).catch((e: unknown) => {
          stopLastfmPoll()
          setLastfmError(e instanceof Error ? e.message : 'Connection failed')
        })
      }, 5000)
    } catch (e) {
      setLastfmError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLastfmBusy(false)
    }
  }

  const disconnectLastfm = (): void => {
    lastfmDisconnect()
    setLastfmUser(null)
  }

  // Which shortcut cell is currently "listening" for a key combo (null = none).
  // `column` picks which independent binding map the keypress writes into.
  const [recording, setRecording] = useState<{ id: string; column: 'app' | 'global' } | null>(null)
  // While recording, the next keypress becomes the binding. Capture phase +
  // stopPropagation so the key doesn't also fire the live hotkey (Player's
  // listener is on document, bubble phase) or type into anything.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      // Bare Backspace/Delete clears the binding; modified, they can still bind.
      if (bare && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (recording.column === 'app') setHotkeyBinding(recording.id, '')
        else setGlobalHotkeyBinding(recording.id, '')
        setRecording(null)
        return
      }
      const combo = eventToCombo(e)
      if (!combo) return // modifier held on its own — keep waiting for a real key
      // The global column can only hold combos the OS can register system-wide
      // (a modifier or a media key) — a bare letter would swallow that key in
      // every other app. Ignore it and keep listening instead of binding it.
      if (recording.column === 'global' && !isGloballyRegistrable(combo)) return
      if (recording.column === 'app') setHotkeyBinding(recording.id, combo)
      else setGlobalHotkeyBinding(recording.id, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setHotkeyBinding, setGlobalHotkeyBinding])

  const [tab, setTab] = useState<Tab>((settingsTab as Tab) ?? 'appearance')
  const tabs: { id: Tab; label: string; icon: ElementType }[] = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'playback', label: 'Playback', icon: Volume2 },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    ...(isElectron ? [{ id: 'library' as Tab, label: 'Library', icon: FolderOpen }] : []),
    ...(isElectron ? [{ id: 'app' as Tab, label: 'App', icon: Monitor }] : []),
    ...(account?.is_donor ? [{ id: 'donor' as Tab, label: 'Donor', icon: Cloud }] : []),
    ...(isElectron && developerMode ? [{ id: 'developer' as Tab, label: 'Developer', icon: Wrench }] : []),
    { id: 'feedback', label: 'Feedback', icon: MessageCircle },
    { id: 'about', label: 'About', icon: Info },
  ]

  useEffect(() => {
    if (tab === 'developer' && !developerMode) setTab('app')
    if (tab === 'donor' && !account?.is_donor) setTab('appearance')
  }, [tab, developerMode, account?.is_donor])

  // ── Settings search — a flat filter over SETTINGS_SEARCH_INDEX rather than
  // per-tab content, since matches can live on a tab you're not currently
  // viewing. Gated the same way the rows themselves are (electron/dev mode)
  // so a result never points at a tab that doesn't exist in this build.
  const [settingsQuery, setSettingsQuery] = useState('')
  const settingsQueryTrimmed = settingsQuery.trim().toLowerCase()
  const searchResults = settingsQueryTrimmed
    ? SETTINGS_SEARCH_INDEX.filter((r) =>
        (!r.electronOnly || isElectron) &&
        (!r.devOnly || developerMode) &&
        (r.label.toLowerCase().includes(settingsQueryTrimmed) || r.sub?.toLowerCase().includes(settingsQueryTrimmed))
      )
    : []
  const jumpToResult = (t: Tab): void => {
    setTab(t)
    setSettingsQuery('')
  }

  // A deep-linked open (app menu → "Keyboard shortcuts"/"Version") sets
  // settingsTab; jump to it, then clear so a later plain open lands wherever
  // the user last was rather than snapping back here.
  useEffect(() => {
    if (!settingsTab) return
    setTab(settingsTab as Tab)
    setSettingsTab(null)
  }, [settingsTab, setSettingsTab])

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      setDevices(devs.filter((d) => d.kind === 'audiooutput'))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isElectron || !el) return
    el.getAppSettings().then((s: AppSettings) => setAppSettings(s)).catch(() => {})
  }, [isElectron, el])

  const loadOfflineStats = (): void => {
    if (!isElectron || !el?.offlineGetStats) return
    setOfflineStatsLoading(true)
    el.offlineGetStats().then((s: { count: number; totalSize: number }) => setOfflineStats(s)).catch(() => {}).finally(() => setOfflineStatsLoading(false))
  }

  useEffect(() => {
    loadOfflineStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron, el])

  useEffect(() => {
    if (!isElectron || !el) return
    const off = el.onUpdateStatus?.((d: { type: string; version?: string; percent?: number; message?: string }) => {
      if (d.type === 'checking') { setUpdateState('checking'); setUpdateVersion(null) }
      else if (d.type === 'available') { setUpdateState('available'); setUpdateVersion(d.version ?? null); setUpdateFailed(false) }
      else if (d.type === 'not-available') { setUpdateState('latest'); setUpdateVersion(d.version ?? null); setUpdateFailed(false); setTimeout(() => setUpdateState('idle'), 5000) }
      else if (d.type === 'downloading') { setUpdateState('downloading'); setUpdatePercent(d.percent ?? 0) }
      else if (d.type === 'downloaded') { setUpdateState('downloaded'); setUpdateVersion(d.version ?? null); setUpdateFailed(false) }
      else if (d.type === 'error') { setUpdateState('error'); setUpdateFailed(true); setTimeout(() => setUpdateState('idle'), 5000) }
    })
    return () => off?.()
  }, [isElectron, el])

  useEffect(() => {
    if (!updateStatus) return
    if (updateStatus.type === 'downloading') { setUpdateState('downloading'); setUpdatePercent(updateStatus.percent ?? 0) }
    else if (updateStatus.type === 'downloaded') { setUpdateState('downloaded'); setUpdateVersion(updateStatus.version ?? null) }
    else if (updateStatus.type === 'available') { setUpdateState('available'); setUpdateVersion(updateStatus.version ?? null) }
    else if (updateStatus.type === 'checking') setUpdateState('checking')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setSetting = async (key: keyof AppSettings, value: unknown) => {
    if (!el) return
    setAppSettings((prev) => ({ ...prev, [key]: value }))
    await el.setAppSetting(key, value)
  }

  // ── Beta channel — join needs a valid access code (verified in main.js
  // against the same hash list the installer uses); leaving is always free ──
  const [betaEnabled, setBetaEnabled] = useState(false)
  const [betaCode, setBetaCode] = useState('')
  const [betaMsg, setBetaMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectron || !el?.betaGetStatus) return
    el.betaGetStatus().then((on: boolean) => setBetaEnabled(!!on)).catch(() => {})
  }, [isElectron, el])

  const joinBeta = async () => {
    if (!el?.betaJoin || !betaCode.trim()) return
    const ok = await el.betaJoin(betaCode)
    if (ok === 'unavailable') setBetaMsg("Beta signup is unavailable right now — the server didn't respond properly")
    else if (ok) { setBetaEnabled(true); setBetaCode(''); setBetaMsg(null) }
    else setBetaMsg('Invalid code — double-check it and try again')
  }

  const leaveBeta = async () => {
    if (!el?.betaLeave) return
    await el.betaLeave()
    setBetaEnabled(false)
    setBetaMsg(null)
  }

  const pickDownloadFolder = async () => {
    if (!el) return
    const picked = await el.pickFolder()
    if (picked) setSetting('downloadPath', picked)
  }

  const pickOfflineFolder = async () => {
    if (!el) return
    const picked = await el.pickFolder()
    if (!picked || picked === appSettings.offlineLibraryPath) return
    setMovingOfflinePath(true)
    setOfflinePathError(null)
    try {
      const result = await el.offlineSetLibraryPath(picked)
      if (result?.error) { setOfflinePathError(result.error); return }
      setAppSettings((prev) => ({ ...prev, offlineLibraryPath: result.path }))
      if (result?.failedCount) setOfflinePathError(`${result.failedCount} file(s) couldn't be moved and will re-download on next sync`)
      loadOfflineStats()
    } finally {
      setMovingOfflinePath(false)
    }
  }

  const toggleSleepTimer = (): void => {
    if (sleepTimerEnd) setSleepTimer(null)
    else setSleepTimer(Date.now() + sleepMinutes * 60 * 1000)
  }

  const updateBtnTitle = updateState === 'checking' ? 'Checking...'
    : updateState === 'available' ? `v${updateVersion} available`
    : updateState === 'downloading' ? `Downloading ${updatePercent}%`
    : updateState === 'downloaded' ? 'Ready to install'
    : updateState === 'latest' ? 'Up to date'
    : updateState === 'error' ? 'Check failed — use Reinstall latest release'
    : updateFailed ? 'Check for updates (last check failed)'
    : 'Check for updates'

  return (
    <ModalOverlay
      onClose={closeSettings}
      floating={floating}
      zIndexClassName="z-50"
      panelClassName="bg-surface border border-[var(--border)] rounded-3xl shadow-2xl w-full max-w-[760px] h-[600px] max-h-[85vh]"
      minWidth={520} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock }) => (
      <>
      {/* Custom-skin editor (portals to <body>, so placement here is fine) */}
      {editingSkinId && (
        <SkinEditorModal
          skinId={editingSkinId}
          onClose={() => setEditingSkinId(null)}
          onEditSkin={setEditingSkinId}
        />
      )}
      <div className="bg-surface w-full h-full flex flex-col overflow-hidden">
        {/* Header — in a pop-out it doubles as the frameless window's drag strip;
            in-app it's the JS drag handle instead (see ModalOverlay). */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0 select-none ${floating ? '' : 'cursor-grab active:cursor-grabbing'}`}
          style={floating ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined}
          onMouseDown={onHandleMouseDown}
        >
          <div className="flex items-center gap-2" style={noDrag}>
            <h2 className="text-text-primary font-black text-xl tracking-tight">Settings</h2>
            {isElectron && (
              <button
                disabled={updateState === 'checking' || updateState === 'downloading'}
                title={updateBtnTitle}
                onClick={async () => {
                  if (updateState === 'downloaded') { (el as any)?.installUpdate?.(); return }
                  setUpdateState('checking')
                  try {
                    await el?.checkForUpdates()
                    setUpdateState((s: UpdateState) => s === 'checking' ? 'latest' : s)
                    setUpdateFailed(false)
                    setTimeout(() => setUpdateState((s: UpdateState) => s === 'latest' ? 'idle' : s), 4000)
                  } catch {
                    setUpdateState('error')
                    setUpdateFailed(true)
                    setTimeout(() => setUpdateState('idle'), 4000)
                  }
                }}
                className={`p-1 rounded transition-colors disabled:opacity-50 ${
                  updateState === 'latest' || updateState === 'downloaded' ? 'text-emerald-400' :
                  updateState === 'available' ? 'text-yellow-400' :
                  updateState === 'error' ? 'text-red-400' :
                  'text-text-muted hover:text-text-primary'
                }`}
              >
                <RefreshCw size={14} className={updateState === 'checking' || updateState === 'downloading' ? 'animate-spin' : ''} />
              </button>
            )}
            {/* Normally a developer-mode affordance, but it's also the only exit
                from a wedged updater — so unhide it once a check has failed. */}
            {isElectron && (developerMode || updateFailed) && updateState !== 'downloading' && updateState !== 'checking' && (
              <button
                title={updateFailed ? 'Update check failed — reinstall the latest release' : 'Force reinstall latest release'}
                onClick={() => el?.forceUpdate?.()}
                className={`p-1 rounded transition-colors ${updateFailed ? 'text-red-400 hover:text-red-300' : 'text-text-muted hover:text-text-primary'}`}
              >
                <DownloadCloud size={14} />
              </button>
            )}
            {updateState === 'downloading' && (
              <span className="text-[10px] text-accent font-medium">{updatePercent}%</span>
            )}
            {updateState === 'available' && updateVersion && (
              <span className="text-[10px] text-yellow-400">v{updateVersion}</span>
            )}
            {updateState === 'downloaded' && (
              <span className="text-[10px] text-emerald-400">Restart to update</span>
            )}
          </div>
          <div className="flex items-center gap-3" style={noDrag}>
            {/* Manual pop-out — only when shown in-app on desktop (i.e. the
                Settings pop-out was turned off); detaches into its own window. */}
            {!floating && isElectron && el?.openFloatWindow && (
              <button
                onClick={() => { el.openFloatWindow('settings'); setShowSettings(false) }}
                title="Open in a separate window"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <PictureInPicture2 size={18} />
              </button>
            )}
            {/* Manual attach — from the pop-out window, dock back into the
                main window's in-app settings overlay, then close this window. */}
            {floating && (
              <button
                onClick={() => { attachToMainWindow({ view: 'settings' }); el?.closeSelf?.() }}
                title="Dock into main window"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <Minimize2 size={18} />
              </button>
            )}
            {!floating && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={closeSettings} className="text-text-muted hover:text-text-primary transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search — a flat filter over every setting row (see
            SETTINGS_SEARCH_INDEX), not just the current tab, since the row
            you're after might live somewhere you're not currently looking. */}
        <div className="shrink-0 px-4 sm:px-3 pt-3 pb-2 border-b border-[var(--border)]">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder="Search settings"
              className="w-full bg-[var(--surface-overlay)] text-text-primary text-sm rounded-lg pl-8 pr-8 py-1.5 border border-[var(--border)] placeholder:text-text-muted focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            {settingsQuery && (
              <button
                onClick={() => setSettingsQuery('')}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Mobile tab bar — the sidebar collapses below sm, so categories
            move into a horizontal scroller instead. */}
        <div className="sm:hidden shrink-0 flex gap-1.5 px-4 py-2.5 border-b border-[var(--border)] overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSettingsQuery('') }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
                tab === t.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary bg-[var(--surface-overlay)]'
              }`}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — sidebar category list + flat content pane, mirroring
            macOS System Settings / Apple Music's own preferences window. */}
        <div className="flex flex-1 min-h-0">
          <div className="w-[180px] shrink-0 border-r border-[var(--border)] py-3 px-2 overflow-y-auto hidden sm:block">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setSettingsQuery('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                  tab === t.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                }`}
              >
                <t.icon size={15} className="shrink-0" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">

            {/* ── Search results ── shown instead of the active tab's content
                whenever there's a query; picking one jumps to its tab. */}
            {settingsQueryTrimmed && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">
                  {searchResults.length > 0 ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}` : 'No results'}
                </h3>
                {searchResults.length === 0 && (
                  <p className="text-text-muted text-sm">Nothing matches “{settingsQuery.trim()}”.</p>
                )}
                <div className="flex flex-col">
                  {searchResults.map((r, i) => (
                    <button
                      key={`${r.tab}-${r.label}-${i}`}
                      onClick={() => jumpToResult(r.tab)}
                      className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0 text-left hover:bg-[var(--surface-overlay)] -mx-2 px-2 rounded-lg transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm truncate">{r.label}</p>
                        {r.sub && <p className="text-text-muted text-[11px] truncate">{r.sub}</p>}
                      </div>
                      <span className="shrink-0 text-[11px] font-medium text-text-muted bg-[var(--surface-overlay)] border border-[var(--border)] rounded-full px-2 py-0.5">
                        {tabs.find((t) => t.id === r.tab)?.label ?? r.tab}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Appearance ── */}
            {!settingsQueryTrimmed && tab === 'appearance' && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">Appearance</h3>
                <div className="py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#4b5563' }}>
                      <Brush size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-text-primary text-sm">Skin</span>
                      <p className="text-text-muted text-[11px]">Skins with a signature color also set the accent — or build your own below</p>
                    </div>
                    <button
                      onClick={() => skinImportRef.current?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0"
                      title="Import a skin file"
                    >
                      <Upload size={13} /> Import
                    </button>
                    <input
                      ref={skinImportRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) importSkinFile(file)
                        e.target.value = ''
                      }}
                    />
                  </div>
                  {skinImportError && (
                    <p className="text-red-400 text-[11px] mb-2 pl-[34px]">{skinImportError}</p>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-[34px]">
                    {[...SKINS, ...customSkins].map((skin) => {
                      const active = theme === skin.id
                      return (
                        <div key={skin.id} className="relative group">
                          <button
                            onClick={() => {
                              setTheme(skin.id)
                              if (skin.accent) { setAccentColor(skin.accent); setCustomAccent(skin.accent) }
                            }}
                            onDoubleClick={() => { if (skin.custom) setEditingSkinId(skin.id) }}
                            className="w-full text-left"
                            title={skin.dynamic ? 'Palette follows the current song’s cover art' : skin.name}
                          >
                            {/* Mini app mock: sidebar strip, two "text" lines, and a
                                player bar with the skin's accent — a live swatch of
                                the actual palette values, not approximations. */}
                            <div
                              className="h-14 rounded-lg overflow-hidden flex border transition-transform group-hover:scale-[1.03] group-active:scale-[0.98]"
                              style={{
                                background: skin.vars['--surface'],
                                borderColor: active ? 'var(--accent)' : 'var(--border)',
                                boxShadow: active ? '0 0 0 1px var(--accent)' : undefined,
                              }}
                            >
                              <div className="w-1/4 h-full border-r" style={{ background: skin.vars['--sidebar'], borderColor: skin.vars['--border'] }} />
                              <div className="flex-1 p-1.5 flex flex-col gap-1 min-w-0">
                                <div className="h-1.5 rounded-full w-3/4" style={{ background: skin.vars['--text-primary'] }} />
                                <div className="h-1.5 rounded-full w-1/2" style={{ background: skin.vars['--text-secondary'], opacity: 0.7 }} />
                                <div className="mt-auto flex items-center gap-1">
                                  <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{
                                      // Dynamic skin has no fixed accent — a color wheel
                                      // signals "follows the song's cover art".
                                      background: skin.dynamic
                                        ? 'conic-gradient(#f43f5e, #f59e0b, #10b981, #38bdf8, #a78bfa, #f43f5e)'
                                        : skin.accent ?? accentColor,
                                    }}
                                  />
                                  <div className="h-1 flex-1 rounded-full" style={{ background: skin.vars['--surface-highest'] }} />
                                </div>
                              </div>
                            </div>
                            <p className={`mt-1 text-[11px] font-medium text-center transition-colors ${active ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                              {skin.name}
                            </p>
                          </button>
                          {/* Custom skins get an edit button (sibling, not nested,
                              to keep the markup button-in-button free). */}
                          {skin.custom && (
                            <button
                              onClick={() => setEditingSkinId(skin.id)}
                              className="absolute top-1 right-1 p-1 rounded-md bg-black/45 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-black/65 transition-opacity"
                              title="Edit skin"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {/* Create-a-skin tile */}
                    <button
                      onClick={createSkin}
                      className="group text-left"
                      title="Create a new skin"
                    >
                      <div className="h-14 rounded-lg border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-0.5 text-text-muted group-hover:text-accent group-hover:border-accent transition-colors">
                        <Plus size={16} />
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-center text-text-muted group-hover:text-text-primary transition-colors">
                        Create
                      </p>
                    </button>
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#ec4899' }}>
                      <Palette size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <span className="text-text-primary text-sm">Accent color</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setAccentColor(c); setCustomAccent(c) }}
                        className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: c, outline: accentColor === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
                      />
                    ))}
                    <input
                      type="color"
                      value={customAccent}
                      onChange={(e) => {
                        setCustomAccent(e.target.value)
                        if (accentDebounceRef.current) clearTimeout(accentDebounceRef.current)
                        accentDebounceRef.current = setTimeout(() => setAccentColor(e.target.value), 80)
                      }}
                      className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                      title="Custom color"
                    />
                  </div>
                </div>
                <Row
                  icon={Waves}
                  iconColor="#8b5cf6"
                  label="Gradient surfaces"
                  sub="Accent-tinted gradients behind the app, sidebar, and player"
                >
                  <Toggle on={gradientsEnabled} onClick={() => setGradientsEnabled(!gradientsEnabled)} />
                </Row>
                <Row
                  icon={Waves}
                  iconColor="#8b5cf6"
                  label="Surface gradients"
                  sub="Accent-tinted gradients on toggle groups, search bars, badges, and menus"
                >
                  <Toggle on={surfaceGradientsEnabled} onClick={() => setSurfaceGradientsEnabled(!surfaceGradientsEnabled)} />
                </Row>
                <Row
                  icon={Disc}
                  iconColor="#8b5cf6"
                  label="Theme background in WRLD"
                  sub="Use the app's theme behind the WRLD tab instead of the playing song's cover"
                >
                  <Toggle on={wrldThemeBackground} onClick={() => setWrldThemeBackground(!wrldThemeBackground)} />
                </Row>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#7c3aed' }}>
                      <Type size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">App font</span>
                      <p className="text-text-muted text-[11px]">Typeface for the whole app — each option previews in its own font</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-[34px]">
                    {FONTS.map((font) => {
                      const active = appFont === font.id
                      return (
                        <button
                          key={font.id}
                          onClick={() => setAppFont(font.id)}
                          title={font.name}
                          className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                            active
                              ? 'bg-accent/15 border-[var(--accent)]'
                              : 'border-[var(--border)] hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          {/* Specimen renders in the stack it selects, so the
                              list previews itself without applying anything. */}
                          <span
                            className={`block text-base leading-tight truncate ${active ? 'text-accent' : 'text-text-primary'}`}
                            style={{ fontFamily: font.stack }}
                          >
                            Ag
                          </span>
                          <span className={`block text-[11px] mt-0.5 truncate ${active ? 'text-accent' : 'text-text-muted'}`}>
                            {font.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#e11d48' }}>
                      <Type size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Lyrics font</span>
                      <p className="text-text-muted text-[11px]">Used only in the lyric panels, so lyrics can differ from the rest of the app</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-[34px]">
                    {FONTS.map((font) => {
                      const active = lyricsFont === font.id
                      return (
                        <button
                          key={font.id}
                          onClick={() => setLyricsFont(font.id)}
                          title={font.name}
                          className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                            active
                              ? 'bg-accent/15 border-[var(--accent)]'
                              : 'border-[var(--border)] hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          <span
                            className={`block text-base leading-tight truncate ${active ? 'text-accent' : 'text-text-primary'}`}
                            style={{ fontFamily: font.stack }}
                          >
                            Ag
                          </span>
                          <span className={`block text-[11px] mt-0.5 truncate ${active ? 'text-accent' : 'text-text-muted'}`}>
                            {font.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#ca8a04' }}>
                      <Type size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">App text size</span>
                      <p className="text-text-muted text-[11px]">Scales text across the whole app</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                    {APP_TEXT_SIZES.map(({ label, value }) => {
                      const active = appTextScale === value
                      return (
                        <button
                          key={value}
                          onClick={() => setAppTextScale(value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-accent/15 text-accent border-[var(--accent)]'
                              : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#db2777' }}>
                      <FileText size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Lyrics text size</span>
                      <p className="text-text-muted text-[11px]">Synced and plain lyrics everywhere — WRLD tab, now playing, mini player</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                    {LYRIC_TEXT_SIZES.map(({ label, value }) => {
                      const active = lyricsScale === value
                      return (
                        <button
                          key={value}
                          onClick={() => setLyricsScale(value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-accent/15 text-accent border-[var(--accent)]'
                              : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#0ea5e9' }}>
                      <AlignCenter size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Lyrics alignment</span>
                      <p className="text-text-muted text-[11px]">How lyric lines line up</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                    {([
                      { id: 'left' as const, label: 'Left', icon: AlignLeft },
                      { id: 'center' as const, label: 'Center', icon: AlignCenter },
                    ]).map(({ id, label, icon: AlignIcon }) => {
                      const active = lyricsAlign === id
                      return (
                        <button
                          key={id}
                          onClick={() => setLyricsAlign(id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-accent/15 text-accent border-[var(--accent)]'
                              : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          <AlignIcon size={14} className="shrink-0" />
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Row
                  icon={Eye}
                  iconColor="#64748b"
                  label="Blur inactive lyrics"
                  sub="Soften every synced line except the one playing"
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={lyricsBlur} onClick={() => setLyricsBlur(!lyricsBlur)} /></div>}
                >
                  {lyricsBlur && (
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={0.25} max={4} step={0.25}
                        value={lyricsBlurAmount}
                        onChange={(e) => setLyricsBlurAmount(parseFloat(e.target.value))}
                        className="w-20 accent-[var(--accent)]"
                      />
                      <span className="text-text-muted text-xs tabular-nums w-10 text-right">{lyricsBlurAmount}×</span>
                    </div>
                  )}
                </Row>
                <Row
                  icon={BookOpen}
                  iconColor="#0891b2"
                  label="Full era names"
                  sub='Show eras spelled out ("WRLD On Drugs") instead of abbreviated ("WOD")'
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={fullEraNames} onClick={() => setFullEraNames(!fullEraNames)} /></div>}
                />
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#9333ea' }}>
                      <Palette size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Lyric colors</span>
                      <p className="text-text-muted text-[11px]">Color the line being sung and the ones that aren't — WRLD tab, now playing, mini player</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5 pl-[34px]">
                    <LyricColorRow
                      label="Current line"
                      presets={LYRIC_ACTIVE_PRESETS}
                      value={lyricsColorActive}
                      fallback="#ffffff"
                      onChange={setLyricsColorActive}
                    />
                    <LyricColorRow
                      label="Other lines"
                      presets={LYRIC_INACTIVE_PRESETS}
                      value={lyricsColorInactive}
                      fallback="#9ca3af"
                      onChange={setLyricsColorInactive}
                    />
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#0d9488' }}>
                      <PanelLeft size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Navigation position</span>
                      <p className="text-text-muted text-[11px]">Where the nav menu sits on desktop — phones keep the bottom tabs</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                    {NAV_POSITIONS.map(({ id, label, icon: PosIcon }) => {
                      const active = sidebarPosition === id
                      return (
                        <button
                          key={id}
                          onClick={() => setSidebarPosition(id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-accent/15 text-accent border-[var(--accent)]'
                              : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                          }`}
                        >
                          <PosIcon size={14} className="shrink-0" />
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {isElectron && (
                  <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#f59e0b' }}>
                        <Menu size={13} className="text-white" strokeWidth={2.25} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-text-primary text-sm">App menu button</span>
                        <p className="text-text-muted text-[11px]">Where the File / Edit / View… menu opens from</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pl-[34px]">
                      {APP_MENU_POSITIONS.map(({ id, label, icon: MenuIcon }) => {
                        const active = appMenuPosition === id
                        return (
                          <button
                            key={id}
                            onClick={() => setAppMenuPosition(id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-accent/15 text-accent border-[var(--accent)]'
                                : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                            }`}
                          >
                            <MenuIcon size={14} className="shrink-0" />
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#6366f1' }}>
                      <ListOrdered size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-text-primary text-sm">Menu items</span>
                      <p className="text-text-muted text-[11px]">Drag to reorder · tap the eye to show or hide a tab</p>
                    </div>
                    {!navIsDefault && (
                      <button
                        onClick={resetNav}
                        title="Restore the default menu items and order"
                        className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors shrink-0"
                      >
                        <RotateCcw size={11} /> Reset
                      </button>
                    )}
                  </div>
                  <div className="pl-[34px] space-y-1.5">
                    {navRows.map((item, idx) => {
                      const shown = isNavItemVisible(item, navVisibility, isElectron)
                      return (
                        <div
                          key={item.view}
                          draggable
                          onDragStart={(e) => { setNavDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setNavOverIdx(idx) }}
                          onDrop={(e) => { e.preventDefault(); if (navDragIdx !== null) moveNavItem(navDragIdx, idx); setNavDragIdx(null); setNavOverIdx(null) }}
                          onDragEnd={() => { setNavDragIdx(null); setNavOverIdx(null) }}
                          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                            navDragIdx === idx
                              ? 'opacity-50 border-[var(--accent)] bg-[var(--surface-overlay)]'
                              : navOverIdx === idx
                                ? 'border-[var(--accent)] bg-accent/10'
                                : 'border-[var(--border)] bg-[var(--surface-overlay)]'
                          }`}
                        >
                          <GripVertical size={14} className="text-text-muted shrink-0" />
                          <span className={`w-6 h-6 shrink-0 flex items-center justify-center transition-opacity ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{item.icon}</span>
                          <span className={`text-sm truncate transition-colors ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{item.label}</span>
                          <button
                            onClick={() => setNavItemVisible(item.view, !shown)}
                            title={shown ? 'Hide from menu' : 'Add to menu'}
                            className="ml-auto shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                          >
                            {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#0ea5e9' }}>
                      <Home size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-text-primary text-sm">Home screen</span>
                      <p className="text-text-muted text-[11px]">Show or hide sections of the Home dashboard</p>
                    </div>
                  </div>
                  <div className="pl-[34px] space-y-1.5">
                    {HOME_SECTIONS.filter((section) => !section.staffOnly || hasChatAccess(account)).map((section) => {
                      const shown = isHomeSectionVisible(section.id, homeSectionVisibility)
                      return (
                        <div key={section.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-overlay)]">
                          <span className={`w-6 h-6 shrink-0 flex items-center justify-center transition-opacity ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{section.icon}</span>
                          <span className={`text-sm truncate transition-colors ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{section.label}</span>
                          <button
                            onClick={() => setHomeSectionVisible(section.id, !shown)}
                            title={shown ? 'Hide from Home' : 'Show on Home'}
                            className="ml-auto shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                          >
                            {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* Editor/admin-only tabs on the mobile bottom bar (Albums, and
                    the Editor/Admin profile tab). They aren't part of the
                    NAV_ITEMS registry above (which drives the desktop side
                    menu) — desktop reaches those views via the profile avatar /
                    "Edit albums" button — so they get their own toggle here,
                    shown only to editors/admins on the web build where the
                    bottom bar exists. Reuses the shared navVisibility map. */}
                {!isElectron && showStaffProfile(account) && (
                  <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#f59e0b' }}>
                        <ShieldCheck size={13} className="text-white" strokeWidth={2.25} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-text-primary text-sm">Staff tabs (mobile)</span>
                        <p className="text-text-muted text-[11px]">Show or hide staff tabs in the mobile bottom bar</p>
                      </div>
                    </div>
                    <div className="pl-[34px] space-y-1.5">
                      {([
                        // Albums stays editor/admin-only; the profile tab keys
                        // off the same helpers BottomNav routes with, so the
                        // toggle can't end up pointing at a different view than
                        // the tab it's meant to hide.
                        ...((account?.is_editor || account?.is_administrator)
                          ? [{ view: 'albums-admin' as ViewType, label: 'Albums', icon: <Disc size={18} /> }]
                          : []),
                        { view: staffProfileView(account), label: staffProfileLabel(account), icon: <ShieldCheck size={18} /> },
                      ]).map((item) => {
                        const shown = navVisibility[item.view] ?? true
                        return (
                          <div key={item.view} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-overlay)]">
                            <span className={`w-6 h-6 shrink-0 flex items-center justify-center transition-opacity ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{item.icon}</span>
                            <span className={`text-sm truncate transition-colors ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{item.label}</span>
                            <button
                              onClick={() => setNavItemVisible(item.view, !shown)}
                              title={shown ? 'Hide from menu' : 'Show in menu'}
                              className="ml-auto shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                            >
                              {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {ctrlRows.length > 0 && (
                  <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#8b5cf6' }}>
                        <ListOrdered size={13} className="text-white" strokeWidth={2.25} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-text-primary text-sm">Menu controls</span>
                        <p className="text-text-muted text-[11px]">The buttons at the foot of the menu — reorder or hide them</p>
                      </div>
                      {!ctrlIsDefault && (
                        <button
                          onClick={resetControls}
                          title="Restore the default controls and order"
                          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors shrink-0"
                        >
                          <RotateCcw size={11} /> Reset
                        </button>
                      )}
                    </div>
                    <div className="pl-[34px] space-y-1.5">
                      {ctrlRows.map((ctrl, idx) => {
                        const shown = navControlVisibility[ctrl.id] ?? true
                        return (
                          <div
                            key={ctrl.id}
                            draggable
                            onDragStart={(e) => { setCtrlDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setCtrlOverIdx(idx) }}
                            onDrop={(e) => { e.preventDefault(); if (ctrlDragIdx !== null) moveNavControl(ctrlDragIdx, idx); setCtrlDragIdx(null); setCtrlOverIdx(null) }}
                            onDragEnd={() => { setCtrlDragIdx(null); setCtrlOverIdx(null) }}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                              ctrlDragIdx === idx
                                ? 'opacity-50 border-[var(--accent)] bg-[var(--surface-overlay)]'
                                : ctrlOverIdx === idx
                                  ? 'border-[var(--accent)] bg-accent/10'
                                  : 'border-[var(--border)] bg-[var(--surface-overlay)]'
                            }`}
                          >
                            <GripVertical size={14} className="text-text-muted shrink-0" />
                            <span className={`w-6 h-6 shrink-0 flex items-center justify-center transition-opacity ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{ctrl.icon}</span>
                            <span className={`text-sm truncate transition-colors ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{ctrl.label}</span>
                            <button
                              onClick={() => setNavControlVisible(ctrl.id, !shown)}
                              title={shown ? 'Hide from menu' : 'Show in menu'}
                              className="ml-auto shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                            >
                              {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Playback ── */}
            {!settingsQueryTrimmed && tab === 'playback' && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">Playback</h3>
                {devices.length > 0 && (
                  <Row icon={Volume2} iconColor="#2563eb" label="Audio output">
                    <select
                      value={audioOutput}
                      onChange={(e) => setAudioOutput(e.target.value)}
                      className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] max-w-[180px] truncate"
                    >
                      <option value="">Default</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 6)}`}</option>
                      ))}
                    </select>
                  </Row>
                )}
                {/* Playback speed moved to the player bar's Equalizer panel */}
                <Row icon={AlignLeft} iconColor="#0891b2" label="Lyrics sync">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setLyricsOffset(Math.round((lyricsOffset - 0.1) * 10) / 10)}
                      title="Shift lyrics earlier"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="text-text-muted text-xs tabular-nums w-12 text-center">
                      {lyricsOffset > 0 ? '+' : ''}{lyricsOffset.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => setLyricsOffset(Math.round((lyricsOffset + 0.1) * 10) / 10)}
                      title="Shift lyrics later"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Plus size={13} />
                    </button>
                    {lyricsOffset !== 0 && (
                      <button
                        onClick={() => setLyricsOffset(0)}
                        title="Reset to 0"
                        className="text-text-muted hover:text-text-primary text-xs transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </Row>
                <Row
                  icon={Zap}
                  iconColor="#7c3aed"
                  label="Crossfade"
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={crossfadeEnabled} onClick={() => setCrossfade(!crossfadeEnabled, crossfadeDuration)} /></div>}
                >
                  {crossfadeEnabled && (
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={1} max={12} step={1}
                        value={crossfadeDuration}
                        onChange={(e) => setCrossfade(true, parseInt(e.target.value))}
                        className="w-20 accent-[var(--accent)]"
                      />
                      <span className="text-text-muted text-xs tabular-nums w-10 text-right">{crossfadeDuration}s</span>
                    </div>
                  )}
                </Row>
                <Row
                  icon={Waves}
                  iconColor="#0ea5e9"
                  label="Smooth fade when pausing"
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={pauseFadeEnabled} onClick={() => setPauseFade(!pauseFadeEnabled)} /></div>}
                />
                <Row
                  icon={FileText}
                  iconColor="#059669"
                  label="Prefer OG version"
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={preferOgVersion} onClick={() => setPreferOgVersion(!preferOgVersion)} /></div>}
                />
                <Row
                  icon={Images}
                  iconColor="#d946ef"
                  label="Rotate suggested covers"
                  sub="Songs without a custom cover show a different cover from the API files each play"
                  labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={rotateSuggestedCovers} onClick={() => setRotateSuggestedCovers(!rotateSuggestedCovers)} /></div>}
                />
                <div className="py-2">
                  <EraCoversSection />
                </div>
                <Row icon={Clock} iconColor="#4f46e5" label="Sleep timer">
                  <div className="flex items-center gap-2">
                    {sleepTimerEnd ? (
                      <span className="text-accent text-xs font-medium">
                        {Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000))} min left
                      </span>
                    ) : (
                      <select
                        value={sleepMinutes}
                        onChange={(e) => setSleepMinutes(parseInt(e.target.value))}
                        className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
                      >
                        {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
                      </select>
                    )}
                    <button
                      onClick={toggleSleepTimer}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        sleepTimerEnd ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-accent/15 text-accent hover:bg-accent/25'
                      }`}
                    >
                      {sleepTimerEnd ? 'Cancel' : 'Start'}
                    </button>
                  </div>
                </Row>
                <Row
                  icon={CloudUpload}
                  iconColor="#d51007"
                  label="Last.fm scrobbling"
                  sub={
                    !lastfmConfigured() ? 'Unavailable — this build has no Last.fm API key'
                    : lastfmError ? lastfmError
                    : lastfmUser ? `Connected as ${lastfmUser}`
                    : lastfmWaiting ? 'Approve access on last.fm, then come back here'
                    : 'Send what you listen to, to your Last.fm profile'
                  }
                  labelExtra={lastfmUser
                    ? <div className="ml-2 translate-y-[3px]"><Toggle on={lastfmEnabled} onClick={() => setLastfmEnabled(!lastfmEnabled)} /></div>
                    : undefined}
                >
                  {lastfmConfigured() && (
                    lastfmUser ? (
                      <button
                        onClick={disconnectLastfm}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-red-500/15 text-red-400 hover:bg-red-500/25"
                      >
                        Disconnect
                      </button>
                    ) : lastfmWaiting ? (
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-text-muted" />
                        <button
                          onClick={stopLastfmPoll}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--surface-overlay)] text-text-secondary hover:text-text-primary border border-[var(--border)]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={connectLastfm}
                        disabled={lastfmBusy}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
                      >
                        Connect
                      </button>
                    )
                  )}
                </Row>
                <Row
                  icon={Server}
                  iconColor="#0ea5e9"
                  label="Distributed CDN downloads"
                  sub="Use the peer-to-peer CDN network for faster downloads when available. Turning this off always downloads from the origin server."
                >
                  <Toggle
                    on={cdnEnabled}
                    onClick={() => {
                      const next = !cdnEnabled
                      cdnService.setEnabled(next)
                      setCdnEnabled(next)
                    }}
                  />
                </Row>
              </div>
            )}

            {/* ── Shortcuts ── */}
            {!settingsQueryTrimmed && tab === 'shortcuts' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-text-primary text-lg font-bold">Keyboard Shortcuts</h3>
                  <button
                    onClick={() => { setRecording(null); resetHotkeyBindings(); resetGlobalHotkeyBindings() }}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2.5 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] shrink-0"
                    title="Restore every shortcut to its default"
                  >
                    <RotateCcw size={12} /> Reset to defaults
                  </button>
                </div>
                <p className="text-text-muted text-[11px] mb-3">
                  Click a shortcut, then press the keys. Esc cancels · Backspace clears. Shortcuts work while the app window is focused.
                </p>

                <Row icon={Clock} iconColor="#4f46e5" label="Skip amount" sub="How far skip-forward / skip-backward jump">
                  <select
                    value={hotkeySeekSeconds}
                    onChange={(e) => setHotkeySeekSeconds(parseInt(e.target.value))}
                    className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
                  >
                    {[5, 10, 15, 30, 60].map((s) => <option key={s} value={s}>{s} seconds</option>)}
                  </select>
                </Row>

                {isElectron && (
                  <Row
                    icon={Globe}
                    iconColor="#0ea5e9"
                    label="Global shortcuts"
                    sub="Also trigger the global-column shortcuts below when the app is in the background. Only shortcuts that use a modifier (Ctrl, Alt…) or a media key can be global — plain keys can't be captured system-wide."
                    labelExtra={<div className="ml-2 translate-y-[3px]"><Toggle on={globalHotkeysEnabled} onClick={() => setGlobalHotkeysEnabled(!globalHotkeysEnabled)} /></div>}
                  />
                )}

                {HOTKEY_CATEGORIES.map((category) => {
                  const actions = HOTKEY_ACTIONS.filter((a) => a.category === category && (isElectron || !a.electronOnly) && (developerMode || !a.devModeOnly))
                  if (actions.length === 0) return null
                  return (
                    <div key={category} className="mt-4 first:mt-3">
                      <div className="flex items-center gap-2 mb-1.5 px-0.5">
                        <p className="flex-1 min-w-0 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{category}</p>
                        {isElectron && (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="w-[134px] text-center text-[10px] font-semibold uppercase tracking-widest text-text-muted">In-app</span>
                            <span className="w-[134px] text-center text-[10px] font-semibold uppercase tracking-widest text-text-muted">Global</span>
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                        {actions.map((action) => {
                          const appBinding = effectiveBinding(action.id, hotkeyBindings)
                          const appTokens = comboTokens(appBinding)
                          const isRecordingApp = recording?.id === action.id && recording.column === 'app'
                          const globalBinding = effectiveGlobalBinding(action.id, globalHotkeyBindings)
                          const globalTokens = comboTokens(globalBinding)
                          const isRecordingGlobal = recording?.id === action.id && recording.column === 'global'
                          return (
                            <div key={action.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)]">
                              <span className="flex-1 min-w-0 text-text-secondary text-sm truncate">{action.label}</span>
                              {/* Each column is a fixed width (button + reserved clear-button slot,
                                  present or not) so the two columns line up with their headers and
                                  with each other row-to-row regardless of combo length. */}
                              <div className="shrink-0 flex items-center gap-1 w-[134px]">
                                <button
                                  onClick={() => setRecording(isRecordingApp ? null : { id: action.id, column: 'app' })}
                                  className={`flex-1 min-w-0 flex items-center justify-center flex-wrap gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                    isRecordingApp
                                      ? 'border-accent text-accent bg-accent/10 animate-pulse'
                                      : appTokens.length > 0
                                        ? 'border-[var(--border)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)]'
                                        : 'border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                                  }`}
                                  title={isRecordingApp ? 'Press a key combination…' : 'Click to change the in-app shortcut'}
                                >
                                  {isRecordingApp ? (
                                    'Press keys…'
                                  ) : appTokens.length > 0 ? (
                                    appTokens.map((t, i) => (
                                      <kbd key={i} className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-text-primary text-[10px] font-semibold leading-none border border-[var(--border)] tabular-nums">
                                        {t}
                                      </kbd>
                                    ))
                                  ) : (
                                    'Not set'
                                  )}
                                </button>
                                {appTokens.length > 0 && !isRecordingApp ? (
                                  <button
                                    onClick={() => { setHotkeyBinding(action.id, ''); if (isRecordingApp) setRecording(null) }}
                                    title="Clear the in-app shortcut"
                                    className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-[var(--surface-overlay)] transition-colors"
                                  >
                                    <X size={13} />
                                  </button>
                                ) : (
                                  <span className="shrink-0 w-[25px]" aria-hidden="true" />
                                )}
                              </div>
                              {isElectron && (
                                <div className="shrink-0 flex items-center gap-1 w-[134px]">
                                  <button
                                    onClick={() => setRecording(isRecordingGlobal ? null : { id: action.id, column: 'global' })}
                                    className={`flex-1 min-w-0 flex items-center justify-center flex-wrap gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                      isRecordingGlobal
                                        ? 'border-accent text-accent bg-accent/10 animate-pulse'
                                        : globalTokens.length > 0
                                          ? 'border-[var(--border)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)]'
                                          : 'border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                                    }`}
                                    title={isRecordingGlobal ? 'Press a key combination (needs a modifier or media key)…' : 'Click to change the global (OS-wide) shortcut'}
                                  >
                                    {isRecordingGlobal ? (
                                      'Press keys…'
                                    ) : globalTokens.length > 0 ? (
                                      globalTokens.map((t, i) => (
                                        <kbd key={i} className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-text-primary text-[10px] font-semibold leading-none border border-[var(--border)] tabular-nums">
                                          {t}
                                        </kbd>
                                      ))
                                    ) : (
                                      'Not set'
                                    )}
                                  </button>
                                  {globalTokens.length > 0 && !isRecordingGlobal ? (
                                    <button
                                      onClick={() => { setGlobalHotkeyBinding(action.id, ''); if (isRecordingGlobal) setRecording(null) }}
                                      title="Clear the global shortcut"
                                      className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-[var(--surface-overlay)] transition-colors"
                                    >
                                      <X size={13} />
                                    </button>
                                  ) : (
                                    <span className="shrink-0 w-[25px]" aria-hidden="true" />
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Library ── */}
            {!settingsQueryTrimmed && tab === 'library' && isElectron && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">Library Folders</h3>
                <div className="space-y-2 mb-3">
                  {libraryFolders.length === 0 && (
                    <p className="text-text-muted text-xs">No folders added yet.</p>
                  )}
                  {libraryFolders.map((folder) => (
                    <div key={folder} className="flex items-center gap-2 bg-[var(--surface-overlay)] rounded-lg px-3 py-2 border border-[var(--border)]">
                      <FolderOpen size={13} className="text-text-muted shrink-0" />
                      <span className="flex-1 text-text-primary text-xs truncate" title={folder}>{folder}</span>
                      <button
                        onClick={() => removeLibraryFolder(folder)}
                        className="text-text-muted hover:text-red-400 transition-colors text-xs px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { if (!el) return; const p = await el.pickFolder(); if (p) addLibraryFolder(p) }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                  >
                    <FolderPlus size={13} /> Add Folder
                  </button>
                  <button
                    onClick={() => scanLibrary()}
                    disabled={libraryScanning || libraryFolders.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
                  >
                    {libraryScanning ? <Loader2 size={13} className="animate-spin" /> : null}
                    {libraryScanning ? 'Scanning…' : 'Scan Now'}
                  </button>
                </div>
                {libraryLastScanned && (
                  <p className="text-text-muted text-[10px] mt-2">
                    Last scanned: {new Date(libraryLastScanned).toLocaleString()} · {libraryTracks.length} tracks
                  </p>
                )}
                <div className="flex items-center justify-between py-3 mt-2 border-t border-[var(--border)]">
                  <div>
                    <span className="text-text-primary text-sm block">Auto-refresh changed files</span>
                    <span className="text-text-muted text-xs">Reload tags automatically when a file changes on disk (e.g. edited externally)</span>
                  </div>
                  <Toggle on={libraryAutoRefresh} onClick={() => setLibraryAutoRefresh(!libraryAutoRefresh)} />
                </div>
              </div>
            )}

            {/* ── App ── */}
            {!settingsQueryTrimmed && tab === 'app' && isElectron && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">App</h3>
                <div className="py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#0891b2' }}>
                      <FolderOpen size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <span className="text-text-primary text-sm">Download folder</span>
                  </div>
                  <div className="flex items-center gap-2 pl-[34px]">
                    <span className="flex-1 text-text-muted text-xs truncate bg-[var(--surface-overlay)] rounded-lg px-3 py-2 border border-[var(--border)]" title={appSettings.downloadPath}>
                      {appSettings.downloadPath || 'Default Downloads folder'}
                    </span>
                    <button
                      onClick={pickDownloadFolder}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary transition-colors"
                    >
                      Change
                    </button>
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#7c3aed' }}>
                      <FolderOpen size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <span className="text-text-primary text-sm">Offline songs folder</span>
                  </div>
                  <div className="flex items-center gap-2 pl-[34px]">
                    <span className="flex-1 text-text-muted text-xs truncate bg-[var(--surface-overlay)] rounded-lg px-3 py-2 border border-[var(--border)]" title={appSettings.offlineLibraryPath}>
                      {appSettings.offlineLibraryPath || 'Default app data folder'}
                    </span>
                    <button
                      onClick={pickOfflineFolder}
                      disabled={movingOfflinePath}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {movingOfflinePath && <Loader2 size={12} className="animate-spin" />}
                      {movingOfflinePath ? 'Moving…' : 'Change'}
                    </button>
                  </div>
                  {offlinePathError && (
                    <p className="text-red-400 text-[10px] mt-1.5 pl-[34px]">{offlinePathError}</p>
                  )}
                </div>
                <Row
                  icon={DownloadCloud}
                  iconColor="#7c3aed"
                  label="Offline downloads"
                  sub={offlineStatsLoading ? 'Calculating…' : offlineStats ? `${offlineStats.count} file${offlineStats.count === 1 ? '' : 's'} · ${formatBytes(offlineStats.totalSize)}` : undefined}
                >
                  <button
                    onClick={loadOfflineStats}
                    disabled={offlineStatsLoading}
                    title="Refresh"
                    className="shrink-0 p-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={offlineStatsLoading ? 'animate-spin' : ''} />
                  </button>
                </Row>
                <Row icon={Monitor} iconColor="#6b7280" label="Start on">
                  <select
                    value={appSettings.startupView}
                    onChange={(e) => setSetting('startupView', e.target.value)}
                    className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
                  >
                    <option value="api-tracker">Tracker</option>
                    <option value="api-files">Files</option>
                    <option value="liked">Liked Songs</option>
                    <option value="playlists">Playlists</option>
                  </select>
                </Row>
                <Row icon={BellOff} iconColor="#16a34a" label="Auto-download updates">
                  <Toggle on={appSettings.autoDownload} onClick={() => setSetting('autoDownload', !appSettings.autoDownload)} />
                </Row>
                {isElectron && (
                  <Row
                    icon={FlaskConical}
                    iconColor="#f59e0b"
                    label="Beta updates"
                    sub={betaEnabled
                      ? 'This install receives beta (pre-release) builds'
                      : betaMsg ?? 'Have an access code? Enter it to receive beta builds'}
                  >
                    {betaEnabled ? (
                      <Toggle on={betaEnabled} onClick={leaveBeta} />
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="text"
                          value={betaCode}
                          onChange={(e) => { setBetaCode(e.target.value); setBetaMsg(null) }}
                          onKeyDown={(e) => { if (e.key === 'Enter') joinBeta() }}
                          placeholder="Access code"
                          className="w-32 bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] placeholder:text-text-muted"
                        />
                        <button
                          onClick={joinBeta}
                          disabled={!betaCode.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary transition-colors disabled:opacity-50"
                        >
                          Join
                        </button>
                      </div>
                    )}
                  </Row>
                )}
                <Row
                  icon={Minus}
                  iconColor="#6b7280"
                  label="Minimize to"
                  sub={{
                    taskbar: 'Minimize keeps the window on the taskbar',
                    tray: 'Minimize hides the window to the tray icon',
                  }[appSettings.minimizeTo]}
                >
                  <select
                    value={appSettings.minimizeTo}
                    onChange={(e) => setSetting('minimizeTo', e.target.value)}
                    className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
                  >
                    <option value="taskbar">Taskbar</option>
                    <option value="tray">Tray</option>
                  </select>
                </Row>
                <Row icon={Minus} iconColor="#6b7280" label="Minimize to tray on close">
                  <Toggle on={appSettings.minimizeToTray} onClick={() => setSetting('minimizeToTray', !appSettings.minimizeToTray)} />
                </Row>
                <Row
                  icon={AppWindow}
                  iconColor="#8b5cf6"
                  label="Show current song in the window title"
                  sub="The taskbar and alt-tab label follows what's playing instead of just saying Unreleased"
                >
                  <Toggle on={appSettings.windowTitleNowPlaying} onClick={() => setSetting('windowTitleNowPlaying', !appSettings.windowTitleNowPlaying)} />
                </Row>
                <Row
                  icon={AppWindow}
                  iconColor="#8b5cf6"
                  label="Remember window sizes"
                  sub="Reopen the main window and every pop-out at the size you last left it. Turning this off restores the default sizes."
                >
                  <Toggle on={appSettings.rememberWindowSizes} onClick={() => setSetting('rememberWindowSizes', !appSettings.rememberWindowSizes)} />
                </Row>
                <Row
                  icon={FlaskConical}
                  iconColor="#f59e0b"
                  label="Sandbox"
                  sub="Dock modals into a collapsible pill at the top of the window instead of a centered popup. Off restores the plain popup for every modal."
                >
                  <Toggle on={sandboxEnabled} onClick={() => setSandboxEnabled(!sandboxEnabled)} />
                </Row>
                <Row
                  icon={Minus}
                  iconColor="#6b7280"
                  label="Confirm before quitting while playing"
                  sub="Ask before closing the app if a song is still playing (not when it just hides to the tray)"
                >
                  <Toggle on={appSettings.confirmCloseWhilePlaying} onClick={() => setSetting('confirmCloseWhilePlaying', !appSettings.confirmCloseWhilePlaying)} />
                </Row>
                <Row
                  icon={Volume2}
                  iconColor="#0891b2"
                  label="Media key overlay"
                  sub="Show the Windows volume/media flyout when pressing media keys"
                >
                  <Toggle on={mediaOverlayEnabled} onClick={() => setMediaOverlayEnabled(!mediaOverlayEnabled)} />
                </Row>
                <div className="py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#8b5cf6' }}>
                      <AppWindow size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-text-primary text-sm">Pop-out windows</span>
                      <p className="text-text-muted text-[11px]">Open these in their own separate window. Turn one off to keep it inside the main window instead.</p>
                    </div>
                    <div className="ml-2 shrink-0">
                      <Toggle on={anyPopout} onClick={() => { const next = !anyPopout; POPOUT_KINDS.forEach((k) => setPopoutWindow(k.key, next)) }} />
                    </div>
                  </div>
                  {anyPopout && (
                    <div className="pl-[34px] mt-2.5 space-y-2.5">
                      {POPOUT_KINDS.map(({ key, label, sub }) => (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-text-secondary text-sm truncate">{label}</p>
                            {sub && <p className="text-text-muted text-[11px] truncate">{sub}</p>}
                          </div>
                          <Toggle on={popoutWindows[key]} onClick={() => setPopoutWindow(key, !popoutWindows[key])} />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Equalizer is the inverse of the group above — normally an
                      in-app popover, so this opts INTO a pop-out. Still gated
                      on the master toggle: with pop-outs off there's no
                      pop-out window for it to open into. */}
                  {anyPopout && (
                    <div className="pl-[34px] mt-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-text-secondary text-sm truncate">Equalizer as pop-out</p>
                        <p className="text-text-muted text-[11px] truncate">Open the equalizer in its own window instead of an in-app panel</p>
                      </div>
                      <Toggle on={popoutWindows.equalizer} onClick={() => setPopoutWindow('equalizer', !popoutWindows.equalizer)} />
                    </div>
                  )}
                </div>
                {popoutWindows.miniPlayer && (
                  <Row
                    icon={PictureInPicture2}
                    iconColor="#8b5cf6"
                    label="Solo mini player"
                    sub="Hide the main window and other pop-outs while the mini player is open — restored when it closes"
                  >
                    <Toggle on={appSettings.miniPlayerHidesWindows} onClick={() => setSetting('miniPlayerHidesWindows', !appSettings.miniPlayerHidesWindows)} />
                  </Row>
                )}
                <Row icon={MessageCircle} iconColor="#5865f2" label="Show Discord Status">
                  <Toggle on={appSettings.discordRpcEnabled} onClick={() => setSetting('discordRpcEnabled', !appSettings.discordRpcEnabled)} />
                </Row>
                {appSettings.discordRpcEnabled && (
                  <Row
                    icon={MessageCircle}
                    iconColor="#5865f2"
                    label="Status header"
                    sub={
                      appSettings.discordRpcLabel === 'song'
                        ? 'Shows "Listening to <song name>"'
                        : appSettings.discordRpcLabel === 'app'
                          ? 'Shows "Listening to Unreleased"'
                          : 'Shows "Listening to Juice WRLD"'
                    }
                  >
                    <select
                      value={appSettings.discordRpcLabel}
                      onChange={(e) => setSetting('discordRpcLabel', e.target.value)}
                      className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
                    >
                      <option value="artist">Artist</option>
                      <option value="song">Song name</option>
                      <option value="app">Unreleased</option>
                    </select>
                  </Row>
                )}
                <Row icon={Wrench} iconColor="#6b7280" label="Developer options" sub="Shows a Developer tab with cache & diagnostics tools">
                  <Toggle on={developerMode} onClick={() => setDeveloperMode(!developerMode)} />
                </Row>
              </div>
            )}

            {/* ── Developer ── */}
            {!settingsQueryTrimmed && tab === 'developer' && isElectron && developerMode && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-4">Developer</h3>
                <Row icon={FileText} iconColor="#6b7280" label="Diagnostic logs" sub="Opens the folder with current-run.log & previous-run.log">
                  <button
                    onClick={() => el?.openLogsFolder?.()}
                    className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors px-3 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] shrink-0"
                  >
                    <FolderOpen size={13} />
                    Open logs
                  </button>
                </Row>
                <Row icon={Trash2} iconColor="#dc2626" label="Clear cache" sub="Removes cached API responses and cover art used for offline browsing">
                  <button
                    onClick={() => {
                      // Cover art is cached by Chromium, not apiCache — clear both.
                      setCacheCleared(cacheClearAll())
                      el?.clearImageCache?.()
                      setTimeout(() => setCacheCleared(null), 3000)
                      // Playlists (and everything else backed by apiCache) were
                      // just wiped from cache but not from the in-memory store —
                      // without this, the UI keeps showing the stale list until
                      // the next natural refetch (e.g. app restart).
                      refreshPlaylists()
                    }}
                    className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors px-3 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] shrink-0"
                  >
                    <Trash2 size={13} />
                    {cacheCleared !== null ? `Cleared ${cacheCleared}` : 'Clear cache'}
                  </button>
                </Row>
                <Row icon={DownloadCloud} iconColor="#0ea5e9" label="Online installer" sub="Ships with the app — repairs or reinstalls even if the app won't launch">
                  <button
                    onClick={() => el?.openOnlineInstaller?.()}
                    className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors px-3 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] shrink-0"
                  >
                    <DownloadCloud size={13} />
                    Open
                  </button>
                </Row>
              </div>
            )}

            {/* ── Donor ── */}
            {!settingsQueryTrimmed && tab === 'donor' && account?.is_donor && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-1">Donor</h3>
                <p className="text-text-muted text-xs mb-4 leading-relaxed max-w-md">
                  Thanks for donating — this unlocks 1&nbsp;GB of personal cloud storage for audio and
                  images, playable and shareable from anywhere.
                </p>
                <DonorFiles />
                <h4 className="text-text-primary text-sm font-bold mt-6 mb-1">My CDN nodes</h4>
                <p className="text-text-muted text-xs mb-2 leading-relaxed max-w-md">
                  Nodes you've linked from the CDN node app, helping serve the library over P2P.
                </p>
                <MyCdnNodes />
              </div>
            )}

            {/* ── Feedback ── */}
            {!settingsQueryTrimmed && tab === 'feedback' && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-1">Feedback</h3>
                <p className="text-text-muted text-xs mb-4 leading-relaxed max-w-md">
                  Found a bug or have an idea? Let us know. To report a problem with a
                  specific song's info or lyrics, open that song and choose “Report”.
                </p>
                <div className="max-w-md">
                  <ReportForm mode={{ kind: 'feedback' }} />
                </div>
              </div>
            )}

            {/* ── About ── */}
            {!settingsQueryTrimmed && tab === 'about' && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-3">About</h3>
                <p className="text-text-muted text-xs mb-3">
                  unreleased v{APP_VERSION} &mdash; powered by{' '}
                  <a href="https://juicewrldapi.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    juicewrldapi.com
                  </a>
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <a
                    href="https://github.com/Juice-WRLD-API/Unreleased"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-3 py-1.5 rounded-full bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)]"
                  >
                    <Github size={13} />
                    GitHub
                  </a>
                  <a
                    href="https://discord.gg/jwa"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-3 py-1.5 rounded-full bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)]"
                  >
                    <MessageCircle size={13} />
                    Discord
                  </a>
                  <a
                    href="https://juicewrldapi.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-3 py-1.5 rounded-full bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)]"
                  >
                    <Globe size={13} />
                    API
                  </a>
                </div>

                {(!account || (!account.is_editor && !account.is_administrator)) && (
                  <button
                    onClick={() => openMainView('editor')}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-accent/10 hover:bg-accent/15 border border-accent/25 text-accent text-sm font-medium transition-colors mt-2"
                  >
                    <PenLine size={15} />
                    Become an Editor
                  </button>
                )}
                {CONTRIBUTOR_ENABLED && (!account || (!account.is_contributor && !account.is_administrator)) && (
                  <button
                    onClick={() => openMainView('contributor')}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/15 border border-sky-500/25 text-sky-400 text-sm font-medium transition-colors mt-2"
                  >
                    <FolderOpen size={15} />
                    Become a Contributor
                  </button>
                )}
                {account && (
                  <div className="mt-2 rounded-xl border border-[var(--border)] overflow-hidden">
                    <button
                      onClick={() => setShowToken(v => !v)}
                      className="flex items-center gap-2 w-full px-3 py-2.5 bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] text-text-secondary text-sm font-medium transition-colors"
                    >
                      <KeyRound size={15} />
                      <span className="flex-1 text-left">Auth Token</span>
                      {showToken ? <EyeOff size={14} className="text-text-muted" /> : <Eye size={14} className="text-text-muted" />}
                    </button>
                    {showToken && (
                      <button
                        onClick={() => {
                          const t = getToken()
                          if (t) {
                            navigator.clipboard.writeText(t)
                            setTokenCopied(true)
                            setTimeout(() => setTokenCopied(false), 2000)
                          }
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2.5 bg-[var(--surface)] hover:bg-[var(--surface-raised)] transition-colors border-t border-[var(--border)] group"
                        title="Click to copy"
                      >
                        <code className="flex-1 text-left text-[10px] font-mono text-text-muted truncate">
                          {getToken() ?? '&#8212;'}
                        </code>
                        <span className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-medium transition-colors ${tokenCopied ? 'text-emerald-500' : 'text-text-muted group-hover:text-text-primary'}`}>
                          {tokenCopied ? 'Copied!' : <><Copy size={11} /> Copy</>}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={() => openMainView('docs')}
                  className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary text-sm font-medium transition-colors mt-2"
                >
                  <BookOpen size={15} />
                  API Docs
                </button>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => openLegal('terms')}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary text-sm font-medium transition-colors"
                  >
                    <ScrollText size={15} />
                    Terms of Service
                  </button>
                  <button
                    onClick={() => openLegal('privacy')}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary text-sm font-medium transition-colors"
                  >
                    <ShieldCheck size={15} />
                    Privacy Policy
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                  {([
                    {
                      q: 'What is this?',
                      a: "The Juice WRLD API is a RESTful API providing access to a comprehensive database of Juice WRLD songs, albums, and eras. Whether you are a fan, developer, or researcher, this API offers the tools you need to dive deep into Juice WRLD music.",
                      link: { text: 'Check out the documentation to get started.' },
                    },
                    {
                      q: 'Who are you?',
                      a: "We are passionate Juice WRLD fans and developers who wanted to create an accessible platform for others to explore and analyze Juice WRLD musical legacy. Shoutout to hypixelforums on Discord for the bug feedback.",
                    },
                    {
                      q: 'Why did you build this?',
                      a: "We built this API to celebrate Juice WRLD legacy by making his music and history more accessible to fans and developers alike.",
                    },
                    {
                      q: 'Technical stuff?',
                      a: 'The Juice WRLD API is built with Django and PostgreSQL. This player (unreleased) is built with React, TypeScript, Vite, and Tailwind CSS.',
                    },
                  ] as { q: string; a: string; link?: { text: string } }[]).map(({ q, a, link }) => (
                    <div key={q}>
                      <button
                        onClick={() => setOpenAbout(openAbout === q ? null : q)}
                        className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-[var(--surface-raised)] transition-colors text-left"
                      >
                        <span className="text-text-secondary text-xs font-medium">{q}</span>
                        <ChevronDown size={12} className={`text-text-muted transition-transform duration-150 shrink-0 ml-2 ${openAbout === q ? 'rotate-180' : ''}`} />
                      </button>
                      {openAbout === q && (
                        <div className="px-3 pb-3 pt-0">
                          <p className="text-text-muted text-xs leading-relaxed">{a}</p>
                          {link && (
                            <button
                              onClick={() => openMainView('docs')}
                              className="mt-1.5 inline-block text-xs text-accent hover:underline">
                              {link.text}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {legalDoc && <LegalModal initialDoc={legalDoc} onClose={() => setLegalDoc(null)} />}
      </>
      )}
    </ModalOverlay>
  )
}
