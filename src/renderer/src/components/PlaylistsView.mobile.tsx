import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import {
  ListMusic, Play, Loader2, Plus, Trash2, Pencil, ArrowLeft, X, Check, Heart, Shuffle,
  Music2, ListPlus, Archive, FolderInput, MoreVertical, Search, ChevronUp, ChevronDown, ChevronRight,
  ImageOff, Globe, Lock, Link, ListEnd, HardDrive, Layers, LayoutGrid, Rows3, Download,
  Image as ImageIcon, ArrowUpDown, AlignLeft, GripVertical, Rss,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { rememberRecentPlaylist } from '../lib/recentPlaylists'
import type { PlaylistDetail, PlaylistSummary } from '../lib/userApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import { Track, LocalPlaylist, LibraryTrack, FollowedPlaylist } from '../types'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import { apiFetch, JWApiSong, playlistCoverUrl, smallCoverUrl } from '../lib/juicewrldApi'
import { getSkin } from '../lib/skins'
import { libraryTrackToTrack as libTrackToTrack } from '../lib/fileTypes'
import { formatDuration, formatTotalDuration } from '../lib/format'
import { fisherYates } from '../store/queueSlice'
import LikedSongsView from './LikedSongsView'
import { AlbumArtThumb } from './LibraryTab'
import SongInfoModal from './SongInfoModal'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { CompactGroupRow, CompactEmptyIcon, useExpandedGroups } from './CompactGroupRow'
import { groupItemsByVersion, filterCompactGroups, subscribeCompactGroupsInvalidation } from '../lib/compactGroups'
import type { CompactGroup } from '../lib/compactGroups'
import { versionsEnabled } from '../lib/versionsApi'
import { shareOrigin } from '../lib/platform'
import { useVirtualWindowEl } from '../hooks/useVirtualWindow'
import PlaylistCard, { FolderRow } from './PlaylistCard.mobile'
import { DonorPlaylistDetail, DonorPlaylistsSection } from './DonorPlaylists'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import { useLongPress } from './mobile/useLongPress'
import { useDragReorder } from './mobile/useDragReorder'
import { registerBackHandler } from '../lib/backHandlers'
import { allFolderedKeys, folderOfPlaylist, parsePlaylistKey } from '../lib/playlistFolders'
import type { PlaylistFolder } from '../lib/playlistFolders'
import { Folder, FolderPlus, FolderOpen, FolderMinus } from 'lucide-react'
import { usePlaylistDetailData, usePlaylistCoverEditing } from '../hooks/usePlaylistDetailData'
import { usePlaylistSharing } from '../hooks/usePlaylistSharing'
import { usePlaylistZipDownload } from '../hooks/usePlaylistZipDownload'
import { downloadBlob, playlistJsonPayload, playlistM3uContent } from '../lib/playlistExport'
import { usePlaylistBulkDeletePlaylists, usePlaylistBulkAddPlaylistsTo } from '../hooks/usePlaylistBulkOps'

// Row strides for the windowed lists, scaled by the app text-size setting
// (absolute px offsets have to grow with the rem-sized covers inside them).
const TRACK_ROW_H = 64

// ── Covers ────────────────────────────────────────────────────────────────────

function PlaylistMosaic({ tracks, className = '' }: { tracks: Track[]; className?: string }): JSX.Element {
  const artUrls = tracks.slice(0, 4).map(t => t.imageUrl).filter(Boolean) as string[]
  if (artUrls.length === 0) {
    return (
      <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
        <Music2 className="text-accent/50 w-1/3 h-1/3" />
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

function LocalPlaylistMosaic({ trackIds, className = '' }: { trackIds: string[]; className?: string }): JSX.Element {
  // Covers live in the store's libraryArt map (keyed by track id), populated as
  // tracks are viewed in the Library tab - read them straight from there.
  const libraryArt = useStore(s => s.libraryArt)
  const covers = trackIds.map(id => libraryArt[id]).filter((a): a is string => !!a).slice(0, 4)
  if (covers.length === 0) {
    return (
      <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
        <HardDrive className="text-accent/50 w-1/3 h-1/3" />
      </div>
    )
  }
  if (covers.length < 4) return <img src={covers[0]} alt="" className={`object-cover ${className}`} />
  return (
    <div className={`grid grid-cols-2 ${className}`} style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
      {covers.map((src, i) => <img key={i} src={src} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} />)}
    </div>
  )
}

// Guest playlists carry full Track snapshots (see GuestPlaylist), so their art
// comes straight off the tracks - no id lookup into another store slice.
function GuestPlaylistMosaic({ tracks, className = '' }: { tracks: Track[]; className?: string }): JSX.Element {
  const artUrls = tracks.map(t => t.imageUrl).filter((u): u is string => !!u).slice(0, 4)
  if (artUrls.length === 0) {
    return (
      <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
        <Music2 className="text-accent/50 w-1/3 h-1/3" />
      </div>
    )
  }
  if (artUrls.length < 4) return <img src={artUrls[0]} alt="" className={`object-cover ${className}`} />
  return (
    <div className={`grid grid-cols-2 ${className}`} style={{ overflow: 'hidden', transform: 'translateZ(0)' }}>
      {artUrls.map((url, i) => <img key={i} src={url} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1' }} />)}
    </div>
  )
}

/** Full-bleed blurred cover behind the detail header, fading into the page.
 *  Only rendered when there IS art - the header switches to a light-on-dark
 *  (or light-on-light, on a light skin) palette to match it, which would be
 *  unreadable over a bare theme surface otherwise. `isDarkSkin` mirrors the
 *  darkening toward white on a light skin instead of always going black -
 *  a black banner slapped over an otherwise light page read as a straight-up
 *  bug rather than a design choice. Callers must flip their own text colors
 *  (see the `backdropSrc && isDarkSkin` checks below) to match. */
function HeroBackdrop({ src, isDarkSkin }: { src: string; isDarkSkin: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: isDarkSkin
            ? 'linear-gradient(to bottom, rgb(0 0 0 / 0.30), rgb(0 0 0 / 0.20), var(--surface))'
            : 'linear-gradient(to bottom, rgb(255 255 255 / 0.45), rgb(255 255 255 / 0.25), var(--surface))',
        }}
      />
    </div>
  )
}

function totalDurationLabel(tracks: Track[]): string {
  const secs = tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0)
  return secs === 0 ? '' : formatTotalDuration(secs)
}

// ── Small shared pieces ───────────────────────────────────────────────────────

function PlayShuffleRow({ onPlay, onShuffle, disabled }: {
  onPlay: () => void; onShuffle: () => void; disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPlay}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-[15px] font-semibold disabled:opacity-40 active:opacity-80"
      >
        <Play size={18} fill="currentColor" /> Play
      </button>
      <button
        onClick={onShuffle}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-surface-overlay text-text-primary text-[15px] font-semibold disabled:opacity-40 active:bg-surface-highest"
      >
        <Shuffle size={17} /> Shuffle
      </button>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{children}</p>
}

function TrackSkeleton(): JSX.Element {
  return (
    <div className="px-4 pt-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2" style={{ height: TRACK_ROW_H }}>
          <div className="w-12 h-12 rounded-xl bg-surface-overlay animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded bg-surface-overlay animate-pulse" style={{ width: `${55 + (i * 17) % 35}%` }} />
            <div className="h-2.5 rounded bg-surface-overlay animate-pulse w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Selection drawn ON the artwork - see PlaylistCard for why. */
function SelectOverlay({ selected }: { selected: boolean }): JSX.Element {
  return (
    <div className={`absolute inset-0 flex items-center justify-center transition-colors ${selected ? 'bg-accent/75' : 'bg-black/45'}`}>
      {selected ? <Check size={20} className="text-white" strokeWidth={3} /> : <span className="w-5 h-5 rounded-full border-2 border-white/85" />}
    </div>
  )
}

// ── Track row ─────────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: Track
  /** Set for device-local playlists: art is read off the file, not a URL. */
  libTrack?: LibraryTrack
  current?: boolean
  selectMode: boolean
  selected: boolean
  onTap: () => void
  onLongPress: () => void
  onMenu: (e: React.MouseEvent) => void
}

const TrackRow = memo(function TrackRow({
  track, libTrack, current, selectMode, selected, onTap, onLongPress, onMenu,
}: TrackRowProps): JSX.Element {
  const press = useLongPress({
    onTap: () => (selectMode ? onLongPress() : onTap()),
    onLongPress,
  })
  return (
    <div
      className={`flex items-center gap-3 px-4 h-full rounded-2xl transition-colors ${selected ? 'bg-accent/15' : 'active:bg-surface-overlay'}`}
      {...press}
    >
      <div className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay">
        {libTrack
          ? <AlbumArtThumb track={libTrack} size={48} />
          : <AlbumArtThumbnail track={track} size={48} className="rounded-xl" shimmer={false} eager />}
        {selectMode && <SelectOverlay selected={selected} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] leading-snug truncate ${current ? 'text-accent font-semibold' : 'text-text-primary'}`}>
          {track.title}
        </p>
        <p className="text-text-muted text-xs truncate mt-0.5 flex items-center gap-1">
          <span className="truncate">
            {[track.artist || 'Unknown Artist', track.album].filter(Boolean).join(' · ')}
          </span>
        </p>
      </div>
      <span className="text-text-muted text-[11px] tabular-nums shrink-0">{formatDuration(track.duration, '--:--')}</span>
      {!selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onMenu(e) }}
          className="shrink-0 w-10 h-11 -mr-2 flex items-center justify-center text-text-muted active:text-accent"
          aria-label="More options"
        >
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  )
})

/** The reorder-mode row: no artwork, no menu - just the title and a grip
 *  handle you drag it by. Used to be a pair of up/down buttons: real
 *  drag-to-reorder is an HTML5 dragstart/drop pair, which touch never fires,
 *  so this is the touch equivalent instead (see mobile/useDragReorder). */
function ReorderRow({ title, dragging, style, handleProps }: {
  title: string
  dragging: boolean
  style: React.CSSProperties
  handleProps: { onTouchStart: (e: React.TouchEvent<HTMLElement>) => void }
}): JSX.Element {
  return (
    <div
      data-drag-row
      style={style}
      className={`flex items-center gap-2 px-2 h-full bg-surface rounded-xl transition-shadow ${dragging ? 'shadow-xl' : ''}`}
    >
      <span className="flex-1 min-w-0 text-text-primary text-[15px] truncate pl-2">{title}</span>
      <button
        {...handleProps}
        aria-label={`Drag to reorder ${title}`}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted touch-none active:text-text-primary active:bg-surface-overlay"
      ><GripVertical size={20} /></button>
    </div>
  )
}

// ── Prompt sheet ──────────────────────────────────────────────────────────────
// Every name/description entry point (create, rename, describe) is one of
// these. The desktop grew a different inline input for each - a row that turned
// into a text field, a menu that turned into a text field - which on a phone
// meant the keyboard opening over whatever you were editing.

interface PromptConfig {
  title: string
  initial: string
  placeholder?: string
  submitLabel: string
  multiline?: boolean
  /** Allowed to submit empty - used by the description editor to clear it. */
  allowEmpty?: boolean
  onSubmit: (value: string) => void
}

function PromptSheet({ config, onClose }: { config: PromptConfig; onClose: () => void }): JSX.Element {
  const [value, setValue] = useState(config.initial)
  const submit = (): void => {
    const v = value.trim()
    if (!v && !config.allowEmpty) return
    config.onSubmit(v)
    onClose()
  }
  return (
    <Sheet onClose={onClose} title={config.title}>
      <div className="px-5 pt-2 pb-2 space-y-3">
        {config.multiline ? (
          <textarea
            autoFocus
            rows={3}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={config.placeholder}
            className="w-full bg-surface-overlay rounded-2xl px-4 py-3 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
          />
        ) : (
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder={config.placeholder}
            enterKeyHint="done"
            className="w-full h-12 bg-surface-overlay rounded-2xl px-4 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        )}
        <button
          onClick={submit}
          disabled={!value.trim() && !config.allowEmpty}
          className="w-full h-12 rounded-full bg-accent text-white text-[15px] font-semibold disabled:opacity-40 active:opacity-80"
        >
          {config.submitLabel}
        </button>
      </div>
    </Sheet>
  )
}

// ── State shapes ──────────────────────────────────────────────────────────────

type SortField = 'default' | 'title' | 'artist' | 'duration'
interface SortState { field: SortField; dir: 'asc' | 'desc' }

/** Which playlist a card sheet is about. No coordinates: sheets come up from
 *  the bottom edge, so there is nothing to anchor to a pointer. */
type CardTarget =
  | { kind: 'api'; playlist: PlaylistSummary }
  | { kind: 'local'; playlist: LocalPlaylist }

type SheetState =
  | { kind: 'create' }
  | { kind: 'card'; target: CardTarget }
  | { kind: 'folder'; folder: PlaylistFolder }
  | { kind: 'detail' }
  | { kind: 'export' }
  | { kind: 'guest'; id: string }
  | { kind: 'sort' }
  | { kind: 'bulkTracks' }
  /** Playlist picker. `for` decides what gets added to the chosen target. */
  | { kind: 'pick'; for: 'selectedTracks' | 'allTracks' | 'selectedPlaylists'; source?: CardTarget }
  | { kind: 'moveToFolder'; keys: string[] }

const LS_LAYOUT = 'playlists:layout'

export default function PlaylistsView(): JSX.Element {
  const { account, playlists, refreshPlaylists, playTrack, playCollection, addToQueue, setShowUserAuth, likedTrackIds, toggleLike, setActiveView, setPendingEditorSongId,
    localPlaylists, libraryTracks, libraryArt, loadLibrary, deleteLocalPlaylist, renameLocalPlaylist, updateLocalPlaylist, addToLocalPlaylist, removeFromLocalPlaylist, reorderLocalPlaylist, createLocalPlaylist,
    guestPlaylists, createGuestPlaylist, deleteGuestPlaylist, renameGuestPlaylist, removeFromGuestPlaylist,
    followedPlaylists, followPlaylist, unfollowPlaylist, updateFollowedPlaylistMeta,
    pendingPlaylistId, setPendingPlaylistId,
    playlistsSelectedId: selectedId, setPlaylistsSelectedId: setSelectedId,
    playlistsSelectedLocalId: localSelectedId, setPlaylistsSelectedLocalId: setLocalSelectedId,
    playlistsSort: sortRaw, setPlaylistsSort: setSortRaw,
    playlistFolders, createFolder, renameFolder, deleteFolder, movePlaylistsToFolder,
    appTextScale, currentTrack, setHeroBleedTop, playNext, theme, playlistHeroEnabledDark, playlistHeroEnabledLight } = useStorePick('account', 'playlists', 'refreshPlaylists', 'playTrack', 'playCollection', 'addToQueue', 'setShowUserAuth', 'likedTrackIds', 'toggleLike', 'setActiveView', 'setPendingEditorSongId', 'localPlaylists', 'libraryTracks', 'libraryArt', 'loadLibrary', 'deleteLocalPlaylist', 'renameLocalPlaylist', 'updateLocalPlaylist', 'addToLocalPlaylist', 'removeFromLocalPlaylist', 'reorderLocalPlaylist', 'createLocalPlaylist', 'guestPlaylists', 'createGuestPlaylist', 'deleteGuestPlaylist', 'renameGuestPlaylist', 'removeFromGuestPlaylist', 'followedPlaylists', 'followPlaylist', 'unfollowPlaylist', 'updateFollowedPlaylistMeta', 'pendingPlaylistId', 'setPendingPlaylistId', 'playlistsSelectedId', 'setPlaylistsSelectedId', 'playlistsSelectedLocalId', 'setPlaylistsSelectedLocalId', 'playlistsSort', 'setPlaylistsSort', 'playlistFolders', 'createFolder', 'renameFolder', 'deleteFolder', 'movePlaylistsToFolder', 'appTextScale', 'currentTrack', 'setHeroBleedTop', 'playNext', 'theme', 'playlistHeroEnabledDark', 'playlistHeroEnabledLight')
  // Cast back to the component's own SortField union - the store keeps the
  // field as a plain string so it doesn't have to import this component's type.
  const sort = sortRaw as SortState
  const setSort = setSortRaw as (s: SortState) => void
  const canEdit = useCanEdit()
  // Skins beyond the classic pair mean `theme === 'dark'` no longer covers
  // "is this a dark look" - Ocean, Mocha, etc. need the dark treatment too.
  // HeroBackdrop only darkens toward black on a dark skin; a light skin
  // lightens toward white instead, so the header text below stays paired
  // with whichever tint is actually under it.
  const isDarkSkin = getSkin(theme).dark
  // The setting is tracked per skin darkness, not as one flag - see
  // playlistHeroEnabledDark/Light in useStore.ts.
  const playlistHeroEnabled = isDarkSkin ? playlistHeroEnabledDark : playlistHeroEnabledLight

  const [showLiked, setShowLiked] = useState(false)

  // One sheet at a time, plus one prompt (create/rename/describe) - a prompt can
  // be raised *from* a sheet, so they're separate slots.
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [prompt, setPrompt] = useState<PromptConfig | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])

  // Grid or list for the library. Covers are the point of a playlist, but a
  // long library is far quicker to scan as rows - so both, remembered.
  const [layout, setLayout] = useState<'grid' | 'list'>(
    () => (localStorage.getItem(LS_LAYOUT) === 'list' ? 'list' : 'grid')
  )
  useEffect(() => { localStorage.setItem(LS_LAYOUT, layout) }, [layout])

  // Guest playlists (signed-out, streamed-song playlists - see GuestPlaylist)
  // stay entirely separate from the api/local machinery: no folders, no
  // multi-select, no bulk actions. Just enough to create, open, rename, and
  // delete one, which is all that's needed while signed out.
  const [guestSelectedId, setGuestSelectedId] = useState<string | null>(null)
  const [donorSelectedId, setDonorSelectedId] = useState<string | null>(null)

  // Context menu for a track row (shared with the Tracker's implementation).
  const [trackMenu, setTrackMenu] = useState<SongContextMenuState | null>(null)

  // Multi-select of playlists in the library - long-press a card to start.
  // Keyed as "api:<id>" / "local:<id>" since both id spaces are numeric and
  // could otherwise collide.
  const [plSelectMode, setPlSelectMode] = useState(false)
  const [selectedPlaylistKeys, setSelectedPlaylistKeys] = useState<Set<string>>(new Set())

  // ── Playlist folders ──────────────────────────────────────────────────────
  // Which folders are expanded in the library (UI-only, not persisted).
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const toggleFolderExpanded = (id: string): void => setExpandedFolders(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  // Multi-select of tracks within an open playlist - mirrors the Tracker's.
  // Keyed by track.id (Track has a string id; the numeric songId is derived
  // when needed for playlist/remove ops).
  const [selectMode, setSelectMode] = useState(false)
  const [selectedTracks, setSelectedTracks] = useState<Map<string, Track>>(new Map())
  const [bulkCreating, setBulkCreating] = useState(false)
  const [bulkRemoving, setBulkRemoving] = useState(false)

  // Reorder mode - the touch replacement for drag-and-drop (see ReorderRow).
  const [reorderMode, setReorderMode] = useState(false)

  // Sort + search inside an open playlist - sort itself comes from the store
  // (see playlistsSort)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Search across the library itself (playlist names).
  const [libSearch, setLibSearch] = useState('')

  // Compact view - same grouping as the Tracker's (see lib/compactGroups.ts):
  // collapses tracks sharing a version_title into one row. Uses the
  // playlist-scoped groupItemsByVersion since `tracks` here is already the
  // playlist's full, unpaginated list.
  const [compactView, setCompactView] = useState(false)
  const [compactGroups, setCompactGroups] = useState<CompactGroup<Track>[]>([])
  const [loadingCompact, setLoadingCompact] = useState(false)
  const { expanded: expandedGroups, toggle: toggleGroupExpanded, clear: clearExpandedGroups } = useExpandedGroups()

  // Zip / share / bulk-add
  const [addingAll, setAddingAll] = useState(false)
  const [isSharedView, setIsSharedView] = useState(false)
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const { detail, setDetail, loadingDetail, coverData, setCoverData, coverLoading, coverImgError, setCoverImgError, loadDetail } =
    usePlaylistDetailData(selectedId, isSharedView)
  const { shareCopied, togglingPublic, handleTogglePublic, handleShare } = usePlaylistSharing(selectedId, detail, setDetail)
  const { zipState, handleZipDownload } = usePlaylistZipDownload()

  // Song info modal
  const [infoSong, setInfoSong] = useState<JWApiSong | null>(null)

  // Cover upload
  const coverInputRef = useRef<HTMLInputElement>(null)

  // Async cover thumbnails for the library (keyed by playlist id)
  const [covers, setCovers] = useState<Record<number, string | null>>({})
  const [mosaicImages, setMosaicImages] = useState<Record<number, string[]>>({})
  const coversLoadedRef = useRef<Set<number>>(new Set())

  const { coverUploading, handleCoverUpload, handleRemoveCover } =
    usePlaylistCoverEditing(selectedId, refreshPlaylists, setCoverData, setCoverImgError, setCovers)

  // Playlist membership cache: playlistId → Set<songId>
  const membershipCache = useRef<Map<number, Set<number>>>(new Map())

  // ── Async cover loading for the library ──────────────────────────────────
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

  // ── Open-playlist mode ────────────────────────────────────────────────────
  // The detail view below is a single tree rendered for both kinds; `isLocal`
  // is the flag that swaps the storage-specific bits (cover, rename, reorder,
  // remove, bulk targets). Everything derived from `tracks` - search, sort,
  // virtualization, multi-select - is therefore shared.
  const isLocal = selectedId == null && localSelectedId !== null
  const localPl = useMemo(
    () => (localSelectedId !== null ? localPlaylists.find(p => p.id === localSelectedId) ?? null : null),
    [localPlaylists, localSelectedId]
  )
  // Local playlists store library track ids; resolve them against the scanned
  // library (dropping ids whose file is no longer there).
  const localLibTracks = useMemo(
    () => (localPl
      ? localPl.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter(Boolean) as LibraryTrack[]
      : []),
    [localPl, libraryTracks]
  )
  // Rows need the LibraryTrack back (AlbumArtThumb reads art off disk by
  // filePath - AlbumArtThumbnail can only show art the API already gave us).
  const localTrackById = useMemo(() => new Map(localLibTracks.map(t => [t.id, t])), [localLibTracks])

  const tracks: Track[] = useMemo(() => {
    if (isLocal) return localLibTracks.map(libTrackToTrack)
    return detail ? detail.items.map(it => userApi.liteSongToTrack(it.song)) : []
  }, [isLocal, localLibTracks, detail])

  const otherPlaylists = useMemo(() => playlists.filter(p => p.id !== selectedId), [playlists, selectedId])
  const otherLocalPlaylists = useMemo(() => localPlaylists.filter(p => p.id !== localSelectedId), [localPlaylists, localSelectedId])
  // Reordering only makes sense against the stored order - not a sorted or
  // filtered view of it.
  const canReorder = !isSharedView && sort.field === 'default' && !search.trim()

  const displayTracks = useMemo(() => {
    let result = tracks
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
    }
    if (sort.field !== 'default') {
      result = [...result].sort((a, b) => {
        let cmp = 0
        if (sort.field === 'title') cmp = a.title.localeCompare(b.title)
        else if (sort.field === 'artist') cmp = a.artist.localeCompare(b.artist)
        else if (sort.field === 'duration') cmp = (a.duration || 0) - (b.duration || 0)
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [tracks, search, sort])

  // ── Detail track-list virtualization ───────────────────────────────────────
  // Element-state refs (not RefObjects) because the detail view mounts long
  // after this component does - see useVirtualWindowEl.
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)
  const [listContentEl, setListContentEl] = useState<HTMLDivElement | null>(null)
  const trackRowH = Math.round(TRACK_ROW_H * appTextScale)
  const { start: rowStart, end: rowEnd, totalHeight: rowsTotalHeight } =
    useVirtualWindowEl(listScrollEl, listContentEl, displayTracks.length, trackRowH)

  // groupItemsByVersion doesn't know about the search box, so without this
  // typing a query while compact view is active would just do nothing.
  const filteredCompactGroups = useMemo(
    () => filterCompactGroups(compactGroups, search, t => `${t.title} ${t.artist}`),
    [compactGroups, search]
  )

  // ── Effects ────────────────────────────────────────────────────────────────

  // Populate membership cache when a detail loads
  useEffect(() => {
    if (detail) membershipCache.current.set(detail.id, new Set(detail.items.map(i => i.song.id)))
  }, [detail])

  // Bumped by the invalidation subscriber below so an edit made elsewhere
  // (e.g. Editor → Versions) shows up here immediately even while this view
  // stays mounted and neither compactView nor tracks changes.
  const [compactReloadToken, setCompactReloadToken] = useState(0)
  const compactViewRef = useRef(compactView)
  useEffect(() => { compactViewRef.current = compactView }, [compactView])
  useEffect(() => subscribeCompactGroupsInvalidation(() => {
    if (compactViewRef.current) setCompactReloadToken(t => t + 1)
  }), [])

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

  // Listen for nav "Playlists" re-click → go back to the library
  useEffect(() => {
    const h = (): void => {
      setSelectedId(null); setLocalSelectedId(null); setGuestSelectedId(null); setShowLiked(false)
      setSearch(''); setSearchOpen(false); setSort({ field: 'default', dir: 'asc' }); setIsSharedView(false)
    }
    window.addEventListener('playlists:back', h)
    return () => window.removeEventListener('playlists:back', h)
  }, [])

  // Autofocus the search input when it expands from the icon
  useEffect(() => { if (searchOpen) searchInputRef.current?.focus() }, [searchOpen])

  // Auto-open playlist from URL params (e.g. /playlists?id=123&view=shared)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (id) setSelectedId(Number(id))
    if (params.get('view') === 'shared') setIsSharedView(true)
  }, [])

  // Open a playlist requested from elsewhere in the app. A store field (not the
  // URL-param effect above) is needed because it has to work even when this
  // component is already mounted - the URL effect only runs once, on mount.
  useEffect(() => {
    if (pendingPlaylistId == null) return
    setSelectedId(pendingPlaylistId)
    setIsSharedView(false)
    setPendingPlaylistId(null)
  }, [pendingPlaylistId, setPendingPlaylistId])

  useEffect(() => { if (selectedId != null) rememberRecentPlaylist(selectedId) }, [selectedId])

  const isFollowingCurrent = useMemo(
    () => isSharedView && selectedId != null && followedPlaylists.some(f => f.id === selectedId),
    [isSharedView, selectedId, followedPlaylists]
  )

  // Keep a followed playlist's cached display fields (the grid card's name/
  // track count/cover) fresh whenever it's reopened, so "Following" doesn't
  // show stale info from the moment it was followed.
  useEffect(() => {
    if (!isSharedView || selectedId == null || !detail) return
    if (!followedPlaylists.some(f => f.id === selectedId)) return
    updateFollowedPlaylistMeta(selectedId, {
      name: detail.name,
      trackCount: detail.items?.length ?? 0,
      coverUrl: playlistCoverUrl(coverData ?? {}) ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSharedView, selectedId, detail, coverData])

  // Reset per-playlist view state when switching playlists. The sort reset
  // is skipped on the component's own first mount - this effect's dependency
  // array fires then too, and since sort lives in the store (so it survives
  // switching tabs and back - see playlistsSort), resetting it unconditionally
  // here would wipe that persistence on every tab switch.
  const sortMountedRef = useRef(false)
  useEffect(() => {
    if (sortMountedRef.current) setSort({ field: 'default', dir: 'asc' })
    sortMountedRef.current = true
    setSearch('')
    setSearchOpen(false)
    setInfoSong(null)
    setCoverImgError(false)
    setSelectMode(false)
    setSelectedTracks(new Map())
    setReorderMode(false)
    setCompactView(false)
  }, [selectedId, localSelectedId])

  // Deselecting the last item drops out of select mode on its own, so there's
  // no separate "Cancel" needed.
  useEffect(() => { if (selectMode && selectedTracks.size === 0) setSelectMode(false) }, [selectMode, selectedTracks])
  useEffect(() => { if (plSelectMode && selectedPlaylistKeys.size === 0) setPlSelectMode(false) }, [plSelectMode, selectedPlaylistKeys])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const createPlaylist = async (name: string): Promise<void> => {
    if (!name) return
    try { await userApi.createPlaylist(name); await refreshPlaylists() } catch {}
  }

  // Delete / rename / remove-track act on whichever playlist is open - the
  // local kind goes through the store, the synced kind through the API.
  const deleteSelected = async (): Promise<void> => {
    if (isLocal) {
      if (!localPl) return
      deleteLocalPlaylist(localPl.id)
      setLocalSelectedId(null)
      return
    }
    if (selectedId == null) return
    try { await userApi.deletePlaylist(selectedId); setSelectedId(null); setLocalSelectedId(null); await refreshPlaylists() } catch {}
  }

  const renameSelected = async (name: string): Promise<void> => {
    if (!name) return
    if (isLocal) {
      if (localPl) renameLocalPlaylist(localPl.id, name)
      return
    }
    if (selectedId == null) return
    try {
      const u = await userApi.renamePlaylist(selectedId, name)
      setDetail(u)
      await refreshPlaylists()
    } catch {}
  }

  // Optimistic remove - no loading flash
  const removeTrack = useCallback(async (track: Track) => {
    if (isLocal) {
      if (localPl) removeFromLocalPlaylist(localPl.id, track.id)
      return
    }
    const songId = track.id ? userApi.trackIdToSongId(track.id) : null
    if (selectedId == null || songId == null || songId <= 0) return
    setDetail(prev => prev ? { ...prev, items: prev.items.filter(i => i.song.id !== songId) } : null)
    membershipCache.current.get(selectedId)?.delete(songId)
    try { await userApi.removeFromPlaylist(selectedId, songId); await refreshPlaylists() }
    catch { await loadDetail(selectedId) }
  }, [isLocal, localPl, removeFromLocalPlaylist, selectedId, loadDetail, refreshPlaylists])

  // ── Multi-select bulk actions (tracks) ────────────────────────────────────
  const toggleTrackSelect = useCallback((track: Track) => {
    setSelectMode(true)
    setSelectedTracks(prev => {
      const next = new Map(prev)
      if (next.has(track.id)) next.delete(track.id)
      else next.set(track.id, track)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedTracks(new Map())
  }, [])

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
    await Promise.all(ids.map(id => userApi.addToPlaylist(targetId, id).catch(() => {})))
    const targetSet = membershipCache.current.get(targetId) ?? new Set<number>()
    ids.forEach(id => targetSet.add(id))
    membershipCache.current.set(targetId, targetSet)
    await refreshPlaylists()
    exitSelectMode()
  }, [selectedTrackList, refreshPlaylists, exitSelectMode])

  // Local counterpart - device-only playlists hold library track ids, so the
  // selection goes in verbatim with no id translation.
  const bulkAddToLocalPlaylist = useCallback((targetId: string) => {
    selectedTrackList.forEach(t => addToLocalPlaylist(targetId, t.id))
    exitSelectMode()
  }, [selectedTrackList, addToLocalPlaylist, exitSelectMode])

  // Same as the two above, but into a playlist created on the spot - otherwise
  // the bulk bar is a dead end for anyone whose only playlist is the open one.
  const bulkCreateAndAddToPlaylist = useCallback(async (name: string) => {
    if (!name) return
    if (isLocal) {
      createLocalPlaylist(name)
      // createLocalPlaylist applies synchronously and parks the new id in
      // activeLocalPlaylistId (same trick SongContextMenu uses).
      const newId = useStore.getState().activeLocalPlaylistId
      if (newId) selectedTrackList.forEach(t => addToLocalPlaylist(newId, t.id))
      exitSelectMode()
      return
    }
    const ids = selectedTrackList
      .map(t => (t.id ? userApi.trackIdToSongId(t.id) : null))
      .filter((id): id is number => id != null && id > 0)
    if (!ids.length) return
    setBulkCreating(true)
    try {
      const playlist = await userApi.createPlaylist(name)
      await Promise.all(ids.map(id => userApi.addToPlaylist(playlist.id, id).catch(() => {})))
      membershipCache.current.set(playlist.id, new Set(ids))
      await refreshPlaylists()
      exitSelectMode()
    } catch {} finally { setBulkCreating(false) }
  }, [isLocal, createLocalPlaylist, addToLocalPlaylist, selectedTrackList, refreshPlaylists, exitSelectMode])

  // Remove every selected track in one pass, then refresh once (rather than
  // per-track like removeTrack) - otherwise a large selection fires a refresh
  // storm. Optimistically drops them from the open detail first.
  const bulkRemove = useCallback(async () => {
    if (isLocal) {
      if (!localPl) return
      selectedTrackList.forEach(t => removeFromLocalPlaylist(localPl.id, t.id))
      exitSelectMode()
      return
    }
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
  }, [isLocal, localPl, removeFromLocalPlaylist, selectedId, selectedTrackList, refreshPlaylists, loadDetail, exitSelectMode])

  // ── Multi-select of playlists ─────────────────────────────────────────────
  const togglePlaylistSelect = useCallback((key: string) => {
    setPlSelectMode(true)
    setSelectedPlaylistKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const exitPlaylistSelectMode = useCallback(() => {
    setPlSelectMode(false)
    setSelectedPlaylistKeys(new Set())
  }, [])

  const { busy: bulkDeletingPlaylists, run: runBulkDeletePlaylists } = usePlaylistBulkDeletePlaylists(
    refreshPlaylists, deleteLocalPlaylist, selectedId, setSelectedId, localSelectedId, setLocalSelectedId, exitPlaylistSelectMode,
  )
  const bulkDeletePlaylists = useCallback(() => runBulkDeletePlaylists([...selectedPlaylistKeys]), [runBulkDeletePlaylists, selectedPlaylistKeys])

  // "Add to playlist" only makes sense when every selected playlist is the same
  // kind, since a synced (api) target can't hold local-only tracks and vice
  // versa. Mixed selections simply don't offer the action.
  const selectedPlaylistKind = useMemo(() => {
    const kinds = new Set([...selectedPlaylistKeys].map(k => k.split(':')[0]))
    return kinds.size === 1 ? ([...kinds][0] as 'api' | 'local') : null
  }, [selectedPlaylistKeys])

  const { busy: bulkAddingPlaylists, run: runBulkAddPlaylistsTo } = usePlaylistBulkAddPlaylistsTo(
    refreshPlaylists, localPlaylists, addToLocalPlaylist, exitPlaylistSelectMode,
  )
  const bulkAddPlaylistsTo = useCallback(
    (target: { kind: 'api'; id: number } | { kind: 'local'; id: string }) => runBulkAddPlaylistsTo([...selectedPlaylistKeys], target),
    [runBulkAddPlaylistsTo, selectedPlaylistKeys],
  )

  /** Move one track within the stored order (reorder mode). */
  const moveTrack = useCallback(async (from: number, to: number) => {
    if (from === to || to < 0 || to >= tracks.length) return
    if (isLocal) {
      if (!localPl) return
      const ids = localLibTracks.map(t => t.id)
      const [moved] = ids.splice(from, 1)
      ids.splice(to, 0, moved)
      reorderLocalPlaylist(localPl.id, ids)
      return
    }
    if (!detail || selectedId == null) return
    const newItems = [...detail.items]
    const [removed] = newItems.splice(from, 1)
    newItems.splice(to, 0, removed)
    setDetail({ ...detail, items: newItems })
    try {
      const updated = await userApi.reorderPlaylist(selectedId, newItems.map(it => it.song.id))
      setDetail(updated)
    } catch { await loadDetail(selectedId) }
  }, [tracks.length, isLocal, localPl, localLibTracks, reorderLocalPlaylist, detail, selectedId, loadDetail])

  const trackDrag = useDragReorder(tracks.length, moveTrack)

  const openSongInfo = useCallback(async (songId: number) => {
    try { setInfoSong(await apiFetch<JWApiSong>(`/songs/${songId}/`)) } catch {}
  }, [])

  const saveDescription = useCallback(async (value: string) => {
    if (!selectedId) return
    try {
      const updated = await userApi.updatePlaylist(selectedId, { description: value })
      setDetail(updated)
      await refreshPlaylists()
    } catch {}
  }, [selectedId, refreshPlaylists])

  const handleExportJson = useCallback((name: string) => {
    if (!detail) return
    downloadBlob(JSON.stringify(playlistJsonPayload(detail), null, 2), 'application/json', `${name || 'playlist'}.json`)
  }, [detail])

  const handleExportM3u = useCallback((trackList: Track[], name: string) => {
    downloadBlob(playlistM3uContent(trackList), 'audio/x-mpegurl', `${name || 'playlist'}.m3u`)
  }, [])

  const handleAddAllTo = useCallback(async (targetId: number, srcDetail: PlaylistDetail) => {
    setAddingAll(true)
    const eligible = srcDetail.items.filter(item => !['recording_session', 'unsurfaced'].includes(item.song.category))
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
        .filter(item => !['recording_session', 'unsurfaced'].includes(item.song.category))
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

  // A default name for a folder made straight from "Move to folder → New
  // folder", where there's no name field - unique so two quick creates don't
  // collide. The user can rename via the folder's own sheet.
  const uniqueFolderName = (): string => {
    const taken = new Set(playlistFolders.map(f => f.name.toLowerCase()))
    if (!taken.has('new folder')) return 'New Folder'
    let n = 2
    while (taken.has(`new folder ${n}`)) n++
    return `New Folder ${n}`
  }

  const goBackToLibrary = useCallback((): void => {
    // Clear both ids: a stale local id left over from an earlier visit would
    // otherwise reopen that local playlist the moment the synced one closes.
    setLocalSelectedId(null)
    if (isLocal) return
    setSelectedId(null)
    if (isSharedView) { setIsSharedView(false); window.history.pushState({}, '', '/playlists') }
  }, [isLocal, isSharedView, setLocalSelectedId, setSelectedId])

  // Hardware back, innermost first. Registered once through a ref: handlers run
  // last-registered-first, so re-registering on every state change would let
  // this steal presses from a sheet that opened earlier.
  const backRef = useRef<() => boolean>(() => false)
  backRef.current = (): boolean => {
    if (selectMode) { exitSelectMode(); return true }
    if (plSelectMode) { exitPlaylistSelectMode(); return true }
    if (reorderMode) { setReorderMode(false); return true }
    if (search) { setSearch(''); setSearchOpen(false); return true }
    if (showLiked) { setShowLiked(false); return true }
    if (guestSelectedId !== null) { setGuestSelectedId(null); return true }
    if (selectedId != null || localSelectedId !== null) { goBackToLibrary(); return true }
    if (libSearch) { setLibSearch(''); return true }
    return false
  }
  useEffect(() => registerBackHandler(() => backRef.current()), [])

  // ── Library pieces ────────────────────────────────────────────────────────

  const apiById = new Map(playlists.map(p => [p.id, p]))
  const localById = new Map(localPlaylists.map(lp => [lp.id, lp]))
  const foldered = allFolderedKeys(playlistFolders)
  const ungroupedApi = playlists.filter(p => !foldered.has(`api:${p.id}`))
  const ungroupedLocal = localPlaylists.filter(lp => !foldered.has(`local:${lp.id}`))

  const apiCoverNode = (p: PlaylistSummary): React.ReactNode => (
    covers[p.id] === undefined ? <div className="w-full h-full bg-surface-raised animate-pulse" />
      : covers[p.id] ? <img src={covers[p.id]!} alt="" className="w-full h-full object-cover" onError={() => setCovers(prev => ({ ...prev, [p.id]: null }))} />
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
              <Music2 className="text-accent/50 w-1/3 h-1/3" />
            </div>
          )
        })()
  )

  const openApiPlaylist = (id: number): void => { setLocalSelectedId(null); setSelectedId(id) }
  const openLocalPlaylist = (id: string): void => { setSelectedId(null); setLocalSelectedId(id) }

  const renderApiCard = (p: PlaylistSummary): JSX.Element => {
    const key = `api:${p.id}`
    return (
      <PlaylistCard
        key={key}
        layout={layout}
        name={p.name}
        subtitle={`${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
        cover={apiCoverNode(p)}
        selected={selectedPlaylistKeys.has(key)}
        selectMode={plSelectMode}
        onOpen={() => openApiPlaylist(p.id)}
        onLongPress={() => togglePlaylistSelect(key)}
        onMenu={() => setSheet({ kind: 'card', target: { kind: 'api', playlist: p } })}
      />
    )
  }

  const renderLocalCard = (lp: LocalPlaylist): JSX.Element => {
    const key = `local:${lp.id}`
    return (
      <PlaylistCard
        key={key}
        layout={layout}
        name={lp.name}
        subtitle={`${lp.trackIds.length} ${lp.trackIds.length === 1 ? 'track' : 'tracks'} · this device`}
        cover={lp.coverImage
          ? <img src={lp.coverImage} alt="" className="w-full h-full object-cover" />
          : <LocalPlaylistMosaic trackIds={lp.trackIds} className="w-full h-full" />}
        badge={<span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-md"><HardDrive size={9} /> Local</span>}
        selected={selectedPlaylistKeys.has(key)}
        selectMode={plSelectMode}
        onOpen={() => openLocalPlaylist(lp.id)}
        onLongPress={() => togglePlaylistSelect(key)}
        onMenu={() => setSheet({ kind: 'card', target: { kind: 'local', playlist: lp } })}
      />
    )
  }

  const openFollowedPlaylist = (id: number): void => { setLocalSelectedId(null); setSelectedId(id); setIsSharedView(true) }

  const renderFollowedCard = (f: FollowedPlaylist): JSX.Element => (
    <PlaylistCard
      key={`followed-${f.id}`}
      layout={layout}
      name={f.name}
      subtitle={`${f.trackCount} ${f.trackCount === 1 ? 'track' : 'tracks'} · Following`}
      cover={f.coverUrl
        ? <img src={f.coverUrl} alt="" className="w-full h-full object-cover" />
        : <div className="w-full h-full bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center"><Rss className="text-accent/50 w-1/3 h-1/3" /></div>}
      badge={<span className="flex items-center gap-1 bg-black/60 text-accent text-[10px] px-1.5 py-0.5 rounded-md"><Rss size={9} /> Following</span>}
      selected={false}
      selectMode={false}
      onOpen={() => openFollowedPlaylist(f.id)}
      onLongPress={() => unfollowPlaylist(f.id)}
      onMenu={() => unfollowPlaylist(f.id)}
    />
  )

  /** Wraps a run of cards in whichever container the current layout wants.
   *  A plain function, not a component: declared inside the view, a component
   *  gets a new identity every render and React would unmount and remount every
   *  card under it - losing any long-press in flight. */
  const cardContainer = (children: React.ReactNode): JSX.Element =>
    layout === 'grid'
      ? <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4">{children}</div>
      : <div>{children}</div>

  // Folders group both kinds of playlist by their composite key. Resolve each
  // folder's members against the currently-loaded playlists (a member whose
  // playlist was deleted since simply drops out - see the prune-on-read note in
  // lib/playlistFolders). Logged out, `playlists` is empty, so api: members drop
  // out naturally and a folder shows just its device-local playlists.
  const folderMemberCards = (f: PlaylistFolder): JSX.Element[] => {
    const out: JSX.Element[] = []
    for (const key of f.playlistKeys) {
      const parsed = parsePlaylistKey(key)
      if (!parsed) continue
      if (parsed.kind === 'api') { const p = apiById.get(Number(parsed.id)); if (p) out.push(renderApiCard(p)) }
      else { const lp = localById.get(parsed.id); if (lp) out.push(renderLocalCard(lp)) }
    }
    return out
  }

  /** `onlyWithMembers` hides folders whose members can't be resolved in the
   *  current view - the logged-out library passes true so folders holding only
   *  synced playlists don't render as misleadingly empty. */
  const renderFolders = (onlyWithMembers: boolean): React.ReactNode => {
    const entries = playlistFolders
      .map(f => ({ f, memberCards: folderMemberCards(f) }))
      .filter(({ memberCards }) => !onlyWithMembers || memberCards.length > 0)
    if (entries.length === 0) return null
    return (
      <>
        <SectionLabel>Folders</SectionLabel>
        {entries.map(({ f, memberCards }) => {
          const expanded = expandedFolders.has(f.id)
          return (
            <div key={f.id}>
              <FolderRow
                name={f.name}
                count={memberCards.length}
                expanded={expanded}
                icon={expanded ? <FolderOpen size={24} /> : <Folder size={24} />}
                onToggle={() => toggleFolderExpanded(f.id)}
                onMenu={() => setSheet({ kind: 'folder', folder: f })}
              />
              {expanded && (
                memberCards.length === 0 ? (
                  <p className="px-4 pb-3 text-text-muted text-xs">
                    Empty. Long-press a playlist and choose “Move to folder”.
                  </p>
                ) : (
                  // Indented so a folder's contents read as nested rather than
                  // as another top-level section.
                  <div className="pl-4 pb-2 border-l border-[var(--border)] ml-6">
                    {cardContainer(memberCards)}
                  </div>
                )
              )}
            </div>
          )
        })}
      </>
    )
  }

  // Library-wide search flattens everything into one list: folders, sections and
  // two storage kinds are structure you don't want to navigate while looking for
  // a name you already know.
  const libQuery = libSearch.trim().toLowerCase()
  const searchHits = libQuery
    ? [
      ...playlists.filter(p => p.name.toLowerCase().includes(libQuery)).map(renderApiCard),
      ...localPlaylists.filter(p => p.name.toLowerCase().includes(libQuery)).map(renderLocalCard),
    ]
    : []

  const appBarButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    active = false,
    // Detail screens with a hero backdrop extend that art in behind the app
    // bar (see renderDetail/renderGuestDetail) - text-muted is a dark tone in
    // a light theme and unreadable over the now-darkened art sitting behind
    // it there, so those callers pass light=true to match the hero title
    // below, which already switches to white the same way.
    light = false,
  ): JSX.Element => (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${
        active ? 'text-accent' : light ? 'text-white/90' : 'text-text-muted'
      }`}
    >{icon}</button>
  )

  // ── Screens ───────────────────────────────────────────────────────────────

  const librarySubtitle = (): string => {
    const parts: string[] = []
    if (account) parts.push(`${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`)
    if (guestPlaylists.length) parts.push(`${guestPlaylists.length} offline-only`)
    if (localPlaylists.length) parts.push(`${localPlaylists.length} on this device`)
    return parts.join(' · ') || 'Nothing here yet'
  }

  const renderLibrary = (): JSX.Element => (
    <>
      <div className="shrink-0">
        <div className="flex items-center gap-1 px-2">
          <div className="flex-1 min-w-0 pl-2.5">
            <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">Your Library</h1>
            <p className="text-text-muted text-xs truncate">{librarySubtitle()}</p>
          </div>
          {appBarButton(
            layout === 'grid' ? 'Show as list' : 'Show as grid',
            layout === 'grid' ? <Rows3 size={19} /> : <LayoutGrid size={19} />,
            () => setLayout(l => (l === 'grid' ? 'list' : 'grid')),
          )}
          {appBarButton('New playlist', <Plus size={21} />, () => setSheet({ kind: 'create' }))}
        </div>

        <div className="px-4 pt-2.5">
          <div className="relative flex items-center">
            <Search size={16} className="absolute left-3.5 text-text-muted pointer-events-none" />
            <input
              type="search"
              value={libSearch}
              onChange={e => setLibSearch(e.target.value)}
              placeholder="Find a playlist"
              enterKeyHint="search"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full h-11 bg-surface-overlay rounded-full pl-10 pr-10 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-search-cancel-button]:hidden"
            />
            {libSearch && (
              <button
                onClick={() => setLibSearch('')}
                className="absolute right-1 w-9 h-9 flex items-center justify-center rounded-full text-text-muted active:text-text-primary"
                aria-label="Clear search"
              ><X size={16} /></button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-6">
        {libQuery ? (
          searchHits.length === 0
            ? <p className="text-text-muted text-sm text-center py-16">No playlist matches “{libSearch}”</p>
            : <div className="pt-3">{cardContainer(searchHits)}</div>
        ) : (
          <>
            {/* Liked Songs is a playlist you never created and can't delete, so
                it sits above the library proper rather than inside the grid
                where it used to be indistinguishable from the rest. */}
            <button
              onClick={() => setShowLiked(true)}
              className="w-full flex items-center gap-3 px-4 py-2.5 mt-1 active:bg-surface-overlay transition-colors text-left"
            >
              <div className="w-14 h-14 shrink-0 rounded-xl bg-gradient-to-br from-accent/60 to-accent/15 flex items-center justify-center">
                <Heart size={24} className="text-accent" fill="currentColor" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-[15px] leading-snug truncate">Liked Songs</p>
                <p className="text-text-muted text-xs truncate mt-0.5">
                  {likedTrackIds.length} {likedTrackIds.length === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </button>

            {renderFolders(!account)}

            {guestPlaylists.length > 0 && (
              <>
                {/* These outlive signing in - they hold streamed songs rather
                    than account rows, and nothing migrates them. */}
                <SectionLabel>Made while signed out</SectionLabel>
                {cardContainer(guestPlaylists.map(gp => (
                    <PlaylistCard
                      key={gp.id}
                      layout={layout}
                      name={gp.name}
                      subtitle={`${gp.tracks.length} ${gp.tracks.length === 1 ? 'track' : 'tracks'}`}
                      cover={<GuestPlaylistMosaic tracks={gp.tracks} className="w-full h-full" />}
                      selected={false}
                      selectMode={false}
                      onOpen={() => setGuestSelectedId(gp.id)}
                      onLongPress={() => setSheet({ kind: 'guest', id: gp.id })}
                      onMenu={() => setSheet({ kind: 'guest', id: gp.id })}
                    />
                )))}
              </>
            )}

            {account && (
              <>
                <SectionLabel>Playlists</SectionLabel>
                {ungroupedApi.length === 0 && playlists.length === 0 ? (
                  <p className="px-4 text-text-muted text-sm py-2">
                    No synced playlists yet - tap + to make one.
                  </p>
                ) : cardContainer(ungroupedApi.map(renderApiCard))}
              </>
            )}

            {ungroupedLocal.length > 0 && (
              <>
                {/* Separated from synced playlists, mirroring Apple Music's
                    split between the cloud library and local files. */}
                <SectionLabel>On this device</SectionLabel>
                {cardContainer(ungroupedLocal.map(renderLocalCard))}
              </>
            )}

            {/* Other people's playlists followed from a share link. Live
                pointers, not copies (see FollowedPlaylist); long-press or the
                "⋯" button unfollows since there's nothing else to configure. */}
            {followedPlaylists.length > 0 && (
              <>
                <SectionLabel>Following</SectionLabel>
                {cardContainer(followedPlaylists.map(renderFollowedCard))}
              </>
            )}

            <DonorPlaylistsSection onOpen={setDonorSelectedId} />

            {!account && (
              <div className="flex flex-col items-center text-center gap-3 px-8 py-8 mt-4 border-t border-[var(--border)]">
                <p className="text-text-muted text-sm max-w-xs">
                  Log in to create synced playlists that follow you to every device.
                </p>
                <button
                  onClick={() => setShowUserAuth(true)}
                  className="h-11 px-6 rounded-full bg-accent/15 text-accent text-[15px] font-semibold active:bg-accent/25"
                >Log in</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )

  // ── Open playlist ─────────────────────────────────────────────────────────

  const renderDetail = (): JSX.Element => {
    if (isLocal && !localPl) { setLocalSelectedId(null); return <div /> }
    const durLabel = totalDurationLabel(tracks)
    const name = isLocal ? (localPl?.name ?? '') : (detail?.name ?? summary?.name ?? null)
    const loading = !isLocal && loadingDetail
    const localCover = localPl?.coverImage ?? null
    const apiCover = playlistCoverUrl(coverData ?? {})
    const hasApiCover = !!apiCover && !coverImgError
    const backdropSrc = isLocal
      ? (localCover ?? localLibTracks.map(t => libraryArt[t.id]).find(a => !!a) ?? null)
      : (apiCover ?? tracks[0]?.imageUrl ?? null)
    // Only actually dark (and so worth white text) when there's a backdrop
    // AND the active skin is a dark one - a light skin's backdrop lightens
    // toward white instead (see HeroBackdrop), which wants the normal
    // dark-on-light text.
    const heroLight = !!backdropSrc && isDarkSkin && playlistHeroEnabled

    const playShuffle = (): void => {
      if (!tracks.length) return
      const shuffled = fisherYates(tracks)
      playTrack(shuffled[0], shuffled)
    }

    return (
      // Hero, app bar and the scrollable list are siblings in one relative
      // root, not the app bar sitting outside the scroller with the hero
      // nested deep inside it (the old shape) - the hero has to be a sibling
      // to bleed *behind* the app bar and up under the status bar, and it
      // can't do that from inside the scroller's own clipped box. App.tsx
      // pulled its usual safe-area padding for this render (see heroActive
      // above), so the app bar pads itself back down to compensate.
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {backdropSrc && playlistHeroEnabled && <HeroBackdrop src={backdropSrc} isDarkSkin={isDarkSkin} />}
        {/* App bar. It deliberately does not collapse in select mode - swapping
            it out mid-long-press moves the list under the finger; the selection
            controls live in the bottom bar instead. */}
        <div
          className="relative shrink-0 flex items-center gap-1 px-2"
          style={{ paddingTop: ownsTopInset ? 'max(0.25rem, var(--top-inset))' : '0.25rem' }}
        >
          <button
            onClick={() => (reorderMode ? setReorderMode(false) : goBackToLibrary())}
            aria-label="Back"
            className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${heroLight ? 'text-white' : 'text-text-primary'}`}
          ><ArrowLeft size={20} /></button>
          <span className={`flex-1 min-w-0 text-[15px] font-semibold truncate ${heroLight ? 'text-white' : 'text-text-primary'}`}>
            {reorderMode ? 'Reorder' : (name ?? '')}
          </span>
          {reorderMode ? (
            <button
              onClick={() => setReorderMode(false)}
              className="px-4 h-10 rounded-full text-accent text-[14px] font-semibold active:bg-accent/10"
            >Done</button>
          ) : (
            <>
              {tracks.length > 0 && appBarButton('Search tracks', <Search size={19} />, () => setSearchOpen(v => !v), searchOpen, heroLight)}
              {appBarButton('Playlist options', <MoreVertical size={19} />, () => setSheet({ kind: 'detail' }), false, heroLight)}
            </>
          )}
        </div>

        <div ref={setListScrollEl} className="relative flex-1 overflow-y-auto overscroll-contain pb-6">
          {/* Hidden file input (API cover upload) */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f); e.target.value = '' }}
          />

          {/* ── Hero. Centred, the way a phone shows an album: the desktop's
              side-by-side 180px cover and text block left ~40% of a phone's
              width for a title that then wrapped anyway. Light-on-dark text
              only when there's art to sit on. ── */}
          <div className="relative px-4 pb-4 overflow-hidden">
            <div className="relative flex flex-col items-center text-center pt-1 pb-4">
              <div className="relative w-44 h-44 rounded-2xl overflow-hidden shadow-2xl bg-surface-overlay">
                {isLocal ? (
                  localCover
                    ? <img src={localCover} alt="" className="w-full h-full object-cover" />
                    : <LocalPlaylistMosaic trackIds={localPl?.trackIds ?? []} className="w-full h-full" />
                ) : loading && tracks.length === 0 ? (
                  <div className="w-full h-full bg-surface-overlay animate-pulse" />
                ) : coverLoading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 size={26} className="text-text-muted opacity-50 animate-spin" />
                  </div>
                ) : hasApiCover ? (
                  <img src={apiCover!} alt="" className="w-full h-full object-cover" onError={() => setCoverImgError(true)} />
                ) : (
                  <PlaylistMosaic tracks={tracks} className="w-full h-full" />
                )}
                {coverUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 size={24} className="text-white animate-spin" />
                  </div>
                )}
              </div>

              <h1 className={`text-[22px] font-bold leading-tight mt-4 line-clamp-2 ${heroLight ? 'text-white' : 'text-text-primary'}`}>
                {name || <span className="bg-white/10 rounded animate-pulse text-transparent select-none">Loading…</span>}
              </h1>
              <p className={`text-xs mt-1.5 ${heroLight ? 'text-white/70' : 'text-text-muted'}`}>
                {isLocal ? 'This device' : (isSharedView ? 'Shared playlist' : account?.discord_username ?? 'Playlist')}
                {!loading && <> · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}{durLabel ? ` · ${durLabel}` : ''}</>}
                {loading && ' · loading…'}
              </p>

              {/* Description - synced playlists only; local ones have no such
                  field to store it in. Tapping it opens the editor sheet. */}
              {!isLocal && (detail?.description ? (
                <button
                  onClick={() => !isSharedView && setPrompt({
                    title: 'Description', initial: detail.description ?? '', multiline: true, allowEmpty: true,
                    placeholder: 'Add a description…', submitLabel: 'Save', onSubmit: saveDescription,
                  })}
                  className={`text-xs mt-2 line-clamp-3 px-2 ${heroLight ? 'text-white/70' : 'text-text-muted'}`}
                >{detail.description}</button>
              ) : !isSharedView && detail ? (
                <button
                  onClick={() => setPrompt({
                    title: 'Description', initial: '', multiline: true, allowEmpty: true,
                    placeholder: 'Add a description…', submitLabel: 'Save', onSubmit: saveDescription,
                  })}
                  className={`text-xs mt-2 italic ${heroLight ? 'text-white/50' : 'text-text-muted'}`}
                >+ Add description</button>
              ) : null)}
            </div>

            {/* `relative` is load-bearing: HeroBackdrop is absolutely
                positioned, so it paints above any *static* sibling no matter
                the DOM order - and the bottom of its gradient is opaque
                --surface, which is exactly where these buttons sit. */}
            <div className="relative">
            <PlayShuffleRow
              onPlay={() => playCollection(tracks)}
              onShuffle={playShuffle}
              disabled={tracks.length === 0}
            />

            {/* Track search - under Play/Shuffle rather than pinned below the
                app bar, so it reads as part of this playlist's controls
                instead of a page-level search. */}
            {searchOpen && !reorderMode && (
              <div className="relative mt-3">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${tracks.length} tracks`}
                  enterKeyHint="search"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="w-full h-11 bg-surface-overlay rounded-full pl-10 pr-10 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-search-cancel-button]:hidden"
                />
                <button
                  onClick={() => { setSearch(''); setSearchOpen(false) }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-text-muted active:text-text-primary"
                  aria-label="Close search"
                ><X size={16} /></button>
              </div>
            )}

            {/* Someone else's playlist: nothing here can be edited, only kept
                around two ways - Follow (a live pointer, always shows the
                owner's current tracks, kept on this device only, no account
                needed) or a one-time copy into your own library below. */}
            {isSharedView && detail && tracks.length > 0 && (
              <button
                onClick={() => {
                  if (isFollowingCurrent) { unfollowPlaylist(detail.id); return }
                  followPlaylist({
                    id: detail.id,
                    name: detail.name,
                    trackCount: detail.items?.length ?? 0,
                    coverUrl: playlistCoverUrl(coverData ?? {}) ?? null,
                  })
                }}
                title={isFollowingCurrent ? 'Unfollow - stop showing this in your Playlists' : 'Follow - always shows the owner\'s current tracks, kept on this device only'}
                className={`w-full h-12 mt-2 flex items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors ${
                  isFollowingCurrent ? 'bg-accent/15 text-accent' : 'bg-surface-raised text-text-primary active:bg-surface-overlay'
                }`}
              >
                {isFollowingCurrent ? <Check size={17} /> : <Rss size={17} />}
                {isFollowingCurrent ? 'Following' : 'Follow'}
              </button>
            )}
            {isSharedView && account && detail && tracks.length > 0 && (
              <button
                onClick={handleImportPlaylist}
                disabled={importState === 'loading' || importState === 'done'}
                className={`w-full h-12 mt-2 flex items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors disabled:opacity-70 ${
                  importState === 'done' ? 'bg-accent/15 text-accent'
                    : importState === 'error' ? 'bg-red-500/15 text-red-400'
                      : 'bg-accent text-white'
                }`}
              >
                {importState === 'loading' ? <Loader2 size={17} className="animate-spin" />
                  : importState === 'done' ? <Check size={17} />
                    : <FolderInput size={17} />}
                {importState === 'loading' ? 'Saving…' : importState === 'done' ? 'Saved to your library' : importState === 'error' ? 'Couldn’t save' : 'Save to my library'}
              </button>
            )}
            </div>
          </div>

          {/* ── Tracks ── */}
          {loading && tracks.length === 0 ? (
            <TrackSkeleton />
          ) : tracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 text-center px-8 py-12">
              <Music2 className="text-text-muted opacity-25" size={38} />
              <p className="text-text-muted text-sm">This playlist is empty.</p>
              <p className="text-text-muted text-xs">
                {isLocal ? 'Add tracks from the Library tab.' : 'Add tracks from the Tracker or Liked Songs.'}
              </p>
            </div>
          ) : reorderMode ? (
            // Not windowed: reordering is a deliberate, short-lived mode, and
            // mounting the rows outright keeps the moved row's position stable
            // under the finger.
            <div className="px-2">
              {tracks.map((t, i) => (
                <ReorderRow
                  key={t.id}
                  title={t.title}
                  dragging={trackDrag.dragIndex === i}
                  style={{ height: trackRowH, ...trackDrag.rowStyle(i) }}
                  handleProps={trackDrag.handleProps(i)}
                />
              ))}
            </div>
          ) : compactView && !isLocal ? (
            loadingCompact ? (
              <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading version groups…</span>
              </div>
            ) : filteredCompactGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <CompactEmptyIcon size={32} className="text-text-muted opacity-30" />
                <p className="text-text-muted text-sm">
                  {compactGroups.length === 0 ? 'No version groups in this playlist' : `No version groups match “${search}”`}
                </p>
              </div>
            ) : (
              <div className="px-2">
                {filteredCompactGroups.map(group => (
                  <div key={group.groupId}>
                    <CompactGroupRow
                      coverTrack={group.members[0].item}
                      title={group.title}
                      count={group.members.length}
                      expanded={expandedGroups.has(group.groupId)}
                      onToggle={() => toggleGroupExpanded(group.groupId)}
                      onPlay={() => playTrack(group.members[0].item, tracks)}
                    />
                    {expandedGroups.has(group.groupId) && (
                      <div className="ml-4 pl-2 border-l border-[var(--border)]">
                        {group.members.map(({ item: track, meta }) => (
                          <div key={track.id} style={{ height: trackRowH }}>
                            <TrackRow
                              track={meta.version ? { ...track, title: `${track.title} (${meta.version})` } : track}
                              current={currentTrack?.id === track.id}
                              selectMode={false}
                              selected={false}
                              onTap={() => playTrack(track, tracks)}
                              onLongPress={() => toggleTrackSelect(track)}
                              onMenu={e => setTrackMenu({ track, songId: userApi.trackIdToSongId(track.id) ?? -1, x: e.clientX, y: e.clientY })}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : displayTracks.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-10">No tracks match “{search}”</p>
          ) : (
            // Windowed rows - absolutely positioned at index * trackRowH inside
            // a container sized to the full list, so only the visible slice is
            // mounted (see useVirtualWindowEl).
            <div ref={setListContentEl} className="px-2" style={{ height: rowsTotalHeight, position: 'relative' }}>
              {displayTracks.slice(rowStart, rowEnd).map((track, sliceIdx) => {
                const idx = rowStart + sliceIdx
                return (
                  <div
                    key={track.id}
                    style={{ position: 'absolute', top: idx * trackRowH, left: 0, right: 0, height: trackRowH }}
                  >
                    <TrackRow
                      track={track}
                      libTrack={isLocal ? localTrackById.get(track.id) : undefined}
                      current={currentTrack?.id === track.id}
                      selectMode={selectMode}
                      selected={selectedTracks.has(track.id)}
                      onTap={() => playTrack(track, displayTracks)}
                      onLongPress={() => toggleTrackSelect(track)}
                      onMenu={e => setTrackMenu({ track, songId: track.id ? (userApi.trackIdToSongId(track.id) ?? -1) : -1, x: e.clientX, y: e.clientY })}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Guest playlist (signed out) ───────────────────────────────────────────

  const renderGuestDetail = (): JSX.Element => {
    const gp = guestPlaylists.find(p => p.id === guestSelectedId)
    if (!gp) { setGuestSelectedId(null); return <div /> }
    const art = gp.tracks.map(t => t.imageUrl).find(a => !!a) ?? null
    // See heroLight in renderDetail - only actually dark (white text) on a
    // dark skin; a light skin's backdrop lightens instead.
    const heroLight = !!art && isDarkSkin && playlistHeroEnabled
    return (
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {art && playlistHeroEnabled && <HeroBackdrop src={art} isDarkSkin={isDarkSkin} />}
        <div
          className="relative shrink-0 flex items-center gap-1 px-2"
          style={{ paddingTop: ownsTopInset ? 'max(0.25rem, var(--top-inset))' : '0.25rem' }}
        >
          <button
            onClick={() => setGuestSelectedId(null)}
            aria-label="Back"
            className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${heroLight ? 'text-white' : 'text-text-primary'}`}
          ><ArrowLeft size={20} /></button>
          <span className={`flex-1 min-w-0 text-[15px] font-semibold truncate ${heroLight ? 'text-white' : 'text-text-primary'}`}>{gp.name}</span>
          {appBarButton('Playlist options', <MoreVertical size={19} />, () => setSheet({ kind: 'guest', id: gp.id }), false, heroLight)}
        </div>

        <div className="relative flex-1 overflow-y-auto overscroll-contain pb-6">
          <div className="relative px-4 pb-4 overflow-hidden">
            <div className="relative flex flex-col items-center text-center pt-1 pb-4">
              <div className="w-44 h-44 rounded-2xl overflow-hidden shadow-2xl bg-surface-overlay">
                <GuestPlaylistMosaic tracks={gp.tracks} className="w-full h-full" />
              </div>
              <h1 className={`text-[22px] font-bold leading-tight mt-4 line-clamp-2 ${heroLight ? 'text-white' : 'text-text-primary'}`}>{gp.name}</h1>
              <p className={`text-xs mt-1.5 ${heroLight ? 'text-white/70' : 'text-text-muted'}`}>
                Not signed in · {gp.tracks.length} {gp.tracks.length === 1 ? 'track' : 'tracks'}
              </p>
            </div>
            {/* relative for the same reason as the synced hero above. */}
            <div className="relative">
              <PlayShuffleRow
                onPlay={() => playCollection(gp.tracks)}
                onShuffle={() => { const sh = fisherYates(gp.tracks); playTrack(sh[0], sh) }}
                disabled={gp.tracks.length === 0}
              />
            </div>
          </div>

          {gp.tracks.length === 0 ? (
            <p className="text-text-muted text-sm px-8 py-10 text-center">
              No songs yet - use a song’s “Add to playlist” menu to add one here.
            </p>
          ) : (
            <div className="px-2">
              {gp.tracks.map(t => (
                <div key={t.id} style={{ height: trackRowH }}>
                  <TrackRow
                    track={t}
                    current={currentTrack?.id === t.id}
                    selectMode={false}
                    selected={false}
                    onTap={() => playTrack(t, gp.tracks)}
                    onLongPress={() => removeFromGuestPlaylist(gp.id, t.id)}
                    onMenu={e => setTrackMenu({ track: t, songId: userApi.trackIdToSongId(t.id), x: e.clientX, y: e.clientY })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Sheets ────────────────────────────────────────────────────────────────

  /** Playlist picker used by every "add these somewhere else" action. */
  const renderPickSheet = (state: Extract<SheetState, { kind: 'pick' }>): JSX.Element => {
    const forSelectedTracks = state.for === 'selectedTracks'
    const forAllTracks = state.for === 'allTracks'
    const source = state.source
    // Targets always match the kind of what's being moved: a local file can't
    // join a synced playlist, and vice versa.
    const kind: 'api' | 'local' = state.for === 'selectedPlaylists'
      ? (selectedPlaylistKind ?? 'api')
      : source
        ? source.kind
        : isLocal ? 'local' : 'api'

    const excludeApi = state.for === 'selectedPlaylists'
      ? (p: PlaylistSummary) => selectedPlaylistKeys.has(`api:${p.id}`)
      : (p: PlaylistSummary) => (source?.kind === 'api' ? p.id === source.playlist.id : p.id === selectedId)
    const excludeLocal = state.for === 'selectedPlaylists'
      ? (p: LocalPlaylist) => selectedPlaylistKeys.has(`local:${p.id}`)
      : (p: LocalPlaylist) => (source?.kind === 'local' ? p.id === source.playlist.id : p.id === localSelectedId)

    const apiTargets = kind === 'api' ? playlists.filter(p => !excludeApi(p)) : []
    const localTargets = kind === 'local' ? localPlaylists.filter(p => !excludeLocal(p)) : []

    const addToApi = async (targetId: number): Promise<void> => {
      if (forSelectedTracks) { await bulkAddToPlaylist(targetId); return }
      if (forAllTracks) {
        if (source?.kind === 'api') {
          const srcDetail = await userApi.getPlaylist(source.playlist.id)
          await handleAddAllTo(targetId, srcDetail)
        } else if (detail) {
          await handleAddAllTo(targetId, detail)
        }
        return
      }
      await bulkAddPlaylistsTo({ kind: 'api', id: targetId })
    }
    const addToLocal = (targetId: string): void => {
      if (forSelectedTracks) { bulkAddToLocalPlaylist(targetId); return }
      if (forAllTracks) {
        const src = source?.kind === 'local' ? source.playlist.trackIds : localLibTracks.map(t => t.id)
        src.forEach(id => addToLocalPlaylist(targetId, id))
        return
      }
      bulkAddPlaylistsTo({ kind: 'local', id: targetId })
    }

    return (
      <Sheet onClose={closeSheet} title="Add to playlist">
        {apiTargets.length === 0 && localTargets.length === 0 && (
          <p className="px-5 py-3 text-text-muted text-sm">No other playlist to add to.</p>
        )}
        {apiTargets.map(p => (
          <SheetItem
            key={p.id}
            icon={ListMusic}
            label={p.name}
            sub={`${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
            onClick={() => { addToApi(p.id); closeSheet() }}
          />
        ))}
        {localTargets.map(p => (
          <SheetItem
            key={p.id}
            icon={HardDrive}
            label={p.name}
            sub={`${p.trackIds.length} ${p.trackIds.length === 1 ? 'track' : 'tracks'}`}
            onClick={() => { addToLocal(p.id); closeSheet() }}
          />
        ))}
        {forSelectedTracks && (
          <>
            <SheetDivider />
            <SheetItem
              icon={bulkCreating ? Loader2 : Plus}
              label="New playlist…"
              onClick={() => {
                closeSheet()
                setPrompt({
                  title: 'New playlist', initial: '', placeholder: 'Playlist name', submitLabel: 'Create and add',
                  onSubmit: v => { bulkCreateAndAddToPlaylist(v) },
                })
              }}
            />
          </>
        )}
      </Sheet>
    )
  }

  const renderFolderPickSheet = (keys: string[]): JSX.Element => {
    const currentFolderId = keys.length === 1 ? (folderOfPlaylist(playlistFolders, keys[0])?.id ?? null) : null
    return (
      <Sheet onClose={closeSheet} title="Move to folder">
        {playlistFolders.map(f => (
          <SheetItem
            key={f.id}
            icon={Folder}
            label={f.name}
            active={currentFolderId === f.id}
            trailing={currentFolderId === f.id ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => { movePlaylistsToFolder(keys, f.id); exitPlaylistSelectMode(); closeSheet() }}
          />
        ))}
        {currentFolderId && (
          <SheetItem
            icon={FolderMinus}
            label="Remove from folder"
            danger
            onClick={() => { movePlaylistsToFolder(keys, null); exitPlaylistSelectMode(); closeSheet() }}
          />
        )}
        <SheetDivider />
        <SheetItem
          icon={FolderPlus}
          label="New folder…"
          onClick={() => {
            closeSheet()
            setPrompt({
              title: 'New folder', initial: uniqueFolderName(), placeholder: 'Folder name', submitLabel: 'Create',
              onSubmit: v => {
                const id = createFolder(v, keys)
                if (id) setExpandedFolders(prev => new Set(prev).add(id))
                exitPlaylistSelectMode()
              },
            })
          }}
        />
      </Sheet>
    )
  }

  const renderCardSheet = (target: CardTarget): JSX.Element => {
    const isApi = target.kind === 'api'
    const pl = target.playlist
    const key = isApi ? `api:${pl.id}` : `local:${pl.id}`
    const localTracksOf = (lp: LocalPlaylist): Track[] =>
      lp.trackIds.map(id => libraryTracks.find(t => t.id === id)).filter((t): t is LibraryTrack => !!t).map(libTrackToTrack)

    return (
      <Sheet onClose={closeSheet} title={pl.name}>
        <SheetItem
          icon={Play}
          label="Play"
          onClick={async () => {
            closeSheet()
            if (target.kind === 'local') { const q = localTracksOf(target.playlist); if (q.length) playCollection(q); return }
            const d = await userApi.getPlaylist(target.playlist.id).catch(() => null)
            const trks = d ? d.items.map(i => userApi.liteSongToTrack(i.song)) : []
            if (trks.length) playCollection(trks)
          }}
        />
        <SheetItem
          icon={Shuffle}
          label="Shuffle"
          onClick={async () => {
            closeSheet()
            const q = target.kind === 'local'
              ? localTracksOf(target.playlist)
              : (await userApi.getPlaylist(target.playlist.id).catch(() => null))?.items.map(i => userApi.liteSongToTrack(i.song)) ?? []
            if (!q.length) return
            const sh = fisherYates(q)
            playTrack(sh[0], sh)
          }}
        />
        <SheetItem
          icon={ListEnd}
          label="Add all to queue"
          onClick={async () => {
            closeSheet()
            const q = target.kind === 'local'
              ? localTracksOf(target.playlist)
              : (await userApi.getPlaylist(target.playlist.id).catch(() => null))?.items.map(i => userApi.liteSongToTrack(i.song)) ?? []
            q.forEach(t => addToQueue(t))
          }}
        />
        <SheetItem
          icon={FolderInput}
          label="Add all to another playlist"
          onClick={() => setSheet({ kind: 'pick', for: 'allTracks', source: target })}
        />
        <SheetDivider />
        <SheetItem
          icon={Pencil}
          label="Rename"
          onClick={() => {
            closeSheet()
            setPrompt({
              title: 'Rename playlist', initial: pl.name, submitLabel: 'Save',
              onSubmit: async v => {
                if (target.kind === 'local') { renameLocalPlaylist(target.playlist.id, v); return }
                await userApi.renamePlaylist(target.playlist.id, v).catch(() => {})
                await refreshPlaylists()
              },
            })
          }}
        />
        <SheetItem icon={Folder} label="Move to folder" onClick={() => setSheet({ kind: 'moveToFolder', keys: [key] })} />
        {isApi && (
          <>
            <SheetItem
              icon={Link}
              label="Copy share link"
              onClick={async () => {
                closeSheet()
                try {
                  const p = target.playlist as PlaylistSummary
                  if (!p.is_public) { await userApi.updatePlaylist(p.id, { is_public: true }); await refreshPlaylists() }
                  await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${p.id}&view=shared`)
                } catch {}
              }}
            />
            <SheetItem
              icon={(target.playlist as PlaylistSummary).is_public ? Globe : Lock}
              label={(target.playlist as PlaylistSummary).is_public ? 'Make private' : 'Make public'}
              onClick={async () => {
                closeSheet()
                const p = target.playlist as PlaylistSummary
                await userApi.updatePlaylist(p.id, { is_public: !p.is_public }).catch(() => {})
                await refreshPlaylists()
              }}
            />
            <SheetItem
              icon={Archive}
              label="Download all"
              onClick={async () => {
                closeSheet()
                const d = await userApi.getPlaylist((target.playlist as PlaylistSummary).id).catch(() => null)
                if (d) handleZipDownload(d.items.map(i => userApi.liteSongToTrack(i.song)), pl.name)
              }}
            />
          </>
        )}
        <SheetDivider />
        <SheetItem
          icon={Trash2}
          label="Delete playlist"
          danger
          onClick={async () => {
            closeSheet()
            if (target.kind === 'local') {
              deleteLocalPlaylist(target.playlist.id)
              if (localSelectedId === target.playlist.id) setLocalSelectedId(null)
              return
            }
            const id = target.playlist.id
            await userApi.deletePlaylist(id).catch(() => {})
            if (selectedId === id) setSelectedId(null)
            await refreshPlaylists()
          }}
        />
      </Sheet>
    )
  }

  const renderDetailSheet = (): JSX.Element => {
    const name = isLocal ? (localPl?.name ?? '') : (detail?.name ?? summary?.name ?? '')
    const hasApiCover = !!playlistCoverUrl(coverData ?? {}) && !coverImgError
    return (
      <Sheet onClose={closeSheet} title={name}>
        <SheetItem
          icon={ArrowUpDown}
          label="Sort"
          sub={sort.field === 'default' ? 'Playlist order' : `${sort.field} · ${sort.dir === 'asc' ? 'A–Z' : 'Z–A'}`}
          onClick={() => setSheet({ kind: 'sort' })}
        />
        {!isSharedView && (
          <SheetItem
            icon={ListMusic}
            label="Reorder tracks"
            sub={canReorder ? undefined : 'Clear the search and sort first'}
            disabled={!canReorder || tracks.length < 2}
            onClick={() => { setReorderMode(true); closeSheet() }}
          />
        )}
        {versionsEnabled && !isLocal && (
          <SheetItem
            icon={Layers}
            label="Group versions"
            active={compactView}
            trailing={compactView ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => { setCompactView(v => !v); clearExpandedGroups(); closeSheet() }}
          />
        )}
        <SheetItem
          icon={FolderInput}
          label="Add all to another playlist"
          disabled={addingAll || tracks.length === 0}
          onClick={() => setSheet({ kind: 'pick', for: 'allTracks' })}
        />
        {!isSharedView && (
          <>
            <SheetDivider />
            <SheetItem
              icon={Pencil}
              label="Rename"
              onClick={() => {
                closeSheet()
                setPrompt({ title: 'Rename playlist', initial: name, submitLabel: 'Save', onSubmit: renameSelected })
              }}
            />
            {!isLocal && (
              <>
                <SheetItem
                  icon={AlignLeft}
                  label="Edit description"
                  onClick={() => {
                    closeSheet()
                    setPrompt({
                      title: 'Description', initial: detail?.description ?? '', multiline: true, allowEmpty: true,
                      placeholder: 'Add a description…', submitLabel: 'Save', onSubmit: saveDescription,
                    })
                  }}
                />
                <SheetItem icon={ImageIcon} label="Change cover" onClick={() => { closeSheet(); coverInputRef.current?.click() }} />
                {hasApiCover && (
                  <SheetItem icon={ImageOff} label="Remove cover" onClick={() => { closeSheet(); handleRemoveCover() }} />
                )}
              </>
            )}
            {isLocal && localPl?.coverImage && (
              <SheetItem
                icon={ImageOff}
                label="Remove cover"
                onClick={() => { closeSheet(); if (localPl) updateLocalPlaylist(localPl.id, { coverImage: null }) }}
              />
            )}
          </>
        )}
        {!isLocal && (
          <>
            <SheetDivider />
            <SheetItem
              icon={zipState === 'loading' ? Loader2 : Archive}
              label={zipState === 'error' ? 'Download failed' : zipState === 'done' ? 'Download started' : 'Download all'}
              disabled={zipState === 'loading' || tracks.length === 0}
              onClick={() => { handleZipDownload(tracks, name || 'playlist'); closeSheet() }}
            />
            <SheetItem
              icon={Download}
              label="Export playlist"
              disabled={tracks.length === 0}
              trailing={<ChevronRight size={17} className="text-text-muted shrink-0" />}
              onClick={() => setSheet({ kind: 'export' })}
            />
            {!isSharedView && (
              <>
                <SheetItem
                  icon={shareCopied ? Check : Link}
                  label={shareCopied ? 'Link copied' : 'Copy share link'}
                  disabled={tracks.length === 0}
                  onClick={() => { handleShare(); closeSheet() }}
                />
                <SheetItem
                  icon={detail?.is_public ? Globe : Lock}
                  label={detail?.is_public ? 'Make private' : 'Make public'}
                  disabled={togglingPublic}
                  onClick={() => { handleTogglePublic(); closeSheet() }}
                />
              </>
            )}
          </>
        )}
        {!isSharedView && (
          <>
            <SheetDivider />
            <SheetItem icon={Trash2} label="Delete playlist" danger onClick={() => { closeSheet(); deleteSelected() }} />
          </>
        )}
      </Sheet>
    )
  }

  const SORT_OPTIONS: { field: SortField; label: string }[] = [
    { field: 'default', label: 'Playlist order' },
    { field: 'title', label: 'Title' },
    { field: 'artist', label: 'Artist' },
    { field: 'duration', label: 'Duration' },
  ]

  // ── One tree ──────────────────────────────────────────────────────────────

  const inDetail = selectedId != null || localSelectedId !== null

  // A playlist's own cover is worth bleeding under the status bar for (see
  // renderDetail/renderGuestDetail's HeroBackdrop) - the plain library browse
  // list isn't, so this only raises the shell's shared heroBleedTop flag
  // while an actual detail screen is open, and always drops it again on the
  // way out (unmount included, via the effect cleanup) so the flag can't get
  // stuck on after navigating elsewhere.
  const heroActive = inDetail || guestSelectedId !== null
  useEffect(() => {
    setHeroBleedTop(heroActive)
    return () => setHeroBleedTop(false)
  }, [heroActive, setHeroBleedTop])
  // Matches WRLD's own ownsTopInset. Always true: mobile's nav bar is
  // bottom-only now (see BottomNav), so the shell always reserves this inset
  // itself and the hero always has something to compensate for.
  const ownsTopInset = true

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {showLiked ? (
        <>
          <div className="shrink-0 flex items-center gap-1 px-2">
            <button
              onClick={() => setShowLiked(false)}
              aria-label="Back"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
            ><ArrowLeft size={20} /></button>
            <span className="flex-1 min-w-0 text-text-primary text-[15px] font-semibold truncate">Liked Songs</span>
          </div>
          <LikedSongsView />
        </>
      ) : donorSelectedId !== null ? <DonorPlaylistDetail id={donorSelectedId} onBack={() => setDonorSelectedId(null)} />
        : guestSelectedId !== null ? renderGuestDetail()
        : inDetail ? renderDetail()
          : renderLibrary()}

      {/* ── Track selection bar ── */}
      {selectMode && inDetail && (
        <div className="shrink-0 border-t border-[var(--border)]">
          <div className="flex items-center gap-1 pl-1 pr-2 pt-1">
            <button
              onClick={exitSelectMode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
              aria-label="Cancel selection"
            ><X size={19} /></button>
            <span className="flex-1 min-w-0 text-text-primary font-semibold text-[15px] truncate">{selectedTracks.size} selected</span>
            <button
              onClick={() => setSelectedTracks(new Map(displayTracks.map(t => [t.id, t])))}
              className="px-3 h-10 rounded-full text-accent text-[13px] font-semibold active:bg-accent/10"
            >Select all</button>
          </div>
          <div className="flex items-stretch px-2 py-1.5">
            {([
              { key: 'queue', icon: ListPlus, label: 'Queue', onClick: bulkAddToQueue },
              { key: 'add', icon: Plus, label: 'Add to', onClick: () => setSheet({ kind: 'pick', for: 'selectedTracks' }) },
              { key: 'remove', icon: Trash2, label: 'Remove', hidden: isSharedView, onClick: bulkRemove },
              { key: 'more', icon: MoreVertical, label: 'More', onClick: () => setSheet({ kind: 'bulkTracks' }) },
            ] as const).filter(a => !('hidden' in a && a.hidden)).map(action => (
              <button
                key={action.key}
                onClick={action.onClick}
                disabled={selectedTracks.size === 0 || (action.key === 'remove' && bulkRemoving)}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-text-primary disabled:opacity-35 active:bg-surface-overlay"
              >
                {action.key === 'remove' && bulkRemoving
                  ? <Loader2 size={20} className="animate-spin" />
                  : <action.icon size={20} />}
                <span className="text-[11px] font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Playlist selection bar ── */}
      {plSelectMode && !inDetail && !showLiked && (
        <div className="shrink-0 border-t border-[var(--border)]">
          <div className="flex items-center gap-1 pl-1 pr-2 pt-1">
            <button
              onClick={exitPlaylistSelectMode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
              aria-label="Cancel selection"
            ><X size={19} /></button>
            <span className="flex-1 min-w-0 text-text-primary font-semibold text-[15px] truncate">{selectedPlaylistKeys.size} selected</span>
            <button
              onClick={() => setSelectedPlaylistKeys(new Set([
                ...playlists.map(p => `api:${p.id}`),
                ...localPlaylists.map(lp => `local:${lp.id}`),
              ]))}
              className="px-3 h-10 rounded-full text-accent text-[13px] font-semibold active:bg-accent/10"
            >Select all</button>
          </div>
          <div className="flex items-stretch px-2 py-1.5">
            <button
              onClick={() => setSheet({ kind: 'pick', for: 'selectedPlaylists' })}
              disabled={!selectedPlaylistKind || bulkAddingPlaylists}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-text-primary disabled:opacity-35 active:bg-surface-overlay"
            >
              {bulkAddingPlaylists ? <Loader2 size={20} className="animate-spin" /> : <FolderInput size={20} />}
              <span className="text-[11px] font-medium">Merge into</span>
            </button>
            <button
              onClick={() => setSheet({ kind: 'moveToFolder', keys: [...selectedPlaylistKeys] })}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-text-primary active:bg-surface-overlay"
            >
              <Folder size={20} />
              <span className="text-[11px] font-medium">Folder</span>
            </button>
            <button
              onClick={bulkDeletePlaylists}
              disabled={bulkDeletingPlaylists}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-red-400 disabled:opacity-35 active:bg-surface-overlay"
            >
              {bulkDeletingPlaylists ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
              <span className="text-[11px] font-medium">Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Sheets ── */}
      {sheet?.kind === 'create' && (
        <Sheet onClose={closeSheet} title="Create">
          {/* Signed out this makes a guest playlist instead of a synced one -
              same button, same prompt. The old UI put those behind a separate
              "New Playlist" control that only existed on the logged-out
              screen, so the action moved when you signed in. */}
          <SheetItem
            icon={ListMusic}
            label="New playlist"
            sub={account ? 'Synced to your account' : 'Kept on this device - sign in to sync it'}
            onClick={() => {
              closeSheet()
              setPrompt({
                title: 'New playlist', initial: '', placeholder: 'Playlist name', submitLabel: 'Create',
                onSubmit: v => { if (account) createPlaylist(v); else createGuestPlaylist(v) },
              })
            }}
          />
          <SheetItem
            icon={FolderPlus}
            label="New folder"
            sub="Group playlists together on this device"
            onClick={() => {
              closeSheet()
              setPrompt({
                title: 'New folder', initial: '', placeholder: 'Folder name', submitLabel: 'Create',
                onSubmit: v => { const id = createFolder(v); if (id) setExpandedFolders(prev => new Set(prev).add(id)) },
              })
            }}
          />
        </Sheet>
      )}

      {sheet?.kind === 'card' && renderCardSheet(sheet.target)}
      {sheet?.kind === 'pick' && renderPickSheet(sheet)}
      {sheet?.kind === 'moveToFolder' && renderFolderPickSheet(sheet.keys)}
      {sheet?.kind === 'detail' && renderDetailSheet()}

      {sheet?.kind === 'export' && (
        <Sheet onClose={closeSheet} title="Export playlist">
          <SheetItem
            label="As JSON"
            onClick={() => { handleExportJson(isLocal ? (localPl?.name ?? '') : (detail?.name ?? summary?.name ?? '')); closeSheet() }}
          />
          <SheetItem
            label="As M3U"
            onClick={() => { handleExportM3u(tracks, isLocal ? (localPl?.name ?? '') : (detail?.name ?? summary?.name ?? '')); closeSheet() }}
          />
        </Sheet>
      )}

      {sheet?.kind === 'folder' && (
        <Sheet onClose={closeSheet} title={sheet.folder.name}>
          <SheetItem
            icon={Pencil}
            label="Rename folder"
            onClick={() => {
              const f = sheet.folder
              closeSheet()
              setPrompt({ title: 'Rename folder', initial: f.name, submitLabel: 'Save', onSubmit: v => renameFolder(f.id, v) })
            }}
          />
          {/* Deleting a folder only ungroups its playlists - they return to the
              sections above, nothing is removed. */}
          <SheetItem
            icon={Trash2}
            label="Delete folder"
            sub="The playlists inside are kept"
            danger
            onClick={() => { deleteFolder(sheet.folder.id); closeSheet() }}
          />
        </Sheet>
      )}

      {sheet?.kind === 'guest' && (() => {
        const gp = guestPlaylists.find(p => p.id === sheet.id)
        if (!gp) return null
        return (
          <Sheet onClose={closeSheet} title={gp.name}>
            <SheetItem icon={Play} label="Play" disabled={!gp.tracks.length} onClick={() => { playCollection(gp.tracks); closeSheet() }} />
            <SheetItem
              icon={Shuffle}
              label="Shuffle"
              disabled={gp.tracks.length < 2}
              onClick={() => { const sh = fisherYates(gp.tracks); playTrack(sh[0], sh); closeSheet() }}
            />
            <SheetDivider />
            <SheetItem
              icon={Pencil}
              label="Rename"
              onClick={() => {
                closeSheet()
                setPrompt({ title: 'Rename playlist', initial: gp.name, submitLabel: 'Save', onSubmit: v => renameGuestPlaylist(gp.id, v) })
              }}
            />
            <SheetItem
              icon={Trash2}
              label="Delete playlist"
              danger
              onClick={() => { deleteGuestPlaylist(gp.id); setGuestSelectedId(null); closeSheet() }}
            />
          </Sheet>
        )
      })()}

      {sheet?.kind === 'sort' && (
        <Sheet onClose={closeSheet} title="Sort tracks by">
          {SORT_OPTIONS.map(o => (
            <SheetItem
              key={o.field}
              label={o.label}
              active={sort.field === o.field}
              trailing={sort.field === o.field ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => setSort({ field: o.field, dir: sort.dir })}
            />
          ))}
          <SheetDivider />
          <SheetItem
            icon={ChevronUp}
            label="Ascending"
            active={sort.dir === 'asc'}
            disabled={sort.field === 'default'}
            trailing={sort.dir === 'asc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSort({ ...sort, dir: 'asc' })}
          />
          <SheetItem
            icon={ChevronDown}
            label="Descending"
            active={sort.dir === 'desc'}
            disabled={sort.field === 'default'}
            trailing={sort.dir === 'desc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSort({ ...sort, dir: 'desc' })}
          />
        </Sheet>
      )}

      {sheet?.kind === 'bulkTracks' && (
        <Sheet onClose={closeSheet} title={`${selectedTracks.size} ${selectedTracks.size === 1 ? 'track' : 'tracks'} selected`}>
          <SheetItem icon={Play} label="Play these tracks" onClick={() => { playCollection(selectedTrackList); exitSelectMode(); closeSheet() }} />
          <SheetItem
            icon={Shuffle}
            label="Shuffle these tracks"
            onClick={() => { const sh = fisherYates(selectedTrackList); playTrack(sh[0], sh); exitSelectMode(); closeSheet() }}
          />
          <SheetItem icon={ListPlus} label="Add to queue" onClick={() => { bulkAddToQueue(); closeSheet() }} />
          <SheetItem icon={Plus} label="Add to playlist" onClick={() => setSheet({ kind: 'pick', for: 'selectedTracks' })} />
          {!isSharedView && (
            <>
              <SheetDivider />
              <SheetItem icon={Trash2} label="Remove from this playlist" danger onClick={() => { bulkRemove(); closeSheet() }} />
            </>
          )}
          <SheetDivider />
          <SheetItem icon={X} label="Clear selection" onClick={() => { exitSelectMode(); closeSheet() }} />
        </Sheet>
      )}

      {prompt && <PromptSheet config={prompt} onClose={() => setPrompt(null)} />}

      {trackMenu && (
        <SongContextMenu
          state={trackMenu}
          onClose={() => setTrackMenu(null)}
          canEdit={canEdit}
          onInfo={() => { const sid = trackMenu.songId ?? userApi.trackIdToSongId(trackMenu.track.id); if (sid && sid > 0) openSongInfo(sid) }}
          onPlay={() => playTrack(trackMenu.track, displayTracks.length ? displayTracks : [trackMenu.track])}
          onPlayNext={() => playNext(trackMenu.track)}
          onAddToQueue={() => addToQueue(trackMenu.track)}
          onSelect={inDetail ? () => toggleTrackSelect(trackMenu.track) : undefined}
          liked={likedTrackIds.includes(trackMenu.track.id)}
          onToggleLike={() => toggleLike(trackMenu.track.id)}
          removeAction={
            guestSelectedId !== null
              ? { label: 'Remove from playlist', onClick: () => removeFromGuestPlaylist(guestSelectedId, trackMenu.track.id) }
              : (inDetail && !isSharedView)
                ? { label: 'Remove from playlist', onClick: () => removeTrack(trackMenu.track) }
                : undefined
          }
        />
      )}

      <SongInfoModal
        song={infoSong}
        onClose={() => setInfoSong(null)}
        onEdit={canEdit ? (songId) => { setInfoSong(null); setPendingEditorSongId(songId); setActiveView('editor') } : undefined}
      />
    </div>
  )
}
