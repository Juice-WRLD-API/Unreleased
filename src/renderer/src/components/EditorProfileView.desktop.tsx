import { useRef } from 'react'
import {
  Loader2, Trophy, FileEdit, ChevronLeft, RefreshCw, Plus, X, Search, Flag, ShieldCheck, FolderOpen,
  Pencil, Check,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { accountDisplayName, initial } from '../lib/format'
import ReportsTab from './ReportsTab'
import CompProposalList, { CompFilterBar } from './CompProposalList'
import RoleBadges from './RoleBadges'
import { Tile } from './Tile'
import ProposalListItem from './ProposalListItem'
import AddSongModal from './AddSongModal.desktop'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useEditorProfileView, PROPOSAL_FILTER_TABS } from '../hooks/useEditorProfileView'
import { RANK_STYLES } from '../lib/proposalSearch'

// Bento tile grid - replaces the v1 header+tabs+single-panel layout (see
// "Visual Redesign v2 - Bento Dashboard Pivot" in the rewrite plan). Reuses
// the app's own Tile primitive (originally HomeView.desktop.tsx's bento
// rework) so this page is visually unmistakable from the old tab-bar shape
// while staying consistent with where the rest of the app is heading.
// Everything below is height-bound (h-full inside App's fixed-height
// <main>), not page-scrolling - individual tiles scroll internally.
//
// All data/state lives in useEditorProfileView (shared with the mobile
// variant) - this file is just the desktop bento layout on top of it.

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
    loadingComp, compFilter, setCompFilter, withdrawingCompId, handleWithdrawComp,
    compTabCount, filteredCompProposals,
    reports, reportStatus, setReportStatus, loadingReports,
    adminPreview, otpLocked, handleEdit,
  } = useEditorProfileView()
  const go = setActiveView

  const avatarInputRef = useRef<HTMLInputElement>(null)

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
                      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAvatarFile(f); e.target.value = '' }} />
                      <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="relative w-12 h-12 shrink-0 rounded-full group">
                        {account?.avatar ? (
                          <img src={account.avatar} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-[var(--border)]" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">
                            {initial(accountDisplayName(account))}
                          </div>
                        )}
                        <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center ring-2 ring-surface opacity-0 group-hover:opacity-100 transition-opacity">
                          {avatarUploading ? <Loader2 size={10} className="animate-spin" /> : <Pencil size={10} />}
                        </span>
                      </button>
                      <div className="min-w-0">
                        {avatarError && <p className="text-[10px] text-red-400 mb-0.5">{avatarError}</p>}
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
                              className="min-w-0 w-36 bg-[var(--surface-raised)] border border-[var(--border)] rounded-md px-1.5 py-0.5 text-text-primary text-sm font-bold focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <button
                              onClick={saveDisplayName}
                              disabled={savingName}
                              className="p-1 rounded text-accent hover:bg-accent/15 transition-colors disabled:opacity-40"
                              title="Save"
                            >
                              {savingName ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            </button>
                            <button
                              onClick={cancelEditName}
                              disabled={savingName}
                              className="p-1 rounded text-text-muted hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-40"
                              title="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <h1 className="text-text-primary text-base font-bold truncate flex items-center gap-1.5 group">
                            {accountDisplayName(account, 'My Profile')}
                            <button
                              onClick={startEditName}
                              className="p-0.5 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors shrink-0"
                              title="Edit display name"
                            >
                              <Pencil size={11} />
                            </button>
                          </h1>
                        )}
                        {nameError && <p className="text-[10px] text-red-400 mt-0.5">{nameError}</p>}
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
                  {account?.is_administrator && (
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
                      {PROPOSAL_FILTER_TABS.map(({ key, label }) => {
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
                  <div className="flex-1 flex gap-4 text-text-muted">
                    {/* Split into two side-by-side groups so the tile reads
                        as "queues to open" vs "numbers to glance at" instead
                        of one undifferentiated wall of boxes. Managers only
                        ever reach Song edits + Comp files (both open a
                        queue), so they never see a Stats group at all and
                        Queues just takes the full width on its own. Admins
                        without 2FA only see the Security box (highlighted)
                        so they can find and turn it on - every other
                        number/button here is an account-wide admin surface
                        and stays gated until then. */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-1.5">Queues</p>
                      <div className="grid grid-cols-2 gap-2">
                        {!otpLocked && (
                          <>
                            <AdminStatBox label="Song edits" value={adminPreview?.pendingProposals} highlight={!!adminPreview?.pendingProposals} onClick={() => openAdmin('proposals')} />
                            <AdminStatBox label="Comp files" value={adminPreview?.pendingComp} highlight={!!adminPreview?.pendingComp} onClick={() => openAdmin('comp-proposals')} />
                          </>
                        )}
                        {isAdmin && !otpLocked && (
                          <>
                            <AdminStatBox label="Applications" value={adminPreview?.pendingApplications} highlight={!!adminPreview?.pendingApplications} onClick={() => openAdmin('applications')} />
                            <AdminStatBox label="Reports" value={adminPreview?.pendingReports} highlight={!!adminPreview?.pendingReports} onClick={() => openAdmin('reports')} />
                            <AdminStatBox label="Users" value={adminPreview?.totalUsers} onClick={() => openAdmin('users')} />
                            <AdminStatBox label="Channels" value={adminPreview?.totalChannels} onClick={() => openAdmin('channels')} />
                            <AdminStatBox label="Eras" value={adminPreview?.totalEras} onClick={() => openAdmin('eras')} />
                            <AdminStatBox label="CDN nodes" value={adminPreview?.pendingCdnNodes} highlight={!!adminPreview?.pendingCdnNodes} onClick={() => openAdmin('cdn-nodes')} />
                          </>
                        )}
                        {isAdmin && (
                          <AdminStatBox
                            label="Security"
                            value={adminPreview ? (adminPreview.otpEnabled ? 'ON' : 'OFF') : undefined}
                            highlight={adminPreview?.otpEnabled === false}
                            onClick={() => openAdmin('security')}
                          />
                        )}
                      </div>
                      {otpLocked && (
                        <p className="text-[10px] text-text-muted mt-1.5">Enable 2FA to unlock the rest of the admin tile.</p>
                      )}
                    </div>

                    {/* Every queue already opens from the button to its left
                        - no leftover "Stats" button, so the old Stats tab's
                        own metrics (previously hidden behind that button),
                        plus the Total pending rollup, land here instead as
                        plain non-clickable numbers. */}
                    {isAdmin && !otpLocked && (
                      <div className="flex-1 min-w-0 pl-4 border-l border-[var(--border)]">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-1.5">Stats</p>
                        <div className="grid grid-cols-2 gap-2">
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
