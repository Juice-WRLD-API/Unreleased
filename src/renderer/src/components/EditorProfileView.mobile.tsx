import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Loader2, Trophy, FileEdit, RefreshCw, Plus, X, Search, Flag, ShieldCheck, FolderOpen,
  Users, Shield, Pencil, Check,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { SongEditProposal, adminProposalCounts, adminCompProposalCounts, adminListApplications, adminListUsers, updateDisplayName, updateAvatar, compressImageFile } from '../lib/userApi'
import * as reportsApi from '../lib/reportsApi'
import ReportsTab from './ReportsTab.mobile'
import AdminPage from './AdminPage.mobile'
import type { AdminTab } from '../hooks/useAdminQueue'
import CompProposalList, { CompFilterBar, filterCompProposals, compProposalSearchText, type CompFilterTab } from './CompProposalList'
import RoleBadges from './RoleBadges'
import { Tile } from './Tile'
import ProposalListItem from './ProposalListItem'
import AddSongModal from './AddSongModal.mobile'
import { useStaffRoles } from '../hooks/useStaffRoles'
import { useMyProposals } from '../hooks/useMyProposals'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useMyCompProposals } from '../hooks/useMyCompProposals'
import { useReportsQueue } from '../hooks/useReportsQueue'
import { RANK_STYLES, type ProposalFilterTab } from '../lib/proposalSearch'

// Bento tile grid, mobile variant - same tile set/logic as
// EditorProfileView.desktop.tsx, but a simple responsive `grid grid-cols-2`
// stack instead of desktop's height-filling bento (mobile Home has no
// equivalent multi-column pattern to match, per the rewrite plan). See
// "Visual Redesign v2 - Bento Dashboard Pivot" in the plan.

type ViewMode = 'grid' | 'admin'

