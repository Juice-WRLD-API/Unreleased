import { useState, useEffect, useRef, ReactNode, ElementType, CSSProperties } from 'react'
import {
  X, Brush, Palette, Volume2, Zap, Clock, Info, Github, MessageCircle,
  PenLine, BookOpen, Copy, Eye, EyeOff, ChevronDown, KeyRound, Globe, RefreshCw, DownloadCloud,
  FolderOpen, Monitor, BellOff, Minus, Loader2, Plus, AlignLeft, FileText, Trash2, Wrench, FlaskConical,
  PanelLeft, PanelRight, PanelTop, PanelBottom, Waves, Keyboard, RotateCcw, AppWindow, PictureInPicture2, Minimize2,
  ListOrdered, GripVertical, CloudUpload, Type, AlignCenter, Menu, Pencil, Upload,
  ScrollText, ShieldCheck, Disc, Images, Search, LogOut, Bug, House,
} from 'lucide-react'
import { useStore, useStorePick, type SidebarPosition } from '../store/useStore'
import { HOTKEY_ACTIONS, HOTKEY_CATEGORIES, effectiveBinding, comboTokens, eventToCombo } from '../lib/hotkeys'
import { SKINS, getSkin, createCustomSkin, parseSkinFile } from '../lib/skins'
import SkinEditorModal from './SkinEditorModal'
import { FONTS } from '../lib/fonts'
import { orderedNavItems, isNavItemVisible, DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY, orderedNavControls, isNavControlAvailable, DEFAULT_NAV_CONTROL_ORDER, DEFAULT_NAV_CONTROL_VISIBILITY } from '../lib/navItems'
import { HOME_SECTIONS, DEFAULT_HOME_SECTION_VISIBILITY, isHomeSectionVisible } from '../lib/homeSections'
import { getToken, CONTRIBUTOR_ENABLED } from '../lib/userApi'
import { APP_VERSION, COMMIT_HASH } from '../lib/appVersion'
import {
  lastfmConfigured, lastfmGetAuthToken, lastfmAuthUrl, lastfmTryGetSession, lastfmDisconnect,
} from '../lib/lastfm'
import { cacheClearAll } from '../lib/apiCache'
import { formatBytes } from '../lib/format'
import type { ViewType } from '../types'
import ReportForm from './ReportForm'
import LegalModal, { type LegalDoc } from './LegalModal'
import { useSandboxStore } from './Modal'
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

type Tab = 'appearance' | 'playback' | 'shortcuts' | 'feedback' | 'about'

// A hand-maintained index of every setting row, used by the search bar to
// jump straight to the tab a match lives on. `devOnly` mirrors the same gate
// the rows themselves are rendered behind, so a search never offers to jump
// somewhere the tab doesn't actually exist.
const SETTINGS_SEARCH_INDEX: { tab: Tab; label: string; sub?: string; devOnly?: boolean }[] = [
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
  { tab: 'appearance', label: 'Sandbox', sub: 'Dock modals into a collapsible pill instead of a centered popup' },
  { tab: 'appearance', label: 'Navigation position', sub: 'Where the nav menu sits - left, right, top, bottom' },
  { tab: 'appearance', label: 'Menu items', sub: 'Reorder or hide sidebar tabs' },
  { tab: 'appearance', label: 'Menu controls', sub: 'Reorder or hide the buttons at the foot of the menu' },
  { tab: 'appearance', label: 'Home screen', sub: 'Choose which sections show on the Home tab' },
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
  // Shortcuts
  { tab: 'shortcuts', label: 'Skip amount', sub: 'How far skip-forward / skip-backward jump' },
  { tab: 'shortcuts', label: 'Keyboard shortcuts', sub: 'Rebind any in-app or global hotkey' },
  // Feedback / About
  { tab: 'feedback', label: 'Feedback', sub: 'Report a bug or share an idea' },
  { tab: 'feedback', label: 'Auto-report app errors', sub: 'Automatically send a crash report when the app hits an unexpected error' },
  { tab: 'about', label: 'About', sub: 'Version, GitHub, Discord, API links' },
  { tab: 'about', label: 'Auth Token', sub: 'View and copy your account token' },
  { tab: 'about', label: 'Log out' },
  { tab: 'about', label: 'API Docs' },
  { tab: 'about', label: 'GitHub' },
  { tab: 'about', label: 'Discord' },
  { tab: 'about', label: 'Terms of Service' },
  { tab: 'about', label: 'Privacy Policy' },
  { tab: 'about', label: 'Become an Editor' },
  { tab: 'about', label: 'Become a Contributor' },
  { tab: 'about', label: 'FAQ', sub: 'What is this? Who are you? Why did you build this? Technical stuff?' },
]

