import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ListMusic, Play, Loader2, Plus, Trash2, Pencil, ArrowLeft,
  X, Check, Heart, Shuffle, Music2, Clock, GripVertical, Rss,
  ListPlus, Download, Archive, Info, FolderInput, MoreHorizontal,
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ImageOff, Globe, Lock, Link, ListEnd, HardDrive, CircleArrowDown, Layers,
  CheckSquare2, Square, LayoutGrid, Rows3,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import * as userApi from '../lib/userApi'
import type { PlaylistDetail, PlaylistSummary } from '../lib/userApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import { Track, LocalPlaylist, LibraryTrack, FollowedPlaylist } from '../types'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { buildImageUrl, buildStreamUrl, JWAPI_BASE, getSongsByIds, playlistCoverUrl, smallCoverUrl, CATEGORY_LABELS, CATEGORY_COLORS, apiFileIdToPath, apiFilePathToTrack, resolveSessionEditSource } from '../lib/juicewrldApi'
import { toFileUrl, libraryTrackToTrack as libTrackToTrack } from '../lib/fileTypes'
import { formatDuration, formatTotalDuration } from '../lib/format'
import { fisherYates, groupExcludedVersions, isExcludedVersion } from '../store/queueSlice'
import LikedSongsView from './LikedSongsView'
import { AlbumArtThumb } from './LibraryTab'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { CompactGroupRow, CompactEmptyIcon, useExpandedGroups } from './CompactGroupRow'
import { groupItemsByVersion, filterCompactGroups, subscribeCompactGroupsInvalidation } from '../lib/compactGroups'
import type { CompactGroup } from '../lib/compactGroups'
import { versionsEnabled } from '../lib/versionsApi'
import { shareOrigin } from '../lib/platform'
import { useVirtualWindowEl } from '../hooks/useVirtualWindow'
import PlaylistCard from './PlaylistCard'
import { allFolderedKeys, folderOfPlaylist, parsePlaylistKey } from '../lib/playlistFolders'
import type { PlaylistFolder } from '../lib/playlistFolders'
import { Folder, FolderPlus, FolderOpen, FolderMinus } from 'lucide-react'
import { useMultiSelect } from '../hooks/useMultiSelect'
import { useLongPress } from '../hooks/useLongPress'
import { ClampedMenu } from './ClampedMenu'
import { placeFlyout } from '../lib/menuFlyout'
import { loadEraFullNames, eraLabel } from '../lib/eras'
import { getSkin } from '../lib/skins'

// ── PlaylistMosaic ────────────────────────────────────────────────────────────

function PlaylistMosaic({ tracks, className = '' }: { tracks: Track[]; className?: string }): JSX.Element {
  const artUrls = tracks.slice(0, 4).map(t => t.imageUrl).filter(Boolean) as string[]
  if (artUrls.length === 0) {
    return (
      <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
        <Music2 size={48} className="text-accent/50" />
      </div>
    )
  }
  if (artUrls.length < 4) return <ProgressiveCover src={artUrls[0]} className={`object-cover ${className}`} />
  return (
    <div className={`grid grid-cols-2 ${className}`} style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
      {/* Each quadrant is half the box, so the degraded covers are enough - and
          four full-size ones per playlist is exactly the load worth avoiding. */}
      {artUrls.map((url, i) => (
        <img key={i} src={smallCoverUrl(url)} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} />
      ))}
    </div>
  )
}

// ── HeroBackdrop - Apple Music-style full-bleed blurred cover art behind the
// playlist header, instead of a faint corner blob. Fades into the page's own
// background at the bottom so the track list below sits on ordinary bg.
// Independent of the "App gradients" setting - this is the hero's own art,
// not a decorative accent wash.
//
// The darkening overlay was hardcoded to black, which reads as a dark banner
// slapped onto an otherwise light page on a light skin. Mirror it instead:
// dark skins darken toward black (unchanged), light skins lighten toward
// white, both fading into the real --surface either way.
function HeroBackdrop({ src, isDarkSkin }: { src?: string | null; isDarkSkin: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {src && (
        <img
          // Blurred past recognition, so the degraded copy is indistinguishable
          // from the original and shows up far sooner.
          src={smallCoverUrl(src)}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: `blur(50px) saturate(1.7) brightness(${isDarkSkin ? 0.5 : 0.85})`,
            transform: 'scale(1.3)',
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: isDarkSkin
            ? 'linear-gradient(to bottom, rgb(0 0 0 / 0.10), rgb(0 0 0 / 0.05), var(--surface))'
            : 'linear-gradient(to bottom, rgb(255 255 255 / 0.35), rgb(255 255 255 / 0.15), var(--surface))',
        }}
      />
    </div>
  )
}

// ── HeroPlayButton / HeroShuffleButton - Apple Music-style circular icon
// controls, replacing the pill-shaped "Play"/"Shuffle" text buttons.
function HeroPlayButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-14 h-14 rounded-full bg-accent text-black shadow-lg hover:scale-105 active:scale-95 transition-transform"
      title="Play"
    >
      <Play size={22} fill="currentColor" className="ml-0.5" />
    </button>
  )
}
function HeroShuffleButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-11 h-11 rounded-full bg-surface-overlay hover:bg-surface-raised text-text-primary border border-[var(--border)] transition-colors"
      title="Shuffle"
    >
      <Shuffle size={17} />
    </button>
  )
}

// (The per-tile hover play button lives in PlaylistCard now - every grid,
// including the logged-out one, renders tiles through it.)

function totalDurationLabel(tracks: Track[]): string {
  const secs = tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0)
  if (secs === 0) return ''
  return formatTotalDuration(secs)
}

