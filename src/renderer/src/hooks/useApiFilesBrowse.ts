// Shared navigation/search data layer for ApiFilesView.desktop.tsx and
// .mobile.tsx - browsing, history, recursive search, channel switching and
// URL sync were byte-identical between the two views before this extraction.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  apiFetch, apiPeek, searchFiles, JWApiBrowseResponse, JWApiFileEntry, parseBrowseEntries as parseEntries,
} from '../lib/juicewrldApi'
import { parentFolder, pathToUrl, urlToPath } from '../lib/apiFilesShared'
import { folderFromIndex, hasQuery, loadFileIndex, parseFileQuery, peekFileIndex, searchFileIndex, type FileSearchResult } from '../lib/fileSearch'
import type { JWApiChannel } from '../lib/juicewrldApi'
import { errorMessage } from '../lib/format'

export function useApiFilesBrowse(opts: {
  activeChannel: string
  setActiveChannel: (slug: string) => void
  channels: JWApiChannel[]
  loadChannels: () => Promise<void>
  apiFilesPath: string
  setApiFilesPath: (path: string) => void
  apiFilesLastPath: string
  setApiFilesLastPath: (path: string) => void
  /** Mobile scrolls its listing back to top on every navigate() call, right
   *  before the fetch fires - desktop has no such scroller to reset. */
  onNavigateStart?: () => void
}): {
  currentPath: string
  entries: JWApiFileEntry[]
  loading: boolean
  error: string | null
  history: string[]
  setHistory: React.Dispatch<React.SetStateAction<string[]>>
  navigate: (path: string, pushHistory?: boolean) => Promise<void>
  /** Warm a folder's listing ahead of a click (folder hover). */
  prefetchFolder: (path: string) => void
  goBack: () => void
  goHome: () => void
  onChannelChange: (slug: string) => void
  search: string
  setSearch: (v: string) => void
  debouncedSearch: string
  setDebouncedSearch: (v: string) => void
  searchResults: JWApiFileEntry[]
  /** Matches before the display cap (MAX_FILE_RESULTS). */
  searchTotal: number
  /** No exact matches; the results are typo-tolerant ones. */
  searchFuzzy: boolean
  prefetchSearchIndex: () => void
  searchLoading: boolean
  isSearching: boolean
  /** Limit search to the folder being browsed (and its subfolders). */
  searchInFolder: boolean
  setSearchInFolder: (v: boolean) => void
} {
  const { activeChannel, setActiveChannel, channels, loadChannels, apiFilesPath, setApiFilesPath, apiFilesLastPath, setApiFilesLastPath, onNavigateStart } = opts

  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<JWApiFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchResults, setSearchResults] = useState<JWApiFileEntry[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchFuzzy, setSearchFuzzy] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const isSearching = debouncedSearch.trim().length > 0
  const [searchInFolder, setSearchInFolder] = useState(false)

  const navigateRequestId = useRef(0)

  const browseParams = useCallback((path: string): Record<string, string> => {
    const p: Record<string, string> = {}
    if (path) p.path = path
    if (activeChannel) p.channel = activeChannel
    return p
  }, [activeChannel])

  const navigate = useCallback(async (path: string, pushHistory = true) => {
    // Navigating to a folder (including clicking/tapping a directory result
    // while searching) always exits search mode and lands in normal browsing.
    setSearch(''); setDebouncedSearch('')
    // Guard against a slower in-flight request (e.g. for a channel or folder
    // the user has since navigated away from) landing after a newer one and
    // clobbering the view with stale/wrong-channel data.
    const requestId = ++navigateRequestId.current
    // Stale-while-revalidate: if this folder is already in the offline cache,
    // or in the channel's full file index, paint it instantly (no spinner) and
    // refresh silently in the background. Only show the loading state when
    // there's nothing to fall back on.
    let painted = false
    const paint = (items: JWApiFileEntry[]): void => {
      if (!painted && pushHistory) {
        setHistory((h) => [...h, currentPath])
        window.history.pushState({ view: 'api-files', folderPath: path }, '', pathToUrl(path))
      }
      painted = true
      setEntries(items)
      setCurrentPath(path)
      setError(null)
      setLoading(false)
    }
    const cached = apiPeek<JWApiBrowseResponse>('/files/browse/', browseParams(path))
    const instant = cached ? parseEntries(cached) : folderFromIndex(activeChannel, path)
    if (instant) paint(instant)
    else {
      setLoading(true)
      setError(null)
      // The index may land before this folder's own listing does.
      void loadFileIndex(activeChannel).then(() => {
        if (painted || requestId !== navigateRequestId.current) return
        const fromIndex = folderFromIndex(activeChannel, path)
        if (fromIndex) paint(fromIndex)
      })
    }
    onNavigateStart?.()
    try {
      const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', browseParams(path))
      if (requestId !== navigateRequestId.current) return
      paint(parseEntries(data))
    } catch (err) {
      if (requestId !== navigateRequestId.current) return
      // Keep the instant listing visible on a network failure - only surface
      // the error when we had nothing to show in the first place.
      if (!painted) setError(errorMessage(err, 'Failed to load'))
    } finally {
      if (requestId === navigateRequestId.current) setLoading(false)
    }
  }, [currentPath, browseParams, activeChannel, onNavigateStart])

  // Hovering a folder starts fetching its listing, so the click usually lands
  // on a cached one. Not needed once the index is in: that already has it.
  const prefetchFolder = useCallback((path: string): void => {
    if (folderFromIndex(activeChannel, path) || apiPeek('/files/browse/', browseParams(path))) return
    apiFetch<JWApiBrowseResponse>('/files/browse/', browseParams(path)).catch(() => {})
  }, [activeChannel, browseParams])

  // Pull the channel's full file index in once the tab is idle, so every
  // folder (and search) is instant from then on.
  useEffect(() => {
    if (peekFileIndex(activeChannel)) return
    const load = (): void => { void loadFileIndex(activeChannel) }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(load, 1000)
    return () => clearTimeout(t)
  }, [activeChannel])

  // Keep a ref to navigate so popstate/back listeners always have the latest
  // version.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Search runs against the channel's whole file index (fileSearch.ts) for
  // any-order words, filters and typo tolerance. The first search on a channel
  // has to download that index, so a plain server search on the query's
  // longest word fills in meanwhile, filtered through the same syntax.
  useEffect(() => {
    const show = (r: FileSearchResult): void => { setSearchResults(r.entries); setSearchTotal(r.total); setSearchFuzzy(r.fuzzy) }
    const q = parseFileQuery(debouncedSearch)
    if (!isSearching || !hasQuery(q)) { show({ entries: [], total: 0, fuzzy: false }); setSearchLoading(false); return }
    let cancelled = false
    let fromIndex = false
    setSearchLoading(true)
    // Search doesn't navigate, so currentPath is still the folder searched from.
    const within = searchInFolder && currentPath ? currentPath : undefined
    const extra: Record<string, string> = {}
    if (activeChannel) extra.channel = activeChannel
    if (within) extra.path = within
    const server = q.serverTerm ? searchFiles(q.serverTerm, extra).catch(() => [] as JWApiFileEntry[]) : Promise.resolve(null)
    server.then((entries) => {
      if (cancelled || fromIndex || !entries) return
      const r = searchFileIndex(entries, q)
      // An empty early pass keeps the spinner up - the index may still find typos.
      if (r.total > 0) { show(r); setSearchLoading(false) }
    })
    loadFileIndex(activeChannel)
      .then(async (index) => {
        if (cancelled) return
        if (index) { fromIndex = true; show(searchFileIndex(index.items, q, { within, vocab: index.vocab })); return }
        const entries = await server
        if (!cancelled) show(entries ? searchFileIndex(entries, q) : { entries: [], total: 0, fuzzy: false })
      })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, isSearching, activeChannel, searchInFolder])

  /** Start downloading the search index before the first keystroke lands. */
  const prefetchSearchIndex = useCallback(() => { void loadFileIndex(activeChannel) }, [activeChannel])

  // Remember the browsed folder in the store so switching to another tab and
  // back restores it - the component unmounts on tab switch, so local state
  // alone doesn't survive that round trip.
  useEffect(() => {
    setApiFilesLastPath(currentPath)
  }, [currentPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: read path from URL, or an explicit deep-link (apiFilesPath), or
  // fall back to wherever the user last browsed to (apiFilesLastPath).
  useEffect(() => {
    const urlPath = urlToPath(window.location.pathname)
    const initialPath = apiFilesPath || urlPath || apiFilesLastPath
    if (apiFilesPath) setApiFilesPath('')  // consume it
    navigateRef.current(initialPath, false)

    const handlePopstate = (): void => {
      const p = window.location.pathname
      if (p.startsWith('/files')) {
        const fp = urlToPath(p)
        setHistory([])
        navigateRef.current(fp, false)
      }
    }
    window.addEventListener('popstate', handlePopstate)
    return () => window.removeEventListener('popstate', handlePopstate)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (channels.length === 0) loadChannels().catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onChannelChange = (slug: string): void => {
    if (slug === activeChannel) return
    setActiveChannel(slug)
    setHistory([])
    setSearch(''); setDebouncedSearch('')
    setCurrentPath('')
    window.history.pushState({ view: 'api-files', folderPath: '' }, '', pathToUrl(''))
  }

  useEffect(() => {
    navigateRef.current('', false)
  }, [activeChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = (): void => {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      navigateRef.current(prev, false)
    } else if (currentPath) {
      navigateRef.current(parentFolder(currentPath), false)
    }
  }

  const goHome = (): void => { setHistory([]); navigate('', true) }

  return {
    currentPath, entries, loading, error, history, setHistory, navigate, prefetchFolder, goBack, goHome, onChannelChange,
    search, setSearch, debouncedSearch, setDebouncedSearch, searchResults, searchTotal, searchFuzzy, prefetchSearchIndex,
    searchLoading, isSearching, searchInFolder, setSearchInFolder,
  }
}
