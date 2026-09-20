import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import {
  Search, Play, Loader2, Music2, X, Check,
  LayoutList, Rows3, Info, ListPlus, ListFilter,
  ChevronUp, ChevronDown, MoreHorizontal, Plus, ListMusic, PackageOpen,
  CheckSquare2, Square, Link2, Layers, LayoutGrid, Mic2, CalendarDays, ChevronLeft, ChevronRight, Users,
  AlertTriangle, Pencil, Clock, Timer, User, MapPin, Folder, SlidersHorizontal, Download, Type, BarChart3,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongContextMenu from './SongContextMenu'
import FilePickerModal from './FilePickerModal'
import { CompactGroupRow, useExpandedGroups } from './CompactGroupRow'
import {
  apiFetch, apiPeek, songToTrack, parseDuration, buildStreamUrl, CATEGORY_LABELS, CATEGORY_COLORS,
  JWApiSong, JWApiPaginatedResponse, JWApiStats, JWApiEra,
  parseBrowseEntries, JWApiBrowseResponse, resolveSessionEditSource,
} from '../lib/juicewrldApi'
import { triggerDownload } from '../lib/apiFilesShared'
import { fisherYates } from '../store/queueSlice'
import { Track } from '../types'
import * as userApi from '../lib/userApi'
import { useCanEdit, useCanContribute } from '../hooks/useChannelRoles'
import { loadRecentlyAddedMap } from '../lib/changesApi'
import { loadSessionEditLinks } from '../lib/sessionEditsApi'
import { peekSessionEditOverride, setSessionEditOverride } from '../lib/sessionEditOverrides'
import { versionsEnabled, linkSongVersion, getOwnVersionMeta, setGroupVersionTitle } from '../lib/versionsApi'
import type { SongVersionMeta } from '../lib/versionsApi'
import { fetchAllCompactGroups, filterCompactGroups, invalidateCompactGroupsCache, subscribeCompactGroupsInvalidation } from '../lib/compactGroups'
import type { CompactGroup } from '../lib/compactGroups'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { runLog } from '../lib/runLog'
import { formatDuration } from '../lib/format'
import { parseSearchQuery, matchesFieldFilters, SEARCH_FIELD_HELP } from '../lib/trackerSearch'
import { loadEraFullNames, eraLabel, listEras } from '../lib/eras'
import { useMultiSelect } from '../hooks/useMultiSelect'
import { useLongPress } from '../hooks/useLongPress'
import {
  Category, ViewMode, TrackerTab, TRACKER_TABS, isTrackerTab,
  EraColor, ERA_COLOR_PALETTE, DEFAULT_ERA_COLOR, GROUP_CATEGORY_PRIORITY, groupCategory,
  PAGE_SIZE, LS_TRACKER_SEARCH, MIN_PLAUSIBLE_RECORD_YEAR, getInitialSearch,
  SNIPPET_CONTEXT_CHARS, getLyricSnippet, MONTH_LABELS, buildMonthGrid,
  extractDateKeys, dateKey,
} from '../lib/apiTrackerShared'

const LS_TRACKER_VIEW = 'api-tracker:viewMode'
const LS_TRACKER_COMPACT = 'api-tracker:compactView'
const LS_TRACKER_CALENDAR_MONTH = 'api-tracker:calendarMonth'
const LS_TRACKER_CATEGORY_FILTER = 'api-tracker:categoryFilter'
const LS_TRACKER_ERA_FILTER = 'api-tracker:eraFilter'
const LS_TRACKER_ORDER_FIELD = 'api-tracker:orderField'
const LS_TRACKER_ORDER_DIR = 'api-tracker:orderDir'

let savedTrackerScrollTop = 0

function getInitialSetFilter(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch { return new Set() }
}

function safeSetLS(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch (e) { console.warn(`[ApiTrackerView] failed to save "${key}":`, e) }
}

function safeRemoveLS(key: string): void {
  try { localStorage.removeItem(key) } catch (e) { console.warn(`[ApiTrackerView] failed to remove "${key}":`, e) }
}

type OrderField = 'name' | 'credited_artists' | 'era__name' | 'category' | 'length' | 'date_added'

// Defined at module scope (not inline in render) so React keeps a stable
// component identity across re-renders - an inline definition gets recreated
// every render, which makes React unmount/remount the buttons on every
// state update (e.g. every page loaded while sorting), causing a visible
// flicker instead of a smooth active/inactive toggle.
const SortBtn = ({ field, label, className, orderField, orderDir, onClick }: {
  field: OrderField
  label: string
  className?: string
  orderField: OrderField | null
  orderDir: 'asc' | 'desc'
  onClick: (field: OrderField) => void
}): JSX.Element => {
  const active = orderField === field
  return (
    <button
      onClick={() => onClick(field)}
      className={`flex items-center gap-0.5 text-xs font-medium uppercase tracking-wider transition-colors ${active ? 'text-accent' : 'text-text-muted hover:text-text-secondary'} ${className ?? ''}`}
    >
      {label}
      {active
        ? orderDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
        : <span className="w-2.5" />}
    </button>
  )
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Search syntax help popover ────────────────────────────────────────────────
// Explains the field:"value" query syntax (trackerSearch.ts) that the search
// box's info button opens. Closes on outside click/Escape like the other
// popovers/menus in this file.
function SearchHelpPopover({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-72 max-h-80 overflow-y-auto bg-surface border border-[var(--border)] rounded-xl shadow-2xl z-50 p-3"
    >
      <p className="text-text-primary text-xs font-semibold mb-1">Search syntax</p>
      <p className="text-text-muted text-xs mb-2.5 leading-snug">
        Search any field directly with <code className="text-text-secondary bg-surface-overlay px-1 py-0.5 rounded">field:"value"</code>.
        Combine with plain words and multiple fields - matches are case-insensitive substrings, all filters must match.
        An optional <code className="text-text-secondary bg-surface-overlay px-1 py-0.5 rounded">&</code> between
        fields is just for readability, e.g. <code className="text-text-secondary bg-surface-overlay px-1 py-0.5 rounded">artists:"Juice WRLD" &amp; category:unreleased</code>.
      </p>
      <div className="grid grid-cols-1 gap-1">
        {SEARCH_FIELD_HELP.map(({ field, example }) => (
          <div key={field} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-text-muted shrink-0">{field}</span>
            <code className="text-text-secondary bg-surface-overlay px-1.5 py-0.5 rounded truncate">{example}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────
function StatsBar({ stats }: { stats: JWApiStats | null }): JSX.Element {
  if (!stats) return <div className="h-8 bg-surface-raised animate-pulse rounded-xl mb-3" />
  const cats: [string, number][] = [
    ['Released', stats.category_stats.released],
    ['Unreleased', stats.category_stats.unreleased],
    ['Unsurfaced', stats.category_stats.unsurfaced],
    ['Sessions', stats.category_stats.recording_session],
  ]
  return (
    <div className="flex items-center gap-3 mb-3 px-1 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-text-primary font-bold text-base">{stats.total_songs.toLocaleString()}</span>
        <span className="text-text-muted text-xs">songs</span>
      </div>
      <div className="w-px h-4 bg-[var(--border)] shrink-0" />
      {cats.map(([label, count]) => (
        <div key={label} className="flex items-center gap-1 shrink-0">
          <span className="text-text-muted text-xs">{label}</span>
          <span className="text-text-secondary text-xs font-medium">{count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Category sidebar ─────────────────────────────────────────────────────────
// Category/era are checkbox multi-selects (OR'd within each group) rather
// than the old radio-style single pick - "All" / "All eras" just clears the
// respective set instead of being one more option inside it.
const CAT_SIDEBAR: { key: Exclude<Category, ''>; label: string }[] = [
  { key: 'released',          label: 'Released' },
  { key: 'unreleased',        label: 'Unreleased' },
  { key: 'unsurfaced',        label: 'Unsurfaced' },
  { key: 'recording_session', label: 'Sessions' },
]

function SidebarCheckRow({ label, count, checked, onClick }: {
  label: string
  count?: number
  checked: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left ${
        checked ? 'bg-accent/12 text-accent font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
      }`}
    >
      {checked
        ? <CheckSquare2 size={14} className="text-accent shrink-0" />
        : <Square size={14} className="text-text-muted opacity-40 shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className={`text-[0.625rem] tabular-nums ml-1 ${checked ? 'text-accent/70' : 'text-text-muted'}`}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  )
}

// Popover version of the old always-on sidebar - opens from the filter
// button next to the search box, closes on outside click/Escape like
// SearchHelpPopover, and only takes up space while actually in use.
function FilterPopover({
  stats, eras, selectedCategories, selectedEras, onCategory, onEra, onClearCategories, onClearEras, onClearAll, onClose,
}: {
  stats: JWApiStats | null
  eras: JWApiEra[]
  selectedCategories: Set<Category>
  selectedEras: Set<string>
  onCategory: (c: Category) => void
  onEra: (e: string) => void
  onClearCategories: () => void
  onClearEras: () => void
  onClearAll: () => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const fullEraNames = useStore((s) => s.fullEraNames)

  useEffect(() => {
    const handle = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const counts: Record<string, number | undefined> = {
    released:          stats?.category_stats.released,
    unreleased:        stats?.category_stats.unreleased,
    unsurfaced:        stats?.category_stats.unsurfaced,
    recording_session: stats?.category_stats.recording_session,
  }
  const hasFilters = selectedCategories.size > 0 || selectedEras.size > 0

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-64 max-h-96 overflow-y-auto bg-surface border border-[var(--border)] rounded-xl shadow-2xl z-50 p-3"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-text-primary text-xs font-semibold">Filters</p>
        {hasFilters && (
          <button onClick={onClearAll} className="text-accent text-[0.6875rem] font-medium hover:underline">
            Clear all
          </button>
        )}
      </div>

      <p className="text-[0.625rem] font-bold uppercase tracking-widest text-text-muted pt-2 pb-1">Category</p>
      <div className="flex flex-col gap-0.5">
        <SidebarCheckRow
          label="All"
          count={stats?.total_songs}
          checked={selectedCategories.size === 0}
          onClick={onClearCategories}
        />
        {CAT_SIDEBAR.map((cat) => (
          <SidebarCheckRow
            key={cat.key}
            label={cat.label}
            count={counts[cat.key]}
            checked={selectedCategories.has(cat.key)}
            onClick={() => onCategory(cat.key)}
          />
        ))}
      </div>

      {eras.length > 0 && (
        <>
          <p className="text-[0.625rem] font-bold uppercase tracking-widest text-text-muted pt-3 pb-1">Era</p>
          <div className="flex flex-col gap-0.5">
            <SidebarCheckRow label="All eras" checked={selectedEras.size === 0} onClick={onClearEras} />
            {eras.map((era) => (
              <SidebarCheckRow
                key={era.id}
                label={eraLabel(era.name, fullEraNames)}
                checked={selectedEras.has(era.name)}
                onClick={() => onEra(era.name)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Context menu ─────────────────────────────────────────────────────────────
// Per-song right-click menu lives in SongContextMenu.tsx (shared across every
// place a song can be right-clicked - Tracker, Liked Songs, Playlists, the
// Player bar, WRLD). Only the bulk multi-select menu below is local to the
// Tracker, since bulk actions don't apply anywhere else.
interface BulkContextMenuState {
  x: number
  y: number
  showPlaylists: boolean
}

// Hoisted to module scope - defining this inside SongContextMenu's render body
// would give it a new function identity every render, causing React to
// unmount/remount every menu item button (and flicker any :hover state) on
// each re-render rather than just updating it.
function MenuItem({ icon, label, onClick, disabled, title }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string
}): JSX.Element {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      title={title}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
    >
      {icon}
      {label}
    </button>
  )
}

function BulkContextMenu({
  state,
  onClose,
  count,
  onAddToQueue,
  onDownloadZip,
  onTogglePlaylists,
  playlists,
  account,
  onAddToPlaylist,
  onLogin,
  canLinkVersions,
  onLinkVersions,
  canBulkEdit,
  onBulkEdit,
  canAddToPlaylist,
  canAddToQueue,
  contained,
}: {
  state: BulkContextMenuState
  onClose: () => void
  count: number
  onAddToQueue: () => void
  onDownloadZip: () => void
  onTogglePlaylists: () => void
  playlists: userApi.PlaylistSummary[]
  account: userApi.AccountUser | null
  onAddToPlaylist: (id: number) => void
  onLogin: () => void
  canLinkVersions: boolean
  onLinkVersions: () => void
  /** Editors/admins only - opens the bulk editor for the whole selection. */
  canBulkEdit: boolean
  onBulkEdit: () => void
  /** False when any selected song is a session/unsurfaced (playlists don't
   *  support those) - hides "Add to playlist" entirely rather than silently
   *  adding only the eligible ones. */
  canAddToPlaylist: boolean
  /** False unless every selected song is both eligible and has a path. */
  canAddToQueue: boolean
  /** Playlist ids that already contain every eligible selected song. */
  contained: Set<number>
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const menuWidth = 208
  const menuHeight = state.showPlaylists ? 320 : 160
  const top = Math.max(8, Math.min(state.y, window.innerHeight - menuHeight - 8))
  const left = Math.max(8, Math.min(state.x, window.innerWidth - menuWidth - 8))

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', zIndex: 9999, top, left }}
      className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
    >
      <div className="px-3 py-2 border-b border-[var(--border)] mb-1">
        <p className="text-text-primary text-xs font-semibold truncate">{count} {count === 1 ? 'song' : 'songs'} selected</p>
      </div>

      {state.showPlaylists ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePlaylists() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronDown size={12} className="rotate-90" /> Back
          </button>
          {!account ? (
            <div className="px-3 pb-2">
              <p className="text-xs text-text-muted mb-2">Log in to save to playlists.</p>
              <button
                onClick={(e) => { e.stopPropagation(); onLogin() }}
                className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
              >
                Log in
              </button>
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              {playlists.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
              )}
              {playlists.map((p) => {
                const allIn = contained.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={(e) => { e.stopPropagation(); onAddToPlaylist(p.id) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                  >
                    <ListMusic size={13} className={`shrink-0 ${allIn ? 'text-accent' : 'text-text-muted'}`} />
                    <span className="flex-1 truncate text-xs">{p.name}</span>
                    {allIn && <Check size={12} className="text-accent shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <MenuItem
            icon={<ListPlus size={14} />}
            label="Add to queue"
            onClick={onAddToQueue}
            disabled={!canAddToQueue}
            title={!canAddToQueue ? "Sessions/unsurfaced songs can't be queued" : undefined}
          />
          {canAddToPlaylist && (
            <MenuItem icon={<Plus size={14} />} label="Add to playlist" onClick={onTogglePlaylists} />
          )}
          {canLinkVersions && (
            <MenuItem icon={<Link2 size={14} />} label="Link versions" onClick={onLinkVersions} />
          )}
          {canBulkEdit && (
            <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={onBulkEdit} />
          )}
          <div className="my-1 border-t border-[var(--border)]" />
          <MenuItem icon={<PackageOpen size={14} />} label="Download" onClick={onDownloadZip} />
        </>
      )}
    </div>
  )
}

// ─── Action buttons (shared) ──────────────────────────────────────────────────
function SongActions({
  onInfo, onContextMenu, size = 14,
}: {
  onInfo: () => void
  onContextMenu: (e: React.MouseEvent) => void
  size?: number
}): JSX.Element {
  return (
    <>
      <button
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-text-primary transition-all shrink-0"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onInfo() }}
        title="Song info"
      >
        <Info size={size} />
      </button>
      <button
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-text-primary transition-all shrink-0"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
        title="More options"
      >
        <MoreHorizontal size={size} />
      </button>
    </>
  )
}

// ─── Song row (list mode) ─────────────────────────────────────────────────────
const SongRow = memo(function SongRow({
  song, onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect, versionLabel, compact,
}: {
  song: JWApiSong
  onPlay: (song: JWApiSong) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
  /** Shown next to the title when this row is a member of a compact-view
   *  group (e.g. "v1", "TV Mix") - this song's own label within the group. */
  versionLabel?: string | null
  /** Compact-view member row: hides the Artist/Era columns (the compact
   *  header has no columns for them) so the Category badge lines up under
   *  the same header cell whether the row above it is a collapsed group
   *  or an expanded version. */
  compact?: boolean
}): JSX.Element {
  // This song's personal override, if any. Selecting just this song's row keeps
  // the map's other churn from re-rendering the row, and songToTrack picks up
  // the custom cover from the same source on the render this triggers.
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const altTitles = song.track_titles ?? []
  const canPlay = !!song.path
  const longPress = useLongPress()

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 md:py-2 hover:bg-surface-overlay active:bg-surface-overlay rounded-lg transition-colors cursor-default ${selected ? 'bg-accent/10' : ''}`}
      onClick={(e) => { if (longPress.consumeFired()) return; if (e.ctrlKey || e.metaKey || selectMode) onToggleSelect(song) }}
      onDoubleClick={() => { if (!selectMode) onPlay(song) }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(song, e) }}
      {...longPress.bind(() => onToggleSelect(song))}
    >
      {selectMode && (
        <div className="shrink-0">
          {selected
            ? <CheckSquare2 size={17} className="text-accent" />
            : <Square size={17} className="text-text-muted opacity-50" />}
        </div>
      )}

      {/* Cover art */}
      <div className="relative shrink-0 w-10 h-10 md:w-9 md:h-9 rounded overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={36} shimmer={false} eager />
        {canPlay && !selectMode && (
          <button
            className="absolute inset-0 items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
            onClick={(e) => { e.stopPropagation(); onPlay(song) }}
            title="Play"
          >
            <Play size={14} fill="white" className="text-white ml-0.5" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-[100px]">
        <p className="text-text-primary text-sm font-medium truncate">
          {title}
          {versionLabel && <span className="text-text-muted font-normal"> ({versionLabel})</span>}
        </p>
        <p className="md:hidden text-text-muted text-xs truncate mt-0.5">
          {song.credited_artists || 'Juice WRLD'}
          {song.era?.name ? ` · ${eraLabel(song.era.name, fullEraNames)}` : ''}
        </p>
        {altTitles.length > 0 && (
          <p className="hidden md:block text-text-muted text-xs truncate">{altTitles.join(' · ')}</p>
        )}
      </div>

      {/* Desktop-only columns - omitted in compact view, which has no
          Artist/Era header cells for them to line up under. */}
      {!compact && (
        <>
          <span className="hidden md:block text-text-muted text-xs truncate w-32 shrink-0">{song.credited_artists || 'Juice WRLD'}</span>
          {song.era?.name ? (
            selectMode ? (
              <span className="hidden md:block text-text-muted text-xs truncate w-36 shrink-0">{eraLabel(song.era.name, fullEraNames)}</span>
            ) : (
              <button
                onClick={() => onEraClick(song.era!.name)}
                className="hidden md:block text-text-muted text-xs truncate w-36 shrink-0 text-left hover:text-accent transition-colors"
                title={`Filter by era: ${eraLabel(song.era.name, fullEraNames)}`}
              >
                {eraLabel(song.era.name, fullEraNames)}
              </button>
            )
          ) : (
            <span className="hidden md:block text-text-muted text-xs truncate w-36 shrink-0">—</span>
          )}
        </>
      )}
      {selectMode ? (
        <span className={`hidden md:block text-xs px-1.5 py-0.5 rounded border shrink-0 w-24 text-center ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}>
          {CATEGORY_LABELS[song.category] ?? song.category}
        </span>
      ) : (
        <button
          onClick={() => onCategoryClick(song.category as Category)}
          className={`hidden md:block text-xs px-1.5 py-0.5 rounded border shrink-0 w-24 text-center transition-colors hover:opacity-80 ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}
          title="Filter by category"
        >
          {CATEGORY_LABELS[song.category] ?? song.category}
        </button>
      )}
      <span className="hidden md:block text-text-muted text-xs w-12 text-right shrink-0 tabular-nums">{formatDuration(parseDuration(song.length), '--:--')}</span>

      {/* Desktop action buttons */}
      {!selectMode && (
        <div className="hidden md:flex items-center gap-0.5 shrink-0">
          <SongActions onInfo={() => onInfo(song)} onContextMenu={(e) => onContextMenu(song, e)} />
        </div>
      )}

      {/* Mobile: more + play */}
      {!selectMode && (
        <div className="md:hidden flex items-center shrink-0">
          <button
            className="p-2 text-text-muted active:text-accent transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onContextMenu(song, e) }}
            title="More options"
          >
            <MoreHorizontal size={16} />
          </button>
          {canPlay && (
            <button
              className="p-2 text-text-muted active:text-accent transition-colors"
              onClick={() => onPlay(song)}
              title="Play"
            >
              <Play size={17} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})
// Memoized so toggling one selection only re-renders that row, not every
// rendered row. This depends on all the callbacks passed in (onPlay, onInfo,
// onContextMenu, onCategoryClick, onEraClick, onToggleSelect) being stable
// (useCallback) - otherwise the default shallow prop compare never matches and
// the memo is a no-op. Without it, compact view froze when selecting songs
// across many expanded groups.

// ─── Song row (detailed mode) ─────────────────────────────────────────────────
// One labeled metadata cell in the detailed-row field grid. Values are
// single-line truncated (full text on hover via title) so every row keeps
// the fixed height the virtual window depends on.
function DetailField({ label, value, className }: {
  label: string
  value: string | null | undefined
  className?: string
}): JSX.Element {
  const v = value?.trim() || ''
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      {/* rem-valued rather than `text-[9px]` so the label tracks app text size
          like the value below it does - see useScaledRowH. */}
      <p className="text-[0.5625rem] uppercase tracking-wider text-text-muted/70 leading-tight truncate">{label}</p>
      <p className={`text-xs truncate ${v ? 'text-text-secondary' : 'text-text-muted/50'}`} title={v || undefined}>
        {v || '—'}
      </p>
    </div>
  )
}

// Detailed view trades row density for inline metadata: the fields that
// otherwise only show up in SongInfoModal (producers, engineers, recording
// dates/locations, leak info, file names…) are laid out in a fixed grid on
// every row. The grid is a *fixed* set of cells (empty ones render "—")
// so all rows share one height - required by the virtual window's fixed
// stride. Mobile shows a 2-column subset; md: widens to 4 columns and adds
// the rarer fields.
const DetailedSongRow = memo(function DetailedSongRow({
  song, onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: {
  song: JWApiSong
  onPlay: (song: JWApiSong) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
}): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const altTitles = song.track_titles ?? []
  const longPress = useLongPress()

  return (
    <div
      className={`group flex gap-3 px-3 py-2 h-full overflow-hidden rounded-lg border border-[var(--border)] hover:bg-surface-overlay active:bg-surface-overlay transition-colors cursor-default ${selected ? 'bg-accent/10' : ''}`}
      onClick={(e) => { if (longPress.consumeFired()) return; if (e.ctrlKey || e.metaKey || selectMode) onToggleSelect(song) }}
      onDoubleClick={() => { if (!selectMode) onPlay(song) }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(song, e) }}
      {...longPress.bind(() => onToggleSelect(song))}
    >
      {selectMode && (
        <div className="shrink-0 pt-1">
          {selected
            ? <CheckSquare2 size={17} className="text-accent" />
            : <Square size={17} className="text-text-muted opacity-50" />}
        </div>
      )}

      {/* Cover art */}
      <div className="relative shrink-0 w-12 h-12 md:w-14 md:h-14 rounded overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={56} shimmer={false} eager />
        {canPlay && !selectMode && (
          <button
            className="absolute inset-0 items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
            onClick={(e) => { e.stopPropagation(); onPlay(song) }}
            title="Play"
          >
            <Play size={16} fill="white" className="text-white ml-0.5" />
          </button>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {/* Title row: name + artist + era/category badges + duration + actions */}
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-text-primary text-sm font-medium truncate">{title}</p>
          <span className="hidden md:block text-text-muted text-xs truncate shrink-0 max-w-[160px]">
            {song.credited_artists || 'Juice WRLD'}
          </span>
          {song.era?.name && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!selectMode) onEraClick(song.era!.name) }}
              className="hidden md:block text-text-muted text-[0.5625rem] uppercase tracking-wide bg-surface px-1.5 py-0.5 rounded border border-[var(--border)] truncate max-w-[140px] shrink-0 hover:text-accent hover:border-accent/40 transition-colors"
              title={`Filter by era: ${eraLabel(song.era.name, fullEraNames)}`}
            >
              {eraLabel(song.era.name, fullEraNames)}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (!selectMode) onCategoryClick(song.category as Category) }}
            className={`hidden md:block text-[0.5625rem] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 transition-colors hover:opacity-80 ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}
            title="Filter by category"
          >
            {CATEGORY_LABELS[song.category] ?? song.category}
          </button>
          <span className="ml-auto text-text-muted text-xs shrink-0 tabular-nums">{formatDuration(parseDuration(song.length), '--:--')}</span>
          {!selectMode && (
            <div className="hidden md:flex items-center gap-0.5 shrink-0">
              <SongActions onInfo={() => onInfo(song)} onContextMenu={(e) => onContextMenu(song, e)} />
            </div>
          )}
          {!selectMode && (
            <div className="md:hidden flex items-center shrink-0">
              <button
                className="p-1 text-text-muted active:text-accent transition-colors"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onContextMenu(song, e) }}
                title="More options"
              >
                <MoreHorizontal size={16} />
              </button>
              {canPlay && (
                <button
                  className="p-1 text-text-muted active:text-accent transition-colors"
                  onClick={(e) => { e.stopPropagation(); onPlay(song) }}
                  title="Play"
                >
                  <Play size={16} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile subtitle - artist/era/category live here instead of badges */}
        <p className="md:hidden text-text-muted text-xs truncate mt-0.5">
          {song.credited_artists || 'Juice WRLD'}
          {song.era?.name ? ` · ${eraLabel(song.era.name, fullEraNames)}` : ''}
          {` · ${CATEGORY_LABELS[song.category] ?? song.category}`}
        </p>

        {/* Metadata field grid - fixed cell set so every row is the same height */}
        <div className="mt-1.5 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
          <DetailField label="Producers" value={song.producers} />
          <DetailField label="Engineers" value={song.engineers} />
          <DetailField label="Recording Locations" value={song.recording_locations} className="hidden md:block" />
          <DetailField label="Record Dates" value={song.record_dates} />
          <DetailField label="Leak Type" value={song.leak_type} />
          <DetailField label="Date Leaked" value={song.date_leaked} className="hidden md:block" />
          <DetailField label="Bitrate" value={song.bitrate} />
          <DetailField label="Release Date" value={song.release_date} className="hidden md:block" />
          <DetailField label="File Names" value={song.file_names} className="hidden md:block" />
          {/* Title fields grouped together - `original_key` is the source-JSON
              key (a name), not a musical key. */}
          <DetailField label="Original Name" value={song.original_key} />
          <DetailField label="Session Titles" value={song.session_titles} className="hidden md:block" />
          <DetailField label="Alt Titles" value={altTitles.join(' · ')} className="hidden md:block" />
        </div>
      </div>
    </div>
  )
})

// ─── Virtualized lists ────────────────────────────────────────────────────────
// Row heights in this view are responsive (40px thumb + py-2.5 on mobile,
// 36px + py-2 at md:), so the virtual-window strides below need to know
// which side of the md: breakpoint we're on.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent): void => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

// Rows are absolutely positioned at a fixed pixel stride so the virtual window
// can place them without measuring the DOM - but their contents are rem-sized,
// so Settings → App text size grows the text inside a box that would otherwise
// stay put. The row clips its overflow and the page scroller only knows about
// the (unchanged) total height, so the spilled text isn't merely ugly, it's
// unreachable. Scaling the stride by the same factor keeps the box and its
// contents in step.
function useScaledRowH(desktopH: number, mobileH: number): number {
  const isDesktop = useIsDesktop()
  const appTextScale = useStore((s) => s.appTextScale)
  return Math.round((isDesktop ? desktopH : mobileH) * appTextScale)
}

// ─── Compact-view group list (virtualized) ────────────────────────────────────
// Compact view renders every titled version group app-wide (1200+ rows, each
// with cover art). Mounted all at once, that's enough DOM that a single
// expand/collapse (one relayout + style recalc across all of it) could hang
// the renderer outright - the same many-rows failure mode useVirtualWindow
// already solves for the local library. Groups and the expanded groups'
// member rows are flattened into one fixed-stride row list so only the
// visible slice is ever mounted.
type CompactListRow =
  | { key: string; kind: 'group'; group: CompactGroup<JWApiSong> }
  | { key: string; kind: 'member'; item: JWApiSong; meta: SongVersionMeta; isLast: boolean }

function CompactGroupList({
  scrollRef, groups, expanded, onToggleGroup, onGroupContextMenu,
  onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: {
  scrollRef: React.RefObject<HTMLDivElement>
  groups: CompactGroup<JWApiSong>[]
  expanded: Set<number>
  onToggleGroup: (group: CompactGroup<JWApiSong>) => void
  onGroupContextMenu: (group: CompactGroup<JWApiSong>, e: React.MouseEvent) => void
  onPlay: (song: JWApiSong) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: Map<number, JWApiSong>
  onToggleSelect: (song: JWApiSong) => void
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)

  // Row stride mirrors CompactGroupRow/SongRow's natural height plus the 2px
  // gap the old space-y-0.5 flow layout provided - absolutely positioned rows
  // have to encode that spacing themselves.
  const rowH = useScaledRowH(52, 60)
  const stride = rowH + 2

  const rows = useMemo(() => {
    const out: CompactListRow[] = []
    for (const group of groups) {
      out.push({ key: `g${group.groupId}`, kind: 'group', group })
      if (expanded.has(group.groupId)) {
        group.members.forEach((m, i) => out.push({
          key: `g${group.groupId}-s${m.item.id}`, kind: 'member',
          item: m.item, meta: m.meta, isLast: i === group.members.length - 1,
        }))
      }
    }
    return out
  }, [groups, expanded])

  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rows.length, stride)

  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {rows.slice(start, end).map((row, i) => {
        const top = (start + i) * stride
        if (row.kind === 'group') {
          const cat = groupCategory(row.group.members)
          return (
            <div key={row.key} style={{ position: 'absolute', top, left: 0, right: 0, height: rowH }}>
              <CompactGroupRow
                coverTrack={songToTrack(row.group.members[0].item)}
                title={row.group.title}
                count={row.group.members.length}
                expanded={expanded.has(row.group.groupId)}
                onToggle={() => onToggleGroup(row.group)}
                onContextMenu={(e) => onGroupContextMenu(row.group, e)}
                categoryLabel={CATEGORY_LABELS[cat] ?? cat}
                categoryClassName={CATEGORY_COLORS[cat]}
              />
            </div>
          )
        }
        return (
          <div
            key={row.key}
            className="ml-4 pl-4 border-l border-[var(--border)]"
            // Non-last member wrappers span the full stride so the indent
            // rail stays continuous across the 2px row gap.
            style={{ position: 'absolute', top, left: 0, right: 0, height: row.isLast ? rowH : stride }}
          >
            <SongRow
              song={row.item}
              onPlay={onPlay}
              onCategoryClick={onCategoryClick}
              onEraClick={onEraClick}
              onInfo={onInfo}
              onContextMenu={onContextMenu}
              selectMode={selectMode}
              selected={selected.has(row.item.id)}
              onToggleSelect={onToggleSelect}
              versionLabel={row.meta.version}
              compact
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── Flat song list / grid (virtualized) ──────────────────────────────────────
// The flat views accumulate without bound - infinite scroll appends pages
// forever, and sort mode outright loads the whole ~2500-song catalog (that
// load is what originally hung the renderer hard enough to look like a PC
// freeze; see the tracker-sort runLog breadcrumbs). Windowing caps the
// mounted rows/cards at what's visible regardless of how many songs are
// loaded.
interface VirtualSongsProps {
  scrollRef: React.RefObject<HTMLDivElement>
  songs: JWApiSong[]
  onPlay: (song: JWApiSong) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: Map<number, JWApiSong>
  onToggleSelect: (song: JWApiSong) => void
}

function VirtualSongList({
  scrollRef, songs, onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: VirtualSongsProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rowH = useScaledRowH(52, 60)
  const stride = rowH + 2 // + the old space-y-0.5 gap
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, songs.length, stride)
  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {songs.slice(start, end).map((song, i) => (
        <div key={song.id} style={{ position: 'absolute', top: (start + i) * stride, left: 0, right: 0, height: rowH }}>
          <SongRow
            song={song}
            onPlay={onPlay}
            onCategoryClick={onCategoryClick}
            onEraClick={onEraClick}
            onInfo={onInfo}
            onContextMenu={onContextMenu}
            selectMode={selectMode}
            selected={selected.has(song.id)}
            onToggleSelect={onToggleSelect}
          />
        </div>
      ))}
    </div>
  )
}

// Detailed rows are taller than list rows (title line + a 3-row metadata
// grid - 4 columns at md:, 2 on mobile), but still fixed-height -
// DetailedSongRow clips overflow, so the stride below just has to match its
// natural height with a little headroom.
const DETAIL_ROW_H_DESKTOP = 136
const DETAIL_ROW_H_MOBILE = 152
const DETAIL_ROW_GAP = 6 // bordered card-style rows want more breathing room than the flat list's 2px

function VirtualSongDetailList({
  scrollRef, songs, onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: VirtualSongsProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rowH = useScaledRowH(DETAIL_ROW_H_DESKTOP, DETAIL_ROW_H_MOBILE)
  const stride = rowH + DETAIL_ROW_GAP
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, songs.length, stride)
  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {songs.slice(start, end).map((song, i) => (
        <div key={song.id} style={{ position: 'absolute', top: (start + i) * stride, left: 0, right: 0, height: rowH }}>
          <DetailedSongRow
            song={song}
            onPlay={onPlay}
            onCategoryClick={onCategoryClick}
            onEraClick={onEraClick}
            onInfo={onInfo}
            onContextMenu={onContextMenu}
            selectMode={selectMode}
            selected={selected.has(song.id)}
            onToggleSelect={onToggleSelect}
          />
        </div>
      ))}
    </div>
  )
}

// ─── Song card (grid mode) ────────────────────────────────────────────────────
// Mirrors juicewrldapi.com's own grid card: a wide cover with the category
// badge pinned to it, then the title, a fixed stack of primary metadata lines,
// the collapsible detail sections (Engineers / Recording Details / File Names /
// Instrumentals / Additional Info / Important Dates), and a queue · play ·
// download footer.
//
// Every fixed part of the card is given an explicit height below so the grid
// can compute row offsets without measuring the DOM - see GRID_* constants and
// VirtualSongGrid. That's also why the primary metadata lines and the section
// headers always render (empty values fall back to "—") instead of being
// dropped when a song lacks them.

interface CardSection {
  key: string
  label: string
  icon: JSX.Element
  /** Label/value pairs shown when the section is expanded. */
  fields: (song: JWApiSong) => [string, string | null | undefined][]
}

const CARD_SECTIONS: CardSection[] = [
  {
    key: 'engineers', label: 'Engineers', icon: <Users size={13} />,
    fields: (s) => [['Engineers', s.engineers]],
  },
  {
    key: 'recording', label: 'Recording Details', icon: <MapPin size={13} />,
    fields: (s) => [
      ['Locations', s.recording_locations],
      ['Record Dates', s.record_dates],
      ['Bitrate', s.bitrate],
    ],
  },
  // `original_key` is the song's key in the API's source JSON (the docs call it
  // "Original JSON Key"), not a musical key - findSessionZips searches on it as
  // a stand-in for the name. It reads as a title, so it belongs with the other
  // title fields rather than next to Bitrate under Recording Details, where the
  // label invited exactly the wrong reading.
  {
    key: 'titles', label: 'Titles', icon: <Type size={13} />,
    fields: (s) => [
      ['Original Name', s.original_key],
      ['Session Titles', s.session_titles],
      ['Alt Titles', (s.track_titles ?? []).join(' · ')],
    ],
  },
  {
    key: 'files', label: 'File Names', icon: <Folder size={13} />,
    fields: (s) => [['File Names', s.file_names]],
  },
  {
    key: 'instrumentals', label: 'Instrumentals', icon: <SlidersHorizontal size={13} />,
    fields: (s) => [
      ['Instrumentals', s.instrumentals],
      ['Instrumental Names', s.instrumental_names],
    ],
  },
  {
    key: 'additional', label: 'Additional Info', icon: <Info size={13} />,
    fields: (s) => [
      ['Additional Information', s.additional_information],
      ['Notes', s.notes],
    ],
  },
  {
    key: 'dates', label: 'Important Dates', icon: <CalendarDays size={13} />,
    fields: (s) => [
      ['Date Leaked', s.date_leaked],
      ['Preview Date', s.preview_date],
      ['Release Date', s.release_date],
      ['Dates', s.dates],
    ],
  },
]

// One primary metadata line (icon + text), fixed height (scaled by app text size).
function CardMetaLine({ icon, height, children }: { icon: JSX.Element; height: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-text-secondary text-[0.6875rem]" style={{ height }}>
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="truncate min-w-0">{children}</span>
    </div>
  )
}

const SongCard = memo(function SongCard({
  song, coverH, m, onPlay, onQueue, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect, expandedSections, onToggleSection,
}: {
  song: JWApiSong
  /** Cover height in px (3:2 of the card width). */
  coverH: number
  /** Box heights for the card's fixed sections, scaled by app text size. */
  m: GridMetrics
  onPlay: (song: JWApiSong) => void
  onQueue: (track: Track) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
  /** Section keys currently open on this card. Owned by the grid, since row
   *  heights depend on how many sections are expanded. */
  expandedSections: ReadonlySet<string>
  onToggleSection: (songId: number, sectionKey: string) => void
}): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const longPress = useLongPress()

  // The site's status line: leak type, then the release/leak date after it.
  const statusDate = song.release_date
    ? `Released ${song.release_date}`
    : song.date_leaked ? `Leaked ${song.date_leaked}` : ''

  return (
    // Hover highlights the border only. Tinting the card body would land on the
    // same color as the section header boxes below, which reads as those boxes
    // disappearing under the cursor.
    <div
      className={`group flex flex-col h-full overflow-hidden rounded-xl border bg-surface transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-[var(--border)] hover:border-accent/40'}`}
      onClick={(e) => { if (longPress.consumeFired()) return; if (e.ctrlKey || e.metaKey || selectMode) onToggleSelect(song) }}
      onDoubleClick={() => { if (!selectMode) onPlay(song) }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(song, e) }}
      {...longPress.bind(() => onToggleSelect(song))}
    >
      {/* Cover */}
      <div className="relative shrink-0 w-full bg-surface-overlay" style={{ height: coverH }}>
        {/* fill mode: the art covers the 3:2 box rather than taking a square
            px size, so covers crop the way the site's grid does. */}
        <AlbumArtThumbnail track={track} fill className="w-full h-full" shimmer={false} eager />

        {selectMode ? (
          <div className="absolute top-2 left-2">
            {selected
              ? <CheckSquare2 size={18} className="text-accent drop-shadow" />
              : <Square size={18} className="text-white/80 drop-shadow" />}
          </div>
        ) : (
          canPlay && (
            <button
              className="absolute inset-0 hidden md:flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onPlay(song) }}
              title="Play"
            >
              <span className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                <Play size={18} fill="black" className="text-black ml-0.5" />
              </span>
            </button>
          )
        )}

        {/* Category badge - the site pins it to the cover's top-right corner */}
        {selectMode ? (
          <span className={`absolute top-2 right-2 text-[0.625rem] font-medium px-2 py-0.5 rounded-full border backdrop-blur-sm ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}>
            {CATEGORY_LABELS[song.category] ?? song.category}
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onCategoryClick(song.category as Category) }}
            className={`absolute top-2 right-2 text-[0.625rem] font-medium px-2 py-0.5 rounded-full border backdrop-blur-sm transition-opacity hover:opacity-80 ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}
            title="Filter by category"
          >
            {CATEGORY_LABELS[song.category] ?? song.category}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col px-3 py-3 min-w-0" style={{ height: m.bodyH }}>
        <p
          className="text-text-primary text-sm font-semibold leading-tight overflow-hidden shrink-0"
          style={{ height: m.titleH, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
          title={title}
        >
          {title}
        </p>

        <div className="mt-1.5 shrink-0">
          <CardMetaLine icon={<Clock size={m.iconSize} />} height={m.metaRowH}>
            {song.era?.name ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (!selectMode) onEraClick(song.era!.name) }}
                className="hover:text-accent transition-colors"
                title={`Filter by era: ${eraLabel(song.era.name, fullEraNames)}`}
              >
                Era: {eraLabel(song.era.name, fullEraNames)}
              </button>
            ) : <span className="text-text-muted">Era: —</span>}
          </CardMetaLine>
          <CardMetaLine icon={<User size={m.iconSize} />} height={m.metaRowH}>{song.credited_artists || 'Juice WRLD'}</CardMetaLine>
          <CardMetaLine icon={<Music2 size={m.iconSize} />} height={m.metaRowH}>
            {song.producers ? `Produced by: ${song.producers}` : <span className="text-text-muted">Produced by: —</span>}
          </CardMetaLine>
          <CardMetaLine icon={<Timer size={m.iconSize} />} height={m.metaRowH}>
            <span className="tabular-nums">{formatDuration(parseDuration(song.length), '--:--')}</span>
          </CardMetaLine>
          <CardMetaLine icon={<Info size={m.iconSize} />} height={m.metaRowH}>
            {song.leak_type || <span className="text-text-muted">—</span>}
            {statusDate && <span className="text-accent"> ({statusDate})</span>}
          </CardMetaLine>
        </div>

        {/* Collapsible detail sections */}
        <div className="mt-2 flex flex-col gap-1 shrink-0">
          {CARD_SECTIONS.map((section) => {
            const open = expandedSections.has(section.key)
            return (
              <div key={section.key}>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSection(song.id, section.key) }}
                  className={`w-full flex items-center gap-2 px-2 rounded-md border text-text-secondary text-[0.6875rem] transition-colors outline-none focus-visible:border-accent ${
                    open
                      ? 'bg-surface-raised border-accent/40 text-text-primary'
                      : 'bg-surface-overlay border-[var(--border)] hover:bg-surface-raised'
                  }`}
                  style={{ height: m.sectionH }}
                >
                  <span className="shrink-0 text-text-muted">{section.icon}</span>
                  <span className="truncate min-w-0 text-left flex-1">{section.label}</span>
                  <ChevronDown size={m.iconSize} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  // Fixed-height scroller: keeps the card's height a pure
                  // function of how many sections are open, which is what lets
                  // the grid position rows without measuring.
                  <div
                    className="mt-1 px-2 py-1.5 rounded-md bg-surface-overlay border border-[var(--border)] overflow-y-auto"
                    style={{ height: m.sectionBodyH }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {section.fields(song).map(([label, value]) => (
                      <div key={label} className="mb-1 last:mb-0">
                        <p className="text-[0.5625rem] uppercase tracking-wider text-text-muted/70 leading-tight">{label}</p>
                        <p className={`text-[0.6875rem] break-words ${value?.trim() ? 'text-text-secondary' : 'text-text-muted/50'}`}>
                          {value?.trim() || '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer: add to queue · play · download */}
        <div className="mt-auto pt-2 flex items-center gap-1.5 shrink-0" style={{ height: m.footerBoxH }}>
          <button
            onClick={(e) => { e.stopPropagation(); onQueue(track) }}
            disabled={!canPlay}
            className="shrink-0 h-full px-3 rounded-lg bg-surface-overlay hover:bg-surface-raised text-text-secondary disabled:opacity-40 transition-colors"
            title="Add to queue"
          >
            <ListPlus size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(song) }}
            disabled={!canPlay}
            className="flex-1 min-w-0 h-full flex items-center justify-center gap-1.5 rounded-lg bg-surface-overlay hover:bg-surface-raised text-text-primary text-xs font-medium disabled:opacity-40 transition-colors"
            title={canPlay ? 'Play' : 'No file available'}
          >
            <Play size={14} fill="currentColor" /> PLAY
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              const a = document.createElement('a')
              a.href = buildStreamUrl(song.path)
              a.download = `${title}.mp3`
              a.target = '_blank'
              a.rel = 'noopener noreferrer'
              document.body.appendChild(a); a.click(); document.body.removeChild(a)
            }}
            disabled={!canPlay}
            className="shrink-0 h-full px-3 rounded-lg bg-surface-overlay hover:bg-surface-raised text-text-secondary disabled:opacity-40 transition-colors"
            title="Download"
          >
            <Download size={15} />
          </button>
        </div>
      </div>
    </div>
  )
})

// ─── Song grid (virtualized) ──────────────────────────────────────────────────
// Cards are laid out on a row grid using the same windowing as the list views -
// a grid of 2500 of these cards is exactly the mount cost virtualization exists
// to avoid. Column count comes from the measured container width rather than
// Tailwind breakpoints, because the row offsets have to be computable in JS.
//
// Card height is deterministic: a fixed body (title clamped to two lines, five
// always-rendered metadata lines, six section headers, footer) plus a fixed
// block per *expanded* section. So a row's height only depends on the largest
// number of sections open on any card in it - no DOM measurement, and rows
// below an expanded card shift by a known amount.
const GRID_MIN_CARD_W = 260
const GRID_GAP = 12
const GRID_COVER_RATIO = 1.5      // cover is 3:2 of the card width

// Every box on a card is an explicit pixel height (see above), which is what
// makes row offsets computable - but it also means the card can't respond to
// Settings → App text size on its own. That setting scales the root font-size,
// so rem-based type grows while these constants don't, and the taller text just
// gets clipped by a box that stayed the same size. So the metrics are derived
// from the scale instead of being fixed: the card's own padding/gaps are rem
// (Tailwind spacing) and already scale, and multiplying the heights through
// keeps them in step. Card text uses rem-valued arbitrary sizes for the same
// reason - `text-[11px]` would ignore the setting entirely.
interface GridMetrics {
  titleH: number
  metaRowH: number
  sectionH: number
  sectionBodyH: number
  sectionGap: number
  footerH: number
  /** Footer row including its pt-2, which is what the card actually reserves. */
  footerBoxH: number
  bodyH: number
  sectionOpenH: number
  /** Icon px size for the glyphs sitting inline with card text. */
  iconSize: number
}

function gridMetrics(scale: number): GridMetrics {
  const px = (base: number): number => Math.round(base * scale)
  const titleH = px(38)             // two lines at leading-tight
  const metaRowH = px(20)
  const sectionH = px(28)
  const sectionBodyH = px(88)       // fixed-height scroller per expanded section
  const sectionGap = px(4)
  const footerH = px(34)
  return {
    titleH, metaRowH, sectionH, sectionBodyH, sectionGap, footerH,
    footerBoxH: footerH + px(8),
    // px-3 py-3 body + title + (mt-1.5 + 5 meta lines) + (mt-2 + headers + gaps) + footer
    bodyH:
      px(24) + titleH
      + px(6) + metaRowH * 5
      + px(8) + sectionH * CARD_SECTIONS.length + sectionGap * (CARD_SECTIONS.length - 1)
      + px(8) + footerH,
    // An expanded section adds its scroller plus the mt-1 above it.
    sectionOpenH: sectionBodyH + px(4),
    iconSize: px(13),
  }
}

function useElementWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

function VirtualSongGrid({
  scrollRef, songs, onPlay, onQueue, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: VirtualSongsProps & { onQueue: (track: Track) => void }): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(contentRef)

  // Card box heights follow Settings → App text size (see gridMetrics). Memoized
  // so the SongCard memo isn't defeated by a fresh object every render.
  const appTextScale = useStore((s) => s.appTextScale)
  const m = useMemo(() => gridMetrics(appTextScale), [appTextScale])

  const cols = Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_CARD_W + GRID_GAP)))
  const cellW = width > 0 ? Math.floor((width - GRID_GAP * (cols - 1)) / cols) : 0
  const coverH = Math.round(cellW / GRID_COVER_RATIO)
  const baseCardH = coverH + m.bodyH
  const rowCount = Math.ceil(songs.length / cols)

  // songId → open section keys. Held here (not in the card) because the card
  // unmounts when it scrolls out of the window, and because row offsets below
  // depend on how many sections each row has open.
  const [openSections, setOpenSections] = useState<Map<number, Set<string>>>(new Map())
  const toggleSection = useCallback((songId: number, key: string): void => {
    setOpenSections((prev) => {
      const next = new Map(prev)
      const cur = new Set(next.get(songId) ?? [])
      if (cur.has(key)) cur.delete(key); else cur.add(key)
      if (cur.size === 0) next.delete(songId); else next.set(songId, cur)
      return next
    })
  }, [])

  // Row offsets. Rows are uniform unless a card in them has sections open, so
  // this is a cheap prefix sum that only differs from `i * stride` for the
  // handful of rows the user has expanded something in.
  const { offsets, totalHeight } = useMemo(() => {
    const out = new Array<number>(rowCount + 1)
    let y = 0
    for (let r = 0; r < rowCount; r++) {
      out[r] = y
      let extra = 0
      if (openSections.size > 0) {
        for (const song of songs.slice(r * cols, r * cols + cols)) {
          const n = openSections.get(song.id)?.size ?? 0
          if (n > extra) extra = n
        }
      }
      y += baseCardH + extra * m.sectionOpenH + GRID_GAP
    }
    out[rowCount] = y
    return { offsets: out, totalHeight: Math.max(0, y - GRID_GAP) }
  }, [rowCount, cols, songs, openSections, baseCardH, m])

  // Windowing against the shared scroller. Uniform-stride binary search isn't
  // needed - offsets is already materialized, so the visible range is a scan
  // over it (cheap: it's one entry per row, and it's already in memory).
  const [scrollTop, setScrollTop] = useState(0)
  const [clientH, setClientH] = useState(0)
  const [offsetTop, setOffsetTop] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    const measure = (): void => {
      setClientH(el.clientHeight)
      setScrollTop(el.scrollTop)
      setOffsetTop(contentRef.current ? contentRef.current.offsetTop : 0)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [scrollRef])

  const viewTop = Math.max(0, scrollTop - offsetTop) - clientH   // one viewport of overscan
  const viewBottom = Math.max(0, scrollTop - offsetTop) + clientH * 2

  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {width > 0 && Array.from({ length: rowCount }, (_, r) => r)
        .filter((r) => offsets[r + 1] >= viewTop && offsets[r] <= viewBottom)
        .map((r) => songs.slice(r * cols, r * cols + cols).map((song, c) => {
          const open = openSections.get(song.id)
          return (
            <div
              key={song.id}
              style={{
                position: 'absolute',
                top: offsets[r],
                left: c * (cellW + GRID_GAP),
                width: cellW,
                height: baseCardH + (open?.size ?? 0) * m.sectionOpenH,
              }}
            >
              <SongCard
                song={song}
                coverH={coverH}
                m={m}
                onPlay={onPlay}
                onQueue={onQueue}
                onCategoryClick={onCategoryClick}
                onEraClick={onEraClick}
                onInfo={onInfo}
                onContextMenu={onContextMenu}
                selectMode={selectMode}
                selected={selected.has(song.id)}
                onToggleSelect={onToggleSelect}
                expandedSections={open ?? EMPTY_SECTIONS}
                onToggleSection={toggleSection}
              />
            </div>
          )
        }))}
    </div>
  )
}
const EMPTY_SECTIONS: ReadonlySet<string> = new Set()

// ─── Lyric search result row ──────────────────────────────────────────────────
// Deliberately its own row type rather than reusing SongRow - the whole point
// of lyric search is surfacing *why* a song matched, so this trades the flat
// list's fixed artist/era/category columns for a quoted lyric snippet with
// the matched text highlighted.
const LyricResultRow = memo(function LyricResultRow({
  song, query, onPlay, onCategoryClick, onEraClick, onInfo, onContextMenu,
  selectMode, selected, onToggleSelect,
}: {
  song: JWApiSong
  query: string
  onPlay: (song: JWApiSong) => void
  onCategoryClick: (cat: Category) => void
  onEraClick: (era: string) => void
  onInfo: (song: JWApiSong) => void
  onContextMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
}): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const snippet = useMemo(() => getLyricSnippet(song.lyrics, query), [song.lyrics, query])
  const longPress = useLongPress()

  return (
    <div
      className={`group flex items-start gap-3 px-3 py-3 hover:bg-surface-overlay active:bg-surface-overlay rounded-lg transition-colors cursor-default ${selected ? 'bg-accent/10' : ''}`}
      onClick={(e) => { if (longPress.consumeFired()) return; if (e.ctrlKey || e.metaKey || selectMode) onToggleSelect(song) }}
      onDoubleClick={() => { if (!selectMode) onPlay(song) }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(song, e) }}
      {...longPress.bind(() => onToggleSelect(song))}
    >
      {selectMode && (
        <div className="shrink-0 pt-1.5">
          {selected
            ? <CheckSquare2 size={17} className="text-accent" />
            : <Square size={17} className="text-text-muted opacity-50" />}
        </div>
      )}

      {/* Cover art */}
      <div className="relative shrink-0 w-11 h-11 rounded overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={44} shimmer={false} eager />
        {canPlay && !selectMode && (
          <button
            className="absolute inset-0 items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
            onClick={(e) => { e.stopPropagation(); onPlay(song) }}
            title="Play"
          >
            <Play size={14} fill="white" className="text-white ml-0.5" />
          </button>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="hidden md:flex items-center gap-1.5 flex-wrap">
          <p className="text-text-primary text-sm font-medium truncate">{title}</p>
          <span className="text-text-muted text-xs truncate">{song.credited_artists || 'Juice WRLD'}</span>
          {song.era?.name && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!selectMode) onEraClick(song.era!.name) }}
              className="text-text-muted text-[0.5625rem] uppercase tracking-wide bg-surface px-1.5 py-0.5 rounded border border-[var(--border)] truncate hover:text-accent hover:border-accent/40 transition-colors"
              title={`Filter by era: ${eraLabel(song.era.name, fullEraNames)}`}
            >
              {eraLabel(song.era.name, fullEraNames)}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (!selectMode) onCategoryClick(song.category as Category) }}
            className={`text-[0.5625rem] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 transition-colors hover:opacity-80 ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}
          >
            {CATEGORY_LABELS[song.category] ?? song.category}
          </button>
        </div>

        {/* Mobile: title + a single compact subtitle line instead of the
            wrapping badge row above, matching SongRow's mobile layout. */}
        <p className="md:hidden text-text-primary text-sm font-medium truncate">{title}</p>
        <p className="md:hidden text-text-muted text-xs truncate mt-0.5">
          {song.credited_artists || 'Juice WRLD'}
          {song.era?.name ? ` · ${eraLabel(song.era.name, fullEraNames)}` : ''}
          {` · ${CATEGORY_LABELS[song.category] ?? song.category}`}
        </p>

        {/* Lyric snippet - the reason this song matched */}
        {snippet ? (
          <p className="mt-1 text-xs text-text-secondary italic leading-relaxed line-clamp-2">
            {snippet.before}
            <mark className="bg-accent/20 text-accent not-italic rounded px-0.5">{snippet.match}</mark>
            {snippet.after}
          </p>
        ) : (
          <p className="mt-1 text-xs text-text-muted italic">Lyric preview unavailable</p>
        )}
      </div>

      <span className="hidden md:block text-text-muted text-xs w-12 text-right shrink-0 tabular-nums pt-1.5">{formatDuration(parseDuration(song.length), '--:--')}</span>

      {/* Desktop action buttons */}
      {!selectMode && (
        <div className="hidden md:flex items-center gap-0.5 shrink-0 pt-1">
          <SongActions onInfo={() => onInfo(song)} onContextMenu={(e) => onContextMenu(song, e)} />
        </div>
      )}

      {/* Mobile: more + play */}
      {!selectMode && (
        <div className="md:hidden flex items-center shrink-0">
          <button
            className="p-2 text-text-muted active:text-accent transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onContextMenu(song, e) }}
            title="More options"
          >
            <MoreHorizontal size={16} />
          </button>
          {canPlay && (
            <button
              className="p-2 text-text-muted active:text-accent transition-colors"
              onClick={() => onPlay(song)}
              title="Play"
            >
              <Play size={17} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

// ─── Version title prompt (shown after linking, if the group has no title yet) ─
function VersionTitlePromptModal({
  saving, onSave, onSkip,
}: {
  saving: boolean
  onSave: (title: string) => void
  onSkip: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onSkip() }}
    >
      <div className="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <h3 className="text-text-primary text-sm font-semibold mb-1">Name this version group</h3>
        <p className="text-text-muted text-xs mb-3">
          These songs are now linked as versions of each other, but the group has no title yet (e.g. "TV Mix", "Alternate").
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !saving) onSave(value.trim()) }}
          placeholder="Version title"
          className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none mb-3"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onSkip} disabled={saving} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-50">
            Skip
          </button>
          <button
            onClick={() => value.trim() && onSave(value.trim())}
            disabled={!value.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function ApiTrackerView(): JSX.Element {
  const {
    playTrack, startRadio, addToQueue, account, shuffle,
    apiTrackerCategory, setApiTrackerCategory,
    apiTrackerEra, setApiTrackerEra,
    apiTrackerTab, setApiTrackerTab,
    setActiveView, setApiFilesPath,
    playlists, refreshPlaylists, setShowUserAuth, likedTrackIds, toggleLike,
    openBulkEditor, fullEraNames, activeChannel,
  } = useStore(useShallow(s => ({
    playTrack: s.playTrack, startRadio: s.startRadio, addToQueue: s.addToQueue,
    account: s.account, shuffle: s.shuffle,
    apiTrackerCategory: s.apiTrackerCategory, setApiTrackerCategory: s.setApiTrackerCategory,
    apiTrackerEra: s.apiTrackerEra, setApiTrackerEra: s.setApiTrackerEra,
    apiTrackerTab: s.apiTrackerTab, setApiTrackerTab: s.setApiTrackerTab,
    setActiveView: s.setActiveView, setApiFilesPath: s.setApiFilesPath,
    playlists: s.playlists, refreshPlaylists: s.refreshPlaylists, setShowUserAuth: s.setShowUserAuth,
    likedTrackIds: s.likedTrackIds, toggleLike: s.toggleLike,
    openBulkEditor: s.openBulkEditor,
    fullEraNames: s.fullEraNames,
    activeChannel: s.activeChannel,
  })))

  const canEdit = useCanEdit()
  const canContribute = useCanContribute()
  const canLinkSessions = canEdit || canContribute
  const [sessionEditOverrideVersion, setSessionEditOverrideVersion] = useState(0)
  const [linkingSessionSong, setLinkingSessionSong] = useState<JWApiSong | null>(null)

  // Full era names aren't in the offline cache seed for every session - fetch
  // once so eraLabel() has something to show once the user opts in.
  useEffect(() => { loadEraFullNames().catch(() => {}) }, [])

  const [trackerTab, setTrackerTab] = useState<TrackerTab>(
    () => (isTrackerTab(apiTrackerTab) ? apiTrackerTab : 'songs'),
  )
  // Deep link is one-shot - consumed into the initial state above, so it must
  // not linger and re-apply on a later render (e.g. after switching tabs by
  // hand and coming back to this view).
  useEffect(() => { if (apiTrackerTab) setApiTrackerTab('') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [contextMenu, setContextMenu] = useState<{ song: JWApiSong; x: number; y: number } | null>(null)
  const [bulkContextMenu, setBulkContextMenu] = useState<BulkContextMenuState | null>(null)

  // Multi-select - see the useMultiSelect() call further down (needs
  // compactView/fetchAllMode/sortedSongs, which aren't defined yet here) for
  // selectMode/selected/toggleSelect/exitSelectMode.
  const [bulkZipStatus, setBulkZipStatus] = useState<'idle' | 'zipping' | 'done' | 'partial' | 'none' | 'error'>('idle')
  const [bulkZipSkipped, setBulkZipSkipped] = useState(0)
  const [showBulkPlaylists, setShowBulkPlaylists] = useState(false)
  const [bulkLinkStatus, setBulkLinkStatus] = useState<'idle' | 'linking' | 'done' | 'error'>('idle')
  // Shown after a link completes if the resulting group still has no
  // version_title - untitled groups are functionally useless in compact
  // view (see getAllVersionGroups, which only surfaces titled groups).
  const [titlePromptGroupId, setTitlePromptGroupId] = useState<number | null>(null)
  const [savingTitlePrompt, setSavingTitlePrompt] = useState(false)

  // Compact view - shows only songs grouped into a titled version group,
  // collapsed to one row per group; expanding it reveals the individual
  // songs ("versions") nested underneath. Deliberately fetched independently
  // of the Tracker's own paginated `songs` list (see fetchAllCompactGroups)
  // - tying it to sortedSongs previously meant a group's members could be
  // missed if they hadn't scrolled into view yet, and re-querying on every
  // page load compounded into serious lag as more pages loaded.
  const [compactView, setCompactViewState] = useState(() => localStorage.getItem(LS_TRACKER_COMPACT) === 'true')
  const setCompactView = (v: boolean | ((prev: boolean) => boolean)): void => {
    setCompactViewState(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem(LS_TRACKER_COMPACT, String(next))
      return next
    })
  }
  const [compactGroups, setCompactGroups] = useState<CompactGroup<JWApiSong>[]>([])
  const [loadingCompact, setLoadingCompact] = useState(false)
  // How compact-view groups are ordered - driven by clicking the "Name" /
  // "Versions" column headers (like the normal list's sortable headers), not
  // a separate control. field null keeps the fetch order (group_id asc).
  type CompactSortField = 'name' | 'versions'
  const [compactSort, setCompactSort] = useState<{ field: CompactSortField | null; dir: 'asc' | 'desc' }>({ field: null, dir: 'asc' })

  // Click cycles: first click sorts by that field (Versions starts most-first,
  // Name starts A–Z), second click flips direction, third click clears back
  // to default order - mirroring the flat list's SortBtn.
  const handleCompactSort = (field: CompactSortField): void => {
    const firstDir: 'asc' | 'desc' = field === 'versions' ? 'desc' : 'asc'
    setCompactSort(prev => {
      if (prev.field !== field) return { field, dir: firstDir }
      if (prev.dir === firstDir) return { field, dir: firstDir === 'asc' ? 'desc' : 'asc' }
      return { field: null, dir: 'asc' }
    })
  }
  const { expanded: expandedGroups, toggle: toggleGroupExpanded, clear: clearExpandedGroups } = useExpandedGroups()

  // Breadcrumb the toggle (same spirit as the tracker-sort breadcrumbs): if a
  // freeze ever lands here again, previous-run.log will name the exact group.
  const handleToggleGroup = (group: CompactGroup<JWApiSong>): void => {
    runLog('compact', `toggle group=${group.groupId} "${group.title}" members=${group.members.length}`)
    toggleGroupExpanded(group.groupId)
  }

  // Compact view renders far less content than the underlying song list, so
  // the sentinel stays permanently visible and would otherwise auto-page
  // through the entire library in the background - pause that while active.
  const compactViewRef = useRef(false)
  useEffect(() => { compactViewRef.current = compactView }, [compactView])

  // Bumped by the invalidation subscriber below so an edit made elsewhere
  // (e.g. Editor → Versions) shows up here immediately even while this view
  // stays mounted and compactView never changes.
  const [compactReloadToken, setCompactReloadToken] = useState(0)

  useEffect(() => {
    if (!compactView || !versionsEnabled) { setCompactGroups([]); return }
    let cancelled = false
    setLoadingCompact(true)
    fetchAllCompactGroups().then(groups => {
      if (cancelled) return
      runLog('compact', `loaded ${groups.length} groups (${groups.reduce((n, g) => n + g.members.length, 0)} members)`)
      setCompactGroups(groups)
      setLoadingCompact(false)
    }).catch(e => {
      // Without this, a failed catalog fetch left the "Loading version
      // groups…" spinner up forever (and the rejection unhandled).
      if (cancelled) return
      runLog('compact', 'ERROR loading groups', e as Error)
      setCompactGroups([])
      setLoadingCompact(false)
    })
    return () => { cancelled = true }
  }, [compactView, compactReloadToken])

  useEffect(() => {
    return subscribeCompactGroupsInvalidation(() => {
      if (compactViewRef.current) setCompactReloadToken(t => t + 1)
    })
  }, [])

  // Stale-while-revalidate: seed from the offline cache synchronously so the
  // list renders instantly on open, then the effects below refetch and replace
  // it in the background. The seeded first-songs page must use the exact same
  // params as the initial scroll-mode fetch (unfiltered: no search from the
  // saved query, no category/era, page 1) or the cache key won't match. Read
  // once via a ref so the per-render path never re-parses localStorage.
  const seedRef = useRef<JWApiPaginatedResponse | undefined>(undefined)
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    const validCategories = new Set(CAT_SIDEBAR.map((c) => c.key as string))
    const initialCategories = new Set([...getInitialSetFilter(LS_TRACKER_CATEGORY_FILTER)].filter((c) => validCategories.has(c)))
    const initialEras = getInitialSetFilter(LS_TRACKER_ERA_FILTER)
    const storedOrderField = localStorage.getItem(LS_TRACKER_ORDER_FIELD)
    const validOrderFields: OrderField[] = ['name', 'credited_artists', 'era__name', 'category', 'length', 'date_added']
    const initialOrderField = validOrderFields.includes(storedOrderField as OrderField) ? storedOrderField : null
    const initialSearch = getInitialSearch()
    const parsedInitialSearch = parseSearchQuery(initialSearch)
    const simple = initialCategories.size <= 1 && initialEras.size <= 1
      && !initialOrderField && parsedInitialSearch.filters.length === 0
    if (simple) {
      seedRef.current = apiPeek<JWApiPaginatedResponse>('/songs/', {
        searchall: parsedInitialSearch.freeText || undefined,
        category: initialCategories.size === 1 ? [...initialCategories][0] : undefined,
        era: initialEras.size === 1 ? [...initialEras][0] : undefined,
        page: 1, page_size: PAGE_SIZE,
      })
    }
  }
  const cachedFirstPage = seedRef.current
  const [stats, setStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  const [eras, setEras] = useState<JWApiEra[]>(() => {
    return listEras()
  })
  const [songs, setSongs] = useState<JWApiSong[]>(() => cachedFirstPage?.results ?? [])
  const [count, setCount] = useState(() => cachedFirstPage?.count ?? 0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(() => cachedFirstPage ? cachedFirstPage.next !== null : false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  // The song-list scroll container - CompactGroupList windows against it.
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Refs for scroll logic - avoids stale closure issues in observer callback
  const hasMoreRef = useRef(false)
  const loadingRef = useRef(true)
  const sentinelVisibleRef = useRef(false)

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(LS_TRACKER_VIEW)
    return stored === 'detail' || stored === 'grid' ? stored : 'list'
  })
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  const setViewMode = (v: ViewMode): void => { setViewModeState(v); localStorage.setItem(LS_TRACKER_VIEW, v) }

  const [orderField, setOrderField] = useState<OrderField | null>(() => {
    const stored = localStorage.getItem(LS_TRACKER_ORDER_FIELD)
    const valid: OrderField[] = ['name', 'credited_artists', 'era__name', 'category', 'length', 'date_added']
    return valid.includes(stored as OrderField) ? (stored as OrderField) : null
  })
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>(() =>
    localStorage.getItem(LS_TRACKER_ORDER_DIR) === 'desc' ? 'desc' : 'asc')
  useEffect(() => {
    if (orderField) safeSetLS(LS_TRACKER_ORDER_FIELD, orderField)
    else safeRemoveLS(LS_TRACKER_ORDER_FIELD)
  }, [orderField])
  useEffect(() => { safeSetLS(LS_TRACKER_ORDER_DIR, orderDir) }, [orderDir])
  // Whether any column is currently driving sort mode - the fetched song set
  // only depends on this and the search/category/era filters, not on *which*
  // column it'll be sorted by (that's applied client-side), so this is what
  // the fetch effect below keys off instead of orderField itself.
  const sortModeActive = orderField !== null

  const [recentlyAddedMap, setRecentlyAddedMap] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    if (orderField !== 'date_added') return
    let cancelled = false
    loadRecentlyAddedMap().then((m) => { if (!cancelled) setRecentlyAddedMap(m) }).catch(console.error)
    return () => { cancelled = true }
  }, [orderField])

  const [sessionEditLinks, setSessionEditLinks] = useState<Map<number, { path: string; duration: string | null }> | null>(null)
  useEffect(() => {
    let cancelled = false
    loadSessionEditLinks(activeChannel).then((m) => { if (!cancelled) setSessionEditLinks(m) }).catch(console.error)
    return () => { cancelled = true }
  }, [activeChannel])

  const linkSessionEdit = useCallback((s: JWApiSong): JWApiSong => {
    if (s.category !== 'recording_session') return s
    const { path, length } = resolveSessionEditSource(s)
    return path === s.path && length === s.length ? s : { ...s, path, length }
  }, [sessionEditLinks, sessionEditOverrideVersion])

  // Reset accumulated songs and go back to page 1
  const resetSongs = useCallback((): void => {
    setSongs([])
    setPage(1)
    // Clear the previous query's pagination state NOW, not when the new
    // page-1 fetch lands. Emptying the list scrolls the sentinel into view,
    // and its IntersectionObserver fires in the gap before the new fetch
    // effect runs - reading the old query's hasMore/loading it would bump
    // the page and request a page the narrower result set doesn't have (the
    // API 404s "Invalid page"). On mobile, letter-by-letter typing runs this
    // reset per keystroke, which made searches randomly come back empty.
    setHasMore(false)
    hasMoreRef.current = false
    loadingRef.current = true
    savedTrackerScrollTop = 0
  }, [])

  const handleSort = (field: OrderField): void => {
    if (orderField === field) {
      if (orderDir === 'desc') {
        // Third click: clear sort, go back to infinite scroll
        setOrderField(null); setOrderDir('asc'); resetSongs()
      } else {
        setOrderDir('desc')
      }
    } else {
      setOrderField(field); setOrderDir('asc')
    }
  }

  const [search, setSearch] = useState(getInitialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(getInitialSearch)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Focus the search box on mount so arriving here (e.g. from the home
  // page's search icon) lands the cursor ready to type instead of just
  // opening the view.
  useEffect(() => { searchInputRef.current?.focus() }, [])
  // Field-qualified tokens (e.g. `artists:"Juice WRLD"`) are stripped out of
  // the query the server sees (searchall has no per-field concept) and
  // applied client-side instead - see the fetchAllMode effect below, which
  // this pushes any field-filtered search into (same as sort/multi-category
  // search already does).
  const parsedSearch = useMemo(() => parseSearchQuery(debouncedSearch), [debouncedSearch])
  const hasFieldFilters = parsedSearch.filters.length > 0
  const [showSearchHelp, setShowSearchHelp] = useState(false)
  // Sets rather than single values so "Search Settings" can filter by more
  // than one category/era at once (OR'd within each dimension, AND'd across
  // dimensions). The API itself only accepts one `category`/`era` value per
  // request, so anything beyond a single selection in either dimension has
  // to fall back to fetching everything and filtering client-side - see the
  // fetchAllMode fetch effect below.
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(() => {
    const valid = new Set(CAT_SIDEBAR.map((c) => c.key as string))
    return new Set([...getInitialSetFilter(LS_TRACKER_CATEGORY_FILTER)].filter((c) => valid.has(c))) as Set<Category>
  })
  const [eraFilter, setEraFilter] = useState<Set<string>>(() => getInitialSetFilter(LS_TRACKER_ERA_FILTER))
  const multiFilterActive = categoryFilter.size > 1 || eraFilter.size > 1
  useEffect(() => {
    safeSetLS(LS_TRACKER_CATEGORY_FILTER, JSON.stringify([...categoryFilter]))
  }, [categoryFilter])
  useEffect(() => {
    safeSetLS(LS_TRACKER_ERA_FILTER, JSON.stringify([...eraFilter]))
  }, [eraFilter])
  // Single-value form for the fast (server-side-filtered) path - only
  // meaningful when multiFilterActive is false, which is exactly when each
  // set has at most one member.
  const categoryParam: Category = categoryFilter.size === 1 ? [...categoryFilter][0] : ''
  const eraParam = eraFilter.size === 1 ? [...eraFilter][0] : ''

  const toggleCategoryFilter = useCallback((cat: Category) => {
    setCategoryFilter(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])
  const toggleEraFilter = useCallback((eraName: string) => {
    setEraFilter(prev => {
      const next = new Set(prev)
      if (next.has(eraName)) next.delete(eraName)
      else next.add(eraName)
      return next
    })
  }, [])
  const matchesFilters = useCallback((song: JWApiSong): boolean => {
    if (categoryFilter.size > 0 && !categoryFilter.has(song.category as Category)) return false
    if (eraFilter.size > 0 && !(song.era && eraFilter.has(song.era.name))) return false
    return true
  }, [categoryFilter, eraFilter])

  useEffect(() => {
    if (apiTrackerCategory) { setCategoryFilter(new Set([apiTrackerCategory as Category])); setApiTrackerCategory('') }
    if (apiTrackerEra) { setEraFilter(new Set([apiTrackerEra])); setApiTrackerEra('') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lyric search (separate tab) - its own query/results, independent of
  // the main song list's search/category/era/sort state above.
  const [lyricsQuery, setLyricsQuery] = useState('')
  const [debouncedLyricsQuery, setDebouncedLyricsQuery] = useState('')
  const [lyricsResults, setLyricsResults] = useState<JWApiSong[]>([])
  const [lyricsPage, setLyricsPage] = useState(1)
  const [lyricsCount, setLyricsCount] = useState(0)
  const [lyricsHasMore, setLyricsHasMore] = useState(false)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsError, setLyricsError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLyricsQuery(lyricsQuery), 400)
    return () => clearTimeout(t)
  }, [lyricsQuery])

  useEffect(() => {
    if (!debouncedLyricsQuery.trim()) {
      setLyricsResults([]); setLyricsCount(0); setLyricsHasMore(false); setLyricsError(null)
      return
    }
    let cancelled = false
    setLyricsLoading(true); setLyricsError(null)
    apiFetch<JWApiPaginatedResponse>('/songs/', { lyrics: debouncedLyricsQuery, page: 1, page_size: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return
        setLyricsResults(data.results)
        setLyricsCount(data.count)
        setLyricsHasMore(data.next !== null)
        setLyricsPage(1)
      })
      .catch((err) => { if (!cancelled) setLyricsError(err.message) })
      .finally(() => { if (!cancelled) setLyricsLoading(false) })
    return () => { cancelled = true }
  }, [debouncedLyricsQuery])

  const loadMoreLyrics = (): void => {
    if (lyricsLoading || !lyricsHasMore) return
    const nextPage = lyricsPage + 1
    setLyricsLoading(true)
    apiFetch<JWApiPaginatedResponse>('/songs/', { lyrics: debouncedLyricsQuery, page: nextPage, page_size: PAGE_SIZE })
      .then((data) => {
        setLyricsResults((prev) => [...prev, ...data.results])
        setLyricsHasMore(data.next !== null)
        setLyricsPage(nextPage)
      })
      .catch((err) => setLyricsError(err.message))
      .finally(() => setLyricsLoading(false))
  }

  const linkedLyricsResults = useMemo(() => lyricsResults.map(linkSessionEdit), [lyricsResults, linkSessionEdit])

  // ── Calendar (separate tab) - songs grouped by recording date ─────────────
  // Fetches the whole catalog once (lazily, on first visiting the tab) since
  // there's no server-side way to filter/group by record_dates - it's parsed
  // out of free text client-side (see extractDateKeys above).
  const [calendarSongs, setCalendarSongs] = useState<JWApiSong[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const calendarFetchedRef = useRef(false)

  useEffect(() => {
    if ((trackerTab !== 'calendar' && trackerTab !== 'producers') || calendarFetchedRef.current) return
    calendarFetchedRef.current = true
    setCalendarLoading(true)
    apiFetch<JWApiSong[]>('/songs/', { all: 'true' })
      .then(setCalendarSongs)
      .catch((err) => setCalendarError(err.message))
      .finally(() => setCalendarLoading(false))
  }, [trackerTab])

  const linkedCalendarSongs = useMemo(() => calendarSongs.map(linkSessionEdit), [calendarSongs, linkSessionEdit])

  const calendarByDate = useMemo(() => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of linkedCalendarSongs) {
      for (const key of extractDateKeys(song.record_dates)) {
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(song)
      }
    }
    return map
  }, [linkedCalendarSongs])

  // `recording_locations` is also free text (e.g. "Record One Studios, Los
  // Angeles") - grouped by the exact trimmed string rather than parsed into
  // parts, since there's no reliable delimiter between studio name and city.
  const calendarByStudio = useMemo(() => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of linkedCalendarSongs) {
      const loc = song.recording_locations?.trim()
      if (!loc) continue
      if (!map.has(loc)) map.set(loc, [])
      map.get(loc)!.push(song)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [linkedCalendarSongs])

  // `producers` and `engineers` are both free text, often multiple names
  // separated by commas (e.g. "Nick Mira, Taz Taylor") - split so each
  // person gets their own entry instead of grouping by the exact combined
  // string. Kept as two separate groupings (rather than merged) so a name
  // that appears in both credits still shows up as distinct panels.
  const groupByNameField = (songs: JWApiSong[], field: (s: JWApiSong) => string | null | undefined): [string, JWApiSong[]][] => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of songs) {
      const raw = field(song)
      if (!raw) continue
      for (const part of raw.split(',')) {
        const name = part.trim()
        if (!name) continue
        if (!map.has(name)) map.set(name, [])
        map.get(name)!.push(song)
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }

  const producersByName = useMemo(
    () => groupByNameField(linkedCalendarSongs, (s) => s.producers),
    [linkedCalendarSongs]
  )
  const engineersByName = useMemo(
    () => groupByNameField(linkedCalendarSongs, (s) => s.engineers),
    [linkedCalendarSongs]
  )

  // Assigns each era a stable color by its position in `eras` (already
  // fetched for the category sidebar) - same era always maps to the same
  // color as long as the API keeps returning eras in the same order.
  const eraColorMap = useMemo(() => {
    const map = new Map<string, EraColor>()
    eras.forEach((era, i) => map.set(era.name, ERA_COLOR_PALETTE[i % ERA_COLOR_PALETTE.length]))
    return map
  }, [eras])

  // Restores the last-viewed month from localStorage (this view unmounts
  // whenever the user switches tabs, so component state alone doesn't
  // survive a round trip). Falls back to May 2018 for first-time visitors.
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const saved = localStorage.getItem(LS_TRACKER_CALENDAR_MONTH)
    if (saved) {
      const [y, m] = saved.split('-').map(Number)
      if (Number.isFinite(y) && Number.isFinite(m)) return { year: y, month: m }
    }
    return { year: 2018, month: 4 }
  })

  useEffect(() => {
    localStorage.setItem(LS_TRACKER_CALENDAR_MONTH, `${calendarMonth.year}-${calendarMonth.month}`)
  }, [calendarMonth])

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
  const [selectedStudio, setSelectedStudio] = useState<string | null>(null)
  const [selectedProducer, setSelectedProducer] = useState<string | null>(null)
  const [selectedEngineer, setSelectedEngineer] = useState<string | null>(null)

  const shiftCalendarMonth = (delta: number): void => {
    setCalendarMonth((prev) => {
      const base = prev ?? { year: new Date().getFullYear(), month: new Date().getMonth() }
      let month = base.month + delta
      let year = base.year
      if (month < 0) { month = 11; year -= 1 }
      if (month > 11) { month = 0; year += 1 }
      return { year, month }
    })
  }

  // Clicking a badge on a song row jumps to "just this one" rather than
  // adding to the current multi-select, matching the old single-filter UX.
  const handleCategoryClick = useCallback((cat: Category) => { setCategoryFilter(new Set(cat ? [cat] : [])); resetSongs() }, [resetSongs])
  const handleEraClick = useCallback((eraName: string) => { setEraFilter(new Set(eraName ? [eraName] : [])); resetSongs() }, [resetSongs])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstDebounce = useRef(true)

  useEffect(() => { localStorage.setItem(LS_TRACKER_SEARCH, search) }, [search])

  // Reflect each settled search in the URL (?q=...) via pushState, one history
  // entry per search, so the back button steps through previous searches
  // instead of just leaving the page. Skipped in Electron (see getInitialSearch)
  // and on the very first render, since that value already came from the URL.
  const isFirstUrlSync = useRef(true)
  useEffect(() => {
    if (window.location.protocol === 'file:') return
    if (isFirstUrlSync.current) { isFirstUrlSync.current = false; return }
    const url = new URL(window.location.href)
    if (debouncedSearch) url.searchParams.set('q', debouncedSearch)
    else url.searchParams.delete('q')
    window.history.pushState({}, '', url)
  }, [debouncedSearch])

  // Restore the search box when the user navigates back/forward through
  // those history entries.
  useEffect(() => {
    if (window.location.protocol === 'file:') return
    const onPopState = (): void => {
      const q = new URLSearchParams(window.location.search).get('q') || ''
      isFirstUrlSync.current = true // this sync came from the URL - don't push it again
      setSearch(q)
      setDebouncedSearch(q)
      resetSongs()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [resetSongs])

  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setStats).catch(console.error)
    // /eras/ is paginated (34 across 2 pages) - going through the shared loader
    // rather than fetching page 1 directly is what makes the back half of the
    // list (SoundCloud, Vinyl, TTZ...) reachable in the era filter. `finally`,
    // not `then`: the loader rejects if any page fails but keeps the pages it
    // already ingested, so a page-2 outage still renders page 1's eras.
    loadEraFullNames().catch(console.error).finally(() => setEras(listEras()))
  }, [])

  useEffect(() => {
    if (eras.length === 0) return
    const valid = new Set(eras.map((e) => e.name))
    setEraFilter((prev) => {
      const next = new Set([...prev].filter((e) => valid.has(e)))
      return next.size === prev.size ? prev : next
    })
  }, [eras])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      // Skip resetSongs on initial mount - only reset when user actually types
      if (isFirstDebounce.current) { isFirstDebounce.current = false; return }
      // Settled back to the query already showing (typed then deleted within
      // the debounce window): no dep changes, so nothing would refetch - a
      // reset here would just blank the list (and strand the loading flag
      // resetSongs now presets).
      if (search === debouncedSearch) return
      resetSongs()
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search, debouncedSearch, resetSongs])

  // ── FETCH-ALL MODE: load the entire (server-filtered) result set, then sort
  // and/or filter client-side ─────────────────────────────────────────────────
  // The API has no ordering param and only accepts one category/era value per
  // request, so both "sort by column" and "more than one category/era
  // selected" fall back to fetching every matching page up front. category/
  // era are still passed server-side when there's exactly one value selected
  // (categoryParam/eraParam) to shrink the payload - matchesFilters then
  // covers whichever dimension has 2+ values, which the server can't do.
  // Keyed on sortModeActive/multiFilterActive rather than orderField directly
  // - switching which column is active only changes how the already-fetched
  // songs are sorted (see the sortedSongs memo below), so it must not
  // re-trigger this fetch.
  const fetchAllMode = sortModeActive || multiFilterActive || hasFieldFilters
  useEffect(() => {
    if (!fetchAllMode) return
    let cancelled = false
    loadingRef.current = true
    setLoading(true); setError(null); setSongs([]); setHasMore(false); setCount(0)
    const t0 = performance.now()
    runLog('tracker-sort', `start search=${JSON.stringify(debouncedSearch)} category=${categoryParam || '-'} era=${eraParam || '-'} multi=${multiFilterActive} fields=${parsedSearch.filters.length}`)
    // Field filters (artists:"...", etc.) can't be sent to the server, so
    // they're checked here alongside category/era.
    const passesAll = (s: JWApiSong): boolean => matchesFilters(s) && matchesFieldFilters(s, parsedSearch.filters)
    // `all=true` returns the whole (filtered) catalogue as a plain array in
    // one request - server-side page_size is capped below what we'd need to
    // paginate reliably, so this avoids under-counting totalPages against it.
    ;(async () => {
      try {
        const all = await apiFetch<JWApiSong[]>('/songs/', {
          searchall: parsedSearch.freeText || undefined,
          category: categoryParam || undefined,
          era: eraParam || undefined,
          all: 'true',
        })
        if (cancelled) return
        const filtered = all.filter(passesAll)
        setSongs(filtered)
        setCount(filtered.length)
        runLog('tracker-sort', `done ${all.length} songs in ${Math.round(performance.now() - t0)}ms`)
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); runLog('tracker-sort', 'ERROR', e as Error) }
      } finally {
        if (!cancelled) { loadingRef.current = false; setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [fetchAllMode, debouncedSearch, parsedSearch, categoryParam, eraParam, matchesFilters])

  // ── SCROLL MODE: infinite scroll, accumulates pages ──────────────────────────
  useEffect(() => {
    if (fetchAllMode) return // fetch-all mode handles fetching
    let cancelled = false
    loadingRef.current = true
    setLoading(true); setError(null)
    apiFetch<JWApiPaginatedResponse>('/songs/', {
      searchall: parsedSearch.freeText || undefined,
      category: categoryParam || undefined,
      era: eraParam || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((data) => {
        if (!cancelled) {
          setSongs((prev) => page === 1 ? data.results : [...prev, ...data.results])
          setCount(data.count)
          const more = data.next !== null
          setHasMore(more)
          hasMoreRef.current = more
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => {
        if (!cancelled) {
          loadingRef.current = false
          setLoading(false)
          if (sentinelVisibleRef.current && hasMoreRef.current && !compactViewRef.current) {
            setPage((p) => p + 1)
          }
        }
      })
    return () => { cancelled = true }
  }, [debouncedSearch, parsedSearch, categoryParam, eraParam, page, fetchAllMode])

  // Observe sentinel for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      sentinelVisibleRef.current = entry.isIntersecting
      // User scrolled to sentinel while we weren't loading
      if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current && !compactViewRef.current) {
        setPage((p) => p + 1)
      }
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Client-side sort applied over accumulated songs (sort mode only)
  const sortedSongs = useMemo(() => {
    const linked = songs.map(linkSessionEdit)
    if (!orderField) return linked
    const base = orderField === 'date_added'
      ? (recentlyAddedMap ? linked.filter((s) => recentlyAddedMap.has(s.path)) : [])
      : linked
    return [...base].sort((a, b) => {
      let av: string | number, bv: string | number
      switch (orderField) {
        case 'name':
          av = a.name.toLowerCase()
          bv = b.name.toLowerCase()
          break
        case 'credited_artists':
          av = (a.credited_artists || '').toLowerCase()
          bv = (b.credited_artists || '').toLowerCase()
          break
        case 'era__name':
          av = (a.era?.name || '').toLowerCase()
          bv = (b.era?.name || '').toLowerCase()
          break
        case 'category':
          av = a.category; bv = b.category
          break
        case 'length':
          av = parseDuration(a.length); bv = parseDuration(b.length)
          break
        case 'date_added':
          av = recentlyAddedMap?.get(a.path) ?? ''
          bv = recentlyAddedMap?.get(b.path) ?? ''
          break
        default: return 0
      }
      const cmp = typeof av === 'number' ? av - (bv as number) : (av as string).localeCompare(bv as string)
      return orderDir === 'desc' ? -cmp : cmp
    })
  }, [songs, orderField, orderDir, recentlyAddedMap, linkSessionEdit])

  // fetchAllCompactGroups is independent of the search box (it has to fetch
  // every group app-wide regardless), so the search query has to be applied
  // client-side afterward or typing while compact view is active would do
  // nothing.
  // Mirrors as much of the normal list's server-side `searchall` field
  // coverage as this client-side filter reasonably can - matching only
  // title/artist here made legitimate searches (e.g. by producer) come up
  // empty even though the normal (non-compact) list found them fine.
  const filteredCompactGroups = useMemo(() => {
    let filtered = filterCompactGroups(compactGroups, parsedSearch.freeText, s => [
      s.track_titles?.join(' '), s.name, s.credited_artists, s.producers, s.engineers,
      s.era?.name, s.notes, s.additional_information, s.session_titles, s.original_key,
    ].filter(Boolean).join(' '))
    filtered = filtered.map((g) => {
      if (!g.members.some((m) => m.item.category === 'recording_session')) return g
      return { ...g, members: g.members.map((m) => m.item.category === 'recording_session' ? { ...m, item: linkSessionEdit(m.item) } : m) }
    })
    // Field-qualified tokens (artists:"...", etc.) aren't handled by
    // filterCompactGroups' plain free-text match, so apply them here as an
    // extra member-level pass - a group survives only if at least one
    // version still matches after this.
    if (parsedSearch.filters.length > 0) {
      filtered = filtered
        .map(g => ({ ...g, members: g.members.filter(m => matchesFieldFilters(m.item, parsedSearch.filters)) }))
        .filter(g => g.members.length > 0)
    }
    // Category/era filters aren't sent server-side for compact view (the
    // whole catalog is always fetched - see fetchAllCompactGroups above), so
    // apply them here instead. A group counts as a match if any of its
    // versions does, same as clicking a member's own category/era badge.
    if (categoryFilter.size > 0 || eraFilter.size > 0) {
      filtered = filtered.filter(g => g.members.some(m => matchesFilters(m.item)))
    }
    if (!compactSort.field) return filtered
    // Copy before sorting - filterCompactGroups may return the input array.
    const sorted = [...filtered]
    const dir = compactSort.dir === 'asc' ? 1 : -1
    if (compactSort.field === 'name') {
      sorted.sort((a, b) => a.title.localeCompare(b.title) * dir)
    } else {
      // Title tiebreak so equal-count groups keep a stable, readable order.
      sorted.sort((a, b) => (a.members.length - b.members.length) * dir || a.title.localeCompare(b.title))
    }
    return sorted
  }, [compactGroups, parsedSearch, compactSort, categoryFilter, eraFilter, matchesFilters, linkSessionEdit])

  useEffect(() => {
    const el = listScrollRef.current
    if (!el) return
    if (savedTrackerScrollTop === 0 || el.scrollTop !== 0) return
    if (el.scrollHeight - el.clientHeight < savedTrackerScrollTop) return
    el.scrollTop = savedTrackerScrollTop
  }, [compactView, filteredCompactGroups.length, sortedSongs.length])
  useEffect(() => {
    const el = listScrollRef.current
    if (!el) return
    const id = setInterval(() => { if (el.scrollHeight > el.clientHeight) savedTrackerScrollTop = el.scrollTop }, 100)
    return () => clearInterval(id)
  }, [])

  // Multi-select - select mode, the selected-songs Map, Escape-to-exit, and
  // Ctrl/Cmd+A "select all" are all handled by the shared hook (see its docs
  // for why: a race between an async select-all fetch and the auto-exit-on-
  // empty-selection effect used to silently discard the whole selection).
  // `all=true` returns the whole (filtered) catalogue as a plain array in one
  // request - the server caps page_size well below what pagination here
  // would need to stay accurate, so this is used instead of paging through it.
  const {
    selectMode, setSelectMode, selected, setSelected, selectAllLoading,
    toggle: toggleSongSelect, exitSelectMode, selectAll: selectAllSongs,
  } = useMultiSelect<number, JWApiSong>({
    onExit: () => {
      setBulkZipStatus('idle')
      setBulkZipSkipped(0)
      setShowBulkPlaylists(false)
    },
    ctrlA: {
      enabled: trackerTab === 'songs',
      getAll: () => {
        if (compactView) {
          const all = new Map<number, JWApiSong>()
          for (const g of filteredCompactGroups) for (const m of g.members) all.set(m.item.id, m.item)
          return all
        }
        return new Map(sortedSongs.map((s) => [s.id, s]))
      },
      needsFetch: () => !compactView && !fetchAllMode && (loadingRef.current || hasMoreRef.current),
      fetchAll: async () => {
        loadingRef.current = true
        setLoading(true)
        try {
          const all = await apiFetch<JWApiSong[]>('/songs/', {
            searchall: debouncedSearch || undefined,
            category: categoryParam || undefined,
            era: eraParam || undefined,
            all: 'true',
          })
          setSongs(all)
          setCount(all.length)
          setHasMore(false)
          hasMoreRef.current = false
          return new Map(all.map((s) => [s.id, linkSessionEdit(s)]))
        } catch (e) {
          setError((e as Error).message)
          return null
        } finally {
          loadingRef.current = false
          setLoading(false)
        }
      },
    },
  })
  // useCallback so SongRow's memo isn't defeated - a fresh identity here would
  // re-render every row on each selection toggle.
  const toggleSelect = useCallback((song: JWApiSong): void => toggleSongSelect(song.id, song), [toggleSongSelect])

  const handlePlay = useCallback((song: JWApiSong) => {
    const track = songToTrack(song)
    // If shuffle is already on, start radio mode from this track instead of
    // loading the visible page into the queue.
    if (shuffle) {
      const rf = (!fetchAllMode && hasMore)
        ? { category: categoryParam, era: eraParam, search: debouncedSearch, total: count }
        : null
      startRadio(track, rf)
      return
    }
    const playable = sortedSongs.filter((s) => !!s.path)
    const context = playable.map(songToTrack)
    const needsLazy = !fetchAllMode && hasMore
    playTrack(track, context.length > 0 ? context : [track], needsLazy ? {
      category: categoryParam, era: eraParam, search: debouncedSearch,
      page: page + 1, hasMore: true, total: count,
    } : null, 'tracker')
  }, [playTrack, startRadio, shuffle, sortedSongs, categoryParam, eraParam, debouncedSearch, count, hasMore, fetchAllMode, page])

  // Global infoSongId (not local state) so the info panel - and its place in
  // the sandbox - survives switching to another tab, which unmounts this view.
  const handleInfo = useCallback((song: JWApiSong) => { useStore.getState().setInfoSongId(song.id) }, [])
  const handleQueue = useCallback((track: Track) => { addToQueue(track) }, [addToQueue])

  const handleContextMenu = useCallback((song: JWApiSong, e: React.MouseEvent): void => {
    if (selectMode) {
      setSelected(prev => prev.has(song.id) ? prev : new Map(prev).set(song.id, song))
      setBulkContextMenu({ x: e.clientX, y: e.clientY, showPlaylists: false })
      return
    }
    setContextMenu({ song, x: e.clientX, y: e.clientY })
  }, [selectMode])

  // Right-clicking a compact-view group ("folder") acts on all its versions
  // at once - selects every member and opens the bulk menu (Add to queue /
  // playlist, Download ZIP, Link versions), the same menu you'd get from
  // multi-selecting those songs by hand.
  const handleGroupContextMenu = useCallback((group: CompactGroup<JWApiSong>, e: React.MouseEvent): void => {
    e.preventDefault()
    setSelected(new Map(group.members.map(m => [m.item.id, m.item])))
    setSelectMode(true)
    setBulkContextMenu({ x: e.clientX, y: e.clientY, showPlaylists: false })
  }, [])

  const selectedSongs = useMemo(() => [...selected.values()], [selected])
  // Sessions/unsurfaced songs can't go in playlists or the queue - same rule
  // the single-song menu already enforces (see canAddToPlaylist/canQueue in
  // SongContextMenu.tsx). If even one selected song is unplayable, both bulk
  // actions are disabled entirely rather than silently dropping it - a
  // partial add on a selection the user made as one unit is surprising.
  const bulkEligibleSongs = useMemo(
    () => selectedSongs.filter(s => s.category !== 'unsurfaced' && (s.category !== 'recording_session' || !!s.path)),
    [selectedSongs]
  )
  const canBulkAddToPlaylist = selectedSongs.length > 0 && bulkEligibleSongs.length === selectedSongs.length
  const canBulkAddToQueue = selectedSongs.length > 0
    && bulkEligibleSongs.length === selectedSongs.length
    && bulkEligibleSongs.every(s => s.path)

  // Which playlists already contain *every* eligible selected song - shown
  // as a checkmark so re-adding to a playlist the whole selection is
  // already in isn't a silent no-op.
  const [bulkContained, setBulkContained] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!account || !canBulkAddToPlaylist || playlists.length === 0 || !(showBulkPlaylists || bulkContextMenu?.showPlaylists)) {
      setBulkContained(new Set())
      return
    }
    const ids = selectedSongs.map(s => s.id)
    Promise.all(
      playlists.map(p =>
        userApi.getPlaylist(p.id)
          .then(d => {
            const memberIds = new Set((d.items ?? []).map(it => it.song.id))
            return { id: p.id, allIn: ids.every(id => memberIds.has(id)) }
          })
          .catch(() => ({ id: p.id, allIn: false }))
      )
    ).then(results => setBulkContained(new Set(results.filter(r => r.allIn).map(r => r.id))))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, account, selectedSongs, showBulkPlaylists, bulkContextMenu?.showPlaylists])

  const bulkAddToQueue = (): void => {
    // Only reachable when canBulkAddToQueue is true, i.e. every selected
    // song is eligible and playable.
    selectedSongs.forEach(s => addToQueue(songToTrack(s)))
    exitSelectMode()
  }

  const bulkAddToPlaylist = async (playlistId: number): Promise<void> => {
    // Only reachable when canBulkAddToPlaylist is true, i.e. every selected
    // song is eligible.
    await Promise.all(selectedSongs.map(s => userApi.addToPlaylist(playlistId, s.id).catch(() => {})))
    await refreshPlaylists()
    exitSelectMode()
  }

  // Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED) - downloads
  // every selected song's file individually instead, spaced out so the
  // browser doesn't treat them as a popup flood.
  const bulkDownloadZip = async (): Promise<void> => {
    const paths = selectedSongs.map(s => s.path).filter(Boolean) as string[]
    const skipped = selectedSongs.length - paths.length
    if (paths.length === 0) {
      setBulkZipSkipped(skipped)
      setBulkZipStatus('none')
      setTimeout(() => setBulkZipStatus('idle'), 4000)
      return
    }
    setBulkZipStatus('zipping')
    try {
      for (const path of paths) {
        triggerDownload(buildStreamUrl(path, activeChannel || undefined), path.split('/').pop() || path)
        await new Promise((r) => setTimeout(r, 350))
      }
      setBulkZipSkipped(skipped)
      setBulkZipStatus(skipped > 0 ? 'partial' : 'done')
    } catch {
      setBulkZipStatus('error')
    }
    setTimeout(() => setBulkZipStatus('idle'), skipped > 0 ? 5000 : 3000)
  }

  // Links every selected song together as versions of one another - pairing
  // each against the first selected song merges all of their groups (see
  // linkSongVersion's group-merge logic in versionsApi.ts). If none of them
  // already had a version_title, the merged group ends up untitled - prompt
  // for one rather than leaving a silently untitled (and in compact view,
  // invisible) group.
  const bulkLinkVersions = async (): Promise<void> => {
    const ids = selectedSongs.map(s => s.id)
    if (ids.length < 2) return
    setBulkLinkStatus('linking')
    try {
      const [first, ...rest] = ids
      for (const id of rest) await linkSongVersion(first, id)
      invalidateCompactGroupsCache()
      const meta = await getOwnVersionMeta(first)
      if (meta && !meta.versionTitle) setTitlePromptGroupId(meta.groupId)
      setBulkLinkStatus('done')
    } catch {
      setBulkLinkStatus('error')
    }
    setTimeout(() => setBulkLinkStatus('idle'), 3000)
  }

  const handleShowInFiles = useCallback((song: JWApiSong): void => {
    if (!song.path) return
    const parts = song.path.split('/')
    const folderPath = parts.slice(0, -1).join('/')
    setApiFilesPath(folderPath)
    setActiveView('api-files')
  }, [setApiFilesPath, setActiveView])

  const handleSessionFilePicked = useCallback(async (path: string): Promise<void> => {
    const song = linkingSessionSong
    setLinkingSessionSong(null)
    if (!song) return
    let duration: string | null = null
    try {
      const parts = path.split('/')
      const folder = parts.slice(0, -1).join('/')
      const params: Record<string, string> = folder ? { path: folder } : {}
      if (activeChannel) params.channel = activeChannel
      const data = apiPeek<JWApiBrowseResponse>('/files/browse/', params) ?? await apiFetch<JWApiBrowseResponse>('/files/browse/', params)
      const entry = parseBrowseEntries(data).find((e) => e.path === path)
      duration = entry?.duration ?? null
    } catch (err) { console.error(err) }
    setSessionEditOverride(song.id, activeChannel, { path, duration })
    setSessionEditOverrideVersion((v) => v + 1)
  }, [linkingSessionSong, activeChannel])

  const handleClearSessionLink = useCallback((song: JWApiSong): void => {
    setSessionEditOverride(song.id, activeChannel, null)
    setSessionEditOverrideVersion((v) => v + 1)
  }, [activeChannel])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-5 pt-4 md:pt-5 pb-3 shrink-0">
        <h1 className="text-text-primary text-xl font-bold mb-1">Tracker</h1>

        <div className="flex items-center gap-0.5 mb-2.5 w-fit bg-surface-overlay rounded-md p-0.5">
          <button
            onClick={() => setTrackerTab('songs')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors ${
              trackerTab === 'songs'
                ? 'bg-surface-raised text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Music2 size={11} /> Songs
          </button>
          <button
            onClick={() => setTrackerTab('lyrics')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors ${
              trackerTab === 'lyrics'
                ? 'bg-surface-raised text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Mic2 size={11} /> Lyrics
          </button>
          <button
            onClick={() => setTrackerTab('calendar')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors ${
              trackerTab === 'calendar'
                ? 'bg-surface-raised text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <CalendarDays size={11} /> Overview
          </button>
          <button
            onClick={() => setTrackerTab('producers')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors ${
              trackerTab === 'producers'
                ? 'bg-surface-raised text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Users size={11} /> Producers
          </button>
          <button
            onClick={() => setActiveView('statistics')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-medium transition-colors text-text-muted hover:text-text-secondary"
          >
            <BarChart3 size={11} /> Statistics
          </button>
        </div>

        {trackerTab === 'songs' && <StatsBar stats={stats} />}

        {trackerTab === 'songs' && <div className="flex flex-col gap-2">
          {/* Search - uses searchall to include producers; field:"value" tokens
              (see trackerSearch.ts) are parsed out and applied client-side. */}
          <div className="flex items-center gap-1.5 w-full">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder='Search, or artists:"Juice WRLD"…'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-surface-overlay text-text-primary text-sm pl-8 pr-8 py-2.5 md:py-2 rounded-lg outline-none focus:ring-1 ring-accent border border-transparent focus:border-accent/40 placeholder:text-text-muted"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="relative shrink-0 hidden md:block">
              <button
                onClick={() => setShowFilterMenu((v) => !v)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`relative flex items-center justify-center p-2.5 md:p-2 rounded-lg transition-colors ${
                  showFilterMenu || multiFilterActive || categoryFilter.size > 0 || eraFilter.size > 0
                    ? 'bg-accent/15 text-accent'
                    : 'bg-surface-overlay text-text-muted hover:text-text-secondary'
                }`}
                title="Filters"
              >
                <ListFilter size={15} />
                {(categoryFilter.size + eraFilter.size) > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-accent text-[0.5625rem] leading-[15px] font-bold text-white text-center">
                    {categoryFilter.size + eraFilter.size}
                  </span>
                )}
              </button>
              {showFilterMenu && (
                <FilterPopover
                  stats={stats}
                  eras={eras}
                  selectedCategories={categoryFilter}
                  selectedEras={eraFilter}
                  onCategory={(c) => { toggleCategoryFilter(c); resetSongs() }}
                  onEra={(e) => { toggleEraFilter(e); resetSongs() }}
                  onClearCategories={() => { setCategoryFilter(new Set()); resetSongs() }}
                  onClearEras={() => { setEraFilter(new Set()); resetSongs() }}
                  onClearAll={() => { setCategoryFilter(new Set()); setEraFilter(new Set()); resetSongs() }}
                  onClose={() => setShowFilterMenu(false)}
                />
              )}
            </div>
            <div className="relative shrink-0">
              <button
                onClick={() => setShowSearchHelp((v) => !v)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`p-2.5 md:p-2 rounded-lg transition-colors ${showSearchHelp ? 'bg-accent/15 text-accent' : 'bg-surface-overlay text-text-muted hover:text-text-secondary'}`}
                title="Search syntax help"
              >
                <Info size={15} />
              </button>
              {showSearchHelp && <SearchHelpPopover onClose={() => setShowSearchHelp(false)} />}
            </div>

            <button
              onClick={() => {
                if (orderField === 'date_added') { setOrderField(null); setOrderDir('asc'); resetSongs() }
                else { setOrderField('date_added'); setOrderDir('desc'); resetSongs() }
              }}
              title="Sort by recently added - only covers the last ~200 file changes, so older songs may not have a known date"
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                orderField === 'date_added' ? 'bg-accent/15 text-accent' : 'bg-surface-overlay text-text-muted hover:text-text-secondary'
              }`}
            >
              <Clock size={14} />
              Recently added
            </button>

            <div className="flex items-center bg-surface-overlay rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => { setViewMode('list'); setCompactView(false) }}
                className={`p-2 md:p-1.5 rounded-md transition-colors ${viewMode === 'list' && !compactView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                title="List view"
              >
                <LayoutList size={16} />
              </button>
              <button
                onClick={() => { setViewMode('detail'); setCompactView(false) }}
                className={`p-2 md:p-1.5 rounded-md transition-colors ${viewMode === 'detail' && !compactView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                title="Detailed view"
              >
                <Rows3 size={16} />
              </button>
              <button
                onClick={() => { setViewMode('grid'); setCompactView(false) }}
                className={`p-2 md:p-1.5 rounded-md transition-colors ${viewMode === 'grid' && !compactView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                title="Grid view"
              >
                <LayoutGrid size={16} />
              </button>
              {versionsEnabled && (
                <button
                  onClick={() => { setCompactView(true); clearExpandedGroups() }}
                  className={`p-2 md:p-1.5 rounded-md transition-colors ${compactView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                  title="Compact view - collapse songs into their version groups"
                >
                  <Layers size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Second row - mobile-only category select (desktop uses the filter popover above) */}
          <div className="md:hidden flex items-center gap-2 flex-wrap">
            <select
              value={categoryParam}
              onChange={(e) => { setCategoryFilter(new Set(e.target.value ? [e.target.value as Category] : [])); resetSongs() }}
              className="flex-1 min-w-0 bg-surface-overlay text-text-primary text-sm px-3 py-2.5 rounded-lg outline-none border border-transparent focus:ring-1 ring-accent focus:border-accent/40 cursor-pointer"
            >
              <option value="">{categoryFilter.size > 1 ? `${categoryFilter.size} categories` : 'All categories'}</option>
              <option value="released">Released</option>
              <option value="unreleased">Unreleased</option>
              <option value="unsurfaced">Unsurfaced</option>
              <option value="recording_session">Sessions</option>
            </select>
          </div>

          {/* Active filter chips - one per selected category/era, each
              individually removable so multi-select filters can be trimmed
              down one at a time instead of all-or-nothing. */}
          {(categoryFilter.size > 0 || eraFilter.size > 0) && (
            <div className="flex gap-1.5 flex-wrap">
              {[...categoryFilter].map((cat) => (
                <button
                  key={cat}
                  onClick={() => { toggleCategoryFilter(cat); resetSongs() }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-medium"
                >
                  {CATEGORY_LABELS[cat] ?? cat}
                  <X size={10} />
                </button>
              ))}
              {[...eraFilter].map((eraName) => (
                <button
                  key={eraName}
                  onClick={() => { toggleEraFilter(eraName); resetSongs() }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-medium"
                >
                  {eraName}
                  <X size={10} />
                </button>
              ))}
            </div>
          )}
        </div>}

        {trackerTab === 'lyrics' && (
          <div className="relative w-full">
            <Mic2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search lyrics…"
              value={lyricsQuery}
              onChange={(e) => setLyricsQuery(e.target.value)}
              className="w-full bg-surface-overlay text-text-primary text-sm pl-8 pr-8 py-2.5 md:py-2 rounded-lg outline-none focus:ring-1 ring-accent border border-transparent focus:border-accent/40 placeholder:text-text-muted"
            />
            {lyricsQuery && (
              <button onClick={() => setLyricsQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {trackerTab === 'lyrics' ? (
        <div className="flex-1 overflow-y-auto px-3 md:px-5 pb-4">
          {!debouncedLyricsQuery.trim() ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Mic2 size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">Search for a lyric to find matching songs</p>
            </div>
          ) : lyricsLoading && lyricsResults.length === 0 ? (
            <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Searching…</span>
            </div>
          ) : lyricsError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <p className="text-text-muted text-sm">Failed to search: {lyricsError}</p>
            </div>
          ) : lyricsResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Mic2 size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">No songs found with lyrics matching "{debouncedLyricsQuery}"</p>
            </div>
          ) : (
            <>
              <div className="space-y-0.5">
                {linkedLyricsResults.map((song) => (
                  <LyricResultRow
                    key={song.id}
                    song={song}
                    query={debouncedLyricsQuery}
                    onPlay={handlePlay}
                    onCategoryClick={handleCategoryClick}
                    onEraClick={handleEraClick}
                    onInfo={handleInfo}
                    onContextMenu={handleContextMenu}
                    selectMode={selectMode}
                    selected={selected.has(song.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
              {lyricsHasMore ? (
                <div className="flex items-center justify-center py-4">
                  <button
                    onClick={loadMoreLyrics}
                    disabled={lyricsLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
                  >
                    {lyricsLoading && <Loader2 size={13} className="animate-spin" />}
                    Load more
                  </button>
                </div>
              ) : (
                <p className="text-center text-text-muted text-xs py-4">{lyricsCount.toLocaleString()} songs found</p>
              )}
            </>
          )}
        </div>
      ) : trackerTab === 'calendar' ? (
        <div className="flex-1 overflow-y-auto px-3 md:px-5 pb-4">
          {calendarLoading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Loading recording dates…</span>
            </div>
          ) : calendarError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <p className="text-text-muted text-sm">Failed to load: {calendarError}</p>
            </div>
          ) : calendarByDate.size === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CalendarDays size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">No recording dates found</p>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-5 md:gap-6 items-start">
              <div className="w-full md:w-80 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => shiftCalendarMonth(-1)}
                    className="p-2 md:p-1.5 rounded-lg hover:bg-surface-overlay active:bg-surface-overlay text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <p className="text-text-primary text-sm font-semibold">
                    {calendarMonth ? `${MONTH_LABELS[calendarMonth.month]} ${calendarMonth.year}` : ''}
                  </p>
                  <button
                    onClick={() => shiftCalendarMonth(1)}
                    className="p-2 md:p-1.5 rounded-lg hover:bg-surface-overlay active:bg-surface-overlay text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1">
                  {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="text-center text-text-muted text-[0.625rem] font-medium uppercase tracking-wide py-1">
                      {label}
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  {calendarMonth && buildMonthGrid(calendarMonth.year, calendarMonth.month).map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                      {week.map((date, di) => {
                        if (!date) return <div key={di} />
                        const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate())
                        const daySongs = calendarByDate.get(key)
                        const isSelected = selectedDateKey === key
                        const dayEraNames = daySongs
                          ? [...new Set(daySongs.map((s) => s.era?.name).filter((n): n is string => !!n))]
                          : []
                        const soleEraColor = dayEraNames.length === 1 ? eraColorMap.get(dayEraNames[0]) ?? DEFAULT_ERA_COLOR : null
                        return (
                          <button
                            key={di}
                            onClick={() => { if (daySongs) { setSelectedDateKey(key); setSelectedStudio(null) } }}
                            disabled={!daySongs}
                            title={dayEraNames.join(', ') || undefined}
                            className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors border ${
                              isSelected
                                ? 'bg-accent border-accent text-white font-semibold'
                                : !daySongs
                                  ? 'border-transparent text-text-muted opacity-40 cursor-default'
                                  : soleEraColor
                                    ? `${soleEraColor.bg} ${soleEraColor.border} ${soleEraColor.text} font-medium hover:opacity-80 cursor-pointer`
                                    : 'bg-accent/10 border-transparent text-accent font-medium hover:bg-accent/20 cursor-pointer'
                            }`}
                          >
                            <span className="text-xs leading-none">{date.getDate()}</span>
                            {daySongs && (
                              <span className={`text-[0.5625rem] leading-none tabular-nums ${isSelected ? 'text-white/80' : 'opacity-70'}`}>
                                {daySongs.length}
                              </span>
                            )}
                            {!isSelected && dayEraNames.length > 1 && (
                              <span className="flex items-center gap-0.5 mt-0.5">
                                {dayEraNames.slice(0, 4).map((name) => (
                                  <span key={name} className={`w-1 h-1 rounded-full ${(eraColorMap.get(name) ?? DEFAULT_ERA_COLOR).dot}`} />
                                ))}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {eras.length > 0 && (
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1 mt-3 pt-3 border-t border-[var(--border)]">
                    {eras.map((era) => (
                      <div key={era.id} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(eraColorMap.get(era.name) ?? DEFAULT_ERA_COLOR).dot}`} />
                        <span className="text-text-muted text-[0.625rem] truncate">{eraLabel(era.name, fullEraNames)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {calendarByStudio.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <p className="text-[0.5625rem] font-bold uppercase tracking-widest text-text-muted mb-1.5">Studios</p>
                    <div className="flex flex-col max-h-64 overflow-y-auto -mx-1">
                      {calendarByStudio.map(([studio, songs]) => (
                        <button
                          key={studio}
                          onClick={() => { setSelectedStudio(studio); setSelectedDateKey(null) }}
                          title={studio}
                          className={`flex items-center justify-between gap-2 px-1 py-1.5 md:py-1 rounded-lg text-left text-xs transition-colors ${
                            selectedStudio === studio
                              ? 'text-accent font-semibold bg-accent/5'
                              : 'text-text-secondary hover:text-text-primary active:bg-surface-overlay hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="truncate">{studio}</span>
                          <span className="text-text-muted text-[0.625rem] tabular-nums shrink-0">{songs.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 w-full">
                {selectedStudio ? (
                  <>
                    <p className="text-text-muted text-[0.6875rem] font-semibold uppercase tracking-wide mb-2 truncate" title={selectedStudio}>
                      Recorded at {selectedStudio}
                      {' '}· {(calendarByStudio.find(([s]) => s === selectedStudio)?.[1] ?? []).length}{' '}
                      {(calendarByStudio.find(([s]) => s === selectedStudio)?.[1] ?? []).length === 1 ? 'song' : 'songs'}
                    </p>
                    <div className="space-y-0.5">
                      {(calendarByStudio.find(([s]) => s === selectedStudio)?.[1] ?? []).map((song) => (
                        <SongRow
                          key={song.id}
                          song={song}
                          onPlay={handlePlay}
                          onCategoryClick={handleCategoryClick}
                          onEraClick={handleEraClick}
                          onInfo={handleInfo}
                          onContextMenu={handleContextMenu}
                          selectMode={selectMode}
                          selected={selected.has(song.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </div>
                  </>
                ) : !selectedDateKey ? (
                  <p className="text-text-muted text-xs py-4">Select a highlighted day, or a studio, to see songs recorded there.</p>
                ) : (
                  <>
                    <p className="text-text-muted text-[0.6875rem] font-semibold uppercase tracking-wide mb-2">
                      Recorded {new Date(selectedDateKey + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                      {' '}· {(calendarByDate.get(selectedDateKey) ?? []).length} {(calendarByDate.get(selectedDateKey) ?? []).length === 1 ? 'song' : 'songs'}
                    </p>
                    <div className="space-y-0.5">
                      {(calendarByDate.get(selectedDateKey) ?? []).map((song) => (
                        <SongRow
                          key={song.id}
                          song={song}
                          onPlay={handlePlay}
                          onCategoryClick={handleCategoryClick}
                          onEraClick={handleEraClick}
                          onInfo={handleInfo}
                          onContextMenu={handleContextMenu}
                          selectMode={selectMode}
                          selected={selected.has(song.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ) : trackerTab === 'producers' ? (
        <div className="flex-1 overflow-y-auto px-3 md:px-5 pb-4">
          {calendarLoading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Loading producers…</span>
            </div>
          ) : calendarError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <p className="text-text-muted text-sm">Failed to load: {calendarError}</p>
            </div>
          ) : producersByName.length === 0 && engineersByName.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Users size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">No producer or engineer credits found</p>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-5 md:gap-6 items-start">
              <div className="w-full md:w-80 shrink-0 flex flex-col gap-4">
                {producersByName.length > 0 && (
                  <div>
                    <p className="text-[0.5625rem] font-bold uppercase tracking-widest text-text-muted mb-1.5">Producers</p>
                    <div className="flex flex-col max-h-64 overflow-y-auto -mx-1">
                      {producersByName.map(([producer, songs]) => (
                        <button
                          key={producer}
                          onClick={() => { setSelectedProducer(producer); setSelectedEngineer(null) }}
                          title={producer}
                          className={`flex items-center justify-between gap-2 px-1 py-1.5 md:py-1 rounded-lg text-left text-xs transition-colors ${
                            selectedProducer === producer
                              ? 'text-accent font-semibold bg-accent/5'
                              : 'text-text-secondary hover:text-text-primary active:bg-surface-overlay hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="truncate">{producer}</span>
                          <span className="text-text-muted text-[0.625rem] tabular-nums shrink-0">{songs.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {engineersByName.length > 0 && (
                  <div>
                    <p className="text-[0.5625rem] font-bold uppercase tracking-widest text-text-muted mb-1.5">Engineers</p>
                    <div className="flex flex-col max-h-64 overflow-y-auto -mx-1">
                      {engineersByName.map(([engineer, songs]) => (
                        <button
                          key={engineer}
                          onClick={() => { setSelectedEngineer(engineer); setSelectedProducer(null) }}
                          title={engineer}
                          className={`flex items-center justify-between gap-2 px-1 py-1.5 md:py-1 rounded-lg text-left text-xs transition-colors ${
                            selectedEngineer === engineer
                              ? 'text-accent font-semibold bg-accent/5'
                              : 'text-text-secondary hover:text-text-primary active:bg-surface-overlay hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="truncate">{engineer}</span>
                          <span className="text-text-muted text-[0.625rem] tabular-nums shrink-0">{songs.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 w-full">
                {selectedProducer ? (
                  <>
                    <p className="text-text-muted text-[0.6875rem] font-semibold uppercase tracking-wide mb-2 truncate" title={selectedProducer}>
                      Produced by {selectedProducer}
                      {' '}· {(producersByName.find(([p]) => p === selectedProducer)?.[1] ?? []).length}{' '}
                      {(producersByName.find(([p]) => p === selectedProducer)?.[1] ?? []).length === 1 ? 'song' : 'songs'}
                    </p>
                    <div className="space-y-0.5">
                      {(producersByName.find(([p]) => p === selectedProducer)?.[1] ?? []).map((song) => (
                        <SongRow
                          key={song.id}
                          song={song}
                          onPlay={handlePlay}
                          onCategoryClick={handleCategoryClick}
                          onEraClick={handleEraClick}
                          onInfo={handleInfo}
                          onContextMenu={handleContextMenu}
                          selectMode={selectMode}
                          selected={selected.has(song.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </div>
                  </>
                ) : selectedEngineer ? (
                  <>
                    <p className="text-text-muted text-[0.6875rem] font-semibold uppercase tracking-wide mb-2 truncate" title={selectedEngineer}>
                      Engineered by {selectedEngineer}
                      {' '}· {(engineersByName.find(([e]) => e === selectedEngineer)?.[1] ?? []).length}{' '}
                      {(engineersByName.find(([e]) => e === selectedEngineer)?.[1] ?? []).length === 1 ? 'song' : 'songs'}
                    </p>
                    <div className="space-y-0.5">
                      {(engineersByName.find(([e]) => e === selectedEngineer)?.[1] ?? []).map((song) => (
                        <SongRow
                          key={song.id}
                          song={song}
                          onPlay={handlePlay}
                          onCategoryClick={handleCategoryClick}
                          onEraClick={handleEraClick}
                          onInfo={handleInfo}
                          onContextMenu={handleContextMenu}
                          selectMode={selectMode}
                          selected={selected.has(song.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-text-muted text-xs py-4">Select a producer or engineer to see songs they worked on.</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Column headers. Compact view swaps in its own pair (Title /
              Versions sorting the grouped rows) in the SAME outer slot as the
              flat headers - same wrapper + padding, so the list below starts
              at an identical y-offset and nothing jumps when toggling. */}
          {viewMode === 'list' && (
            <div className="hidden md:block px-5 pb-1 shrink-0">
              <div className="flex items-center gap-3 px-3 py-1">
                <div className="w-9 shrink-0" />
                {compactView ? (
                  <>
                    <button
                      onClick={() => handleCompactSort('name')}
                      className={`flex-1 flex items-center gap-0.5 text-xs font-medium uppercase tracking-wider transition-colors ${compactSort.field === 'name' ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                    >
                      Title
                      {compactSort.field === 'name'
                        ? compactSort.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                        : <span className="w-2.5" />}
                    </button>
                    {/* Static label - compact view has no category sort; sits
                        over CompactGroupRow's w-24 category badge column. */}
                    <span className="w-24 shrink-0 text-center text-xs font-medium uppercase tracking-wider text-text-muted">Category</span>
                    <button
                      onClick={() => handleCompactSort('versions')}
                      className={`w-20 shrink-0 justify-end flex items-center gap-0.5 text-xs font-medium uppercase tracking-wider transition-colors ${compactSort.field === 'versions' ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                    >
                      Versions
                      {compactSort.field === 'versions'
                        ? compactSort.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                        : <span className="w-2.5" />}
                    </button>
                    {/* Trails the expand chevron CompactGroupRow renders at
                        the row's right edge, keeping "Versions" over the count. */}
                    <span className="shrink-0" style={{ width: 14 }} />
                  </>
                ) : (
                  <>
                    <SortBtn field="name" label="Title" className="flex-1" orderField={orderField} orderDir={orderDir} onClick={handleSort} />
                    <SortBtn field="credited_artists" label="Artist" className="w-32 shrink-0" orderField={orderField} orderDir={orderDir} onClick={handleSort} />
                    <SortBtn field="era__name" label="Era" className="w-36 shrink-0" orderField={orderField} orderDir={orderDir} onClick={handleSort} />
                    <SortBtn field="category" label="Category" className="w-24 shrink-0 justify-center" orderField={orderField} orderDir={orderDir} onClick={handleSort} />
                    <SortBtn field="length" label="Time" className="w-12 shrink-0 justify-end" orderField={orderField} orderDir={orderDir} onClick={handleSort} />
                    <div className="w-14 shrink-0" />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Song list / grid */}
          {/* relative so CompactGroupList's offset math is measured against
              this scroller rather than some higher positioned ancestor. */}
          <div ref={listScrollRef} className="relative flex-1 overflow-y-auto px-3 md:px-5 pb-4">
            {compactView ? loadingCompact ? (
              <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading version groups…</span>
              </div>
            ) : filteredCompactGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Layers size={32} className="text-text-muted opacity-30" />
                <p className="text-text-muted text-sm">
                  {compactGroups.length === 0 ? 'No version groups yet' : `No version groups match "${debouncedSearch}"`}
                </p>
              </div>
            ) : (
              <CompactGroupList
                scrollRef={listScrollRef}
                groups={filteredCompactGroups}
                expanded={expandedGroups}
                onToggleGroup={handleToggleGroup}
                onGroupContextMenu={handleGroupContextMenu}
                onPlay={handlePlay}
                onCategoryClick={handleCategoryClick}
                onEraClick={handleEraClick}
                onInfo={handleInfo}
                onContextMenu={handleContextMenu}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            ) : (loading || (orderField === 'date_added' && !recentlyAddedMap)) && sortedSongs.length === 0 ? (
              <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">{orderField ? 'Loading full library for sorting…' : 'Loading…'}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                <p className="text-text-muted text-sm">Failed to load: {error}</p>
                <button onClick={resetSongs} className="text-accent text-sm underline">Retry</button>
              </div>
            ) : sortedSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Music2 size={32} className="text-text-muted opacity-30" />
                <p className="text-text-muted text-sm">No songs found</p>
              </div>
            ) : viewMode === 'list' ? (
              <VirtualSongList
                scrollRef={listScrollRef}
                songs={sortedSongs}
                onPlay={handlePlay}
                onCategoryClick={handleCategoryClick}
                onEraClick={handleEraClick}
                onInfo={handleInfo}
                onContextMenu={handleContextMenu}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            ) : viewMode === 'grid' ? (
              <VirtualSongGrid
                scrollRef={listScrollRef}
                songs={sortedSongs}
                onPlay={handlePlay}
                onQueue={handleQueue}
                onCategoryClick={handleCategoryClick}
                onEraClick={handleEraClick}
                onInfo={handleInfo}
                onContextMenu={handleContextMenu}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            ) : (
              <VirtualSongDetailList
                scrollRef={listScrollRef}
                songs={sortedSongs}
                onPlay={handlePlay}
                onCategoryClick={handleCategoryClick}
                onEraClick={handleEraClick}
                onInfo={handleInfo}
                onContextMenu={handleContextMenu}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            )}
            {/* Sentinel always in DOM so IntersectionObserver is set up from mount */}
            <div ref={sentinelRef} className="h-4" />
            {loading && sortedSongs.length > 0 && (
              <div className="flex items-center justify-center gap-2 py-4 text-text-muted">
                <Loader2 size={16} className="animate-spin" />
                {fetchAllMode && <span className="text-xs">{sortedSongs.length.toLocaleString()} / {count.toLocaleString()} loaded</span>}
              </div>
            )}
            {!loading && !hasMore && sortedSongs.length > 0 && (
              <p className="text-center text-text-muted text-xs py-4">{count.toLocaleString()} songs total</p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Bulk selection action bar */}
      {selectMode && (
        <div className="shrink-0 border-t border-[var(--border)] bg-surface relative">
          {(bulkZipStatus === 'partial' || bulkZipStatus === 'none') && (
            <div className="px-4 py-2 flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-500 text-xs font-medium">
              <AlertTriangle size={14} className="shrink-0" />
              {bulkZipStatus === 'none'
                ? "Couldn't download - none of the selected songs have a file available yet."
                : `${bulkZipSkipped} of ${selected.size} selected song${selected.size === 1 ? '' : 's'} ${bulkZipSkipped === 1 ? "wasn't" : "weren't"} available and ${bulkZipSkipped === 1 ? 'was' : 'were'} left out of the download.`}
            </div>
          )}
          <div className="px-4 py-2.5 flex items-center gap-2">
          <span className="text-sm text-text-primary font-medium flex-1 flex items-center gap-1.5">
            {selectAllLoading
              ? <><Loader2 size={13} className="animate-spin" /> Selecting all…</>
              : <>{selected.size} {selected.size === 1 ? 'song' : 'songs'} selected</>}
          </span>
          <button
            onClick={selectAllSongs}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
          >
            {selectAllLoading ? 'Cancel' : 'Select all'}
          </button>
          <button
            onClick={() => setSelected(new Map())}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
          >
            Clear
          </button>
          <button
            onClick={bulkAddToQueue}
            disabled={selected.size === 0 || !canBulkAddToQueue}
            title={!canBulkAddToQueue && selected.size > 0 ? "Can't queue while a session/unsurfaced song is selected" : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
          >
            <ListPlus size={13} /> Add to queue
          </button>
          <div className="relative">
            <button
              onClick={() => setShowBulkPlaylists(v => !v)}
              disabled={selected.size === 0 || !canBulkAddToPlaylist}
              title={!canBulkAddToPlaylist && selected.size > 0 ? "Can't add to playlist while a session/unsurfaced song is selected" : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <Plus size={13} /> Add to playlist
            </button>
            {showBulkPlaylists && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBulkPlaylists(false)} />
                <div className="absolute right-0 bottom-full mb-1 z-50 w-56 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border)] text-[0.6875rem] uppercase tracking-wider text-text-muted font-semibold">
                    Add to playlist
                  </div>
                  {!account ? (
                    <div className="p-3">
                      <p className="text-xs text-text-muted mb-2">Log in to save to playlists.</p>
                      <button
                        onClick={() => { setShowUserAuth(true); setShowBulkPlaylists(false) }}
                        className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
                      >
                        Log in
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto py-1">
                      {playlists.length === 0 && (
                        <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
                      )}
                      {playlists.map(p => {
                        const allIn = bulkContained.has(p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => { bulkAddToPlaylist(p.id); setShowBulkPlaylists(false) }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                          >
                            <ListMusic size={14} className={`shrink-0 ${allIn ? 'text-accent' : 'text-text-muted'}`} />
                            <span className="flex-1 truncate">{p.name}</span>
                            {allIn && <Check size={12} className="text-accent shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => openBulkEditor(selectedSongs)}
              disabled={selected.size === 0}
              title="Edit fields across every selected song"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
          {versionsEnabled && canEdit && (
            <button
              onClick={bulkLinkVersions}
              disabled={selected.size < 2 || bulkLinkStatus === 'linking'}
              title={selected.size < 2 ? 'Select 2 or more songs to link' : 'Link selected songs as versions of each other'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {bulkLinkStatus === 'linking' ? (
                <><Loader2 size={13} className="animate-spin" /> Linking…</>
              ) : bulkLinkStatus === 'done' ? (
                <><Check size={13} /> Linked</>
              ) : bulkLinkStatus === 'error' ? (
                <><X size={13} /> Error</>
              ) : (
                <><Link2 size={13} /> Link versions</>
              )}
            </button>
          )}
          <button
            onClick={bulkDownloadZip}
            disabled={selected.size === 0 || bulkZipStatus === 'zipping'}
            title={
              bulkZipStatus === 'partial'
                ? `${bulkZipSkipped} of ${selected.size} selected song${selected.size === 1 ? '' : 's'} couldn't be included (no file available)`
                : bulkZipStatus === 'none'
                ? 'None of the selected songs have a downloadable file'
                : undefined
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-90 ${
              bulkZipStatus === 'partial' || bulkZipStatus === 'none' ? 'bg-amber-500 text-white' : 'bg-accent text-white'
            }`}
          >
            {bulkZipStatus === 'zipping' ? (
              <><Loader2 size={13} className="animate-spin" /> Downloading…</>
            ) : bulkZipStatus === 'done' ? (
              <><Check size={13} /> Done</>
            ) : bulkZipStatus === 'partial' ? (
              <><AlertTriangle size={13} /> {bulkZipSkipped} skipped</>
            ) : bulkZipStatus === 'none' ? (
              <><AlertTriangle size={13} /> No files available</>
            ) : bulkZipStatus === 'error' ? (
              <><X size={13} /> Error</>
            ) : (
              <><PackageOpen size={13} /> Download</>
            )}
          </button>
          <button
            onClick={exitSelectMode}
            className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
            title="Exit selection"
          >
            <X size={15} className="text-text-muted" />
          </button>
          </div>
        </div>
      )}

      {contextMenu && (
        <SongContextMenu
          state={{ track: songToTrack(contextMenu.song), songId: contextMenu.song.id, x: contextMenu.x, y: contextMenu.y }}
          song={contextMenu.song}
          onClose={() => setContextMenu(null)}
          onInfo={() => handleInfo(contextMenu.song)}
          onAddToQueue={() => handleQueue(songToTrack(contextMenu.song))}
          onShowInFiles={() => handleShowInFiles(contextMenu.song)}
          canEdit={canEdit}
          onSelect={() => toggleSelect(contextMenu.song)}
          liked={likedTrackIds.includes(`jw-${contextMenu.song.id}`)}
          onToggleLike={() => toggleLike(`jw-${contextMenu.song.id}`)}
          canLinkSessionFile={canLinkSessions}
          hasSessionLinkOverride={!!peekSessionEditOverride(contextMenu.song.id, activeChannel)}
          onLinkSessionFile={() => setLinkingSessionSong(contextMenu.song)}
          onClearSessionLink={() => handleClearSessionLink(contextMenu.song)}
        />
      )}

      {linkingSessionSong && (
        <FilePickerModal
          kind="audio"
          songTitle={linkingSessionSong.name}
          title="Link Session Edit file"
          onSelect={handleSessionFilePicked}
          onClose={() => setLinkingSessionSong(null)}
        />
      )}

      {bulkContextMenu && (
        <BulkContextMenu
          state={bulkContextMenu}
          onClose={() => setBulkContextMenu(null)}
          count={selected.size}
          onAddToQueue={() => { bulkAddToQueue(); setBulkContextMenu(null) }}
          onDownloadZip={() => { bulkDownloadZip(); setBulkContextMenu(null) }}
          onTogglePlaylists={() => setBulkContextMenu((prev) => prev ? { ...prev, showPlaylists: !prev.showPlaylists } : null)}
          playlists={playlists}
          account={account}
          onAddToPlaylist={(id) => { bulkAddToPlaylist(id); setBulkContextMenu(null) }}
          onLogin={() => { setShowUserAuth(true); setBulkContextMenu(null) }}
          canLinkVersions={versionsEnabled && canEdit && selected.size >= 2}
          onLinkVersions={() => { bulkLinkVersions(); setBulkContextMenu(null) }}
          canBulkEdit={canEdit && selected.size > 0}
          onBulkEdit={() => { openBulkEditor(selectedSongs); setBulkContextMenu(null) }}
          canAddToPlaylist={canBulkAddToPlaylist}
          canAddToQueue={canBulkAddToQueue}
          contained={bulkContained}
        />
      )}

      {titlePromptGroupId !== null && (
        <VersionTitlePromptModal
          saving={savingTitlePrompt}
          onSkip={() => setTitlePromptGroupId(null)}
          onSave={async (title) => {
            setSavingTitlePrompt(true)
            try {
              await setGroupVersionTitle(titlePromptGroupId, title)
              invalidateCompactGroupsCache()
            } finally {
              setSavingTitlePrompt(false)
              setTitlePromptGroupId(null)
            }
          }}
        />
      )}
    </div>
  )
}
