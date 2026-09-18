// Shared data/logic for the comp (recording session) file-proposal review
// queue. Desktop and mobile CompProposalsTab wrap this in their own layout.
import { useCallback, useEffect, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { CompFileProposal, ProposalStatus } from '../lib/userApi'
import { getToken } from '../lib/userApi'

/** Loads a comp-admin route's bytes into an object URL - the staging file
 *  isn't public like a live comp/ path, so it needs the same authed fetch
 *  downloadStaging already uses, just kept in memory instead of saved to
 *  disk. Torn down (URL revoked) on unmount or when the source URL changes,
 *  since a leaked object URL pins the blob in memory for the page's life. */
export function useAuthedBlobUrl(url: string | null): { src: string | null; loading: boolean; error: boolean; bytes: number | null } {
  const [state, setState] = useState<{ src: string | null; loading: boolean; error: boolean; bytes: number | null }>(
    { src: null, loading: !!url, error: false, bytes: null },
  )
  useEffect(() => {
    if (!url) { setState({ src: null, loading: false, error: false, bytes: null }); return }
    let cancelled = false
    let objectUrl: string | null = null
    setState({ src: null, loading: true, error: false, bytes: null })
    const token = getToken()
    fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob() })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ src: objectUrl, loading: false, error: false, bytes: blob.size })
      })
      .catch(() => { if (!cancelled) setState({ src: null, loading: false, error: true, bytes: null }) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  return state
}

export function useCompProposalsQueue(
  activeChannel: string,
  onChanged: (() => void) | undefined,
  // Desktop applies the review/reverse endpoint's returned row to the list
  // immediately (so the acted-on row updates without waiting on reload()'s
  // round-trip); mobile relies on reload() alone. Preserved as a param
  // rather than forced to match, since that's this queue's one behavioral
  // difference between the two views.
  applyOptimistic: boolean,
): {
  status: ProposalStatus | ''
  setStatus: (s: ProposalStatus | '') => void
  proposals: CompFileProposal[]
  selected: CompFileProposal | null
  setSelected: (p: CompFileProposal | null) => void
  loading: boolean
  actionId: number | null
  reviewNotes: string
  setReviewNotes: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  loadError: string | null
  reload: () => void
  doReview: (id: number, action: 'approve' | 'reject') => Promise<void>
  doReverse: (id: number) => Promise<void>
  downloadStaging: (p: CompFileProposal) => void
  bulkApproving: boolean
  doAcceptAll: (ids: number[]) => Promise<void>
} {
  const [status, setStatus] = useState<ProposalStatus | ''>('pending')
  const [proposals, setProposals] = useState<CompFileProposal[]>([])
  const [selected, setSelected] = useState<CompFileProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Separate from `error` (review/reverse action failures, shown in the detail
  // pane) - this covers the list fetch itself and has to stay visible even
  // with nothing selected, since a channel-access failure clears the list.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bulkApproving, setBulkApproving] = useState(false)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    userApi.adminListCompProposals(status || undefined, activeChannel)
      .then(rows => {
        setProposals(rows)
        // Reviewing a proposal reloads the list and moves the selection, so
        // the notes box has to reset with it - otherwise the text typed for
        // the proposal just approved rides along into the next Approve.
        setSelected(rows[0] ?? null)
        setReviewNotes('')
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Could not load comp proposals')
        // Don't leave the previous channel's list on screen underneath the
        // error - its approve/reject actions would still be live against the
        // wrong channel context.
        setProposals([])
        setSelected(null)
      })
      .finally(() => setLoading(false))
  }, [status, refreshKey, activeChannel])

  const reload = useCallback((): void => {
    setRefreshKey(k => k + 1)
    onChanged?.()
  }, [onChanged])

  // The review/reverse endpoints hand back the updated row, so the list can
  // reflect it immediately instead of waiting on the reload() round-trip
  // below - that fetch still runs (for the row's neighbors and to reconcile
  // final ordering), it just no longer gates how long the acted-on row keeps
  // showing as pending. Dropped from view outright when it no longer matches
  // the current status filter, same as the server-side list would show.
  const applyReviewResult = useCallback((updated: CompFileProposal): void => {
    setProposals(prev => {
      const next = prev.map(p => p.id === updated.id ? updated : p)
      return status && updated.status !== status ? next.filter(p => p.id !== updated.id) : next
    })
  }, [status])

  const doReview = useCallback(async (id: number, action: 'approve' | 'reject'): Promise<void> => {
    setActionId(id)
    setError(null)
    try {
      const updated = await userApi.adminReviewCompProposal(id, { action, review_notes: reviewNotes, channel: activeChannel })
      if (applyOptimistic) applyReviewResult(updated)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action} this proposal`)
    } finally {
      setActionId(null)
    }
  }, [reviewNotes, activeChannel, applyOptimistic, applyReviewResult, reload])

  // Approves a batch of already-filtered ids (caller excludes anything the
  // reviewer isn't allowed to approve, e.g. delete_folder gating) in
  // sequence rather than in parallel - folder moves/renames can depend on
  // each other landing in order. review_notes is left blank: the notes box
  // reflects whatever's currently selected, which has no bearing on the
  // rest of the batch. A per-item failure is swallowed so one bad row
  // doesn't stop the rest.
  const doAcceptAll = useCallback(async (ids: number[]): Promise<void> => {
    if (ids.length === 0) return
    setBulkApproving(true)
    setError(null)
    try {
      for (const id of ids) {
        try {
          const updated = await userApi.adminReviewCompProposal(id, { action: 'approve', review_notes: '', channel: activeChannel })
          if (applyOptimistic) applyReviewResult(updated)
        } catch {}
      }
      reload()
    } finally {
      setBulkApproving(false)
    }
  }, [activeChannel, applyOptimistic, applyReviewResult, reload])

  const doReverse = useCallback(async (id: number): Promise<void> => {
    setActionId(id)
    setError(null)
    try {
      const updated = await userApi.adminReverseCompProposal(id, activeChannel)
      if (applyOptimistic) applyReviewResult(updated)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reverse this proposal')
    } finally {
      setActionId(null)
    }
  }, [activeChannel, applyOptimistic, applyReviewResult, reload])

  const downloadStaging = useCallback((p: CompFileProposal): void => {
    const token = getToken()
    const url = userApi.adminCompProposalStagingUrl(p.id, activeChannel)
    fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const href = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = href
        a.download = p.staging_filename || 'staged-file'
        // Anchor has to be in the document for the click to count in some
        // browsers, and the object URL has to outlive the click - revoking it
        // on the same tick cancels the download before it starts.
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(href), 60_000)
      })
      .catch(() => {})
  }, [activeChannel])

  return {
    status, setStatus, proposals, selected, setSelected, loading, actionId,
    reviewNotes, setReviewNotes, error, setError, loadError, reload,
    doReview, doReverse, downloadStaging, bulkApproving, doAcceptAll,
  }
}
