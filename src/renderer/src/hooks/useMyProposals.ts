import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMyProposalsPage, withdrawProposal, resubmitProposal, adminReviewProposal } from '../lib/userApi'
import type { ProposalStatusCounts, SongEditProposal } from '../lib/userApi'
import type { ProposalFilterTab } from '../lib/proposalSearch'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'
import { showAppToast } from '../lib/appToast'

const SEARCH_DEBOUNCE_MS = 250

// Owns the "my proposals" list + filter/search/edit/resubmit/withdraw logic
// shared by EditorProfileView.desktop.tsx and .mobile.tsx. `refreshKey` is
// owned by the caller (it also drives sibling hooks - leaderboard, comp
// proposals, reports - off the same refresh button), so it's a parameter
// here rather than state.
//
// Only the first page is fetched; `loadMore` pulls the next one as the list
// is scrolled. The status filter and the search run on the server (so they
// cover rows that haven't been loaded), and the tab totals come back with
// every page rather than being counted from what's on screen.
export function useMyProposals(activeChannel: string, refreshKey: number) {
  const [items, setItems] = useState<SongEditProposal[]>([])
  const [matching, setMatching] = useState(0)
  const [counts, setCounts] = useState<ProposalStatusCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<ProposalFilterTab>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [resubmittingId, setResubmittingId] = useState<number | null>(null)
  const [reviewingId, setReviewingId] = useState<ReadonlySet<number>>(new Set())
  // Which channel/filter/search `items` was loaded for, once one has landed.
  const shownKey = useRef<string | null>(null)
  // Bumped by every reload so a page requested before it can't be appended after.
  const generation = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [search])

  useStrictModeSafeEffect((isCancelled) => {
    const key = `${activeChannel}|${filter}|${query}`
    const gen = ++generation.current
    setRefreshing(true)
    // A new channel, filter or search starts from a blank list; a plain
    // refresh keeps the rows on screen until the fresh first page replaces them.
    if (shownKey.current !== key) setLoading(true)
    setLoadingMore(false)
    getMyProposalsPage(activeChannel, { status: filter === 'all' ? undefined : filter, q: query || undefined })
      .then((page) => {
        if (isCancelled() || gen !== generation.current) return
        shownKey.current = key
        setItems(page.results)
        setMatching(page.count)
        if (page.counts) setCounts(page.counts)
      })
      .catch(() => {})
      .finally(() => {
        if (isCancelled() || gen !== generation.current) return
        setLoading(false)
        setRefreshing(false)
      })
  }, [refreshKey, activeChannel, filter, query])

  const hasMore = items.length < matching

  const loadMore = useCallback((): void => {
    if (loadingMore || loading || itemsRef.current.length >= matching) return
    const gen = generation.current
    setLoadingMore(true)
    getMyProposalsPage(activeChannel, {
      offset: itemsRef.current.length,
      status: filter === 'all' ? undefined : filter,
      q: query || undefined,
    })
      .then((page) => {
        if (gen !== generation.current) return
        // A proposal made or withdrawn between pages shifts the rows by one.
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...page.results.filter((p) => !seen.has(p.id))]
        })
        setMatching(page.count)
        if (page.counts) setCounts(page.counts)
      })
      .catch(() => {})
      .finally(() => { if (gen === generation.current) setLoadingMore(false) })
  }, [activeChannel, filter, query, loading, loadingMore, matching])

  // Keep the tab totals in step with a local change instead of refetching.
  const moveCount = (from: SongEditProposal['status'] | null, to: SongEditProposal['status'] | null): void => {
    setCounts((c) => {
      if (!c) return c
      const next = { ...c }
      if (from) { next[from] = Math.max(0, next[from] - 1); next.total = Math.max(0, next.total - 1) }
      if (to) { next[to] += 1; next.total += 1 }
      return next
    })
  }

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id)
    try {
      await withdrawProposal(id)
      const gone = itemsRef.current.find(p => p.id === id)
      setItems(prev => prev.filter(p => p.id !== id))
      setMatching(m => Math.max(0, m - 1))
      if (gone) moveCount(gone.status, null)
    } catch (e) { console.error('withdraw failed:', e); showAppToast("Couldn't withdraw the proposal") }
    finally { setDeletingId(null) }
  }

  const handleResubmit = async (p: SongEditProposal): Promise<void> => {
    setResubmittingId(p.id)
    try {
      const fresh = await resubmitProposal(p)
      setItems(prev => [fresh, ...prev.filter(x => x.id !== p.id)])
      // The old row is withdrawn and a pending copy takes its place.
      moveCount(p.status, fresh.status)
    } catch (e) { console.error('resubmit failed:', e); showAppToast("Couldn't resubmit the proposal") }
    finally { setResubmittingId(null) }
  }

  // Staff reviewing their own proposal straight from this list - same
  // endpoint as AdminPage's queue; the returned row replaces the local one so
  // the status badge flips without a refetch.
  const handleReview = async (p: SongEditProposal, action: 'approve' | 'reject'): Promise<void> => {
    setReviewingId(s => new Set(s).add(p.id))
    try {
      const updated = await adminReviewProposal(p.id, { action, channel: activeChannel })
      setItems(prev => prev.map(x => x.id === p.id ? updated : x))
      moveCount(p.status, updated.status)
    } catch (e) { console.error('review failed:', e); showAppToast(`Couldn't ${action} the proposal`) }
    finally { setReviewingId(s => { const n = new Set(s); n.delete(p.id); return n }) }
  }

  // A reviewed row leaves a status tab it no longer belongs to.
  const filteredProposals = useMemo(
    () => filter === 'all' ? items : items.filter(p => p.status === filter),
    [items, filter],
  )

  const tabCount = (tab: ProposalFilterTab): number => {
    if (counts) return tab === 'all' ? counts.total : counts[tab]
    return tab === 'all' ? items.length : items.filter(p => p.status === tab).length
  }

  return {
    totalProposals: counts?.total ?? matching,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    loadMore,
    filter, setFilter,
    search, setSearch,
    deletingId,
    resubmittingId,
    reviewingId,
    filteredProposals,
    handleDelete,
    handleResubmit,
    handleReview,
    tabCount,
  }
}
