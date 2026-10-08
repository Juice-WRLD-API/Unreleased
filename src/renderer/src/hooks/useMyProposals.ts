import { useMemo, useState } from 'react'
import { getMyProposals, withdrawProposal, resubmitProposal } from '../lib/userApi'
import type { SongEditProposal } from '../lib/userApi'
import { proposalSearchText, type ProposalFilterTab } from '../lib/proposalSearch'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'

// Owns the "my proposals" list + filter/search/edit/resubmit/withdraw logic
// shared by EditorProfileView.desktop.tsx and .mobile.tsx. `refreshKey` is
// owned by the caller (it also drives sibling hooks - leaderboard, comp
// proposals, reports - off the same refresh button), so it's a parameter
// here rather than state.
export function useMyProposals(activeChannel: string, refreshKey: number) {
  const [proposals, setProposals] = useState<SongEditProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<ProposalFilterTab>('all')
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [resubmittingId, setResubmittingId] = useState<number | null>(null)

  useStrictModeSafeEffect((isCancelled) => {
    setRefreshing(true)
    getMyProposals(activeChannel)
      .then((data) => { if (!isCancelled()) setProposals(data) })
      .catch(() => {})
      .finally(() => {
        if (isCancelled()) return
        setLoading(false)
        setRefreshing(false)
      })
  }, [refreshKey, activeChannel])

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id)
    try {
      await withdrawProposal(id)
      setProposals(prev => prev.filter(p => p.id !== id))
    } catch (e) { console.error('withdraw failed:', e) }
    finally { setDeletingId(null) }
  }

  const handleResubmit = async (p: SongEditProposal): Promise<void> => {
    setResubmittingId(p.id)
    try {
      const fresh = await resubmitProposal(p)
      setProposals(prev => [fresh, ...prev.filter(x => x.id !== p.id)])
    } catch (e) { console.error('resubmit failed:', e) }
    finally { setResubmittingId(null) }
  }

  const filteredProposals = useMemo(() => {
    const byStatus = filter === 'all' ? proposals : proposals.filter(p => p.status === filter)
    const q = search.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(p => proposalSearchText(p).includes(q))
  }, [proposals, filter, search])

  const tabCount = (tab: ProposalFilterTab): number =>
    tab === 'all' ? proposals.length : proposals.filter(p => p.status === tab).length

  return {
    proposals,
    loading,
    refreshing,
    filter, setFilter,
    search, setSearch,
    deletingId,
    resubmittingId,
    filteredProposals,
    handleDelete,
    handleResubmit,
    tabCount,
  }
}
