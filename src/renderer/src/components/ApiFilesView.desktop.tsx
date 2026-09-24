import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Folder, Music2, ChevronRight, ArrowLeft, Home, Play, Loader2,
  FolderOpen, HardDrive, LayoutList, LayoutGrid, ImageIcon, Video,
  Download, ArrowUpDown, ArrowUp, ArrowDown, Link, Check, Info, ListPlus, Heart,
  X, Pencil, PackageOpen, CheckSquare2, Square, Search,
  Filter, MoreHorizontal, Clipboard, Plus, ListMusic, Replace, Trash2,
  FileText, FolderInput, CornerLeftUp, RefreshCw, FolderPlus, Upload,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import type { StagedFileChange } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { useTrackChannel } from '../hooks/useTrackChannel'
import { placeFlyout } from '../lib/menuFlyout'
import {
  apiFetch,
  buildStreamUrl,
  buildCoverArtUrl,
  smallCoverUrl,
  apiFileTrackId,
  JWApiFileEntry,
  JWApiPaginatedResponse,
} from '../lib/juicewrldApi'
import { getFileExt, getMediaType, toFileUrl } from '../lib/fileTypes'
import {
  breadcrumbs, parentFolder, fileToTrack, sortEntries, fileEntryLinkUrl, findSongByFilename, triggerDownload,
  type ViewMode, type SortBy, type SortDir,
} from '../lib/apiFilesShared'
import { downloadFileSmart } from '../lib/cdn'
import { useApiFilesBrowse } from '../hooks/useApiFilesBrowse'
import { useApiFilesZip } from '../hooks/useApiFilesZip'
import { useTrackerMatches } from '../hooks/useTrackerMatches'
import { useAddFileToPlaylist } from '../hooks/useAddFileToPlaylist'
import { usePlayFileEntry } from '../hooks/usePlayFileEntry'
import { useFileLightbox } from '../hooks/useFileLightbox'
import { useMultiSelect } from '../hooks/useMultiSelect'
import { useLongPress } from '../hooks/useLongPress'
import { basename } from '../lib/compStagedChanges'
import { queueCompUploads } from '../lib/compUploads'
import { collectDroppedFiles, filesFromInput, isFileDrag, type LocalUpload } from '../lib/droppedFiles'
import { ClampedMenu } from './ClampedMenu'
import { Track } from '../types'
import { ProgressiveCover } from './ProgressiveCover'
import MediaLightbox from './MediaLightbox'
import TextFileViewer, { TextFileSource } from './TextFileViewer'

type MediaFilter = 'all' | 'audio' | 'image' | 'video' | 'text'

// Mirrors the main process's read-text-file cap, so an API file and a local
// file of the same size behave the same in the viewer.
const TEXT_VIEW_MAX = 2 * 1024 * 1024

const LS_SORT_BY = 'api-files:sortBy'
const LS_SORT_DIR = 'api-files:sortDir'
const LS_VIEW_MODE = 'api-files:viewMode'
const LS_TYPE_FILTER = 'api-files:typeFilter'

const MEDIA_FILTERS: { key: MediaFilter; label: string; icon: typeof Filter }[] = [
  { key: 'all', label: 'All', icon: Filter },
  { key: 'audio', label: 'Audio', icon: Music2 },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'video', label: 'Videos', icon: Video },
  { key: 'text', label: 'Text', icon: FileText },
]

function localFileToTrack(entry: { name: string; path: string; size: number | null }): Track {
  const title = entry.name.replace(/\.[^.]+$/, '')
  const fileUrl = toFileUrl(entry.path)
  return {
    id: `local-${entry.path}`,
    path: entry.path,
    streamUrl: fileUrl,
    imageUrl: '',
    title,
    artist: '',
    album: '',
    albumArtist: '',
    year: null,
    trackNumber: null,
    duration: 0,
    genre: '',
    hasAlbumArt: false,
  }
}

function ApiCoverThumb({ path, size = 36 }: { path: string; size?: number }): JSX.Element {
  const activeChannel = useStore((s) => s.activeChannel)
  const [errored, setErrored] = useState(false)
  if (errored) {
    return (
      <div className="flex items-center justify-center bg-surface-overlay rounded" style={{ width: size, height: size }}>
        <Music2 size={size * 0.5} className="text-text-muted opacity-40" />
      </div>
    )
  }
  return (
    <img
      src={buildCoverArtUrl(path, true, activeChannel)}
      alt=""
      className="rounded object-cover"
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  )
}

function ApiImageThumb({ path, size = 36 }: { path: string; size?: number }): JSX.Element {
  const activeChannel = useStore((s) => s.activeChannel)
  const [errored, setErrored] = useState(false)
  if (errored) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <ImageIcon size={size * 0.5} className="text-text-muted opacity-40" />
      </div>
    )
  }
  return (
    <img
      // Image entries are served whole by /files/download/ - a browse folder of
      // cover art is hundreds of KB per row at full size, so thumbnails take the
      // degraded copy. The lightbox still opens the original.
      src={smallCoverUrl(buildStreamUrl(path, activeChannel))}
      alt=""
      className="rounded object-cover"
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  )
}

