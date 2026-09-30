// Shared data/logic for the Tier List game (TierlistView). Desktop uses
// native HTML5 drag-and-drop, mobile uses a hand-rolled Pointer Events drag
// (see TierlistView.mobile.tsx's own comments) - those drag mechanics are
// genuinely different and stay local to each view. Everything else (saved
// lists, account sync, sharing, pool loading, filters, persistence, tier
// CRUD, search) lives here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPools, poolAgeMs, refreshPool, poolEras } from '../lib/heardle'
import type { HeardleSong, PoolId } from '../lib/heardle'
import {
  loadTierlistLibrary, saveTierlistLibrary, newTierlist, newTierId, placeSong as placeInRows,
  albumMatcher, matchesSearch, TIER_COLOR_PRESETS,
} from '../lib/tierlist'
import type { Tier, Tierlist, TierlistFilters, TierlistLibrary, DropPosition } from '../lib/tierlist'
import { isDirty } from '../lib/tierlist'
import { fullSync, pushChanges, fromServer } from '../lib/tierlistSync'
import type { SyncIO, SyncResult } from '../lib/tierlistSync'
import { getPublicTierlist } from '../lib/tierlistApi'
import type { ServerTierlist } from '../lib/tierlistApi'
import { shareOrigin } from '../lib/platform'
import { fetchAlbums } from '../lib/albumsApi'
import type { Album } from '../lib/albumsApi'
import { getAllVersionGroups } from '../lib/versionsApi'
import { resolvePrefCoverUrl } from '../lib/juicewrldApi'
import { peekRotatedCover } from '../lib/coverRotation'
import { useStorePick } from '../store/useStore'
import { errorMessage } from '../lib/format'

// Both catalogues are always loaded, whatever the list's filter says: a
// ranked song has to keep rendering in its tier after the filter that let it
// in is switched off, and filtering the already-loaded pool is instant.
const ALL_POOLS: PoolId[] = ['released', 'unreleased']

// A cached pool older than this is served straight away and then refetched
// in the background, so a cover (or title) edited on the API shows up here
// without waiting out the pool's day-long cache.
const REVALIDATE_AFTER_MS = 10 * 60 * 1000

// Edits are pushed this long after the last one, so a burst of drags goes up
// as one request per list rather than one per drop.
const PUSH_DEBOUNCE_MS = 1500

export type SyncState = 'signed-out' | 'syncing' | 'synced' | 'error' | 'unsupported'

/** Someone's public list opened from a /tierlist?id= link. */
export type ViewingState =
  | { status: 'loading'; id: number }
  | { status: 'error'; id: number; message: string }
  | { status: 'ready'; id: number; list: ServerTierlist }

function sharedIdFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('id')
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : NaN
  return Number.isFinite(id) && id > 0 ? id : null
}

function clearSharedIdFromUrl(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('id')) return
  url.searchParams.delete('id')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
}

