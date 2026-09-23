import { useState, useEffect, useRef, ReactNode, ElementType } from 'react'
import {
  Brush, Palette, Volume2, Zap, Clock, Info, Github, MessageCircle, Check,
  PenLine, BookOpen, Copy, Eye, EyeOff, ChevronDown, ChevronRight, ArrowLeft, KeyRound, Globe, RefreshCw,
  FolderOpen, FolderPlus, Minus, Loader2, Plus, AlignLeft, FileText, Trash2, Music2,
  Waves, RotateCcw, ExternalLink,
  ListOrdered, CloudUpload, Type, AlignCenter, Menu, Pencil, Upload,
  ScrollText, ShieldCheck, User, LogOut, LogIn, AlertCircle, GripVertical, Images, Search, X, Bug, Disc, Lock, House, Heart, History, Bell, BellOff, Radio,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { SKINS, getSkin } from '../lib/skins'
import SkinEditorModal from './SkinEditorModal'
import { FONTS } from '../lib/fonts'
import { orderedNavItems, isNavItemVisible, DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY } from '../lib/navItems'
import { hasChatAccess, useChatStore } from '../store/chatStore'
import ChatDevices from './chat/ChatDevices'
import MyCdnNodes from './MyCdnNodes'
import ChatKeyTransfer from './chat/ChatKeyTransfer'
import { HOME_SECTIONS, DEFAULT_HOME_SECTION_VISIBILITY, isHomeSectionVisible } from '../lib/homeSections'
import { getToken, CONTRIBUTOR_ENABLED, showStaffProfile, staffProfileLabel } from '../lib/userApi'
import { APP_VERSION, COMMIT_HASH, useCommitStatus } from '../lib/appVersion'
import { lastfmConfigured } from '../lib/lastfm'
import { cacheClearAll } from '../lib/apiCache'
import { NOTIFICATION_SOUNDS } from '../lib/notifications'
import { IS_IOS } from '../lib/platform'
import { formatBytes, accountDisplayName, initial } from '../lib/format'
import { registerBackHandler } from '../lib/backHandlers'
import { useBackToClose } from '../hooks/useBackToClose'
import { Sheet } from './mobile/Sheet'
import { useDragReorder } from './mobile/useDragReorder'
import type { ViewType } from '../types'
import ReportForm from './ReportForm'
import LegalModal, { type LegalDoc } from './LegalModal'
import EraCoversSection from './EraCoversSection'
import { useSettingsAccount } from '../hooks/useSettingsAccount'
import { useSettingsAppearance } from '../hooks/useSettingsAppearance'
import { useLastfmConnect } from '../hooks/useLastfmConnect'

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

const LYRIC_TEXT_SIZES: { label: string; value: number }[] = [
  { label: 'Small', value: 0.85 },
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.2 },
  { label: 'Huge', value: 1.4 },
]

const LYRIC_ACTIVE_PRESETS = ['#ffffff', '#1db954', '#a78bfa', '#60a5fa', '#f472b6', '#facc15']
const LYRIC_INACTIVE_PRESETS = ['#9ca3af', '#6b7280', '#94a3b8', '#c4b5fd', '#7dd3fc', '#fda4af']

