import { useState } from 'react'
import { RefreshCw, ChevronLeft, Plus, FolderOpen, User, Trophy } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import RoleBadges from './RoleBadges'
import { Tile } from './Tile'
import { useStaffRoles } from '../hooks/useStaffRoles'
import { useMyCompProposals } from '../hooks/useMyCompProposals'
import CompProposalList, { CompFilterBar, filterCompProposals } from './CompProposalList'

// A contributor-only account's home. Reviewing other people's proposals is
// deliberately NOT here - that queue lives in exactly one place, the Admin
// page's "Comp files" tab, reachable from the editor profile.

// Bento tile grid - mirrors the tile treatment EditorProfileView.desktop/
// .mobile.tsx use (see "Visual Redesign v2 - Bento Dashboard Pivot" in the
// rewrite plan), but this page stays a single file (no .desktop/.mobile
// split, per the plan's explicit decision - it's the smallest surface and
// doesn't need two layouts). The grid below is a simple responsive
// `grid-cols-2` stack that escalates to 4 columns at `sm`, closer to
// EditorProfileView.mobile.tsx's approach than the desktop file's
// height-filling bento - there just isn't enough content here to justify a
// dedicated per-platform layout.
export default function ContributorProfileView(): JSX.Element {
  const { account, setActiveView, activeChannel, channels } = useStorePick('account', 'setActiveView', 'activeChannel', 'channels')
  const go = setActiveView
  const [refreshKey, setRefreshKey] = useState(0)

  const { isContributor, isAdmin, isManager, isEditor } = useStaffRoles(account, activeChannel, channels)

  const {
    compProposals: proposals, loading, filter, setFilter, withdrawingId, handleWithdraw: withdraw,
  } = useMyCompProposals(isContributor, activeChannel, refreshKey, () => setRefreshKey(k => k + 1))

  const filtered = filterCompProposals(proposals, filter)
  const approvedCount = proposals.filter(p => p.status === 'approved').length

  if (!account) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center h-full text-text-muted text-sm">Sign in to view your contributor profile.</div>
    )
  }

  if (!isContributor) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <p className="text-sm text-text-muted">You are not a contributor yet.</p>
        <button onClick={() => go('contributor')} className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold">Apply or submit</button>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 sm:px-5 py-3 flex items-center gap-2">
        <button onClick={() => go('api-tracker')} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors md:hidden">
          <ChevronLeft size={18} />
        </button>
        <h1 className="flex-1 min-w-0 text-base font-bold text-text-primary truncate">Contributor profile</h1>
        <button onClick={() => setRefreshKey(k => k + 1)} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 pb-4 sm:pb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

          {/* Identity */}
          <Tile span="col-span-2 sm:col-span-2">
            <div className="flex items-center gap-3">
              {account.discord_avatar ? (
                <img src={account.discord_avatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-[var(--border)]" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold shrink-0">
                  {(account.display_name || account.discord_username || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-text-primary text-base font-bold truncate">
                  {account.display_name || account.discord_username}
                </h2>
                <div className="mt-1">
                  <RoleBadges isAdmin={isAdmin} isManager={isManager} isEditor={isEditor} isContributor={isContributor} />
                </div>
              </div>
            </div>
          </Tile>

          {/* Stats */}
          <Tile title="Stats" icon={<Trophy size={13} />} span="col-span-2 sm:col-span-2">
            <div className="flex-1 flex flex-col justify-center gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                {approvedCount} approved
              </p>
            </div>
          </Tile>

          {/* Quick actions */}
          <Tile title="Quick actions" icon={<User size={13} />} span="col-span-2 sm:col-span-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => go('contributor')} className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors">
                <Plus size={12} /> New comp proposal
              </button>
              <button onClick={() => go('api-files')} className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-raised hover:bg-surface-highest text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors">
                <FolderOpen size={12} /> Browse comp files
              </button>
              {(isEditor || isManager) && (
                <button onClick={() => go('editor-profile')} className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-raised hover:bg-surface-highest text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors">
                  {isEditor ? 'Editor profile' : 'Manager profile'}
                </button>
              )}
            </div>
          </Tile>

          {/* Comp Files - large */}
          <Tile title="Comp Files" icon={<FolderOpen size={13} />} span="col-span-2 sm:col-span-4">
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <CompFilterBar filter={filter} setFilter={setFilter} />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <CompProposalList
                proposals={filtered}
                loading={loading}
                onSelect={() => go('contributor')}
                onWithdraw={withdraw}
                withdrawingId={withdrawingId}
              />
            </div>
          </Tile>

        </div>
      </div>
    </div>
  )
}
