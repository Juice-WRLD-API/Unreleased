import { useRef, useState } from 'react'
import {
  Loader2, Trophy, FileEdit, RefreshCw, Plus, X, Search, Flag, ShieldCheck, FolderOpen,
  Pencil, Check,
} from 'lucide-react'
import { accountDisplayName, initial } from '../lib/format'
import ReportsTab from './ReportsTab.mobile'
import AdminPage from './AdminPage.mobile'
import type { AdminTab } from '../hooks/useAdminQueue'
import CompProposalList, { CompFilterBar } from './CompProposalList'
import RoleBadges from './RoleBadges'
import { Tile } from './Tile'
import ProposalListItem from './ProposalListItem'
import AddSongModal from './AddSongModal.mobile'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useEditorProfileView, PROPOSAL_FILTER_TABS } from '../hooks/useEditorProfileView'
import { RANK_STYLES } from '../lib/proposalSearch'

// Bento tile grid, mobile variant - same tile set/logic as
// EditorProfileView.desktop.tsx (both share useEditorProfileView), but a
// simple responsive `grid grid-cols-2` stack instead of desktop's
// height-filling bento (mobile Home has no equivalent multi-column pattern
// to match, per the rewrite plan). See "Visual Redesign v2 - Bento
// Dashboard Pivot" in the plan.

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
  const {
    account, setActiveView, activeChannel, channels, setActiveChannel,
    editingName, nameInput, setNameInput, savingName, nameError, startEditName, saveDisplayName, cancelEditName,
    avatarUploading, avatarError, handleAvatarFile,
    refreshKey, setRefreshKey, showAddSong, setShowAddSong, openAdmin,
    proposalsView, setProposalsView, expandedProposalId, setExpandedProposalId, compSearch, setCompSearch,
    isContributor, isAdmin, isManager, canReviewReports, canReviewStaff,
    loadingProposals, refreshing, filter, setFilter, search, setSearch, deletingId, resubmittingId,
    filteredProposals, handleDelete, handleResubmit, tabCount, proposals,
    leaderboard, loadingLeaderboard, myEntry,
    compProposals, loadingComp, compFilter, setCompFilter,
    compTabCount, filteredCompProposals,
    reports, reportStatus, setReportStatus, loadingReports,
    adminPreview, otpLocked, handleEdit,
  } = useEditorProfileView()

  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Managers only get the Admin tile (renamed "Manager" for them) - they have
  // no song-edit or report-review power, so they land in its focused view
  // directly rather than on a dashboard grid that's mostly empty for them.
  const managerOnly = isManager && !isAdmin
  // Managers with nothing else to see land straight in the embedded admin
  // panel (see the comment above) - that's the only reason this page still
  // has an embedded AdminPage at all. Everyone else's tile clicks now leave
  // the page entirely (see openAdmin), so 'admin' mode is otherwise
  // unreachable - a click used to just expand an embedded panel in place,
  // which read as a cramped "tile" for a wide layout like the Users
  // master/detail view.
  const [mode, setMode] = useState<ViewMode>(managerOnly ? 'admin' : 'grid')
  const exitAdmin = (): void => setMode('grid')
  const openAdminTab = (tab: AdminTab): void => openAdmin(tab)

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
                  {initial(accountDisplayName(account))}
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
                      if (e.key === 'Escape') cancelEditName()
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
                    onClick={cancelEditName}
                    disabled={savingName}
                    className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-text-muted active:bg-surface-overlay transition-colors disabled:opacity-40"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <h1 className="text-text-primary text-[17px] font-bold leading-tight truncate flex items-center gap-1.5">
                  {accountDisplayName(account, 'My Profile')}
                  <button
                    onClick={startEditName}
                    className="p-0.5 rounded text-text-muted active:bg-surface-overlay transition-colors shrink-0"
                    title="Edit display name"
                  >
                    <Pencil size={12} />
                  </button>
                </h1>
              )}
              {avatarError && <p className="text-[10px] text-red-400">{avatarError}</p>}
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
              {account?.is_administrator && (
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
                    {PROPOSAL_FILTER_TABS.map(({ key, label }) => {
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
              <div className="flex gap-3 py-1 text-text-muted">
                {/* Split into two side-by-side groups so the tile reads as
                    "queues to open" vs "numbers to glance at" instead of one
                    undifferentiated wall of boxes. Managers only ever reach
                    Comp files (opens a queue), so they never see a Stats
                    group at all and Queues just takes the full width on its
                    own. Admins get one button per queue their nav actually
                    opens into, plus Channels and Eras (free). Admins without
                    2FA only see the Security box (highlighted) so they can
                    find and turn it on - every other number/button here is
                    an account-wide admin surface and stays gated until then. */}
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-1.5">Queues</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {!otpLocked && (
                      <>
                        <AdminStatBox label="Song edits" value={adminPreview?.pendingProposals} highlight={!!adminPreview?.pendingProposals} onClick={() => openAdminTab('proposals')} />
                        <AdminStatBox label="Comp files" value={adminPreview?.pendingComp} highlight={!!adminPreview?.pendingComp} onClick={() => openAdminTab('comp-proposals')} />
                      </>
                    )}
                    {isAdmin && !otpLocked && (
                      <>
                        <AdminStatBox label="Applications" value={adminPreview?.pendingApplications} highlight={!!adminPreview?.pendingApplications} onClick={() => openAdminTab('applications')} />
                        <AdminStatBox label="Reports" value={adminPreview?.pendingReports} highlight={!!adminPreview?.pendingReports} onClick={() => openAdminTab('reports')} />
                        <AdminStatBox label="Users" value={adminPreview?.totalUsers} onClick={() => openAdminTab('users')} />
                        <AdminStatBox label="Channels" value={adminPreview?.totalChannels} onClick={() => openAdminTab('channels')} />
                        <AdminStatBox label="Eras" value={adminPreview?.totalEras} onClick={() => openAdminTab('eras')} />
                        <AdminStatBox label="CDN nodes" value={adminPreview?.pendingCdnNodes} highlight={!!adminPreview?.pendingCdnNodes} onClick={() => openAdminTab('cdn-nodes')} />
                      </>
                    )}
                    {isAdmin && (
                      <AdminStatBox
                        label="Security"
                        value={adminPreview ? (adminPreview.otpEnabled ? 'ON' : 'OFF') : undefined}
                        highlight={adminPreview?.otpEnabled === false}
                        onClick={() => openAdminTab('security')}
                      />
                    )}
                  </div>
                  {otpLocked && (
                    <p className="text-[10px] text-text-muted mt-1.5">Enable 2FA to unlock the rest of the admin tile.</p>
                  )}
                </div>

                {/* Every queue already opens from the button to its left -
                    no leftover "Stats" button, so the old Stats tab's own
                    metrics (previously hidden behind that button), plus the
                    Total pending rollup, land here instead as plain
                    non-clickable numbers. */}
                {isAdmin && !otpLocked && (
                  <div className="flex-1 min-w-0 pl-3 border-l border-[var(--border)]">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-1.5">Stats</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <AdminStatBox label="Total pending" value={adminPreview?.totalPending} highlight={!!adminPreview?.totalPending} />
                      <AdminStatBox label="Total proposals" value={adminPreview?.totalProposals} />
                      <AdminStatBox label="Approved" value={adminPreview?.approvedProposals} highlight={!!adminPreview?.approvedProposals} />
                      <AdminStatBox label="Approval rate" value={adminPreview?.approvalPct != null ? `${adminPreview.approvalPct}%` : undefined} />
                      <AdminStatBox label="Editors" value={adminPreview?.editors} />
                      <AdminStatBox label="Managers" value={adminPreview?.managers} />
                      <AdminStatBox label="Applicants" value={adminPreview?.applicants} />
                    </div>
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