// ── Flat row primitive - no card/box, just an icon + label on the left and
// a control on the right, separated by a hairline. Used inside each tab's
// content pane (macOS System Settings' detail-pane idiom, not the boxed
// inset-grouped list). The icon sits in a colored badge (iOS Settings-style)
// - a fixed color + white icon reads correctly in both themes, unlike the
// plain `text-muted` icon this replaced, which nearly disappeared in light
// mode. ──

function Row({ icon: Icon, iconColor, label, sub, labelExtra, children }: {
  icon: ElementType
  iconColor: string
  label: string
  sub?: string
  // Rendered immediately after the label, on the left - for controls that
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
// "Auto" (value === null) meaning "leave it to the surface's own colors" -
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
          block centering trick) instead of a manual top offset - a fixed
          `top-0.5` still relied on the button having zero padding/border to
          land exactly right, and browsers don't zero those out on <button>
          by default. auto-margin centering can't drift regardless of the
          button's own box model. No shadow on the knob either - its default
          downward offset (0 1px 3px) reads as visual weight sitting low,
          making it look off-center even when it's geometrically centered. */}
      <span className={`absolute inset-y-0 my-auto w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

export default function Settings(): JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [openAbout, setOpenAbout] = useState<string | null>(null)
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)
  // Re-opening while already docked (sandbox notch collapsed) wouldn't
  // otherwise re-expand it - see the matching comment on setShowSettings.
  const openLegal = (doc: LegalDoc): void => { useSandboxStore.getState().expand(); setLegalDoc(doc) }
  const sandboxEnabled = useSandboxStore((s) => s.sandboxEnabled)
  const setSandboxEnabled = useSandboxStore((s) => s.setSandboxEnabled)
  const {
    setShowSettings, setActiveView,
    account, logoutAccount,
    theme, setTheme,
    customSkins, saveCustomSkin, deleteCustomSkin,
    accentColor, setAccentColor,
    settingsTab, setSettingsTab,
    sidebarPosition, setSidebarPosition,
    navOrder, setNavOrder,
    navVisibility, setNavItemVisible,
    navControlOrder, setNavControlOrder,
    navControlVisibility, setNavControlVisible,
    homeSectionVisibility, setHomeSectionVisible,
    audioOutput, setAudioOutput,
    crossfadeEnabled, crossfadeDuration, setCrossfade,
    pauseFadeEnabled, setPauseFade,
    preferOgVersion, setPreferOgVersion,
    rotateSuggestedCovers, setRotateSuggestedCovers,
    mediaOverlayEnabled, setMediaOverlayEnabled,
    lyricsOffset, setLyricsOffset,
    sleepTimerEnd, setSleepTimer,
    hotkeyBindings, setHotkeyBinding, resetHotkeyBindings, hotkeySeekSeconds, setHotkeySeekSeconds,
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
    playlistHeroEnabledDark, playlistHeroEnabledLight, setPlaylistHeroEnabled,
    refreshPlaylists, fullEraNames, setFullEraNames,
    autoReportErrors, setAutoReportErrors,
    uploads,
  } = useStorePick('setShowSettings', 'setActiveView', 'account', 'logoutAccount', 'theme', 'setTheme', 'customSkins', 'saveCustomSkin', 'deleteCustomSkin', 'accentColor', 'setAccentColor', 'settingsTab', 'setSettingsTab', 'sidebarPosition', 'setSidebarPosition', 'navOrder', 'setNavOrder', 'navVisibility', 'setNavItemVisible', 'navControlOrder', 'setNavControlOrder', 'navControlVisibility', 'setNavControlVisible', 'homeSectionVisibility', 'setHomeSectionVisible', 'audioOutput', 'setAudioOutput', 'crossfadeEnabled', 'crossfadeDuration', 'setCrossfade', 'pauseFadeEnabled', 'setPauseFade', 'preferOgVersion', 'setPreferOgVersion', 'rotateSuggestedCovers', 'setRotateSuggestedCovers', 'mediaOverlayEnabled', 'setMediaOverlayEnabled', 'lyricsOffset', 'setLyricsOffset', 'sleepTimerEnd', 'setSleepTimer', 'hotkeyBindings', 'setHotkeyBinding', 'resetHotkeyBindings', 'hotkeySeekSeconds', 'setHotkeySeekSeconds', 'developerMode', 'setDeveloperMode', 'lastfmUser', 'setLastfmUser', 'lastfmEnabled', 'setLastfmEnabled', 'appTextScale', 'setAppTextScale', 'lyricsScale', 'setLyricsScale', 'lyricsAlign', 'setLyricsAlign', 'lyricsBlur', 'setLyricsBlur', 'lyricsBlurAmount', 'setLyricsBlurAmount', 'lyricsColorActive', 'setLyricsColorActive', 'lyricsColorInactive', 'setLyricsColorInactive', 'appFont', 'setAppFont', 'lyricsFont', 'setLyricsFont', 'gradientsEnabled', 'setGradientsEnabled', 'surfaceGradientsEnabled', 'setSurfaceGradientsEnabled', 'wrldThemeBackground', 'setWrldThemeBackground', 'playlistHeroEnabledDark', 'playlistHeroEnabledLight', 'setPlaylistHeroEnabled', 'refreshPlaylists', 'fullEraNames', 'setFullEraNames', 'autoReportErrors', 'setAutoReportErrors', 'uploads')

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [customAccent, setCustomAccent] = useState(accentColor)
  // Drag-to-reorder state for the "Menu order" list - indices into the visible
  // nav list (see shownNav below). null = nothing being dragged / hovered.
  const [navDragIdx, setNavDragIdx] = useState<number | null>(null)
  const [navOverIdx, setNavOverIdx] = useState<number | null>(null)
  // Same, for the separate "Menu controls" list below.
  const [ctrlDragIdx, setCtrlDragIdx] = useState<number | null>(null)
  const [ctrlOverIdx, setCtrlOverIdx] = useState<number | null>(null)
  const [sleepMinutes, setSleepMinutes] = useState(30)
  const accentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Custom skins - which one the editor modal is open on (null = closed), the
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
  // ── Menu items (Appearance) ──────────────────────────────────────────────
  // Every nav item in saved order - visible ones and the toggled-off extras
  // alike - so the list is where you both reorder and show/hide.
  // Pinned items (alwaysVisible) are listed too - they reorder like any other
  // row - but they render without an eye, since isNavItemVisible short-circuits
  // on them and a toggle there would silently do nothing.
  const navRows = orderedNavItems(navOrder)
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
  const homeIsDefault = HOME_SECTIONS.every((s) => isHomeSectionVisible(s.id, homeSectionVisibility) === (DEFAULT_HOME_SECTION_VISIBILITY[s.id] ?? true))
  const resetHome = (): void => {
    for (const s of HOME_SECTIONS) {
      const def = DEFAULT_HOME_SECTION_VISIBILITY[s.id] ?? true
      if (isHomeSectionVisible(s.id, homeSectionVisibility) !== def) setHomeSectionVisible(s.id, def)
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

  // ── Menu controls - the foot-of-menu buttons (Profile, Uploads, Diagnostics,
  // Download, Settings). Same reorder/hide model, filtered to the controls
  // that actually apply to this session (account state, platform, dev mode).
  const controlCtx = { account: !!account, isElectron: false, developerMode, hasUploads: uploads.length > 0 }
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

  const closeSettings = (): void => setShowSettings(false)
  // setActiveView alone leaves Settings now that it's a real page in the same
  // slot as every other view - no separate close step, and no extra history
  // entry from one.
  const openMainView = (view: ViewType): void => setActiveView(view)

  // ── Last.fm connect flow (desktop token auth): fetch a token, send the user
  // to last.fm to approve it, then poll getSession until approval lands (it
  // returns null while the token is still unapproved). window.open reaches the
  // system browser in every context - the Electron windows' window-open
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
        // Tokens live ~60 minutes but nobody waits that long - give up well before.
        if (Date.now() - startedAt > 5 * 60_000) {
          stopLastfmPoll()
          setLastfmError('Authorization timed out - try again.')
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
  const [recording, setRecording] = useState<{ id: string } | null>(null)
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
        setHotkeyBinding(recording.id, '')
        setRecording(null)
        return
      }
      const combo = eventToCombo(e)
      if (!combo) return // modifier held on its own - keep waiting for a real key
      setHotkeyBinding(recording.id, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setHotkeyBinding])

  const [tab, setTab] = useState<Tab>((settingsTab as Tab) ?? 'appearance')
  const tabs: { id: Tab; label: string; icon: ElementType }[] = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'playback', label: 'Playback', icon: Volume2 },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'feedback', label: 'Feedback', icon: MessageCircle },
    { id: 'about', label: 'About', icon: Info },
  ]

  // ── Settings search - a flat filter over SETTINGS_SEARCH_INDEX rather than
  // per-tab content, since matches can live on a tab you're not currently
  // viewing. Gated the same way the rows themselves are (dev mode) so a
  // result never points at a tab that doesn't exist in this build.
  const [settingsQuery, setSettingsQuery] = useState('')
  const settingsQueryTrimmed = settingsQuery.trim().toLowerCase()
  const searchResults = settingsQueryTrimmed
    ? SETTINGS_SEARCH_INDEX.filter((r) =>
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

  const toggleSleepTimer = (): void => {
    if (sleepTimerEnd) setSleepTimer(null)
    else setSleepTimer(Date.now() + sleepMinutes * 60 * 1000)
  }

  return (
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0 select-none">
          <div className="flex items-center gap-2" >
            <h2 className="text-text-primary font-black text-xl tracking-tight">Settings</h2>
          </div>
          <div className="flex items-center gap-3" >
            <button onClick={closeSettings} title="Back" className="text-text-muted hover:text-text-primary transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search - a flat filter over every setting row (see
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

        {/* Mobile tab bar - the sidebar collapses below sm, so categories
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

        {/* Body - sidebar category list + flat content pane, mirroring
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
                      <p className="text-text-muted text-[11px]">Skins with a signature color also set the accent - or build your own below</p>
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
                                player bar with the skin's accent - a live swatch of
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
                                      // Dynamic skin has no fixed accent - a color wheel
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
                  label="App gradients"
                  sub="Accent-tinted gradients behind the app and sidebar"
                >
                  <Toggle on={gradientsEnabled} onClick={() => setGradientsEnabled(!gradientsEnabled)} />
                </Row>
                <Row
                  icon={Waves}
                  iconColor="#8b5cf6"
                  label="Control gradients"
                  sub="Accent-tinted gradients on the player bar, toggle groups, search bars, badges, and menus"
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
                <Row
                  icon={Images}
                  iconColor="#8b5cf6"
                  label="Playlist header art"
                  sub="Full-bleed blurred cover art behind a playlist's header - off falls back to a plain header. Tracked separately for light and dark skins."
                >
                  {/* Tracked per skin darkness (playlistHeroEnabledDark/Light)
                      rather than one flag, so a choice made on a dark skin
                      doesn't silently carry over to a light one and vice
                      versa - this toggle always shows/writes the value for
                      whichever skin is active right now. */}
                  {(() => {
                    const heroOn = getSkin(theme).dark ? playlistHeroEnabledDark : playlistHeroEnabledLight
                    return <Toggle on={heroOn} onClick={() => setPlaylistHeroEnabled(!heroOn)} />
                  })()}
                </Row>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#7c3aed' }}>
                      <Type size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">App font</span>
                      <p className="text-text-muted text-[11px]">Typeface for the whole app - each option previews in its own font</p>
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
                      <p className="text-text-muted text-[11px]">Synced and plain lyrics everywhere - WRLD tab, now playing, mini player</p>
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
                <Row
                  icon={FlaskConical}
                  iconColor="#f59e0b"
                  label="Sandbox"
                  sub="Dock modals into a collapsible pill at the top of the window instead of a centered popup. Off restores the plain popup for every modal."
                >
                  <Toggle on={sandboxEnabled} onClick={() => setSandboxEnabled(!sandboxEnabled)} />
                </Row>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#9333ea' }}>
                      <Palette size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-text-primary text-sm">Lyric colors</span>
                      <p className="text-text-muted text-[11px]">Color the line being sung and the ones that aren't - WRLD tab, now playing, mini player</p>
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
                      <p className="text-text-muted text-[11px]">Where the nav menu sits on desktop - phones keep the bottom tabs</p>
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
                      const shown = isNavItemVisible(item, navVisibility, false)
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
                          {item.alwaysVisible ? (
                            <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                              Always shown
                            </span>
                          ) : (
                            <button
                              onClick={() => setNavItemVisible(item.view, !shown)}
                              title={shown ? 'Hide from menu' : 'Add to menu'}
                              className="ml-auto shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                            >
                              {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#059669' }}>
                      <House size={13} className="text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-text-primary text-sm">Home screen</span>
                      <p className="text-text-muted text-[11px]">Choose which sections show on the Home tab</p>
                    </div>
                    {!homeIsDefault && (
                      <button
                        onClick={resetHome}
                        title="Restore all Home sections"
                        className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors shrink-0"
                      >
                        <RotateCcw size={11} /> Reset
                      </button>
                    )}
                  </div>
                  <div className="pl-[34px] space-y-1.5">
                    {HOME_SECTIONS.map((section) => {
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
                {ctrlRows.length > 0 && (
                  <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#8b5cf6' }}>
                        <ListOrdered size={13} className="text-white" strokeWidth={2.25} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-text-primary text-sm">Menu controls</span>
                        <p className="text-text-muted text-[11px]">The buttons at the foot of the menu - reorder or hide them</p>
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
                    !lastfmConfigured() ? 'Unavailable - this build has no Last.fm API key'
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
              </div>
            )}

            {/* ── Shortcuts ── */}
            {!settingsQueryTrimmed && tab === 'shortcuts' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-text-primary text-lg font-bold">Keyboard Shortcuts</h3>
                  <button
                    onClick={() => { setRecording(null); resetHotkeyBindings() }}
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

                {HOTKEY_CATEGORIES.map((category) => {
                  const actions = HOTKEY_ACTIONS.filter((a) => a.category === category && (developerMode || !a.devModeOnly))
                  if (actions.length === 0) return null
                  return (
                    <div key={category} className="mt-4 first:mt-3">
                      <div className="flex items-center gap-2 mb-1.5 px-0.5">
                        <p className="flex-1 min-w-0 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{category}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                        {actions.map((action) => {
                          const appBinding = effectiveBinding(action.id, hotkeyBindings)
                          const appTokens = comboTokens(appBinding)
                          const isRecordingApp = recording?.id === action.id
                          return (
                            <div key={action.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)]">
                              <span className="flex-1 min-w-0 text-text-secondary text-sm truncate">{action.label}</span>
                              <div className="shrink-0 flex items-center gap-1 w-[134px]">
                                <button
                                  onClick={() => setRecording(isRecordingApp ? null : { id: action.id })}
                                  className={`flex-1 min-w-0 flex items-center justify-center flex-wrap gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                    isRecordingApp
                                      ? 'border-accent text-accent bg-accent/10 animate-pulse'
                                      : appTokens.length > 0
                                        ? 'border-[var(--border)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)]'
                                        : 'border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                                  }`}
                                  title={isRecordingApp ? 'Press a key combination…' : 'Click to change the shortcut'}
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
                                    title="Clear the shortcut"
                                    className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-[var(--surface-overlay)] transition-colors"
                                  >
                                    <X size={13} />
                                  </button>
                                ) : (
                                  <span className="shrink-0 w-[25px]" aria-hidden="true" />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
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
                <div className="max-w-md mb-2">
                  <Row
                    icon={Bug}
                    iconColor="#ef4444"
                    label="Auto-report app errors"
                    sub="When the app hits an unexpected error, send a crash report automatically instead of asking first"
                  >
                    <Toggle on={autoReportErrors} onClick={() => setAutoReportErrors(!autoReportErrors)} />
                  </Row>
                </div>
                <div className="max-w-md">
                  <ReportForm mode={{ kind: 'feedback' }} />
                </div>
              </div>
            )}

            {/* ── About ── */}
            {!settingsQueryTrimmed && tab === 'about' && (
              <div>
                <h3 className="text-text-primary text-lg font-bold mb-3">About</h3>
                <p className="text-text-muted text-xs mb-1">
                  unreleased v{APP_VERSION} &mdash; powered by{' '}
                  <a href="https://juicewrldapi.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    juicewrldapi.com
                  </a>
                </p>
                <p className="text-text-muted text-xs mb-3">
                  Last updated to commit{' '}
                  <a
                    href={`https://github.com/Juice-WRLD-API/Unreleased/commit/${COMMIT_HASH}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent font-mono hover:underline"
                  >
                    {COMMIT_HASH}
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

                {account && (
                  <button
                    onClick={() => logoutAccount()}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-raised)] hover:bg-red-500/10 border border-[var(--border)] hover:border-red-500/25 text-text-secondary hover:text-red-400 text-sm font-medium transition-colors mt-2"
                  >
                    <LogOut size={15} />
                    Log out
                  </button>
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
  )
}
