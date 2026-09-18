// Shared navigation/search data layer for ApiFilesView.desktop.tsx and
// .mobile.tsx - browsing, history, recursive search, channel switching and
// URL sync were byte-identical between the two views before this extraction.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  apiFetch, apiPeek, JWApiBrowseResponse, JWApiFileEntry, parseBrowseEntries as parseEntries,
} from '../lib/juicewrldApi'
import { parentFolder, pathToUrl, urlToPath } from '../lib/apiFilesShared'
import type { JWApiChannel } from '../lib/juicewrldApi'

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
  goBack: () => void
  goHome: () => void
  onChannelChange: (slug: string) => void
  search: string
  setSearch: (v: string) => void
  debouncedSearch: string
  setDebouncedSearch: (v: string) => void
  searchResults: JWApiFileEntry[]
  searchLoading: boolean
  isSearching: boolean
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
  const [searchLoading, setSearchLoading] = useState(false)
  const isSearching = debouncedSearch.trim().length > 0

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
    // paint it instantly (no spinner) and refresh silently in the background.
    // Only show the loading state when there's nothing cached to fall back on.
    const cached = apiPeek<JWApiBrowseResponse>('/files/browse/', browseParams(path))
    if (cached) {
      setEntries(parseEntries(cached))
      setCurrentPath(path)
      setError(null)
      setLoading(false)
    } else {
      setLoading(true)
      setError(null)
    }
    onNavigateStart?.()
    try {
      const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', browseParams(path))
      if (requestId !== navigateRequestId.current) return
      const items = parseEntries(data)
      if (pushHistory) {
        setHistory((h) => [...h, currentPath])
        window.history.pushState({ view: 'api-files', folderPath: path }, '', pathToUrl(path))
      }
      setCurrentPath(path)
      setEntries(items)
    } catch (err) {
      if (requestId !== navigateRequestId.current) return
      // Keep the cached listing visible on a network failure - only surface the
      // error when we had nothing to show in the first place.
      if (!cached) setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      if (requestId === navigateRequestId.current) setLoading(false)
    }
  }, [currentPath, browseParams, onNavigateStart])

  // Keep a ref to navigate so popstate/back listeners always have the latest
  // version.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!isSearching) { setSearchResults([]); return }
    let cancelled = false
    setSearchLoading(true)
    const params: Record<string, string> = { search: debouncedSearch.trim() }
    if (activeChannel) params.channel = activeChannel
    apiFetch<JWApiBrowseResponse>('/files/browse/', params)
      .then(data => { if (!cancelled) setSearchResults(parseEntries(data)) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, isSearching, activeChannel])

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
    currentPath, entries, loading, error, history, setHistory, navigate, goBack, goHome, onChannelChange,
    search, setSearch, debouncedSearch, setDebouncedSearch, searchResults, searchLoading, isSearching,
  }
}
