import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Folder, Music2, ChevronRight, ArrowLeft, Home, Play, Loader2,
  FolderOpen, HardDrive, LayoutList, LayoutGrid, ImageIcon, Video,
  Download, ArrowUpDown, ArrowUp, ArrowDown, Link, Check, Info, ListPlus, Heart,
  X, Pencil, PackageOpen, CheckSquare2, Square, MonitorSmartphone, Globe, Search,
  Filter, MoreHorizontal, Clipboard, Plus, ListMusic, Replace, Trash2,
  FolderPlus, FilePlus, ExternalLink, FileText, RefreshCw, Upload,
  FolderInput, CornerLeftUp,
} from 'lucide-react'
import { useStore, useStorePick, StagedFileChange } from '../store/useStore'
import { queueCompUploads } from '../lib/compUploads'
import {
  breadcrumbs, parentFolder, fileToTrack, sortEntries, pathToUrl, fileEntryLinkUrl, findSongByFilename, triggerDownload,
  type ViewMode, type SortBy, type SortDir,
} from '../lib/apiFilesShared'
import { useApiFilesBrowse } from '../hooks/useApiFilesBrowse'
import { useTrackerMatches } from '../hooks/useTrackerMatches'
import { useAddFileToPlaylist } from '../hooks/useAddFileToPlaylist'
import { usePlayFileEntry } from '../hooks/usePlayFileEntry'
import { useFileLightbox } from '../hooks/useFileLightbox'
import { useTrackChannel } from '../hooks/useTrackChannel'
import { collectDroppedFiles, filesFromInput, isFileDrag, type LocalUpload } from '../lib/droppedFiles'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import {
  apiFetch,
  searchFiles,
  apiPeek,
  buildStreamUrl,
  buildCoverArtUrl,
  smallCoverUrl,
  apiFileTrackId,
  apiFilePathToTrack,
  parseBrowseEntries as parseEntries,
  JWApiFileEntry,
  JWApiBrowseResponse,
  JWApiSong,
  JWApiPaginatedResponse,
  JWAPI_BASE,
} from '../lib/juicewrldApi'
import { getFileExt, getMediaType, toFileUrl } from '../lib/fileTypes'
import { basename } from '../lib/compStagedChanges'
import { startCdnFileDownload } from '../hooks/useCdnFileDownload'
import { CdnDownloadToast } from './CdnDownloadToast'
import { useMultiSelect } from '../hooks/useMultiSelect'
import ContextMenu from './ContextMenu'
import { Track } from '../types'
import { ProgressiveCover } from './ProgressiveCover'
import MediaLightbox, { LightboxItem } from './MediaLightbox'
import TextFileViewer, { TextFileSource } from './TextFileViewer'

import { useApiFilesZip } from '../hooks/useApiFilesZip'
import { usePendingCompGhosts } from '../hooks/usePendingCompGhosts'
import { PendingGhostItem, PendingMarker } from './PendingCompGhost'

// lucide's `fill` is a prop, not a class, so the filled heart needs to be a
// component of its own to fit a menu item's `icon` slot.
const HeartFilled = (p: React.ComponentProps<typeof Heart>): JSX.Element => <Heart {...p} fill="currentColor" />

type MediaFilter = 'all' | 'audio' | 'image' | 'video' | 'text'

interface LocalEntry { name: string; path: string; type: 'file' | 'directory'; size: number | null }

/** Inline name prompt — renaming an existing entry, or naming a new one. */
type NameEditor =
  | { mode: 'rename'; entry: LocalEntry }
  | { mode: 'create'; kind: 'file' | 'directory' }

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
      // Image entries are served whole by /files/download/ — a browse folder of
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