function AdminStatBox({ label, value, highlight, onClick }: {
  label: string
  value: number | string | null | undefined
  highlight?: boolean
  onClick?: () => void
}): JSX.Element {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lg bg-[var(--surface-raised)]/60 px-2 py-1.5 text-center min-w-0 ${onClick ? 'active:bg-[var(--surface-raised)] transition-colors' : ''}`}
    >
      <p className={`text-base font-bold tabular-nums truncate ${highlight ? 'text-accent' : 'text-text-primary'}`}>
        {value === null || value === undefined ? '—' : value}
      </p>
      <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted mt-0.5 truncate">{label}</p>
    </Comp>
  )
}

function LeaderboardRows({ entries, myUsername }: {
  entries: ReturnType<typeof useLeaderboard>['leaderboard']
  myUsername: string | undefined
}): JSX.Element {
  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const isMe = entry.discord_username === myUsername
        const rankStyle = RANK_STYLES[entry.rank]
        return (
          <div
            key={entry.user_id}
            className={`flex items-center gap-3 px-2 py-2 rounded-xl transition-colors ${
              isMe ? 'bg-accent/8 ring-1 ring-accent/20' : ''
            }`}
          >
            <span className="w-5 shrink-0 flex items-center justify-center">
              <span className={`text-sm tabular-nums rounded-md px-1 py-0.5 ${
                rankStyle ? `${rankStyle.num} ${rankStyle.badge}` : 'text-text-muted font-medium'
              }`}>
                {entry.rank}
              </span>
            </span>

            {entry.discord_avatar ? (
              <img src={entry.discord_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center text-xs text-text-muted shrink-0">
                {(entry.discord_username || '?').charAt(0).toUpperCase()}
              </div>
            )}

            <p className={`flex-1 min-w-0 text-sm truncate ${isMe ? 'text-accent font-semibold' : 'text-text-primary'}`}>
              {entry.username || entry.discord_username}
              {isMe && <span className="ml-1.5 text-xs opacity-60 font-normal">you</span>}
            </p>

            <span className={`text-sm tabular-nums shrink-0 font-semibold ${isMe ? 'text-accent' : rankStyle ? rankStyle.num : 'text-text-muted'}`}>
              {entry.approved_count}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function EditorProfileView(): JSX.Element {
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

  const { isContributor, isAdmin, isManager, canReviewReports, canReviewStaff } = useStaffRoles(account, activeChannel, channels)
  // Managers only get the Admin tile (renamed "Manager" for them) - they have
  // no song-edit or report-review power, so they land in its focused view
  // directly rather than on a dashboard grid that's mostly empty for them.
  const managerOnly = isManager && !isAdmin
  // Managers with nothing else to see land straight in the embedded admin
  // panel (see the comment above) - that's the only reason this page still
  // has an embedded AdminPage at all. Everyone else's tile clicks now leave
  // the page entirely (see openAdmin below), so 'admin' mode is otherwise
  // unreachable - a click used to just expand an embedded panel in place,
  // which read as a cramped "tile" for a wide layout like the Users
  // master/detail view.
  const [mode, setMode] = useState<ViewMode>(managerOnly ? 'admin' : 'grid')
  const exitAdmin = (): void => setMode('grid')
  const openAdmin = (tab: AdminTab): void => {
    setActiveAdminTab(tab)
    setActiveView('admin')
  }
  // Which content the merged Proposals/Comp tile shows - see the desktop
  // file's identical toggle for why these two used to be separate tiles.
  const [proposalsView, setProposalsView] = useState<'songs' | 'comp'>('songs')
  // Which "My Proposals" row (if any) has its data expanded - accordion-style,
  // so opening one closes whatever was already open instead of stacking diffs.
  const [expandedProposalId, setExpandedProposalId] = useState<number | null>(null)
  const [compSearch, setCompSearch] = useState('')

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const handleAvatarFile = async (file: File): Promise<void> => {
    setAvatarUploading(true)
    try {
      const base64 = await compressImageFile(file, 256, 200)
      const updated = await updateAvatar(base64)
      useStore.setState({ account: updated })
    } catch { /* ignore */ }
    setAvatarUploading(false)
  }

  function startEditName(): void {
    setNameInput(account?.display_name || account?.discord_username || '')
    setNameError(null)
    setEditingName(true)
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

  const {
    proposals, loading: loadingProposals, refreshing,
    filter, setFilter, search, setSearch, deletingId, resubmittingId,
    filteredProposals, handleDelete, handleResubmit, tabCount,
  } = useMyProposals(activeChannel, refreshKey)

  const { leaderboard, loading: loadingLeaderboard, myEntry } = useLeaderboard(refreshKey, activeChannel, account?.discord_username)

  // Mobile has never wired an onWithdraw handler through to CompProposalList
  // (unlike desktop's Comp tile) - withdrawingId/handleWithdraw are available
  // from the hook but intentionally unused below, matching that existing gap.
  const {
    compProposals, loading: loadingComp, filter: compFilter, setFilter: setCompFilter,
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

  // Preview stats for the Admin/Manager tile - see the desktop file's
  // identical fetch for why this doesn't reuse useAdminQueue, and why the
  // admin-only sections (applications/users) are skipped for managers.
  const [adminPreview, setAdminPreview] = useState<{
    pendingProposals: number
    pendingComp: number
    pendingApplications: number | null
    pendingReports: number | null
    totalUsers: number | null
    totalChannels: number
    totalPending: number
    otpEnabled: boolean | null
    totalProposals: number | null
    approvedProposals: number | null
    approvalPct: number | null
    editors: number | null
    managers: number | null
    applicants: number | null
  } | null>(null)
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
      ]).then(([propCounts, compCounts, apps, reps, users]) => {
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

  const handleEdit = (p: SongEditProposal): void => {
    // p.song is null for 'create' proposals (new song, no backing record yet) -
    // EditorPage handles that case, so don't block it here.
    setPendingEditProposal({ id: p.id, songId: p.song, proposedData: p.proposed_data, editorNotes: p.editor_notes || '' })
    setPendingEditorSongId(p.song)
    setActiveView('editor')
  }

  const FILTER_TABS: { key: ProposalFilterTab; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'pending',  label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ]

  // ── Focused mode: managers with no dashboard of their own land straight
  // here (see the mode/managerOnly comment above) - reachable only for them
  // now, so there's no "back to dashboard" control; there's nothing to go
  // back to. ──
  if (mode === 'admin' && canReviewStaff) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <AdminPage embedded onExit={exitAdmin} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── Header: identity row + refresh ── */}
      <div className="shrink-0 px-2 pt-1">
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 pl-2.5 flex items-center gap-3">
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAvatarFile(f); e.target.value = '' }} />
            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="relative w-11 h-11 shrink-0 rounded-full active:opacity-80">
              {account?.avatar ? (
                <img src={account.avatar} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-[var(--border)]" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">
                  {(account?.display_name || account?.discord_username || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center ring-2 ring-surface">
                {avatarUploading ? <Loader2 size={10} className="animate-spin" /> : <Pencil size={10} />}
              </span>
            </button>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveDisplayName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    maxLength={50}
                    disabled={savingName}
                    className="min-w-0 flex-1 bg-[var(--surface-raised)] border border-[var(--border)] rounded-md px-1.5 py-0.5 text-text-primary text-[15px] font-bold focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={saveDisplayName}
                    disabled={savingName}
                    className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-accent active:bg-accent/15 transition-colors disabled:opacity-40"
                    title="Save"
                  >
                    {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-text-muted active:bg-surface-overlay transition-colors disabled:opacity-40"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <h1 className="text-text-primary text-[17px] font-bold leading-tight truncate flex items-center gap-1.5">
                  {account?.display_name || account?.discord_username || 'My Profile'}
                  <button
                    onClick={startEditName}
                    className="p-0.5 rounded text-text-muted active:bg-surface-overlay transition-colors shrink-0"
                    title="Edit display name"
                  >
                    <Pencil size={12} />
                  </button>
                </h1>
              )}
              {nameError && <p className="text-[10px] text-red-400">{nameError}</p>}
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted truncate">
                {myEntry
                  ? `Rank #${myEntry.rank} · ${myEntry.approved_count} approved`
                  : !loadingProposals ? `${proposals.length} proposal${proposals.length !== 1 ? 's' : ''} submitted` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={refreshing}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Roles + channel switcher row */}
        <div className="flex items-center gap-1.5 pl-2.5 pt-1.5 pb-2 flex-wrap">
          <RoleBadges isAdmin={isAdmin} isManager={isManager} isEditor={!!account?.is_editor} isContributor={isContributor} />
          {channels.length > 1 && (
            <div className="flex items-center bg-surface-overlay rounded-full p-0.5 gap-0.5 shrink-0 ml-auto">
              {channels.map((ch) => (
                <button
                  key={ch.slug}
                  onClick={() => setActiveChannel(ch.slug)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${activeChannel === ch.slug ? 'bg-surface-raised text-text-primary' : 'text-text-muted'}`}
                  title={ch.description || ch.name}
                >{ch.name}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bento grid ── */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-2 gap-3">

          {/* Identity/quick actions */}
          <Tile title="Quick actions" span="col-span-2">
            <div className="flex items-center gap-2 flex-wrap">
              {(account?.is_editor || account?.is_administrator) && (
                <button
                  onClick={() => setShowAddSong(true)}
                  className="flex items-center gap-1 h-8 px-3 rounded-full bg-accent/15 active:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                >
                  <Plus size={12} /> New song
                </button>
              )}
              {(account?.is_editor || account?.is_administrator) && (
                <button
                  onClick={() => setActiveView('albums-admin')}
                  className="flex items-center gap-1 h-8 px-3 rounded-full bg-surface-raised active:bg-surface-highest text-text-secondary text-xs font-semibold transition-colors"
                >
                  Edit albums
                </button>
              )}
              {isContributor && (
                <button
                  onClick={() => setActiveView('contributor')}
                  className="flex items-center gap-1 h-8 px-3 rounded-full bg-accent/15 active:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                >
                  <Plus size={12} /> New comp proposal
                </button>
              )}
            </div>
          </Tile>

          {/* My Proposals / Comp Files - merged, full width. Contributors get
              a toggle here instead of Tile's fixed title, matching the
              desktop variant. */}
          <Tile title={isContributor ? undefined : 'My Proposals'} icon={isContributor ? undefined : <FileEdit size={13} />} span="col-span-2">
            {isContributor && (
              <div className="flex items-center gap-1 mb-2 shrink-0">
                <button
                  onClick={() => setProposalsView('songs')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                    proposalsView === 'songs' ? 'bg-accent/15 text-accent' : 'text-text-muted'
                  }`}
                >
                  <FileEdit size={13} /> Proposals
                </button>
                <button
                  onClick={() => setProposalsView('comp')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                    proposalsView === 'comp' ? 'bg-accent/15 text-accent' : 'text-text-muted'
                  }`}
                >
                  <FolderOpen size={13} /> Comp files
                </button>
              </div>
            )}

            {proposalsView === 'songs' || !isContributor ? (
              <>
                <div className="mb-2 shrink-0">
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search proposals…"
                      className="w-full bg-surface-overlay text-text-primary text-sm pl-9 pr-9 py-2.5 rounded-xl outline-none border border-transparent focus:border-accent/40 placeholder:text-text-muted"
                    />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-text-muted active:text-text-primary">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
                    {FILTER_TABS.map(({ key, label }) => {
                      const count = tabCount(key)
                      const active = filter === key
                      return (
                        <button
                          key={key}
                          onClick={() => setFilter(key)}
                          className={`shrink-0 flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold transition-colors ${
                            active ? 'bg-accent/15 text-accent' : 'text-text-muted bg-surface-overlay'
                          }`}
                        >
                          {label}
                          {count > 0 && (
                            <span className={`text-[10px] tabular-nums ${active ? 'text-accent/70' : 'text-text-muted'}`}>
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                    {(account?.is_editor || account?.is_administrator) && (
                      <button
                        onClick={() => setShowAddSong(true)}
                        className="shrink-0 ml-auto flex items-center gap-1 h-8 px-3 rounded-full bg-accent/15 active:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                      >
                        <Plus size={12} /> New song
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto min-h-0 pr-1">
                  {loadingProposals ? (
                    <div className="flex justify-center py-12">
                      <Loader2 size={18} className="animate-spin text-text-muted" />
                    </div>
                  ) : filteredProposals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted opacity-50">
                      <FileEdit size={28} />
                      <p className="text-sm">
                        {search.trim()
                          ? `No proposals match "${search.trim()}"`
                          : filter === 'all' ? 'No proposals yet' : `No ${filter} proposals`}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredProposals.map((p) => (
                        <ProposalListItem
                          key={p.id}
                          proposal={p}
                          onEdit={handleEdit}
                          onResubmit={handleResubmit}
                          onDelete={handleDelete}
                          resubmittingId={resubmittingId}
                          deletingId={deletingId}
                          variant="mobile"
                          expanded={expandedProposalId === p.id}
                          onToggleExpand={() => setExpandedProposalId(id => id === p.id ? null : p.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={compSearch}
                    onChange={(e) => setCompSearch(e.target.value)}
                    placeholder="Search comp files…"
                    className="w-full bg-surface-overlay text-text-primary text-sm pl-9 pr-9 py-2.5 rounded-xl outline-none border border-transparent focus:border-accent/40 placeholder:text-text-muted"
                  />
                  {compSearch && (
                    <button onClick={() => setCompSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-text-muted active:text-text-primary">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-2 shrink-0">
                  <CompFilterBar
                    filter={compFilter}
                    setFilter={setCompFilter}
                    counts={{ all: compTabCount('all'), pending: compTabCount('pending'), approved: compTabCount('approved'), rejected: compTabCount('rejected') }}
                  />
                  <button
                    onClick={() => setActiveView('contributor')}
                    className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded-full bg-accent/15 active:bg-accent/25 text-accent text-[11px] font-semibold transition-colors shrink-0"
                  >
                    <Plus size={11} /> New comp proposal
                  </button>
                </div>
                <p className="text-xs text-text-muted mb-2 shrink-0">
                  {compProposals.filter(p => p.status === 'approved').length} approved comp proposals
                </p>
                <div className="max-h-96 overflow-y-auto min-h-0 pr-1">
                  <CompProposalList
                    proposals={filteredCompProposals}
                    loading={loadingComp}
                    onSelect={() => setActiveView('contributor')}
                    empty={compSearch.trim() ? `No comp files match "${compSearch.trim()}"` : undefined}
                  />
                </div>
              </>
            )}
          </Tile>

          {/* Leaderboard - full width */}
          <Tile title="Leaderboard" icon={<Trophy size={13} />} span="col-span-2">
            <div className="max-h-64 overflow-y-auto min-h-0 pr-1">
              {loadingLeaderboard ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-text-muted" />
                </div>
              ) : leaderboard.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-text-muted opacity-50">
                  <Trophy size={24} />
                  <p className="text-sm">No data</p>
                </div>
              ) : (
                <LeaderboardRows entries={leaderboard} myUsername={account?.discord_username} />
              )}
            </div>
          </Tile>

          {/* Reports - full width */}
          {canReviewReports && (
            <Tile title="Reports" icon={<Flag size={13} />} span="col-span-2">
              <div className="relative min-h-0 -m-4">
                {loadingReports && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]/60 backdrop-blur-[1px]">
                    <Loader2 size={20} className="animate-spin text-text-muted" />
                  </div>
                )}
                <ReportsTab
                  reports={reports}
                  status={reportStatus}
                  setStatus={setReportStatus}
                  onChanged={() => setRefreshKey(k => k + 1)}
                />
              </div>
            </Tile>
          )}

          {/* Admin/Manager entry point - full width */}
          {canReviewStaff && (
            <Tile title={isAdmin ? 'Admin' : 'Manager'} icon={<ShieldCheck size={13} />} span="col-span-2">
              <div className="flex flex-col gap-3 py-1 text-text-muted">
                {/* Managers only ever reach Comp files, so they get that one
                    count; admins get one box per queue their nav opens into,
                    plus Channels (free) and a Total pending rollup in place
                    of a meaningless "Stats" count. */}
                <div className={`grid gap-1.5 ${isAdmin ? 'grid-cols-4' : 'grid-cols-2'}`}>
                  <AdminStatBox label="Song edits" value={adminPreview?.pendingProposals} highlight={!!adminPreview?.pendingProposals} onClick={() => openAdmin('proposals')} />
                  <AdminStatBox label="Comp files" value={adminPreview?.pendingComp} highlight={!!adminPreview?.pendingComp} onClick={() => openAdmin('comp-proposals')} />
                  {isAdmin && (
                    <>
                      <AdminStatBox label="Applications" value={adminPreview?.pendingApplications} highlight={!!adminPreview?.pendingApplications} onClick={() => openAdmin('applications')} />
                      <AdminStatBox label="Reports" value={adminPreview?.pendingReports} highlight={!!adminPreview?.pendingReports} onClick={() => openAdmin('reports')} />
                      <AdminStatBox label="Users" value={adminPreview?.totalUsers} onClick={() => openAdmin('users')} />
                      <AdminStatBox label="Channels" value={adminPreview?.totalChannels} onClick={() => openAdmin('channels')} />
                      <AdminStatBox label="Total pending" value={adminPreview?.totalPending} highlight={!!adminPreview?.totalPending} />
                      <AdminStatBox
                        label="Security"
                        value={adminPreview ? (adminPreview.otpEnabled ? 'ON' : 'OFF') : undefined}
                        highlight={adminPreview?.otpEnabled === false}
                        onClick={() => openAdmin('security')}
                      />
                    </>
                  )}
                </div>

                {/* Every section already opens from the stat box above it -
                    no leftover "Stats" button, so the old Stats tab's own
                    metrics (previously hidden behind that button) get laid
                    out right here instead, in the space that freed up. */}
                {isAdmin && (
                  <div className="grid grid-cols-4 gap-1.5">
                    <AdminStatBox label="Total proposals" value={adminPreview?.totalProposals} />
                    <AdminStatBox label="Approved" value={adminPreview?.approvedProposals} highlight={!!adminPreview?.approvedProposals} />
                    <AdminStatBox label="Approval rate" value={adminPreview?.approvalPct != null ? `${adminPreview.approvalPct}%` : undefined} />
                    <AdminStatBox label="Editors" value={adminPreview?.editors} />
                    <AdminStatBox label="Managers" value={adminPreview?.managers} />
                    <AdminStatBox label="Applicants" value={adminPreview?.applicants} />
                  </div>
                )}
              </div>
            </Tile>
          )}

        </div>
      </div>

      {showAddSong && (
        <AddSongModal
          onClose={() => setShowAddSong(false)}
          onSubmitted={() => setRefreshKey(k => k + 1)}
          channel={activeChannel}
        />
      )}
    </div>
  )
}
