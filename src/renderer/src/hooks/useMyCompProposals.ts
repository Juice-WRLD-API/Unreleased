import { useState } from 'react'
import { getMyCompProposals, withdrawCompProposal } from '../lib/userApi'
import type { CompFileProposal } from '../lib/userApi'
import type { CompFilterTab } from '../components/CompProposalList'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'

// Owns the contributor's own comp-proposal list + filter + withdraw, shared
// by EditorProfileView.desktop.tsx/.mobile.tsx (and, per the rewrite plan,
// eventually ContributorProfileView/ContributorPage too).
//
// `enabled` gates the fetch effect exactly like the original
// `if (profileTab !== 'comp' || !isContributor) return` guard.
// `onWithdrawFailed` mirrors EditorProfileView.desktop.tsx's existing
// handleWithdrawComp, which falls back to a full refresh (bumping
// refreshKey) if the DELETE call fails, instead of leaving the row stuck in
// a withdrawing state with no explanation.
export function useMyCompProposals(
  enabled: boolean,
  activeChannel: string,
  refreshKey: number,
  onWithdrawFailed?: () => void,
) {
  const [compProposals, setCompProposals] = useState<CompFileProposal[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<CompFilterTab>('all')
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)

  useStrictModeSafeEffect((isCancelled) => {
    if (!enabled) return
    setLoading(true)
    getMyCompProposals(activeChannel)
      .then((data) => { if (!isCancelled()) setCompProposals(data) })
      .catch(() => {})
      .finally(() => { if (!isCancelled()) setLoading(false) })
  }, [enabled, refreshKey, activeChannel])

  const handleWithdraw = async (id: number): Promise<void> => {
    setWithdrawingId(id)
    try {
      await withdrawCompProposal(id)
      setCompProposals(prev => prev.filter(p => p.id !== id))
    } catch {
      onWithdrawFailed?.()
    } finally {
      setWithdrawingId(null)
    }
  }

  return { compProposals, loading, filter, setFilter, withdrawingId, handleWithdraw }
}