// One row of the "Lyric colors" setting: presets + a custom picker, with
// "Auto" (value === null) meaning "leave it to the surface's own colors" -
// the theme's text vars in the mini/now-playing lyrics, the cover-art-derived
// ones in the WRLD tab. The native color input always needs a concrete hex,
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
      <span className="text-text-muted text-xs w-full">{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
          value === null
            ? 'bg-accent/15 text-accent border-[var(--accent)]'
            : 'text-text-muted border-[var(--border)] active:bg-[var(--surface-raised)]'
        }`}
      >
        Auto
      </button>
      {presets.map((c) => (
        <button
          key={c}
          onClick={() => { onChange(c); setCustom(c) }}
          className="w-8 h-8 rounded-full border border-[var(--border)] shrink-0"
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
        className="w-8 h-8 rounded-full border border-[var(--border)] shrink-0 bg-transparent p-0"
      />
    </div>
  )
}

type Tab = 'account' | 'appearance' | 'playback' | 'feedback' | 'about'

const SECTION_IDS: Tab[] = ['account', 'appearance', 'playback', 'feedback', 'about']

// A hand-maintained index of every setting row, used by the search bar to
// jump straight to the tab a match lives on. Only lists rows that actually
// exist on the mobile layout - no Shortcuts/Library/App/Developer tabs here
// (keyboard shortcuts and Electron-only settings don't apply on mobile).
const SETTINGS_SEARCH_INDEX: { tab: Tab; label: string; sub?: string }[] = [
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
  { tab: 'appearance', label: 'Navigation position', sub: 'Where the nav menu sits' },
  { tab: 'appearance', label: 'Menu items', sub: 'Reorder or hide nav tabs' },
  { tab: 'appearance', label: 'Menu controls', sub: 'Reorder or hide the buttons at the foot of the menu' },
  { tab: 'appearance', label: 'Home screen', sub: 'Choose which sections show on the Home tab' },
  // Playback
  { tab: 'playback', label: 'Audio output' },
  { tab: 'playback', label: 'Lyrics sync', sub: 'Offset lyrics timing' },
  { tab: 'playback', label: 'Crossfade' },
  // Smooth fade when pausing is iOS-excluded further down (Safari ignores
  // <audio>.volume), so it's filtered out of this index below rather than
  // listed unconditionally here.
  ...(IS_IOS ? [] : [{ tab: 'playback' as const, label: 'Smooth fade when pausing' }]),
  { tab: 'playback', label: 'Prefer OG version' },
  { tab: 'playback', label: 'Rotate suggested covers' },
  { tab: 'playback', label: 'Era covers', sub: 'Custom cover art per era, used when a song has no cover of its own' },
  { tab: 'playback', label: 'Notification sound' },
  { tab: 'playback', label: 'Sleep timer' },
  { tab: 'playback', label: 'Last.fm scrobbling' },
  // Feedback / About
  { tab: 'feedback', label: 'Feedback', sub: 'Report a bug or share an idea' },
  { tab: 'feedback', label: 'Auto-report app errors', sub: 'Automatically send a crash report when the app hits an unexpected error' },
  { tab: 'about', label: 'About', sub: 'Version, GitHub, Discord, API links' },
  { tab: 'account', label: 'My CDN nodes', sub: 'Nodes linked to your account' },
  { tab: 'about', label: 'Auth Token', sub: 'View and copy your account token' },
  { tab: 'about', label: 'API Docs' },
  { tab: 'about', label: 'Thank You', sub: 'Donors and contributors' },
  { tab: 'about', label: 'GitHub' },
  { tab: 'about', label: 'Discord' },
  { tab: 'about', label: 'Terms of Service' },
  { tab: 'about', label: 'Privacy Policy' },
  { tab: 'about', label: 'Become an Editor' },
  { tab: 'about', label: 'Become a Contributor' },
  { tab: 'about', label: 'FAQ', sub: 'What is this? Who are you? Why did you build this? Technical stuff?' },
]

// ── Row primitives ────────────────────────────────────────────────────────
// Every section is built from these three, inside a SettingsCard: `Row` for a
// label with its control on the right, `Block` for a label whose control is too
// wide to sit beside it, and `Segmented` for a small closed set of choices.
// The icon sits in a colored badge (iOS Settings-style) - a fixed color + white
// icon reads correctly in both themes, unlike the plain `text-muted` icon this
// replaced, which nearly disappeared in light mode.

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
    // 52px minimum and the helper text wraps rather than truncating: on a phone
    // the sub-label is usually the part that explains what the control does, so
    // clipping it to one line loses exactly the useful half.
    <div className="flex items-center justify-between gap-3 py-3 min-h-[52px] border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
          <Icon size={15} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <p className="text-text-primary text-[15px] leading-snug">{label}</p>
          {sub && <p className="text-text-muted text-xs leading-snug mt-0.5">{sub}</p>}
        </div>
        {labelExtra}
      </div>
      {children}
    </div>
  )
}

// A row that *is* the control: the whole 52px strip is tappable and a chevron
// (or an external-link arrow) says so. About's pill buttons and full-width
// bordered buttons became these, so navigation looks like navigation and only
// switches and pickers look like controls.
function ActionRow({ icon: Icon, iconColor, label, sub, onClick }: {
  icon: ElementType
  iconColor: string
  label: string
  sub?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 py-3 min-h-[52px] border-b border-[var(--border)] last:border-b-0 text-left active:opacity-70">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
        <Icon size={15} className="text-white" strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-[15px] leading-snug">{label}</p>
        {sub && <p className="text-text-muted text-xs leading-snug mt-0.5">{sub}</p>}
      </div>
      <ChevronRight size={17} className="text-text-muted shrink-0" />
    </button>
  )
}

// Same, for a link that leaves the app.
function LinkRow({ icon: Icon, iconColor, label, href }: {
  icon: ElementType
  iconColor: string
  label: string
  href: string
}): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="w-full flex items-center gap-3 py-3 min-h-[52px] border-b border-[var(--border)] last:border-b-0 active:opacity-70">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
        <Icon size={15} className="text-white" strokeWidth={2.25} />
      </div>
      <span className="min-w-0 flex-1 text-text-primary text-[15px]">{label}</span>
      <ExternalLink size={16} className="text-text-muted shrink-0" />
    </a>
  )
}

// A label whose control can't fit beside it - a swatch grid, a segmented
// control, a reorderable list. Same badge, label and hairline as `Row`, but the
// control goes underneath at full card width instead of at the right edge.
//
// This replaces the header markup that used to be hand-rolled at each such
// site, which had drifted: a 24px badge against Row's 28px, `text-sm` against
// Row's 15px, and a 34px indent under the label that only some of them applied.
function Block({ icon: Icon, iconColor, label, sub, action, children }: {
  icon: ElementType
  iconColor: string
  label: string
  sub?: string
  // Optional trailing control on the header line itself (Import, Reset…).
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="py-3 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor }}>
          <Icon size={15} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-[15px] leading-snug">{label}</p>
          {sub && <p className="text-text-muted text-xs leading-snug mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// A closed set of 2–4 choices (text size, lyric alignment, nav edge). These
// were loose wrapping pills, which on a phone left a ragged trailing gap and
// gave no sense of being one control; equal-width segments in a track read as
// a single switch and land on the same baseline in every section that uses one.
function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; icon?: ElementType }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-highest)]">
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = value === v
        return (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium transition-colors ${
              active ? 'bg-accent text-white' : 'text-text-secondary active:bg-[var(--surface-overlay)]'
            }`}
          >
            {Icon && <Icon size={14} className="shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Grouped-card wrapper ──────────────────────────────────────────────────
// Related rows grouped into one inset card, the platform idiom on both iOS and
// Android. Without it the pane is a bare list of rows with hairlines between
// them, which reads as options floating on the page rather than a settings
// screen. `title` is the small caption above the group - worth setting on any
// pane long enough to scroll, so the groups are findable rather than an
// undifferentiated stack of cards.
function SettingsCard({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      {title && (
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</p>
      )}
      {/* Full-opacity surface-overlay, not a tinted one: in the dark palette
          the two surfaces sit ~1 step apart, so any transparency blends the
          card straight back into the page. */}
      <div className="rounded-2xl bg-[var(--surface-overlay)] px-4 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// Collapses a bulky inline picker (skin swatches, a 7-item font list) down to
// one summary row - current value + chevron - that opens a bottom sheet with
// the full picker. This is what actually shortens the Appearance page instead
// of just tidying it: three ~250-450px sections become three ~50px rows.
function PickerRow({ preview, title, sub, onClick }: {
  preview: ReactNode
  title: string
  sub?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 py-2.5 -my-1 text-left active:opacity-70">
      {preview}
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-[15px] font-medium truncate">{title}</p>
        {sub && <p className="text-text-muted text-xs truncate mt-0.5">{sub}</p>}
      </div>
      <ChevronRight size={17} className="text-text-muted shrink-0" />
    </button>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    // A thumb-sized switch, with the tap target extended past it by padding so
    // the whole 44px is live without the switch itself looking oversized. The
    // knob slides via flexbox justify-content (not absolute + translate) so it
    // can never land outside the track regardless of rounding - it's always a
    // flex child inset by the track's own padding. The off state sits on
    // surface-highest: against a card that is already surface-overlay, an off
    // switch in that same colour vanished.
    <button onClick={onClick} aria-pressed={on} className="shrink-0 -m-2 p-2">
      <span className={`flex items-center w-[46px] h-[26px] p-[3px] rounded-full transition-colors ${
        on ? 'bg-accent justify-end' : 'bg-[var(--surface-highest)] justify-start'
      }`}>
        <span className="w-5 h-5 rounded-full bg-white" />
      </span>
    </button>
  )
}

// Green when this build's commit is the latest on the deploy branch, red
// when a newer commit has shipped since. Nothing rendered while checking or
// if the check fails (offline, rate-limited) - a wrong-looking indicator is
// worse than no indicator.
function CommitFreshnessBulb(): JSX.Element | null {
  const [status, refresh] = useCommitStatus()
  if (status === 'unknown') return null
  const checking = status === 'checking'
  const color = checking ? 'bg-gray-400' : {
    latest: 'bg-green-500',
    'refresh-needed': 'bg-yellow-500',
    outdated: 'bg-red-500',
    error: 'bg-blue-500',
  }[status]
  const label = checking ? 'Checking for updates…' : {
    latest: 'Running the latest commit',
    'refresh-needed': 'On the latest commit, but a newer version loaded in the background - refresh to run it',
    outdated: 'A newer commit has been deployed',
    error: "Couldn't check for updates (rate-limited or offline)",
  }[status]
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={checking}
      aria-label={`${label} - tap to re-check`}
      title={`${label} - tap to re-check`}
      className={`inline-block w-2 h-2 rounded-full shrink-0 border-0 p-0 ${color} ${checking ? 'cursor-default' : 'cursor-pointer'}`}
    />
  )
}

export default function Settings(): JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [openAbout, setOpenAbout] = useState<string | null>(null)
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)
  const {
    setShowSettings, setActiveView, openProfile,
    account, setShowUserAuth, logoutAccount,
    theme, setTheme,
    customSkins, saveCustomSkin, deleteCustomSkin,
    accentColor, setAccentColor,
    settingsTab, setSettingsTab,
    navOrder, setNavOrder,
    navVisibility, setNavItemVisible,
    homeSectionVisibility, setHomeSectionVisible,
    audioOutput, setAudioOutput,
    crossfadeEnabled, crossfadeDuration, setCrossfade,
    pauseFadeEnabled, setPauseFade,
    preferOgVersion, setPreferOgVersion,
    rotateSuggestedCovers, setRotateSuggestedCovers,
    mediaOverlayEnabled, setMediaOverlayEnabled,
    lyricsOffset, setLyricsOffset,
    sleepTimerEnd, setSleepTimer,
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
    fullEraNames, setFullEraNames,
    autoReportErrors, setAutoReportErrors,
  } = useStorePick('setShowSettings', 'setActiveView', 'openProfile', 'account', 'setShowUserAuth', 'logoutAccount', 'theme', 'setTheme', 'customSkins', 'saveCustomSkin', 'deleteCustomSkin', 'accentColor', 'setAccentColor', 'settingsTab', 'setSettingsTab', 'navOrder', 'setNavOrder', 'navVisibility', 'setNavItemVisible', 'homeSectionVisibility', 'setHomeSectionVisible', 'audioOutput', 'setAudioOutput', 'crossfadeEnabled', 'crossfadeDuration', 'setCrossfade', 'pauseFadeEnabled', 'setPauseFade', 'preferOgVersion', 'setPreferOgVersion', 'rotateSuggestedCovers', 'setRotateSuggestedCovers', 'mediaOverlayEnabled', 'setMediaOverlayEnabled', 'lyricsOffset', 'setLyricsOffset', 'sleepTimerEnd', 'setSleepTimer', 'developerMode', 'setDeveloperMode', 'lastfmUser', 'setLastfmUser', 'lastfmEnabled', 'setLastfmEnabled', 'appTextScale', 'setAppTextScale', 'lyricsScale', 'setLyricsScale', 'lyricsAlign', 'setLyricsAlign', 'lyricsBlur', 'setLyricsBlur', 'lyricsBlurAmount', 'setLyricsBlurAmount', 'lyricsColorActive', 'setLyricsColorActive', 'lyricsColorInactive', 'setLyricsColorInactive', 'appFont', 'setAppFont', 'lyricsFont', 'setLyricsFont', 'gradientsEnabled', 'setGradientsEnabled', 'surfaceGradientsEnabled', 'setSurfaceGradientsEnabled', 'wrldThemeBackground', 'setWrldThemeBackground', 'playlistHeroEnabledDark', 'playlistHeroEnabledLight', 'setPlaylistHeroEnabled', 'fullEraNames', 'setFullEraNames', 'autoReportErrors', 'setAutoReportErrors')

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const {
    avatarUploading, avatarError, handleAvatarFile, handleAvatarRemove,
    bioDraft, setBioDraft, bioSaving, saveBio,
    privacyError, togglePublicPlayHistory, togglePublicPlaylists, togglePublicNowPlaying,
  } = useSettingsAccount()
  const chatPresenceEnabled = useChatStore((s) => s.presenceEnabled)
  const chatReadEnabled = useChatStore((s) => s.readEnabled)
  const setChatPresenceEnabled = useChatStore((s) => s.setPresenceEnabled)
  const setChatReadEnabled = useChatStore((s) => s.setReadEnabled)

  // ── Menu items (Appearance) ──────────────────────────────────────────────
  // Games ('heardle' - see NAV_ITEMS) and Playlists are dropped from the
  // reorder/show-hide list here: both are unconditionally excluded from the
  // actual mobile nav now that Home covers them directly (see
  // useMobileNavTabs' MOBILE_HIDDEN_VIEWS), so a row for either here would
  // toggle something with no visible effect. Desktop's Settings keeps them -
  // Sidebar still has its own tabs for both.
  const {
    customAccent, setCustomAccent, setAccentDebounced,
    editingSkinId, setEditingSkinId, skinImportRef, skinImportError, createSkin, importSkinFile,
    navRows, navIsDefault, resetNav, homeIsDefault, resetHome, moveNavItem,
    notificationSound, chooseNotificationSound,
    sleepMinutes, setSleepMinutes,
    devices,
  } = useSettingsAppearance({
    filterNavRows: (i) => i.view !== 'heardle' && i.view !== 'playlists',
    onSkinCreated: () => setPickerOpen(null),
  })
  const navDrag = useDragReorder(navRows.length, moveNavItem)

  // The foot-of-menu controls (Profile, Log out, Diagnostics, Download) had a
  // reorder/hide list here too. They belong to the desktop side menu; the phone
  // bar has no equivalent row - Settings is pinned there and the profile entry
  // is role-gated by the card below - so the list configured nothing you could
  // see. It's gone, along with its drag handlers; the store keys it wrote
  // (navControlOrder / navControlVisibility) are untouched and still drive the
  // desktop build off their defaults.

  const closeSettings = (): void => setShowSettings(false)
  // setActiveView alone leaves Settings now that it's a real page in the same
  // slot as every other view - no separate close step, and no extra history
  // entry from one.
  const openMainView = (view: ViewType): void => setActiveView(view)

  const {
    lastfmBusy, lastfmWaiting, lastfmError, connectLastfm, disconnectLastfm, stopLastfmPoll,
  } = useLastfmConnect(setLastfmUser)

  // The Shortcuts section - a key-combo recorder over every hotkey action -
  // is gone: there's no keyboard here to record from, and the recorder listened
  // on `window` for a keydown that a touch device never sends. The bindings
  // themselves are untouched in the store, so a paired Bluetooth keyboard still
  // works off the defaults; only the editor for them is desktop-side now.

  const [tab, setTab] = useState<Tab>((settingsTab as Tab) ?? 'appearance')

  // Settings is a two-level page: a category list that drills into one section
  // at a time. `inSection` = a section is open.
  const [inSection, setInSection] = useState(!!settingsTab)

  // Which picker sheet is open (see PickerRow) - null when none.
  const [pickerOpen, setPickerOpen] = useState<'skin' | 'appFont' | 'lyricsFont' | null>(null)
  useBackToClose(() => setPickerOpen(null), pickerOpen !== null)

  // ── Settings search - a flat filter over SETTINGS_SEARCH_INDEX rather than
  // per-tab content, since matches can live on a tab you're not currently
  // viewing. Gated the same way the rows themselves are (electron/dev mode)
  // so a result never points at a tab that doesn't exist in this build.
  const [settingsQuery, setSettingsQuery] = useState('')
  const settingsQueryTrimmed = settingsQuery.trim().toLowerCase()
  const searchResults = settingsQueryTrimmed
    ? SETTINGS_SEARCH_INDEX.filter((r) =>
        r.label.toLowerCase().includes(settingsQueryTrimmed) || r.sub?.toLowerCase().includes(settingsQueryTrimmed)
      )
    : []
  const jumpToResult = (t: Tab): void => {
    setTab(t)
    setInSection(true)
    setSettingsQuery('')
  }

  // `sub` shows under the label in the category list; `color` is the badge
  // tint, matching the iOS-Settings idiom the Row primitive already uses.
  const tabs: { id: Tab; label: string; icon: ElementType; color: string; sub: string }[] = [
    { id: 'account', label: 'Account', icon: User, color: '#1d4ed8', sub: account ? accountDisplayName(account) : 'Not signed in' },
    { id: 'appearance', label: 'Appearance', icon: Palette, color: '#7c3aed', sub: 'Skin, accent, fonts, layout' },
    { id: 'playback', label: 'Playback', icon: Volume2, color: '#2563eb', sub: 'Output, crossfade, lyrics' },
    { id: 'feedback', label: 'Feedback', icon: MessageCircle, color: '#db2777', sub: 'Report a problem or idea' },
    { id: 'about', label: 'About', icon: Info, color: '#6b7280', sub: 'Version, links, legal' },
  ]

  const openSection = (id: Tab): void => {
    setTab(id)
    setInSection(true)
  }

  // Android back inside a section returns to the category list; only once
  // we're on the list does back fall through to closing Settings entirely.
  useEffect(() => {
    if (!inSection) return
    return registerBackHandler(() => { setInSection(false); return true })
  }, [inSection])

  // A deep-linked open (app menu → "Version", say) sets settingsTab; jump to
  // it, then clear so a later plain open lands wherever the user last was
  // rather than snapping back here. It must land in the section itself, not on
  // the category list. The store's SettingsTab union is the desktop one and
  // still carries categories this page doesn't have (shortcuts, app,
  // developer), so an unknown target falls back to the list rather than
  // rendering a blank pane.
  useEffect(() => {
    if (!settingsTab) return
    const known = SECTION_IDS.includes(settingsTab as Tab)
    if (known) { setTab(settingsTab as Tab); setInSection(true) }
    setSettingsTab(null)
  }, [settingsTab, setSettingsTab])

  const toggleSleepTimer = (): void => {
    if (sleepTimerEnd) setSleepTimer(null)
    else setSleepTimer(Date.now() + sleepMinutes * 60 * 1000)
  }

  // ── Appearance pickers ───────────────────────────────────────────────────
  // Each of these is the body of a picker sheet, summarised inline by a
  // PickerRow. The current value drives that row's preview.
  const currentSkin = getSkin(theme)
  const currentAppFont = FONTS.find((f) => f.id === appFont) ?? FONTS[0]
  const currentLyricsFont = FONTS.find((f) => f.id === lyricsFont) ?? FONTS[0]

  // Two across: the sheet is the full screen width, and a 4-across grid put
  // four ~80px mocks in a row where nothing in them was legible.
  const skinGrid = (
    <div className="grid grid-cols-2 gap-2.5">
      {[...SKINS, ...customSkins].map((skin) => {
        const active = theme === skin.id
        return (
          <div key={skin.id} className="relative group">
            <button
              onClick={() => {
                setTheme(skin.id)
                if (skin.accent) { setAccentColor(skin.accent); setCustomAccent(skin.accent) }
              }}
              onDoubleClick={() => { if (skin.custom) { setEditingSkinId(skin.id); setPickerOpen(null) } }}
              className="w-full text-left"
              title={skin.dynamic ? 'Palette follows the current song’s cover art' : skin.name}
            >
              {/* Mini app mock: sidebar strip, two "text" lines, and a
                  player bar with the skin's accent - a live swatch of
                  the actual palette values, not approximations. */}
              <div
                className="h-16 rounded-xl overflow-hidden flex border transition-transform group-active:scale-[0.97]"
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
              <p className={`mt-1.5 text-xs font-medium text-center truncate ${active ? 'text-accent' : 'text-text-muted'}`}>
                {skin.name}
              </p>
            </button>
            {/* Custom skins get an edit button (sibling, not nested, to keep
                the markup button-in-button free). It used to be a hover
                reveal, with double-click as the alternative - neither exists
                on touch, so it stays visible. */}
            {skin.custom && (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingSkinId(skin.id); setPickerOpen(null) }}
                className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center active:bg-black/70 transition-colors"
                aria-label={`Edit ${skin.name}`}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        )
      })}
      {/* Create-a-skin tile */}
      <button onClick={createSkin} className="text-left active:opacity-70" title="Create a new skin">
        <div className="h-16 rounded-xl border border-dashed border-[var(--border)] flex items-center justify-center text-text-muted">
          <Plus size={18} />
        </div>
        <p className="mt-1.5 text-xs font-medium text-center text-text-muted">
          Create
        </p>
      </button>
    </div>
  )

  const fontListPicker = (value: string, onSelect: (id: string) => void): ReactNode => (
    <div className="flex flex-col gap-1.5">
      {FONTS.map((font) => {
        const active = value === font.id
        return (
          <button
            key={font.id}
            onClick={() => onSelect(font.id)}
            title={font.name}
            className={`flex items-center gap-3 px-3 py-3 rounded-lg border text-left transition-colors ${
              active ? 'bg-accent/15 border-[var(--accent)]' : 'border-[var(--border)] hover:bg-[var(--surface-overlay)] active:bg-[var(--surface-overlay)]'
            }`}
          >
            <span className={`text-lg leading-tight shrink-0 ${active ? 'text-accent' : 'text-text-primary'}`} style={{ fontFamily: font.stack }}>
              Ag
            </span>
            <span className={`flex-1 min-w-0 truncate text-sm ${active ? 'text-accent' : 'text-text-muted'}`}>{font.name}</span>
            {active && <Check size={16} className="text-accent shrink-0" />}
          </button>
        )
      })}
    </div>
  )

  const activeTab = tabs.find((t) => t.id === tab)

  return (
    // A page, not a dialog. This used to be a fixed overlay covering the whole
    // viewport, which meant the player bar disappeared the moment you opened
    // Settings - you couldn't see or control what was playing while changing
    // playback settings, which is exactly when you'd want to. It now renders
    // inside the app's content area like every other tab, so the player and the
    // nav bar stay put, the status-bar inset is already handled upstream, and
    // there's no z-index, no backdrop, and no close button to get out with:
    // you leave by tapping another tab.
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Custom-skin editor (portals to <body>, so placement here is fine) */}
      {editingSkinId && (
        <SkinEditorModal
          skinId={editingSkinId}
          onClose={() => setEditingSkinId(null)}
          onEditSkin={setEditingSkinId}
        />
      )}

      {/* App bar - same shape as the other tabs', and no background of its own
          so the shell's (optionally accent-gradient) backdrop runs unbroken. */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2 pb-2">
        {inSection && (
          <button
            onClick={() => setInSection(false)}
            aria-label="Back"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className={`flex-1 min-w-0 ${inSection ? 'px-0.5' : 'pl-2.5'}`}>
          <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">
            {inSection ? (activeTab?.label ?? 'Settings') : 'Settings'}
          </h1>
          {inSection && (
            <p className="text-text-muted text-xs truncate">{activeTab?.sub ?? ''}</p>
          )}
        </div>
      </div>

        {/* Root - the category list. Tapping a row drills into that section
            (the header grows a back arrow), so each pane gets the whole screen
            instead of sharing it with a pill scroller. */}
        {!inSection && (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3 pb-6 space-y-4">
            {/* Search - a flat filter over every setting row (see
                SETTINGS_SEARCH_INDEX), not just the active tab; picking a
                result drills straight into its section. */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
                placeholder="Search settings"
                className="w-full bg-[var(--surface-overlay)] text-text-primary text-sm rounded-xl pl-9 pr-9 py-2.5 border border-[var(--border)] placeholder:text-text-muted focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              {settingsQuery && (
                <button
                  onClick={() => setSettingsQuery('')}
                  title="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted active:text-text-primary transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {settingsQueryTrimmed ? (
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
                      className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0 text-left active:bg-[var(--surface-overlay)] -mx-2 px-2 rounded-lg transition-colors"
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
            ) : (
              <>
            {/* Account gets a profile header rather than a list row - the
                platform idiom (iOS's Apple ID card, Android's account chip),
                and it makes signing in discoverable instead of buried as one
                more identical row. It's pulled out of the list below. */}
            <button
              onClick={() => openSection('account')}
              className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-[var(--surface-overlay)] text-left active:bg-[var(--surface-raised)] transition-colors"
            >
              {account?.avatar
                ? <img src={account.avatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                : (
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${account ? 'bg-accent/20 text-accent text-lg font-semibold' : 'bg-[var(--surface-raised)] text-text-muted'}`}>
                    {account
                      ? initial(accountDisplayName(account))
                      : <User size={22} />}
                  </div>
                )}
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-base font-semibold truncate">
                  {account ? accountDisplayName(account) : 'Not signed in'}
                </p>
                <p className="text-text-muted text-xs truncate">
                  {account ? 'Account, token, sign out' : 'Sign in to sync likes and playlists'}
                </p>
              </div>
              <ChevronRight size={18} className="text-text-muted shrink-0" />
            </button>

            {/* The rest as one inset grouped card, so the section reads as a
                single surface instead of rows floating on the page. */}
            <div className="rounded-2xl overflow-hidden">
              {tabs.filter((t) => t.id !== 'account').map((t) => (
                <button
                  key={t.id}
                  onClick={() => openSection(t.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3.5 border-b border-[var(--border)] last:border-b-0 text-left bg-[var(--surface-overlay)] active:bg-[var(--surface-raised)] transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: t.color }}>
                    <t.icon size={17} className="text-white" strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-[15px] truncate">{t.label}</p>
                    <p className="text-text-muted text-xs truncate">{t.sub}</p>
                  </div>
                  <ChevronRight size={18} className="text-text-muted shrink-0" />
                </button>
              ))}
            </div>
              </>
            )}

          </div>
        )}

        {/* The drilled-into section - one category owns the whole screen. */}
        {inSection && (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">

            {/* ── Account ── */}
            {tab === 'account' && (
              <div>
                {account ? (
                  <>
                    {/* Identity as a centred header rather than a list row -
                        the platform idiom, and there's nothing to compare it
                        against on a screen it has to itself. */}
                    <div className="flex flex-col items-center text-center pt-2 pb-6">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handleAvatarFile(file)
                          e.target.value = ''
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="relative w-20 h-20 rounded-full active:opacity-80 transition-opacity"
                      >
                        {account.avatar
                          ? <img src={account.avatar} alt="" className="w-20 h-20 rounded-full object-cover" />
                          : <div className="w-20 h-20 rounded-full bg-accent/20 text-accent flex items-center justify-center text-2xl font-semibold">{initial(accountDisplayName(account))}</div>}
                        <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center ring-2 ring-surface">
                          {avatarUploading ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                        </span>
                      </button>
                      <p className="mt-3 text-text-primary text-lg font-semibold truncate max-w-full">{accountDisplayName(account)}</p>
                      <p className="text-text-muted text-xs">{account.discord_id ? 'Signed in with Discord' : 'Signed in'}</p>
                      {avatarError && <p className="text-red-400 text-xs mt-1">{avatarError}</p>}
                      {account.avatar && !avatarUploading && (
                        <button
                          type="button"
                          onClick={() => void handleAvatarRemove()}
                          className="mt-2 text-xs text-text-muted hover:text-red-400 transition-colors"
                        >
                          Remove photo
                        </button>
                      )}
                    </div>

                    {account.is_donor && (
                      <div className="flex items-center gap-2.5 mb-4 px-3 py-2.5 rounded-xl border border-pink-500/20 bg-pink-500/5">
                        <Heart size={16} className="text-pink-400 shrink-0" fill="currentColor" />
                        <div className="min-w-0">
                          <p className="text-text-primary text-xs font-semibold">
                            Donor{account.donor_since ? ` since ${new Date(account.donor_since).toLocaleDateString()}` : ''}
                          </p>
                          <p className="text-text-muted text-[11px]">Priority CDN downloads — your files get matched to faster nodes first</p>
                        </div>
                      </div>
                    )}

                    <SettingsCard title="Bio">
                      <textarea
                        value={bioDraft}
                        onChange={(e) => setBioDraft(e.target.value.slice(0, 500))}
                        onBlur={() => void saveBio()}
                        placeholder="Tell people about yourself"
                        rows={3}
                        className="w-full py-3 bg-transparent text-text-primary text-[15px] placeholder:text-text-muted resize-none focus:outline-none"
                      />
                      <div className="flex items-center justify-between pb-1">
                        <span className="text-text-muted text-xs">{bioSaving ? 'Saving…' : `${bioDraft.length}/500`}</span>
                      </div>
                    </SettingsCard>

                    <SettingsCard title="Public profile">
                      <Row
                        icon={History}
                        iconColor="#0f766e"
                        label="Show listening history"
                        sub="Let anyone with your profile link see your recently played tracks"
                      >
                        <Toggle on={!!account.public_play_history} onClick={() => void togglePublicPlayHistory()} />
                      </Row>
                      <Row
                        icon={Music2}
                        iconColor="#0f766e"
                        label="Show public playlists"
                        sub="List your playlists that are already marked public on your profile"
                      >
                        <Toggle on={!!account.public_playlists} onClick={() => void togglePublicPlaylists()} />
                      </Row>
                      <Row
                        icon={Radio}
                        iconColor="#0f766e"
                        label="Share what you're listening to"
                        sub="Shows the track you're currently playing on your profile"
                      >
                        <Toggle on={!!account.public_now_playing} onClick={() => void togglePublicNowPlaying()} />
                      </Row>
                      {privacyError && <p className="text-red-400 text-xs pb-2">{privacyError}</p>}
                    </SettingsCard>

                    {hasChatAccess(account) && (
                      <SettingsCard title="Chat privacy">
                        <Row
                          icon={Radio}
                          iconColor="#0f766e"
                          label="Online status"
                          sub="Turn off to stop requesting and showing who's online"
                        >
                          <Toggle on={chatPresenceEnabled} onClick={() => setChatPresenceEnabled(!chatPresenceEnabled)} />
                        </Row>
                        <Row
                          icon={Check}
                          iconColor="#0f766e"
                          label="Read receipts"
                          sub="Turn off to stop sending read marks to the server"
                        >
                          <Toggle on={chatReadEnabled} onClick={() => setChatReadEnabled(!chatReadEnabled)} />
                        </Row>
                      </SettingsCard>
                    )}
                    {hasChatAccess(account) && (
                      <SettingsCard title="Chat devices">
                        <ChatDevices userId={account.id} />
                        <ChatKeyTransfer userId={account.id} />
                      </SettingsCard>
                    )}
                    <SettingsCard title="My CDN nodes">
                      <MyCdnNodes />
                    </SettingsCard>

                    {showStaffProfile(account) && (
                      <SettingsCard>
                        <button
                          onClick={() => openProfile()}
                          className="w-full flex items-center gap-3 py-3 min-h-[52px] active:opacity-70"
                        >
                          <ShieldCheck size={18} className="text-accent shrink-0" />
                          <span className="flex-1 text-left text-text-primary text-[15px] font-medium">{staffProfileLabel(account)} profile</span>
                        </button>
                      </SettingsCard>
                    )}

                    <SettingsCard title="Auth token">
                      <Row
                        icon={KeyRound}
                        iconColor="#0f766e"
                        label="Show token"
                        sub="Paste it on a device where Discord sign-in can't complete - like this app, where the redirect can't come back in-app"
                      >
                        <Toggle on={showToken} onClick={() => setShowToken(v => !v)} />
                      </Row>
                      {showToken && (
                        <div className="py-3 border-b border-[var(--border)] last:border-b-0">
                          <button
                            onClick={() => {
                              const t = getToken()
                              if (t) {
                                navigator.clipboard.writeText(t)
                                setTokenCopied(true)
                                setTimeout(() => setTokenCopied(false), 2000)
                              }
                            }}
                            className="w-full flex items-center gap-2 p-3 rounded-xl bg-[var(--surface-highest)] active:bg-[var(--surface-raised)] transition-colors"
                          >
                            <code className="flex-1 min-w-0 text-left text-[11px] font-mono text-text-muted truncate">
                              {getToken() ?? '—'}
                            </code>
                            <span className={`shrink-0 flex items-center gap-1 text-xs font-medium ${tokenCopied ? 'text-emerald-500' : 'text-text-secondary'}`}>
                              {tokenCopied ? 'Copied' : <><Copy size={13} /> Copy</>}
                            </span>
                          </button>
                        </div>
                      )}
                    </SettingsCard>

                    <SettingsCard>
                      <button
                        onClick={() => logoutAccount()}
                        className="w-full flex items-center justify-center gap-2 py-3 min-h-[52px] text-red-400 text-[15px] font-medium active:opacity-70"
                      >
                        <LogOut size={16} />
                        Log out
                      </button>
                    </SettingsCard>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center text-center pt-2 pb-5">
                      <div className="w-20 h-20 rounded-full bg-[var(--surface-overlay)] text-text-muted flex items-center justify-center">
                        <User size={34} />
                      </div>
                      <p className="mt-3 text-text-primary text-lg font-semibold">Not signed in</p>
                      <p className="text-text-muted text-xs leading-relaxed mt-1 max-w-[280px]">
                        Log in to save favorite tracks and playlists that follow you on every device.
                      </p>
                    </div>

                    <button
                      onClick={() => setShowUserAuth(true)}
                      className="w-full h-12 rounded-xl bg-accent text-white text-[15px] font-semibold flex items-center justify-center gap-2 active:opacity-80 transition-opacity mb-4"
                    >
                      <LogIn size={17} />
                      Log in
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Appearance ── */}
            {!settingsQueryTrimmed && tab === 'appearance' && (
              <div>
                <SettingsCard title="Theme">
                  <Block
                    icon={Brush}
                    iconColor="#4b5563"
                    label="Skin"
                    sub="Skins with a signature color also set the accent"
                    action={
                      <button
                        onClick={() => skinImportRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 -my-1 rounded-lg text-xs font-medium text-text-secondary active:bg-[var(--surface-highest)] transition-colors shrink-0"
                      >
                        <Upload size={13} /> Import
                      </button>
                    }
                  >
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
                    {skinImportError && (
                      <p className="text-red-400 text-xs mb-2">{skinImportError}</p>
                    )}
                    <PickerRow
                      preview={
                        <div className="h-10 w-14 rounded-lg overflow-hidden flex border shrink-0" style={{ background: currentSkin.vars['--surface'], borderColor: 'var(--border)' }}>
                          <div className="w-1/4 h-full border-r" style={{ background: currentSkin.vars['--sidebar'], borderColor: currentSkin.vars['--border'] }} />
                          <div className="flex-1 p-1 flex flex-col justify-center gap-0.5 min-w-0">
                            <div className="h-1 rounded-full w-3/4" style={{ background: currentSkin.vars['--text-primary'] }} />
                            <div className="h-1 rounded-full w-1/2" style={{ background: currentSkin.vars['--text-secondary'], opacity: 0.7 }} />
                          </div>
                        </div>
                      }
                      title={currentSkin.name}
                      sub="Tap to change"
                      onClick={() => setPickerOpen('skin')}
                    />
                  </Block>
                  <Block icon={Palette} iconColor="#ec4899" label="Accent color" sub="Highlights, the active tab, and the player's progress">
                    {/* A fixed 5-across grid rather than a wrapping row: the
                        swatches are 40px (a 28px circle is a mouse target, not
                        a finger one), and eight presets plus the custom one
                        wrap to an even 5 + 4. The active preset carries a check
                        - at this size an outline ring around a saturated circle
                        is easy to miss. */}
                    <div className="grid grid-cols-5 gap-x-2 gap-y-3 justify-items-center">
                      {ACCENT_PRESETS.map((c) => (
                        <button
                          key={c}
                          onClick={() => { setAccentColor(c); setCustomAccent(c) }}
                          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                          style={{ backgroundColor: c }}
                          aria-label={`Accent color ${c}`}
                          aria-pressed={accentColor === c}
                        >
                          {accentColor === c && <Check size={18} className="text-white" strokeWidth={3} />}
                        </button>
                      ))}
                      {/* The custom swatch is the color input itself - you
                          can't put a check inside one, so this is the one that
                          shows selection as a ring. `color-dot` strips the
                          native bordered square Chrome draws inside the
                          control, which is what made this tile the odd one out
                          in a row of circles. */}
                      <span className="relative w-10 h-10 shrink-0">
                        <input
                          type="color"
                          value={customAccent}
                          onChange={(e) => {
                            setCustomAccent(e.target.value)
                            setAccentDebounced(e.target.value)
                          }}
                          className="color-dot absolute inset-0 w-10 h-10 rounded-full"
                          style={{ outline: accentColor === customAccent && !ACCENT_PRESETS.includes(accentColor) ? '2px solid var(--text-primary)' : 'none', outlineOffset: '2px' }}
                          aria-label="Custom accent color"
                        />
                        {/* Otherwise this is just a ninth coloured circle with
                            no hint that it opens a picker - and it starts out
                            holding the current accent, so it can be an exact
                            duplicate of the swatch beside it. */}
                        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-[var(--surface-overlay)] flex items-center justify-center">
                          <Plus size={11} className="text-text-secondary" strokeWidth={3} />
                        </span>
                      </span>
                    </div>
                  </Block>
                  <Row
                    icon={Waves}
                    iconColor="#8b5cf6"
                    label="App gradients"
                    sub="Accent-tinted gradients behind the app and nav"
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
                    {/* Tracked per skin darkness (playlistHeroEnabledDark/
                        Light) rather than one flag - this always shows/writes
                        the value for whichever skin is active right now. */}
                    {(() => {
                      const heroOn = getSkin(theme).dark ? playlistHeroEnabledDark : playlistHeroEnabledLight
                      return <Toggle on={heroOn} onClick={() => setPlaylistHeroEnabled(!heroOn)} />
                    })()}
                  </Row>
                </SettingsCard>

                <SettingsCard title="Text">
                  <Block icon={Type} iconColor="#7c3aed" label="App font" sub="Typeface for the whole app">
                    <PickerRow
                      preview={<span className="text-lg w-9 text-center shrink-0" style={{ fontFamily: currentAppFont.stack }}>Ag</span>}
                      title={currentAppFont.name}
                      sub="Tap to change"
                      onClick={() => setPickerOpen('appFont')}
                    />
                  </Block>
                  <Block icon={Type} iconColor="#ca8a04" label="App text size" sub="Scales text across the whole app">
                    <Segmented value={appTextScale} options={APP_TEXT_SIZES.map(({ label, value }) => ({ value, label }))} onChange={setAppTextScale} />
                  </Block>
                </SettingsCard>

                <SettingsCard title="Lyrics">
                  <Block icon={Type} iconColor="#e11d48" label="Lyrics font" sub="Used only in the lyric panels, so lyrics can differ from the rest of the app">
                    <PickerRow
                      preview={<span className="text-lg w-9 text-center shrink-0" style={{ fontFamily: currentLyricsFont.stack }}>Ag</span>}
                      title={currentLyricsFont.name}
                      sub="Tap to change"
                      onClick={() => setPickerOpen('lyricsFont')}
                    />
                  </Block>
                  <Block icon={FileText} iconColor="#db2777" label="Lyrics text size" sub="Synced and plain lyrics everywhere - WRLD tab, now playing, mini player">
                    <Segmented value={lyricsScale} options={LYRIC_TEXT_SIZES.map(({ label, value }) => ({ value, label }))} onChange={setLyricsScale} />
                  </Block>
                  <Block icon={AlignCenter} iconColor="#0ea5e9" label="Lyrics alignment" sub="How lyric lines line up">
                    <Segmented
                      value={lyricsAlign}
                      options={[
                        { value: 'left' as const, label: 'Left', icon: AlignLeft },
                        { value: 'center' as const, label: 'Center', icon: AlignCenter },
                      ]}
                      onChange={setLyricsAlign}
                    />
                  </Block>
                  <Row
                    icon={Eye}
                    iconColor="#64748b"
                    label="Blur inactive lyrics"
                    sub="Soften every synced line except the one playing"
                    labelExtra={<Toggle on={lyricsBlur} onClick={() => setLyricsBlur(!lyricsBlur)} />}
                  >
                    {lyricsBlur && (
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="range" min={0.25} max={4} step={0.25}
                          value={lyricsBlurAmount}
                          onChange={(e) => setLyricsBlurAmount(parseFloat(e.target.value))}
                          className="w-20 accent-[var(--accent)]"
                        />
                        <span className="text-text-muted text-xs tabular-nums w-8 text-right">{lyricsBlurAmount}×</span>
                      </div>
                    )}
                  </Row>
                  <Block icon={Palette} iconColor="#9333ea" label="Lyric colors" sub="Color the line being sung and the ones that aren't - WRLD tab, now playing, mini player">
                    <div className="flex flex-col gap-3">
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
                  </Block>
                  <Row
                    icon={BookOpen}
                    iconColor="#0891b2"
                    label="Full era names"
                    sub='Show eras spelled out ("WRLD On Drugs") instead of abbreviated ("WOD")'
                    labelExtra={<Toggle on={fullEraNames} onClick={() => setFullEraNames(!fullEraNames)} />}
                  />
                </SettingsCard>

                <SettingsCard title="Navigation">
                  <Block
                    icon={ListOrdered}
                    iconColor="#6366f1"
                    label="Tabs"
                    sub="Drag the handle to reorder · tap the eye to show or hide"
                    action={!navIsDefault ? (
                      <button
                        onClick={resetNav}
                        className="flex items-center gap-1 px-2 py-2 -my-1 text-xs text-text-muted active:text-text-primary transition-colors shrink-0"
                      >
                        <RotateCcw size={12} /> Reset
                      </button>
                    ) : undefined}
                  >
                    {/* HTML5 drag events never fire for touch, so this is a
                        real touch drag (see mobile/useDragReorder) driven by
                        the grip handle, not the row itself - the row still
                        needs to host the visibility toggle without that tap
                        being mistaken for the start of a drag. */}
                    <div className="rounded-xl bg-[var(--surface-highest)] overflow-hidden">
                      {navRows.map((item, idx) => {
                        const shown = isNavItemVisible(item, navVisibility, false)
                        const dragging = navDrag.dragIndex === idx
                        return (
                          <div
                            key={item.view}
                            data-drag-row
                            style={navDrag.rowStyle(idx)}
                            className={`flex items-center gap-2 pl-1 pr-1 py-1 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface-highest)] ${
                              dragging ? 'shadow-xl rounded-lg' : ''
                            }`}
                          >
                            <button
                              {...navDrag.handleProps(idx)}
                              aria-label={`Drag to reorder ${item.label}`}
                              className="w-9 h-11 shrink-0 flex items-center justify-center text-text-muted touch-none active:text-text-primary transition-colors"
                            >
                              <GripVertical size={16} />
                            </button>
                            <span className={`w-6 h-6 shrink-0 flex items-center justify-center ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{item.icon}</span>
                            <span className={`flex-1 min-w-0 truncate text-sm ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{item.label}</span>
                            {item.alwaysVisible ? (
                              <span
                                title="Always shown"
                                className="shrink-0 w-11 h-11 flex items-center justify-center text-text-muted/50"
                              >
                                <Lock size={15} />
                              </span>
                            ) : (
                              <button
                                onClick={() => setNavItemVisible(item.view, !shown)}
                                aria-label={shown ? `Hide ${item.label}` : `Show ${item.label}`}
                                className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-text-muted active:bg-[var(--surface-overlay)] transition-colors"
                              >
                                {shown ? <Eye size={16} /> : <EyeOff size={16} />}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Block>
                  <Block
                    icon={House}
                    iconColor="#059669"
                    label="Home screen"
                    sub="Choose which sections show on the Home tab"
                    action={!homeIsDefault ? (
                      <button
                        onClick={resetHome}
                        className="flex items-center gap-1 px-2 py-2 -my-1 text-xs text-text-muted active:text-text-primary transition-colors shrink-0"
                      >
                        <RotateCcw size={12} /> Reset
                      </button>
                    ) : undefined}
                  >
                    <div className="rounded-xl bg-[var(--surface-highest)] overflow-hidden">
                      {HOME_SECTIONS.filter((section) => !section.staffOnly || hasChatAccess(account)).map((section) => {
                        const shown = isHomeSectionVisible(section.id, homeSectionVisibility)
                        return (
                          <div
                            key={section.id}
                            className="flex items-center gap-2 pl-3 pr-1 py-1 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface-highest)]"
                          >
                            <span className={`w-6 h-6 shrink-0 flex items-center justify-center ${shown ? 'text-text-secondary' : 'opacity-40'}`}>{section.icon}</span>
                            <span className={`flex-1 min-w-0 truncate text-sm ${shown ? 'text-text-primary' : 'text-text-muted'}`}>{section.label}</span>
                            <button
                              onClick={() => setHomeSectionVisible(section.id, !shown)}
                              aria-label={shown ? `Hide ${section.label}` : `Show ${section.label}`}
                              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-text-muted active:bg-[var(--surface-overlay)] transition-colors"
                            >
                              {shown ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </Block>
                </SettingsCard>
              </div>
            )}

            {/* ── Playback ── */}
            {!settingsQueryTrimmed && tab === 'playback' && (
              <div>
                <SettingsCard title="Audio">
                  {devices.length > 0 && (
                    <Row icon={Volume2} iconColor="#2563eb" label="Audio output">
                      <select
                        value={audioOutput}
                        onChange={(e) => setAudioOutput(e.target.value)}
                        className="bg-[var(--surface-highest)] text-text-primary text-sm rounded-lg px-3 h-10 border-0 max-w-[160px] truncate"
                      >
                        <option value="">Default</option>
                        {devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 6)}`}</option>
                        ))}
                      </select>
                    </Row>
                  )}
                  {/* Playback speed lives in the player bar's Equalizer panel */}
                  <Row icon={Zap} iconColor="#7c3aed" label="Crossfade" sub="Blend the end of a track into the next one">
                    <Toggle on={crossfadeEnabled} onClick={() => setCrossfade(!crossfadeEnabled, crossfadeDuration)} />
                  </Row>
                  {crossfadeEnabled && (
                    // Indented to the label column (28px badge + 12px gap) so it
                    // reads as part of the row above rather than a new setting.
                    // The slider was 80px wide next to the label; on a phone that
                    // is 12 steps across five-eighths of an inch.
                    <div className="flex items-center gap-3 py-2 pl-10 border-b border-[var(--border)] last:border-b-0">
                      <div className="flex-1 min-w-0 progress-track">
                        <input
                          type="range" min={1} max={12} step={1}
                          value={crossfadeDuration}
                          onChange={(e) => setCrossfade(true, parseInt(e.target.value))}
                          aria-label="Crossfade length"
                          className="w-full h-9"
                          style={{ '--val': `${((crossfadeDuration - 1) / 11) * 100}%` } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-text-muted text-xs tabular-nums w-8 text-right shrink-0">{crossfadeDuration}s</span>
                    </div>
                  )}
                  {/* Hidden on iOS: Safari ignores <audio>.volume entirely (locked
                      to the hardware buttons), so the fade ramp has nothing to
                      animate there - same restriction that hides the EQ. */}
                  {!IS_IOS && (
                    <Row icon={Waves} iconColor="#0ea5e9" label="Smooth fade when pausing">
                      <Toggle on={pauseFadeEnabled} onClick={() => setPauseFade(!pauseFadeEnabled)} />
                    </Row>
                  )}
                  <Row icon={FileText} iconColor="#059669" label="Prefer OG version">
                    <Toggle on={preferOgVersion} onClick={() => setPreferOgVersion(!preferOgVersion)} />
                  </Row>
                  <Row
                    icon={Images}
                    iconColor="#d946ef"
                    label="Rotate suggested covers"
                    sub="Songs without a custom cover show a different cover from the API files each play"
                    labelExtra={<Toggle on={rotateSuggestedCovers} onClick={() => setRotateSuggestedCovers(!rotateSuggestedCovers)} />}
                  />
                  <div className="py-2">
                    <EraCoversSection />
                  </div>
                </SettingsCard>

                <SettingsCard title="Lyrics">
                  <Block icon={AlignLeft} iconColor="#0891b2" label="Lyrics sync" sub="Shift synced lines earlier or later against the audio">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setLyricsOffset(Math.round((lyricsOffset - 0.1) * 10) / 10)}
                        aria-label="Shift lyrics earlier"
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-[var(--surface-highest)] text-text-secondary active:bg-[var(--surface-raised)] transition-colors"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="flex-1 text-center text-text-primary text-[15px] font-medium tabular-nums">
                        {lyricsOffset > 0 ? '+' : ''}{lyricsOffset.toFixed(1)}s
                      </span>
                      <button
                        onClick={() => setLyricsOffset(Math.round((lyricsOffset + 0.1) * 10) / 10)}
                        aria-label="Shift lyrics later"
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-[var(--surface-highest)] text-text-secondary active:bg-[var(--surface-raised)] transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                      {lyricsOffset !== 0 && (
                        <button
                          onClick={() => setLyricsOffset(0)}
                          className="shrink-0 px-3 h-11 rounded-xl text-xs font-medium text-text-muted active:bg-[var(--surface-highest)] transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </Block>
                </SettingsCard>

                <SettingsCard title="More">
                  <Block
                    icon={Clock}
                    iconColor="#4f46e5"
                    label="Sleep timer"
                    sub={sleepTimerEnd
                      ? `Stopping in ${Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000))} min`
                      : 'Stop playback after a set time'}
                  >
                    {sleepTimerEnd ? (
                      <button
                        onClick={toggleSleepTimer}
                        className="w-full h-11 rounded-xl text-sm font-semibold bg-red-500/15 text-red-400 active:bg-red-500/25 transition-colors"
                      >
                        Cancel timer
                      </button>
                    ) : (
                      <>
                        {/* Was a native <select> beside a Start button - two
                            taps and an OS dialog to pick one of five values. */}
                        <Segmented
                          value={sleepMinutes}
                          options={[15, 30, 45, 60, 90].map((m) => ({ value: m, label: `${m}m` }))}
                          onChange={setSleepMinutes}
                        />
                        <button
                          onClick={toggleSleepTimer}
                          className="mt-2 w-full h-11 rounded-xl text-sm font-semibold bg-accent text-white active:opacity-80 transition-opacity"
                        >
                          Start
                        </button>
                      </>
                    )}
                  </Block>
                  <Block
                    icon={Bell}
                    iconColor="#f59e0b"
                    label="Notification sound"
                    sub="Plays when a chat message or news post notification fires - tap one to preview it"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {NOTIFICATION_SOUNDS.map((s) => {
                        const active = notificationSound === s.id
                        return (
                          <button
                            key={s.id}
                            onClick={() => chooseNotificationSound(s.id)}
                            aria-pressed={active}
                            className={`flex items-center gap-1.5 px-3 h-9 rounded-full text-[13px] font-medium transition-colors ${
                              active ? 'bg-accent text-white' : 'bg-[var(--surface-highest)] text-text-secondary active:bg-[var(--surface-overlay)]'
                            }`}
                          >
                            {s.notes.length > 0 ? <Volume2 size={13} /> : <BellOff size={13} />}
                            {s.label}
                          </button>
                        )
                      })}
                    </div>
                  </Block>
                  <Block
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
                    action={lastfmUser
                      ? <Toggle on={lastfmEnabled} onClick={() => setLastfmEnabled(!lastfmEnabled)} />
                      : undefined}
                  >
                    {lastfmConfigured() && (
                      lastfmUser ? (
                        <button
                          onClick={disconnectLastfm}
                          className="w-full h-11 rounded-xl text-sm font-semibold bg-[var(--surface-highest)] text-red-400 active:bg-red-500/15 transition-colors"
                        >
                          Disconnect
                        </button>
                      ) : lastfmWaiting ? (
                        <button
                          onClick={stopLastfmPoll}
                          className="w-full h-11 rounded-xl text-sm font-semibold bg-[var(--surface-highest)] text-text-secondary flex items-center justify-center gap-2 active:bg-[var(--surface-raised)] transition-colors"
                        >
                          <Loader2 size={15} className="animate-spin" />
                          Waiting - tap to cancel
                        </button>
                      ) : (
                        <button
                          onClick={connectLastfm}
                          disabled={lastfmBusy}
                          className="w-full h-11 rounded-xl text-sm font-semibold bg-accent/15 text-accent active:bg-accent/25 disabled:opacity-50 transition-colors"
                        >
                          Connect
                        </button>
                      )
                    )}
                  </Block>
                </SettingsCard>
              </div>
            )}

            {/* ── Feedback ── */}
            {!settingsQueryTrimmed && tab === 'feedback' && (
              <div>
                <p className="text-text-muted text-xs mb-4 leading-relaxed">
                  Found a bug or have an idea? Let us know. To report a problem with a
                  specific song's info or lyrics, open that song and choose “Report”.
                </p>
                <SettingsCard>
                  <Row
                    icon={Bug}
                    iconColor="#ef4444"
                    label="Auto-report app errors"
                    sub="When the app hits an unexpected error, send a crash report automatically instead of asking first"
                  >
                    <Toggle on={autoReportErrors} onClick={() => setAutoReportErrors(!autoReportErrors)} />
                  </Row>
                </SettingsCard>
                <ReportForm mode={{ kind: 'feedback' }} />
              </div>
            )}

            {/* ── About ── */}
            {!settingsQueryTrimmed && tab === 'about' && (
              <div>
                <p className="text-text-muted text-xs mb-1">
                  unreleased v{APP_VERSION} &mdash; powered by{' '}
                  <a href="https://juicewrldapi.com" target="_blank" rel="noopener noreferrer" className="text-accent">
                    juicewrldapi.com
                  </a>
                </p>
                <p className="text-text-muted text-xs mb-3 flex items-center gap-1.5">
                  <span>
                    Last updated to commit{' '}
                    <a
                      href={`https://github.com/Juice-WRLD-API/Unreleased/commit/${COMMIT_HASH}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent font-mono"
                    >
                      {COMMIT_HASH}
                    </a>
                  </span>
                  <CommitFreshnessBulb />
                </p>

                <SettingsCard title="Links">
                  <LinkRow icon={Github} iconColor="#24292f" label="GitHub" href="https://github.com/Juice-WRLD-API/Unreleased" />
                  <LinkRow icon={MessageCircle} iconColor="#5865F2" label="Discord" href="https://discord.gg/jwa" />
                  <LinkRow icon={Globe} iconColor="#0891b2" label="API" href="https://juicewrldapi.com" />
                  <ActionRow icon={BookOpen} iconColor="#6366f1" label="API Docs" onClick={() => openMainView('docs')} />
                  <ActionRow icon={Heart} iconColor="#ec4899" label="Thank You" sub="Donors and contributors" onClick={() => openMainView('thanks')} />
                </SettingsCard>

                {/* Only shown to accounts that aren't already one - these are
                    the application pages, not a status display. */}
                {((!account || (!account.is_editor && !account.is_administrator))
                  || (CONTRIBUTOR_ENABLED && (!account || (!account.is_contributor && !account.is_administrator)))) && (
                  <SettingsCard title="Get involved">
                    {(!account || (!account.is_editor && !account.is_administrator)) && (
                      <ActionRow icon={PenLine} iconColor="#7c3aed" label="Become an Editor" sub="Help correct song info and lyrics" onClick={() => openMainView('editor')} />
                    )}
                    {CONTRIBUTOR_ENABLED && (!account || (!account.is_contributor && !account.is_administrator)) && (
                      <ActionRow icon={FolderOpen} iconColor="#0ea5e9" label="Become a Contributor" sub="Submit files to the archive" onClick={() => openMainView('contributor')} />
                    )}
                  </SettingsCard>
                )}

                <SettingsCard title="Legal">
                  <ActionRow icon={ScrollText} iconColor="#6b7280" label="Terms of Service" onClick={() => setLegalDoc('terms')} />
                  <ActionRow icon={ShieldCheck} iconColor="#6b7280" label="Privacy Policy" onClick={() => setLegalDoc('privacy')} />
                </SettingsCard>

                <SettingsCard title="FAQ">
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
                    <div key={q} className="border-b border-[var(--border)] last:border-b-0">
                      <button
                        onClick={() => setOpenAbout(openAbout === q ? null : q)}
                        className="flex items-center justify-between gap-3 w-full py-3 min-h-[52px] text-left"
                      >
                        <span className="text-text-primary text-[15px]">{q}</span>
                        <ChevronDown size={16} className={`text-text-muted transition-transform duration-150 shrink-0 ${openAbout === q ? 'rotate-180' : ''}`} />
                      </button>
                      {openAbout === q && (
                        <div className="pb-3 -mt-1">
                          <p className="text-text-muted text-[13px] leading-relaxed">{a}</p>
                          {link && (
                            <button
                              onClick={() => openMainView('docs')}
                              className="mt-2 inline-block text-[13px] text-accent">
                              {link.text}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </SettingsCard>
              </div>
            )}
          </div>
        )}

      {legalDoc && <LegalModal initialDoc={legalDoc} onClose={() => setLegalDoc(null)} />}

      {/* Picker sheet - the expanded form of whichever PickerRow was tapped
          (Skin / App font / Lyrics font), on the app's shared bottom-sheet
          primitive rather than a hand-rolled portal. */}
      {pickerOpen && (
        <Sheet
          onClose={() => setPickerOpen(null)}
          title={pickerOpen === 'skin' ? 'Skin' : pickerOpen === 'appFont' ? 'App font' : 'Lyrics font'}
        >
          <div className="px-4 pt-2">
            {pickerOpen === 'skin' && skinGrid}
            {pickerOpen === 'appFont' && fontListPicker(appFont, setAppFont)}
            {pickerOpen === 'lyricsFont' && fontListPicker(lyricsFont, setLyricsFont)}
          </div>
        </Sheet>
      )}
    </div>
  )
}
