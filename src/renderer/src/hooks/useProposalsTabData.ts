// Shared search/sort/pagination/history logic for AdminPage's ProposalsTab
// (desktop + mobile). Selection state, the review/reverse actions, and
// playProposalSong all stay in each view: desktop patches the row in place
// and keeps the selection while mobile deselects back to the list, and the
// two playProposalSong copies check the playable path at different points
// (mobile checks the raw API song.path, desktop checks the resolved
// track.path after songToTrack's session-edit-source substitution) - not
// guaranteed equivalent, so not collapsed into one.
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { SongEditProposal } from '../lib/userApi'
import { buildHaystack, matchesHaystack } from '../components/adminShared'
import { invalidateLyricsCache } from '../components/Player'
import { PROPOSAL_PAGE, sortProposals, type ProposalSort } from '../lib/proposalRevise'

export function useProposalsTabData(proposals: SongEditProposal[], channel: string | undefined, selected: SongEditProposal | null): {
  sortBy: ProposalSort
  setSortBy: (s: ProposalSort) => void
  query: string
  setQuery: (v: string) => void
  sortedProposals: SongEditProposal[]
  pageOf: SongEditProposal[]
  remaining: number
  setShown: React.Dispatch<React.SetStateAction<number>>
  dropCache: (id: number) => void
  archive: SongEditProposal[] | null
  setArchive: React.Dispatch<React.SetStateAction<SongEditProposal[] | null>>
  archiveLoading: boolean
  archiveError: boolean
  historyOpen: boolean
  setHistoryOpen: (v: boolean) => void
  openHistory: () => void
  expandedPast: number | null
  setExpandedPast: React.Dispatch<React.SetStateAction<number | null>>
  history: SongEditProposal[]
  pastCount: number
  loadingSongId: number | null
  setLoadingSongId: React.Dispatch<React.SetStateAction<number | null>>
  playError: string | null
  setPlayError: React.Dispatch<React.SetStateAction<string | null>>
} {
  const [sortBy, setSortBy] = useState<ProposalSort>('date')
  const [query, setQuery] = useState('')

  // Every proposal ever filed, fetched once and only when the history panel is
  // first opened - /admin/proposals/ has no per-song filter, so "what else has
  // been proposed for this song" means holding the whole archive and grouping
  // client-side. Nulled by the caller after a review so the next open reflects it.
  const [archive, setArchive] = useState<SongEditProposal[] | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expandedPast, setExpandedPast] = useState<number | null>(null)

  const [loadingSongId, setLoadingSongId] = useState<number | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)

  // Searchable: the song title, who filed it, the change type, and both ids -
  // the public song id is what reports and Discord threads cite, so pasting
  // one should land on its proposal. Built once per fetch: under the "All"
  // filter this list is the entire archive, and doing it inline in the filter
  // meant re-flattening every row on every keystroke.
  const haystacks = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of proposals) {
      m.set(p.id, buildHaystack(p.title, p.editor_username, p.change_type, p.song_public_id, p.id))
    }
    return m
  }, [proposals])

  // The filter runs against a deferred copy of the query, so a keystroke
  // repaints the input immediately and React re-runs the list at a lower
  // priority - typing stays smooth even when the match set is huge.
  const deferredQuery = useDeferredValue(query)

  const sortedProposals = useMemo(() => sortProposals(
    deferredQuery.trim()
      ? proposals.filter(p => matchesHaystack(deferredQuery, haystacks.get(p.id)))
      : proposals,
    sortBy,
  ), [proposals, haystacks, sortBy, deferredQuery])

  // The list isn't windowed, and "All" can be the entire archive - mounting
  // every row costs several DOM nodes each before the user has even typed.
  // Render a page at a time and let them ask for more; searching normally
  // narrows the set well below the cap anyway.
  const [shown, setShown] = useState(PROPOSAL_PAGE)
  useEffect(() => { setShown(PROPOSAL_PAGE) }, [proposals, deferredQuery, sortBy])
  const pageOf = sortedProposals.slice(0, shown)
  const remaining = sortedProposals.length - pageOf.length

  // Approving/reversing a proposal changes a song's live data - drop its
  // cached lyrics so the next play reflects it.
  const dropCache = (id: number): void => {
    const songId = proposals.find(p => p.id === id)?.song
    if (songId != null) invalidateLyricsCache(songId)
  }

  const openHistory = (): void => {
    const next = !historyOpen
    setHistoryOpen(next)
    if (!next || archive || archiveLoading) return
    setArchiveLoading(true)
    setArchiveError(false)
    userApi.adminListProposals(undefined, channel)
      .then(setArchive)
      .catch(() => setArchiveError(true))
      .finally(() => setArchiveLoading(false))
  }

  // Newest first, and it deliberately includes the proposal being viewed - the
  // point is to read this one in the context of the run, so dropping it leaves
  // a hole in the timeline. It's marked "viewing" instead.
  const history = useMemo(() => {
    if (!selected?.song || !archive) return []
    return archive
      .filter(r => r.song === selected.song)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  }, [archive, selected?.song])
  const pastCount = Math.max(history.length - 1, 0)

  // Both are about the proposal on screen, so neither should outlive it.
  useEffect(() => { setExpandedPast(null); setPlayError(null) }, [selected?.id])

  return {
    sortBy, setSortBy, query, setQuery, sortedProposals, pageOf, remaining, setShown,
    dropCache, archive, setArchive, archiveLoading, archiveError,
    historyOpen, setHistoryOpen, openHistory, expandedPast, setExpandedPast,
    history, pastCount, loadingSongId, setLoadingSongId, playError, setPlayError,
  }
}