export default function ApiFilesView(): JSX.Element {
  const { playTrack, addToQueue, apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath, account, setActiveView, setPendingCompProposal, likedTrackIds, toggleLike, playlists, refreshPlaylists, setShowUserAuth, channels, activeChannel, setActiveChannel, loadChannels, stagedFileChanges, stageFileChanges, setShowUploadManager } = useStorePick('playTrack', 'addToQueue', 'apiFilesPath', 'setApiFilesPath', 'apiFilesLastPath', 'setApiFilesLastPath', 'account', 'setActiveView', 'setPendingCompProposal', 'likedTrackIds', 'toggleLike', 'playlists', 'refreshPlaylists', 'setShowUserAuth', 'channels', 'activeChannel', 'setActiveChannel', 'loadChannels', 'stagedFileChanges', 'stageFileChanges', 'setShowUploadManager')
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

  const [textFile, setTextFile] = useState<TextFileSource | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [copiedKind, setCopiedKind] = useState<'link' | 'path'>('link')
  const [boostToast, setBoostToast] = useState(false)
  // "Add to playlist" flyout, opened from the context menu.
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const playlistItemRef = useRef<HTMLButtonElement>(null)
  const playlistFlyoutRef = useRef<HTMLDivElement>(null)
  const [playlistFlyoutPos, setPlaylistFlyoutPos] = useState({ top: 0, left: 0 })
  const [ctxMenu, setCtxMenu] = useState<{ entry: JWApiFileEntry; x: number; y: number } | null>(null)
  // Right-click on empty listing space, rather than a specific entry.
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [newFolderPrompt, setNewFolderPrompt] = useState<string | null>(null)
  // Position clamping is handled by the shared <ClampedMenu> at render time -
  // this ref is kept only so the playlist flyout below can measure it.
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const [ctxMenuPos, setCtxMenuPos] = useState({ left: 0, top: 0 })

  // Data layer (browse/history/search/channel-switch) - shared with the
  // mobile build, see useApiFilesBrowse.
  const {
    currentPath, entries, loading, error, history, setHistory, navigate, goBack, goHome, onChannelChange,
    search, setSearch, debouncedSearch, setDebouncedSearch, searchResults, searchLoading, isSearching,
  } = useApiFilesBrowse({
    activeChannel, setActiveChannel, channels, loadChannels,
    apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath,
  })

  // Whether a right-clicked audio file actually has a matching song in the
  // Tracker - resolved lazily per path on menu-open (not for every row up
  // front) so "Find in Tracker" can be hidden for files with no match instead
  // of opening the info modal on nothing. undefined = not looked up yet,
  // null = looked up, no match.
  const { trackerMatches, resolveTrackerMatch } = useTrackerMatches()
  const { playlistBusyId, playlistDoneId, addToPlaylist, resetPlaylistDone } = useAddFileToPlaylist(refreshPlaylists)
  const { playing, handlePlay } = usePlayFileEntry(entries, playTrack)
  const { lightboxItems, lightboxIndex, setLightboxIndex, openLightbox } = useFileLightbox({ entries, searchResults, isSearching, activeChannel })

  // Closing/reopening the menu resets the playlist flyout so it never
  // re-opens against a different entry than the one it was populated for.
  useEffect(() => {
    setPlaylistsOpen(false)
    resetPlaylistDone()
  }, [ctxMenu]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flyout sits beside the menu, flipping left when it'd run off the edge -
  // same placement helper the song context menu's submenus use.
  useLayoutEffect(() => {
    if (!playlistsOpen) return
    const item = playlistItemRef.current, menu = ctxMenuRef.current, sub = playlistFlyoutRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setPlaylistFlyoutPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [playlistsOpen, ctxMenuPos, playlists.length])

  // Multi-select state - see the useMultiSelect() call further down (needs
  // filteredEntries, which isn't defined yet here) for
  // selectMode/selectedPaths/enterSelectMode/toggleSelect/exitSelectMode.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const toggleSort = (by: SortBy): void => {
    if (sortBy === by) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(by)
      setSortDir('asc')
    }
  }

  // ESC closes an open context menu, like a native one. Registered separately
  // from the select-mode handler so it works whether or not that's active.
  useEffect(() => {
    if (!ctxMenu) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setCtxMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctxMenu])

  useEffect(() => {
    if (!bgCtxMenu) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setBgCtxMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bgCtxMenu])

  const openSongInfo = async (entry: JWApiFileEntry): Promise<void> => {
    const match = await findSongByFilename(entry.name)
    // Global infoSongId (not local state) so the info panel survives
    // switching to another tab, which unmounts this view.
    if (match) useStore.getState().setInfoSongId(match.id)
  }

  const openContextMenu = (entry: JWApiFileEntry, x: number, y: number): void => {
    setCtxMenu({ entry, x, y })
    resolveTrackerMatch(entry)
  }

  // `marker` only drives the confirmation toast - any non-empty string will do.
  const copyTextToClipboard = (text: string, what: 'link' | 'path', marker = text): void => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPath(marker)
      setCopiedKind(what)
      setTimeout(() => setCopiedPath(null), 1800)
    })
  }

  const copyToClipboard = (entry: JWApiFileEntry, text: string, what: 'link' | 'path'): void =>
    copyTextToClipboard(text, what, entry.path)

  const copyLink = (entry: JWApiFileEntry): void => copyToClipboard(entry, fileEntryLinkUrl(entry, activeChannel), 'link')

  // The API-relative path ("Compilation/Folder/song.mp3") - what every
  // /files/* endpoint takes as its `path` param, unlike Copy link's full URL.
  const copyPath = (entry: JWApiFileEntry): void => copyToClipboard(entry, entry.path, 'path')

  // Tries the P2P CDN first (primary channel only - /cdn/resolve/ has no
  // channel param, so a non-primary path could collide with a different
  // file of the same name) and falls back to the direct stream URL.
  const handleDownload = (entry: JWApiFileEntry): void => {
    const streamUrl = buildStreamUrl(entry.path, activeChannel)
    if (!isPrimary) { triggerDownload(streamUrl, entry.name); return }
    downloadFileSmart(entry.path, entry.name, streamUrl).then((isDonor) => {
      if (!isDonor) return
      setBoostToast(true)
      setTimeout(() => setBoostToast(false), 1800)
    })
  }

  // Text viewer - API files come over HTTP from the same stream URL the
  // player uses, capped client-side to match the local reader's 2 MB limit.
  const openApiText = (entry: JWApiFileEntry): void => {
    setTextFile({
      name: entry.name,
      onDownload: () => handleDownload(entry),
      load: async () => {
        const res = await fetch(buildStreamUrl(entry.path, activeChannel))
        if (!res.ok) throw new Error(`Couldn't load this file (HTTP ${res.status})`)
        const buf = await res.arrayBuffer()
        const truncated = buf.byteLength > TEXT_VIEW_MAX
        const bytes = new Uint8Array(truncated ? buf.slice(0, TEXT_VIEW_MAX) : buf)
        if (bytes.subarray(0, 8000).includes(0)) throw new Error('This looks like a binary file')
        return { text: new TextDecoder('utf-8').decode(bytes), truncated }
      },
    })
  }

  // ── Selection helpers ──────────────────────────────────────────────────────
  // enterSelectMode/toggleSelect/exitSelectMode are defined further down,
  // right after the useMultiSelect() call (needs filteredEntries) - this
  // closure only runs later, on an actual long-press, so referencing them
  // here before that point is fine.

  const handleLongPressStart = (entry: JWApiFileEntry): void => {
    longPressTimer.current = setTimeout(() => enterSelectMode(entry), 500)
  }

  const handleLongPressEnd = (): void => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }

  // ── Sorted entries ─────────────────────────────────────────────────────────

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

  // Multi-select - select mode, the selected-paths Map, Escape-to-exit, and
  // Ctrl/Cmd+A "select all" are handled by the shared hook. Value === key
  // (path) here since there's nothing extra to carry per entry - `.has()`/
  // `.size` behave the same as the old Set<string>; only spreads need
  // `.keys()` now instead of spreading the Map itself.
  const {
    selectMode, selected: selectedPaths, selectMany: selectManyPaths, toggle,
    exitSelectMode, selectAll: selectAllEntries, clear: clearSelection,
  } = useMultiSelect<string>({
    onExit: () => resetZip(),
    ctrlA: {
      getAll: () => new Map(filteredEntries.map(e => [e.path, e.path])),
    },
  })
  const enterSelectMode = (entry: JWApiFileEntry): void => {
    selectManyPaths(new Map([[entry.path, entry.path]]))
    setCtxMenu(null)
  }
  const toggleSelect = (path: string): void => toggle(path, path)
  // Mouse press-and-hold - the desktop equivalent of the touch long-press
  // above, as a second way into select mode alongside Ctrl/Cmd+click.
  const mouseLongPress = useLongPress()

  const { zipStatus, resetZip, downloadZip, downloadFolder } = useApiFilesZip({
    activeChannel,
    getSelectedEntries: () => filteredEntries.filter((e) => selectedPaths.has(e.path)),
  })

  // ── Drag-and-drop reorganizing ─────────────────────────────────────────────
  // Contributors can drag entries onto a folder to move them in, or onto a
  // file to bundle both into a new folder. Nothing is proposed on drop: the
  // intended changes are staged (store.stagedFileChanges) and reviewed in the
  // Uploads panel, which is where Propose lives - see lib/compStagedChanges.
  type DragItem = { path: string; isDir: boolean }
  const [draggedItems, setDraggedItems] = useState<DragItem[]>([])
  // Path of the row currently under the cursor, or '..' for the parent row.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [bundlePrompt, setBundlePrompt] = useState<{ target: DragItem; items: DragItem[]; name: string } | null>(null)

  // Moves already queued for this channel, keyed by the path being moved, so
  // a row can show where it's headed instead of looking untouched.
  const stagedMoves = useMemo(() => {
    const m = new Map<string, StagedFileChange>()
    for (const c of stagedFileChanges) {
      if (c.channel === activeChannel && c.changeType !== 'create_folder') m.set(c.path, c)
    }
    return m
  }, [stagedFileChanges, activeChannel])
  const stagedCount = useMemo(
    () => stagedFileChanges.filter(c => c.channel === activeChannel).length,
    [stagedFileChanges, activeChannel],
  )

  /** A folderPath that doesn't exist yet is fine: the new folder is just part
   *  of each move's destination path, so no separate create_folder proposal. */
  const stageMovesInto = (folderPath: string, items: DragItem[]): void => {
    const changes = items
      .filter(d => parentFolder(d.path) !== folderPath)
      .map(d => ({
        changeType: (d.isDir ? 'move_folder' : 'move') as 'move_folder' | 'move',
        path: d.path,
        destination: folderPath ? `${folderPath}/${basename(d.path)}` : basename(d.path),
        channel: activeChannel,
      }))
    if (changes.length === 0) return
    stageFileChanges(changes)
    // Only pop the panel open for the first drop of a batch - it shows where
    // queued changes live, and after that the header pill carries the count
    // without the panel covering the listing on every subsequent drag.
    if (stagedFileChanges.length === 0) setShowUploadManager(true)
    // A drag out of select mode consumed the whole selection, so drop out of
    // it rather than keeping rows checked that are now queued to move away.
    if (selectMode) exitSelectMode()
  }

  const dragSourceProps = (entry: JWApiFileEntry): {
    draggable: boolean
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
  } => ({
    draggable: canPropose,
    onDragStart: e => {
      // A hold long enough to start a drag would otherwise also trip
      // hold-to-select, leaving the row selected once the drag ends.
      mouseLongPress.cancel()
      e.dataTransfer.effectAllowed = 'move'
      const byPath = new Map(filteredEntries.map(x => [x.path, x]))
      // Dragging one of the selected rows takes the whole selection with it;
      // dragging an unselected row moves just that one.
      const paths = selectedPaths.has(entry.path) ? [...selectedPaths.keys()] : [entry.path]
      setDraggedItems(paths.map(p => ({ path: p, isDir: (byPath.get(p) ?? entry).type === 'directory' })))
    },
    onDragEnd: () => { setDraggedItems([]); setDropTarget(null) },
  })

  /** Whether the current drag can land on `entry`: not onto itself, not a
   *  folder into its own subtree, and not into the folder it already sits in. */
  const dropAllowed = (entry: JWApiFileEntry): boolean => {
    if (draggedItems.length === 0) return false
    if (draggedItems.some(d => d.path === entry.path)) return false
    if (entry.type !== 'directory') return true
    if (draggedItems.some(d => d.isDir && entry.path.startsWith(`${d.path}/`))) return false
    return draggedItems.some(d => parentFolder(d.path) !== entry.path)
  }

  // ── Uploading local files ──────────────────────────────────────────────────
  // Files or whole folders dragged in from the OS, or picked from the context
  // menu, go straight to the background upload queue as one upload proposal
  // per file. A dropped folder keeps its nesting under the target folder.
  const [fileDragOver, setFileDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  // Folder the next picker selection uploads into.
  const uploadTargetRef = useRef('')

  const uploadLocalFiles = (folder: string, files: LocalUpload[]): void => {
    if (files.length === 0) return
    queueCompUploads(files.map(({ file, relPath }) => {
      const path = folder ? `${folder}/${relPath}` : relPath
      const form = new FormData()
      form.append('file_path', path)
      form.append('change_type', 'upload')
      form.append('contributor_notes', '')
      form.append('file', file)
      if (activeChannel) form.append('channel', activeChannel)
      return { label: relPath, form, bytes: file.size }
    }))
  }

  const openUploadPicker = (folder: string, kind: 'files' | 'folder'): void => {
    uploadTargetRef.current = folder
    const input = kind === 'folder' ? folderInputRef.current : fileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  /** An OS file drag, as opposed to dragging rows around inside the listing. */
  const isExternalDrag = (e: React.DragEvent): boolean =>
    canPropose && draggedItems.length === 0 && isFileDrag(e.dataTransfer)

  const dropTargetProps = (entry: JWApiFileEntry): {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
  } => ({
    onDragOver: e => {
      if (isExternalDrag(e) && entry.type === 'directory') {
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'
        setFileDragOver(false)
        setDropTarget(entry.path)
        return
      }
      if (!dropAllowed(entry)) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      setDropTarget(entry.path)
    },
    onDragLeave: () => setDropTarget(prev => (prev === entry.path ? null : prev)),
    onDrop: e => {
      e.preventDefault(); e.stopPropagation()
      if (isExternalDrag(e)) {
        setDropTarget(null); setFileDragOver(false)
        if (entry.type === 'directory') collectDroppedFiles(e.dataTransfer).then(files => uploadLocalFiles(entry.path, files)).catch(() => {})
        return
      }
      if (!dropAllowed(entry)) { setDraggedItems([]); setDropTarget(null); return }
      if (entry.type === 'directory') stageMovesInto(entry.path, draggedItems)
      // Onto a file: both sides move into a folder that doesn't exist yet, so
      // ask for its name before anything is staged.
      else setBundlePrompt({ target: { path: entry.path, isDir: false }, items: draggedItems, name: 'New Folder' })
      setDraggedItems([]); setDropTarget(null)
    },
  })

  /** The ".." row doubles as a drop target for moving entries up a level. */
  const parentDropProps = {
    onDragOver: (e: React.DragEvent): void => {
      if (draggedItems.length === 0) return
      const parent = parentFolder(currentPath)
      if (!draggedItems.some(d => parentFolder(d.path) !== parent)) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      setDropTarget('..')
    },
    onDragLeave: (): void => setDropTarget(prev => (prev === '..' ? null : prev)),
    onDrop: (e: React.DragEvent): void => {
      e.preventDefault(); e.stopPropagation()
      stageMovesInto(parentFolder(currentPath), draggedItems)
      setDraggedItems([]); setDropTarget(null)
    },
  }

  const confirmBundle = (): void => {
    if (!bundlePrompt) return
    const name = bundlePrompt.name.trim().replace(/[/\\]/g, '')
    if (!name) return
    const parent = parentFolder(bundlePrompt.target.path)
    const folderPath = parent ? `${parent}/${name}` : name
    stageMovesInto(folderPath, [bundlePrompt.target, ...bundlePrompt.items.filter(d => d.path !== bundlePrompt.target.path)])
    setBundlePrompt(null)
  }

  const confirmNewFolder = (): void => {
    if (newFolderPrompt === null) return
    const name = newFolderPrompt.trim().replace(/[/\\]/g, '')
    if (!name) return
    const folderPath = currentPath ? `${currentPath}/${name}` : name
    stageFileChanges([{ changeType: 'create_folder', path: folderPath, channel: activeChannel }])
    if (stagedFileChanges.length === 0) setShowUploadManager(true)
    setNewFolderPrompt(null)
  }

  /** Row classes/badge for an entry with a queued move, so staged work is
   *  visible in the listing and not only in the Uploads panel. */
  const stagedBadge = (path: string): JSX.Element | null => {
    const staged = stagedMoves.get(path)
    if (!staged) return null
    return (
      <span
        className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-accent bg-accent/15 px-1.5 py-0.5 rounded-md"
        title={`Queued: move to ${staged.destination}`}
      >
        <FolderInput size={9} /> Queued
      </span>
    )
  }

  const crumbs = breadcrumbs(currentPath)
  const channelDescription = channels.find((c) => c.slug === activeChannel)?.description?.trim() || ''

  const SortIcon = ({ by }: { by: SortBy }): JSX.Element => {
    if (sortBy !== by) return <ArrowUpDown size={11} className="opacity-40" />
    return sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pb-3 shrink-0 pt-5">
          <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <HardDrive size={18} className="text-text-muted shrink-0" />
              <h1 className="text-text-primary text-xl font-bold shrink-0">API Files</h1>
              {channelDescription && (
                <p className="text-text-muted text-sm truncate max-w-xl">{channelDescription}</p>
              )}
            </div>
            {/* Queued drag-and-drop changes live in the Uploads panel (that's
                where Propose is), so this is a pointer to them rather than a
                second place to act. */}
            {stagedCount > 0 && (
              <button
                onClick={() => setShowUploadManager(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors shrink-0"
                title="Review staged changes in the Uploads panel"
              >
                <FolderInput size={13} /> {stagedCount} staged change{stagedCount === 1 ? '' : 's'}
              </button>
            )}
            <div className="flex items-center gap-3 ml-auto">
              {channels.length > 0 && (
                <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5">
                  {channels.map((ch) => (
                    <button
                      key={ch.slug}
                      onClick={() => onChannelChange(ch.slug)}
                      disabled={channels.length === 1}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${activeChannel === ch.slug ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'} disabled:opacity-70`}
                      title={ch.description || ch.name}
                    >{ch.name}</button>
                  ))}
                </div>
              )}
              {/* Sort controls */}
              <div className="flex items-center gap-1 text-text-muted">
                {(['name', 'type', 'size'] as SortBy[]).map((by) => (
                  <button
                    key={by}
                    onClick={() => toggleSort(by)}
                    className={`flex items-center gap-0.5 text-xs px-2 py-1 rounded-md transition-colors capitalize ${
                      sortBy === by
                        ? 'bg-surface-raised text-text-primary'
                        : 'hover:text-text-secondary hover:bg-surface-overlay'
                    }`}
                    title={`Sort by ${by}`}
                  >
                    {by}
                    <SortIcon by={by} />
                  </button>
                ))}
              </div>
              {/* Type filter */}
              <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5">
                {MEDIA_FILTERS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTypeFilter(key)}
                    className={`p-2 rounded-md transition-colors ${typeFilter === key ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                    title={`Show ${label.toLowerCase()}`}
                  ><Icon size={14} /></button>
                ))}
              </div>
              {/* View toggle */}
              <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                  title="List view"
                ><LayoutList size={15} /></button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                  title="Grid view"
                ><LayoutGrid size={15} /></button>
              </div>
            </div>
          </div>

          {/* Search - recursive across the whole file tree (same /files/browse/
              `search` param the session-ZIP lookup uses), not scoped to the
              current folder. */}
          {(
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files…"
                className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg pl-8 pr-8 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setDebouncedSearch('') }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Nav bar */}
          {(
            isSearching ? (
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                {searchLoading
                  ? <><Loader2 size={12} className="animate-spin" /> Searching…</>
                  : <>{searchResults.length} result{searchResults.length === 1 ? '' : 's'} for "{debouncedSearch.trim()}"</>}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button onClick={goBack} disabled={history.length === 0 && !currentPath}
                  className="p-1.5 rounded-lg hover:bg-surface-overlay disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Back">
                  <ArrowLeft size={15} className="text-text-muted" />
                </button>
                <button onClick={goHome} className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors" title="Root">
                  <Home size={15} className="text-text-muted" />
                </button>
                <div className="flex items-center gap-0.5 overflow-hidden ml-1 flex-1 min-w-0">
                  <button
                    onClick={goHome}
                    className={`text-xs px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                      crumbs.length === 0 ? 'text-text-primary font-medium' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                    }`}
                  >Root</button>
                  {crumbs.map((crumb, i) => (
                    <div key={crumb.path} className="flex items-center gap-0.5 min-w-0 shrink-0">
                      <ChevronRight size={12} className="text-text-muted shrink-0" />
                      <button
                        onClick={() => navigate(crumb.path)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors truncate max-w-[140px] ${
                          i === crumbs.length - 1 ? 'text-text-primary font-medium' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                        }`}
                        title={crumb.path}
                      >{crumb.label}</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {/* Content */}
        <div
          className={`flex-1 overflow-y-auto px-5 pb-4 transition-colors ${fileDragOver ? 'bg-accent/[0.04] ring-2 ring-inset ring-accent/40' : ''}`}
          // Dropping OS files/folders on empty space uploads into the folder
          // being browsed; folder rows handle drops onto themselves.
          onDragOver={e => {
            if (isSearching || !isExternalDrag(e)) return
            e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
            setFileDragOver(true)
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDragOver(false)
          }}
          onDrop={e => {
            if (isSearching || !isExternalDrag(e)) return
            e.preventDefault()
            setFileDragOver(false)
            const folder = currentPath
            collectDroppedFiles(e.dataTransfer).then(files => uploadLocalFiles(folder, files)).catch(() => {})
          }}
          onContextMenu={e => {
            // Entry rows stop propagation on their own context menu, so this
            // only fires for a right-click on actual empty space.
            if (isSearching) return
            e.preventDefault()
            setBgCtxMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {(isSearching ? searchLoading : loading) ? (
            <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 size={18} className="animate-spin" /><span className="text-sm">{isSearching ? 'Searching…' : 'Loading…'}</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <p className="text-text-muted text-sm">{error}</p>
              <button onClick={() => navigate(currentPath, false)} className="text-accent text-sm underline">Retry</button>
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Music2 size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">{isSearching ? `No files match "${debouncedSearch.trim()}"` : 'Nothing here'}</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Filter size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">No {typeFilter} files here</p>
            </div>
          ) : viewMode === 'list' ? (
            /* ── List view ────────────────────────────────────────────────────── */
            <div className="space-y-0.5">
              {currentPath && !isSearching && (
                <button
                  onClick={goBack}
                  {...parentDropProps}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left ${
                    dropTarget === '..' ? 'bg-accent/15 ring-2 ring-accent/50' : 'hover:bg-surface-overlay'
                  }`}
                >
                  <div className="w-9 h-9 flex items-center justify-center shrink-0">
                    {dropTarget === '..'
                      ? <CornerLeftUp size={18} className="text-accent" />
                      : <FolderOpen size={18} className="text-text-muted" />}
                  </div>
                  <span className={`text-sm ${dropTarget === '..' ? 'text-accent' : 'text-text-muted'}`}>
                    {dropTarget === '..' ? 'Move up a level' : '..'}
                  </span>
                </button>
              )}
              {filteredEntries.map((entry) => {
                const isDir = entry.type === 'directory'
                const mt = isDir ? 'folder' : getMediaType(entry.name)
                const ext = getFileExt(entry.name).slice(1).toUpperCase()
                const isMedia = mt === 'image' || mt === 'video'
                const isSelected = selectedPaths.has(entry.path)
                const isLiked = mt === 'audio' && likedSet.has(apiFileTrackId(entry.path, trackChannel))
                const isDropTarget = dropTarget === entry.path
                const isStaged = stagedMoves.has(entry.path)
                return (
                  <div key={entry.path}
                    {...dragSourceProps(entry)}
                    {...dropTargetProps(entry)}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-default ${
                      isDropTarget ? 'bg-accent/15 ring-2 ring-accent/50'
                        : isSelected ? 'bg-accent/10 hover:bg-accent/15'
                        : isStaged ? 'bg-accent/[0.06] ring-1 ring-accent/30 hover:bg-accent/10'
                        : 'hover:bg-surface-overlay'
                    }`}
                    onClick={(e) => {
                      if (mouseLongPress.consumeFired()) return
                      if (e.ctrlKey || e.metaKey) {
                        toggleSelect(entry.path)
                        return
                      }
                      if (selectMode) { toggleSelect(entry.path); return }
                      if (isDir) navigate(entry.path)
                      else if (isMedia) openLightbox(entry)
                      else if (mt === 'text') openApiText(entry)
                    }}
                    onDoubleClick={() => { if (!selectMode && mt === 'audio') handlePlay(entry) }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openContextMenu(entry, e.clientX, e.clientY) }}
                    {...mouseLongPress.bind(() => enterSelectMode(entry))}
                    onTouchStart={() => handleLongPressStart(entry)}
                    onTouchEnd={handleLongPressEnd}
                  >
                    {/* Checkbox (select mode) */}
                    {selectMode && (
                      <div className="shrink-0 w-5 flex items-center justify-center">
                        {isSelected
                          ? <CheckSquare2 size={16} className="text-accent" />
                          : <Square size={16} className="text-text-muted opacity-50" />}
                      </div>
                    )}
                    {/* Icon / thumbnail */}
                    <div className="relative shrink-0 w-9 h-9">
                      {isDir ? (
                        <div className="w-9 h-9 flex items-center justify-center">
                          <Folder size={20} className={`transition-colors ${isSelected ? 'text-accent' : 'text-text-secondary group-hover:text-accent'}`} />
                        </div>
                      ) : mt === 'audio' ? (
                        <button
                          className="relative w-9 h-9 rounded overflow-hidden"
                          onClick={(e) => { e.stopPropagation(); if (!selectMode) handlePlay(entry) }}
                          title="Play"
                        >
                          <ApiCoverThumb path={entry.path} size={36} />
                          {!selectMode && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded">
                              {playing === entry.path ? <Loader2 size={14} className="text-white animate-spin" /> : <Play size={14} fill="white" className="text-white ml-0.5" />}
                            </div>
                          )}
                        </button>
                      ) : mt === 'image' ? (
                        <div className="w-9 h-9"><ApiImageThumb path={entry.path} size={36} /></div>
                      ) : mt === 'video' ? (
                        <div className="w-9 h-9 flex items-center justify-center"><Video size={18} className="text-text-muted" /></div>
                      ) : mt === 'text' ? (
                        <div className="w-9 h-9 flex items-center justify-center"><FileText size={18} className="text-text-muted" /></div>
                      ) : (
                        <div className="w-9 h-9 flex items-center justify-center"><Music2 size={18} className="text-text-muted opacity-40" /></div>
                      )}
                    </div>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm truncate ${isDir ? 'text-text-primary font-medium cursor-pointer' : 'text-text-secondary'}`}>{entry.name}</span>
                      {isSearching && parentFolder(entry.path) && (
                        <span className="block text-text-muted text-[10px] truncate">{parentFolder(entry.path)}</span>
                      )}
                    </span>
                    {stagedBadge(entry.path)}
                    {isLiked && (
                      <button
                        className="shrink-0 p-1 text-accent disabled:opacity-40"
                        disabled={!channelsReady}
                        onClick={(e) => { e.stopPropagation(); toggleApiFileLike(entry.path) }}
                        title="Unlike"
                      >
                        <Heart size={13} fill="currentColor" />
                      </button>
                    )}
                    {!isDir && entry.size != null && (
                      <span className="hidden md:inline-block text-text-muted text-xs shrink-0 w-14 text-right">{(entry.size / 1_048_576).toFixed(1)} MB</span>
                    )}
                    {!isDir && <span className="hidden md:inline-block text-center text-[10px] uppercase tracking-wide text-text-muted bg-surface-overlay px-1.5 py-0.5 rounded shrink-0 w-12">{ext}</span>}
                    {/* Touch devices can't right-click (long-press enters
                        select mode instead), so the context menu needs a
                        visible trigger: always shown on mobile, hover-reveal
                        on desktop where right-click already works. */}
                    {!selectMode && (
                      <button
                        className="shrink-0 p-2 -my-1.5 text-text-muted md:opacity-0 md:group-hover:opacity-100 hover:text-text-primary active:text-accent transition-all"
                        onClick={(e) => { e.stopPropagation(); openContextMenu(entry, e.clientX, e.clientY) }}
                        title="More options"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* ── Grid view ────────────────────────────────────────────────────── */
            <div className="grid gap-3 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {currentPath && !isSearching && (
                <button
                  onClick={goBack}
                  {...parentDropProps}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-colors ${
                    dropTarget === '..' ? 'bg-accent/15 ring-2 ring-accent/50' : 'bg-surface-overlay hover:bg-surface-raised'
                  }`}
                >
                  <div className="w-full aspect-square flex items-center justify-center">
                    {dropTarget === '..'
                      ? <CornerLeftUp size={40} className="text-accent" />
                      : <FolderOpen size={40} className="text-text-muted" />}
                  </div>
                  <span className={`text-xs ${dropTarget === '..' ? 'text-accent' : 'text-text-muted'}`}>
                    {dropTarget === '..' ? 'Move up' : '..'}
                  </span>
                </button>
              )}
              {filteredEntries.map((entry) => {
                const isDir = entry.type === 'directory'
                const mt = isDir ? 'folder' : getMediaType(entry.name)
                const ext = getFileExt(entry.name).slice(1).toUpperCase()
                const isMedia = mt === 'image' || mt === 'video'
                const isSelected = selectedPaths.has(entry.path)
                const isLiked = mt === 'audio' && likedSet.has(apiFileTrackId(entry.path, trackChannel))
                const isDropTarget = dropTarget === entry.path
                const isStaged = stagedMoves.has(entry.path)
                return (
                  <div key={entry.path}
                    {...dragSourceProps(entry)}
                    {...dropTargetProps(entry)}
                    className={`group flex flex-col rounded-xl overflow-hidden transition-colors cursor-default ${
                      isDropTarget ? 'bg-accent/15 ring-2 ring-accent/60'
                        : isSelected ? 'bg-accent/10 ring-2 ring-accent/40'
                        : isStaged ? 'bg-accent/[0.06] ring-1 ring-accent/30'
                        : 'bg-surface-overlay hover:bg-surface-raised'
                    }`}
                    onClick={(e) => {
                      if (mouseLongPress.consumeFired()) return
                      if (e.ctrlKey || e.metaKey) {
                        toggleSelect(entry.path)
                        return
                      }
                      if (selectMode) { toggleSelect(entry.path); return }
                      if (isDir) navigate(entry.path)
                      else if (isMedia) openLightbox(entry)
                      else if (mt === 'audio') handlePlay(entry)
                      else if (mt === 'text') openApiText(entry)
                    }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openContextMenu(entry, e.clientX, e.clientY) }}
                    {...mouseLongPress.bind(() => enterSelectMode(entry))}
                    onTouchStart={() => handleLongPressStart(entry)}
                    onTouchEnd={handleLongPressEnd}
                  >
                    {/* Thumb */}
                    <div className="relative w-full aspect-square bg-surface-raised flex items-center justify-center overflow-hidden">
                      {isDir ? (
                        <Folder size={40} className={`transition-colors ${isSelected ? 'text-accent' : 'text-text-secondary group-hover:text-accent'}`} />
                      ) : mt === 'audio' ? (
                        <>
                          <ProgressiveCover src={buildCoverArtUrl(entry.path, false, activeChannel)} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          {!selectMode && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                              {playing === entry.path
                                ? <Loader2 size={24} className="text-white animate-spin" />
                                : <Play size={24} fill="white" className="text-white ml-0.5" />}
                            </div>
                          )}
                        </>
                      ) : mt === 'image' ? (
                        <>
                          <ProgressiveCover src={buildStreamUrl(entry.path, activeChannel)} alt={entry.name} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          {!selectMode && (
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <ImageIcon size={16} className="text-white" />
                              </div>
                            </div>
                          )}
                        </>
                      ) : mt === 'video' ? (
                        <>
                          <Video size={36} className="text-text-muted" />
                          {!selectMode && (
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <Play size={16} fill="white" className="text-white ml-0.5" />
                              </div>
                            </div>
                          )}
                        </>
                      ) : mt === 'text' ? (
                        <>
                          <FileText size={36} className="text-text-muted" />
                          {!selectMode && (
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <FileText size={16} className="text-white" />
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs uppercase text-text-muted">{ext}</span>
                      )}
                      {/* Checkbox overlay (select mode) */}
                      {selectMode && (
                        <div className="absolute top-1.5 left-1.5 z-10">
                          {isSelected
                            ? <CheckSquare2 size={18} className="text-accent drop-shadow" />
                            : <Square size={18} className="text-white/70 drop-shadow" />}
                        </div>
                      )}
                      {/* Liked indicator */}
                      {isLiked && (
                        <button
                          className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-40"
                          disabled={!channelsReady}
                          onClick={(e) => { e.stopPropagation(); toggleApiFileLike(entry.path) }}
                          title="Unlike"
                        >
                          <Heart size={12} fill="currentColor" className="text-accent" />
                        </button>
                      )}
                    </div>
                    {/* Label */}
                    <div className="px-2 py-2 flex items-center gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-xs font-medium truncate">{entry.name}</p>
                        {!isDir && <p className="text-text-muted text-[10px] uppercase tracking-wide mt-0.5">{ext}</p>}
                      </div>
                      {stagedBadge(entry.path)}
                      {/* Same visible context-menu trigger as the list rows -
                          right-click/long-press aren't discoverable on touch. */}
                      {!selectMode && (
                        <button
                          className="shrink-0 p-1.5 -m-1 text-text-muted md:opacity-0 md:group-hover:opacity-100 hover:text-text-primary active:text-accent transition-all"
                          onClick={(e) => { e.stopPropagation(); openContextMenu(entry, e.clientX, e.clientY) }}
                          title="More options"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Selection action bar */}
        {selectMode && (
          <div className="shrink-0 border-t border-[var(--border)] bg-surface px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm text-text-primary font-medium flex-1">
              {selectedPaths.size} {selectedPaths.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={selectAllEntries}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Select all
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
            {/* Deletion only: a replace swaps one file's body for another,
                which has no meaning across a selection. Directories are
                dropped - proposals target files. */}
            {canPropose && (
              <button
                onClick={() => {
                  const paths = filteredEntries
                    .filter(e => e.type !== 'directory' && selectedPaths.has(e.path))
                    .map(e => e.path)
                  if (paths.length === 0) return
                  setPendingCompProposal({ paths, changeType: 'delete' })
                  exitSelectMode()
                  setActiveView('contributor')
                }}
                disabled={selectedPaths.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-text-secondary hover:text-text-primary hover:border-accent/40 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={13} /> Propose deletion
              </button>
            )}
            <button
              onClick={downloadZip}
              disabled={selectedPaths.size === 0 || zipStatus === 'starting' || zipStatus === 'zipping'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
            >
              {zipStatus === 'starting' || zipStatus === 'zipping' ? (
                <><Loader2 size={13} className="animate-spin" /> {zipStatus === 'starting' ? 'Starting…' : 'Downloading…'}</>
              ) : zipStatus === 'done' ? (
                <><Check size={13} /> Done</>
              ) : zipStatus === 'error' ? (
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
        )}
      </div>

      {copiedPath && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary">
          <Check size={13} className="text-accent" /> {copiedKind === 'path' ? 'Path copied' : 'Link copied'}
        </div>
      )}

      {boostToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary">
          <Heart size={13} className="text-pink-400" fill="currentColor" /> Priority routing active
        </div>
      )}

      {/* Folder-download progress toast - the selection bar above already
          shows download status while selectMode is active, so this only
          covers the single-folder "Download folder" context-menu action. */}
      {!selectMode && zipStatus !== 'idle' && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary">
          {zipStatus === 'starting' || zipStatus === 'zipping' ? (
            <><Loader2 size={13} className="animate-spin text-accent" /> {zipStatus === 'starting' ? 'Starting…' : 'Downloading folder…'}</>
          ) : zipStatus === 'done' ? (
            <><Check size={13} className="text-accent" /> Downloaded</>
          ) : (
            <><X size={13} className="text-red-400" /> Download failed</>
          )}
        </div>
      )}

      {/* Name prompt for the drop-a-file-onto-a-file gesture: both files move
          into a folder that doesn't exist yet, and its name is the one thing
          the drag itself can't say. */}
      {bundlePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setBundlePrompt(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-surface p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-text-primary text-sm font-semibold mb-1">New folder</h3>
            <p className="text-text-muted text-xs mb-3">
              Queues a new folder holding {bundlePrompt.items.filter(d => d.path !== bundlePrompt.target.path).length + 1} items, in {parentFolder(bundlePrompt.target.path) || 'the root folder'}.
            </p>
            <input
              autoFocus
              value={bundlePrompt.name}
              onChange={e => setBundlePrompt(prev => prev && { ...prev, name: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmBundle()
                if (e.key === 'Escape') setBundlePrompt(null)
              }}
              onFocus={e => e.target.select()}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setBundlePrompt(null)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors">Cancel</button>
              <button
                onClick={confirmBundle}
                disabled={!bundlePrompt.name.trim()}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              >Queue folder</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden pickers behind the context menu's upload items. */}
      <input ref={fileInputRef} type="file" multiple className="hidden"
        onChange={e => uploadLocalFiles(uploadTargetRef.current, filesFromInput(e.target.files))} />
      <input
        ref={el => { folderInputRef.current = el; el?.setAttribute('webkitdirectory', '') }}
        type="file" multiple className="hidden"
        onChange={e => uploadLocalFiles(uploadTargetRef.current, filesFromInput(e.target.files))}
      />

      {textFile && <TextFileViewer source={textFile} onClose={() => setTextFile(null)} />}

      {lightboxIndex >= 0 && lightboxItems.length > 0 && (
        <MediaLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onNav={setLightboxIndex}
        />
      )}

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <ClampedMenu
            ref={ctxMenuRef}
            x={ctxMenu.x}
            y={ctxMenu.y}
            className="min-w-[180px]"
            onPositioned={setCtxMenuPos}
          >
            {/* Playlist flyout - a child of the menu so the click-away overlay
                still counts clicks in it as "inside", but positioned beside it. */}
            {playlistsOpen && (
              <div
                ref={playlistFlyoutRef}
                onClick={e => e.stopPropagation()}
                style={{ position: 'fixed', zIndex: 60, top: playlistFlyoutPos.top, left: playlistFlyoutPos.left }}
                className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
              >
                {!account ? (
                  <div className="px-3 py-2">
                    <p className="text-xs text-text-muted mb-2">Log in to save to playlists.</p>
                    <button
                      onClick={() => { setShowUserAuth(true); setCtxMenu(null) }}
                      className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
                    >Log in</button>
                  </div>
                ) : playlists.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto">
                    {playlists.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          const songId = trackerMatches.get(ctxMenu.entry.path)
                          if (songId != null) addToPlaylist(p.id, songId)
                        }}
                        disabled={playlistBusyId === p.id}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                      >
                        <ListMusic size={13} className="shrink-0 text-text-muted" />
                        <span className="flex-1 truncate text-xs">{p.name}</span>
                        {playlistBusyId === p.id
                          ? <Loader2 size={12} className="animate-spin shrink-0" />
                          : playlistDoneId === p.id
                            ? <Check size={12} className="text-accent shrink-0" />
                            : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {getMediaType(ctxMenu.entry.name) === 'audio' && (
              <>
                <button onClick={() => { handlePlay(ctxMenu.entry); setCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <Play size={14} className="text-text-muted" /> Play
                </button>
                <button onClick={async () => { const e = ctxMenu.entry; setCtxMenu(null); addToQueue(fileToTrack(e, (await resolveTrackChannel()) ?? activeChannel)) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <ListPlus size={14} className="text-text-muted" /> Add to queue
                </button>
                {trackerMatches.get(ctxMenu.entry.path) != null && (
                  <button
                    ref={playlistItemRef}
                    onClick={() => setPlaylistsOpen(o => !o)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                    <Plus size={14} className="text-text-muted" /> Add to playlist
                    <ChevronRight size={13} className="ml-auto text-text-muted" />
                  </button>
                )}
                <button onClick={() => { toggleApiFileLike(ctxMenu.entry.path); setCtxMenu(null) }}
                  disabled={!channelsReady}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40">
                  <Heart size={14} fill={likedTrackIds.includes(apiFileTrackId(ctxMenu.entry.path, trackChannel)) ? 'currentColor' : 'none'}
                    className={likedTrackIds.includes(apiFileTrackId(ctxMenu.entry.path, trackChannel)) ? 'text-accent' : 'text-text-muted'} />
                  {likedTrackIds.includes(apiFileTrackId(ctxMenu.entry.path, trackChannel)) ? 'Unlike' : 'Like'}
                </button>
                {trackerMatches.get(ctxMenu.entry.path) != null && (
                  <button onClick={() => { openSongInfo(ctxMenu.entry); setCtxMenu(null) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                    <Info size={14} className="text-text-muted" /> Find in Tracker
                  </button>
                )}
                {canEdit && (
                  <button onClick={async () => {
                    const title = ctxMenu.entry.name.replace(/\.[^.]+$/, '')
                    setCtxMenu(null)
                    try {
                      const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search: title, page_size: 1 })
                      const id = data.results[0]?.id
                      if (id) useStore.getState().openSongEditor(id)
                    } catch {}
                  }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                    <Pencil size={14} className="text-text-muted" /> Edit
                  </button>
                )}
                <div className="border-t border-[var(--border)] my-1" />
              </>
            )}
            {getMediaType(ctxMenu.entry.name) === 'text' && (
              <button onClick={() => { openApiText(ctxMenu.entry); setCtxMenu(null) }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                <FileText size={14} className="text-text-muted" /> View
              </button>
            )}
            <button onClick={() => enterSelectMode(ctxMenu.entry)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
              <CheckSquare2 size={14} className="text-text-muted" /> Select
            </button>
            <button onClick={() => { copyLink(ctxMenu.entry); setCtxMenu(null) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
              <Link size={14} className="text-text-muted" /> Copy link
            </button>
            <button onClick={() => { copyPath(ctxMenu.entry); setCtxMenu(null) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
              <Clipboard size={14} className="text-text-muted" /> Copy path
            </button>
            {/* Contributor actions - proposals target a file, so directories
                are excluded. Both land on the contributor page prefilled. */}
            {canPropose && ctxMenu.entry.type !== 'directory' && (
              <>
                <div className="border-t border-[var(--border)] my-1" />
                <button onClick={() => {
                  setPendingCompProposal({ paths: [ctxMenu.entry.path], changeType: 'replace' })
                  setCtxMenu(null)
                  setActiveView('contributor')
                }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <Replace size={14} className="text-text-muted" /> Propose replacement
                </button>
                <button onClick={() => {
                  setPendingCompProposal({ paths: [ctxMenu.entry.path], changeType: 'delete' })
                  setCtxMenu(null)
                  setActiveView('contributor')
                }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <Trash2 size={14} className="text-text-muted" /> Propose deletion
                </button>
                <div className="border-t border-[var(--border)] my-1" />
              </>
            )}
            {canPropose && ctxMenu.entry.type === 'directory' && (
              <>
                <div className="border-t border-[var(--border)] my-1" />
                <button onClick={() => { openUploadPicker(ctxMenu.entry.path, 'files'); setCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <Upload size={14} className="text-text-muted" /> Upload files here
                </button>
                <button onClick={() => { openUploadPicker(ctxMenu.entry.path, 'folder'); setCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <FolderInput size={14} className="text-text-muted" /> Upload folder here
                </button>
                <div className="border-t border-[var(--border)] my-1" />
              </>
            )}
            {ctxMenu.entry.type === 'directory' ? (
              <button onClick={() => { downloadFolder(ctxMenu.entry); setCtxMenu(null) }}
                disabled={zipStatus === 'starting' || zipStatus === 'zipping'}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50">
                <PackageOpen size={14} className="text-text-muted" /> Download folder
              </button>
            ) : (
              <button onClick={() => { handleDownload(ctxMenu.entry); setCtxMenu(null) }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                <Download size={14} className="text-text-muted" /> Download
              </button>
            )}
          </ClampedMenu>
        </>
      )}

      {bgCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setBgCtxMenu(null)} />
          <ClampedMenu x={bgCtxMenu.x} y={bgCtxMenu.y} className="min-w-[180px]">
            <button onClick={() => { navigate(currentPath, false); setBgCtxMenu(null) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
              <RefreshCw size={14} className="text-text-muted" /> Refresh
            </button>
            {canPropose && (
              <>
                <div className="border-t border-[var(--border)] my-1" />
                <button onClick={() => { openUploadPicker(currentPath, 'files'); setBgCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <Upload size={14} className="text-text-muted" /> Upload files
                </button>
                <button onClick={() => { openUploadPicker(currentPath, 'folder'); setBgCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <FolderInput size={14} className="text-text-muted" /> Upload folder
                </button>
                {/* The Contributor page is still where an upload gets notes or a
                    rename before it's proposed. */}
                <button onClick={() => {
                  setPendingCompProposal({ paths: [currentPath], changeType: 'upload' })
                  setBgCtxMenu(null)
                  setActiveView('contributor')
                }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <FileText size={14} className="text-text-muted" /> Upload with notes…
                </button>
                <button onClick={() => { setNewFolderPrompt(''); setBgCtxMenu(null) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors">
                  <FolderPlus size={14} className="text-text-muted" /> New folder
                </button>
              </>
            )}
          </ClampedMenu>
        </>
      )}

      {newFolderPrompt !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setNewFolderPrompt(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-surface p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-text-primary text-sm font-semibold mb-1">New folder</h3>
            <p className="text-text-muted text-xs mb-3">
              Queues a new folder in {currentPath || 'the root folder'}.
            </p>
            <input
              autoFocus
              value={newFolderPrompt}
              onChange={e => setNewFolderPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmNewFolder()
                if (e.key === 'Escape') setNewFolderPrompt(null)
              }}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setNewFolderPrompt(null)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors">Cancel</button>
              <button
                onClick={confirmNewFolder}
                disabled={!newFolderPrompt.trim()}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              >Queue folder</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