// ── MenuItem helper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MenuItem({ icon: Icon, label, onClick, destructive = false, disabled = false, trailing, innerRef }: {
  icon: React.ElementType<any>
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  trailing?: React.ReactNode
  innerRef?: React.Ref<HTMLButtonElement>
}): JSX.Element {
  return (
    <button
      ref={innerRef}
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed ${
        destructive ? 'text-red-400 hover:text-red-300' : 'text-text-primary'
      }`}
    >
      <Icon size={14} className={destructive ? 'text-red-400' : 'text-text-muted'} />
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  )
}

type SortField = 'default' | 'index' | 'title' | 'artist' | 'era' | 'category' | 'duration'
interface SortState { field: SortField; dir: 'asc' | 'desc' }

type CardMenuState =
  | { kind: 'api';   playlist: PlaylistSummary; x: number; y: number; showPlaylists: boolean; showFolders?: boolean; renaming?: boolean; renameVal?: string }
  | { kind: 'local'; playlist: LocalPlaylist;   x: number; y: number; showPlaylists: boolean; showFolders?: boolean; renaming?: boolean; renameVal?: string }

// ── Tracklist skeleton ────────────────────────────────────────────────────────

function TrackSkeleton(): JSX.Element {
  return (
    <div className="space-y-1 pt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid items-center gap-3 px-4 py-2" style={{ gridTemplateColumns: '1rem 1.75rem 2.5rem 1fr 3.5rem 2.25rem' }}>
          <span />
          <div className="w-4 h-3 rounded bg-surface-overlay animate-pulse" />
          <div className="w-10 h-10 rounded-md bg-surface-overlay animate-pulse" />
          <div className="space-y-1.5">
            <div className={`h-3 rounded bg-surface-overlay animate-pulse`} style={{ width: `${55 + (i * 17) % 35}%` }} />
            <div className="h-2.5 rounded bg-surface-overlay animate-pulse w-1/3" />
          </div>
          <div className="h-3 w-8 rounded bg-surface-overlay animate-pulse mx-auto" />
          <span />
        </div>
      ))}
    </div>
  )
}

// ── Sort header cell ──────────────────────────────────────────────────────────

function SortHeader({ label, field, sort, onSort }: {
  label: string | React.ReactNode
  field: SortField
  sort: SortState
  onSort: (f: SortField) => void
}): JSX.Element {
  const active = sort.field === field
  return (
    <button
      onClick={() => field !== 'default' && onSort(field)}
      className={`flex items-center gap-0.5 transition-colors ${field === 'default' ? 'cursor-default' : 'hover:text-text-primary'} ${active ? 'text-text-primary' : ''}`}
    >
      {label}
      {active && field !== 'default' && (
        sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
      )}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

function FolderSlotImg({ src }: { src: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed
  return (
    <div className="w-full h-full overflow-hidden bg-surface-raised">
      {showImg
        ? <img src={src} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} onError={() => setFailed(true)} />
        : <div className="w-full h-full flex items-center justify-center"><Music2 size={16} className="text-accent/40" /></div>}
    </div>
  )
}

// ── Local-library helpers ─────────────────────────────────────────────────────

function LocalPlaylistMosaic({ trackIds, className = '' }: {
  trackIds: string[]; className?: string
}): JSX.Element {
  // Covers live in the store's libraryArt map (keyed by track id), populated as
  // tracks are viewed in the Library tab - read them straight from there.
  const libraryArt = useStore(s => s.libraryArt)
  const covers = trackIds
    .map(id => libraryArt[id])
    .filter((a): a is string => !!a)
    .slice(0, 4)
  if (covers.length === 0) {
    return (
      <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
        <HardDrive size={32} className="text-accent/50" />
      </div>
    )
  }
  if (covers.length < 4) {
    return <img src={covers[0]} alt="" className={`object-cover ${className}`} />
  }
  return (
    <div className={`grid grid-cols-2 ${className}`} style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
      {covers.map((src, i) => (
        <img key={i} src={src} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} />
      ))}
    </div>
  )
}

// ── PlaylistExpandPanel ───────────────────────────────────────────────────────
// The inline "quick view" that opens below a clicked card's row, spanning the
// full grid width (col-span-full breaks the CSS grid's auto-flow onto its own
// row right there, pushing later cards down onto the row after it - no need
// to know how many columns are actually rendered).
function PlaylistExpandPanel({ name, subtitle, cover, tracks, loading, onClose, onPlayTrack, onOpenFull, onTrackContextMenu }: {
  name: string
  subtitle: string
  cover: React.ReactNode
  tracks: Track[]
  loading: boolean
  onClose: () => void
  onPlayTrack: (track: Track) => void
  /** Jumps to the old full-page playlist view (drag-reorder, sort, share,
   *  offline download, etc.) - this quick-view panel is deliberately a
   *  lighter subset, not a replacement for it. */
  onOpenFull: () => void
  onTrackContextMenu: (track: Track, e: React.MouseEvent) => void
}): JSX.Element {
  const currentTrack = useStore(s => s.currentTrack)
  const mid = Math.ceil(tracks.length / 2)
  const columns = [tracks.slice(0, mid), tracks.slice(mid)]

  return (
    <div
      className="col-span-full rounded-2xl overflow-hidden relative bg-surface-raised border border-[var(--border)] p-5 md:p-6 animate-in fade-in slide-in-from-top-1 duration-150"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={onClose}
        className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors z-10"
        title="Close"
      >
        <X size={15} />
      </button>

      <div className="flex items-center gap-4 mb-5 pr-8">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden shrink-0 shadow-lg bg-surface-overlay">{cover}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-text-primary text-base md:text-lg font-bold truncate">{name}</h3>
          <p className="text-text-muted text-sm mt-0.5">{subtitle}</p>
          <button
            onClick={onOpenFull}
            className="flex items-center gap-0.5 text-accent text-xs font-medium mt-1 hover:underline"
          >
            Open full playlist <ChevronRight size={12} />
          </button>
        </div>
        <button
          onClick={() => tracks.length && onPlayTrack(tracks[0])}
          disabled={tracks.length === 0}
          className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-accent text-black flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform shrink-0 disabled:opacity-40 disabled:hover:scale-100"
          title="Play"
        >
          <Play size={16} fill="currentColor" className="ml-0.5" />
        </button>
      </div>

      {loading && tracks.length === 0 ? (
        <TrackSkeleton />
      ) : tracks.length === 0 ? (
        <p className="text-text-muted text-sm py-2">No tracks yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {columns.map((col, colIdx) => (
            <div key={colIdx} className="flex flex-col">
              {col.map((t, i) => {
                const isActive = currentTrack?.id === t.id
                return (
                  <div
                    key={t.id}
                    onClick={() => onPlayTrack(t)}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onTrackContextMenu(t, e) }}
                    className="flex items-center gap-3 px-1.5 py-1.5 rounded-lg hover:bg-surface-overlay text-left group/track transition-colors cursor-pointer"
                  >
                    <span className={`w-5 text-xs tabular-nums text-right shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`}>
                      {isActive ? '▶' : colIdx * mid + i + 1}
                    </span>
                    <span className={`flex-1 truncate text-sm ${isActive ? 'text-accent font-semibold' : 'text-text-primary'}`} title={t.title}>
                      {t.title}
                    </span>
                    <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(t.duration, '')}</span>
                    <button
                      onClick={e => { e.stopPropagation(); onTrackContextMenu(t, e) }}
                      className="p-1 -mr-1 text-text-muted hover:text-text-primary opacity-0 group-hover/track:opacity-100 transition-opacity shrink-0"
                      title="More options"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Row-aware grid expansion ──────────────────────────────────────────────────
// A CSS grid item with `grid-column: 1 / -1` (the "spans the full row" trick
// used to break a quick-view panel onto its own row) forces auto-placement to
// restart at column 1 for everything that comes after it - so inserting one
// right after the clicked card mid-row shoves every card to its right down
// onto the row below, instead of leaving that row intact. Fix: figure out how
// many columns the grid is actually rendering right now (auto-fill decides
// this per pixel width, so it has to be measured, not assumed), then insert
// the panel after the LAST card of the clicked card's row instead - nothing
// in that row moves, and the panel still lands directly beneath it.

type GridEntry = { key: string; tile: JSX.Element; panel: JSX.Element | null }

// Takes the element itself (state, not a mutable ref object) so the
// measuring effect re-runs when a conditionally-rendered grid - like a
// folder's member grid, which doesn't exist in the DOM until the folder is
// opened - actually mounts. A plain useRef's identity never changes, so an
// effect keyed on it only ever runs once at the owning component's initial
// mount, back when such a grid's ref.current was still null; it would then
// silently stay stuck at the default column count forever.
function useGridColumnCount(el: HTMLDivElement | null): number {
  const [cols, setCols] = useState(1)
  useEffect(() => {
    if (!el) return
    const measure = (): void => {
      const n = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setCols(prev => (n > 0 && n !== prev ? n : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return cols
}

function layoutGridEntries(entries: GridEntry[], columns: number): JSX.Element[] {
  const panelsAtRowEnd = new Map<number, JSX.Element[]>()
  entries.forEach((e, i) => {
    if (!e.panel) return
    const row = Math.floor(i / columns)
    const rowEnd = Math.min(entries.length - 1, row * columns + columns - 1)
    const arr = panelsAtRowEnd.get(rowEnd) ?? []
    arr.push(e.panel)
    panelsAtRowEnd.set(rowEnd, arr)
  })
  const out: JSX.Element[] = []
  entries.forEach((e, i) => {
    out.push(e.tile)
    const panels = panelsAtRowEnd.get(i)
    if (panels) out.push(...panels)
  })
  return out
}

export default function PlaylistsView(): JSX.Element {
  const { account, playlists, refreshPlaylists, playTrack, playNext, playCollection, addToQueue, setShowUserAuth, likedTrackIds, toggleLike, setActiveView, setPendingEditorSongId,
    localPlaylists, libraryTracks, libraryArt, loadLibrary, deleteLocalPlaylist, renameLocalPlaylist, updateLocalPlaylist, addToLocalPlaylist,
    pendingPlaylistId, setPendingPlaylistId,
    playlistsSelectedId: selectedId, setPlaylistsSelectedId: setSelectedId,
    playlistsSelectedLocalId: localSelectedId, setPlaylistsSelectedLocalId: setLocalSelectedId,
    playlistsSort: sortRaw, setPlaylistsSort: setSortRaw,
    playlistsOpenFolderId, setPlaylistsOpenFolderId,
    followedPlaylists, followPlaylist, unfollowPlaylist, updateFollowedPlaylistMeta,
    playlistFolders, createFolder, renameFolder, deleteFolder, movePlaylistsToFolder, appTextScale,
    // Subscribed purely so the track memo below re-derives when a custom
    // name/cover changes - liteSongToTrack bakes the override in at conversion
    // time, so without this the rows keep the old name until a refetch.
    songPrefs, openBulkEditor, fullEraNames, theme, playlistHeroEnabledDark, playlistHeroEnabledLight } = useStorePick('account', 'playlists', 'refreshPlaylists', 'playTrack', 'playNext', 'playCollection', 'addToQueue', 'setShowUserAuth', 'likedTrackIds', 'toggleLike', 'setActiveView', 'setPendingEditorSongId', 'localPlaylists', 'libraryTracks', 'libraryArt', 'loadLibrary', 'deleteLocalPlaylist', 'renameLocalPlaylist', 'updateLocalPlaylist', 'addToLocalPlaylist', 'pendingPlaylistId', 'setPendingPlaylistId', 'playlistsSelectedId', 'setPlaylistsSelectedId', 'playlistsSelectedLocalId', 'setPlaylistsSelectedLocalId', 'playlistsSort', 'setPlaylistsSort', 'playlistsOpenFolderId', 'setPlaylistsOpenFolderId', 'followedPlaylists', 'followPlaylist', 'unfollowPlaylist', 'updateFollowedPlaylistMeta', 'playlistFolders', 'createFolder', 'renameFolder', 'deleteFolder', 'movePlaylistsToFolder', 'appTextScale', 'songPrefs', 'openBulkEditor', 'fullEraNames', 'theme', 'playlistHeroEnabledDark', 'playlistHeroEnabledLight')
  useEffect(() => { loadEraFullNames().catch(() => {}) }, [])
  // Cast back to the component's own SortField union - the store keeps the
  // field as a plain string so it doesn't have to import this component's type.
  const sort = sortRaw as SortState
  const setSort = setSortRaw as (s: SortState) => void
  const canEdit = useCanEdit()
  // Skins beyond the classic pair mean `theme === 'dark'` no longer covers
  // "is this a dark look" - Ocean, Mocha, etc. need the dark treatment too.
  // The playlist hero's white-on-dark text only makes sense while its own
  // backdrop is actually dark; see heroLight below at each hero render.
  const isDarkSkin = getSkin(theme).dark
  // The setting is tracked per skin darkness, not as one flag - see
  // playlistHeroEnabledDark/Light in useStore.ts.
  const playlistHeroEnabled = isDarkSkin ? playlistHeroEnabledDark : playlistHeroEnabledLight

  const [showLiked, setShowLiked] = useState(false)
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Inline "quick view" expansion - clicking a card in the grid expands a
  // panel below its row (Apple Music-style) instead of navigating away.
  // Keyed the same way as the multi-select set ("api:<id>" / "local:<id>")
  // so it's unambiguous across the two playlist kinds.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [expandedTracks, setExpandedTracks] = useState<Track[]>([])
  const [expandedLoading, setExpandedLoading] = useState(false)
  // Toggles a card's quick-view panel, closing any open folder first - see
  // the note on openFolder for why the two can't both be open at once.
  // closeFolder defaults to true (a top-level card's expand should close any
  // open folder so the two panels don't collide in the same grid row - see
  // openFolder's note). A folder's own member cards pass false: they render
  // inside that folder's already-open panel, so closing it out from under
  // them would unmount the very panel their own expand view needs to appear
  // in, making the click look like it did nothing.
  const toggleExpanded = useCallback((key: string, closeFolder = true) => {
    if (closeFolder) setPlaylistsOpenFolderId(null)
    setExpandedKey(k => k === key ? null : key)
  }, [setPlaylistsOpenFolderId])
  // One column-count measurement per distinct grid container that can host a
  // quick-view panel - see useGridColumnCount above. State (not useRef) so
  // the measuring effect re-fires when the element actually mounts - needed
  // for folderGridEl, whose grid doesn't exist until a folder is opened.
  // authGridEl covers the logged-out library grid, mainGridEl the logged-in
  // one, deviceGridEl "On This Device", and folderGridEl the (single, since
  // only one folder is ever open at once) currently-open folder's member grid.
  const [authGridEl, setAuthGridEl] = useState<HTMLDivElement | null>(null)
  const authGridCols = useGridColumnCount(authGridEl)
  const [mainGridEl, setMainGridEl] = useState<HTMLDivElement | null>(null)
  const mainGridCols = useGridColumnCount(mainGridEl)
  const [deviceGridEl, setDeviceGridEl] = useState<HTMLDivElement | null>(null)
  const deviceGridCols = useGridColumnCount(deviceGridEl)
  const [folderGridEl, setFolderGridEl] = useState<HTMLDivElement | null>(null)
  const folderGridCols = useGridColumnCount(folderGridEl)

  // Create / rename
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  // Context menus
  const [trackMenu, setTrackMenu] = useState<SongContextMenuState | null>(null)
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null)
  // Shared by every quick-view panel's track rows - same trackMenu state the
  // full playlist page's own SongContextMenu uses, just opened from a
  // different place (the two never show at once, since a quick-view panel
  // only ever renders in the grid views, not the full-page detail view).
  const openTrackMenu = useCallback((track: Track, e: React.MouseEvent) => {
    setTrackMenu({ track, songId: userApi.trackIdToSongId(track.id), x: e.clientX, y: e.clientY })
  }, [])

  // Multi-select of playlists in the library grid - ctrl/cmd-click a card to
  // toggle it, mirroring the file browser's selection model (ApiFilesView).
  // Keyed as "api:<id>" / "local:<id>" since both id spaces are numeric and
  // could otherwise collide. See the useMultiSelect() call further down for
  // plSelectMode/selectedPlaylistKeys/togglePlaylistSelect/exitPlaylistSelectMode.
  const [plBulkMenu, setPlBulkMenu] = useState<{ x: number; y: number; showPlaylists?: boolean; showFolders?: boolean } | null>(null)
  const [showPlBulkAddMenu, setShowPlBulkAddMenu] = useState(false)

  // ── Playlist folders ──────────────────────────────────────────────────────
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderMenu, setFolderMenu] = useState<{ folder: PlaylistFolder; x: number; y: number; renaming?: boolean; renameVal?: string } | null>(null)

  // Drag-to-move-into-a-folder - dragged keys are the same "api:<id>"/"local:<id>"
  // composite the multi-select already uses. Transient gesture state, so it's
  // fine as local state (unlike the store-backed selection that survives tab
  // switches). Usually just the one card under the cursor, but dragging a
  // card that's part of the current selection carries the whole selection
  // along with it.
  const [draggedPlaylistKeys, setDraggedPlaylistKeys] = useState<string[]>([])
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null)
  // Dropping one ungrouped playlist card directly onto another (as opposed to
  // onto a folder tile, handled by dropTargetFolderId above) bundles the two
  // into a brand-new folder - the "drag a playlist onto a playlist" gesture.
  const [dropTargetPlaylistKey, setDropTargetPlaylistKey] = useState<string | null>(null)

  // Multi-select of tracks within an open playlist - mirrors the Tracker's
  // bulk-select (ApiTrackerView). Keyed by track.id (Track has a string id;
  // the numeric songId is derived when needed for playlist/remove ops). See
  // the useMultiSelect() call further down (needs displayTracks, which isn't
  // defined yet here) for selectMode/selectedTracks/toggleTrackSelect/
  // exitSelectMode.
  const [showBulkPlaylists, setShowBulkPlaylists] = useState(false)
  const [bulkRemoving, setBulkRemoving] = useState(false)
  const [localRenaming, setLocalRenaming] = useState(false)
  const [localRenameVal, setLocalRenameVal] = useState('')
  const [showAddAllMenu, setShowAddAllMenu] = useState(false)
  const addAllMenuRef = useRef<HTMLDivElement>(null)
  const addAllItemRef = useRef<HTMLButtonElement>(null)
  const [addAllSubPos, setAddAllSubPos] = useState({ top: 0, left: 0 })
  // The open-playlist hero's "⋯" menu (replaces the old cluster of loose
  // action buttons next to Play/Shuffle).
  const [showHeroMenu, setShowHeroMenu] = useState(false)
  const [showHeroExportMenu, setShowHeroExportMenu] = useState(false)
  const heroExportItemRef = useRef<HTMLButtonElement>(null)
  const heroExportMenuRef = useRef<HTMLDivElement>(null)
  const [heroExportSubPos, setHeroExportSubPos] = useState({ top: 0, left: 0 })
  const heroMenuRef = useRef<HTMLDivElement>(null)
  const heroMenuBoxRef = useRef<HTMLDivElement>(null)
  const heroBtnRef = useRef<HTMLButtonElement>(null)

  // Drag-to-reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  // Sort + search - sort itself comes from the store (see playlistsSort)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Compact view - same grouping as the Tracker's (see lib/compactGroups.ts):
  // collapses tracks sharing a version_title into one row. Uses the
  // playlist-scoped groupItemsByVersion since `tracks` here is already the
  // playlist's full, unpaginated list - no need to ask juicewrldapi's
  // /versions/ table for every group app-wide like the Tracker has to.
  const [compactView, setCompactView] = useState(false)
  // Grid view - mutually exclusive with compact, so only one of the two
  // non-default track layouts is ever active at once.
  const [gridView, setGridView] = useState(false)
  const [compactGroups, setCompactGroups] = useState<CompactGroup<Track>[]>([])
  const [loadingCompact, setLoadingCompact] = useState(false)
  const { expanded: expandedGroups, toggle: toggleGroupExpanded, clear: clearExpandedGroups } = useExpandedGroups()

  // Zip / share / bulk-add
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [shareCopied, setShareCopied] = useState(false)
  const [togglingPublic, setTogglingPublic] = useState(false)
  const [addingAll, setAddingAll] = useState(false)
  const [isSharedView, setIsSharedView] = useState(false)
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  // Cover upload
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [coverUploading, setCoverUploading] = useState(false)
  // Cover is fetched separately so tracks render without waiting for it
  type CoverData = { cover_image?: string | null; cover_image_url?: string | null }
  const [coverData, setCoverData] = useState<CoverData | null>(null)
  const [coverLoading, setCoverLoading] = useState(false)
  const [coverImgError, setCoverImgError] = useState(false)

  // Async cover thumbnails for the grid (keyed by playlist id)
  const [covers, setCovers] = useState<Record<number, string | null>>({})
  const [mosaicImages, setMosaicImages] = useState<Record<number, string[]>>({})
  const coversLoadedRef = useRef<Set<number>>(new Set())

  // Description editing
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState('')

  // Playlist membership cache: playlistId → Set<songId>
  const membershipCache = useRef<Map<number, Set<number>>>(new Map())

  // Race-condition guard: each loadDetail call gets a generation ID; stale responses are discarded
  const loadGen = useRef(0)

  // ── Async cover loading for grid ─────────────────────────────────────────
  useEffect(() => {
    const unloaded = playlists.filter(p => !coversLoadedRef.current.has(p.id))
    if (!unloaded.length) return
    unloaded.forEach(p => coversLoadedRef.current.add(p.id))

    const CONCURRENCY = 4
    let idx = 0
    const run = async (): Promise<void> => {
      while (idx < unloaded.length) {
        const p = unloaded[idx++]
        await userApi.getPlaylistCover(p.id)
          .then(c => {
            const url = c.cover_image_url ?? c.cover_image ?? null
            setCovers(prev => ({ ...prev, [p.id]: url }))
            if (c.trackImages.length) setMosaicImages(prev => ({ ...prev, [p.id]: c.trackImages }))
          })
          .catch(() => setCovers(prev => ({ ...prev, [p.id]: null })))
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, unloaded.length) }, run)
    Promise.all(workers).catch(() => undefined)
  }, [playlists])

  // ── Derived data - ALL hooks at top level, no conditionals ────────────────

  const summary = useMemo(() => playlists.find(p => p.id === selectedId), [playlists, selectedId])
  const tracks: Track[] = useMemo(
    () => detail ? detail.items.map(it => userApi.liteSongToTrack(it.song)) : [],
    // songPrefs: liteSongToTrack reads the override synchronously, so a name or
    // cover edit has to re-run this to show up without refetching the playlist.
    [detail, songPrefs]
  )
  const otherPlaylists = useMemo(() => playlists.filter(p => p.id !== selectedId), [playlists, selectedId])
  const isFollowingCurrent = useMemo(() => selectedId != null && followedPlaylists.some(f => f.id === selectedId), [followedPlaylists, selectedId])
  const dragEnabled = sort.field === 'default' && !search.trim()

  // "Add all to playlist" opens a flyout beside the hero menu (matching
  // SongContextMenu's "Add to playlist") instead of growing the menu inline -
  // an inline list of playlist names has no width cap of its own, so a long
  // name would keep stretching the menu out to the edge of the screen.
  useLayoutEffect(() => {
    if (!showAddAllMenu) return
    const item = addAllItemRef.current, menu = heroMenuBoxRef.current, sub = addAllMenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setAddAllSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [showAddAllMenu, otherPlaylists.length])

  // "Export playlist" is the same kind of flyout as "Add all to playlist" above.
  useLayoutEffect(() => {
    if (!showHeroExportMenu) return
    const item = heroExportItemRef.current, menu = heroMenuBoxRef.current, sub = heroExportMenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setHeroExportSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [showHeroExportMenu])

  const displayTracks = useMemo(() => {
    let result = tracks
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
    }
    if (sort.field !== 'default') {
      // Original playlist position, for the "#" column's own sort (and the
      // tie-break below) - built from the unfiltered `tracks` order rather
      // than `result`, since search may have already dropped entries.
      const origIndex = sort.field === 'index' ? new Map(tracks.map((t, i) => [t, i])) : null
      result = [...result].sort((a, b) => {
        let cmp = 0
        if (sort.field === 'index') cmp = (origIndex!.get(a) ?? 0) - (origIndex!.get(b) ?? 0)
        else if (sort.field === 'title') cmp = a.title.localeCompare(b.title)
        else if (sort.field === 'artist') cmp = a.artist.localeCompare(b.artist)
        else if (sort.field === 'era') cmp = (a.era || '').localeCompare(b.era || '')
        else if (sort.field === 'category') cmp = (CATEGORY_LABELS[a.genre] ?? (a.genre || '')).localeCompare(CATEGORY_LABELS[b.genre] ?? (b.genre || ''))
        else if (sort.field === 'duration') cmp = (a.duration || 0) - (b.duration || 0)
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [tracks, search, sort])

  // Identity → original index, replacing the per-row tracks.indexOf() that
  // made rendering the detail list O(n²). displayTracks elements are the same
  // object references as tracks entries, so identity keys are safe.
  const trackIndexOf = useMemo(() => new Map(tracks.map((t, i) => [t, i])), [tracks])

  // ── Detail track-list virtualization ───────────────────────────────────────
  // Large playlists rendered every row (each with decoded album art) at once.
  // Element-state refs (not RefObjects) because the detail view mounts long
  // after this component does - see useVirtualWindowEl.
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)
  const [listContentEl, setListContentEl] = useState<HTMLDivElement | null>(null)
  // 56 = px-4 py-2 row wrapping 40px album art at normal scale. Multiplied by
  // the app text-size setting so the virtualized rows (whose height and
  // absolute offsets must be concrete px) grow with the rem-based covers/text
  // inside them - otherwise larger scales clipped rows and shrank the covers.
  const TRACK_ROW_H = Math.round(56 * appTextScale)
  const { start: rowStart, end: rowEnd, totalHeight: rowsTotalHeight } =
    useVirtualWindowEl(listScrollEl, listContentEl, displayTracks.length, TRACK_ROW_H)

  // groupItemsByVersion doesn't know about the search box, so without this
  // typing a query while compact view is active would just do nothing.
  const filteredCompactGroups = useMemo(() => {
    const filtered = filterCompactGroups(compactGroups, search, t => `${t.title} ${t.artist}`)
    // Compact view only exposes the # column (see the header row), so
    // index sort is the only sort that applies here - reverse for desc.
    return sort.field === 'index' && sort.dir === 'desc' ? [...filtered].reverse() : filtered
  }, [compactGroups, search, sort])

  // ── Effects ────────────────────────────────────────────────────────────────

  // Populate membership cache when a detail loads
  useEffect(() => {
    if (detail) {
      membershipCache.current.set(detail.id, new Set(detail.items.map(i => i.song.id)))
    }
  }, [detail])

  // Bumped by the invalidation subscriber below so an edit made elsewhere
  // (e.g. Editor → Versions) shows up here immediately even while this view
  // stays mounted and neither compactView nor tracks changes.
  const [compactReloadToken, setCompactReloadToken] = useState(0)
  const compactViewRef = useRef(compactView)
  useEffect(() => { compactViewRef.current = compactView }, [compactView])
  useEffect(() => {
    return subscribeCompactGroupsInvalidation(() => {
      if (compactViewRef.current) setCompactReloadToken(t => t + 1)
    })
  }, [])

  useEffect(() => {
    if (!compactView || !versionsEnabled) { setCompactGroups([]); return }
    let cancelled = false
    setLoadingCompact(true)
    groupItemsByVersion(tracks, t => userApi.trackIdToSongId(t.id) ?? -1).then(groups => {
      if (cancelled) return
      // groupItemsByVersion builds groups from a Map keyed by version-group id,
      // so they come back in whatever order the /versions/ lookup happened to
      // return - not the playlist's actual track order. Re-sort both the
      // groups and each group's members by their position in `tracks` so
      // compact view lines up with what normal/grid view shows, instead of
      // silently reshuffling the playlist.
      const trackIndex = new Map(tracks.map((t, i) => [t.id, i]))
      const ordered = groups
        .map(g => ({ ...g, members: [...g.members].sort((a, b) => (trackIndex.get(a.item.id) ?? 0) - (trackIndex.get(b.item.id) ?? 0)) }))
        .sort((a, b) => (trackIndex.get(a.members[0]?.item.id) ?? 0) - (trackIndex.get(b.members[0]?.item.id) ?? 0))
      setCompactGroups(ordered)
      setLoadingCompact(false)
    })
    return () => { cancelled = true }
  }, [compactView, tracks, compactReloadToken])

  // Load local library so playlist tracks resolve
  useEffect(() => { loadLibrary() }, [])

  // Listen for sidebar "Playlists" re-click → go back to library
  useEffect(() => {
    const h = () => { setSelectedId(null); setLocalSelectedId(null); setRenaming(false); setSearch(''); setSearchOpen(false); setSort({ field: 'default', dir: 'asc' }); setIsSharedView(false); setExpandedKey(null) }
    window.addEventListener('playlists:back', h)
    return () => window.removeEventListener('playlists:back', h)
  }, [])

  // Collapse the inline quick-view whenever a full playlist page opens (e.g.
  // via the card's "⋯ → Open" menu) - otherwise it'd sit there stale under
  // the grid the user just navigated away from.
  useEffect(() => {
    if (selectedId != null || localSelectedId != null) setExpandedKey(null)
  }, [selectedId, localSelectedId])

  // Load the quick-view panel's tracklist whenever it opens. API playlists
  // render instantly from cache (see loadDetail's same pattern) then refresh
  // in the background; local playlists resolve synchronously from the store.
  useEffect(() => {
    if (!expandedKey) { setExpandedTracks([]); return }
    if (expandedKey === 'liked') {
      // Same three sources LikedSongsView combines: API favorites (fetched
      // fresh - likedTrackIds only carries local/file ids, not synced ones),
      // scanned local-library likes, and liked API-browser files.
      const localLiked = new Set(likedTrackIds)
      const localTracks = libraryTracks.filter(t => localLiked.has(t.id)).map(libTrackToTrack)
      const fileTracks = likedTrackIds
        .map(id => { const path = apiFileIdToPath(id); return path ? apiFilePathToTrack(path) : null })
        .filter((t): t is Track => t != null)
      if (!account) { setExpandedTracks([...localTracks, ...fileTracks]); setExpandedLoading(false); return undefined }
      setExpandedLoading(true)
      let cancelled = false
      userApi.getFavorites().then(favs => {
        if (cancelled) return
        setExpandedTracks([...favs.map(f => userApi.liteSongToTrack(f.song)), ...localTracks, ...fileTracks])
      }).catch(() => { if (!cancelled) setExpandedTracks([...localTracks, ...fileTracks]) })
        .finally(() => { if (!cancelled) setExpandedLoading(false) })
      return () => { cancelled = true }
    }
    const sep = expandedKey.indexOf(':')
    const kind = expandedKey.slice(0, sep)
    const idStr = expandedKey.slice(sep + 1)
    if (kind === 'api') {
      const id = Number(idStr)
      const cached = userApi.peekPlaylistDetail(id)
      if (cached) { setExpandedTracks(cached.items.map(it => userApi.liteSongToTrack(it.song))); setExpandedLoading(false) }
      else { setExpandedTracks([]); setExpandedLoading(true) }
      let cancelled = false
      userApi.getPlaylist(id).then(d => {
        if (cancelled) return
        setExpandedTracks(d.items.map(it => userApi.liteSongToTrack(it.song)))
      }).catch(() => {}).finally(() => { if (!cancelled) setExpandedLoading(false) })
      return () => { cancelled = true }
    }
    const lp = localPlaylists.find(p => p.id === idStr)
    setExpandedTracks(lp ? lp.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter((t): t is LibraryTrack => !!t).map(libTrackToTrack) : [])
    setExpandedLoading(false)
    return undefined
  }, [expandedKey, localPlaylists, libraryTracks, likedTrackIds, account])

  // Autofocus the search input when it expands from the icon
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Auto-open playlist from URL params (e.g. /playlists?id=123&view=shared)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const view = params.get('view')
    if (id) { setSelectedId(Number(id)) }
    if (view === 'shared') { setIsSharedView(true) }
  }, [])

  // Open a playlist requested from the sidebar's expandable playlist list.
  // A store field (not the URL-param effect above) is needed here because it
  // has to work even when this component is already mounted - the URL effect
  // only runs once, on mount.
  useEffect(() => {
    if (pendingPlaylistId == null) return
    setSelectedId(pendingPlaylistId)
    setIsSharedView(false)
    setPendingPlaylistId(null)
  }, [pendingPlaylistId, setPendingPlaylistId])

  // Close menus on outside click
  useEffect(() => {
    if (!trackMenu && !cardMenu && !showAddAllMenu && !plBulkMenu && !folderMenu) return
    const h = () => { setTrackMenu(null); setCardMenu(null); setShowAddAllMenu(false); setPlBulkMenu(null); setFolderMenu(null) }
    setTimeout(() => window.addEventListener('click', h), 0)
    return () => window.removeEventListener('click', h)
  }, [trackMenu, cardMenu, showAddAllMenu, plBulkMenu, folderMenu])


  const loadDetail = useCallback(async (id: number, shared = false) => {
    const gen = ++loadGen.current
    // A cached cover renders immediately (no null/spinner flash) instead of
    // waiting on a network round trip for a playlist we've already opened.
    const cached = userApi.peekPlaylistCover(id)
    if (cached) {
      setCoverImgError(false)
      setCoverData({ cover_image: cached.cover_image, cover_image_url: cached.cover_image_url })
      setCoverLoading(false)
    } else {
      setCoverData(null)
      setCoverLoading(true)
    }
    // A cached detail (tracks + metadata) renders instantly too - then we
    // still refetch in the background to pick up changes made elsewhere,
    // swapping in the fresh result without ever showing a loading spinner.
    const cachedDetail = userApi.peekPlaylistDetail(id)
    if (cachedDetail) {
      setDetail(cachedDetail)
      setLoadingDetail(false)
    } else {
      setLoadingDetail(true)
    }
    try {
      const result = shared ? await userApi.getPublicPlaylist(id) : await userApi.getPlaylist(id)
      if (gen !== loadGen.current) return
      setDetail(result)
      setLoadingDetail(false)
      if (!cached) {
        // Load cover separately so tracks render immediately
        const coverFetch = shared ? userApi.getPublicPlaylistCover(id) : userApi.getPlaylistCover(id)
        coverFetch.then(c => {
          if (gen !== loadGen.current) return
          setCoverImgError(false)
          setCoverData({ cover_image: c.cover_image, cover_image_url: c.cover_image_url })
          setCoverLoading(false)
        }).catch(() => { if (gen === loadGen.current) setCoverLoading(false) })
      }
    } catch {
      if (gen === loadGen.current && !cachedDetail) setDetail(null)
    } finally {
      if (gen === loadGen.current) setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId != null) loadDetail(selectedId, isSharedView)
    else setDetail(null)
  }, [selectedId, loadDetail, isSharedView])

  // Keep a followed playlist's cached display fields (the grid card's name/
  // cover/track count) reasonably fresh. The detail view above already
  // re-fetches live on every open - this just makes sure the summary shown
  // before that fetch resolves next time isn't stuck on whatever it looked
  // like the moment it was followed.
  useEffect(() => {
    if (!isSharedView || selectedId == null || !detail) return
    if (!followedPlaylists.some(f => f.id === selectedId)) return
    updateFollowedPlaylistMeta(selectedId, {
      name: detail.name,
      trackCount: detail.items.length,
      coverUrl: coverData?.cover_image_url ?? coverData?.cover_image ?? null,
    })
  }, [isSharedView, selectedId, detail, coverData, followedPlaylists, updateFollowedPlaylistMeta])

  // Reset sort/search/editing when switching playlists. The sort
  // reset is skipped on the component's own first mount - this effect's
  // dependency array fires then too, and since sort lives in the store (so
  // it survives switching tabs and back, see playlistsSort), resetting it
  // unconditionally here would wipe that persistence on every tab switch.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (mountedRef.current) setSort({ field: 'default', dir: 'asc' })
    mountedRef.current = true
    setSearch('')
    setEditingDesc(false)
    setDescValue('')
    setCoverImgError(false)
    exitSelectMode()
    setShowHeroMenu(false)
    setShowAddAllMenu(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const createPlaylist = async () => {
    const name = newName.trim(); if (!name) return
    try { await userApi.createPlaylist(name); setNewName(''); setCreating(false); await refreshPlaylists() } catch {}
  }

  const deleteSelected = async () => {
    if (selectedId == null) return
    try { await userApi.deletePlaylist(selectedId); setSelectedId(null); await refreshPlaylists() } catch {}
  }

  const renameSelected = async () => {
    if (selectedId == null) return
    const name = renameValue.trim(); if (!name) return
    try {
      const u = await userApi.renamePlaylist(selectedId, name)
      setDetail(u)
      setRenaming(false)
      await refreshPlaylists()
    } catch {}
  }

  // Optimistic remove - no loading flash
  const removeTrack = useCallback(async (songId: number) => {
    if (selectedId == null) return
    setDetail(prev => prev ? { ...prev, items: prev.items.filter(i => i.song.id !== songId) } : null)
    membershipCache.current.get(selectedId)?.delete(songId)
    try { await userApi.removeFromPlaylist(selectedId, songId); await refreshPlaylists() }
    catch { await loadDetail(selectedId) }
  }, [selectedId, loadDetail, refreshPlaylists])

  // ── Multi-select bulk actions ─────────────────────────────────────────────
  const {
    selectMode, selected: selectedTracks, toggle: toggleTrackSelectRaw,
    exitSelectMode, selectAll: selectAllTracks, clear: clearTrackSelection,
  } = useMultiSelect<string, Track>({
    onExit: () => setShowBulkPlaylists(false),
    ctrlA: { getAll: () => new Map(displayTracks.map(t => [t.id, t])) },
  })
  const toggleTrackSelect = useCallback((track: Track) => toggleTrackSelectRaw(track.id, track), [toggleTrackSelectRaw])
  // Shared across both track list layouts below (grid PlaylistCards handle
  // their own hold internally; this instance backs the plain-div list rows).
  const trackRowLongPress = useLongPress()

  const selectedTrackList = useMemo(() => [...selectedTracks.values()], [selectedTracks])

  const bulkAddToQueue = useCallback(() => {
    selectedTrackList.filter(t => t.path).forEach(t => addToQueue(t))
    exitSelectMode()
  }, [selectedTrackList, addToQueue, exitSelectMode])

  const bulkAddToPlaylist = useCallback(async (targetId: number) => {
    const ids = selectedTrackList
      .map(t => (t.id ? userApi.trackIdToSongId(t.id) : null))
      .filter((id): id is number => id != null && id > 0)
    if (!ids.length) return
    setShowBulkPlaylists(false)
    await Promise.all(ids.map(id => userApi.addToPlaylist(targetId, id).catch(() => {})))
    const targetSet = membershipCache.current.get(targetId) ?? new Set<number>()
    ids.forEach(id => targetSet.add(id))
    membershipCache.current.set(targetId, targetSet)
    await refreshPlaylists()
    exitSelectMode()
  }, [selectedTrackList, refreshPlaylists, exitSelectMode])

  // "Edit" needs full song objects (producers, dates, lyrics, …), but a
  // playlist's own items only carry the lite shape the list endpoint returns
  // (title/artist/path - enough for a row, not enough for the editor). One
  // batched /songs/?ids=... request resolves the whole selection instead of
  // firing one /songs/{id}/ call per song.
  const [bulkEditLoading, setBulkEditLoading] = useState(false)
  const bulkEdit = useCallback(async () => {
    const ids = selectedTrackList
      .map(t => (t.id ? userApi.trackIdToSongId(t.id) : null))
      .filter((id): id is number => id != null && id > 0)
    if (!ids.length) return
    setBulkEditLoading(true)
    try {
      const songs = await getSongsByIds(ids)
      if (songs.length) openBulkEditor(songs)
    } finally {
      setBulkEditLoading(false)
    }
  }, [selectedTrackList, openBulkEditor])

  // Remove every selected track in one pass, then refresh once (rather than
  // per-track like removeTrack) - otherwise a large selection fires a refresh
  // storm. Optimistically drops them from the open detail first.
  const bulkRemove = useCallback(async () => {
    if (selectedId == null) return
    const ids = selectedTrackList
      .map(t => (t.id ? userApi.trackIdToSongId(t.id) : null))
      .filter((id): id is number => id != null && id > 0)
    if (!ids.length) return
    setBulkRemoving(true)
    const idSet = new Set(ids)
    setDetail(prev => prev ? { ...prev, items: prev.items.filter(i => !idSet.has(i.song.id)) } : null)
    ids.forEach(id => membershipCache.current.get(selectedId)?.delete(id))
    try {
      await Promise.all(ids.map(id => userApi.removeFromPlaylist(selectedId, id)))
      await refreshPlaylists()
    } catch { await loadDetail(selectedId) }
    setBulkRemoving(false)
    exitSelectMode()
  }, [selectedId, selectedTrackList, refreshPlaylists, loadDetail, exitSelectMode])

  // ── Multi-select of playlists (library grid) ──────────────────────────────
  // "Select all" here varies per tab (local-only vs. local+api combined), so
  // it isn't a single generic "everything visible" - those buttons keep their
  // own setSelectedPlaylistKeys calls below rather than going through the
  // hook's ctrlA/selectAll (which assumes one canonical "all").
  const {
    selectMode: plSelectMode, selected: selectedPlaylistKeys, setSelected: setSelectedPlaylistKeys,
    toggle: togglePlKeyRaw, exitSelectMode: exitPlaylistSelectMode,
  } = useMultiSelect<string>({ onExit: () => setShowPlBulkAddMenu(false) })
  const togglePlaylistSelect = useCallback((key: string) => togglePlKeyRaw(key, key), [togglePlKeyRaw])
  const keyMap = (keys: string[]): Map<string, string> => new Map(keys.map(k => [k, k]))

  const [bulkDeletingPlaylists, setBulkDeletingPlaylists] = useState(false)

  const bulkDeletePlaylists = useCallback(async () => {
    const keys = [...selectedPlaylistKeys.keys()]
    if (!keys.length) return
    setBulkDeletingPlaylists(true)
    const apiIds = keys.filter(k => k.startsWith('api:')).map(k => Number(k.slice(4)))
    const localIds = keys.filter(k => k.startsWith('local:')).map(k => k.slice(6))
    try {
      await Promise.all(apiIds.map(id => userApi.deletePlaylist(id).catch(() => {})))
    } finally {
      localIds.forEach(id => deleteLocalPlaylist(id))
      if (selectedId != null && apiIds.includes(selectedId)) setSelectedId(null)
      if (localSelectedId != null && localIds.includes(localSelectedId)) setLocalSelectedId(null)
      await refreshPlaylists()
      setBulkDeletingPlaylists(false)
      exitPlaylistSelectMode()
    }
  }, [selectedPlaylistKeys, deleteLocalPlaylist, refreshPlaylists, selectedId, localSelectedId, setSelectedId, setLocalSelectedId, exitPlaylistSelectMode])

  // "Add to playlist" only makes sense when every selected playlist is the
  // same kind, since a synced (api) target can't hold local-only tracks and
  // vice versa. Mixed selections simply don't offer the action.
  const selectedPlaylistKind = useMemo(() => {
    const kinds = new Set([...selectedPlaylistKeys.keys()].map(k => k.split(':')[0]))
    return kinds.size === 1 ? ([...kinds][0] as 'api' | 'local') : null
  }, [selectedPlaylistKeys])

  const [bulkAddingPlaylists, setBulkAddingPlaylists] = useState(false)

  const bulkAddPlaylistsTo = useCallback(async (target: { kind: 'api'; id: number } | { kind: 'local'; id: string }) => {
    const keys = [...selectedPlaylistKeys.keys()]
    setBulkAddingPlaylists(true)
    try {
      if (target.kind === 'api') {
        const srcIds = keys.filter(k => k.startsWith('api:')).map(k => Number(k.slice(4))).filter(id => id !== target.id)
        for (const srcId of srcIds) {
          const srcDetail = await userApi.getPlaylist(srcId).catch(() => null)
          if (!srcDetail) continue
          await Promise.all(srcDetail.items.map(item => userApi.addToPlaylist(target.id, item.song.id).catch(() => {})))
        }
        await refreshPlaylists()
      } else {
        const srcIds = keys.filter(k => k.startsWith('local:')).map(k => k.slice(6)).filter(id => id !== target.id)
        const targetPl = localPlaylists.find(p => p.id === target.id)
        const existing = new Set(targetPl?.trackIds ?? [])
        for (const srcId of srcIds) {
          const src = localPlaylists.find(p => p.id === srcId)
          if (!src) continue
          src.trackIds.filter(id => !existing.has(id)).forEach(id => { existing.add(id); addToLocalPlaylist(target.id, id) })
        }
      }
    } finally {
      setBulkAddingPlaylists(false)
      setShowPlBulkAddMenu(false)
      setPlBulkMenu(null)
      exitPlaylistSelectMode()
    }
  }, [selectedPlaylistKeys, refreshPlaylists, localPlaylists, addToLocalPlaylist, exitPlaylistSelectMode])

  const handleSort = (field: SortField) => {
    if (sort.field === field) {
      setSort(sort.dir === 'asc' ? { field, dir: 'desc' } : { field: 'default', dir: 'asc' })
    } else {
      setSort({ field, dir: 'asc' })
    }
  }

  const handleDrop = useCallback(async (toIdx: number) => {
    if (dragIdx === null || !detail || selectedId == null) return
    const from = dragIdx
    setDragIdx(null); setDropIdx(null)
    if (from === toIdx) return
    const newItems = [...detail.items]
    const [removed] = newItems.splice(from, 1)
    newItems.splice(toIdx, 0, removed)
    setDetail({ ...detail, items: newItems })
    try {
      const updated = await userApi.reorderPlaylist(selectedId, newItems.map(it => it.song.id))
      setDetail(updated)
    } catch { await loadDetail(selectedId) }
  }, [dragIdx, detail, selectedId, loadDetail])

  // Global infoSongId (not local state) so the info panel survives switching
  // to another tab, which unmounts this view. GlobalSongInfoHost does its own
  // fetch by id, so no need to resolve the song here first.
  const openSongInfo = useCallback((songId: number) => {
    useStore.getState().setInfoSongId(songId)
  }, [])

  const handleCoverUpload = useCallback(async (file: File) => {
    if (!selectedId || coverUploading) return
    setCoverUploading(true)
    try {
      const result = await userApi.uploadPlaylistCover(selectedId, file)
      setCoverImgError(false)
      setCoverData({ cover_image: result.cover_image, cover_image_url: result.cover_image_url })
      setCovers(prev => ({ ...prev, [selectedId]: result.cover_image_url ?? result.cover_image ?? null }))
      await refreshPlaylists()
    } catch {}
    setCoverUploading(false)
  }, [selectedId, coverUploading, refreshPlaylists])

  const handleRemoveCover = useCallback(async () => {
    if (!selectedId) return
    setCoverData(null) // optimistic clear
    setCovers(prev => ({ ...prev, [selectedId]: null }))
    try {
      await userApi.removePlaylistCover(selectedId)
      await refreshPlaylists()
    } catch {
      // restore on failure by re-fetching
      const c = await userApi.getPlaylistCover(selectedId).catch(() => null)
      if (c) setCoverData({ cover_image: c.cover_image, cover_image_url: c.cover_image_url })
    }
  }, [selectedId, refreshPlaylists])

  const saveDescription = useCallback(async () => {
    if (!selectedId) return
    setEditingDesc(false)
    try {
      const updated = await userApi.updatePlaylist(selectedId, { description: descValue })
      setDetail(updated)
      await refreshPlaylists()
    } catch {}
  }, [selectedId, descValue, refreshPlaylists])

  const isMember = (playlistId: number, songId: number): boolean | null => {
    const cache = membershipCache.current.get(playlistId)
    if (!cache) return null
    return cache.has(songId)
  }

  const handleZipDownload = useCallback(async (trackList: Track[], name: string) => {
    if (zipState === 'loading') return
    const paths = trackList.map(t => t.path).filter(Boolean)
    if (!paths.length) return
    setZipState('loading')
    try {
      const res = await fetch(`${JWAPI_BASE}/files/zip-selection/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) throw new Error()
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('zip') || contentType.includes('octet-stream')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${name}.zip`; a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.download_url) { const a = document.createElement('a'); a.href = data.download_url; a.download = `${name}.zip`; a.click() }
      }
      setZipState('done')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 3000)
  }, [zipState])

  const downloadBlob = useCallback((content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleExportJson = useCallback(() => {
    if (!detail) return
    const name = detail.name ?? summary?.name ?? 'playlist'
    const data = {
      name: detail.name,
      description: detail.description,
      tracks: detail.items.map(i => ({
        id: i.song.id,
        title: i.song.name,
        artist: i.song.credited_artists,
        album: i.song.album ?? null,
        era: i.song.era?.name ?? null,
        path: i.song.path,
        image_url: i.song.image_url,
      })),
    }
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', `${name}.json`)
  }, [detail, summary, downloadBlob])

  const handleExportM3u = useCallback(() => {
    if (!detail) return
    const name = detail.name ?? summary?.name ?? 'playlist'
    const lines = ['#EXTM3U']
    for (const t of tracks) {
      lines.push(`#EXTINF:${Math.round(t.duration)},${t.artist} - ${t.title}`)
      lines.push(t.streamUrl ?? t.path)
    }
    downloadBlob(lines.join('\n'), 'audio/x-mpegurl', `${name}.m3u`)
  }, [detail, summary, tracks, downloadBlob])

  const handleTogglePublic = useCallback(async () => {
    if (!selectedId || !detail) return
    setTogglingPublic(true)
    try {
      const updated = await userApi.updatePlaylist(selectedId, { is_public: !detail.is_public })
      setDetail(updated)
    } catch (e) { console.error('toggle public failed', e) }
    finally { setTogglingPublic(false) }
  }, [selectedId, detail])

  const handleShare = useCallback(async () => {
    if (!selectedId || !detail) return
    try {
      // Ensure playlist is public before sharing
      if (!detail.is_public) {
        const updated = await userApi.updatePlaylist(selectedId, { is_public: true })
        setDetail(updated)
      }
      await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${selectedId}&view=shared`)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    } catch {}
  }, [selectedId, detail])

  const handleAddAllTo = useCallback(async (targetId: number, srcDetail: PlaylistDetail) => {
    setAddingAll(true)
    const eligible = srcDetail.items.filter(item => item.song.category !== 'unsurfaced' && (item.song.category !== 'recording_session' || !!resolveSessionEditSource(item.song).path))
    await Promise.all(eligible.map(item => userApi.addToPlaylist(targetId, item.song.id).catch(() => {})))
    const targetSet = membershipCache.current.get(targetId) ?? new Set<number>()
    srcDetail.items.forEach(i => targetSet.add(i.song.id))
    membershipCache.current.set(targetId, targetSet)
    setAddingAll(false)
    await refreshPlaylists()
  }, [refreshPlaylists])

  const handleImportPlaylist = useCallback(async () => {
    if (!detail) return
    setImportState('loading')
    try {
      const allowedIds = detail.items
        .filter(item => item.song.category !== 'unsurfaced' && (item.song.category !== 'recording_session' || !!resolveSessionEditSource(item.song).path))
        .map(item => item.song.id)

      // Request 1: create playlist with name + description + song_ids in one shot
      const newPl = await userApi.createPlaylist(detail.name, {
        description: detail.description,
        song_ids: allowedIds,
      })

      // Request 2 (optional): cover - use existing base64 directly, or fetch from URL
      const b64 = coverData?.cover_image
      const url = coverData?.cover_image_url
      if (b64) {
        await userApi.setPlaylistCoverBase64(newPl.id, b64)
      } else if (url) {
        try {
          const res = await fetch(url)
          const blob = await res.blob()
          const file = new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' })
          await userApi.uploadPlaylistCover(newPl.id, file)
        } catch { /* skip cover on CORS/network failure */ }
      }

      await refreshPlaylists()
      setImportState('done')
      setTimeout(() => setImportState('idle'), 2500)
    } catch {
      setImportState('error')
      setTimeout(() => setImportState('idle'), 2500)
    }
  }, [detail, coverData, refreshPlaylists])

  // ── Playlist card menu (shared by logged-in and logged-out views) ──────────

  // A default name for a folder made straight from a "Move to folder → New
  // folder" action, where there's no name field - unique so two quick creates
  // don't collide. The user can rename via the folder's ⋯ menu.
  const uniqueFolderName = (): string => {
    const taken = new Set(playlistFolders.map(f => f.name.toLowerCase()))
    if (!taken.has('new folder')) return 'New Folder'
    let n = 2
    while (taken.has(`new folder ${n}`)) n++
    return `New Folder ${n}`
  }

  // The "Move to folder" submenu body, shared by the single-card menus and the
  // bulk menu. `keys` is what gets filed; `onDone` closes the parent menu.
  const folderSubmenuItems = (keys: string[], onDone: () => void): JSX.Element => {
    const currentFolderId = keys.length === 1 ? (folderOfPlaylist(playlistFolders, keys[0])?.id ?? null) : null
    return (
      <div className="border-t border-b border-[var(--border)] max-h-44 overflow-y-auto">
        {playlistFolders.map(f => (
          <button
            key={f.id}
            onClick={() => { movePlaylistsToFolder(keys, f.id); onDone() }}
            title={f.name}
            className="w-full flex items-center gap-2 pl-9 pr-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <Folder size={13} className="text-text-muted shrink-0" />
            <span className="flex-1 truncate text-left">{f.name}</span>
            {currentFolderId === f.id && <Check size={12} className="text-accent shrink-0" />}
          </button>
        ))}
        {currentFolderId && (
          <button
            onClick={() => { movePlaylistsToFolder(keys, null); onDone() }}
            className="w-full flex items-center gap-2 pl-9 pr-3.5 py-2 text-sm text-text-secondary hover:text-red-400 transition-colors"
          >
            <FolderMinus size={13} className="shrink-0" /> Remove from folder
          </button>
        )}
        <button
          onClick={() => { createFolder(uniqueFolderName(), keys); onDone() }}
          className="w-full flex items-center gap-2 pl-9 pr-3.5 py-2 text-sm text-accent hover:bg-surface-overlay transition-colors"
        >
          <FolderPlus size={13} className="shrink-0" /> New folder…
        </button>
      </div>
    )
  }

  // The right-click/⋯ card menu, rendered into a body portal. Defined before
  // the early returns because the logged-out local-playlists view sets the
  // same cardMenu state - previously nothing rendered it there, so the menu
  // silently never appeared.
  const renderCardMenu = (): React.ReactNode => cardMenu && createPortal(
    <ClampedMenu x={cardMenu.x} y={cardMenu.y} className="w-[210px]">
      {cardMenu.renaming ? (
        /* ── Inline rename input (shared by both kinds) ── */
        <div className="px-3 py-2 flex gap-2" onClick={e => e.stopPropagation()}>
          <input
            autoFocus
            value={cardMenu.renameVal ?? cardMenu.playlist.name}
            onChange={e => setCardMenu(prev => prev ? { ...prev, renameVal: e.target.value } : null)}
            onKeyDown={async e => {
              if (e.key === 'Enter') {
                const val = cardMenu.renameVal?.trim() || cardMenu.playlist.name
                if (cardMenu.kind === 'local') {
                  renameLocalPlaylist(cardMenu.playlist.id, val)
                } else {
                  await userApi.renamePlaylist(cardMenu.playlist.id, val)
                  await refreshPlaylists()
                }
                setCardMenu(null)
              } else if (e.key === 'Escape') {
                setCardMenu(prev => prev ? { ...prev, renaming: false } : null)
              }
            }}
            className="flex-1 bg-surface-overlay rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none border border-[var(--border)]"
          />
          <button
            onClick={async () => {
              const val = cardMenu.renameVal?.trim() || cardMenu.playlist.name
              if (cardMenu.kind === 'local') {
                renameLocalPlaylist(cardMenu.playlist.id, val)
              } else {
                await userApi.renamePlaylist(cardMenu.playlist.id, val)
                await refreshPlaylists()
              }
              setCardMenu(null)
            }}
            className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium"
          >Save</button>
        </div>
      ) : cardMenu.kind === 'local' ? (
        /* ── Local playlist menu ── */
        <>
          <MenuItem icon={Play} label="Open" onClick={() => { setLocalSelectedId(cardMenu.playlist.id); setCardMenu(null) }} />
          <MenuItem
            icon={Shuffle}
            label="Play all"
            onClick={() => {
              const tracks = cardMenu.playlist.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter(Boolean) as LibraryTrack[]
              const q = tracks.map(libTrackToTrack)
              if (q.length) playCollection(q)
              setCardMenu(null)
            }}
          />
          <MenuItem
            icon={ListEnd}
            label="Add all to queue"
            onClick={() => {
              cardMenu.playlist.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter(Boolean).map(t => libTrackToTrack(t as LibraryTrack)).forEach(t => addToQueue(t))
              setCardMenu(null)
            }}
          />
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem icon={Pencil} label="Rename" onClick={() => setCardMenu(prev => prev ? { ...prev, renaming: true, renameVal: prev.playlist.name } : null)} />
          <button
            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
            onClick={e => { e.stopPropagation(); setCardMenu(prev => prev ? { ...prev, showPlaylists: !prev.showPlaylists } : null) }}
          >
            <span className="flex items-center gap-2.5"><FolderInput size={14} className="text-text-muted" />Add all to playlist</span>
            <span className="text-text-muted text-xs">›</span>
          </button>
          {cardMenu.showPlaylists && (
            <div className="border-t border-[var(--border)] max-h-40 overflow-y-auto">
              {localPlaylists.filter(p => p.id !== cardMenu.playlist.id).length === 0 ? (
                <p className="px-3.5 py-2 text-xs text-text-muted">No other playlists</p>
              ) : localPlaylists.filter(p => p.id !== cardMenu.playlist.id).map(p => (
                <button key={p.id} onClick={() => {
                  const src = cardMenu.playlist as LocalPlaylist
                  setCardMenu(null)
                  src.trackIds.filter(id => !p.trackIds.includes(id)).forEach(id => addToLocalPlaylist(p.id, id))
                }} title={p.name} className="w-full text-left px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors truncate">
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <button
            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
            onClick={e => { e.stopPropagation(); setCardMenu(prev => prev ? { ...prev, showFolders: !prev.showFolders } : null) }}
          >
            <span className="flex items-center gap-2.5"><Folder size={14} className="text-text-muted" />Move to folder</span>
            <span className="text-text-muted text-xs">›</span>
          </button>
          {cardMenu.showFolders && folderSubmenuItems([`local:${cardMenu.playlist.id}`], () => setCardMenu(null))}
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem
            icon={Trash2}
            label="Delete playlist"
            destructive
            onClick={() => {
              deleteLocalPlaylist(cardMenu.playlist.id)
              if (localSelectedId === cardMenu.playlist.id) setLocalSelectedId(null)
              setCardMenu(null)
            }}
          />
        </>
      ) : (
        /* ── API playlist menu ── */
        <>
          <MenuItem icon={Play} label="Open" onClick={() => { setSelectedId(cardMenu.playlist.id); setCardMenu(null) }} />
          <MenuItem
            icon={Shuffle}
            label="Play all"
            onClick={async () => {
              const d = await userApi.getPlaylist(cardMenu.playlist.id)
              const tracks = d.items.map(i => userApi.liteSongToTrack(i.song))
              if (tracks.length) playCollection(tracks)
              setCardMenu(null)
            }}
          />
          <MenuItem
            icon={ListEnd}
            label="Add all to queue"
            onClick={async () => {
              const d = await userApi.getPlaylist(cardMenu.playlist.id)
              d.items.forEach(i => addToQueue(userApi.liteSongToTrack(i.song)))
              setCardMenu(null)
            }}
          />
          <MenuItem
            icon={Archive}
            label="Download as ZIP"
            onClick={async () => {
              const name = cardMenu.playlist.name
              const d = await userApi.getPlaylist(cardMenu.playlist.id)
              setCardMenu(null)
              handleZipDownload(d.items.map(i => userApi.liteSongToTrack(i.song)), name)
            }}
          />
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem
            icon={Link}
            label="Copy share link"
            onClick={async () => {
              try {
                const p = cardMenu.playlist as PlaylistSummary
                if (!p.is_public) { await userApi.updatePlaylist(p.id, { is_public: true }); await refreshPlaylists() }
                await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${p.id}&view=shared`)
              } catch {}
              setCardMenu(null)
            }}
          />
          <MenuItem
            icon={(cardMenu.playlist as PlaylistSummary).is_public ? Globe : Lock}
            label={(cardMenu.playlist as PlaylistSummary).is_public ? 'Make private' : 'Make public'}
            onClick={async () => {
              const p = cardMenu.playlist as PlaylistSummary
              await userApi.updatePlaylist(p.id, { is_public: !p.is_public })
              await refreshPlaylists()
              setCardMenu(null)
            }}
          />
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem icon={Pencil} label="Rename" onClick={() => setCardMenu(prev => prev ? { ...prev, renaming: true, renameVal: prev.playlist.name } : null)} />
          <button
            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
            onClick={e => { e.stopPropagation(); setCardMenu(prev => prev ? { ...prev, showPlaylists: !prev.showPlaylists } : null) }}
          >
            <span className="flex items-center gap-2.5"><FolderInput size={14} className="text-text-muted" />Add all to playlist</span>
            <span className="text-text-muted text-xs">›</span>
          </button>
          {cardMenu.showPlaylists && (
            <div className="border-t border-[var(--border)] max-h-40 overflow-y-auto">
              {playlists.filter(p => p.id !== cardMenu.playlist.id).length === 0 ? (
                <p className="px-3.5 py-2 text-xs text-text-muted">No other playlists</p>
              ) : playlists.filter(p => p.id !== cardMenu.playlist.id).map(p => (
                <button key={p.id} onClick={async () => {
                  const srcId = cardMenu.playlist.id
                  setCardMenu(null)
                  const srcDetail = await userApi.getPlaylist(srcId)
                  await Promise.all(srcDetail.items.map(item => userApi.addToPlaylist(p.id, item.song.id).catch(() => {})))
                  await refreshPlaylists()
                }} title={p.name} className="w-full text-left px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors truncate">
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <button
            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
            onClick={e => { e.stopPropagation(); setCardMenu(prev => prev ? { ...prev, showFolders: !prev.showFolders } : null) }}
          >
            <span className="flex items-center gap-2.5"><Folder size={14} className="text-text-muted" />Move to folder</span>
            <span className="text-text-muted text-xs">›</span>
          </button>
          {cardMenu.showFolders && folderSubmenuItems([`api:${cardMenu.playlist.id}`], () => setCardMenu(null))}
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem
            icon={Trash2}
            label="Delete playlist"
            destructive
            onClick={async () => {
              const id = cardMenu.playlist.id
              setCardMenu(null)
              await userApi.deletePlaylist(id)
              if (selectedId === id) setSelectedId(null)
              await refreshPlaylists()
            }}
          />
        </>
      )}
    </ClampedMenu>,
    document.body
  )

  // ── Playlist cards, folders & folder menu (shared by both library views) ──
  // Defined before the early returns so the logged-out local-playlists view
  // renders the same tiles, folder sections, and menus as the main library.

  // Cover node for a card - the exact per-kind cover logic the grids used
  // inline, pulled out so folder members render an identical tile.
  const apiCoverNode = (p: PlaylistSummary): React.ReactNode => (
    covers[p.id] === undefined ? <div className="w-full h-full bg-surface-raised animate-pulse" />
      : covers[p.id] ? <img src={covers[p.id]!} alt={p.name} className="w-full h-full object-cover" onError={() => setCovers(prev => ({ ...prev, [p.id]: null }))} />
        : (() => {
          const imgs = mosaicImages[p.id] ?? []
          if (imgs.length >= 4) return (
            <div className="w-full h-full grid grid-cols-2" style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
              {imgs.map((url, i) => <img key={i} src={smallCoverUrl(url)} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} />)}
            </div>
          )
          if (imgs.length > 0) return <img src={smallCoverUrl(imgs[0])} alt="" className="w-full h-full object-cover" />
          return (
            <div className="w-full h-full bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center">
              <Music2 size={40} className="text-accent/50" />
            </div>
          )
        })()
  )

  // Shared drag-source wiring for playlist cards - dropped onto a folder tile
  // to move them in (see the folder tiles' onDrop in renderFoldersSection).
  // Works from inside select mode now (rather than being disabled there) so
  // a multi-selection can be dragged as a unit - dragging a card that's part
  // of the current selection carries every selected card along with it;
  // dragging an unselected one (select mode or not) moves just that card.
  const dragSourceProps = (plKey: string): {
    draggable: boolean
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
    isDragging: boolean
  } => ({
    draggable: true,
    onDragStart: e => {
      e.dataTransfer.effectAllowed = 'move'
      setDraggedPlaylistKeys(plSelectMode && selectedPlaylistKeys.has(plKey) ? [...selectedPlaylistKeys.keys()] : [plKey])
    },
    onDragEnd: () => { setDraggedPlaylistKeys([]); setDropTargetFolderId(null); setDropTargetPlaylistKey(null) },
    isDragging: draggedPlaylistKeys.includes(plKey),
  })

  // Dropping a dragged playlist card onto another (ungrouped) playlist card
  // bundles both into a new folder - if the target is already in one, the
  // dragged playlist(s) just join it instead of nesting folders.
  const dropOntoPlaylistProps = (plKey: string): {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
    isDropTarget: boolean
  } => ({
    onDragOver: e => {
      if (draggedPlaylistKeys.length === 0 || draggedPlaylistKeys.includes(plKey)) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetPlaylistKey(plKey)
    },
    onDragLeave: () => setDropTargetPlaylistKey(prev => (prev === plKey ? null : prev)),
    onDrop: e => {
      e.preventDefault(); e.stopPropagation()
      if (draggedPlaylistKeys.length > 0 && !draggedPlaylistKeys.includes(plKey)) {
        const existingFolder = folderOfPlaylist(playlistFolders, plKey)
        if (existingFolder) movePlaylistsToFolder(draggedPlaylistKeys, existingFolder.id)
        else createFolder(uniqueFolderName(), [plKey, ...draggedPlaylistKeys])
      }
      setDraggedPlaylistKeys([]); setDropTargetFolderId(null); setDropTargetPlaylistKey(null)
    },
    isDropTarget: dropTargetPlaylistKey === plKey,
  })

  // Dropping a dragged folder member onto empty grid background (rather than
  // onto a specific card or folder tile, both of which stopPropagation so
  // this never double-fires) pulls it back out to ungrouped - the drag-out
  // counterpart of dragging a playlist onto a folder tile to file it away.
  // Harmless no-op if the dragged playlist(s) weren't in a folder already.
  const gridBackgroundDropProps = {
    onDragOver: (e: React.DragEvent): void => { if (draggedPlaylistKeys.length === 0) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move' },
    onDrop: (e: React.DragEvent): void => {
      e.preventDefault()
      if (draggedPlaylistKeys.length > 0) movePlaylistsToFolder(draggedPlaylistKeys, null)
      setDraggedPlaylistKeys([]); setDropTargetFolderId(null); setDropTargetPlaylistKey(null)
    },
  }

  const apiEntry = (p: PlaylistSummary, inFolder = false): GridEntry => {
    const plKey = `api:${p.id}`
    const plSelected = selectedPlaylistKeys.has(plKey)
    const tile = (
        <PlaylistCard
          key={plKey}
          name={p.name}
          subtitle={`${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
          cover={apiCoverNode(p)}
          selected={plSelected}
          selectMode={plSelectMode}
          onClick={e => {
            if (e.ctrlKey || e.metaKey) { togglePlaylistSelect(plKey); return }
            if (plSelectMode) { togglePlaylistSelect(plKey); return }
            toggleExpanded(plKey, !inFolder)
          }}
          onLongPress={() => togglePlaylistSelect(plKey)}
          onDoubleClick={() => { if (!plSelectMode) { setExpandedKey(null); setSelectedId(p.id) } }}
          onContextMenu={e => {
            e.preventDefault(); e.stopPropagation()
            if (plSelectMode) {
              if (!plSelected) setSelectedPlaylistKeys(prev => prev.has(plKey) ? prev : new Map(prev).set(plKey, plKey))
              setPlBulkMenu({ x: e.clientX, y: e.clientY })
            } else {
              setCardMenu({ kind: 'api', playlist: p, x: e.clientX, y: e.clientY, showPlaylists: false })
            }
          }}
          onMenuButton={e => setCardMenu({ kind: 'api', playlist: p, x: e.clientX, y: e.clientY, showPlaylists: false })}
          onPlay={async () => {
            const d = await userApi.getPlaylist(p.id).catch(() => null)
            const trks = d ? d.items.map(i => userApi.liteSongToTrack(i.song)) : []
            if (trks.length) playCollection(trks)
          }}
          {...dragSourceProps(plKey)}
          {...(inFolder ? {} : dropOntoPlaylistProps(plKey))}
        />
    )
    const panel = expandedKey === plKey ? (
        <PlaylistExpandPanel
          key={`panel-${plKey}`}
          name={p.name}
          subtitle={`${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
          cover={apiCoverNode(p)}
          tracks={expandedTracks}
          loading={expandedLoading}
          onClose={() => setExpandedKey(null)}
          onPlayTrack={t => playTrack(t, expandedTracks)}
          onTrackContextMenu={openTrackMenu}
          onOpenFull={() => setSelectedId(p.id)}
        />
    ) : null
    return { key: plKey, tile, panel }
  }

  const localEntry = (lp: LocalPlaylist, inFolder = false): GridEntry => {
    const plKey = `local:${lp.id}`
    const plSelected = selectedPlaylistKeys.has(plKey)
    const localCover = lp.coverImage
      ? <img src={lp.coverImage} alt="" className="w-full h-full object-cover" />
      : <LocalPlaylistMosaic trackIds={lp.trackIds} className="w-full h-full" />
    const tile = (
        <PlaylistCard
          key={plKey}
          name={lp.name}
          subtitle={`${lp.trackIds.length} ${lp.trackIds.length === 1 ? 'track' : 'tracks'}`}
          cover={localCover}
          badge={<span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-md"><HardDrive size={9} /> Local</span>}
          selected={plSelected}
          selectMode={plSelectMode}
          onClick={e => {
            if (e.ctrlKey || e.metaKey) { togglePlaylistSelect(plKey); return }
            if (plSelectMode) { togglePlaylistSelect(plKey); return }
            toggleExpanded(plKey, !inFolder)
          }}
          onLongPress={() => togglePlaylistSelect(plKey)}
          onDoubleClick={() => { if (!plSelectMode) { setExpandedKey(null); setLocalSelectedId(lp.id) } }}
          onContextMenu={e => {
            e.preventDefault(); e.stopPropagation()
            if (plSelectMode) {
              if (!plSelected) setSelectedPlaylistKeys(prev => prev.has(plKey) ? prev : new Map(prev).set(plKey, plKey))
              setPlBulkMenu({ x: e.clientX, y: e.clientY })
            } else {
              setCardMenu({ kind: 'local', playlist: lp, x: e.clientX, y: e.clientY, showPlaylists: false })
            }
          }}
          onMenuButton={e => setCardMenu({ kind: 'local', playlist: lp, x: e.clientX, y: e.clientY, showPlaylists: false })}
          onPlay={() => {
            const qt = lp.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter((t): t is LibraryTrack => !!t).map(libTrackToTrack)
            if (qt.length) playCollection(qt)
          }}
          {...dragSourceProps(plKey)}
          {...(inFolder ? {} : dropOntoPlaylistProps(plKey))}
        />
    )
    const panel = expandedKey === plKey ? (
        <PlaylistExpandPanel
          key={`panel-${plKey}`}
          name={lp.name}
          subtitle={`${lp.trackIds.length} ${lp.trackIds.length === 1 ? 'track' : 'tracks'}`}
          cover={localCover}
          tracks={expandedTracks}
          loading={expandedLoading}
          onClose={() => setExpandedKey(null)}
          onPlayTrack={t => playTrack(t, expandedTracks)}
          onTrackContextMenu={openTrackMenu}
          onOpenFull={() => setLocalSelectedId(lp.id)}
        />
    ) : null
    return { key: plKey, tile, panel }
  }

  const openFollowedPlaylist = (id: number): void => { setSelectedId(id); setIsSharedView(true) }

  const renderFollowedCard = (f: FollowedPlaylist): JSX.Element => (
    <PlaylistCard
      key={`followed-${f.id}`}
      name={f.name}
      subtitle={`${f.trackCount} ${f.trackCount === 1 ? 'track' : 'tracks'} · Following`}
      cover={f.coverUrl ? (
        <img src={f.coverUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center">
          <Rss className="text-accent/50 w-1/3 h-1/3" />
        </div>
      )}
      badge={<span className="flex items-center gap-1 bg-black/60 text-accent text-[10px] px-1.5 py-0.5 rounded-md"><Rss size={9} /> Following</span>}
      selected={false}
      selectMode={false}
      onClick={() => openFollowedPlaylist(f.id)}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); unfollowPlaylist(f.id) }}
      onMenuButton={() => unfollowPlaylist(f.id)}
      onPlay={() => openFollowedPlaylist(f.id)}
    />
  )

  // Folders group both kinds of playlist by their composite key. Resolve each
  // folder's members against the currently-loaded playlists (a member whose
  // playlist was deleted since simply drops out - see the prune-on-read note in
  // lib/playlistFolders) and render them in the folder's own key order. Logged
  // out, `playlists` is empty, so api: members drop out naturally and a folder
  // shows just its device-local playlists - membership itself is unaffected.
  const apiById = new Map(playlists.map(p => [p.id, p]))
  const localById = new Map(localPlaylists.map(lp => [lp.id, lp]))
  const folderMemberEntries = (f: PlaylistFolder): GridEntry[] => {
    const out: GridEntry[] = []
    for (const key of f.playlistKeys) {
      const parsed = parsePlaylistKey(key)
      if (!parsed) continue
      if (parsed.kind === 'api') { const p = apiById.get(Number(parsed.id)); if (p) out.push(apiEntry(p, true)) }
      else { const lp = localById.get(parsed.id); if (lp) out.push(localEntry(lp, true)) }
    }
    return out
  }

  const foldered = allFolderedKeys(playlistFolders)
  const ungroupedApi = playlists.filter(p => !foldered.has(`api:${p.id}`))
  const ungroupedLocal = localPlaylists.filter(lp => !foldered.has(`local:${lp.id}`))

  /** A folder's cover - a 2x2 mosaic of up to its first 4 members' own cover
   *  art, so a folder reads as "a playlist made of playlists" instead of a
   *  plain icon. Falls back to a Folder icon tile when it has no resolvable
   *  members yet.
   *
   *  Each quadrant is a single flat image rather than delegating to
   *  apiCoverNode/LocalPlaylistMosaic - those fall back to a *nested* 2x2 of
   *  a member's own top tracks when it has no cover image of its own, and a
   *  grid-in-grid like that means two independently GPU-composited layers
   *  (each promoted via its own translateZ(0)) stacked inside the card that
   *  PlaylistCard applies a hover transform (`group-hover:-translate-y-1`)
   *  to. The nested layer's bounds get reconciled against the newly
   *  promoted ancestor layer the instant hover starts, which is what showed
   *  up as the quadrants visibly separating for a frame before settling -
   *  the exact flicker fixed on plain playlist covers by keeping their
   *  mosaic to one level. Flattening folder quadrants to a single image
   *  removes the nested layer entirely instead of trying to keep two levels
   *  of compositing in sync. */
  // Returns the member's flat cover image (or null if it resolves but has
  // none), and undefined when the key doesn't resolve to a member at all -
  // callers skip undefined so an unresolvable entry doesn't eat one of the
  // folder's 4 slots.
  const folderSlotImage = (key: string): string | null | undefined => {
    const parsed = parsePlaylistKey(key)
    if (!parsed) return undefined
    if (parsed.kind === 'api') {
      const p = apiById.get(Number(parsed.id))
      if (!p) return undefined
      const cover = covers[p.id]
      if (cover) return cover
      const imgs = mosaicImages[p.id]
      return imgs?.[0] ? smallCoverUrl(imgs[0]) : null
    }
    const lp = localById.get(parsed.id)
    if (!lp) return undefined
    if (lp.coverImage) return lp.coverImage
    return lp.trackIds.map(id => libraryArt[id]).find((a): a is string => !!a) ?? null
  }

  const folderCoverNode = (f: PlaylistFolder): React.ReactNode => {
    const slots: React.ReactNode[] = []
    for (const key of f.playlistKeys) {
      if (slots.length >= 4) break
      const img = folderSlotImage(key)
      if (img === undefined) continue
      slots.push(<FolderSlotImg key={key} src={img} />)
    }
    if (slots.length === 0) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center">
          <Folder size={40} className="text-accent/50" />
        </div>
      )
    }
    if (slots.length === 1) return slots[0]
    return (
      <div className="w-full h-full grid grid-cols-2 grid-rows-2" style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
        {slots}
        {Array.from({ length: 4 - slots.length }).map((_, i) => <div key={`pad-${i}`} className="w-full h-full bg-surface-raised" />)}
      </div>
    )
  }

  // Opening a folder now expands it in place (accordion-style) instead of
  // navigating to a separate page - clicking the open folder again collapses
  // it. `playlistsOpenFolderId` still lives in the store so it survives the
  // tab-unmount-on-switch behavior noted at its declaration.
  // Closes any open playlist quick-view first - a folder tile and a playlist
  // card can land in the same grid row, and a row can only have one full-width
  // break point without disturbing its neighbors (see layoutGridEntries), so
  // a folder panel and a playlist panel open at once would otherwise collide
  // there and the second one would render stacked under the first instead of
  // under its own row.
  const openFolder = (id: string): void => {
    setExpandedKey(null)
    setPlaylistsOpenFolderId(playlistsOpenFolderId === id ? null : id)
  }

  /** Folder tiles - one PlaylistCard-styled tile per folder, meant to be
   *  spread directly into the same grid as the playlists (not a separate
   *  "Folders" section), so a folder sits right next to the playlists it
   *  groups and behaves like any other tile (click opens it, drag a playlist
   *  onto it to file it away). Clicking the open folder's tile expands a
   *  panel of its member cards directly beneath it, spanning the full grid
   *  row, rather than navigating away. `onlyWithMembers` hides folders whose
   *  members can't be resolved in the current view - the logged-out library
   *  passes true so folders holding only synced playlists (invisible without
   *  an account) don't render as misleadingly "empty". Returns a GridEntry per
   *  folder (tile + optional member-panel) for the caller to lay out
   *  alongside the playlist tiles via layoutGridEntries; empty array when
   *  there are no folders to show. */
  const folderTileEntries = (onlyWithMembers: boolean): GridEntry[] => {
    const entries = playlistFolders
      .map(f => ({ f, memberEntries: folderMemberEntries(f) }))
      .filter(({ memberEntries }) => !onlyWithMembers || memberEntries.length > 0)
    return entries.map(({ f, memberEntries }) => {
      const isOpen = playlistsOpenFolderId === f.id
      const tile = (
        <PlaylistCard
          key={f.id}
          name={f.name}
          subtitle={`${memberEntries.length} ${memberEntries.length === 1 ? 'playlist' : 'playlists'}`}
          cover={folderCoverNode(f)}
          badge={<span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-md">{isOpen ? <FolderOpen size={9} /> : <Folder size={9} />} Folder</span>}
          selected={isOpen}
          selectMode={false}
          onClick={() => openFolder(f.id)}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setFolderMenu({ folder: f, x: e.clientX, y: e.clientY }) }}
          onMenuButton={e => setFolderMenu({ folder: f, x: e.clientX, y: e.clientY })}
          onPlay={() => openFolder(f.id)}
          isDropTarget={dropTargetFolderId === f.id}
          onDragOver={e => { if (draggedPlaylistKeys.length === 0) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetFolderId(f.id) }}
          onDragLeave={() => setDropTargetFolderId(prev => (prev === f.id ? null : prev))}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation()
            if (draggedPlaylistKeys.length > 0) movePlaylistsToFolder(draggedPlaylistKeys, f.id)
            setDraggedPlaylistKeys([])
            setDropTargetFolderId(null)
          }}
        />
      )
      const panel = isOpen ? (
        <div
          key={`panel-folder-${f.id}`}
          className="col-span-full rounded-2xl bg-surface-overlay border border-[var(--border)] p-4"
          onClick={e => e.stopPropagation()}
          // Dropping a member back onto its own folder's empty background
          // (rather than dragging it out to the main grid) should leave it
          // right where it is, not bubble up into the outer grid's drag-out
          // handler.
          onDragOver={e => { if (draggedPlaylistKeys.length > 0) { e.preventDefault(); e.stopPropagation() } }}
          onDrop={e => { e.preventDefault(); e.stopPropagation() }}
        >
          {memberEntries.length === 0 ? (
            <p className="text-text-muted text-sm py-1">This folder is empty. Drag a playlist onto it, or right-click one and choose “Move to folder”.</p>
          ) : (
            <div ref={setFolderGridEl} className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {layoutGridEntries(memberEntries, folderGridCols)}
            </div>
          )}
        </div>
      ) : null
      return { key: f.id, tile, panel }
    })
  }

  /** Folder context menu (right-click a folder header / its ⋯ button) -
   *  a body portal, so it renders from either library view. */
  const renderFolderMenu = (): React.ReactNode => folderMenu && createPortal(
    <ClampedMenu x={folderMenu.x} y={folderMenu.y} className="w-56">
      {folderMenu.renaming ? (
        <div className="px-3 py-2 flex gap-2">
          <input
            autoFocus
            value={folderMenu.renameVal ?? folderMenu.folder.name}
            onChange={e => setFolderMenu(prev => prev ? { ...prev, renameVal: e.target.value } : null)}
            onKeyDown={e => {
              if (e.key === 'Enter') { renameFolder(folderMenu.folder.id, folderMenu.renameVal ?? folderMenu.folder.name); setFolderMenu(null) }
              else if (e.key === 'Escape') setFolderMenu(prev => prev ? { ...prev, renaming: false } : null)
            }}
            className="flex-1 min-w-0 bg-surface-overlay rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none border border-[var(--border)]"
          />
          <button
            onClick={() => { renameFolder(folderMenu.folder.id, folderMenu.renameVal ?? folderMenu.folder.name); setFolderMenu(null) }}
            className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium"
          >Save</button>
        </div>
      ) : (
        <>
          <MenuItem icon={Pencil} label="Rename folder" onClick={() => setFolderMenu(prev => prev ? { ...prev, renaming: true, renameVal: prev.folder.name } : null)} />
          <div className="border-t border-[var(--border)] my-1" />
          {/* Deleting a folder only ungroups its playlists - they return to
              the sections above, nothing is removed. */}
          <MenuItem icon={Trash2} label="Delete folder" destructive onClick={() => { deleteFolder(folderMenu.folder.id); setFolderMenu(null) }} />
        </>
      )}
    </ClampedMenu>,
    document.body
  )

  // ── Liked Songs ────────────────────────────────────────────────────────────

  if (showLiked) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 pt-4 shrink-0">
          <button onClick={() => setShowLiked(false)} className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors">
            <ArrowLeft size={15} /> Playlists
          </button>
        </div>
        <LikedSongsView />
      </div>
    )
  }

  // ── Auth guard ─────────────────────────────────────────────────────────────────────────

  if (!account) {
    // show local playlists + login prompt even when not logged in
    if (localSelectedId !== null) {
      const localPl = localPlaylists.find(p => p.id === localSelectedId)
      if (!localPl) { setLocalSelectedId(null); return <div /> }
      const localTracks = localPl.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter(Boolean) as LibraryTrack[]
      const localQTracks: Track[] = localTracks.map(libTrackToTrack)
      const heroSrc = localPl.coverImage ?? localTracks.map(t => libraryArt[t.id]).find(a => !!a) ?? null
      // Only actually dark (and so worth white text) with a backdrop AND a
      // dark skin - Settings > Appearance can turn the backdrop off
      // entirely, and a light skin's backdrop lightens instead (see
      // HeroBackdrop), both of which want the normal dark-on-light text.
      const heroLight = !!heroSrc && isDarkSkin && playlistHeroEnabled
      return (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="relative overflow-hidden px-6 pb-6 shrink-0">
            {playlistHeroEnabled && <HeroBackdrop src={heroSrc} isDarkSkin={isDarkSkin} />}
            <div className="relative z-10 pt-5">
              <button onClick={() => setLocalSelectedId(null)} className={`flex items-center gap-1.5 text-sm transition-colors ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}>
                <ArrowLeft size={15} /> Playlists
              </button>
            </div>
            <div className="relative z-10 flex gap-6 items-end pt-6">
              <div className="shrink-0 rounded-xl shadow-2xl overflow-hidden bg-surface-overlay flex items-center justify-center" style={{ width: 180, height: 180 }}>
                {localPl.coverImage
                  ? <img src={localPl.coverImage} alt="" className="w-full h-full object-cover" />
                  : <LocalPlaylistMosaic trackIds={localPl.trackIds} className="w-full h-full" />
                }
              </div>
              <div className="pb-2">
                <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>Local Playlist</p>
                <h1 className={`text-3xl font-black mb-1 ${heroLight ? 'text-white' : 'text-text-primary'}`}>{localPl.name}</h1>
                <p className={`text-sm ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>{localTracks.length} songs</p>
              </div>
            </div>
            <div className="relative z-10 flex items-center gap-3 mt-5">
              {localQTracks.length > 0 && <HeroPlayButton onClick={() => playCollection(localQTracks)} />}
              {localQTracks.length > 1 && (
                <HeroShuffleButton onClick={() => { const sh = fisherYates(localQTracks); playTrack(sh[0], sh) }} />
              )}
            </div>
          </div>
          <div className="border-t border-[var(--border)] mx-6 mb-3 shrink-0" />
          <div className="px-2 pb-8">
            <div className="grid items-center gap-3 px-4 pb-2 text-text-muted text-xs uppercase tracking-widest" style={{ gridTemplateColumns: '1.75rem 2.5rem 1fr 3.5rem' }}>
              <span className="text-center">#</span><span /><span>Title</span><div className="flex justify-center"><Clock size={12} /></div>
            </div>
            {localTracks.map((lt, i) => {
              const qt = libTrackToTrack(lt)
              return (
                <div key={lt.id} className="group grid items-center gap-3 px-4 py-2 rounded-lg hover:bg-surface-raised transition-colors cursor-default select-none"
                  style={{ gridTemplateColumns: '1.75rem 2.5rem 1fr 3.5rem' }}
                  onDoubleClick={() => playTrack(qt, localQTracks)}
                >
                  <span className="text-center text-xs text-text-muted tabular-nums group-hover:hidden">{i + 1}</span>
                  <button className="hidden group-hover:flex items-center justify-center text-text-primary" onClick={() => playTrack(qt, localQTracks)}><Play size={14} fill="currentColor" /></button>
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0">
                    <AlbumArtThumb track={lt} size={40} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate" title={lt.title}>{lt.title}</p>
                    <p className="text-text-muted text-xs truncate">{lt.artist || 'Unknown Artist'}{lt.album ? ` · ${lt.album}` : ''}</p>
                  </div>
                  <span className="text-text-muted text-xs tabular-nums text-center">
                    {formatDuration(lt.duration, '--:--')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )
    }
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <div className="px-5 pt-5 pb-8">
          <h1 className="text-text-primary text-xl font-bold mb-1">Your Library</h1>
          <p className="text-text-muted text-sm mb-6">Local playlists</p>
          {localPlaylists.length === 0 ? (
            <p className="text-text-muted text-sm">No local playlists yet. Add music to your library first.</p>
          ) : (
            <>
              {/* Folders sit right in the same grid as the playlists they
                  group, rather than a separate section. They work logged out
                  too - membership is device-local (the API only ever stores
                  synced-playlist ids) - folders holding only synced
                  playlists are hidden here since their members can't render
                  without an account. */}
              <div ref={setAuthGridEl} className="grid gap-4 mb-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }} {...gridBackgroundDropProps}>
                {layoutGridEntries([...folderTileEntries(true), ...ungroupedLocal.map(lp => localEntry(lp))], authGridCols)}
              </div>
            </>
          )}
          <div className="flex flex-col items-center text-center gap-3 py-6 border-t border-[var(--border)]">
            <p className="text-text-muted text-sm max-w-xs">Log in to create synced playlists and access your full library.</p>
            <button onClick={() => setShowUserAuth(true)} className="px-5 py-2.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent text-sm font-semibold transition-colors">
              Log in
            </button>
          </div>
        </div>
        {plSelectMode && (
          <div className="sticky bottom-0 shrink-0 border-t border-[var(--border)] bg-surface px-4 py-2.5 flex items-center gap-2 relative z-30" onClick={e => e.stopPropagation()}>
            <span className="text-sm text-text-primary font-medium flex-1">
              {selectedPlaylistKeys.size} {selectedPlaylistKeys.size === 1 ? 'playlist' : 'playlists'} selected
            </span>
            <button
              onClick={() => setSelectedPlaylistKeys(keyMap(localPlaylists.map(lp => `local:${lp.id}`)))}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedPlaylistKeys(new Map())}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
            {selectedPlaylistKind && (
              <div className="relative">
                <button
                  onClick={() => setShowPlBulkAddMenu(v => !v)}
                  disabled={selectedPlaylistKeys.size === 0 || bulkAddingPlaylists}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  {bulkAddingPlaylists ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />} Add to playlist
                </button>
                {showPlBulkAddMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPlBulkAddMenu(false)} />
                    <div className="absolute right-0 bottom-full mb-1 z-50 w-56 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                      <div className="px-3 py-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                        Add to playlist
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`)).length === 0 ? (
                          <p className="px-3 py-2 text-xs text-text-muted">No other playlists</p>
                        ) : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`)).map(p => (
                          <button
                            key={p.id}
                            onClick={() => bulkAddPlaylistsTo({ kind: 'local', id: p.id })}
                            title={p.name}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                          >
                            <ListMusic size={14} className="shrink-0 text-text-muted" />
                            <span className="flex-1 truncate">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              onClick={bulkDeletePlaylists}
              disabled={selectedPlaylistKeys.size === 0 || bulkDeletingPlaylists}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-red-500/10 text-red-400 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {bulkDeletingPlaylists ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
            </button>
            <button
              onClick={exitPlaylistSelectMode}
              className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
              title="Exit selection"
            >
              <X size={15} className="text-text-muted" />
            </button>
          </div>
        )}
        {plBulkMenu && (
          <ClampedMenu x={plBulkMenu.x} y={plBulkMenu.y} className="w-[210px]">
            <div className="px-3.5 py-2 text-xs text-text-muted">
              {selectedPlaylistKeys.size} {selectedPlaylistKeys.size === 1 ? 'playlist' : 'playlists'} selected
            </div>
            <div className="border-t border-[var(--border)] my-1" />
            <MenuItem
              icon={CheckSquare2}
              label="Select all"
              onClick={() => { setSelectedPlaylistKeys(keyMap(localPlaylists.map(lp => `local:${lp.id}`))); setPlBulkMenu(null) }}
            />
            {selectedPlaylistKind === 'local' && (
              <>
                <button
                  className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
                  onClick={e => { e.stopPropagation(); setPlBulkMenu(prev => prev ? { ...prev, showPlaylists: !prev.showPlaylists } : null) }}
                >
                  <span className="flex items-center gap-2.5"><FolderInput size={14} className="text-text-muted" />Add to playlist</span>
                  <span className="text-text-muted text-xs">›</span>
                </button>
                {plBulkMenu.showPlaylists && (
                  <div className="border-t border-[var(--border)] max-h-40 overflow-y-auto">
                    {localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`)).length === 0 ? (
                      <p className="px-3.5 py-2 text-xs text-text-muted">No other playlists</p>
                    ) : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`)).map(p => (
                      <button key={p.id} onClick={() => bulkAddPlaylistsTo({ kind: 'local', id: p.id })} title={p.name} className="w-full text-left px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors truncate">
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <MenuItem
              icon={Trash2}
              label="Delete selected"
              destructive
              onClick={() => { setPlBulkMenu(null); bulkDeletePlaylists() }}
            />
            <div className="border-t border-[var(--border)] my-1" />
            <MenuItem icon={X} label="Exit selection" onClick={() => { setPlBulkMenu(null); exitPlaylistSelectMode() }} />
          </ClampedMenu>
        )}
        {renderCardMenu()}
        {renderFolderMenu()}
        {trackMenu && (
          <SongContextMenu
            state={trackMenu}
            onClose={() => setTrackMenu(null)}
            canEdit={canEdit}
            onInfo={() => trackMenu.songId != null && openSongInfo(trackMenu.songId)}
            onPlay={() => playTrack(trackMenu.track, expandedTracks)}
            onPlayNext={() => playNext(trackMenu.track)}
            onAddToQueue={() => addToQueue(trackMenu.track)}
            liked={likedTrackIds.includes(trackMenu.track.id)}
            onToggleLike={() => toggleLike(trackMenu.track.id)}
          />
        )}
      </div>
    )
  }

  // ── Playlist detail ────────────────────────────────────────────────────────

  if (selectedId != null) {
    const durLabel = totalDurationLabel(tracks)
    // Extra leading checkbox column while selecting. rem, not px, so the fixed
    // columns (notably the album-art column) scale with the app text-size
    // setting alongside the rem-sized covers and text - identical at scale 1.
    const gridCols = selectMode
      ? '1.25rem 1rem 1.75rem 2.5rem 1fr 6rem 5rem 3.5rem 2.25rem'
      : '1rem 1.75rem 2.5rem 1fr 6rem 5rem 3.5rem 2.25rem'

    // Shuffles by SONG, not by track - a song with several versions (a demo,
    // a TV mix, etc.) would otherwise flood the shuffle with itself, since
    // plain fisherYates(tracks) treats every version as an independent equal
    // chance. Grouping first means e.g. a 2-version song and a 1-version song
    // both get a 1-in-N shot of playing first; only *which version* of the
    // 2-version song is then a coin flip. Only applied in compact view - that's
    // the mode where version-grouping is the user's stated mental model of the
    // playlist; in normal/grid view each row is still its own independent track.
    const playShuffle = async () => {
      if (!tracks.length) return
      if (!compactView || !versionsEnabled) { const shuffled = fisherYates(tracks); playTrack(shuffled[0], shuffled); return }
      const groups = await groupItemsByVersion(tracks, t => userApi.trackIdToSongId(t.id) ?? -1)
      const groupedIds = new Set(groups.flatMap(g => g.members.map(m => m.item.id)))
      const units: Track[][] = [
        ...groups.map(g => {
          // Excluded versions don't get an automatic pick here - if that
          // empties the group (every version excluded, which shouldn't
          // normally happen), fall back to the full group rather than
          // dropping the song from shuffle entirely.
          const excluded = groupExcludedVersions(g.members[0].meta.songId, g.members.map(m => m.meta))
          const playable = g.members.filter(m => !isExcludedVersion(m.meta, excluded))
          return (playable.length > 0 ? playable : g.members).map(m => m.item)
        }),
        ...tracks.filter(t => !groupedIds.has(t.id)).map(t => [t]),
      ]
      const shuffled = fisherYates(units).flatMap(u => (u.length > 1 ? fisherYates(u) : u))
      playTrack(shuffled[0], shuffled)
    }

    const heroSrc = playlistCoverUrl(coverData ?? {}) ?? tracks[0]?.imageUrl ?? null
    // See heroLight elsewhere in this file - was fixed to a light palette
    // regardless of app theme (the backdrop used to always be a dark
    // blurred image, so theme-aware text would've flipped to unreadable
    // dark-on-dark). Now the backdrop itself lightens on a light skin (see
    // HeroBackdrop) and Settings > Appearance can turn it off entirely, so
    // the text has to actually track both.
    const heroLight = !!heroSrc && isDarkSkin && playlistHeroEnabled
    return (
      <div ref={setListScrollEl} className="relative flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden" onClick={() => { setTrackMenu(null); setShowAddAllMenu(false); setShowHeroMenu(false) }}>
        {/* ── Hero (shown immediately using summary data) - the backdrop now
            extends behind the back button too, instead of leaving a plain
            theme-background strip above the gradient. ── */}
        <div className="relative overflow-hidden px-6 pb-6 shrink-0">
          {playlistHeroEnabled && <HeroBackdrop src={heroSrc} isDarkSkin={isDarkSkin} />}

          <div className="relative z-10 px-0 pt-5">
            <button onClick={() => {
              setSelectedId(null); setRenaming(false)
              if (isSharedView) { setIsSharedView(false); window.history.pushState({}, '', '/playlists') }
            }} className={`flex items-center gap-1.5 text-sm transition-colors ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}>
              <ArrowLeft size={15} /> Playlists
            </button>
          </div>

          {/* Hidden file input */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f); e.target.value = '' }}
          />

          <div className="relative z-10 flex gap-6 items-end pt-6">
            {/* Cover image - clickable to upload (owner only) */}
            <div className={`shrink-0 self-start group/cover relative rounded-xl shadow-2xl overflow-hidden ${isSharedView ? "cursor-default" : "cursor-pointer"}`} style={{ width: 180, height: 180 }} onClick={() => !isSharedView && coverInputRef.current?.click()}>
              {loadingDetail && tracks.length === 0 ? (
                <div className="w-full h-full bg-surface-overlay animate-pulse" />
              ) : coverLoading ? (
                <div className="w-full h-full bg-surface-overlay flex items-center justify-center">
                  <Loader2 size={28} className="text-text-muted opacity-50 animate-spin" />
                </div>
              ) : playlistCoverUrl(coverData ?? {}) && !coverImgError ? (
                <img
                  src={playlistCoverUrl(coverData ?? {})}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setCoverImgError(true)}
                />
              ) : (
                <PlaylistMosaic tracks={tracks} className="w-full h-full" />
              )}
              {/* Upload overlay (owner only) */}
              <div className={`absolute inset-0 bg-black/50 transition-opacity flex flex-col items-center justify-center gap-2 ${isSharedView ? "opacity-0 pointer-events-none" : "opacity-0 group-hover/cover:opacity-100"}`}>
                {coverUploading ? (
                  <Loader2 size={24} className="text-white animate-spin" />
                ) : (
                  <>
                    <Pencil size={24} className="text-white" />
                    <span className="text-white text-xs font-medium">Change cover</span>
                  </>
                )}
              </div>
              {/* Remove cover button (owner only) */}
              {!isSharedView && (coverData?.cover_image_url || coverData?.cover_image) && !coverImgError && (
                <button
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover/cover:opacity-100 transition-opacity hover:bg-red-500/80"
                  onClick={e => { e.stopPropagation(); handleRemoveCover() }}
                  title="Remove cover"
                >
                  <ImageOff size={12} />
                </button>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <p className={`text-xs uppercase tracking-widest font-semibold mb-2 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>Playlist</p>
              {renaming ? (
                <div className="flex items-center gap-2 mb-3">
                  <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && renameSelected()} autoFocus className={`rounded-lg px-3 py-2 text-2xl font-black focus:outline-none focus:border-accent/50 w-full ${heroLight ? 'bg-black/30 border border-white/20 text-white' : 'bg-surface-overlay border border-[var(--border)] text-text-primary'}`} />
                  <button onClick={renameSelected} className="p-2 rounded-lg bg-accent/15 text-accent shrink-0"><Check size={16} /></button>
                  <button onClick={() => setRenaming(false)} className={`p-2 rounded-lg shrink-0 ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}><X size={16} /></button>
                </div>
              ) : (
                <h1 className={`text-3xl md:text-4xl font-black truncate mb-2 ${heroLight ? 'text-white' : 'text-text-primary'}`}>
                  {detail?.name ?? summary?.name ?? <span className="bg-white/10 rounded animate-pulse text-transparent select-none">Loading…</span>}
                </h1>
              )}
              <div className={`flex items-center gap-1.5 text-sm mb-2 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>
                <span className={`font-medium ${heroLight ? 'text-white/85' : 'text-text-secondary'}`}>{account.discord_username}</span>
                {!loadingDetail && (
                  <>
                    <span>·</span>
                    <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
                    {durLabel && <><span>·</span><span className="flex items-center gap-1"><Clock size={12} />{durLabel}</span></>}
                  </>
                )}
                {loadingDetail && <span className="ml-1 text-xs opacity-50">Loading…</span>}
              </div>

              {/* Description */}
              {editingDesc ? (
                <div className="flex items-start gap-2 mb-3">
                  <textarea
                    value={descValue}
                    onChange={e => setDescValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDescription() } if (e.key === 'Escape') setEditingDesc(false) }}
                    autoFocus
                    rows={2}
                    placeholder="Add a description…"
                    className={`flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50 resize-none ${heroLight ? 'bg-black/30 border border-white/20 text-white placeholder:text-white/40' : 'bg-surface-overlay border border-[var(--border)] text-text-primary placeholder:text-text-muted'}`}
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={saveDescription} className="p-1.5 rounded-lg bg-accent/15 text-accent"><Check size={14} /></button>
                    <button onClick={() => setEditingDesc(false)} className={`p-1.5 rounded-lg ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}><X size={14} /></button>
                  </div>
                </div>
              ) : isSharedView ? (
                detail?.description ? (
                  <p className={`text-sm line-clamp-2 mb-3 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>{detail.description}</p>
                ) : null
              ) : (
                <button
                  className="text-left mb-3 group/desc flex items-start gap-1.5"
                  onClick={() => { setDescValue(detail?.description ?? ''); setEditingDesc(true) }}
                >
                  {detail?.description ? (
                    <>
                      <p className={`text-sm line-clamp-2 transition-colors ${heroLight ? 'text-white/60 group-hover/desc:text-white/80' : 'text-text-muted group-hover/desc:text-text-primary'}`}>{detail.description}</p>
                      <Pencil size={11} className={`opacity-0 group-hover/desc:opacity-60 transition-opacity shrink-0 mt-1 ${heroLight ? 'text-white/60' : 'text-text-muted'}`} />
                    </>
                  ) : (
                    <p className={`text-sm opacity-40 hover:opacity-70 transition-opacity italic ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>+ Add description</p>
                  )}
                </button>
              )}

              {/* Action row */}
              <div className="flex items-center gap-2 flex-wrap">
                {tracks.length > 0 && <HeroPlayButton onClick={() => playCollection(tracks)} />}
                {tracks.length > 1 && <HeroShuffleButton onClick={playShuffle} />}

                {/* Shared (not-owned) playlists get two ways to keep this
                    around: Follow (a live pointer - always shows the owner's
                    current tracks, local to this device) or Save a copy (a
                    one-time snapshot into an owned playlist, requires an
                    account). Follow needs no account since it's purely local. */}
                {isSharedView && tracks.length > 0 && detail && (
                  <button
                    onClick={() => {
                      if (isFollowingCurrent) { unfollowPlaylist(detail.id); return }
                      followPlaylist({
                        id: detail.id,
                        name: detail.name,
                        trackCount: detail.items.length,
                        coverUrl: coverData?.cover_image_url ?? coverData?.cover_image ?? null,
                      })
                    }}
                    title={isFollowingCurrent ? 'Unfollow - stop showing this in your Playlists' : 'Follow - always shows the owner\'s current tracks, kept on this device only'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      isFollowingCurrent ? 'text-accent bg-accent/10' : 'text-text-primary bg-surface-raised hover:bg-surface-overlay'
                    }`}
                  >
                    {isFollowingCurrent ? <Check size={14} /> : <Rss size={14} />}
                    {isFollowingCurrent ? 'Following' : 'Follow'}
                  </button>
                )}
                {isSharedView && account && tracks.length > 0 && detail && (
                  <button
                    onClick={handleImportPlaylist}
                    disabled={importState === 'loading' || importState === 'done'}
                    title={importState === 'done' ? 'Saved to library!' : importState === 'error' ? 'Import failed' : 'Save a one-time copy to my library'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-60 ${
                      importState === 'done' ? 'text-accent bg-accent/10' :
                      importState === 'error' ? 'text-red-400 bg-red-400/10' :
                      'text-text-primary bg-surface-raised hover:bg-surface-overlay'
                    }`}
                  >
                    {importState === 'loading' ? <Loader2 size={14} className="animate-spin" /> :
                     importState === 'done' ? <Check size={14} /> :
                     <FolderInput size={14} />}
                    {importState === 'loading' ? 'Saving…' : importState === 'done' ? 'Saved!' : importState === 'error' ? 'Failed' : 'Save a copy'}
                  </button>
                )}

                {/* Everything else (download, share, public/private, add-all,
                    rename, delete) lives behind one "⋯" menu instead of a row
                    of loose icon buttons. */}
                {!isSharedView && detail && (
                  <div className="relative" ref={heroMenuRef}>
                    <button
                      ref={heroBtnRef}
                      onClick={e => { e.stopPropagation(); setShowHeroMenu(v => !v); setShowAddAllMenu(false); setShowHeroExportMenu(false) }}
                      title="More"
                      className={`p-2.5 rounded-full text-sm transition-colors ${
                        heroLight
                          ? (showHeroMenu ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/10')
                          : (showHeroMenu ? 'text-text-primary bg-surface-overlay' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay')
                      }`}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {/* Portaled to <body> so the hero's overflow-hidden can't
                        clip it, and height-clamped to the viewport so a long
                        "Add all to playlist" list stays fully visible. */}
                    {showHeroMenu && createPortal(
                      <>
                        <div className="fixed inset-0 z-[60]" onClick={() => { setShowHeroMenu(false); setShowAddAllMenu(false); setShowHeroExportMenu(false) }} />
                        {(() => {
                          const r = heroBtnRef.current?.getBoundingClientRect()
                          const top = r ? r.bottom + 6 : 0
                          const left = r ? Math.min(r.left, window.innerWidth - 218) : 0
                          return (
                            <div
                              ref={heroMenuBoxRef}
                              className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 w-[210px] overflow-x-hidden overflow-y-auto"
                              style={{ top, left, maxHeight: window.innerHeight - top - 8 }}
                              onClick={e => e.stopPropagation()}
                            >
                              {/* Rendered outside the hover-tracked div below
                                  (but still inside the menu box) so moving the
                                  mouse into a flyout doesn't count as "left
                                  the trigger row" and close it. */}
                              {showHeroExportMenu && (
                                <div
                                  ref={heroExportMenuRef}
                                  onClick={e => e.stopPropagation()}
                                  style={{ position: 'fixed', zIndex: 62, top: heroExportSubPos.top, left: heroExportSubPos.left }}
                                  className="w-[210px] bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
                                >
                                  <button onClick={() => { setShowHeroMenu(false); setShowHeroExportMenu(false); handleExportJson() }}
                                    className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors">
                                    As JSON
                                  </button>
                                  <button onClick={() => { setShowHeroMenu(false); setShowHeroExportMenu(false); handleExportM3u() }}
                                    className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors">
                                    As M3U
                                  </button>
                                </div>
                              )}
                              {showAddAllMenu && otherPlaylists.length > 0 && tracks.length > 0 && (
                                <div
                                  ref={addAllMenuRef}
                                  onClick={e => e.stopPropagation()}
                                  style={{ position: 'fixed', zIndex: 62, top: addAllSubPos.top, left: addAllSubPos.left }}
                                  className="w-[210px] bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
                                >
                                  <div className="max-h-44 overflow-y-auto">
                                    {otherPlaylists.map(p => (
                                      <button key={p.id} onClick={async () => { setShowAddAllMenu(false); setShowHeroMenu(false); await handleAddAllTo(p.id, detail) }}
                                        title={p.name}
                                        className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors truncate">
                                        {p.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div
                                onMouseOver={(e) => {
                                  const t = e.target as Node
                                  setShowAddAllMenu(addAllItemRef.current?.contains(t) ?? false)
                                  setShowHeroExportMenu(heroExportItemRef.current?.contains(t) ?? false)
                                }}
                              >
                              <MenuItem
                                icon={zipState === 'loading' ? Loader2 : Archive}
                                label={zipState === 'error' ? 'Download failed' : zipState === 'done' ? 'Download started' : 'Download as ZIP'}
                                disabled={zipState === 'loading' || tracks.length === 0}
                                onClick={() => { handleZipDownload(tracks, detail.name ?? summary?.name ?? 'playlist') }}
                              />
                              <MenuItem
                                innerRef={heroExportItemRef}
                                icon={Download}
                                label="Export playlist"
                                disabled={tracks.length === 0}
                                trailing={<ChevronRight size={13} className="text-text-muted" />}
                                onClick={() => setShowHeroExportMenu(v => !v)}
                              />
                              <div className="border-t border-[var(--border)] my-1" />
                              <MenuItem
                                icon={shareCopied ? Check : Link}
                                label={shareCopied ? 'Link copied!' : 'Copy share link'}
                                disabled={tracks.length === 0}
                                onClick={() => { handleShare() }}
                              />
                              <MenuItem
                                icon={detail.is_public ? Globe : Lock}
                                label={detail.is_public ? 'Make private' : 'Make public'}
                                disabled={togglingPublic}
                                onClick={() => { handleTogglePublic() }}
                              />
                              <div className="border-t border-[var(--border)] my-1" />
                              {!renaming && (
                                <MenuItem icon={Pencil} label="Rename" onClick={() => { setShowHeroMenu(false); setRenameValue(detail.name); setRenaming(true) }} />
                              )}
                              {otherPlaylists.length > 0 && tracks.length > 0 && (
                                <MenuItem
                                  innerRef={addAllItemRef}
                                  icon={FolderInput}
                                  label="Add all to playlist"
                                  disabled={addingAll}
                                  trailing={<ChevronRight size={13} className="text-text-muted" />}
                                  onClick={() => setShowAddAllMenu(v => !v)}
                                />
                              )}
                              <div className="border-t border-[var(--border)] my-1" />
                              <MenuItem icon={Trash2} label="Delete playlist" destructive onClick={() => { setShowHeroMenu(false); deleteSelected() }} />
                              </div>
                            </div>
                          )
                        })()}
                      </>,
                      document.body
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] mx-6 mb-3 shrink-0" />

        {/* ── Tracklist ── */}
        {loadingDetail ? (
          <TrackSkeleton />
        ) : tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-8">
            <Music2 className="text-text-muted opacity-20" size={40} />
            <p className="text-text-muted text-sm">This playlist is empty.</p>
            <p className="text-text-muted text-xs">Add tracks from the Tracker or Liked Songs.</p>
          </div>
        ) : (
          <div className="px-2 pb-8">
            {/* Pinned list header: controls on one row, column labels on their
                own full-width row beneath. Sticky so scrolled track rows never
                reach the top of the scroll container, where they'd render
                behind the frameless window's fixed min/max/close buttons; the
                opaque background is what stops that.
                The controls sit on the LEFT on purpose. Right-aligned they'd
                land under those window buttons, which forces the 188px gutter
                the other toolbars carry - and that gutter is pure dead space
                next to the controls. Nothing here may share the column row
                either: anything in that grid steals width from the columns and
                knocks the duration header out of line with the rows.
                -mx-2 px-6 backs the full container width while keeping the
                grid's content box lined up with the rows' px-4. */}
            <div className="sticky top-0 z-20 -mx-2 px-6 pt-2 pb-1 backdrop-blur-md">
              <div className="flex items-center gap-2 mb-2">
                {searchOpen ? (
                  <div className="relative w-64">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      onBlur={() => { if (!search) setSearchOpen(false) }}
                      onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur() } }}
                      placeholder={`Search ${tracks.length} tracks…`}
                      className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl pl-8 pr-8 py-2 text-text-primary text-sm focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
                    />
                    <button
                      onClick={() => { setSearch(''); setSearchOpen(false) }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                      title="Close search"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSearchOpen(true)}
                    className="flex items-center justify-center w-9 h-9 rounded-xl text-text-muted hover:text-text-primary bg-surface-overlay transition-colors"
                    title="Search tracks"
                  >
                    <Search size={15} />
                  </button>
                )}
                <div className="flex items-center bg-surface-overlay rounded-xl p-0.5 shrink-0">
                  <button
                    onClick={() => { setCompactView(false); setGridView(false) }}
                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${!compactView && !gridView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                    title="List view"
                  >
                    <Rows3 size={15} />
                  </button>
                  <button
                    onClick={() => { setGridView(true); setCompactView(false) }}
                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${gridView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                    title="Grid view"
                  >
                    <LayoutGrid size={15} />
                  </button>
                  {versionsEnabled && (
                    <button
                      onClick={() => { setCompactView(true); setGridView(false); clearExpandedGroups() }}
                      className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${compactView ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                      title="Compact view - collapse tracks into their version groups"
                    >
                      <Layers size={15} />
                    </button>
                  )}
                </div>
                {compactView && (
                  <span className="text-text-muted text-xs uppercase tracking-widest ml-1">
                    {loadingCompact ? 'Loading…' : `${filteredCompactGroups.length} group${filteredCompactGroups.length === 1 ? '' : 's'}`}
                  </span>
                )}
              </div>

              {/* Always rendered (just hidden) rather than conditionally mounted -
                  otherwise toggling to grid/compact view drops this row's height
                  and the track list jumps up. Grid view's cards don't line up
                  with this table layout at all, so it's hidden wholesale there;
                  compact view keeps the # column live (groups are numbered too)
                  since it doesn't depend on the table layout, but hides the
                  columns that don't apply to grouped rows (Title/Era/Category/
                  duration/select-all). */}
              <div className={`grid items-center gap-3 text-text-muted text-xs uppercase tracking-widest ${gridView ? 'invisible' : ''}`} style={{ gridTemplateColumns: gridCols }}>
                  {selectMode && (
                    <button
                      onClick={selectAllTracks}
                      className={`flex items-center justify-center text-text-muted hover:text-text-primary ${compactView ? 'invisible' : ''}`}
                      title="Select all / none"
                    >
                      {displayTracks.length > 0 && displayTracks.every(t => selectedTracks.has(t.id))
                        ? <CheckSquare2 size={15} className="text-accent" />
                        : <Square size={15} className="opacity-50" />}
                    </button>
                  )}
                  <span />
                  <div className="flex justify-center">
                    <SortHeader label="#" field="index" sort={sort} onSort={handleSort} />
                  </div>
                  <span className={compactView ? 'invisible' : ''} />
                  <span className={compactView ? 'invisible' : ''}><SortHeader label="Title" field="title" sort={sort} onSort={handleSort} /></span>
                  <span className={compactView ? 'invisible' : ''}><SortHeader label="Era" field="era" sort={sort} onSort={handleSort} /></span>
                  <span className={compactView ? 'invisible' : ''}><SortHeader label="Category" field="category" sort={sort} onSort={handleSort} /></span>
                  <div className={`flex justify-center ${compactView ? 'invisible' : ''}`}>
                    <SortHeader label={<Clock size={12} className="inline" />} field="duration" sort={sort} onSort={handleSort} />
                  </div>
                  <span />
                </div>
            </div>

            {compactView ? (
              loadingCompact ? (
                <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Loading version groups…</span>
                </div>
              ) : filteredCompactGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <CompactEmptyIcon size={32} className="text-text-muted opacity-30" />
                  <p className="text-text-muted text-sm">
                    {compactGroups.length === 0 ? 'No version groups in this playlist' : `No version groups match "${search}"`}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredCompactGroups.map((group, groupIdx) => (
                    <div key={group.groupId}>
                      <CompactGroupRow
                        coverTrack={group.members[0].item}
                        title={group.title}
                        count={group.members.length}
                        expanded={expandedGroups.has(group.groupId)}
                        index={groupIdx + 1}
                        onToggle={() => toggleGroupExpanded(group.groupId)}
                        onPlay={() => playTrack(group.members[0].item, tracks)}
                      />
                      {expandedGroups.has(group.groupId) && (
                        <div className="ml-4 pl-4 border-l border-[var(--border)] space-y-0.5">
                          {group.members.map(({ item: track, meta }) => {
                            const songId = track.id ? (userApi.trackIdToSongId(track.id) ?? -1) : -1
                            return (
                              <div
                                key={track.id}
                                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                                className="group flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-surface-raised transition-colors cursor-default"
                                onDoubleClick={() => playTrack(track, tracks)}
                              >
                                <div className="relative shrink-0 w-8 h-8 rounded-md overflow-hidden">
                                  <AlbumArtThumbnail track={track} size={32} shimmer={false} eager />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                    <button
                                      onClick={e => { e.stopPropagation(); playTrack(track, tracks) }}
                                      className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Play"
                                    >
                                      <Play size={14} fill="currentColor" />
                                    </button>
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-text-primary text-sm font-medium truncate" title={track.title}>
                                    {track.title}
                                    {meta.version && <span className="text-text-muted"> ({meta.version})</span>}
                                  </p>
                                  <p className="text-text-muted text-xs truncate">{track.album || track.artist}</p>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); setTrackMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                                  className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-overlay transition-colors shrink-0"
                                  title="More options"
                                >
                                  <MoreHorizontal size={13} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : gridView ? (
              displayTracks.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-8">No tracks match "{search}"</p>
              ) : (
                <div className="grid gap-4 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
                  {/* Drag-to-reorder mirrors the list view: idx doubles as both
                      the original playlist index and the displayTracks index
                      because dragEnabled only allows dragging when there's no
                      search/sort applied, so the two orders are identical. */}
                  {displayTracks.map((track, idx) => {
                    const songId = track.id ? (userApi.trackIdToSongId(track.id) ?? -1) : -1
                    const isSelected = selectedTracks.has(track.id)
                    const isDragging = dragEnabled && dragIdx === idx
                    const isDropTarget = dragEnabled && dropIdx === idx && dragIdx !== null && dragIdx !== idx
                    return (
                      <div
                        key={track.id}
                        draggable={!isSharedView && dragEnabled && !selectMode}
                        onDragStart={() => !isSharedView && dragEnabled && !selectMode && setDragIdx(idx)}
                        onDragOver={e => { if (!dragEnabled || selectMode) return; e.preventDefault(); setDropIdx(idx) }}
                        onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
                        onDrop={() => dragEnabled && !selectMode && handleDrop(idx)}
                        className={`rounded-2xl transition-opacity ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-accent' : ''} ${!isSharedView && dragEnabled && !selectMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <PlaylistCard
                          name={track.title}
                          subtitle={track.artist}
                          cover={<AlbumArtThumbnail track={track} fill className="w-full h-full" shimmer={false} eager />}
                          selected={isSelected}
                          selectMode={selectMode}
                          onClick={e => { if (e.ctrlKey || e.metaKey || selectMode) toggleTrackSelect(track) }}
                          onLongPress={() => toggleTrackSelect(track)}
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                          onMenuButton={e => setTrackMenu({ track, songId, x: e.clientX, y: e.clientY })}
                          onPlay={() => { if (selectMode) toggleTrackSelect(track); else playTrack(track, displayTracks) }}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              <>
            {displayTracks.length === 0 && (
              <p className="text-text-muted text-sm text-center py-8">No tracks match "{search}"</p>
            )}

            {/* Windowed rows - absolutely positioned at displayIdx * TRACK_ROW_H
                inside a container sized to the full list, so only the visible
                slice is mounted (see useVirtualWindowEl). */}
            <div ref={setListContentEl} style={{ height: rowsTotalHeight, position: 'relative' }}>
            {displayTracks.slice(rowStart, rowEnd).map((track, sliceIdx) => {
              const displayIdx = rowStart + sliceIdx
              const originalIdx = trackIndexOf.get(track) ?? -1
              const songId = track.id ? (userApi.trackIdToSongId(track.id) ?? -1) : -1
              const isDragging = dragEnabled && dragIdx === originalIdx
              const isDropTarget = dragEnabled && dropIdx === displayIdx && dragIdx !== null && dragIdx !== displayIdx
              const isSelected = selectedTracks.has(track.id)

              return (
                <div
                  key={track.id}
                  draggable={!isSharedView && dragEnabled && !selectMode}
                  onDragStart={() => !isSharedView && dragEnabled && !selectMode && setDragIdx(originalIdx)}
                  onDragOver={e => { if (!dragEnabled || selectMode) return; e.preventDefault(); setDropIdx(displayIdx) }}
                  onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
                  onDrop={() => dragEnabled && !selectMode && handleDrop(displayIdx)}
                  onClick={e => { if (trackRowLongPress.consumeFired()) return; if (e.ctrlKey || e.metaKey || selectMode) toggleTrackSelect(track) }}
                  {...trackRowLongPress.bind(() => toggleTrackSelect(track))}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                  className={`group grid items-center gap-3 px-4 py-2 rounded-lg transition-colors cursor-default select-none ${
                    isDragging ? 'opacity-40 bg-surface-raised' : isDropTarget ? 'border-t-2 border-accent bg-surface-overlay' : isSelected ? 'bg-accent/10' : 'hover:bg-surface-raised'
                  }`}
                  style={{ gridTemplateColumns: gridCols, position: 'absolute', top: displayIdx * TRACK_ROW_H, left: 0, right: 0, height: TRACK_ROW_H }}
                >
                  {selectMode && (
                    <span className="flex items-center justify-center shrink-0">
                      {isSelected ? <CheckSquare2 size={16} className="text-accent" /> : <Square size={16} className="text-text-muted opacity-50" />}
                    </span>
                  )}
                  <span className={`flex items-center justify-center text-text-muted ${!isSharedView && dragEnabled && !selectMode ? 'opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing' : 'opacity-0 pointer-events-none'}`}>
                    <GripVertical size={14} />
                  </span>
                  <span className="text-center text-xs text-text-muted tabular-nums group-hover:hidden">{displayIdx + 1}</span>
                  <button className="hidden group-hover:flex items-center justify-center text-text-primary" onClick={e => { e.stopPropagation(); if (selectMode) toggleTrackSelect(track); else playTrack(track, displayTracks) }}>
                    <Play size={14} fill="currentColor" />
                  </button>
                  <AlbumArtThumbnail track={track} size={40} className="rounded-md" shimmer={false} eager />
                  <div className="min-w-0" onDoubleClick={() => { if (!selectMode) playTrack(track, displayTracks) }}>
                    <p className="text-text-primary text-sm font-medium truncate" title={track.title}>{track.title}</p>
                    <p className="text-text-muted text-xs truncate flex items-center gap-1">
                      <span className="truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</span>
                    </p>
                  </div>
                  <span className="text-text-muted text-xs truncate" title={track.era || undefined}>{track.era ? eraLabel(track.era, fullEraNames) : '—'}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border text-center truncate ${CATEGORY_COLORS[track.genre] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}
                  >
                    {CATEGORY_LABELS[track.genre] ?? (track.genre || '—')}
                  </span>
                  <span className="text-text-muted text-xs tabular-nums text-center">
                    {formatDuration(track.duration, '--:--')}
                  </span>
                  <div className={`flex items-center justify-end transition-opacity ${selectMode ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button onClick={e => { e.stopPropagation(); setTrackMenu({ track, songId, x: e.clientX, y: e.clientY }) }}
                      className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-overlay transition-colors hidden md:flex" title="More options">
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
            </div>
              </>
            )}
          </div>
        )}

        {/* ── Track context menu ── */}
        {trackMenu && (
          <SongContextMenu
            state={trackMenu}
            onClose={() => setTrackMenu(null)}
            canEdit={canEdit}
            onInfo={() => openSongInfo(trackMenu.songId as number)}
            onPlay={() => playTrack(trackMenu.track, displayTracks)}
            onAddToQueue={() => addToQueue(trackMenu.track)}
            onSelect={() => toggleTrackSelect(trackMenu.track)}
            liked={likedTrackIds.includes(trackMenu.track.id)}
            onToggleLike={() => toggleLike(trackMenu.track.id)}
            removeAction={!isSharedView ? { label: 'Remove from playlist', onClick: () => removeTrack(trackMenu.songId as number) } : undefined}
          />
        )}

        {/* ── Bulk selection action bar ── */}
        {selectMode && (
          <div className="sticky bottom-0 shrink-0 border-t border-[var(--border)] bg-surface px-4 py-2.5 flex items-center gap-2 relative z-30" onClick={e => e.stopPropagation()}>
            <span className="text-sm text-text-primary font-medium flex-1">
              {selectedTracks.size} {selectedTracks.size === 1 ? 'track' : 'tracks'} selected
            </span>
            <button
              onClick={selectAllTracks}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Select all
            </button>
            <button
              onClick={clearTrackSelection}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
            <button
              onClick={bulkAddToQueue}
              disabled={selectedTracks.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <ListPlus size={13} /> Add to queue
            </button>
            {otherPlaylists.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowBulkPlaylists(v => !v)}
                  disabled={selectedTracks.size === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <Plus size={13} /> Add to playlist
                </button>
                {showBulkPlaylists && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowBulkPlaylists(false)} />
                    <div className="absolute right-0 bottom-full mb-1 z-50 w-56 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                      <div className="px-3 py-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                        Add to playlist
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {otherPlaylists.map(p => (
                          <button
                            key={p.id}
                            onClick={() => bulkAddToPlaylist(p.id)}
                            title={p.name}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                          >
                            <ListMusic size={14} className="shrink-0 text-text-muted" />
                            <span className="flex-1 truncate">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {canEdit && (
              <button
                onClick={bulkEdit}
                disabled={selectedTracks.size === 0 || bulkEditLoading}
                title="Edit fields across every selected song"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {bulkEditLoading ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />} Edit
              </button>
            )}
            {!isSharedView && (
              <button
                onClick={bulkRemove}
                disabled={selectedTracks.size === 0 || bulkRemoving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-red-500/10 text-red-400 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {bulkRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove
              </button>
            )}
            <button
              onClick={exitSelectMode}
              className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
              title="Exit selection"
            >
              <X size={15} className="text-text-muted" />
            </button>
          </div>
        )}

      </div>
    )
  }

  // ── Local playlist detail ─────────────────────────────────────────────────

  if (localSelectedId !== null) {
    const localPl = localPlaylists.find(p => p.id === localSelectedId)
    if (!localPl) { setLocalSelectedId(null); return <div /> }
    const localTracks = localPl.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter(Boolean) as LibraryTrack[]
    const localQTracks: Track[] = localTracks.map(libTrackToTrack)
    const localDurLabel = totalDurationLabel(localQTracks)
    const heroSrc = localPl.coverImage ?? localTracks.map(t => libraryArt[t.id]).find(a => !!a) ?? null
    // See heroLight in the guest-local-playlist branch above - only actually
    // dark with a backdrop AND a dark skin AND the setting on.
    const heroLight = !!heroSrc && isDarkSkin && playlistHeroEnabled

    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
        {/* Hero */}
        <div className="relative overflow-hidden px-6 pb-6 shrink-0">
          {playlistHeroEnabled && <HeroBackdrop src={heroSrc} isDarkSkin={isDarkSkin} />}
          <div className="relative z-10 pt-5">
            <button onClick={() => setLocalSelectedId(null)} className={`flex items-center gap-1.5 text-sm transition-colors ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}>
              <ArrowLeft size={15} /> Playlists
            </button>
          </div>
          <div className="relative z-10 flex gap-6 items-end pt-6">
            <div
              className="shrink-0 rounded-xl shadow-2xl overflow-hidden relative"
              style={{ width: 180, height: 180 }}
            >
              {localPl.coverImage
                ? <img src={localPl.coverImage} alt="" className="w-full h-full object-cover" />
                : <LocalPlaylistMosaic trackIds={localPl.trackIds} className="w-full h-full" />
              }
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className={`text-xs uppercase tracking-widest font-semibold mb-2 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>Local Playlist</p>
              {localRenaming ? (
                <div className="flex items-center gap-2 mb-3">
                  <input value={localRenameVal} onChange={e => setLocalRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { renameLocalPlaylist(localPl.id, localRenameVal.trim() || localPl.name); setLocalRenaming(false) } }}
                    autoFocus className={`rounded-lg px-3 py-2 text-2xl font-black focus:outline-none focus:border-accent/50 w-full ${heroLight ? 'bg-black/30 border border-white/20 text-white' : 'bg-surface-overlay border border-[var(--border)] text-text-primary'}`} />
                  <button onClick={() => { renameLocalPlaylist(localPl.id, localRenameVal.trim() || localPl.name); setLocalRenaming(false) }} className="p-2 rounded-lg bg-accent/15 text-accent shrink-0"><Check size={16} /></button>
                  <button onClick={() => setLocalRenaming(false)} className={`p-2 rounded-lg shrink-0 ${heroLight ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary'}`}><X size={16} /></button>
                </div>
              ) : (
                <h1 className={`text-3xl md:text-4xl font-black truncate mb-2 ${heroLight ? 'text-white' : 'text-text-primary'}`}>{localPl.name}</h1>
              )}
              <div className={`flex items-center gap-1.5 text-sm mb-4 ${heroLight ? 'text-white/60' : 'text-text-muted'}`}>
                <HardDrive size={12} className="shrink-0" />
                <span>Local</span>
                <span>·</span>
                <span>{localTracks.length} {localTracks.length === 1 ? 'track' : 'tracks'}</span>
                {localDurLabel && <><span>·</span><span className="flex items-center gap-1"><Clock size={12} />{localDurLabel}</span></>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {localQTracks.length > 0 && <HeroPlayButton onClick={() => playCollection(localQTracks)} />}
                {localQTracks.length > 1 && (
                  <HeroShuffleButton onClick={() => { const s = fisherYates(localQTracks); playTrack(s[0], s) }} />
                )}
                {!localRenaming && (
                  <button onClick={() => { setLocalRenameVal(localPl.name); setLocalRenaming(true) }} className={`p-2.5 rounded-full text-sm transition-colors ${heroLight ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`} title="Rename">
                    <Pencil size={15} />
                  </button>
                )}
                {localPl.coverImage && (
                  <button onClick={() => updateLocalPlaylist(localPl.id, { coverImage: null })} className={`p-2.5 rounded-full text-sm transition-colors ${heroLight ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`} title="Remove custom cover">
                    <ImageOff size={15} />
                  </button>
                )}
                <button onClick={() => { deleteLocalPlaylist(localPl.id); setLocalSelectedId(null) }} className={`p-2.5 rounded-full text-sm transition-colors hover:text-red-400 hover:bg-red-500/10 ${heroLight ? 'text-white/60' : 'text-text-muted'}`} title="Delete playlist">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] mx-6 mb-3 shrink-0" />

        {/* Track list */}
        {localTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-8">
            <Music2 className="text-text-muted opacity-20" size={40} />
            <p className="text-text-muted text-sm">This playlist is empty.</p>
            <p className="text-text-muted text-xs">Add tracks from the Library tab.</p>
          </div>
        ) : (
          <div className="px-2 pb-8">
            <div className="grid items-center gap-3 px-4 pb-2 text-text-muted text-xs uppercase tracking-widest" style={{ gridTemplateColumns: '1.75rem 2.5rem 1fr 3.5rem' }}>
              <span>#</span>
              <span />
              <span>Title</span>
              <div className="flex justify-center"><Clock size={12} /></div>
            </div>
            {localTracks.map((lt, i) => {
              const qt = libTrackToTrack(lt)
              return (
                <div key={lt.id} className="group grid items-center gap-3 px-4 py-2 rounded-lg hover:bg-surface-raised transition-colors cursor-default select-none"
                  style={{ gridTemplateColumns: '1.75rem 2.5rem 1fr 3.5rem' }}
                  onDoubleClick={() => playTrack(qt, localQTracks)}
                >
                  <span className="text-center text-xs text-text-muted tabular-nums group-hover:hidden">{i + 1}</span>
                  <button className="hidden group-hover:flex items-center justify-center text-text-primary" onClick={() => playTrack(qt, localQTracks)}>
                    <Play size={14} fill="currentColor" />
                  </button>
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0">
                    <AlbumArtThumb track={lt} size={40} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate" title={lt.title}>{lt.title}</p>
                    <p className="text-text-muted text-xs truncate">{lt.artist || 'Unknown Artist'}{lt.album ? ` · ${lt.album}` : ''}</p>
                  </div>
                  <span className="text-text-muted text-xs tabular-nums text-center">
                    {formatDuration(lt.duration, '--:--')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Playlist library ───────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]" onClick={() => { setCardMenu(null); setFolderMenu(null) }}>
      <div className="px-6 pt-6 pb-10">
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-text-primary text-3xl font-black tracking-tight">Your Library</h1>
            <p className="text-text-muted text-sm mt-1">Playlists and saved songs</p>
          </div>
          {!creating && !creatingFolder && (
            <div className="flex items-center gap-2">
              <button onClick={() => { setCreatingFolder(true); setNewFolderName('') }} title="New folder" className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-surface-overlay text-text-primary text-sm font-semibold border border-[var(--border)] hover:bg-surface-raised active:scale-[0.97] transition-all">
                <FolderPlus size={16} strokeWidth={2.2} /> New Folder
              </button>
              <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-accent text-black text-sm font-semibold shadow-sm hover:shadow-md hover:brightness-105 active:scale-[0.97] transition-all">
                <Plus size={16} strokeWidth={2.5} /> New Playlist
              </button>
            </div>
          )}
        </div>

        {creating && (
          <div className="flex items-center gap-2 mb-6 max-w-md">
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createPlaylist()} placeholder="Playlist name" autoFocus className="flex-1 bg-surface-overlay border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/50" />
            <button onClick={createPlaylist} className="px-4 py-2.5 rounded-xl bg-accent text-black text-sm font-semibold">Create</button>
            <button onClick={() => { setCreating(false); setNewName('') }} className="p-2.5 rounded-xl text-text-muted hover:text-text-primary"><X size={16} /></button>
          </div>
        )}

        {creatingFolder && (
          <div className="flex items-center gap-2 mb-6 max-w-md">
            <FolderPlus size={16} className="text-text-muted shrink-0" />
            <input
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newFolderName.trim()) { const id = createFolder(newFolderName); if (id) { setExpandedKey(null); setPlaylistsOpenFolderId(id) }; setCreatingFolder(false); setNewFolderName('') }
                else if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
              }}
              placeholder="Folder name"
              autoFocus
              className="flex-1 bg-surface-overlay border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/50"
            />
            <button onClick={() => { const id = createFolder(newFolderName); if (id) { setExpandedKey(null); setPlaylistsOpenFolderId(id) }; setCreatingFolder(false); setNewFolderName('') }} className="px-4 py-2.5 rounded-xl bg-accent text-black text-sm font-semibold">Create</button>
            <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }} className="p-2.5 rounded-xl text-text-muted hover:text-text-primary"><X size={16} /></button>
          </div>
        )}

        {/* ── Playlists section - folders sit right in the same grid as the
            playlists they group, rather than a separate section above it. ── */}
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-widest mb-3">Playlists</h2>
        <div ref={setMainGridEl} className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }} {...gridBackgroundDropProps}>
          {layoutGridEntries([
            {
              key: 'liked',
              tile: (
                <button key="liked" onClick={() => toggleExpanded('liked')} onDoubleClick={() => { setExpandedKey(null); setShowLiked(true) }} className="group text-left cursor-pointer">
                  <div className="aspect-square rounded-2xl bg-gradient-to-br from-accent/50 to-accent/10 flex items-center justify-center mb-2.5 shadow-md group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-200">
                    <Heart size={44} className="text-accent" fill="currentColor" />
                  </div>
                  <p className="text-text-primary text-sm font-semibold truncate">Liked Songs</p>
                  <p className="text-text-muted text-xs mt-0.5">{likedTrackIds.length} {likedTrackIds.length === 1 ? 'track' : 'tracks'}</p>
                </button>
              ),
              panel: expandedKey === 'liked' ? (
                <PlaylistExpandPanel
                  key="panel-liked"
                  name="Liked Songs"
                  subtitle={`${expandedTracks.length} ${expandedTracks.length === 1 ? 'track' : 'tracks'}`}
                  cover={<div className="w-full h-full bg-gradient-to-br from-accent/50 to-accent/10 flex items-center justify-center"><Heart size={28} className="text-accent" fill="currentColor" /></div>}
                  tracks={expandedTracks}
                  loading={expandedLoading}
                  onClose={() => setExpandedKey(null)}
                  onPlayTrack={t => playTrack(t, expandedTracks)}
                  onTrackContextMenu={openTrackMenu}
                  onOpenFull={() => { setExpandedKey(null); setShowLiked(true) }}
                />
              ) : null,
            },
            ...folderTileEntries(false),
            ...ungroupedApi.map(p => apiEntry(p)),
          ], mainGridCols)}

          {playlists.length === 0 && (
            <p className="text-text-muted text-sm col-span-full py-2">No synced playlists yet - click "New Playlist" to create one.</p>
          )}
        </div>

        {/* ── Following section - other people's playlists followed from a
            share link. Live pointers, not copies (see FollowedPlaylist);
            right-click or the "⋯" button unfollows since there's nothing
            else to do with one from here. ── */}
        {followedPlaylists.length > 0 && (
          <>
            <h2 className="text-text-muted text-xs font-semibold uppercase tracking-widest mb-3 mt-9">Following</h2>
            <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {followedPlaylists.map(renderFollowedCard)}
            </div>
          </>
        )}

        {/* ── On This Device section - separated from synced playlists,
            mirroring Apple Music's split between iCloud and local library. ── */}
        {ungroupedLocal.length > 0 && (
          <>
            <h2 className="text-text-muted text-xs font-semibold uppercase tracking-widest mb-3 mt-9">On This Device</h2>
            <div ref={setDeviceGridEl} className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }} {...gridBackgroundDropProps}>
              {layoutGridEntries(ungroupedLocal.map(lp => localEntry(lp)), deviceGridCols)}
            </div>
          </>
        )}
      </div>

      {/* Bulk playlist-selection action bar */}
      {plSelectMode && (
        <div className="sticky bottom-0 shrink-0 border-t border-[var(--border)] bg-surface px-4 py-2.5 flex items-center gap-2 relative z-30" onClick={e => e.stopPropagation()}>
          <span className="text-sm text-text-primary font-medium flex-1">
            {selectedPlaylistKeys.size} {selectedPlaylistKeys.size === 1 ? 'playlist' : 'playlists'} selected
          </span>
          <button
            onClick={() => setSelectedPlaylistKeys(keyMap([
              ...playlists.map(p => `api:${p.id}`),
              ...localPlaylists.map(lp => `local:${lp.id}`),
            ]))}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
          >
            Select all
          </button>
          <button
            onClick={() => setSelectedPlaylistKeys(new Map())}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
          >
            Clear
          </button>
          {selectedPlaylistKind && (
            <div className="relative">
              <button
                onClick={() => setShowPlBulkAddMenu(v => !v)}
                disabled={selectedPlaylistKeys.size === 0 || bulkAddingPlaylists}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {bulkAddingPlaylists ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />} Add to playlist
              </button>
              {showPlBulkAddMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowPlBulkAddMenu(false)} />
                  <div className="absolute right-0 bottom-full mb-1 z-50 w-56 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Add to playlist
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {(selectedPlaylistKind === 'api'
                        ? playlists.filter(p => !selectedPlaylistKeys.has(`api:${p.id}`))
                        : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`))
                      ).length === 0 ? (
                        <p className="px-3 py-2 text-xs text-text-muted">No other playlists</p>
                      ) : (selectedPlaylistKind === 'api'
                        ? playlists.filter(p => !selectedPlaylistKeys.has(`api:${p.id}`))
                        : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`))
                      ).map(p => (
                        <button
                          key={p.id}
                          onClick={() => bulkAddPlaylistsTo(selectedPlaylistKind === 'api' ? { kind: 'api', id: p.id as number } : { kind: 'local', id: p.id as string })}
                          title={p.name}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                        >
                          <ListMusic size={14} className="shrink-0 text-text-muted" />
                          <span className="flex-1 truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={bulkDeletePlaylists}
            disabled={selectedPlaylistKeys.size === 0 || bulkDeletingPlaylists}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-red-500/10 text-red-400 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {bulkDeletingPlaylists ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
          </button>
          <button
            onClick={exitPlaylistSelectMode}
            className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
            title="Exit selection"
          >
            <X size={15} className="text-text-muted" />
          </button>
        </div>
      )}

      {/* Bulk context menu - shown when right-clicking a card during playlist multi-select */}
      {plBulkMenu && (
        <ClampedMenu x={plBulkMenu.x} y={plBulkMenu.y} className="w-[210px]">
          <div className="px-3.5 py-2 text-xs text-text-muted">
            {selectedPlaylistKeys.size} {selectedPlaylistKeys.size === 1 ? 'playlist' : 'playlists'} selected
          </div>
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem
            icon={CheckSquare2}
            label="Select all"
            onClick={() => {
              setSelectedPlaylistKeys(keyMap([
                ...playlists.map(p => `api:${p.id}`),
                ...localPlaylists.map(lp => `local:${lp.id}`),
              ]))
              setPlBulkMenu(null)
            }}
          />
          {selectedPlaylistKind && (
            <>
              <button
                className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
                onClick={e => { e.stopPropagation(); setPlBulkMenu(prev => prev ? { ...prev, showPlaylists: !prev.showPlaylists } : null) }}
              >
                <span className="flex items-center gap-2.5"><FolderInput size={14} className="text-text-muted" />Add to playlist</span>
                <span className="text-text-muted text-xs">›</span>
              </button>
              {plBulkMenu.showPlaylists && (
                <div className="border-t border-[var(--border)] max-h-40 overflow-y-auto">
                  {(selectedPlaylistKind === 'api'
                    ? playlists.filter(p => !selectedPlaylistKeys.has(`api:${p.id}`))
                    : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`))
                  ).length === 0 ? (
                    <p className="px-3.5 py-2 text-xs text-text-muted">No other playlists</p>
                  ) : (selectedPlaylistKind === 'api'
                    ? playlists.filter(p => !selectedPlaylistKeys.has(`api:${p.id}`))
                    : localPlaylists.filter(lp => !selectedPlaylistKeys.has(`local:${lp.id}`))
                  ).map(p => (
                    <button
                      key={p.id}
                      onClick={() => bulkAddPlaylistsTo(selectedPlaylistKind === 'api' ? { kind: 'api', id: p.id as number } : { kind: 'local', id: p.id as string })}
                      title={p.name}
                      className="w-full text-left px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors truncate"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {selectedPlaylistKeys.size > 0 && (
            <>
              <button
                className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-overlay"
                onClick={e => { e.stopPropagation(); setPlBulkMenu(prev => prev ? { ...prev, showFolders: !prev.showFolders } : null) }}
              >
                <span className="flex items-center gap-2.5"><Folder size={14} className="text-text-muted" />Move to folder</span>
                <span className="text-text-muted text-xs">›</span>
              </button>
              {plBulkMenu.showFolders && folderSubmenuItems([...selectedPlaylistKeys.keys()], () => { setPlBulkMenu(null); exitPlaylistSelectMode() })}
            </>
          )}
          <MenuItem
            icon={Trash2}
            label="Delete selected"
            destructive
            onClick={() => { setPlBulkMenu(null); bulkDeletePlaylists() }}
          />
          <div className="border-t border-[var(--border)] my-1" />
          <MenuItem icon={X} label="Exit selection" onClick={() => { setPlBulkMenu(null); exitPlaylistSelectMode() }} />
        </ClampedMenu>
      )}

      {/* Unified playlist card context menu - portaled to <body> and
          self-clamped (see ClampedMenu) so growing content like the "Add all
          to playlist" submenu can't push it off-screen or get
          clipped/mis-measured by an ancestor. */}
      {renderCardMenu()}

      {renderFolderMenu()}

      {trackMenu && (
        <SongContextMenu
          state={trackMenu}
          onClose={() => setTrackMenu(null)}
          canEdit={canEdit}
          onInfo={() => trackMenu.songId != null && openSongInfo(trackMenu.songId)}
          onPlay={() => playTrack(trackMenu.track, expandedTracks)}
          onPlayNext={() => playNext(trackMenu.track)}
          onAddToQueue={() => addToQueue(trackMenu.track)}
          liked={likedTrackIds.includes(trackMenu.track.id)}
          onToggleLike={() => toggleLike(trackMenu.track.id)}
        />
      )}
    </div>
  )
}
