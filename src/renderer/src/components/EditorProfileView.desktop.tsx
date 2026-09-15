import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Loader2, Trophy, FileEdit, ChevronLeft, RefreshCw, Plus, X, Search, Flag, ShieldCheck, FolderOpen,
  Users, Shield,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { SongEditProposal, adminProposalCounts, adminCompProposalCounts, adminListApplications, adminListUsers } from '../lib/userApi'
import * as reportsApi from '../lib/reportsApi'
import ReportsTab from './ReportsTab'
import type { AdminTab } from '../hooks/useAdminQueue'
import CompProposalList, { CompFilterBar, filterCompProposals, compProposalSearchText, type CompFilterTab } from './CompProposalList'
import RoleBadges from './RoleBadges'
import { Tile } from './Tile'
import ProposalListItem from './ProposalListItem'
import AddSongModal from './AddSongModal.desktop'
import { useStaffRoles } from '../hooks/useStaffRoles'
import { useMyProposals } from '../hooks/useMyProposals'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useMyCompProposals } from '../hooks/useMyCompProposals'
import { useReportsQueue } from '../hooks/useReportsQueue'
import { RANK_STYLES, type ProposalFilterTab } from '../lib/proposalSearch'

// Bento tile grid - replaces the v1 header+tabs+single-panel layout (see
// "Visual Redesign v2 - Bento Dashboard Pivot" in the rewrite plan). Reuses
// the app's own Tile primitive (originally HomeView.desktop.tsx's bento
// rework) so this page is visually unmistakable from the old tab-bar shape
// while staying consistent with where the rest of the app is heading.
// Everything below is height-bound (h-full inside App's fixed-height
// <main>), not page-scrolling - individual tiles scroll internally.