export function useTierlistData() {
  const [library, setLibraryState] = useState<TierlistLibrary>(() => loadTierlistLibrary())
  // The ref is the source of truth for writes: sync reads it between awaits
  // and must see its own earlier writes immediately, not after a re-render.
  // Saving happens here too rather than in an effect, so a sync result that
  // lands after the view unmounted (a list's new server id) still persists.
  const libRef = useRef(library)
  const setLibrary = useCallback((fn: (prev: TierlistLibrary) => TierlistLibrary): void => {
    const next = fn(libRef.current)
    if (next === libRef.current) return
    libRef.current = next
    saveTierlistLibrary(next)
    setLibraryState(next)
  }, [])
  const [rawPool, setRawPool] = useState<HeardleSong[]>([])
  const [poolLoading, setPoolLoading] = useState(true)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [albums, setAlbums] = useState<Album[]>([])
  const [groupOf, setGroupOf] = useState<Map<number, number>>(new Map())
  const [search, setSearch] = useState('')
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null)
  const [editingTier, setEditingTier] = useState<Tier | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showLists, setShowLists] = useState(false)
  const { songPrefs, eraCovers, account } = useStorePick('songPrefs', 'eraCovers', 'account')
  const accountId = account?.id ?? null
  const [syncState, setSyncState] = useState<SyncState>(accountId ? 'syncing' : 'signed-out')
  const [viewing, setViewing] = useState<ViewingState | null>(() => {
    const id = sharedIdFromUrl()
    return id !== null ? { status: 'loading', id } : null
  })

  const refreshSongs = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const pools = await Promise.all(ALL_POOLS.map(refreshPool))
      setRawPool(pools.flat())
      setPoolError(null)
    } catch (err) {
      setPoolError(errorMessage(err, 'Failed to refresh songs'))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadPools(ALL_POOLS)
      .then((songs) => {
        if (cancelled) return
        setRawPool(songs)
        if (ALL_POOLS.some((c) => poolAgeMs(c) > REVALIDATE_AFTER_MS)) void refreshSongs()
      })
      .catch((err) => { if (!cancelled) setPoolError(errorMessage(err, 'Failed to load songs')) })
      .finally(() => { if (!cancelled) setPoolLoading(false) })
    fetchAlbums()
      .then((list) => {
        if (!cancelled) setAlbums([...list].sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? '')))
      })
      .catch(() => {})
    getAllVersionGroups()
      .then((rows) => { if (!cancelled) setGroupOf(new Map(rows.map((r) => [r.songId, r.groupId]))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [refreshSongs])

  // ─── Account sync ─────────────────────────────────────────────────────────

  const io = useMemo<SyncIO>(() => ({ get: () => libRef.current, apply: setLibrary }), [setLibrary])
  // One sync at a time; a change that arrives mid-sync queues exactly one more.
  const syncing = useRef<Promise<void> | null>(null)
  const syncAgain = useRef(false)
  const unsupported = useRef(false)

  const runSync = useCallback((kind: 'full' | 'push'): void => {
    if (accountId === null || unsupported.current) return
    if (syncing.current) { syncAgain.current = true; return }
    setSyncState('syncing')
    const job = kind === 'full' ? fullSync(io, accountId) : pushChanges(io, accountId)
    syncing.current = job
      .then((res: SyncResult) => {
        if (res === 'unsupported') { unsupported.current = true; setSyncState('unsupported') }
        else setSyncState('synced')
      })
      .catch(() => setSyncState('error'))
      .finally(() => {
        syncing.current = null
        if (syncAgain.current) { syncAgain.current = false; runSync('push') }
      })
  }, [accountId, io])

  useEffect(() => {
    unsupported.current = false
    if (accountId === null) { setSyncState('signed-out'); return }
    runSync('full')
  }, [accountId, runSync])

  const needsPush = library.pendingDeletes.length > 0 || library.lists.some(isDirty)
  useEffect(() => {
    if (!needsPush || accountId === null) return
    const t = window.setTimeout(() => runSync('push'), PUSH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [library, needsPush, accountId, runSync])

  // Leaving the view mid-debounce shouldn't strand the last edit locally.
  const pushOnLeave = useRef(() => {})
  pushOnLeave.current = () => { if (needsPush) runSync('push') }
  useEffect(() => () => pushOnLeave.current(), [])

  // Songs as the rest of the app shows them: the user's own name and cover
  // for a song win, then a rotated suggestion, then their era cover (not for
  // released songs) - same precedence as songToTrack. Re-derived whenever
  // those overrides change, so changing a cover elsewhere shows up here live.
  const pool = useMemo(() => rawPool.map((s): HeardleSong => {
    const pref = songPrefs[s.id]
    const cover = resolvePrefCoverUrl(pref?.cover_url)
      ?? peekRotatedCover(s.id)
      ?? (s.category !== 'released' && s.era ? resolvePrefCoverUrl(eraCovers[s.era]) : undefined)
    const name = pref?.name || s.name
    if (!cover && name === s.name) return s
    return {
      ...s,
      name,
      imageUrl: cover ?? s.imageUrl,
      titles: name === s.name ? s.titles : [name, ...s.titles],
    }
  }), [rawPool, songPrefs, eraCovers])

  const songById = useMemo(() => new Map(pool.map((s) => [s.id, s])), [pool])

  const list = library.lists.find((l) => l.id === library.activeId) ?? library.lists[0]
  const { tiers, rows, filters } = list

  const updateList = useCallback((fn: (l: Tierlist) => Tierlist): void => {
    setLibrary((prev) => ({
      ...prev,
      lists: prev.lists.map((l) => {
        if (l.id !== prev.activeId) return l
        const next = fn(l)
        return next === l ? l : { ...next, updatedAt: Date.now() }
      }),
    }))
  }, [])

  // ─── Lists ────────────────────────────────────────────────────────────────

  const switchList = (id: string): void => {
    setLibrary((prev) => ({ ...prev, activeId: id }))
    setSelectedSongId(null)
    setSearch('')
  }

  const createList = (name: string, albumId: number | null): void => {
    const created = newTierlist(name.trim() || 'Untitled tier list', {
      ...filters,
      albumId,
      eras: albumId !== null ? [] : filters.eras,
    })
    setLibrary((prev) => ({ ...prev, activeId: created.id, lists: [...prev.lists, created] }))
    setSelectedSongId(null)
    setSearch('')
  }

  const renameList = (id: string, name: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    setLibrary((prev) => ({
      ...prev,
      lists: prev.lists.map((l) => (l.id === id ? { ...l, name: trimmed, updatedAt: Date.now() } : l)),
    }))
  }

  const duplicateList = (id: string): void => {
    const src = library.lists.find((l) => l.id === id)
    if (!src) return
    const copy: Tierlist = {
      ...newTierlist(`${src.name} (copy)`, src.filters),
      tiers: src.tiers.map((t) => ({ ...t })),
      rows: Object.fromEntries(Object.entries(src.rows).map(([k, v]) => [k, [...v]])),
    }
    setLibrary((prev) => ({ ...prev, activeId: copy.id, lists: [...prev.lists, copy] }))
  }

  const setListPublic = (id: string, isPublic: boolean): void => {
    setLibrary((prev) => ({
      ...prev,
      lists: prev.lists.map((l) => (l.id === id ? { ...l, isPublic, updatedAt: Date.now() } : l)),
    }))
  }

  /** The list's share link, once it's on the account. */
  const shareUrl = (l: Tierlist): string | null =>
    l.serverId !== undefined ? `${shareOrigin()}/tierlist?id=${l.serverId}` : null

  const deleteList = (id: string): void => {
    const target = library.lists.find((l) => l.id === id)
    if (!target) return
    if (!window.confirm(`Delete "${target.name}"? Its rankings can't be recovered.`)) return
    setLibrary((prev) => {
      const remaining = prev.lists.filter((l) => l.id !== id)
      const pendingDeletes = target.serverId !== undefined ? [...prev.pendingDeletes, target.serverId] : prev.pendingDeletes
      if (remaining.length === 0) {
        const fresh = newTierlist('My tier list')
        return { activeId: fresh.id, lists: [fresh], pendingDeletes }
      }
      return { activeId: prev.activeId === id ? remaining[0].id : prev.activeId, lists: remaining, pendingDeletes }
    })
  }

  // ─── Viewing someone's shared list ────────────────────────────────────────

  const viewingId = viewing?.id ?? null
  useEffect(() => {
    if (viewingId === null) return
    // One of your own: just open it for editing.
    const own = libRef.current.lists.find((l) => l.serverId === viewingId)
    if (own) {
      setLibrary((prev) => ({ ...prev, activeId: own.id }))
      setViewing(null)
      clearSharedIdFromUrl()
      return
    }
    let cancelled = false
    getPublicTierlist(viewingId)
      .then((l) => { if (!cancelled) setViewing({ status: 'ready', id: viewingId, list: l }) })
      .catch((err) => {
        if (!cancelled) setViewing({ status: 'error', id: viewingId, message: errorMessage(err, "This tier list isn't available.") })
      })
    return () => { cancelled = true }
  }, [viewingId, setLibrary])

  const closeViewing = (): void => {
    setViewing(null)
    clearSharedIdFromUrl()
  }

  /** Copies the list being viewed into your own library, to edit freely. */
  const saveViewingCopy = (): void => {
    if (viewing?.status !== 'ready') return
    const src = fromServer(viewing.list, undefined)
    if (!src) return
    const copy: Tierlist = {
      ...newTierlist(viewing.list.name, src.filters),
      tiers: src.tiers,
      rows: src.rows,
    }
    setLibrary((prev) => ({ ...prev, activeId: copy.id, lists: [...prev.lists, copy] }))
    closeViewing()
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  const setFilters = (patch: Partial<TierlistFilters>): void => {
    updateList((l) => ({ ...l, filters: { ...l.filters, ...patch } }))
  }

  const toggleCategory = (cat: PoolId): void => {
    const next = filters.categories.includes(cat)
      ? filters.categories.filter((c) => c !== cat)
      : [...filters.categories, cat]
    if (next.length > 0) setFilters({ categories: next }) // never leave nothing to draw from
  }

  const toggleEra = (era: string): void => {
    setFilters({ eras: filters.eras.includes(era) ? filters.eras.filter((e) => e !== era) : [...filters.eras, era] })
  }

  const clearEras = (): void => setFilters({ eras: [] })

  const setAlbum = (albumId: number | null): void => setFilters({ albumId })

  const album = filters.albumId !== null ? albums.find((a) => a.id === filters.albumId) ?? null : null

  const eraOptions = useMemo(
    () => poolEras(pool.filter((s) => filters.categories.includes(s.category as PoolId))),
    [pool, filters.categories],
  )

  const ranked = useMemo(() => {
    const set = new Set<number>()
    for (const ids of Object.values(rows)) for (const id of ids) set.add(id)
    return set
  }, [rows])

  // Everything the list's filters let in, ranked or not - what "x of y
  // ranked" counts against.
  const filteredPool = useMemo(() => {
    const cats = new Set(filters.categories)
    if (filters.albumId !== null) {
      // Albums still loading: show nothing rather than the whole catalogue.
      if (!album) return []
      const match = albumMatcher(album, pool, groupOf)
      const hits: { song: HeardleSong; order: number; kind: number }[] = []
      for (const song of pool) {
        const m = match(song)
        if (!m) continue
        if (m.kind === 'track' ? !cats.has('released') : !cats.has('unreleased')) continue
        hits.push({ song, order: m.order, kind: m.kind === 'track' ? 0 : 1 })
      }
      hits.sort((a, b) => a.order - b.order || a.kind - b.kind || a.song.name.localeCompare(b.song.name))
      return hits.map((h) => h.song)
    }
    const eras = new Set(filters.eras)
    return pool.filter((s) => cats.has(s.category as PoolId) && (eras.size === 0 || (!!s.era && eras.has(s.era))))
  }, [pool, filters, album, groupOf])

  const visiblePool = useMemo(
    () => filteredPool.filter((s) => !ranked.has(s.id) && matchesSearch(s, search)),
    [filteredPool, ranked, search],
  )

  const songsInTier = (tierId: string): HeardleSong[] =>
    (rows[tierId] ?? []).map((id) => songById.get(id)).filter((s): s is HeardleSong => !!s)

  // ─── Ranking ──────────────────────────────────────────────────────────────

  // useCallback with stable deps: the mobile view's touch-drag
  // pointermove/pointerup listeners chain off this identity and need it
  // stable while a drag is in progress - see TierlistView.mobile.tsx's
  // handleSongPointerUp comment.
  const placeSong = useCallback((songId: number, tierId: string | null, at?: DropPosition | null): void => {
    updateList((l) => {
      const next = placeInRows(l.rows, songId, tierId, at)
      return next === l.rows ? l : { ...l, rows: next }
    })
    setSelectedSongId(null)
  }, [updateList])

  const clickRow = (tierId: string | null) => (): void => {
    if (selectedSongId !== null) placeSong(selectedSongId, tierId)
  }

  const moveTier = (index: number, dir: -1 | 1): void => {
    updateList((l) => {
      const next = [...l.tiers]
      const target = index + dir
      if (target < 0 || target >= next.length) return l
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...l, tiers: next }
    })
  }

  const addTier = (): void => {
    updateList((l) => {
      const id = newTierId()
      return {
        ...l,
        tiers: [...l.tiers, { id, label: 'New', color: TIER_COLOR_PRESETS[l.tiers.length % TIER_COLOR_PRESETS.length] }],
        rows: { ...l.rows, [id]: [] },
      }
    })
  }

  const updateTier = (tier: Tier): void => {
    updateList((l) => ({ ...l, tiers: l.tiers.map((t) => (t.id === tier.id ? tier : t)) }))
    setEditingTier(tier)
  }

  const deleteTier = (tierId: string): void => {
    updateList((l) => {
      const nextRows = { ...l.rows }
      delete nextRows[tierId]
      return { ...l, tiers: l.tiers.filter((t) => t.id !== tierId), rows: nextRows }
    })
    setEditingTier(null)
  }

  const handleReset = (): void => {
    if (!window.confirm(`Clear every ranking in "${list.name}"? Your tiers and filters stay.`)) return
    updateList((l) => ({ ...l, rows: Object.fromEntries(l.tiers.map((t) => [t.id, []])) }))
    setSelectedSongId(null)
  }

  const viewingSongsInTier = (tierId: string): HeardleSong[] =>
    viewing?.status === 'ready'
      ? (viewing.list.data?.rows?.[tierId] ?? []).map((id) => songById.get(id)).filter((s): s is HeardleSong => !!s)
      : []

  return {
    lists: library.lists, list, switchList, createList, renameList, duplicateList, deleteList,
    setListPublic, shareUrl, syncState, signedIn: accountId !== null, retrySync: () => runSync('full'),
    viewing, closeViewing, saveViewingCopy, viewingSongsInTier,
    showLists, setShowLists,
    tiers, filters, album, albums, eraOptions, toggleCategory, toggleEra, clearEras, setAlbum,
    pool, poolLoading, poolError, refreshing, refreshSongs,
    filteredCount: filteredPool.length,
    rankedInFilter: filteredPool.filter((s) => ranked.has(s.id)).length,
    search, setSearch, selectedSongId, setSelectedSongId, editingTier, setEditingTier,
    showFilters, setShowFilters, visiblePool, songsInTier,
    placeSong, clickRow, moveTier, addTier, updateTier, deleteTier, handleReset,
  }
}

export type TierlistData = ReturnType<typeof useTierlistData>
