// Shared data/logic for the profile bento dashboard (EditorProfileView).
// Desktop and mobile wrap this in their own JSX/layout - keep behavior here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import {
  SongEditProposal, adminProposalCounts, adminCompProposalCounts, adminListApplications,
  adminListUsers, updateDisplayName, updateAvatar, compressImageFile,
} from '../lib/userApi'
import { accountDisplayName } from '../lib/format'
import * as reportsApi from '../lib/reportsApi'
import { fetchEraList } from '../lib/erasApi'
import type { AdminTab } from './useAdminQueue'
import { filterCompProposals, compProposalSearchText, type CompFilterTab } from '../components/CompProposalList'
import { useStaffRoles } from './useStaffRoles'
import { useMyProposals } from './useMyProposals'
import { useLeaderboard } from './useLeaderboard'
import { useMyCompProposals } from './useMyCompProposals'
import { useReportsQueue } from './useReportsQueue'
import type { ProposalFilterTab } from '../lib/proposalSearch'

export const PROPOSAL_FILTER_TABS: { key: ProposalFilterTab; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

export interface AdminPreview {
  pendingProposals: number
  pendingComp: number
  pendingApplications: number | null
  pendingReports: number | null
  totalUsers: number | null
  totalChannels: number
  totalEras: number | null
  totalPending: number
  otpEnabled: boolean | null
  totalProposals: number | null
  approvedProposals: number | null
  approvalPct: number | null
  editors: number | null
  managers: number | null
  applicants: number | null
}

export function useEditorProfileView(): {
  account: ReturnType<typeof useStore.getState>['account']
  setActiveView: ReturnType<typeof useStore.getState>['setActiveView']
  setActiveAdminTab: ReturnType<typeof useStore.getState>['setActiveAdminTab']
  activeChannel: ReturnType<typeof useStore.getState>['activeChannel']
  channels: ReturnType<typeof useStore.getState>['channels']
  setActiveChannel: ReturnType<typeof useStore.getState>['setActiveChannel']
  editingName: boolean
  nameInput: string
  setNameInput: (v: string) => void
  savingName: boolean
  nameError: string | null
  startEditName: () => void
  saveDisplayName: () => Promise<void>
  cancelEditName: () => void
  avatarUploading: boolean
  avatarError: string | null
  handleAvatarFile: (file: File) => Promise<void>
  refreshKey: number
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>
  showAddSong: boolean
  setShowAddSong: (v: boolean) => void
  openAdmin: (tab: AdminTab) => void
  proposalsView: 'songs' | 'comp'
  setProposalsView: (v: 'songs' | 'comp') => void
  expandedProposalId: number | null
  setExpandedProposalId: React.Dispatch<React.SetStateAction<number | null>>
  compSearch: string
  setCompSearch: (v: string) => void
  isContributor: boolean
  isAdmin: boolean
  isManager: boolean
  canReviewReports: boolean
  canReviewStaff: boolean
  proposals: ReturnType<typeof useMyProposals>['proposals']
  loadingProposals: boolean
  refreshing: boolean
  filter: ProposalFilterTab
  setFilter: ReturnType<typeof useMyProposals>['setFilter']
  search: string
  setSearch: (v: string) => void
  deletingId: number | null
  resubmittingId: number | null
  filteredProposals: ReturnType<typeof useMyProposals>['filteredProposals']
  handleDelete: ReturnType<typeof useMyProposals>['handleDelete']
  handleResubmit: ReturnType<typeof useMyProposals>['handleResubmit']
  tabCount: ReturnType<typeof useMyProposals>['tabCount']
  leaderboard: ReturnType<typeof useLeaderboard>['leaderboard']
  loadingLeaderboard: boolean
  myEntry: ReturnType<typeof useLeaderboard>['myEntry']
  compProposals: ReturnType<typeof useMyCompProposals>['compProposals']
  loadingComp: boolean
  compFilter: CompFilterTab
  setCompFilter: ReturnType<typeof useMyCompProposals>['setFilter']
  withdrawingCompId: ReturnType<typeof useMyCompProposals>['withdrawingId']
  handleWithdrawComp: ReturnType<typeof useMyCompProposals>['handleWithdraw']
  compTabCount: (tab: CompFilterTab) => number
  filteredCompProposals: ReturnType<typeof filterCompProposals>
  reports: ReturnType<typeof useReportsQueue>['reports']
  reportStatus: ReturnType<typeof useReportsQueue>['status']
  setReportStatus: ReturnType<typeof useReportsQueue>['setStatus']
  loadingReports: boolean
  adminPreview: AdminPreview | null
  otpLocked: boolean
  handleEdit: (p: SongEditProposal) => void
} {
  const { account, setActiveView, setActiveAdminTab, setPendingEditorSongId, setPendingEditProposal, activeChannel, channels, setActiveChannel, loadChannels } = useStore(useShallow(s => ({
    account: s.account,
    setActiveView: s.setActiveView,
    setActiveAdminTab: s.setActiveAdminTab,
    setPendingEditorSongId: s.setPendingEditorSongId,
    setPendingEditProposal: s.setPendingEditProposal,
    activeChannel: s.activeChannel,
    channels: s.channels,
    setActiveChannel: s.setActiveChannel,
    loadChannels: s.loadChannels,
  })))

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const handleAvatarFile = async (file: File): Promise<void> => {
    setAvatarError(null)
    setAvatarUploading(true)
    try {
      const base64 = await compressImageFile(file, 256, 200)
      const updated = await updateAvatar(base64)
      useStore.setState({ account: updated })
    } catch {
      setAvatarError('Could not update photo.')
    }
    setAvatarUploading(false)
  }

  function startEditName(): void {
    setNameInput(accountDisplayName(account))
    setNameError(null)
    setEditingName(true)
  }

  function cancelEditName(): void {
    setEditingName(false)
  }

  async function saveDisplayName(): Promise<void> {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === account?.display_name) { setEditingName(false); return }
    setSavingName(true)
    setNameError(null)
    try {
      const updated = await updateDisplayName(trimmed)
      useStore.setState({ account: updated })
      setEditingName(false)
    } catch {
      setNameError('Could not save. Try again.')
    } finally {
      setSavingName(false)
    }
  }

  // Every list on this page - my proposals, my comp proposals, the Admin
  // tile's review queues - is already scoped to activeChannel (see the
  // effects below and AdminPage). ApiFilesView is the only other place that
  // lets a user change it; without a switcher here too, reviewing a second
  // channel meant leaving the profile to flip it in Files first.
  useEffect(() => { if (channels.length === 0) loadChannels().catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Read live in the admin-preview effect below without being a dependency
  // of it - channels.length changes once loadChannels() resolves just after
  // mount, and that used to re-run the whole admin fetch (a second /users
  // request etc.) purely to update a count nothing else in that fetch needs.
  const channelsRef = useRef(channels)
  useEffect(() => { channelsRef.current = channels }, [channels])

  const [refreshKey, setRefreshKey] = useState(0)
  const [showAddSong, setShowAddSong] = useState(false)
  // A click on the Admin tile's own stat boxes used to expand an embedded
  // AdminPage in place on this page - that read as a cramped "tile" for a
  // wide layout like the Users master/detail view, so this now leaves the
  // page entirely for the real standalone console at its own deep link
  // (e.g. /users), same as typing the URL would.
  const openAdmin = (tab: AdminTab): void => {
    setActiveAdminTab(tab)
    setActiveView('admin')
  }
  // Which content the merged Proposals/Comp tile shows - only contributors
  // ever see the toggle (non-contributors have no comp proposals to switch
  // to), so this stays 'songs' for everyone else.
  const [proposalsView, setProposalsView] = useState<'songs' | 'comp'>('songs')
  // Which "My Proposals" row (if any) has its data expanded - accordion-style,
  // so opening one closes whatever was already open instead of stacking diffs.
  const [expandedProposalId, setExpandedProposalId] = useState<number | null>(null)
  const [compSearch, setCompSearch] = useState('')

  // Not `|| is_administrator`: this tile lists proposals *you* submitted, and
  // an admin who never contributed has none. Their review queue is the Admin
  // tile's "Comp files" - the one place proposals are reviewed. Managers
  // review the same two queues admins do, so they get the same embedded
  // panel here. Scoped to the active channel - a manager grant on one
  // channel shouldn't leave this tile visible (and then erroring) on a
  // channel they don't actually manage.
  const { isContributor, isAdmin, isManager, canReviewReports, canReviewStaff } = useStaffRoles(account, activeChannel, channels)

  const {
    proposals, loading: loadingProposals, refreshing,
    filter, setFilter, search, setSearch, deletingId, resubmittingId,
    filteredProposals, handleDelete, handleResubmit, tabCount,
  } = useMyProposals(activeChannel, refreshKey)

  const { leaderboard, loading: loadingLeaderboard, myEntry } = useLeaderboard(refreshKey, activeChannel, account?.discord_username)

  // Grid mode has no "active tab" gating a tile's own fetch - every visible
  // tile is live at once - so this is gated on the role condition alone
  // (still exactly the role-gating logic from before, just not additionally
  // gated on tab selection).
  const {
    compProposals, loading: loadingComp, filter: compFilter, setFilter: setCompFilter,
    withdrawingId: withdrawingCompId, handleWithdraw: handleWithdrawComp,
  } = useMyCompProposals(isContributor, activeChannel, refreshKey, () => setRefreshKey(k => k + 1))

  const compTabCount = (tab: CompFilterTab): number => filterCompProposals(compProposals, tab).length

  const filteredCompProposals = useMemo(() => {
    const byStatus = filterCompProposals(compProposals, compFilter)
    const q = compSearch.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(p => compProposalSearchText(p).includes(q))
  }, [compProposals, compFilter, compSearch])

  const {
    reports, status: reportStatus, setStatus: setReportStatus, loading: loadingReports,
  } = useReportsQueue(canReviewReports, refreshKey)

  // Preview stats for the Admin/Manager tile - one per section of the queues
  // it opens into. Deliberately its own fetch rather than reusing
  // useAdminQueue: that hook only ever loads whichever tab is active inside
  // AdminPage, so pulling eight counts out of it here would mean cycling
  // through every tab just to populate a tile preview. Managers only ever see
  // Song edits + Comp files in their own nav (see useAdminQueue's
  // managerNavIds), so the admin-only sections (applications/users) are
  // skipped for them rather than fetched against endpoints that would 403.
  const [adminPreview, setAdminPreview] = useState<AdminPreview | null>(null)
  useEffect(() => {
    if (!canReviewStaff) { setAdminPreview(null); return }
    let cancelled = false
    // Deferred by one microtask so React StrictMode's dev-only synchronous
    // double-invoke (mount → cleanup → remount) skips firing the actual
    // network requests on the first, soon-to-be-cleaned-up pass - cleanup
    // sets `cancelled` before this queued callback runs, so only the second
    // (real) invocation's requests go out. Same "guard the redundant re-run"
    // idea as Player.tsx's StrictMode comment, applied to a fetch instead of
    // an audio-src assignment.
    Promise.resolve().then(() => {
      if (cancelled) return
      Promise.all([
        adminProposalCounts(activeChannel),
        adminCompProposalCounts(activeChannel),
        isAdmin ? adminListApplications('pending') : Promise.resolve(null),
        isAdmin ? reportsApi.listSongReports('pending') : Promise.resolve(null),
        isAdmin ? adminListUsers() : Promise.resolve(null),
        isAdmin ? fetchEraList() : Promise.resolve(null),
      ]).then(([propCounts, compCounts, apps, reps, users, eras]) => {
        if (cancelled) return
        const pendingApplications = apps?.length ?? null
        const pendingReports = reps?.length ?? null
        const reviewed = propCounts.total - propCounts.pending
        setAdminPreview({
          pendingProposals: propCounts.pending,
          pendingComp: compCounts.pending,
          pendingApplications,
          pendingReports,
          totalUsers: users?.length ?? null,
          totalChannels: channelsRef.current.length,
          totalEras: eras?.length ?? null,
          totalPending: propCounts.pending + compCounts.pending + (pendingApplications ?? 0) + (pendingReports ?? 0),
          otpEnabled: isAdmin ? !!account?.otp_enabled : null,
          totalProposals: isAdmin ? propCounts.total : null,
          approvedProposals: isAdmin ? propCounts.approved : null,
          approvalPct: isAdmin ? (reviewed > 0 ? Math.round(propCounts.approved / reviewed * 100) : 0) : null,
          editors: users ? users.filter(u => u.role === 'editor').length : null,
          managers: users ? users.filter(u => !!u.manager_enabled).length : null,
          applicants: users ? users.filter(u => u.role === 'applicant').length : null,
        })
      }).catch(() => { if (!cancelled) setAdminPreview(null) })
    })
    return () => { cancelled = true }
    // channels.length deliberately excluded - see channelsRef comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReviewStaff, isAdmin, activeChannel, refreshKey, account?.otp_enabled])

  // Admins without 2FA get everything in the Admin tile hidden except the
  // Security box itself, so a compromised (password-only) admin account
  // can't be used to browse or act on admin-only data from this dashboard.
  const otpLocked = isAdmin && adminPreview?.otpEnabled === false

  const handleEdit = (p: SongEditProposal): void => {
    // p.song is null for 'create' proposals (new song, no backing record yet) -
    // EditorPage handles that case, so don't block it here.
    setPendingEditProposal({ id: p.id, songId: p.song, proposedData: p.proposed_data, editorNotes: p.editor_notes || '' })
    setPendingEditorSongId(p.song)
    setActiveView('editor')
  }

  return {
    account, setActiveView, setActiveAdminTab, activeChannel, channels, setActiveChannel,
    editingName, nameInput, setNameInput, savingName, nameError, startEditName, saveDisplayName, cancelEditName,
    avatarUploading, avatarError, handleAvatarFile,
    refreshKey, setRefreshKey, showAddSong, setShowAddSong, openAdmin,
    proposalsView, setProposalsView, expandedProposalId, setExpandedProposalId, compSearch, setCompSearch,
    isContributor, isAdmin, isManager, canReviewReports, canReviewStaff,
    proposals, loadingProposals, refreshing, filter, setFilter, search, setSearch, deletingId, resubmittingId,
    filteredProposals, handleDelete, handleResubmit, tabCount,
    leaderboard, loadingLeaderboard, myEntry,
    compProposals, loadingComp, compFilter, setCompFilter, withdrawingCompId, handleWithdrawComp,
    compTabCount, filteredCompProposals,
    reports, reportStatus, setReportStatus, loadingReports,
    adminPreview, otpLocked, handleEdit,
  }
}
