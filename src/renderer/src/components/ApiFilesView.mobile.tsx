import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Folder, Music2, ChevronRight, ChevronDown, ArrowLeft, Play, Loader2,
  ImageIcon, Video, Download, ArrowUp, ArrowDown, Link, Check, Info, ListPlus,
  Heart, X, Pencil, PackageOpen, Search, Filter, MoreHorizontal, Clipboard, Plus,
  ListMusic, Replace, Trash2, LayoutGrid, LayoutList, FileQuestion, Home,
  CheckCircle2, Circle, SlidersHorizontal, Radio, Sparkles,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { useTrackChannel } from '../hooks/useTrackChannel'
import {
  apiFetch,
  buildStreamUrl,
  buildCoverArtUrl,
  smallCoverUrl,
  apiFileTrackId,
  JWApiFileEntry,
  JWApiPaginatedResponse,
  JWApiSong,
} from '../lib/juicewrldApi'
import { getFileExt, getMediaType } from '../lib/fileTypes'
import { formatBytes } from '../lib/format'
import { registerBackHandler } from '../lib/backHandlers'
import {
  breadcrumbs, parentFolder, fileToTrack, sortEntries, fileEntryLinkUrl, findSongByFilename, triggerDownload,
  type ViewMode, type SortBy, type SortDir,
} from '../lib/apiFilesShared'
import { startCdnFileDownload } from '../hooks/useCdnFileDownload'
import { CdnDownloadToastMobile } from './CdnDownloadToast'
import { SearchHelpButton } from './SearchHelpPopover'
import { useApiFilesBrowse } from '../hooks/useApiFilesBrowse'
import { useApiFilesZip } from '../hooks/useApiFilesZip'
import { useTrackerMatches } from '../hooks/useTrackerMatches'
import { useAddFileToPlaylist } from '../hooks/useAddFileToPlaylist'
import { usePlayFileEntry } from '../hooks/usePlayFileEntry'
import { useFileLightbox } from '../hooks/useFileLightbox'
import { usePendingCompGhosts } from '../hooks/usePendingCompGhosts'
import { PendingGhostItem, PendingMarker } from './PendingCompGhost'
import { ProgressiveCover } from './ProgressiveCover'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import MediaLightbox from './MediaLightbox'
import SongInfoModal from './SongInfoModal'
import { clickable } from '../lib/a11y'
import { LazyImg } from './LazyImg'
import { BackButton, BarButton, LargeTitle } from './mobile/NavBar'
import { SearchField, SearchFieldButton } from './mobile/SearchField'

// ─── Files ────────────────────────────────────────────────────────────────────
// Phone-first file browser over the API's /files/* endpoints. The data layer
// (browse + stale-while-revalidate cache, recursive search, ZIP jobs, Tracker
// matching, playlists/likes, contributor proposals) is unchanged from the
// desktop build - everything the user actually touches is not:
//
//   · no hover: every action has a permanent, thumb-sized control
//   · context menus, sorting and folder-jumping are bottom sheets, not
//     pointer-anchored popups
//   · long-press starts a selection the way a phone file manager does, and
//     hardware back walks up the folder tree instead of leaving the tab
//
// The desktop `md:` variants are gone rather than hidden: this branch only
// ships the APK, so a second layout in here would be dead weight nobody sees.

type MediaFilter = 'all' | 'audio' | 'image' | 'video'
/** Which bottom sheet is up (at most one at a time). */
type SheetKind = 'actions' | 'sort' | 'path' | 'channel' | null

const LS_SORT_BY = 'api-files:sortBy'
const LS_SORT_DIR = 'api-files:sortDir'
const LS_VIEW_MODE = 'api-files:viewMode'
const LS_TYPE_FILTER = 'api-files:typeFilter'

const LONG_PRESS_MS = 420
/** Finger slop before a long-press is treated as a scroll instead. */
const LONG_PRESS_SLOP = 10

const MEDIA_FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'audio', label: 'Audio' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
]

const SORT_LABELS: Record<SortBy, string> = { name: 'Name', type: 'Type', size: 'Size' }

/** Short second line under a row's name: "MP3 · 8.2 MB", or the folder it
 *  lives in while searching (results come from the whole tree). */
function metaLine(entry: JWApiFileEntry, showParent: boolean): string {
  if (showParent) return parentFolder(entry.path) || 'Root'
  if (entry.type === 'directory') return 'Folder'
  const ext = getFileExt(entry.name).slice(1).toUpperCase()
  const size = entry.size != null ? formatBytes(entry.size) : ''
  return [ext, size].filter(Boolean).join(' · ')
}

// ─── Thumbnails ───────────────────────────────────────────────────────────────

function Thumb({ entry, size, rounded = 'rounded-lg' }: {
  entry: JWApiFileEntry
  size: number
  rounded?: string
}): JSX.Element {
  const activeChannel = useStore((s) => s.activeChannel)
  const [errored, setErrored] = useState(false)
  const mt = entry.type === 'directory' ? 'folder' : getMediaType(entry.name)
  const box = `flex items-center justify-center bg-[var(--fill)] ${rounded}`

  if (mt === 'folder') {
    return (
      <div className={box} style={{ width: size, height: size }}>
        <Folder size={size * 0.5} className="text-accent" fill="currentColor" fillOpacity={0.15} />
      </div>
    )
  }
  if (!errored && (mt === 'audio' || mt === 'image')) {
    return (
      <LazyImg
        // Audio takes the API's rendered cover; images are served whole by
        // /files/download/, so a folder of art would be hundreds of KB per row
        // at full size - thumbnails take the degraded copy, the lightbox still
        // opens the original.
        src={mt === 'audio' ? buildCoverArtUrl(entry.path, true, activeChannel) : smallCoverUrl(buildStreamUrl(entry.path, activeChannel))}
        alt=""
        className={`${rounded} object-cover bg-surface-overlay`}
        style={{ width: size, height: size }}
        onError={() => setErrored(true)}
      />
    )
  }
  const Icon = mt === 'audio' ? Music2 : mt === 'image' ? ImageIcon : mt === 'video' ? Video : FileQuestion
  return (
    <div className={box} style={{ width: size, height: size }}>
      <Icon size={size * 0.45} className="text-text-muted" />
    </div>
  )
}