function AdminStatBox({ label, value, highlight, onClick }: {
  label: string
  value: number | string | null | undefined
  /** Render the value in accent color - pass for a "pending" count that's
   *  nonzero, or any other value worth calling out. Plain totals (Users,
   *  Channels) leave this unset. */
  highlight?: boolean
  onClick?: () => void
}): JSX.Element {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lg bg-[var(--surface-raised)]/60 px-2 py-1.5 text-center min-w-0 ${onClick ? 'hover:bg-[var(--surface-raised)] transition-colors cursor-pointer' : ''}`}
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
            className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
              isMe ? 'bg-accent/8 ring-1 ring-accent/20' : 'hover:bg-surface-overlay'
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
  const go = setActiveView
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
    go('editor')
  }

  const FILTER_TABS: { key: ProposalFilterTab; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'pending',  label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── Toolbar: back, channel switcher, refresh ── */}
      <div className="flex items-center justify-between px-4 md:px-5 pt-4 pb-3 shrink-0">
        <button
          onClick={() => go('api-tracker')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-xs transition-colors"
        >
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-1.5">
          {channels.length > 0 && (
            <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5 mr-1">
              {channels.map((ch) => (
                <button
                  key={ch.slug}
                  onClick={() => setActiveChannel(ch.slug)}
                  disabled={channels.length === 1}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${activeChannel === ch.slug ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'} disabled:opacity-70`}
                  title={ch.description || ch.name}
                >{ch.name}</button>
              ))}
            </div>
          )}
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={refreshing}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Bento grid ──
          Explicit left/right columns instead of one grid with mixed
          row-spans: auto-placement with uneven spans (1/2/3 rows across a
          4-col track) produced an unpredictable implicit row count, so
          `auto-rows-[minmax(0,1fr)]` squeezed some tracks down to a sliver
          and let others (Reports' old -m-4 escape-hatch especially) bleed
          past their tile's rounded border. Every grid below is now either
          non-spanning (safe auto-placement) or a single flex-1 cell, with
          min-h-0 threaded down each flex/grid ancestor so a tile's own
          content scrolls internally instead of overflowing it. */}
      <div className="flex-1 overflow-y-auto md:overflow-hidden px-4 md:px-5 pb-4 md:pb-5">
        <div className="flex flex-col gap-3 md:gap-4 md:h-full">

          {/* Top row: identity+stats and Quick actions side by side, sharing
              a flex row (default items-stretch) so they render at the same
              height - as two independent columns they used to size to their
              own content and rarely lined up. */}
          <div className="flex flex-col md:flex-row gap-3 md:gap-4 shrink-0">
            {/* Identity + Stats - one tile: the two were separate cards
                showing barely more than a name and three lines of text each,
                which read as empty space more than information. */}
            <div className="md:w-[42%]">
              <Tile span="h-full">
                <div className="flex-1 flex items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {account?.discord_avatar ? (
                        <img src={account.discord_avatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-[var(--border)]" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold shrink-0">
                          {(account?.display_name || account?.discord_username || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h1 className="text-text-primary text-base font-bold truncate">
                          {account?.display_name || account?.discord_username || 'My Profile'}
                        </h1>
                        <div className="mt-1">
                          <RoleBadges isAdmin={isAdmin} isManager={isManager} isEditor={!!account?.is_editor} isContributor={isContributor} />
                        </div>
                      </div>
                    </div>

                    <div className="w-px self-stretch bg-[var(--border)] shrink-0" />

                    <div className="flex items-center gap-1.5 text-text-muted shrink-0">
                      <Trophy size={13} />
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest">
                          {myEntry ? `Rank #${myEntry.rank}` : 'Unranked'}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                          {myEntry ? `${myEntry.approved_count} approved` : '0 approved'} · {!loadingProposals ? `${proposals.length} proposal${proposals.length !== 1 ? 's' : ''} total` : '…'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Tile>
            </div>

            <div className="md:flex-1">
              <Tile title="Quick actions" span="h-full">
                <div className="flex items-center gap-2">
                  {(account?.is_editor || account?.is_administrator) && (
                    <button
                      onClick={() => setShowAddSong(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                    >
                      <Plus size={12} /> New song
                    </button>
                  )}
                  {(account?.is_editor || account?.is_administrator) && (
                    <button
                      onClick={() => go('albums-admin')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-raised hover:bg-surface-highest text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors"
                    >
                      Edit albums
                    </button>
                  )}
                </div>
              </Tile>
            </div>
          </div>

          {/* Bottom row: My Proposals (left, fixed width) and the medium
              tile grid (right, fills the rest), each filling the remaining
              height. */}
          <div className="flex flex-col md:flex-row gap-3 md:gap-4 flex-1 md:min-h-0">
          <div className="flex flex-col gap-3 md:gap-4 md:w-[42%] md:min-h-0">
            <Tile
              title={isContributor ? undefined : 'My Proposals'}
              icon={isContributor ? undefined : <FileEdit size={13} />}
              span="flex-1 min-h-[22rem] md:min-h-0"
            >
              {/* Contributors get a toggle here instead of Tile's fixed
                  title, since this tile now covers both song-edit proposals
                  and comp-file proposals - two separate queues that used to
                  be two separate tiles. */}
              {isContributor && (
                <div className="flex items-center gap-1 mb-3 shrink-0">
                  <button
                    onClick={() => setProposalsView('songs')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                      proposalsView === 'songs' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <FileEdit size={13} /> Proposals
                  </button>
                  <button
                    onClick={() => setProposalsView('comp')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors ${
                      proposalsView === 'comp' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <FolderOpen size={13} /> Comp files
                  </button>
                </div>
              )}

              {proposalsView === 'songs' || !isContributor ? (
                <>
                  <div className="mb-3 shrink-0">
                    <div className="relative mb-2">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search proposals…"
                        className="w-full bg-surface-overlay text-text-primary text-sm pl-7 pr-7 py-2 rounded-lg outline-none border border-transparent focus:ring-1 ring-accent focus:border-accent/40 placeholder:text-text-muted"
                      />
                      {search && (
                        <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {FILTER_TABS.map(({ key, label }) => {
                        const count = tabCount(key)
                        const active = filter === key
                        return (
                          <button
                            key={key}
                            onClick={() => setFilter(key)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
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
                          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors shrink-0"
                          title="Propose a new song"
                        >
                          <Plus size={12} /> New song
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
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
                            variant="desktop"
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
                  <div className="mb-3 shrink-0">
                    <div className="relative mb-2">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        type="text"
                        value={compSearch}
                        onChange={(e) => setCompSearch(e.target.value)}
                        placeholder="Search comp files…"
                        className="w-full bg-surface-overlay text-text-primary text-sm pl-7 pr-7 py-2 rounded-lg outline-none border border-transparent focus:ring-1 ring-accent focus:border-accent/40 placeholder:text-text-muted"
                      />
                      {compSearch && (
                        <button onClick={() => setCompSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CompFilterBar
                        filter={compFilter}
                        setFilter={setCompFilter}
                        counts={{ all: compTabCount('all'), pending: compTabCount('pending'), approved: compTabCount('approved'), rejected: compTabCount('rejected') }}
                        size="md"
                      />
                      <button
                        onClick={() => go('contributor')}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors shrink-0"
                        title="Propose a comp file change"
                      >
                        <Plus size={12} /> New comp proposal
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                    <CompProposalList
                      proposals={filteredCompProposals}
                      loading={loadingComp}
                      onSelect={() => go('contributor')}
                      onWithdraw={handleWithdrawComp}
                      withdrawingId={withdrawingCompId}
                      empty={compSearch.trim() ? `No comp files match "${compSearch.trim()}"` : undefined}
                    />
                  </div>
                </>
              )}
            </Tile>
          </div>

          {/* Right column: a plain (non-spanning, so safely auto-placed)
              2-col grid of whichever medium tiles apply. */}
          <div className="flex flex-col gap-3 md:gap-4 md:flex-1 md:min-h-0">
            <div className="grid grid-cols-2 gap-3 md:gap-4 md:flex-1 md:min-h-0 auto-rows-[minmax(16rem,1fr)] md:auto-rows-[minmax(0,1fr)]">
              <Tile title="Leaderboard" icon={<Trophy size={13} />}>
                <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                  {loadingLeaderboard ? (
                    <div className="flex justify-center py-12">
                      <Loader2 size={18} className="animate-spin text-text-muted" />
                    </div>
                  ) : leaderboard.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted opacity-50">
                      <Trophy size={28} />
                      <p className="text-sm">No data</p>
                    </div>
                  ) : (
                    <LeaderboardRows entries={leaderboard} myUsername={account?.discord_username} />
                  )}
                </div>
              </Tile>

              {canReviewReports && (
                <Tile title="Reports" icon={<Flag size={13} />}>
                  <div className="flex-1 relative min-h-0">
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
                      compact
                    />
                  </div>
                </Tile>
              )}

              {canReviewStaff && (
                // Spans the full width of this 2-col grid (was one cell) -
                // the clickable stat rows need more room than a single
                // generic "open the panel" tile did.
                <Tile title={isAdmin ? 'Admin' : 'Manager'} icon={<ShieldCheck size={13} />} span="col-span-2">
                  <div className="flex-1 flex flex-col gap-3 text-text-muted">
                    {/* Managers only ever reach Song edits + Comp files, so
                        they get those two counts, same as before. Admins
                        get one box per queue their nav actually opens into,
                        plus Channels (free - already in the store) and a
                        Total pending rollup in place of a meaningless
                        "Stats" count. */}
                    <div className={`grid gap-2 ${isAdmin ? 'grid-cols-4' : 'grid-cols-2'}`}>
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

                    {/* Every section already opens from the stat box above
                        it - no leftover "Stats" button, so the old Stats
                        tab's own metrics (previously hidden behind that
                        button) get laid out right here instead, in the
                        space that freed up. */}
                    {isAdmin && (
                      <div className="grid grid-cols-4 gap-2">
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
          </div>

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
