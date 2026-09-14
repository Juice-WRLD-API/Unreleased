import { useCallback, useEffect, useState } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import { X, Folder, FolderOpen, ArrowLeft, Home, ChevronRight, Loader2, ImageIcon, Search, Check, Music2, File, FolderCheck, FolderPlus } from 'lucide-react'
import {
  apiFetch, apiPeek, buildStreamUrl, smallCoverUrl, parseBrowseEntries, cleanTitleForSearch, filterSearchResults,
  JWApiFileEntry, JWApiBrowseResponse,
} from '../lib/juicewrldApi'
import { getMediaType } from '../lib/fileTypes'
import { useStore } from '../store/useStore'

function breadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join('/') }))
}

// Path join that tolerates a typed name with stray slashes or spaces.
function joinFolder(base: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, '')
  if (!clean) return base
  return base ? `${base}/${clean}` : clean
}

function parentFolder(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : ''
}

// Directories first, then matching files, alphabetically within each - a picker
// has no need for the full sort/view-mode machinery ApiFilesView offers.
function sortForPicker(entries: JWApiFileEntry[], kind: PickerKind): JWApiFileEntry[] {
  return [...entries]
    .filter((e) => e.type === 'directory' || kind === 'any' || getMediaType(e.name) === kind)
    .sort((a, b) => {
      const aDir = a.type === 'directory'
      const bDir = b.type === 'directory'
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export type PickerKind = 'image' | 'audio' | 'any'

interface Props {
  /** What the picker browses for. 'image' (default) hands back an absolute
   *  /files/download/ URL for use as a cover; 'audio' hands back the raw
   *  storage path, which is the shape the API's `path` field holds. */
  kind?: PickerKind
  /** The song's title - seeds the initial search so covers already filed
   *  under that name surface immediately instead of an empty root listing. */
  songTitle?: string
  /** This song's other known titles - a cover may be filed under an alt name
   *  instead of the primary one, so these are searched too and merged in. */
  altTitles?: string[]
  onSelect: (path: string) => void
  onClose: () => void
  /** Show a "Use this folder" action that hands back the folder currently
   *  being browsed instead of a file. For targets that don't exist yet - a
   *  comp upload names a new file, so there's nothing to click. */
  allowFolderSelect?: boolean
  /** Overrides the header text. */
  title?: string
  /** Check off several files and hand them back at once. Selection survives
   *  navigation, so a batch can be gathered from more than one folder.
   *  Requires onSelectMany; onSelect is then unused for files. */
  multiple?: boolean
  onSelectMany?: (paths: string[]) => void
  emptyFolderProposable?: boolean
  channel?: string
}

// A scoped-down version of ApiFilesView's browser for picking one file out of
// the API's storage - folders plus files of the requested kind, no playback/
// selection/download machinery.
//
// Image mode hands back the resolved /files/download/ URL (buildStreamUrl),
// the same absolute-URL shape ApiFilesView's "Copy link" produces - NOT the
// raw storage path. resolvePrefCoverUrl treats a bare path as an audio track
// whose embedded art needs extracting via /files/cover-art/, which 404s on a
// plain image file; an absolute URL passes through untouched instead.
//
// Audio mode is the opposite: a song's `path` field in the API is the raw
// storage path ("Compilation/1. Released Discography/…mp3") and the app builds
// stream URLs from it, so handing back an absolute URL there would double-wrap.
export default function FilePickerModal({ kind = 'image', songTitle, altTitles = [], onSelect, onClose, allowFolderSelect = false, title, multiple = false, onSelectMany, emptyFolderProposable = false, channel }: Props): JSX.Element {
  const storeChannel = useStore((s) => s.activeChannel)
  const activeChannel = channel ?? storeChannel
  const browseParams = useCallback((path: string): Record<string, string> => {
    const p: Record<string, string> = {}
    if (path) p.path = path
    if (activeChannel) p.channel = activeChannel
    return p
  }, [activeChannel])
  const searchParams = useCallback((term: string): Record<string, string> => {
    const p: Record<string, string> = { search: term }
    if (activeChannel) p.channel = activeChannel
    return p
  }, [activeChannel])
  const isAudio = kind === 'audio'
  // Image mode is the only one that earns a thumbnail grid; audio and 'any'
  // both render the compact list.
  const isList = kind !== 'image'
  const noun = kind === 'audio' ? 'audio files' : kind === 'any' ? 'files' : 'images'
  const initialQuery = songTitle ? cleanTitleForSearch(songTitle) : ''
  // Alt titles searched alongside the primary one on mount (deduped, and never
  // repeating a name the primary search already covers).
  const altQueries = altTitles
    .map(cleanTitleForSearch)
    .filter((q, i, arr) => q && q.toLowerCase() !== initialQuery.toLowerCase() && arr.indexOf(q) === i)
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<JWApiFileEntry[]>([])
  const [loading, setLoading] = useState(!initialQuery)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  // Kept across navigation on purpose - gathering a batch usually means
  // dipping into a few folders before committing.
  const [checked, setChecked] = useState<string[]>([])
  // Naming a folder that doesn't exist yet. There's no endpoint that creates
  // one - the API has no mkdir, and a comp proposal's change types are
  // upload/replace/move/delete - so this only composes a path. The folder
  // comes into existence when an upload into it is approved.
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const isMulti = multiple && !!onSelectMany
  const toggle = (path: string): void =>
    setChecked((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))

  // Seeded from the song title (if any) so the picker opens already showing
  // title-matched results - see the mount effect below for the root prefetch
  // that still happens quietly alongside it.
  const [search, setSearch] = useState(initialQuery)
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery)
  const [searchResults, setSearchResults] = useState<JWApiFileEntry[]>([])
  const [searchLoading, setSearchLoading] = useState(!!initialQuery)
  const isSearching = debouncedSearch.trim().length > 0

  const navigate = useCallback(async (path: string, pushHistory = true, resetSearch = true) => {
    if (resetSearch) { setSearch(''); setDebouncedSearch('') }
    const cached = apiPeek<JWApiBrowseResponse>('/files/browse/', browseParams(path))
    if (cached) {
      setEntries(parseBrowseEntries(cached))
      setCurrentPath(path)
      setError(null)
      if (resetSearch) setLoading(false)
    } else if (resetSearch) {
      setLoading(true)
      setError(null)
    }
    try {
      const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', browseParams(path))
      if (pushHistory) setHistory((h) => [...h, currentPath])
      setCurrentPath(path)
      setEntries(parseBrowseEntries(data))
    } catch (err) {
      if (!cached && resetSearch) setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      if (resetSearch) setLoading(false)
    }
  }, [currentPath, browseParams])

  // Always prefetch the root listing (silently, without touching the search
  // box) so clearing the initial title search drops straight into a populated
  // browser instead of an empty one.
  useEffect(() => { navigate('', false, !initialQuery) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!isSearching) { setSearchResults([]); return }
    let cancelled = false
    setSearchLoading(true)
    const term = debouncedSearch.trim()
    apiFetch<JWApiBrowseResponse>('/files/browse/', searchParams(term))
      .then((data) => { if (!cancelled) setSearchResults(filterSearchResults(parseBrowseEntries(data), term)) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [debouncedSearch, isSearching, searchParams])

  // Merge in results for the song's alt titles alongside the primary-title
  // search seeded above - a cover is often filed under a feature's alias or
  // an alternate spelling rather than the main title. Runs once on mount only:
  // once the user edits the search box, the effect above replaces
  // searchResults wholesale with a plain single-term search as normal.
  useEffect(() => {
    if (!initialQuery || altQueries.length === 0) return
    let cancelled = false
    Promise.all(altQueries.map((q) =>
      apiFetch<JWApiBrowseResponse>('/files/browse/', searchParams(q))
        .then((data) => filterSearchResults(parseBrowseEntries(data), q))
        .catch(() => [] as JWApiFileEntry[])
    )).then((lists) => {
      if (cancelled) return
      setSearchResults((prev) => {
        const seen = new Set(prev.map((e) => e.path))
        const merged = [...prev]
        for (const list of lists) for (const e of list) if (!seen.has(e.path)) { seen.add(e.path); merged.push(e) }
        return merged
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const goBack = (): void => {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      navigate(prev, false)
    } else if (currentPath) {
      navigate(parentFolder(currentPath), false)
    }
  }

  const goHome = (): void => { setHistory([]); navigate('', false) }

  const shown = sortForPicker(isSearching ? searchResults : entries, kind)
  const crumbs = breadcrumbs(currentPath)

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg h-[85svh] md:h-[600px] max-h-[92svh] md:max-h-[86vh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div
        className="select-text bg-surface w-full h-full flex flex-col overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header */}
        <div
          className="shrink-0 px-4 pt-4 pb-3 border-b border-[var(--border)] cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary text-sm font-semibold">
              {title ?? (isAudio ? 'Choose an audio file from API files' : kind === 'any' ? 'Choose a file from API files' : 'Choose a cover from API files')}
            </h2>
            <div className="flex items-center gap-1">
              {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors" title="Close">
                <X size={15} className="text-text-muted" />
              </button>
            </div>
          </div>

          <div className="relative mb-2.5">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}…`}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg pl-8 pr-8 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setDebouncedSearch('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {isSearching ? (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              {searchLoading
                ? <><Loader2 size={11} className="animate-spin" /> Searching…</>
                : <>
                    {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for "{debouncedSearch.trim()}"
                    {search === initialQuery && altQueries.length > 0 && (
                      <> (+ {altQueries.length} alt name{altQueries.length === 1 ? '' : 's'})</>
                    )}
                  </>}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={goBack} disabled={history.length === 0 && !currentPath}
                className="p-1.5 rounded-lg hover:bg-surface-overlay disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Back">
                <ArrowLeft size={13} className="text-text-muted" />
              </button>
              <button onClick={goHome} className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors" title="Root">
                <Home size={13} className="text-text-muted" />
              </button>
              <div className="flex items-center gap-0.5 overflow-hidden ml-1 flex-1 min-w-0">
                <button
                  onClick={goHome}
                  className={`text-[11px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                    crumbs.length === 0 ? 'text-text-primary font-medium' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                  }`}
                >Root</button>
                {crumbs.map((crumb, i) => (
                  <div key={crumb.path} className="flex items-center gap-0.5 min-w-0 shrink-0">
                    <ChevronRight size={11} className="text-text-muted shrink-0" />
                    <button
                      onClick={() => navigate(crumb.path)}
                      className={`text-[11px] px-1.5 py-0.5 rounded transition-colors truncate max-w-[110px] ${
                        i === crumbs.length - 1 ? 'text-text-primary font-medium' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                      }`}
                      title={crumb.path}
                    >{crumb.label}</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {(isSearching ? searchLoading : loading) ? (
            <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 size={16} className="animate-spin" /><span className="text-xs">{isSearching ? 'Searching…' : 'Loading…'}</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <p className="text-text-muted text-xs">{error}</p>
              <button onClick={() => navigate(currentPath, false)} className="text-accent text-xs underline">Retry</button>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              {isAudio
                ? <Music2 size={26} className="text-text-muted opacity-30" />
                : kind === 'any'
                  ? <File size={26} className="text-text-muted opacity-30" />
                  : <ImageIcon size={26} className="text-text-muted opacity-30" />}
              <p className="text-text-muted text-xs">
                {isSearching
                  ? `No ${noun} match "${debouncedSearch.trim()}"`
                  : `No folders or ${noun} here`}
              </p>
            </div>
          ) : isList ? (
            /* Audio has no thumbnail worth showing - a compact list reads better
               than a grid of identical note icons. */
            <div className="flex flex-col gap-0.5">
              {currentPath && !isSearching && (
                <button onClick={goBack} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-overlay transition-colors text-left">
                  <FolderOpen size={16} className="text-text-muted shrink-0" />
                  <span className="text-text-muted text-xs">..</span>
                </button>
              )}
              {shown.map((entry) => {
                const isDir = entry.type === 'directory'
                return (
                  <button
                    key={entry.path}
                    onClick={() => {
                      if (isDir) navigate(entry.path)
                      else if (isMulti) toggle(entry.path)
                      else onSelect(entry.path)
                    }}
                    title={entry.path}
                    className={`group flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors text-left ${
                      isMulti && checked.includes(entry.path) ? 'bg-accent/10' : 'hover:bg-surface-overlay'
                    }`}
                  >
                    {isDir
                      ? <Folder size={16} className="text-text-secondary group-hover:text-accent transition-colors shrink-0" />
                      : isAudio
                        ? <Music2 size={16} className="text-text-muted shrink-0" />
                        : <File size={16} className="text-text-muted shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary text-xs font-medium truncate">{entry.name}</p>
                      {isSearching && parentFolder(entry.path) && (
                        <p className="text-text-muted text-[10px] truncate">{parentFolder(entry.path)}</p>
                      )}
                    </div>
                    {isDir
                      ? <ChevronRight size={13} className="text-text-muted opacity-40 shrink-0" />
                      : <Check size={13} className={`text-accent shrink-0 transition-opacity ${
                          isMulti && checked.includes(entry.path) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`} />}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
              {currentPath && !isSearching && (
                <button onClick={goBack} className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-surface-overlay hover:bg-surface-raised transition-colors">
                  <div className="w-full aspect-square flex items-center justify-center"><FolderOpen size={28} className="text-text-muted" /></div>
                  <span className="text-text-muted text-[10px]">..</span>
                </button>
              )}
              {shown.map((entry) => {
                const isDir = entry.type === 'directory'
                return (
                  <button
                    key={entry.path}
                    onClick={() => { if (isDir) navigate(entry.path); else onSelect(buildStreamUrl(entry.path, activeChannel)) }}
                    title={entry.name}
                    className="group flex flex-col rounded-xl overflow-hidden transition-colors bg-surface-overlay hover:bg-surface-raised text-left"
                  >
                    <div className="relative w-full aspect-square bg-surface-raised flex items-center justify-center overflow-hidden">
                      {isDir ? (
                        <Folder size={28} className="text-text-secondary group-hover:text-accent transition-colors" />
                      ) : (
                        <>
                          <img
                            // Picker thumbnails only - the path handed back on
                            // select is still the full-size one.
                            src={smallCoverUrl(buildStreamUrl(entry.path, activeChannel))}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-7 h-7 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                              <Check size={13} className="text-white" />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="px-1.5 py-1.5">
                      <p className="text-text-primary text-[10px] font-medium truncate">{entry.name}</p>
                      {isSearching && parentFolder(entry.path) && (
                        <p className="text-text-muted text-[9px] truncate">{parentFolder(entry.path)}</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {isMulti && (
          <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-primary font-medium">
                {checked.length} file{checked.length === 1 ? '' : 's'} selected
              </p>
              {checked.length > 0 && (
                <button onClick={() => setChecked([])} className="text-[11px] text-text-muted hover:text-text-primary transition-colors">
                  Clear selection
                </button>
              )}
            </div>
            <button
              onClick={() => onSelectMany?.(checked)}
              disabled={checked.length === 0}
              className="shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
            >
              <Check size={14} /> Add {checked.length || ''} file{checked.length === 1 ? '' : 's'}
            </button>
          </div>
        )}

        {allowFolderSelect && (
          <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 space-y-2.5">
            {newFolder === null ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">Selected folder</p>
                  <p className="text-xs font-mono text-text-primary truncate" title={currentPath || 'Root'}>{currentPath || 'Root'}</p>
                </div>
                <button
                  onClick={() => setNewFolder('')}
                  disabled={isSearching}
                  title={isSearching ? 'Clear the search first' : 'Name a new folder inside this one'}
                  className="shrink-0 px-2.5 py-2 rounded-lg border border-[var(--border)] text-text-secondary hover:text-text-primary hover:border-accent/40 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-colors"
                >
                  <FolderPlus size={14} /> New folder
                </button>
                <button
                  onClick={() => onSelect(currentPath)}
                  disabled={isSearching}
                  title={isSearching ? 'Clear the search to pick the folder you are browsing' : 'Use this folder'}
                  className="shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <FolderCheck size={14} /> Use this folder
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value.replace(/^\/+/, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFolder.trim()) onSelect(joinFolder(currentPath, newFolder))
                      if (e.key === 'Escape') { e.stopPropagation(); setNewFolder(null) }
                    }}
                    placeholder="New folder name"
                    className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                  />
                  <button onClick={() => setNewFolder(null)}
                    className="shrink-0 px-2.5 py-2 rounded-lg text-text-muted hover:text-text-primary text-xs font-semibold transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => onSelect(joinFolder(currentPath, newFolder))}
                    disabled={!newFolder.trim()}
                    className="shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <FolderCheck size={14} /> Use
                  </button>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  <span className="font-mono text-text-secondary">{joinFolder(currentPath, newFolder) || '…'}</span>
                  {emptyFolderProposable
                    ? " - created on disk once this folder proposal is approved, ready for you to upload files into."
                    : " - the folder is created when an upload into it is approved. An empty folder can't be proposed on its own."}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      )}
    </ModalOverlay>
  )
}