export default function ApiFilesBrowser(): JSX.Element {
  const { playTrack, addToQueue, apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath, account, setActiveView, setPendingEditorSongId, setPendingCompProposal, likedTrackIds, toggleLike, playlists, refreshPlaylists, setShowUserAuth, channels, activeChannel, setActiveChannel, loadChannels, stagedFileChanges, stageFileChanges, setShowDownloadManager } = useStorePick('playTrack', 'addToQueue', 'apiFilesPath', 'setApiFilesPath', 'apiFilesLastPath', 'setApiFilesLastPath', 'account', 'setActiveView', 'setPendingEditorSongId', 'setPendingCompProposal', 'likedTrackIds', 'toggleLike', 'playlists', 'refreshPlaylists', 'setShowUserAuth', 'channels', 'activeChannel', 'setActiveChannel', 'loadChannels', 'stagedFileChanges', 'stageFileChanges', 'setShowDownloadManager')
  const isPrimary = isPrimaryChannelSlug(channels, activeChannel)
  const canEdit = userApi.isChannelEditor(account, activeChannel, isPrimary)
  const canPropose = userApi.isChannelContributor(account, activeChannel, isPrimary)
  // Set lookup for the per-row liked check — .includes on the array made the
  // listing O(rows × likes).
  const likedSet = useMemo(() => new Set(likedTrackIds), [likedTrackIds])
  const { trackChannel, channelsReady, resolveTrackChannel } = useTrackChannel()
  const [boostToast, setBoostToast] = useState(false)
  // Bails rather than guessing: writing an id built from an unknown channel is
  // what orphans a like. The affordances below are disabled until the list is
  // known, so the id written here always matches the one just rendered.
  const toggleApiFileLike = async (path: string): Promise<void> => {
    const ch = await resolveTrackChannel()
    if (ch === null) return
    toggleLike(apiFileTrackId(path, ch))
  }

  const {
    currentPath, entries, loading, error, history, setHistory, navigate, goBack, goHome, onChannelChange,
    search, setSearch, debouncedSearch, setDebouncedSearch, searchResults, searchLoading, isSearching,
  } = useApiFilesBrowse({
    activeChannel, setActiveChannel, channels, loadChannels,
    apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath,
  })
  const { playing, handlePlay } = usePlayFileEntry(entries, playTrack)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [textFile, setTextFile] = useState<TextFileSource | null>(null)
  const { lightboxItems, setLightboxItems, lightboxIndex, setLightboxIndex, openLightbox } = useFileLightbox({ entries, searchResults, isSearching, activeChannel })
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [copiedKind, setCopiedKind] = useState<'link' | 'path'>('link')
  const { playlistBusyId, playlistDoneId, addToPlaylist, resetPlaylistDone } = useAddFileToPlaylist(refreshPlaylists)
  const [ctxMenu, setCtxMenu] = useState<{ entry: JWApiFileEntry; x: number; y: number } | null>(null)
  // Whether a right-clicked audio file actually has a matching song in the
  // Tracker — resolved lazily per path on menu-open (not for every row up
  // front) so "Find in Tracker" can be hidden for files with no match instead
  // of opening the info modal on nothing. undefined = not looked up yet,
  // null = looked up, no match.
  const { trackerMatches, resolveTrackerMatch } = useTrackerMatches()
  // Closing/reopening the menu clears the "added" ticks so they never carry
  // over to a different entry.
  useEffect(() => {
    resetPlaylistDone()
  }, [ctxMenu])

  // Search — recursive across the whole file tree via /files/browse/'s
  // `search` param (same endpoint findSessionZips uses), not scoped to the
  // current folder. Results replace the browsed folder's entries while
  // active rather than living in a separate list, so sorting/select-mode/
  // context menus all keep working on it unchanged.

  // Multi-select state — see the useMultiSelect() call further down (needs
  // filteredEntries, which isn't defined yet here) for
  // selectMode/selectedPaths/enterSelectMode/toggleSelect/exitSelectMode.
  // Cleared when select mode exits; the zip hook below owns the real reset.
  const zipResetRef = useRef<() => void>(() => {})
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Local files mode (Electron only)
  const isElectron = navigator.userAgent.includes('Electron')
  const [localMode, setLocalMode] = useState(false)
  const [localPath, setLocalPath] = useState('')
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // Local file management: right-click menu, plus the inline name editor that
  // doubles as "rename this entry" and "create a new file/folder here".
  const [localCtxMenu, setLocalCtxMenu] = useState<{ entry: LocalEntry; x: number; y: number } | null>(null)
  // Right-clicking the empty space around the entries — the folder's own menu
  // (new / view / sort / refresh), the way Explorer and Finder behave.
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [bgSubmenu, setBgSubmenu] = useState<'view' | 'sort' | null>(null)
  const [nameEditor, setNameEditor] = useState<NameEditor | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameBusy, setNameBusy] = useState(false)

  const browseLocal = async (dirPath: string): Promise<void> => {
    const el = (window as any).electron
    if (!el) return
    setLocalLoading(true)
    setLocalError(null)
    try {
      const result = await el.browseLocal(dirPath)
      if (result.error) { setLocalError(result.error); return }
      setLocalPath(result.path)
      setLocalEntries(result.entries)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to browse')
    } finally {
      setLocalLoading(false)
    }
  }

  const openLocalFile = async (filePath: string): Promise<void> => {
    const el = (window as any).electron
    if (!el) return
    await el.openPath(filePath)
  }

  const uploadLocalFiles = async (): Promise<void> => {
    const el = (window as any).electron
    if (!el || !localPath) return
    const result = await el.localUpload(localPath)
    if (result?.ok) await browseLocal(localPath)
  }

  // ── Local file management ──────────────────────────────────────────────────
  // Main owns validation, collision handling and the delete confirm; the
  // renderer just collects the name and re-reads the folder afterwards.

  const startRename = (entry: LocalEntry): void => {
    setNameEditor({ mode: 'rename', entry })
    setNameDraft(entry.name)
    setNameError(null)
    setLocalCtxMenu(null)
  }

  const startCreate = (kind: 'file' | 'directory'): void => {
    setNameEditor({ mode: 'create', kind })
    setNameDraft('')
    setNameError(null)
    // Reachable from the entry menu, the background menu and the nav bar —
    // close both menus regardless of which one opened it.
    setLocalCtxMenu(null)
    setBgCtxMenu(null)
  }

  const cancelNameEditor = (): void => {
    setNameEditor(null)
    setNameDraft('')
    setNameError(null)
  }

  const submitNameEditor = async (): Promise<void> => {
    const el = (window as any).electron
    if (!el || !nameEditor || nameBusy) return
    const name = nameDraft.trim()
    if (!name) { setNameError('Name can\'t be empty'); return }
    setNameBusy(true)
    setNameError(null)
    try {
      const result = nameEditor.mode === 'rename'
        ? await el.localRename(nameEditor.entry.path, name)
        : await el.localCreate(localPath, name, nameEditor.kind)
      if (result?.error) { setNameError(result.error); return }
      cancelNameEditor()
      await browseLocal(localPath)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setNameBusy(false)
    }
  }

  const deleteLocalEntry = async (entry: LocalEntry): Promise<void> => {
    const el = (window as any).electron
    if (!el) return
    setLocalCtxMenu(null)
    // Main shows the confirm and moves the item to the OS trash; a cancel
    // comes back as { canceled } and must leave the listing untouched.
    const result = await el.localDelete(entry.path)
    if (result?.ok) await browseLocal(localPath)
  }

  const handleLocalPlay = (entry: { name: string; path: string; type: string; size: number | null }): void => {
    const track = localFileToTrack(entry)
    const queue = localEntries
      .filter(e => e.type === 'file' && getMediaType(e.name) === 'audio')
      .map(localFileToTrack)
    playTrack(track, queue.length > 0 ? queue : [track])
  }

  const openLocalLightbox = (entry: { name: string; path: string; type: string; size: number | null }): void => {
    const mediaEntries = localEntries.filter(e => {
      const mt = getMediaType(e.name)
      return e.type === 'file' && (mt === 'image' || mt === 'video')
    })
    const items: LightboxItem[] = mediaEntries.map(e => ({
      url: toFileUrl(e.path),
      type: getMediaType(e.name) as 'image' | 'video',
      name: e.name,
    }))
    const idx = mediaEntries.findIndex(e => e.path === entry.path)
    setLightboxItems(items)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }

  const pickLocalFolder = async (): Promise<void> => {
    const el = (window as any).electron
    if (!el) return
    const picked = await el.pickFolder()
    if (picked) browseLocal(picked)
  }

  // Init local browse when switching to local mode
  useEffect(() => {
    if (localMode && localEntries.length === 0) {
      browseLocal('')
    }
  }, [localMode]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // `marker` only drives the confirmation toast — any non-empty string will do.
  const copyTextToClipboard = (text: string, what: 'link' | 'path', marker = text): void => {
    const showConfirmed = (): void => {
      setCopiedPath(marker)
      setCopiedKind(what)
      setTimeout(() => setCopiedPath(null), 1800)
    }
    // Electron: use the native clipboard bridge (main.js's 'copy-text-to-clipboard'
    // handler) instead of navigator.clipboard — the app's permission handler
    // denies every web permission request by default, clipboard-write included,
    // so navigator.clipboard.writeText silently fails here (same pattern
    // SongContextMenu's "Copy path" already uses correctly).
    const el = (window as any).electron
    const write = el?.copyTextToClipboard
      ? el.copyTextToClipboard(text)
      : navigator.clipboard.writeText(text)
    write.then(showConfirmed).catch((e: unknown) => console.error('[copy] failed:', e))
  }

  const copyToClipboard = (entry: JWApiFileEntry, text: string, what: 'link' | 'path'): void =>
    copyTextToClipboard(text, what, entry.path)

  const copyLink = (entry: JWApiFileEntry): void => copyToClipboard(entry, fileEntryLinkUrl(entry, activeChannel), 'link')

  // The API-relative path ("Compilation/Folder/song.mp3") — what every
  // /files/* endpoint takes as its `path` param, unlike Copy link's full URL.
  const copyPath = (entry: JWApiFileEntry): void => copyToClipboard(entry, entry.path, 'path')

  // ── Add to playlist ────────────────────────────────────────────────────────
  // Server playlists are keyed by numeric Tracker song id, so this only works
  // for audio files that resolved to a Tracker match (same lookup that gates
  // "Find in Tracker") — the item stays hidden otherwise.

  // Tries the P2P CDN first (primary channel only - /cdn/resolve/ has no
  // channel param, so a non-primary path could collide with a different
  // file of the same name) and falls back to the direct stream URL.
  const handleDownload = (entry: JWApiFileEntry): void => {
    const streamUrl = buildStreamUrl(entry.path, activeChannel)
    if (!isPrimary) { triggerDownload(streamUrl, entry.name); return }
    startCdnFileDownload(entry.path, entry.name, streamUrl).then((isDonor) => {
      if (!isDonor) return
      setBoostToast(true)
      setTimeout(() => setBoostToast(false), 1800)
    })
  }

  // Text viewer — API files come over HTTP from the same stream URL the
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

  const openLocalText = (entry: LocalEntry): void => {
    setTextFile({
      name: entry.name,
      load: async () => {
        const el = (window as any).electron
        if (!el) throw new Error('Unavailable')
        const res = await el.readTextFile(entry.path)
        if (res?.error) throw new Error(res.error)
        return { text: res.text, truncated: res.truncated }
      },
    })
  }

  // ── Selection helpers ──────────────────────────────────────────────────────
  // enterSelectMode/toggleSelect/exitSelectMode are defined further down,
  // right after the useMultiSelect() call (needs filteredEntries) — this
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

  // Type filter — folders stay visible regardless of filter so navigation
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

  // Multi-select — select mode, the selected-paths Map, Escape-to-exit, and
  // Ctrl/Cmd+A "select all" are handled by the shared hook. Value === key
  // (path) here since there's nothing extra to carry per entry — `.has()`/
  // `.size` behave the same as the old Set<string>; only spreads need
  // `.keys()` now instead of spreading the Map itself.
  const {
    selectMode, selected: selectedPaths, selectMany: selectManyPaths, toggle,
    exitSelectMode, selectAll: selectAllEntries, clear: clearSelection,
  } = useMultiSelect<string>({
    onExit: () => zipResetRef.current(),
    ctrlA: {
      getAll: () => new Map(filteredEntries.map(e => [e.path, e.path])),
    },
  })

  // Backend ZIP jobs are disabled, so the archive is built client-side
  // (lib/clientZip) from the entries' stream URLs.
  const { zipStatus, zipProgress, resetZip, downloadZip, downloadFolder } = useApiFilesZip({
    activeChannel,
    getSelectedEntries: () => filteredEntries.filter((e) => selectedPaths.has(e.path)),
  })
  zipResetRef.current = resetZip
  const enterSelectMode = (entry: JWApiFileEntry): void => {
    selectManyPaths(new Map([[entry.path, entry.path]]))
    setCtxMenu(null)
  }
  const toggleSelect = (path: string): void => toggle(path, path)

  // ── Drag-and-drop staging (API mode) ───────────────────────────────────────
  // Contributors can drag entries onto a folder to move them in, or onto a
  // file to bundle both into a new folder. Nothing is proposed on drop: the
  // intended changes are staged (store.stagedFileChanges) and reviewed in the
  // Downloads panel, which is where Propose lives - see lib/compStagedChanges.
  type DragItem = { path: string; isDir: boolean }
  const [draggedItems, setDraggedItems] = useState<DragItem[]>([])
  // Path of the row currently under the cursor, or '..' for the parent row.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [bundlePrompt, setBundlePrompt] = useState<{ target: DragItem; items: DragItem[]; name: string } | null>(null)
  const [newFolderPrompt, setNewFolderPrompt] = useState<string | null>(null)

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
    if (stagedFileChanges.length === 0) setShowDownloadManager(true)
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

  const uploadDroppedFiles = (folder: string, files: LocalUpload[]): void => {
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
        if (entry.type === 'directory') collectDroppedFiles(e.dataTransfer).then(files => uploadDroppedFiles(entry.path, files)).catch(() => {})
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

  const confirmNewApiFolder = (): void => {
    if (newFolderPrompt === null) return
    const name = newFolderPrompt.trim().replace(/[/\\]/g, '')
    if (!name) return
    const folderPath = currentPath ? `${currentPath}/${name}` : name
    stageFileChanges([{ changeType: 'create_folder', path: folderPath, channel: activeChannel }])
    if (stagedFileChanges.length === 0) setShowDownloadManager(true)
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

  const filteredLocalEntries = useMemo(
    () => typeFilter === 'all'
      ? localEntries
      : localEntries.filter((e) => e.type === 'directory' || getMediaType(e.name) === typeFilter),
    [localEntries, typeFilter]
  )

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
        <div className={`px-5 pb-3 shrink-0 ${isElectron ? 'pt-9' : 'pt-5'}`}>
          <div className="flex items-center justify-between mb-3 gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <HardDrive size={18} className="text-text-muted shrink-0" />
              <h1 className="text-text-primary text-xl font-bold shrink-0">API Files</h1>
              {channelDescription && (
                <p className="text-text-muted text-sm truncate">{channelDescription}</p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Queued drag-and-drop changes live in the Downloads panel
                  (that's where Propose is), so this is a pointer to them
                  rather than a second place to act. */}
              {!localMode && stagedCount > 0 && (
                <button
                  onClick={() => setShowDownloadManager(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors shrink-0"
                  title="Review staged changes in the Downloads panel"
                >
                  <FolderInput size={13} /> {stagedCount} staged change{stagedCount === 1 ? '' : 's'}
                </button>
              )}
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
              {/* API / Local toggle (Electron only) */}
              {isElectron && (
                <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-1">
                  <button
                    onClick={() => setLocalMode(false)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${!localMode ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                    title="Browse API files"
                  ><Globe size={12} /> API</button>
                  <button
                    onClick={() => setLocalMode(true)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${localMode ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                    title="Browse local files"
                  ><MonitorSmartphone size={12} /> Local</button>
                </div>
              )}
            </div>
          </div>

          {/* Search — API mode. Recursive across the whole file tree (same
              /files/browse/ `search` param the session-ZIP lookup uses),
              not scoped to the current folder. */}
          {!localMode && (
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

          {/* Nav bar — API mode */}
          {!localMode && (
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

        {/* Local files browser */}
        {localMode && (
          <div
            className="flex-1 overflow-y-auto px-5 pb-4"
            // Entry rows stop propagation and open their own menu, so anything
            // reaching here is genuinely the background. Needs a folder open —
            // "New file" has nowhere to go otherwise.
            onContextMenu={(e) => {
              if (!localPath) return
              e.preventDefault()
              setBgCtxMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {/* Local nav bar */}
            <div className="flex items-center gap-1.5 mb-3">
              <button
                onClick={pickLocalFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-raised border border-[var(--border)] text-text-secondary text-xs font-medium transition-colors"
              ><FolderOpen size={13} /> Change folder</button>
              {localPath && (
                <>
                  <button
                    onClick={() => startCreate('directory')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-raised border border-[var(--border)] text-text-secondary text-xs font-medium transition-colors"
                  ><FolderPlus size={13} /> New folder</button>
                  <button
                    onClick={() => startCreate('file')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-raised border border-[var(--border)] text-text-secondary text-xs font-medium transition-colors"
                  ><FilePlus size={13} /> New file</button>
                  <span className="text-text-muted text-xs truncate flex-1 min-w-0" title={localPath}>{localPath}</span>
                </>
              )}
            </div>

            {/* Inline name prompt — used for both "new file/folder" and
                rename, so there's one place that validates and reports. */}
            {nameEditor && (
              <div className="mb-3 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted shrink-0">
                    {nameEditor.mode === 'rename'
                      ? 'Rename to'
                      : nameEditor.kind === 'directory' ? 'New folder' : 'New file'}
                  </span>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => { setNameDraft(e.target.value); setNameError(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNameEditor()
                      else if (e.key === 'Escape') cancelNameEditor()
                    }}
                    placeholder="Name"
                    className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={submitNameEditor}
                    disabled={nameBusy || !nameDraft.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                  >
                    {nameBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {nameEditor.mode === 'rename' ? 'Rename' : 'Create'}
                  </button>
                  <button
                    onClick={cancelNameEditor}
                    className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
                    title="Cancel"
                  ><X size={15} className="text-text-muted" /></button>
                </div>
                {nameError && <p className="text-xs text-red-400 pl-1">{nameError}</p>}
              </div>
            )}
            {localLoading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
                <Loader2 size={18} className="animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            ) : localError ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <p className="text-text-muted text-sm">{localError}</p>
                <button onClick={() => browseLocal(localPath)} className="text-accent text-sm underline">Retry</button>
              </div>
            ) : localEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <MonitorSmartphone size={32} className="text-text-muted opacity-30" />
                <p className="text-text-muted text-sm">No files found</p>
                <button onClick={pickLocalFolder} className="text-accent text-sm underline">Pick a folder</button>
              </div>
            ) : filteredLocalEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Filter size={32} className="text-text-muted opacity-30" />
                <p className="text-text-muted text-sm">No {typeFilter} files here</p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="space-y-0.5">
                {localPath && (
                  <button
                    onClick={() => {
                      const parent = localPath.replace(/[/\\][^/\\]+$/, '')
                      if (parent && parent !== localPath) browseLocal(parent)
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-overlay transition-colors text-left"
                  >
                    <div className="w-9 h-9 flex items-center justify-center shrink-0"><FolderOpen size={18} className="text-text-muted" /></div>
                    <span className="text-text-muted text-sm">..</span>
                  </button>
                )}
                {filteredLocalEntries.map((entry) => {
                  const isDir = entry.type === 'directory'
                  const mt = isDir ? 'folder' : getMediaType(entry.name)
                  const ext = getFileExt(entry.name).slice(1).toUpperCase()
                  return (
                    <div
                      key={entry.path}
                      className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-overlay transition-colors cursor-default"
                      onClick={() => {
                        if (isDir) browseLocal(entry.path)
                        else if (mt === 'audio') handleLocalPlay(entry)
                        else if (mt === 'image' || mt === 'video') openLocalLightbox(entry)
                        else if (mt === 'text') openLocalText(entry)
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setLocalCtxMenu({ entry, x: e.clientX, y: e.clientY }) }}
                    >
                      <div className="w-9 h-9 flex items-center justify-center shrink-0">
                        {isDir
                          ? <FolderOpen size={18} className="text-text-muted" />
                          : mt === 'audio' ? <Music2 size={18} className="text-text-muted opacity-40" /> : mt === 'video' ? <Video size={18} className="text-text-muted" /> : mt === 'image' ? <ImageIcon size={18} className="text-text-muted" /> : mt === 'text' ? <FileText size={18} className="text-text-muted" /> : <Music2 size={18} className="text-text-muted opacity-20" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm truncate">{entry.name}</p>
                        {entry.size != null && !isDir && (
                          <p className="text-text-muted text-xs">{(entry.size / 1_048_576).toFixed(1)} MB</p>
                        )}
                      </div>
                      {mt === 'audio' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleLocalPlay(entry) }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-accent/15 text-accent transition-all"
                          title="Play"
                        ><Play size={14} /></button>
                      )}
                      {/* Same rationale as the API rows: right-click isn't
                          reachable on touch, so the menu needs a real button. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setLocalCtxMenu({ entry, x: e.clientX, y: e.clientY }) }}
                        className="shrink-0 p-2 -my-1.5 text-text-muted md:opacity-0 md:group-hover:opacity-100 hover:text-text-primary active:text-accent transition-all"
                        title="More options"
                      ><MoreHorizontal size={16} /></button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid gap-3 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {localPath && (
                  <button
                    onClick={() => {
                      const parent = localPath.replace(/[/\\][^/\\]+$/, '')
                      if (parent && parent !== localPath) browseLocal(parent)
                    }}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-overlay hover:bg-surface-raised transition-colors"
                  >
                    <div className="w-full aspect-square flex items-center justify-center"><FolderOpen size={40} className="text-text-muted" /></div>
                    <span className="text-text-muted text-xs">..</span>
                  </button>
                )}
                {filteredLocalEntries.map((entry) => {
                  const isDir = entry.type === 'directory'
                  const mt = isDir ? 'folder' : getMediaType(entry.name)
                  const ext = getFileExt(entry.name).slice(1).toUpperCase()
                  return (
                    <div
                      key={entry.path}
                      className="group flex flex-col rounded-xl overflow-hidden transition-colors cursor-default bg-surface-overlay hover:bg-surface-raised"
                      onClick={() => {
                        if (isDir) browseLocal(entry.path)
                        else if (mt === 'audio') handleLocalPlay(entry)
                        else if (mt === 'image' || mt === 'video') openLocalLightbox(entry)
                        else if (mt === 'text') openLocalText(entry)
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setLocalCtxMenu({ entry, x: e.clientX, y: e.clientY }) }}
                    >
                      <div className="relative w-full aspect-square bg-surface-raised flex items-center justify-center overflow-hidden">
                        {isDir
                          ? <Folder size={40} className="text-text-secondary group-hover:text-accent transition-colors" />
                          : mt === 'audio' ? (
                            <>
                              <Music2 size={36} className="text-text-muted opacity-30" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Play size={24} fill="white" className="text-white ml-0.5" />
                              </div>
                            </>
                          ) : mt === 'image' ? (
                            <ImageIcon size={36} className="text-text-muted" />
                          ) : mt === 'video' ? (
                            <Video size={36} className="text-text-muted" />
                          ) : mt === 'text' ? (
                            <FileText size={36} className="text-text-muted" />
                          ) : (
                            <span className="text-xs uppercase text-text-muted">{ext}</span>
                          )}
                      </div>
                      <div className="px-2 py-2 flex items-center gap-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary text-xs font-medium truncate">{entry.name}</p>
                          {!isDir && <p className="text-text-muted text-[10px] uppercase tracking-wide mt-0.5">{ext}</p>}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setLocalCtxMenu({ entry, x: e.clientX, y: e.clientY }) }}
                          className="shrink-0 p-1.5 -m-1 text-text-muted md:opacity-0 md:group-hover:opacity-100 hover:text-text-primary active:text-accent transition-all"
                          title="More options"
                        ><MoreHorizontal size={15} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {/* Content */}
        {!localMode && <div
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
            collectDroppedFiles(e.dataTransfer).then(files => uploadDroppedFiles(folder, files)).catch(() => {})
          }}
          // Entry rows stop propagation and open their own menu, so anything
          // reaching here is genuinely the background.
          onContextMenu={(e) => { e.preventDefault(); setBgCtxMenu({ x: e.clientX, y: e.clientY }) }}
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
          ) : sortedEntries.length === 0 && visibleGhosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Music2 size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">{isSearching ? `No files match "${debouncedSearch.trim()}"` : 'Nothing here'}</p>
            </div>
          ) : filteredEntries.length === 0 && visibleGhosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Filter size={32} className="text-text-muted opacity-30" />
              <p className="text-text-muted text-sm">No {typeFilter} files here</p>
            </div>
          ) : viewMode === 'list' ? (
            /* ── List view ────────────────────────────────────────────────────── */
            <div className="space-y-0.5">
              {currentPath && !isSearching && (
                <button onClick={goBack} {...parentDropProps} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left ${
                  dropTarget === '..' ? 'bg-accent/15 ring-2 ring-accent/50' : 'hover:bg-surface-overlay'
                }`}>
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
                    {pendingFor(entry.path) && <PendingMarker proposal={pendingFor(entry.path)!} />}
                    {isLiked && (
                      <button
                        className="shrink-0 p-1 text-accent"
                        onClick={(e) => { e.stopPropagation(); toggleApiFileLike(entry.path) }}
                        disabled={!channelsReady}
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
              {visibleGhosts.map((g) => <PendingGhostItem key={`ghost:${g.path}`} ghost={g} variant="row" />)}
            </div>
          ) : (
            /* ── Grid view ────────────────────────────────────────────────────── */
            <div className="grid gap-3 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {currentPath && !isSearching && (
                <button onClick={goBack} {...parentDropProps} className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-colors ${
                  dropTarget === '..' ? 'bg-accent/15 ring-2 ring-accent/50' : 'bg-surface-overlay hover:bg-surface-raised'
                }`}>
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
                          className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                          onClick={(e) => { e.stopPropagation(); toggleApiFileLike(entry.path) }}
                        disabled={!channelsReady}
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
                      {pendingFor(entry.path) && <PendingMarker proposal={pendingFor(entry.path)!} />}
                      {/* Same visible context-menu trigger as the list rows —
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
              {visibleGhosts.map((g) => <PendingGhostItem key={`ghost:${g.path}`} ghost={g} variant="tile" />)}
            </div>
          )}
        </div>}

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
                dropped — proposals target files. */}
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
                <><Loader2 size={13} className="animate-spin" /> {zipStatus === 'starting' ? 'Starting…' : zipProgress ? `Zipping ${zipProgress.done}/${zipProgress.total}…` : 'Zipping…'}</>
              ) : zipStatus === 'done' ? (
                <><Check size={13} /> Done</>
              ) : zipStatus === 'error' ? (
                <><X size={13} /> Error</>
              ) : (
                <><PackageOpen size={13} /> Download ZIP</>
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

      {/* Folder-download progress toast — the selection bar above already
          shows zip status while selectMode is active, so this only covers
          the single-folder "Download folder" context-menu action. */}
      {!selectMode && zipStatus !== 'idle' && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary">
          {zipStatus === 'starting' || zipStatus === 'zipping' ? (
            <><Loader2 size={13} className="animate-spin text-accent" /> {zipStatus === 'starting' ? 'Starting ZIP…' : zipProgress ? `Zipping folder ${zipProgress.done}/${zipProgress.total}…` : 'Zipping folder…'}</>
          ) : zipStatus === 'done' ? (
            <><Check size={13} className="text-accent" /> Downloaded</>
          ) : (
            <><X size={13} className="text-red-400" /> ZIP failed</>
          )}
        </div>
      )}

      {boostToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary">
          <Heart size={13} className="text-pink-400" fill="currentColor" /> Priority routing active
        </div>
      )}

      {/* Single-file CDN download progress, above the folder toast when both show. */}
      <CdnDownloadToast raised={!selectMode && zipStatus !== 'idle'} />

      {/* Prompted when a drag lands on a file rather than a folder: both sides move
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
                if (e.key === 'Enter') confirmNewApiFolder()
                if (e.key === 'Escape') setNewFolderPrompt(null)
              }}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setNewFolderPrompt(null)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors">Cancel</button>
              <button
                onClick={confirmNewApiFolder}
                disabled={!newFolderPrompt.trim()}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              >Queue folder</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden pickers behind the context menu's upload items. */}
      <input ref={fileInputRef} type="file" multiple className="hidden"
        onChange={e => uploadDroppedFiles(uploadTargetRef.current, filesFromInput(e.target.files))} />
      <input
        ref={el => { folderInputRef.current = el; el?.setAttribute('webkitdirectory', '') }}
        type="file" multiple className="hidden"
        onChange={e => uploadDroppedFiles(uploadTargetRef.current, filesFromInput(e.target.files))}
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

      {!localMode && ctxMenu && (() => {
        const entry = ctxMenu.entry
        const matched = trackerMatches.get(entry.path) != null
        const liked = likedTrackIds.includes(apiFileTrackId(entry.path, trackChannel))
        const isDir = entry.type === 'directory'
        const isAudio = getMediaType(entry.name) === 'audio'
        return (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            className="min-w-[180px]"
            items={[
              isAudio && { icon: Play, label: 'Play', onSelect: () => handlePlay(entry) },
              isAudio && { icon: ListPlus, label: 'Add to queue', onSelect: () => addToQueue(fileToTrack(entry, activeChannel)) },
              isAudio && matched && {
                icon: Plus,
                label: 'Add to playlist',
                childrenEmpty: account ? 'No playlists yet.' : 'Log in to save to playlists.',
                children: account ? playlists.map((p) => ({
                  label: p.name,
                  icon: ListMusic,
                  checked: playlistDoneId === p.id,
                  loading: playlistBusyId === p.id,
                  disabled: playlistBusyId === p.id,
                  keepOpen: true,
                  onSelect: () => {
                    const songId = trackerMatches.get(entry.path)
                    if (songId != null) addToPlaylist(p.id, songId)
                  },
                })) : [],
                childrenFooter: !account ? (
                  <button
                    onClick={() => { setShowUserAuth(true); setCtxMenu(null) }}
                    className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
                  >Log in</button>
                ) : undefined,
              },
              isAudio && {
                icon: liked ? HeartFilled : Heart,
                label: liked ? 'Unlike' : 'Like',
                active: liked,
                disabled: !channelsReady,
                onSelect: () => toggleApiFileLike(entry.path),
              },
              isAudio && matched && { icon: Info, label: 'Find in Tracker', onSelect: () => { void openSongInfo(entry) } },
              isAudio && canEdit && {
                icon: Pencil,
                label: 'Edit',
                onSelect: async () => {
                  const title = entry.name.replace(/\.[^.]+$/, '')
                  try {
                    const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search: title, page_size: 1 })
                    const id = data.results[0]?.id
                    if (id) useStore.getState().openSongEditor(id)
                  } catch {}
                },
              },
              isAudio && 'divider',
              getMediaType(entry.name) === 'text' && { icon: FileText, label: 'View', onSelect: () => openApiText(entry) },
              { icon: CheckSquare2, label: 'Select', onSelect: () => enterSelectMode(entry) },
              { icon: Link, label: 'Copy link', onSelect: () => copyLink(entry) },
              { icon: Clipboard, label: 'Copy path', onSelect: () => copyPath(entry) },
              // Contributor actions — proposals target a file, so directories
              // are excluded. Both land on the contributor page prefilled.
              canPropose && !isDir && 'divider',
              canPropose && !isDir && {
                icon: Replace,
                label: 'Propose replacement',
                onSelect: () => {
                  setPendingCompProposal({ paths: [entry.path], changeType: 'replace' })
                  setActiveView('contributor')
                },
              },
              canPropose && !isDir && {
                icon: Trash2,
                label: 'Propose deletion',
                onSelect: () => {
                  setPendingCompProposal({ paths: [entry.path], changeType: 'delete' })
                  setActiveView('contributor')
                },
              },
              canPropose && isDir && 'divider',
              canPropose && isDir && { icon: Upload, label: 'Upload files here', onSelect: () => openUploadPicker(entry.path, 'files') },
              canPropose && isDir && { icon: FolderInput, label: 'Upload folder here', onSelect: () => openUploadPicker(entry.path, 'folder') },
              'divider',
              isDir
                ? { icon: PackageOpen, label: 'Download folder (ZIP)', disabled: zipStatus === 'starting' || zipStatus === 'zipping', onSelect: () => downloadFolder(entry) }
                : { icon: Download, label: 'Download', onSelect: () => handleDownload(entry) },
            ]}
          />
        )
      })()}

      {/* Local-mode context menu — open / play, rename, delete. Deletion and
          renaming are handled in the main process (confirm + OS trash there),
          so nothing here touches the filesystem directly. */}
      {localMode && localCtxMenu && (() => {
        const entry = localCtxMenu.entry
        const media = getMediaType(entry.name)
        return (
          <ContextMenu
            x={localCtxMenu.x}
            y={localCtxMenu.y}
            onClose={() => setLocalCtxMenu(null)}
            className="min-w-[190px]"
            items={[
              entry.type === 'directory'
                ? { icon: FolderOpen, label: 'Open', onSelect: () => browseLocal(entry.path) }
                : media === 'audio'
                  ? { icon: Play, label: 'Play', onSelect: () => handleLocalPlay(entry) }
                  : media === 'text'
                    ? { icon: FileText, label: 'View', onSelect: () => openLocalText(entry) }
                    : null,
              { icon: ExternalLink, label: 'Open with system app', onSelect: () => openLocalFile(entry.path) },
              { icon: Pencil, label: 'Rename', onSelect: () => startRename(entry) },
              'divider',
              { icon: FolderPlus, label: 'New folder', onSelect: () => startCreate('directory') },
              { icon: FilePlus, label: 'New file', onSelect: () => startCreate('file') },
              'divider',
              { icon: Trash2, label: 'Delete', danger: true, onSelect: () => deleteLocalEntry(entry) },
            ]}
          />
        )
      })()}

      {/* Background (empty-space) menu for the current folder — the Explorer /
          Finder equivalent: View, Sort by, Refresh, plus local-only New /
          Open in file manager, or API-only Copy link. */}
      {bgCtxMenu && (
        <ContextMenu
          x={bgCtxMenu.x}
          y={bgCtxMenu.y}
          onClose={() => setBgCtxMenu(null)}
          className="min-w-[190px]"
          flyoutClassName="w-44"
          items={[
            {
              icon: viewMode === 'grid' ? LayoutGrid : LayoutList,
              label: 'View',
              children: ([['list', 'List', LayoutList], ['grid', 'Grid', LayoutGrid]] as const).map(([key, label, icon]) => ({
                icon,
                label,
                checked: viewMode === key,
                onSelect: () => setViewMode(key),
              })),
            },
            {
              icon: ArrowUpDown,
              label: 'Sort by',
              children: [
                ...(['name', 'type', 'size'] as SortBy[]).map((by) => ({
                  label: by.charAt(0).toUpperCase() + by.slice(1),
                  trailing: sortBy === by
                    ? (sortDir === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />)
                    : undefined,
                  onSelect: () => toggleSort(by),
                })),
                'divider' as const,
                { icon: ArrowUpDown, label: sortDir === 'asc' ? 'Descending' : 'Ascending', onSelect: () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc') },
              ],
            },
            {
              icon: RefreshCw,
              label: 'Refresh',
              onSelect: () => {
                if (localMode) browseLocal(localPath)
                else navigate(currentPath, false)
              },
            },
            localMode && 'divider',
            localMode && { icon: FolderPlus, label: 'New folder', onSelect: () => startCreate('directory') },
            localMode && { icon: FilePlus, label: 'New file', onSelect: () => startCreate('file') },
            localMode && { icon: Upload, label: 'Upload file', onSelect: () => uploadLocalFiles() },
            !localMode && canPropose && 'divider',
            !localMode && canPropose && { icon: FolderPlus, label: 'New folder', onSelect: () => setNewFolderPrompt('') },
            !localMode && canPropose && { icon: Upload, label: 'Upload files', onSelect: () => openUploadPicker(currentPath, 'files') },
            !localMode && canPropose && { icon: FolderInput, label: 'Upload folder', onSelect: () => openUploadPicker(currentPath, 'folder') },
            // The Contributor page is still where an upload gets notes or a
            // rename before it's proposed.
            !localMode && canPropose && {
              icon: FileText,
              label: 'Upload with notes…',
              onSelect: () => {
                setPendingCompProposal({ paths: [currentPath], changeType: 'upload' })
                setActiveView('contributor')
              },
            },
            'divider',
            {
              icon: Clipboard,
              label: 'Copy folder path',
              onSelect: () => copyTextToClipboard(localMode ? localPath : currentPath, 'path'),
            },
            localMode
              ? { icon: ExternalLink, label: 'Open in file manager', onSelect: () => openLocalFile(localPath) }
              : { icon: Link, label: 'Copy folder link', onSelect: () => copyTextToClipboard(window.location.origin + pathToUrl(currentPath), 'link') },
          ]}
        />
      )}

    </>
  )
}
