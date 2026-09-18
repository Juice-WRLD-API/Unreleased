// Shared data/logic for the Tier List game (TierlistView). Desktop uses
// native HTML5 drag-and-drop, mobile uses a hand-rolled Pointer Events drag
// (see TierlistView.mobile.tsx's own comments) - those drag mechanics are
// genuinely different and stay local to each view. Everything else (pool
// loading, persistence, tier CRUD, search/filter) was byte-identical between
// the two files and lives here instead.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadPools } from '../lib/heardle'
import type { HeardleSong, PoolId } from '../lib/heardle'
import {
  loadTierlistState, saveTierlistState, resetTierlistState, newTierId,
  unsortedSongs, songsInTier, TIER_COLOR_PRESETS,
} from '../lib/tierlist'
import type { Tier, TierlistState } from '../lib/tierlist'

const DEFAULT_CATEGORIES: PoolId[] = ['released', 'unreleased']

export function useTierlistData(): {
  state: TierlistState
  tiers: Tier[]
  assignments: TierlistState['assignments']
  categories: PoolId[]
  pool: HeardleSong[]
  poolLoading: boolean
  poolError: string | null
  search: string
  setSearch: (v: string) => void
  selectedSongId: number | null
  setSelectedSongId: React.Dispatch<React.SetStateAction<number | null>>
  editingTier: Tier | null
  setEditingTier: (t: Tier | null) => void
  showFilters: boolean
  setShowFilters: (v: boolean) => void
  visiblePool: HeardleSong[]
  songsInTier: (tierId: string) => HeardleSong[]
  assignSong: (songId: number, tierId: string | null) => void
  clickRow: (tierId: string | null) => () => void
  moveTier: (index: number, dir: -1 | 1) => void
  addTier: () => void
  updateTier: (tier: Tier) => void
  deleteTier: (tierId: string) => void
  toggleCategory: (cat: PoolId) => void
  handleReset: () => void
} {
  const [state, setState] = useState<TierlistState>(() => loadTierlistState())
  const [categories, setCategories] = useState<PoolId[]>(DEFAULT_CATEGORIES)
  const [pool, setPool] = useState<HeardleSong[]>([])
  const [poolLoading, setPoolLoading] = useState(true)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null)
  const [editingTier, setEditingTier] = useState<Tier | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPoolLoading(true)
    setPoolError(null)
    loadPools(categories)
      .then((songs) => { if (!cancelled) setPool(songs) })
      .catch((err) => { if (!cancelled) setPoolError(err instanceof Error ? err.message : 'Failed to load songs') })
      .finally(() => { if (!cancelled) setPoolLoading(false) })
    return () => { cancelled = true }
  }, [categories])

  useEffect(() => { saveTierlistState(state) }, [state])

  const { tiers, assignments } = state

  const visiblePool = useMemo(() => {
    const unsorted = unsortedSongs(pool, assignments)
    const q = search.trim().toLowerCase()
    if (!q) return unsorted
    return unsorted.filter((s) => s.titles.some((t) => t.toLowerCase().includes(q)))
  }, [pool, assignments, search])

  // Selecting the tier a song currently belongs to (or the pool, for
  // unassigning) is meant as a no-op, not a nudge to re-render - keeping the
  // state identity-equal skips the save effect that would otherwise fire.
  // useCallback with no deps (setState/setSelectedSongId are stable useState
  // setters): the mobile view's touch-drag pointermove/pointerup listeners
  // chain off this identity and need it stable across renders while a drag
  // is in progress (setDrag/setDropTarget re-render the component on every
  // pointermove) - see TierlistView.mobile.tsx's handleSongPointerUp comment.
  const assignSong = useCallback((songId: number, tierId: string | null): void => {
    setState((prev) => {
      const current = prev.assignments[songId] ?? null
      if (current === tierId) return prev
      const next = { ...prev.assignments }
      if (tierId) next[songId] = tierId
      else delete next[songId]
      return { ...prev, assignments: next }
    })
    setSelectedSongId(null)
  }, [])

  const clickRow = (tierId: string | null) => (): void => {
    if (selectedSongId !== null) assignSong(selectedSongId, tierId)
  }

  const moveTier = (index: number, dir: -1 | 1): void => {
    setState((prev) => {
      const next = [...prev.tiers]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, tiers: next }
    })
  }

  const addTier = (): void => {
    setState((prev) => ({
      ...prev,
      tiers: [
        ...prev.tiers,
        { id: newTierId(), label: 'New', color: TIER_COLOR_PRESETS[prev.tiers.length % TIER_COLOR_PRESETS.length] },
      ],
    }))
  }

  const updateTier = (tier: Tier): void => {
    setState((prev) => ({ ...prev, tiers: prev.tiers.map((t) => (t.id === tier.id ? tier : t)) }))
    setEditingTier(tier)
  }

  const deleteTier = (tierId: string): void => {
    setState((prev) => {
      const nextAssignments = { ...prev.assignments }
      for (const [songId, tid] of Object.entries(nextAssignments)) {
        if (tid === tierId) delete nextAssignments[Number(songId)]
      }
      return { tiers: prev.tiers.filter((t) => t.id !== tierId), assignments: nextAssignments }
    })
    setEditingTier(null)
  }

  const toggleCategory = (cat: PoolId): void => {
    setCategories((prev) => {
      const next = prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
      return next.length > 0 ? next : prev // never leave nothing to draw from
    })
  }

  const handleReset = (): void => {
    if (!window.confirm('Clear the whole tier list? This removes every ranking and custom tier.')) return
    setState(resetTierlistState())
    setSelectedSongId(null)
  }

  return {
    state, tiers, assignments, categories, pool, poolLoading, poolError,
    search, setSearch, selectedSongId, setSelectedSongId, editingTier, setEditingTier,
    showFilters, setShowFilters, visiblePool,
    songsInTier: (tierId: string) => songsInTier(pool, assignments, tierId),
    assignSong, clickRow, moveTier, addTier, updateTier, deleteTier, toggleCategory, handleReset,
  }
}