/** Three animated bars marking the row you're currently hearing. */
function EqBars({ paused }: { paused: boolean }): JSX.Element {
  return (
    <span className="flex items-end gap-[2px] h-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] h-full rounded-full bg-accent ${paused ? '' : 'eq-bar'}`}
          style={{ animationDelay: `${i * 0.18}s`, transform: paused ? 'scaleY(0.4)' : undefined }}
        />
      ))}
    </span>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function ApiFilesView(): JSX.Element {
  const {
    playTrack, addToQueue, apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath,
    account, setActiveView, setPendingEditorSongId, setPendingCompProposal, likedTrackIds,
    toggleLike, playlists, refreshPlaylists, setShowUserAuth, currentTrack, isPlaying,
    channels, activeChannel, setActiveChannel, loadChannels,
  } = useStorePick(
    'playTrack', 'addToQueue', 'apiFilesPath', 'setApiFilesPath', 'apiFilesLastPath', 'setApiFilesLastPath',
    'account', 'setActiveView', 'setPendingEditorSongId', 'setPendingCompProposal', 'likedTrackIds',
    'toggleLike', 'playlists', 'refreshPlaylists', 'setShowUserAuth', 'currentTrack', 'isPlaying',
    'channels', 'activeChannel', 'setActiveChannel', 'loadChannels')
  const isPrimary = isPrimaryChannelSlug(channels, activeChannel)
  const { trackChannel, channelsReady, resolveTrackChannel } = useTrackChannel()
  // Bails rather than guessing: writing an id built from an unknown channel is
  // what orphans a like. The affordances below are disabled until the list is
  // known, so the id written here always matches the one just rendered.
  const toggleApiFileLike = async (path: string): Promise<void> => {
    const ch = await resolveTrackChannel()
    if (ch === null) return
    toggleLike(apiFileTrackId(path, ch))
  }
  const canEdit = userApi.isChannelEditor(account, activeChannel, isPrimary)
  const canPropose = userApi.isChannelContributor(account, activeChannel, isPrimary)
  // Set lookup for the per-row liked check - .includes on the array made the
  // listing O(rows × likes).
  const likedSet = useMemo(() => new Set(likedTrackIds), [likedTrackIds])

  const [toast, setToast] = useState<string | null>(null)
  const [infoSong, setInfoSong] = useState<JWApiSong | null>(null)

  // Sheets. `sheetEntry` is the row the actions sheet was opened for;
  // `sheetPage` is its sub-page (the playlist picker drills in rather than
  // opening a second layer on top).
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [sheetEntry, setSheetEntry] = useState<JWApiFileEntry | null>(null)
  const [sheetPage, setSheetPage] = useState<'main' | 'playlists'>('main')

  // Multi-select
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // Persisted view settings
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => (localStorage.getItem(LS_VIEW_MODE) as ViewMode) || 'list'
  )
  const [sortBy, setSortByState] = useState<SortBy>(
    () => (localStorage.getItem(LS_SORT_BY) as SortBy) || 'name'
  )
  const [sortDir, setSortDirState] = useState<SortDir>(
    () => (localStorage.getItem(LS_SORT_DIR) as SortDir) || 'asc'
  )
  const [typeFilter, setTypeFilterState] = useState<MediaFilter>(
    () => (localStorage.getItem(LS_TYPE_FILTER) as MediaFilter) || 'all'
  )

  const setViewMode = (v: ViewMode): void => { setViewModeState(v); localStorage.setItem(LS_VIEW_MODE, v) }
  const setSortBy = (v: SortBy): void => { setSortByState(v); localStorage.setItem(LS_SORT_BY, v) }
  const setSortDir = (v: SortDir): void => { setSortDirState(v); localStorage.setItem(LS_SORT_DIR, v) }
  const setTypeFilter = (v: MediaFilter): void => { setTypeFilterState(v); localStorage.setItem(LS_TYPE_FILTER, v) }

  const scrollRef = useRef<HTMLDivElement>(null)

  const showToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800)
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  // Data layer (browse/history/search/channel-switch) - shared with the
  // desktop build, see useApiFilesBrowse. Mobile's only addition is
  // scrolling the listing back to top on every navigate() call.
  const onNavigateStart = useCallback(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [])
  const {
    currentPath, entries, loading, error, history, setHistory, navigate, goBack, goHome, onChannelChange,
    search, setSearch, debouncedSearch, setDebouncedSearch, searchResults, searchTotal, searchFuzzy, prefetchSearchIndex,
    searchLoading, isSearching, searchInFolder, setSearchInFolder,
  } = useApiFilesBrowse({
    activeChannel, setActiveChannel, channels, loadChannels,
    apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath,
    onNavigateStart,
  })

  // Whether a file has a matching song in the Tracker - resolved lazily per
  // path when its sheet opens (not for every row up front) so the Tracker-only
  // actions can be hidden for files with no match instead of doing nothing.
  // undefined = not looked up yet, null = looked up, no match.
  const { trackerMatches, resolveTrackerMatch } = useTrackerMatches()
  const { playlistDoneId, addToPlaylist, resetPlaylistDone } = useAddFileToPlaylist()
  const { playing, handlePlay } = usePlayFileEntry(entries, playTrack)
  const { lightboxItems, lightboxIndex, setLightboxIndex, openLightbox } = useFileLightbox({ entries, searchResults, isSearching, activeChannel })
  const { zipStatus, zipProgress, resetZip, downloadZip, downloadFolder } = useApiFilesZip({
    activeChannel,
    useCdn: isPrimary,
    getSelectedEntries: () => filteredEntries.filter((e) => selectedPaths.has(e.path)),
  })

  const exitSelectMode = useCallback((): void => {
    setSelectMode(false)
    setSelectedPaths(new Set())
    resetZip()
  }, [resetZip])

  // Hardware back, in the order a file manager should undo things: leave the
  // selection, drop the search, then walk up one folder. Returning false at
  // the root hands the press back to the app-level handler (which switches
  // views), so back never gets stuck in here.
  //
  // Registered exactly once and kept current through a ref: handlers run
  // last-registered-first, so re-registering on every state change would keep
  // moving this one to the top of the stack and let it steal presses from a
  // sheet that opened earlier.
  const backRef = useRef<() => boolean>(() => false)
  backRef.current = (): boolean => {
    if (selectMode) { exitSelectMode(); return true }
    if (search || isSearching) { setSearch(''); setDebouncedSearch(''); return true }
    if (currentPath) { goBack(); return true }
    return false
  }
  useEffect(() => registerBackHandler(() => backRef.current()), [])

  // ── Actions ────────────────────────────────────────────────────────────────

  const openSongInfo = async (entry: JWApiFileEntry): Promise<void> => {
    setInfoSong(await findSongByFilename(entry.name))
  }

  const openActions = (entry: JWApiFileEntry): void => {
    setSheetEntry(entry)
    setSheetPage('main')
    resetPlaylistDone()
    setSheet('actions')
    resolveTrackerMatch(entry)
  }

  const closeSheet = (): void => { setSheet(null); setSheetEntry(null); setSheetPage('main') }

  const copyToClipboard = (text: string, what: string): void => {
    navigator.clipboard.writeText(text).then(() => showToast(`${what} copied`)).catch(() => showToast('Copy failed'))
  }

  const copyLink = (entry: JWApiFileEntry): void => copyToClipboard(fileEntryLinkUrl(entry, activeChannel), 'Link')

  // The API-relative path ("Compilation/Folder/song.mp3") - what every
  // /files/* endpoint takes as its `path` param, unlike Copy link's full URL.
  const copyPath = (entry: JWApiFileEntry): void => copyToClipboard(entry.path, 'Path')

  // Tries the P2P CDN first (primary channel only - /cdn/resolve/ has no
  // channel param, so a non-primary path could collide with a different
  // file of the same name) and falls back to the direct stream URL.
  const handleDownload = (entry: JWApiFileEntry): void => {
    const streamUrl = buildStreamUrl(entry.path, activeChannel)
    if (!isPrimary) { triggerDownload(streamUrl, entry.name); return }
    startCdnFileDownload(entry.path, entry.name, streamUrl)
      .then((isDonor) => { if (isDonor) showToast('Priority routing active') })
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  const enterSelectMode = (entry: JWApiFileEntry): void => {
    setSelectMode(true)
    setSelectedPaths(new Set([entry.path]))
  }

  const toggleSelect = (path: string): void => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      if (next.size === 0) setSelectMode(false)
      return next
    })
  }

  // Long-press is the only way into selection on a touch screen, so it has to
  // be careful: a press that turns into a scroll must not select (hence the
  // slop check), and the tap that ends the press must not also open/play the
  // row (hence the flag the click handler consumes).
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const pressConsumed = useRef(false)

  const cancelPress = (): void => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
    pressOrigin.current = null
  }

  const pressHandlers = (entry: JWApiFileEntry): {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
    onContextMenu: (e: React.MouseEvent) => void
  } => ({
    onTouchStart: (e) => {
      const t = e.touches[0]
      pressOrigin.current = { x: t.clientX, y: t.clientY }
      pressConsumed.current = false
      pressTimer.current = setTimeout(() => {
        pressConsumed.current = true
        navigator.vibrate?.(12)
        if (selectMode) toggleSelect(entry.path)
        else enterSelectMode(entry)
      }, LONG_PRESS_MS)
    },
    onTouchMove: (e) => {
      const origin = pressOrigin.current
      if (!origin) return
      const t = e.touches[0]
      if (Math.abs(t.clientX - origin.x) > LONG_PRESS_SLOP || Math.abs(t.clientY - origin.y) > LONG_PRESS_SLOP) {
        cancelPress()
      }
    },
    onTouchEnd: cancelPress,
    onTouchCancel: cancelPress,
    // Right-click still opens the same sheet, which keeps the view usable in a
    // desktop browser during development. Preventing the default also stops
    // Android's own text-selection menu from firing on a long press.
    onContextMenu: (e) => { e.preventDefault(); openActions(entry) },
  })

  const openEntry = (entry: JWApiFileEntry): void => {
    if (pressConsumed.current) { pressConsumed.current = false; return }
    if (selectMode) { toggleSelect(entry.path); return }
    const mt = entry.type === 'directory' ? 'folder' : getMediaType(entry.name)
    if (mt === 'folder') navigate(entry.path)
    else if (mt === 'audio') handlePlay(entry)
    else if (mt === 'image' || mt === 'video') openLightbox(entry)
    else openActions(entry)
  }

  // ── Derived lists ──────────────────────────────────────────────────────────

  const sortedEntries = useMemo(
    () => sortEntries(isSearching ? searchResults : entries, sortBy, sortDir),
    [isSearching, searchResults, entries, sortBy, sortDir]
  )

  // Type filter - folders stay visible regardless of filter so navigation
  // still works; only files are matched against the selected media type.
  const filteredEntries = useMemo(
    () => typeFilter === 'all'
      ? sortedEntries
      : sortedEntries.filter((e) => e.type === 'directory' || getMediaType(e.name) === typeFilter),
    [sortedEntries, typeFilter]
  )

  // The user's own pending comp proposals, as ghost rows in the folder they'd
  // land in - same type filter as the real entries.
  const { ghosts, pendingFor } = usePendingCompGhosts({ enabled: canPropose, activeChannel, currentPath, entries, isSearching })
  const visibleGhosts = useMemo(
    () => typeFilter === 'all' ? ghosts : ghosts.filter((g) => g.type === 'directory' || getMediaType(g.name) === typeFilter),
    [ghosts, typeFilter]
  )

  const folderCount = useMemo(() => filteredEntries.filter((e) => e.type === 'directory').length, [filteredEntries])
  const crumbs = breadcrumbs(currentPath)
  const busy = isSearching ? searchLoading : loading
  const title = isSearching ? 'Search' : crumbs.length ? crumbs[crumbs.length - 1].label : 'Files'
  const zipBusy = zipStatus === 'starting' || zipStatus === 'zipping'

  const channelDescription = channels.find((c) => c.slug === activeChannel)?.description?.trim() || ''
  const subtitle = isSearching
    ? searchLoading ? 'Searching…' : (searchTotal > searchResults.length
        ? `First ${searchResults.length.toLocaleString()} of ${searchTotal.toLocaleString()}`
        : `${searchTotal} ${searchFuzzy ? (searchTotal === 1 ? 'close match' : 'close matches') : (searchTotal === 1 ? 'result' : 'results')}`)
    : busy ? 'Loading…'
    : `${filteredEntries.length} item${filteredEntries.length === 1 ? '' : 's'}`

  const sheetTrackerId = sheetEntry ? trackerMatches.get(sheetEntry.path) : undefined
  const sheetIsAudio = !!sheetEntry && getMediaType(sheetEntry.name) === 'audio'
  const sheetLiked = !!sheetEntry && likedSet.has(apiFileTrackId(sheetEntry.path, trackChannel))

  // Back inside the sheet's playlist page returns to the action list rather
  // than closing the whole sheet. Registered after the Sheet's own handler, so
  // it gets the press first.
  useEffect(() => {
    if (sheet !== 'actions' || sheetPage !== 'playlists') return
    return registerBackHandler(() => { setSheetPage('main'); return true })
  }, [sheet, sheetPage])

  // ── Row ────────────────────────────────────────────────────────────────────

  const renderRow = (entry: JWApiFileEntry): JSX.Element => {
    const isDir = entry.type === 'directory'
    const mt = isDir ? 'folder' : getMediaType(entry.name)
    const isSelected = selectedPaths.has(entry.path)
    const trackId = apiFileTrackId(entry.path, trackChannel)
    const isLiked = mt === 'audio' && likedSet.has(trackId)
    const isCurrent = mt === 'audio' && currentTrack?.id === trackId

    return (
      <div
        key={entry.path}
        className={`list-row relative flex items-center gap-3 pl-4 pr-1 py-2 transition-colors ${
          isSelected ? 'bg-accent/15' : 'active:bg-[var(--fill)]'
        }`}
        {...clickable(() => openEntry(entry))}
        {...pressHandlers(entry)}
      >
        {/* Selection state is drawn ON the thumbnail, not inserted before it: a
            leading checkbox shoves every row sideways the moment select mode
            turns on, which happens mid-long-press - the layout moves out from
            under the finger before the press has even ended. */}
        <div className="relative shrink-0">
          <Thumb entry={entry} size={48} />
          {selectMode && (
            <div className={`absolute inset-0 flex items-center justify-center rounded-lg transition-colors ${isSelected ? 'bg-accent/75' : 'bg-black/45'}`}>
              {isSelected
                ? <Check size={22} className="text-white" strokeWidth={3} />
                : <Circle size={20} className="text-white/85" />}
            </div>
          )}
          {playing === entry.path && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
              <Loader2 size={18} className="text-white animate-spin" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 py-0.5">
          <p className={`text-body truncate ${isCurrent ? 'text-accent font-semibold' : 'text-text-primary'}`}>
            {entry.name}
          </p>
          <p className="text-subhead text-text-secondary truncate">{metaLine(entry, isSearching)}</p>
        </div>
        {pendingFor(entry.path) && <PendingMarker proposal={pendingFor(entry.path)!} />}
        {isLiked && <Heart size={14} fill="currentColor" className="text-accent shrink-0" />}
        {isCurrent && <EqBars paused={!isPlaying} />}
        {selectMode ? (
          isDir ? <ChevronRight size={16} className="text-text-muted shrink-0 mr-3" /> : <span className="w-3 shrink-0" />
        ) : (
          <button
            className="shrink-0 w-11 h-11 flex items-center justify-center text-text-primary active:opacity-50"
            onClick={(e) => { e.stopPropagation(); openActions(entry) }}
            aria-label={isDir ? 'Folder options' : 'File options'}
          >
            <MoreHorizontal size={20} />
          </button>
        )}
      </div>
    )
  }

  const renderTile = (entry: JWApiFileEntry): JSX.Element => {
    const isDir = entry.type === 'directory'
    const mt = isDir ? 'folder' : getMediaType(entry.name)
    const isSelected = selectedPaths.has(entry.path)
    const trackId = apiFileTrackId(entry.path, trackChannel)
    const isLiked = mt === 'audio' && likedSet.has(trackId)
    const isCurrent = mt === 'audio' && currentTrack?.id === trackId
    const hasArt = mt === 'audio' || mt === 'image'

    return (
      <div
        key={entry.path}
        className={`relative flex flex-col rounded-[14px] overflow-hidden transition-colors ${
          isSelected ? 'bg-accent/15 ring-2 ring-accent' : 'bg-[var(--grouped)] active:bg-[var(--fill-strong)]'
        }`}
        {...clickable(() => openEntry(entry))}
        {...pressHandlers(entry)}
      >
        <div className="relative w-full aspect-square bg-surface-overlay flex items-center justify-center overflow-hidden">
          {hasArt ? (
            <ProgressiveCover
              lazy
              src={mt === 'audio' ? buildCoverArtUrl(entry.path, false, activeChannel) : buildStreamUrl(entry.path, activeChannel)}
              alt={entry.name}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <Thumb entry={entry} size={64} rounded="rounded-2xl" />
          )}
          {playing === entry.path && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55">
              <Loader2 size={22} className="text-white animate-spin" />
            </div>
          )}
          {isCurrent && (
            <div className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
              <EqBars paused={!isPlaying} />
            </div>
          )}
          {isLiked && (
            <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 flex items-center justify-center">
              <Heart size={12} fill="currentColor" className="text-accent" />
            </div>
          )}
          {selectMode && (
            <div className="absolute top-1.5 left-1.5">
              {isSelected
                ? <CheckCircle2 size={22} className="text-accent drop-shadow" />
                : <Circle size={22} className="text-white/80 drop-shadow" />}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 pl-2.5 pr-0.5 py-1.5">
          <div className="flex-1 min-w-0">
            <p className={`text-footnote font-medium truncate ${isCurrent ? 'text-accent' : 'text-text-primary'}`}>{entry.name}</p>
            <p className="text-footnote text-text-secondary truncate">{metaLine(entry, isSearching)}</p>
          </div>
          {!selectMode && (
            <button
              className="shrink-0 w-9 h-9 flex items-center justify-center text-text-primary active:opacity-50"
              onClick={(e) => { e.stopPropagation(); openActions(entry) }}
              aria-label="Options"
            >
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* The header paints no background of its own: the app shell's - the
            optional accent gradient included - runs continuously from behind
            the status bar down through the listing, and an opaque header in
            between showed up as a flat slab dividing two tinted regions.
            It also deliberately does NOT collapse in select mode. Swapping it
            for a one-line selection bar dropped the search and filter rows at
            once, jumping the list up the screen under the finger that was still
            long-pressing. The selection controls live in the bottom bar
            instead, which only shortens the scroller. */}
        <div className="shrink-0">
            {/* No top padding: <main> has already absorbed the status-bar
                inset. At the root the actions share the large title's line,
                as Tracker's do; inside a folder they move up to a bar with the
                back button, iOS Files-style, and the folder's name takes the
                large title. The layout follows the folder, not the search
                text, so typing never moves the field under the finger. */}
            {(() => {
              const titleSub = currentPath && !isSearching ? (
                // The path doubles as the folder switcher: tapping it opens a
                // sheet listing every ancestor, which is how you jump up more
                // than one level without a breadcrumb row eating a whole line
                // of a phone screen.
                <button
                  onClick={() => setSheet('path')}
                  className="flex items-center gap-1 max-w-full text-text-secondary active:text-text-primary"
                >
                  <span className="truncate">{currentPath}</span>
                  <ChevronDown size={14} className="shrink-0" />
                </button>
              ) : subtitle
              const actions = <>
                {channels.length > 1 && (
                  <BarButton
                    label={`Channel: ${channels.find((c) => c.slug === activeChannel)?.name ?? 'default'}`}
                    onClick={() => setSheet('channel')}
                  ><Radio size={20} /></BarButton>
                )}
                {/* Sort lives up here rather than as a chip in the row below:
                    the four filter chips already fill a phone's width on their
                    own. The current field/direction shows in the sheet it
                    opens. */}
                <BarButton
                  label={`Sort by ${SORT_LABELS[sortBy].toLowerCase()}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                  onClick={() => setSheet('sort')}
                ><SlidersHorizontal size={20} /></BarButton>
                <BarButton
                  label={viewMode === 'list' ? 'Switch to grid' : 'Switch to list'}
                  onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                >{viewMode === 'list' ? <LayoutGrid size={20} /> : <LayoutList size={20} />}</BarButton>
              </>
              return currentPath ? (
                <>
                  <div className="flex items-center gap-2 px-3 pt-1">
                    <BackButton
                      onClick={() => { if (isSearching || search) { setSearch(''); setDebouncedSearch('') } else goBack() }}
                    />
                    <div className="flex-1" />
                    {actions}
                  </div>
                  <LargeTitle inset="none" title={title} subtitle={titleSub} />
                </>
              ) : (
                <LargeTitle inset="none" title={title} subtitle={titleSub} trailing={actions} />
              )
            })()}

            {/* Search - recursive across the whole tree, or (with the folder
                toggle on) just the folder being browsed and its subfolders. */}
            <div className="px-4 pt-1 pb-2">
              <SearchField
                value={search}
                onChange={(v) => { setSearch(v); if (!v) setDebouncedSearch('') }}
                onFocus={prefetchSearchIndex}
                placeholder={searchInFolder && currentPath ? `Search in ${currentPath.slice(currentPath.lastIndexOf('/') + 1)}` : 'Search all files'}
                trailing={<>
                  {currentPath && (
                    <SearchFieldButton
                      label={searchInFolder ? 'Search all files' : 'Search this folder only'}
                      onClick={() => setSearchInFolder(!searchInFolder)}
                      active={searchInFolder}
                    ><Folder size={17} /></SearchFieldButton>
                  )}
                  <span className="w-9 h-9 flex items-center justify-center">
                    <SearchHelpButton
                      kind="files"
                      size={17}
                      className={(open) => `flex transition-colors ${open ? 'text-accent' : 'text-text-muted active:text-text-primary'}`}
                    />
                  </span>
                </>}
              />
            </div>

            {/* Filter chips. Label-only, and the selected one grows a leading
                check instead of every chip carrying an icon: four icon+label
                chips are wider than a phone on their own, so the row was
                always scrolled and always looked clipped. Sort moved up to
                the app bar for the same reason. The row can still scroll, but
                only as a fallback for a very narrow screen. */}
            <div className="flex items-center gap-2 px-4 pt-1 pb-2 overflow-x-auto no-scrollbar">
              {MEDIA_FILTERS.map(({ key, label }) => {
                const active = typeFilter === key
                return (
                  <button
                    key={key}
                    onClick={() => setTypeFilter(key)}
                    aria-pressed={active}
                    className={`shrink-0 flex items-center gap-1 h-8 pr-3.5 rounded-full text-subhead font-medium transition-colors ${
                      active ? 'bg-text-primary text-surface pl-2.5' : 'bg-[var(--fill)] text-text-primary active:bg-[var(--fill-strong)] pl-3.5'
                    }`}
                  >
                    {active && <Check size={14} />}{label}
                  </button>
                )
              })}
            </div>
        </div>

        {/* Listing */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain pb-dock"
          // Room to scroll past the floating selection bar in select mode.
          style={selectMode ? { paddingBottom: 'calc(var(--dock-h, 0px) + 8rem)' } : undefined}
        >
          {busy && filteredEntries.length === 0 ? (
            <div className="px-4 pt-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-xl art-shimmer shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded-full art-shimmer" style={{ width: `${50 + ((i * 13) % 40)}%` }} />
                    <div className="h-2.5 w-20 rounded-full art-shimmer opacity-60" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center">
              <div className="w-14 h-14 rounded-full bg-surface-overlay flex items-center justify-center">
                <X size={24} className="text-text-muted" />
              </div>
              <p className="text-text-secondary text-sm">{error}</p>
              <button
                onClick={() => navigate(currentPath, false)}
                className="h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80"
              >Try again</button>
            </div>
          ) : filteredEntries.length === 0 && visibleGhosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center">
              <div className="w-14 h-14 rounded-full bg-surface-overlay flex items-center justify-center">
                {isSearching ? <Search size={24} className="text-text-muted" />
                  : sortedEntries.length > 0 ? <Filter size={24} className="text-text-muted" />
                  : <Folder size={24} className="text-text-muted" />}
              </div>
              <p className="text-text-secondary text-sm">
                {isSearching ? `Nothing matches “${debouncedSearch.trim()}”`
                  : sortedEntries.length > 0 ? `No ${typeFilter} files in this folder`
                  : 'This folder is empty'}
              </p>
              {!isSearching && sortedEntries.length > 0 && (
                <button
                  onClick={() => setTypeFilter('all')}
                  className="h-10 px-5 rounded-full bg-surface-overlay text-text-primary text-sm font-semibold active:bg-surface-highest"
                >Show all files</button>
              )}
            </div>
          ) : viewMode === 'list' ? (
            <div>
              {filteredEntries.map((entry, i) => (
                <div key={entry.path}>
                  {/* Folders sort first, so a single label where the run ends
                      is enough to separate the two groups. */}
                  {!isSearching && folderCount > 0 && (i === 0 || i === folderCount) && filteredEntries.length > folderCount && (
                    <h2 className="px-4 pt-4 pb-1 text-title3 text-text-primary">
                      {i === 0 ? 'Folders' : 'Files'}
                    </h2>
                  )}
                  {renderRow(entry)}
                </div>
              ))}
              {visibleGhosts.length > 0 && (
                <h2 className="px-4 pt-4 pb-1 text-title3 text-text-primary">Pending Review</h2>
              )}
              {visibleGhosts.map((g) => <PendingGhostItem key={`ghost:${g.path}`} ghost={g} variant="row" mobile />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 px-4 pt-1">
              {filteredEntries.map(renderTile)}
              {visibleGhosts.map((g) => <PendingGhostItem key={`ghost:${g.path}`} ghost={g} variant="tile" mobile />)}
            </div>
          )}
        </div>

        {/* Selection action bar - a glass panel floating just above the mini
            player, like the dock under it; the listing pads its end for it in
            select mode so the last rows can scroll clear. */}
        {selectMode && (
          <div className="fixed left-3 right-3 z-20 glass rounded-[28px] overflow-hidden" style={{ bottom: 'var(--dock-h, 0px)' }}>
          <div className="flex items-center gap-1 pl-1 pr-2 pt-1">
            <button
              onClick={exitSelectMode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-text-primary active:bg-[var(--fill)]"
              aria-label="Cancel selection"
            ><X size={19} /></button>
            <span className="flex-1 min-w-0 text-text-primary text-headline truncate">
              {selectedPaths.size} selected
            </span>
            <button
              onClick={() => setSelectedPaths(new Set(filteredEntries.map((e) => e.path)))}
              className="px-3 h-10 rounded-full text-accent text-subhead font-semibold active:opacity-60"
            >Select all</button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
            {canPropose && (
              <button
                onClick={() => {
                  // Deletion only: a replace swaps one file's body for another,
                  // which has no meaning across a selection. Directories are
                  // dropped - proposals target files.
                  const paths = filteredEntries
                    .filter((e) => e.type !== 'directory' && selectedPaths.has(e.path))
                    .map((e) => e.path)
                  if (paths.length === 0) return
                  setPendingCompProposal({ paths, changeType: 'delete' })
                  exitSelectMode()
                  setActiveView('contributor')
                }}
                disabled={selectedPaths.size === 0}
                className="shrink-0 w-12 h-12 flex items-center justify-center rounded-full text-text-secondary active:bg-[var(--fill)] disabled:opacity-40"
                aria-label="Propose deletion"
              ><Trash2 size={19} /></button>
            )}
            <button
              onClick={downloadZip}
              disabled={selectedPaths.size === 0 || zipBusy}
              className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-headline disabled:opacity-50 active:opacity-80"
            >
              {zipBusy ? <><Loader2 size={17} className="animate-spin" /> {zipStatus === 'starting' ? 'Starting…' : zipProgress ? `Zipping ${zipProgress.done}/${zipProgress.total}…` : 'Downloading…'}</>
                : zipStatus === 'done' ? <><Check size={17} /> Downloaded</>
                : zipStatus === 'error' ? <><X size={17} /> Failed</>
                : <><PackageOpen size={17} /> Download</>}
            </button>
          </div>
          </div>
        )}
      </div>

      {/* Toasts - lifted clear of the player and nav bar, whose height the
          BottomNav publishes as a CSS var. */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[75] flex items-center gap-2 px-4 py-2.5 rounded-full glass text-text-primary text-footnote font-medium animate-slide-up"
          style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 92px)' }}
        >
          <Check size={14} className="text-accent" /> {toast}
        </div>
      )}
      {!selectMode && zipStatus !== 'idle' && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[75] flex flex-col gap-1.5 px-4 py-2.5 rounded-2xl glass text-text-primary text-footnote animate-slide-up min-w-[220px]"
          style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 92px)' }}
        >
          <div className="flex items-center justify-center gap-2 whitespace-nowrap">
            {zipBusy ? <><Loader2 size={14} className="animate-spin text-accent" /> {zipStatus === 'starting' ? 'Preparing folder…' : zipProgress ? `Zipping ${zipProgress.done}/${zipProgress.total}${zipProgress.totalBytes ? ` · ${Math.min(99, Math.round(((zipProgress.bytes ?? 0) / zipProgress.totalBytes) * 100))}%` : zipProgress.bytes ? ` · ${formatBytes(zipProgress.bytes)}` : ''}` : 'Downloading folder…'}</>
              : zipStatus === 'done' ? <><Check size={14} className="text-accent" /> Download started</>
              : <><X size={14} className="text-red-400" /> Download failed</>}
          </div>
          {zipBusy && zipProgress && (
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${zipProgress.totalBytes ? Math.min(100, ((zipProgress.bytes ?? 0) / zipProgress.totalBytes) * 100) : (zipProgress.done / Math.max(1, zipProgress.total)) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <CdnDownloadToastMobile />

      {lightboxIndex >= 0 && lightboxItems.length > 0 && (
        <MediaLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onNav={setLightboxIndex}
        />
      )}

      {/* ── Folder jump sheet ─────────────────────────────────────────────── */}
      {sheet === 'path' && (
        <Sheet onClose={closeSheet} title="Location">
          <SheetItem
            icon={Home}
            label="Root"
            active={crumbs.length === 0}
            onClick={() => { closeSheet(); goHome() }}
          />
          {crumbs.map((crumb, i) => {
            const isCurrent = i === crumbs.length - 1
            return (
              <SheetItem
                key={crumb.path}
                icon={Folder}
                label={crumb.label}
                active={isCurrent}
                trailing={isCurrent ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                onClick={() => { closeSheet(); if (!isCurrent) navigate(crumb.path) }}
              />
            )
          })}
        </Sheet>
      )}

      {/* ── Channel sheet ─────────────────────────────────────────────────── */}
      {sheet === 'channel' && (
        <Sheet onClose={closeSheet} title="Channel">
          {channels.map((ch) => (
            <SheetItem
              key={ch.slug}
              icon={Radio}
              label={ch.name}
              active={activeChannel === ch.slug}
              trailing={activeChannel === ch.slug ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => { closeSheet(); onChannelChange(ch.slug) }}
            />
          ))}
        </Sheet>
      )}

      {/* ── Sort sheet ────────────────────────────────────────────────────── */}
      {sheet === 'sort' && (
        <Sheet onClose={closeSheet} title="Sort by">
          {(['name', 'type', 'size'] as SortBy[]).map((by) => (
            <SheetItem
              key={by}
              label={SORT_LABELS[by]}
              active={sortBy === by}
              trailing={sortBy === by ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => setSortBy(by)}
            />
          ))}
          <SheetDivider />
          <SheetItem
            icon={ArrowUp}
            label="Ascending"
            active={sortDir === 'asc'}
            trailing={sortDir === 'asc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSortDir('asc')}
          />
          <SheetItem
            icon={ArrowDown}
            label="Descending"
            active={sortDir === 'desc'}
            trailing={sortDir === 'desc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSortDir('desc')}
          />
        </Sheet>
      )}

      {/* ── Entry actions sheet ───────────────────────────────────────────── */}
      {sheet === 'actions' && sheetEntry && (
        <Sheet
          onClose={closeSheet}
          header={
            sheetPage === 'main' ? (
              <div className="flex items-center gap-3 px-5 pt-3 pb-3">
                <Thumb entry={sheetEntry} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-[15px] font-semibold truncate">{sheetEntry.name}</p>
                  <p className="text-text-muted text-xs truncate mt-0.5">{metaLine(sheetEntry, false)}</p>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setSheetPage('main')}
                className="w-full flex items-center gap-2 px-4 pt-3 pb-3 text-text-primary active:bg-surface-overlay"
              >
                <ArrowLeft size={18} className="text-text-muted" />
                <span className="text-[15px] font-semibold">Add to playlist</span>
              </button>
            )
          }
        >
          {sheetPage === 'playlists' ? (
            !account ? (
              <div className="px-5 py-4">
                <p className="text-text-muted text-sm mb-3">Log in to save songs to your playlists.</p>
                <button
                  onClick={() => { closeSheet(); setShowUserAuth(true) }}
                  className="w-full h-11 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80"
                >Log in</button>
              </div>
            ) : playlists.length === 0 ? (
              <p className="px-5 py-6 text-center text-text-muted text-sm">No playlists yet.</p>
            ) : (
              playlists.map((p) => (
                <SheetItem
                  key={p.id}
                  icon={ListMusic}
                  label={p.name}
                  trailing={playlistDoneId === p.id ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                  onClick={() => { if (sheetEntry) addToPlaylist(p.id, sheetTrackerId != null ? { songId: sheetTrackerId } : { path: sheetEntry.path, channel: activeChannel || undefined }) }}
                />
              ))
            )
          ) : (
            <>
              {sheetIsAudio && (
                <>
                  <SheetItem icon={Play} label="Play" onClick={() => { handlePlay(sheetEntry); closeSheet() }} />
                  <SheetItem icon={ListPlus} label="Add to queue" onClick={async () => { const e = sheetEntry; closeSheet(); addToQueue(fileToTrack(e, (await resolveTrackChannel()) ?? activeChannel)); showToast('Added to queue') }} />
                  {sheetIsAudio && (
                    <SheetItem
                      icon={Plus}
                      label="Add to playlist"
                      trailing={<ChevronRight size={16} className="text-text-muted shrink-0" />}
                      onClick={() => setSheetPage('playlists')}
                    />
                  )}
                  <SheetItem
                    icon={Heart}
                    label={sheetLiked ? 'Remove from liked' : 'Like'}
                    disabled={!channelsReady}
                    onClick={() => { toggleApiFileLike(sheetEntry.path); closeSheet() }}
                  />
                  {(
                    <SheetItem icon={Sparkles} label="Synced lyrics" onClick={async () => {
                      const entry = sheetEntry
                      const songId = sheetTrackerId ?? null
                      closeSheet()
                      const channel = (await resolveTrackChannel()) ?? activeChannel
                      useStore.getState().openLyricsGen({ track: fileToTrack(entry, channel), songId, tab: account?.is_donor ? 'create' : 'sync' })
                    }} />
                  )}
                  {sheetTrackerId != null && (
                    <SheetItem icon={Info} label="Find in Tracker" onClick={() => { openSongInfo(sheetEntry); closeSheet() }} />
                  )}
                  {canEdit && (
                    <SheetItem
                      icon={Pencil}
                      label="Edit song"
                      onClick={async () => {
                        const songTitle = sheetEntry.name.replace(/\.[^.]+$/, '')
                        closeSheet()
                        try {
                          const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search: songTitle, page_size: 1 })
                          const id = data.results[0]?.id
                          if (id) useStore.getState().openSongEditor(id)
                        } catch {}
                      }}
                    />
                  )}
                  <SheetDivider />
                </>
              )}

              {sheetEntry.type === 'directory' ? (
                <SheetItem icon={PackageOpen} label="Download folder" disabled={zipBusy}
                  onClick={() => { downloadFolder(sheetEntry); closeSheet() }} />
              ) : (
                <SheetItem icon={Download} label="Download" onClick={() => { handleDownload(sheetEntry); closeSheet() }} />
              )}
              <SheetItem icon={CheckCircle2} label="Select" onClick={() => { enterSelectMode(sheetEntry); closeSheet() }} />
              <SheetItem icon={Link} label="Copy link" onClick={() => { copyLink(sheetEntry); closeSheet() }} />
              <SheetItem icon={Clipboard} label="Copy path" onClick={() => { copyPath(sheetEntry); closeSheet() }} />

              {/* Contributor actions - proposals target a file, so directories
                  are excluded. Both land on the contributor page prefilled. */}
              {canPropose && sheetEntry.type !== 'directory' && (
                <>
                  <SheetDivider />
                  <SheetItem
                    icon={Replace}
                    label="Propose replacement"
                    onClick={() => {
                      setPendingCompProposal({ paths: [sheetEntry.path], changeType: 'replace' })
                      closeSheet()
                      setActiveView('contributor')
                    }}
                  />
                  <SheetItem
                    icon={Trash2}
                    label="Propose deletion"
                    danger
                    onClick={() => {
                      setPendingCompProposal({ paths: [sheetEntry.path], changeType: 'delete' })
                      closeSheet()
                      setActiveView('contributor')
                    }}
                  />
                </>
              )}
            </>
          )}
        </Sheet>
      )}

      {infoSong && (
        <SongInfoModal
          song={infoSong}
          onClose={() => setInfoSong(null)}
          onEdit={canEdit ? (songId) => {
            setInfoSong(null)
            setPendingEditorSongId(songId)
            setActiveView('editor')
          } : undefined}
        />
      )}
    </>
  )
}
