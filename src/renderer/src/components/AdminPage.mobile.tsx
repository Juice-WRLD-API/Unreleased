import { useState, memo, useEffect } from 'react'
import {
  ChevronLeft, Users, Clock, CheckCircle, XCircle, ShieldCheck, BarChart2,
  Loader2, RefreshCw, FileEdit, KeyRound, Check, AlertCircle, RotateCcw,
  ChevronDown, ChevronUp, Shield, MessageSquare, Calendar,
  Hash, Plus, UserCheck, FileCheck, Activity, Pencil, X as XIcon, ChevronDown as ChevronDownIcon,
  Play, History,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { displayName } from '../store/chatStore'
import { discordHandle } from '../lib/format'
import * as userApi from '../lib/userApi'
import type { EditorApplication, SongEditProposal, AdminUser, ProposalStatus } from '../lib/userApi'
import { apiFetch, songToTrack } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import {
  relativeTime, shortDate, STATUS_STYLE, StatusChip, Avatar, Empty, AppSection,
  QueueSearch, ProposalDiff,
} from './adminShared'
import ReportsTab from './ReportsTab.mobile'
import CompProposalsTab from './CompProposalsTab.mobile'
import ChannelsTab from './ChannelsTab.mobile'
import EraTab from './EraTab.mobile'
import { useBackToClose } from '../hooks/useBackToClose'
import { useStaffRoles } from '../hooks/useStaffRoles'
import { useAdminQueue, type AdminTab } from '../hooks/useAdminQueue'
import { useOtpGate } from '../hooks/useOtpGate'
import { useVisitedTabs } from '../hooks/useVisitedTabs'
import { useReviseProposalForm } from '../hooks/useReviseProposalForm'
import { useProposalsTabData } from '../hooks/useProposalsTabData'
import { useAdminUsersList } from '../hooks/useAdminUsersList'
import { useAdminStats } from '../hooks/useAdminStats'
import { TEXTAREA_FIELDS, ALL_SONG_FIELDS, PROPOSAL_FILTERS, PROPOSAL_SORTS, PROPOSAL_PAGE } from '../lib/proposalRevise'
import RoleBadges from './RoleBadges'

type Tab = AdminTab

// ── Main Page ─────────────────────────────────────────────────────────────────

// `embedded` renders the page as a panel inside another view (the editor
// profile's Admin tab) - no back button, page title, or window-control
// clearance, since the host view owns that chrome.
export default function AdminPage({ embedded = false, initialTab, onExit }: {
  embedded?: boolean
  /** Which section to show - used by EditorProfileView's managerOnly landing
   *  (the only remaining embedded caller). Standalone falls back to the
   *  URL-derived tab below instead. */
  initialTab?: AdminTab
  /** Embedded-only: lets the host (EditorProfileView) close this panel and
   *  return to its own page. */
  onExit?: () => void
}): JSX.Element {
  const { account, setActiveView, setActiveAdminTab, loadAccount, activeChannel, channels, activeAdminTab } = useStorePick('account', 'setActiveView', 'setActiveAdminTab', 'loadAccount', 'activeChannel', 'channels', 'activeAdminTab')
  // Falls back to the standalone console's own deep link (see
  // ADMIN_TAB_PATHS) when nobody passed an explicit initialTab - only
  // relevant when not embedded, since the embedded panel has no URL of its
  // own and always arrives with an explicit initialTab from its host
  // (e.g. EditorProfileView's Admin tile) instead.
  const effectiveInitialTab = initialTab ?? (embedded ? undefined : activeAdminTab ?? undefined)
  // The header's rightmost controls (refresh + tabs) sit at the same corner
  // as the custom frameless-window buttons (see WindowControls in App.tsx,
  // fixed top-right). Without extra clearance they render underneath them -
  // is_manager grants no admin power beyond reviewing comp-file proposals -
  // everything else on this page (song edits, applications, users, stats,
  // security) stays isAdmin-only. managerOnly narrows the page down to just
  // that one tab instead of the full admin console. Scoped to the active
  // channel, not "any channel" - see useChannelRoles.
  const { isAdmin, isManager, canReviewStaff } = useStaffRoles(account, activeChannel, channels)
  const managerOnly  = isManager && !isAdmin
  const otpEnabled = !!account?.otp_enabled

  const {
    tab, setTab,
    loading, error,
    applications, setApplications,
    propStatus, setPropStatus,
    proposals, setProposals,
    users, setUsers,
    reportStatus, setReportStatus,
    reports, setReports,
    refresh,
    nav,
  } = useAdminQueue({
    canLoad: isAdmin,
    isFullAdmin: isAdmin,
    gateNonProposalTabs: false,
    activeChannel,
    initialTab: effectiveInitialTab ?? (managerOnly ? 'comp-proposals' : 'proposals'),
    // account can still be loading when this page first mounts (deep link,
    // page refresh) - managerOnly flips from false to true once it lands,
    // and the tab set at mount time (still 'proposals') would otherwise
    // strand a manager on a tab their nav bar no longer offers a button for.
    forceTab: { when: managerOnly, tab: 'comp-proposals' },
    managerNavIds: ['comp-proposals'],
  })

  // No more overview grid - every section already has its own deep link
  // (see ADMIN_TAB_PATHS) and its own entry point on the profile page's
  // Admin tile, so a second, in-page "pick a section" screen was a
  // redundant extra hop rather than a real navigation aid. AdminPage now
  // just shows whichever single section it was asked for, directly, but
  // still offers a compact in-page tab row to move between sections
  // without leaving the page.
  const activeNavItem = nav.find(n => n.id === tab)
  const switchTab = (t: AdminTab): void => {
    setTab(t)
    if (!embedded) setActiveAdminTab(t)
  }

  // Each tab's content, once mounted, stays mounted (just hidden) instead of
  // being torn down and rebuilt every time you switch away and back - an
  // unmount/remount was re-triggering every <img> in the tab (avatars, song
  // art) on every single switch, which for a list of any size fired hundreds
  // of redundant image requests for data that hadn't changed.
  const visited = useVisitedTabs(tab)

  if (!canReviewStaff) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
      <Shield size={28} className="text-text-muted" />
      <p className="text-text-primary font-semibold text-sm">Admins only</p>
      <button onClick={() => setActiveView('api-tracker')} className="text-xs text-accent active:underline">Go back</button>
    </div>
  )

  if (!otpEnabled) return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <OtpSetupPanel onEnabled={async () => { await loadAccount() }} />
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`shrink-0 ${embedded ? 'px-3 pt-1' : 'px-2 pt-1'}`}>
        <div className="flex items-center gap-1">
          {embedded && onExit ? (
            <button onClick={onExit}
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
              <ChevronLeft size={20} />
            </button>
          ) : !embedded ? (
            <button onClick={() => setActiveView('api-tracker')}
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
              <ChevronLeft size={20} />
            </button>
          ) : null}
          <div className="flex-1 min-w-0 pl-1.5">
            <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">{activeNavItem?.label ?? (managerOnly ? 'Manager' : 'Admin')}</h1>
            {!embedded && account?.discord_username && <p className="text-text-muted text-xs truncate">{account.discord_username}</p>}
          </div>
        </div>
      </div>

      {nav.length > 1 && (
        <div className="shrink-0 flex items-center gap-1 overflow-x-auto px-2 pb-1.5 scrollbar-none">
          {nav.map(item => (
            <button key={item.id} onClick={() => switchTab(item.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                tab === item.id ? 'bg-accent/15 text-accent' : 'text-text-muted active:bg-surface-overlay'
              }`}>
              {item.label}
              {!!item.badge && (
                <span className="text-[9px] font-bold px-1 min-w-[14px] text-center rounded-full bg-accent/20 text-accent">{item.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* A tab's data loads once per visit (see the sig comment in
          useAdminQueue) rather than refetching every time it's reselected -
          this is the explicit way back to fresh data instead. */}
      {tab !== 'comp-proposals' && tab !== 'channels' && tab !== 'eras' && tab !== 'security' && (
        <div className="shrink-0 flex items-center justify-end px-3 pb-1.5">
          <button onClick={() => refresh()} disabled={loading} title="Refresh"
            className="flex items-center gap-1.5 text-xs font-semibold text-accent active:text-accent/80 transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {error && (
        <div className="mx-3 mb-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* The tab body stays mounted through a reload (switching the reports/
          proposals status filter, hitting refresh, etc.) instead of being
          replaced by a spinner - that was unmounting things like the status
          filter chips and each tab's local state (selection, draft notes,
          cached song lookups) on every refetch. A translucent overlay signals
          the load without tearing the UI down. */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]/60 backdrop-blur-[1px]">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        )}
        {visited.has('proposals') && (
          <div className={tab === 'proposals' ? 'h-full' : 'hidden'}>
            <ProposalsTab proposals={proposals} status={propStatus} setStatus={setPropStatus} onChanged={() => refresh()} channel={activeChannel} />
          </div>
        )}
        {visited.has('comp-proposals') && (
          <div className={tab === 'comp-proposals' ? 'h-full' : 'hidden'}>
            <CompProposalsTab embedded onChanged={() => refresh()} />
          </div>
        )}
        {visited.has('applications') && (
          <div className={tab === 'applications' ? 'h-full' : 'hidden'}>
            <ApplicationsTab applications={applications} onChanged={() => refresh()} />
          </div>
        )}
        {visited.has('reports') && (
          <div className={tab === 'reports' ? 'h-full' : 'hidden'}>
            <ReportsTab reports={reports} status={reportStatus} setStatus={setReportStatus} onChanged={() => refresh()} />
          </div>
        )}
        {visited.has('users') && (
          <div className={tab === 'users' ? 'h-full' : 'hidden'}>
            <UsersTab users={users} onChanged={() => refresh()} currentUserId={account?.id} />
          </div>
        )}
        {visited.has('stats') && (
          <div className={tab === 'stats' ? 'h-full' : 'hidden'}>
            <StatsTab applications={applications} proposals={proposals} users={users} />
          </div>
        )}
        {visited.has('channels') && (
          <div className={tab === 'channels' ? 'h-full' : 'hidden'}>
            <ChannelsTab />
          </div>
        )}
        {visited.has('eras') && (
          <div className={tab === 'eras' ? 'h-full' : 'hidden'}>
            <EraTab />
          </div>
        )}
        {visited.has('security') && (
          <div className={tab === 'security' ? 'h-full' : 'hidden'}>
            <SecurityTab />
          </div>
        )}
      </div>
    </div>
  )
}


// ── Revise Panel ──────────────────────────────────────────────────────────────

function RevisePanel({ proposal, onClose, onDone, channel }: {
  proposal: SongEditProposal
  onClose: () => void
  onDone:  () => void
  channel?: string
}): JSX.Element {
  const {
    fields, reviewNote, setReviewNote, addKey, setAddKey, saving, err,
    snap, available, addField, removeField, setFieldValue, submit,
  } = useReviseProposalForm(proposal, channel, onDone)

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Panel header */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={onClose} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <Pencil size={14} className="text-accent shrink-0" />
        <span className="text-text-primary text-[15px] font-bold flex-1 min-w-0 truncate">Revise proposal</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Field editors */}
        {Object.entries(fields).map(([key, val]) => (
          <div key={key} className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
              <span className="font-mono text-[10px] text-text-muted flex-1">{key.replace(/_/g, ' ')}</span>
              <button onClick={() => removeField(key)} className="text-[10px] text-red-400 active:text-red-300 transition-colors">
                remove
              </button>
            </div>
            {TEXTAREA_FIELDS.has(key) ? (
              <textarea
                value={val}
                onChange={e => setFieldValue(key, e.target.value)}
                rows={key === 'lyrics' || key === 'synced_lyrics' ? 10 : 4}
                className="w-full bg-[var(--surface)] text-text-primary text-xs font-mono px-3 py-2.5 resize-none focus:outline-none focus:bg-[var(--surface-raised)] transition-colors"
              />
            ) : (
              <input
                type="text"
                value={val}
                onChange={e => setFieldValue(key, e.target.value)}
                className="w-full bg-[var(--surface)] text-text-primary text-xs px-3 py-2.5 focus:outline-none focus:bg-[var(--surface-raised)] transition-colors"
              />
            )}
          </div>
        ))}

        {/* Add field */}
        <div className="rounded-xl border border-dashed border-[var(--border)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
            <Plus size={11} className="text-text-muted" />
            <span className="text-[10px] text-text-muted font-semibold">Add field</span>
          </div>
          <div className="flex gap-2 p-2">
            <select
              value={addKey}
              onChange={e => setAddKey(e.target.value)}
              className="flex-1 bg-[var(--surface)] text-text-primary text-xs px-2 py-1.5 rounded-lg border border-[var(--border)] focus:outline-none focus:border-accent/40"
            >
              <option value="">Choose a field…</option>
              {available.map(k => (
                <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
              ))}
              {/* Also allow snapshot fields not in the predefined list */}
              {Object.keys(snap).filter(k => !ALL_SONG_FIELDS.includes(k) && !(k in fields)).map(k => (
                <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              onClick={() => addField(addKey)}
              disabled={!addKey}
              className="px-3 py-1.5 rounded-lg bg-accent/10 active:bg-accent/20 text-accent text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        {/* Review note */}
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
            <MessageSquare size={11} className="text-text-muted" />
            <span className="text-[10px] text-text-muted font-semibold">Review note (optional)</span>
          </div>
          <input
            type="text"
            value={reviewNote}
            onChange={e => setReviewNote(e.target.value)}
            placeholder="Explain what you changed…"
            className="w-full bg-[var(--surface)] text-text-primary text-xs px-3 py-2.5 focus:outline-none"
          />
        </div>

        {err && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs border border-red-500/20">
            <AlertCircle size={12} />{err}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-2 p-3 border-t border-[var(--border)]">
        <button onClick={onClose} className="h-11 px-4 rounded-xl text-sm text-text-muted active:bg-surface-overlay transition-colors">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || Object.keys(fields).length === 0}
          className="flex-1 h-11 rounded-xl bg-accent active:bg-accent/90 text-[var(--bg)] text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save revision
        </button>
      </div>
    </div>
  )
}

// ── Proposals (master-detail) ─────────────────────────────────────────────────

// Memoized because the list isn't windowed: with the status filter on "All"
// it holds the whole proposal archive, and without this every keystroke in
// the search box re-rendered every row that survived the filter. `onSelect`
// is setSelected straight from useState, so its identity is stable and the
// memo actually holds.
const ProposalRow = memo(function ProposalRow({ item, showUserHeader, onSelect }: {
  item: SongEditProposal
  showUserHeader: boolean
  onSelect: (p: SongEditProposal) => void
}): JSX.Element {
  const ss = STATUS_STYLE[item.status] ?? { border: 'border-l-transparent', text: 'text-text-muted', bg: '', dot: '' }
  return (
    <div>
      {showUserHeader && (
        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted bg-surface-overlay border-b border-[var(--border)] sticky top-0 z-[1]">
          {item.editor_username}
        </div>
      )}
      <button onClick={() => onSelect(item)}
        className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${ss.border} transition-colors active:bg-surface-raised`}>
        <div className="flex items-center gap-1.5 mb-1">
          <StatusChip status={item.status} />
          <span className="text-[10px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded font-medium">
            {item.change_type}
          </span>
          {item.song_public_id != null && (
            <span className="text-[10px] text-text-muted ml-auto flex items-center gap-0.5">
              <Hash size={9} />{item.song_public_id}
            </span>
          )}
        </div>
        <p className="text-sm font-semibold truncate leading-snug mb-0.5 text-text-primary">
          {item.title || `Proposal #${item.id}`}
        </p>
        <p className="text-xs text-text-muted truncate">
          {item.editor_username} · {relativeTime(item.created_at)}
        </p>
      </button>
    </div>
  )
})

function ProposalsTab({ proposals, status, setStatus, onChanged, channel }: {
  proposals: SongEditProposal[]
  status: ProposalStatus | ''
  setStatus: (s: ProposalStatus | '') => void
  onChanged: () => void
  channel?: string
}): JSX.Element {
  const [actionId,    setActionId]    = useState<number | null>(null)
  const [notes,       setNotes]       = useState<Record<number, string>>({})
  const [selected,    setSelected]    = useState<SongEditProposal | null>(null)
  const [revising,    setRevising]    = useState(false)
  const { playTrack } = useStorePick('playTrack')

  const {
    sortBy, setSortBy, query, setQuery, sortedProposals, pageOf, remaining, setShown,
    dropCache, setArchive, archive, archiveLoading, archiveError,
    historyOpen, setHistoryOpen, openHistory, expandedPast, setExpandedPast,
    history, pastCount, loadingSongId, setLoadingSongId, playError, setPlayError,
  } = useProposalsTabData(proposals, channel, selected)

  const doReview = async (id: number, action: 'approve' | 'reject') => {
    setActionId(id)
    try { await userApi.adminReviewProposal(id, { action, review_notes: notes[id] || '', channel }); dropCache(id); setArchive(null); onChanged(); setSelected(null) }
    catch {} finally { setActionId(null) }
  }

  const doReverse = async (id: number) => {
    if (!confirm('Reverse this approval?')) return
    setActionId(id)
    try { await userApi.adminReverseProposal(id, channel); dropCache(id); setArchive(null); onChanged(); setSelected(null) }
    catch {} finally { setActionId(null) }
  }

  // Plays the song a proposal targets, so a reviewer can hear what they're
  // approving without leaving the queue.
  const playProposalSong = async (songId: number): Promise<void> => {
    setPlayError(null)
    setLoadingSongId(songId)
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
      // An unsurfaced song is a real catalog entry with no file behind it -
      // the proposal is still reviewable, there's just nothing to play.
      if (!song.path) { setPlayError('No file on this song to play'); return }
      const track = songToTrack(song)
      playTrack(track, [track])
    } catch {
      setPlayError('Could not load this song')
    } finally {
      setLoadingSongId(null)
    }
  }

  const FILTERS = PROPOSAL_FILTERS
  const SORTS = PROPOSAL_SORTS

  const p = selected

  // A refetch replaces the rows wholesale, so a half-written revision no
  // longer lines up with what's on screen. Typing in the search box must not
  // trip this - that's why it keys off the raw list, not the filtered one.
  useEffect(() => { setRevising(false) }, [proposals])

  useBackToClose(() => (revising ? setRevising(false) : historyOpen ? setHistoryOpen(false) : setSelected(null)), p != null)

  if (p && revising) return (
    <RevisePanel
      proposal={p}
      onClose={() => setRevising(false)}
      onDone={() => { setRevising(false); setSelected(null); onChanged() }}
      channel={channel}
    />
  )

  if (p) return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={() => setSelected(null)}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 truncate text-text-primary text-[15px] font-bold">{p.title || `Proposal #${p.id}`}</h2>
        {/* Hearing the song is just as useful when auditing something already
            approved or reversed, so this isn't gated to pending. */}
        {p.song != null && (
          <button onClick={() => playProposalSong(p.song as number)} disabled={loadingSongId != null}
            aria-label="Play this song"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-text-secondary active:bg-surface-overlay transition-colors disabled:opacity-40">
            {loadingSongId === p.song ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          </button>
        )}
        <StatusChip status={p.status} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-muted bg-surface-overlay px-2 py-0.5 rounded font-medium">{p.change_type}</span>
            {p.song_public_id != null && (
              <span className="flex items-center gap-0.5 text-xs text-text-muted"><Hash size={10} />{p.song_public_id}</span>
            )}
            <span className="text-xs text-text-muted">by {p.editor_username}</span>
            <span className="flex items-center gap-1 text-xs text-text-muted"><Calendar size={10} />{shortDate(p.created_at)}</span>
            {p.reviewer_username && <span className="text-xs text-text-muted">reviewed by {p.reviewer_username}</span>}
            {p.edit_count > 0 && <span className="text-xs text-text-muted">{p.edit_count} edit{p.edit_count !== 1 ? 's' : ''}</span>}
            {p.song != null && (
              <button onClick={openHistory}
                className={`flex items-center gap-1 text-xs transition-colors ${historyOpen ? 'text-accent' : 'text-text-muted active:text-text-primary'}`}>
                <History size={10} />
                {/* The count is unknown until the archive loads, so the label
                    stays generic rather than promising a number it might have
                    to take back. */}
                {archive ? (pastCount === 0 ? 'no earlier proposals' : `${pastCount} earlier proposal${pastCount === 1 ? '' : 's'}`) : 'history'}
                {historyOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            )}
          </div>

          {playError && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
              <AlertCircle size={11} /> {playError}
            </p>
          )}

          {(p.editor_notes || p.review_notes) && (
            <div className="flex flex-col gap-2">
              {p.editor_notes && (
                <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)]">
                  <MessageSquare size={11} className="text-text-muted shrink-0 mt-0.5" />
                  {p.editor_notes}
                </div>
              )}
              {p.review_notes && (
                <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)]">
                  <Check size={11} className="text-text-muted shrink-0 mt-0.5" />
                  {p.review_notes}
                </div>
              )}
            </div>
          )}

          {p.status === 'pending' && (
            <input
              type="text"
              value={notes[p.id] || ''}
              onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))}
              placeholder="Add review note (optional)…"
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/40"
            />
          )}
        </div>

        {/* Song history - every proposal ever filed against this song, so a
            reviewer can see whether a field has been fought over before, or
            whether this editor is re-submitting something already rejected.
            Read-only: expanding a row shows its diff in place rather than
            moving the selection, which would fight the status filter (a
            rejected proposal isn't in a Pending list). */}
        {historyOpen && p.song != null && (
          <div className="border-y border-[var(--border)] bg-[var(--surface)]">
            {archiveLoading && (
              <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-text-muted" /></div>
            )}
            {archiveError && (
              <p className="flex items-center gap-1.5 px-4 py-3 text-[11px] text-amber-400">
                <AlertCircle size={11} /> Could not load this song&apos;s history
              </p>
            )}
            {archive && history.length <= 1 && (
              <p className="px-4 py-3 text-[11px] text-text-muted italic">
                No other proposals have been filed for this song.
              </p>
            )}
            {archive && history.length > 1 && history.map(row => {
              const isViewing = row.id === p.id
              const open = expandedPast === row.id
              return (
                <div key={row.id} className="border-b border-[var(--border)] last:border-b-0">
                  <button onClick={() => setExpandedPast(open ? null : row.id)}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${isViewing ? 'bg-accent/5' : 'active:bg-surface-raised'}`}>
                    <StatusChip status={row.status} />
                    <span className="text-[11px] text-text-primary truncate flex-1 min-w-0">
                      {row.title || `Proposal #${row.id}`}
                    </span>
                    {isViewing && <span className="text-[9px] text-accent font-semibold shrink-0">viewing</span>}
                    <span className="text-[10px] text-text-muted shrink-0">{shortDate(row.created_at)}</span>
                    {open ? <ChevronUp size={11} className="text-text-muted shrink-0" /> : <ChevronDown size={11} className="text-text-muted shrink-0" />}
                  </button>
                  {open && (
                    <div className="bg-[var(--surface-raised)] border-t border-[var(--border)]">
                      {row.review_notes && (
                        <p className="px-4 pt-3 text-[11px] text-text-muted italic">
                          {row.reviewer_username ? `${row.reviewer_username}: ` : ''}{row.review_notes}
                        </p>
                      )}
                      <ProposalDiff proposal={row} stacked />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Diff body */}
        <ProposalDiff proposal={p} stacked />
      </div>

      {/* Actions */}
      <div className="shrink-0 p-3 border-t border-[var(--border)] flex items-center gap-2">
        {actionId === p.id ? (
          <div className="flex-1 flex justify-center py-2.5"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
        ) : p.status === 'pending' ? (
          <>
            <button onClick={() => setRevising(true)}
              className="h-11 px-3.5 rounded-xl bg-[var(--surface-overlay)] active:bg-[var(--surface-raised)] text-text-secondary text-sm font-semibold transition-colors flex items-center gap-1.5">
              <Pencil size={14} /> Revise
            </button>
            <button onClick={() => doReview(p.id, 'reject')}
              className="flex-1 h-11 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              <XCircle size={15} /> Reject
            </button>
            <button onClick={() => doReview(p.id, 'approve')}
              className="flex-1 h-11 rounded-xl bg-emerald-500/15 active:bg-emerald-500/25 text-emerald-400 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              <CheckCircle size={15} /> Approve
            </button>
          </>
        ) : p.status === 'approved' ? (
          <button onClick={() => doReverse(p.id)} disabled={actionId === p.id}
            className="w-full h-11 rounded-xl text-sm text-text-muted active:text-amber-400 active:bg-amber-500/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
            <RotateCcw size={15} /> Reverse
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="shrink-0 flex flex-col gap-2 px-3 py-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {FILTERS.map(f => (
              <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  status === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted active:bg-surface-overlay'
                }`}>{f.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1 shrink-0">
            {SORTS.map(s => (
              <button key={s.id} onClick={() => setSortBy(s.id)}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                  sortBy === s.id ? 'bg-accent/15 text-accent' : 'text-text-muted active:bg-surface-overlay'
                }`}>{s.label}
              </button>
            ))}
          </div>
        </div>
        <QueueSearch value={query} onChange={setQuery} placeholder="Search title, editor, #id…"
          matches={sortedProposals.length} total={proposals.length} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {proposals.length === 0 && <Empty label="No proposals" />}
        {proposals.length > 0 && sortedProposals.length === 0 && <Empty label="No matches" />}
        {pageOf.map((item, idx) => (
          <ProposalRow
            key={item.id}
            item={item}
            showUserHeader={sortBy === 'user' && (idx === 0 || pageOf[idx - 1].editor_username !== item.editor_username)}
            onSelect={setSelected}
          />
        ))}
        {remaining > 0 && (
          <button onClick={() => setShown(s => s + PROPOSAL_PAGE)}
            className="w-full px-3 py-3 text-[11px] font-semibold text-accent active:bg-surface-raised transition-colors">
            Show {Math.min(remaining, PROPOSAL_PAGE)} more · {remaining} left
          </button>
        )}
      </div>
    </div>
  )
}

// ── Applications (master-detail) ──────────────────────────────────────────────

function ApplicationsTab({ applications, onChanged }: { applications: EditorApplication[]; onChanged: () => void }): JSX.Element {
  const [actionId, setActionId] = useState<number | null>(null)
  const [notes,    setNotes]    = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<EditorApplication | null>(null)

  const doReview = async (id: number, action: 'approve' | 'reject') => {
    setActionId(id)
    try { await userApi.adminReviewApplication(id, { action, review_notes: notes[id] || '' }); onChanged(); setSelected(null) }
    catch {} finally { setActionId(null) }
  }

  const pending  = applications.filter(a => a.status === 'pending')
  const reviewed = applications.filter(a => a.status !== 'pending')
  const a = selected

  useBackToClose(() => setSelected(null), a != null)

  if (a) return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={() => setSelected(null)}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 truncate text-text-primary text-[15px] font-bold">{displayName(a)}</h2>
        <StatusChip status={a.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Avatar src={a.discord_avatar} name={displayName(a)} size={12} />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-xs text-text-muted">
            {a.discord_username && <span>{a.discord_username}</span>}
            {a.contact && <span>{a.contact}</span>}
            <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(a.created_at)}</span>
            {a.reviewer_username && <span>Reviewed by {a.reviewer_username}</span>}
          </div>
        </div>

        <div className="space-y-4">
          {a.areas && <AppSection label="Areas of interest" value={a.areas} />}
          {a.experience && <AppSection label="Experience" value={a.experience} />}
          {a.motivation && <AppSection label="Motivation" value={a.motivation} />}
        </div>

        {a.status === 'pending' && (
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Review note</label>
            <textarea
              value={notes[a.id] || ''}
              onChange={e => setNotes(n => ({ ...n, [a.id]: e.target.value }))}
              placeholder="Optional note for the applicant…"
              rows={3}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-sm resize-none focus:outline-none focus:border-accent/40"
            />
          </div>
        )}
      </div>

      {a.status === 'pending' && (
        <div className="shrink-0 p-3 border-t border-[var(--border)] flex items-center gap-2">
          {actionId === a.id ? (
            <div className="flex-1 flex justify-center py-2.5"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
          ) : (
            <>
              <button onClick={() => doReview(a.id, 'reject')}
                className="flex-1 h-11 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                <XCircle size={15} /> Reject
              </button>
              <button onClick={() => doReview(a.id, 'approve')}
                className="flex-1 h-11 rounded-xl bg-emerald-500/15 active:bg-emerald-500/25 text-emerald-400 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                <CheckCircle size={15} /> Approve
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {applications.length === 0 && <Empty label="No applications" />}
        {pending.length > 0 && (
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Pending · {pending.length}</p>
          </div>
        )}
        {pending.map(item => (
          <button key={item.id} onClick={() => setSelected(item)}
            className="w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 border-l-amber-500/60 transition-colors text-text-primary active:bg-surface-raised">
            <div className="flex items-center gap-2.5">
              <Avatar src={item.discord_avatar} name={displayName(item)} size={9} />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-sm font-semibold truncate">{displayName(item)}</p>
                <p className="text-text-muted text-xs truncate">{item.application_type} · {item.discord_username} · {relativeTime(item.created_at)}</p>
              </div>
            </div>
          </button>
        ))}

        {reviewed.length > 0 && (
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Reviewed</p>
          </div>
        )}
        {reviewed.map(item => (
          <button key={item.id} onClick={() => setSelected(item)}
            className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${STATUS_STYLE[item.status]?.border ?? 'border-l-transparent'} transition-colors text-text-primary opacity-60 active:bg-surface-raised active:opacity-100`}>
            <div className="flex items-center gap-2.5">
              <Avatar src={item.discord_avatar} name={displayName(item)} size={8} />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-sm font-medium truncate">{displayName(item)}</p>
                <p className="text-text-muted text-xs">{item.status} · {shortDate(item.reviewed_at)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab({ users, onChanged, currentUserId }: { users: AdminUser[]; onChanged: () => void; currentUserId?: number }): JSX.Element {
  const { actionId, filter, setFilter, search, setSearch, filters: FILTERS, visible, doUpdate, canAct } = useAdminUsersList(users, currentUserId, onChanged)
  // Collapsed-by-default accordion instead of always-expanded cards - one
  // row open at a time, mirroring the desktop master/detail split adapted to
  // a single column.
  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-col gap-2 px-3 py-2.5 border-b border-[var(--border)]">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium transition-colors ${
                filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted active:bg-surface-overlay'
              }`}>
              {f.label}
              <span className={`text-[10px] px-1 rounded-full ${filter === f.id ? 'bg-accent/20' : 'bg-surface-raised'}`}>{f.count}</span>
            </button>
          ))}
        </div>
        <QueueSearch value={search} onChange={setSearch} placeholder="Search users…" matches={visible.length} total={users.length} />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {visible.length === 0 && <Empty label="No users" />}
        {visible.map(u => {
          const isOpen = expandedId === u.user_id
          return (
            <div key={u.user_id}>
              <button className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-surface-raised"
                onClick={() => setExpandedId(isOpen ? null : u.user_id)}>
                <Avatar src={u.discord_avatar} name={discordHandle(u)} size={9} />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm font-medium truncate flex items-center gap-1.5">
                    {discordHandle(u)}
                    {u.user_id === currentUserId && <span className="text-[10px] text-text-muted italic font-normal shrink-0">you</span>}
                  </p>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    <RoleBadges isAdmin={u.role === 'administrator'} isManager={!!u.manager_enabled}
                      isEditor={u.role === 'editor'} isContributor={u.contributor_enabled} />
                    {u.role === 'applicant' && !u.contributor_enabled && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-text-muted bg-surface-raised">Applicant</span>
                    )}
                    {!u.is_active && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-red-400 bg-red-500/15">disabled</span>}
                  </div>
                </div>
                <ChevronDown size={16} className={`text-text-muted transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="px-3 pb-3 space-y-3">
                  <p className="text-text-muted text-xs">
                    Joined {shortDate(u.date_joined)} · {u.approved_count} approved · {u.proposal_count} props
                    {u.contributor_enabled && <> · {u.comp_approved_count} comp approved · {u.comp_proposal_count} comp props</>}
                  </p>
                  <p className="text-text-muted text-xs">Last seen {relativeTime(u.last_login)}</p>

                  {u.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {u.badges.map(b => (
                        <span key={b.slug} title={b.description}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-overlay text-[11px] text-text-secondary">
                          <span>{b.icon}</span>{b.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {actionId === u.user_id ? (
                    <div className="flex justify-center py-1"><Loader2 size={14} className="animate-spin text-text-muted" /></div>
                  ) : canAct(u) ? (
                    <>
                      {(u.role === 'editor' || u.contributor_enabled) && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Auto-approve</p>
                          {u.role === 'editor' && (
                            <label className="flex items-center justify-between gap-2 text-sm text-text-secondary">
                              Song edit proposals
                              <input type="checkbox" checked={u.auto_approve_proposals}
                                onChange={e => doUpdate(u.user_id, { auto_approve_proposals: e.target.checked })}
                                className="w-4 h-4 accent-[var(--accent)]" />
                            </label>
                          )}
                          {u.contributor_enabled && (
                            <label className="flex items-center justify-between gap-2 text-sm text-text-secondary">
                              Comp file proposals
                              <input type="checkbox" checked={u.auto_approve_comp_proposals}
                                onChange={e => doUpdate(u.user_id, { auto_approve_comp_proposals: e.target.checked })}
                                className="w-4 h-4 accent-[var(--accent)]" />
                            </label>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        {u.role === 'editor' ? (
                          <button onClick={() => doUpdate(u.user_id, { role: 'applicant' })}
                            className="h-9 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 active:bg-red-500/15 transition-colors">−Editor</button>
                        ) : (
                          <button onClick={() => doUpdate(u.user_id, { role: 'editor' })}
                            className="h-9 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 active:bg-emerald-500/15 transition-colors">+Editor</button>
                        )}
                        {u.contributor_enabled ? (
                          <button onClick={() => doUpdate(u.user_id, { contributor_enabled: false })}
                            className="h-9 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 active:bg-red-500/15 transition-colors">−Contrib</button>
                        ) : (
                          <button onClick={() => doUpdate(u.user_id, { contributor_enabled: true })}
                            className="h-9 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 active:bg-emerald-500/15 transition-colors">+Contrib</button>
                        )}
                        {u.manager_enabled ? (
                          <button onClick={() => doUpdate(u.user_id, { manager_enabled: false })}
                            className="h-9 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 active:bg-red-500/15 transition-colors">−Manager</button>
                        ) : (
                          <button onClick={() => doUpdate(u.user_id, { manager_enabled: true })}
                            className="h-9 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 active:bg-emerald-500/15 transition-colors">+Manager</button>
                        )}
                        <button onClick={() => doUpdate(u.user_id, { is_active: !u.is_active })}
                          className="col-span-2 h-9 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay active:bg-surface-raised transition-colors">
                          {u.is_active ? 'Disable account' : 'Enable account'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-text-muted text-xs italic">
                      {u.user_id === currentUserId ? "You can't modify your own account here." : 'Administrators can only be modified elsewhere.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatsTab({ applications, proposals, users }: {
  applications: EditorApplication[]; proposals: SongEditProposal[]; users: AdminUser[]
}): JSX.Element {
  const { approved, approvalPct, editors, managers, topEditors, pendingProposals, pendingApplications, applicants } = useAdminStats(applications, proposals, users)

  const metrics = [
    { label: 'Total users',       value: users.length,        color: 'text-accent',        icon: <Users size={16} /> },
    { label: 'Editors',           value: editors.length,      color: 'text-emerald-400',   icon: <UserCheck size={16} /> },
    { label: 'Managers',          value: managers.length,     color: 'text-amber-400',     icon: <Shield size={16} /> },
    { label: 'Total proposals',   value: proposals.length,    color: 'text-blue-400',      icon: <FileEdit size={16} /> },
    { label: 'Approved',          value: approved,            color: 'text-emerald-400',   icon: <FileCheck size={16} /> },
    { label: 'Pending proposals', value: pendingProposals,    color: 'text-amber-400',     icon: <Clock size={16} /> },
    { label: 'Pending apps',      value: pendingApplications, color: 'text-amber-400',     icon: <Clock size={16} /> },
    { label: 'Approval rate',     value: `${approvalPct}%`,   color: 'text-purple-400',    icon: <Activity size={16} /> },
    { label: 'Applicants',        value: applicants,          color: 'text-text-muted',    icon: <Users size={16} /> },
  ]

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-2.5 mb-6">
        {metrics.map(m => (
          <div key={m.label} className="bg-surface-overlay border border-[var(--border)] rounded-xl p-3.5">
            <div className={`mb-2 ${m.color}`}>{m.icon}</div>
            <p className={`text-2xl font-black leading-none ${m.color}`}>{m.value}</p>
            <p className="text-text-muted text-[11px] mt-2">{m.label}</p>
          </div>
        ))}
      </div>

      {topEditors.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">Top editors by approvals</p>
          <div className="grid grid-cols-1 gap-2">
            {topEditors.map((u, i) => (
              <div key={u.user_id} className="flex items-center gap-3 px-4 py-3 bg-surface-overlay border border-[var(--border)] rounded-xl">
                <span className={`text-sm font-black w-6 text-center shrink-0 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-text-muted'}`}>
                  {i + 1}
                </span>
                <Avatar src={u.discord_avatar} name={discordHandle(u)} size={8} />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-xs font-semibold truncate">{discordHandle(u)}</p>
                  <p className="text-text-muted text-[10px]">{u.proposal_count} total</p>
                </div>
                <div className="text-right">
                  <p className="text-text-primary text-sm font-bold">{u.approved_count}</p>
                  <p className="text-text-muted text-[9px]">approved</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Security ──────────────────────────────────────────────────────────────────

function SecurityTab(): JSX.Element {
  return (
    <div className="p-4">
      <div className="flex items-start gap-4 px-5 py-5 rounded-2xl bg-emerald-500/8 border border-emerald-500/20">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Check size={18} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-text-primary font-semibold">Two-factor authentication enabled</p>
          <p className="text-text-muted text-sm mt-1">Your account is protected with 2FA.</p>
        </div>
      </div>
    </div>
  )
}

// ── OTP Setup ─────────────────────────────────────────────────────────────────

function OtpSetupPanel({ onEnabled }: { onEnabled: () => Promise<void> }): JSX.Element {
  const { setup, loading, code, setCode, confirming, error, confirm } = useOtpGate(onEnabled)

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
  if (!setup) return <p className="text-red-400 text-sm">Could not load OTP setup.</p>

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-text-primary text-base font-bold flex items-center gap-2"><KeyRound size={16} /> Enable 2FA</h2>
        <p className="text-text-muted text-sm mt-1.5 leading-relaxed">Admins must enable two-factor authentication. Scan the QR code with your authenticator app.</p>
      </div>
      {setup.qr_code && (
        <div className="bg-white p-4 rounded-2xl flex items-center justify-center w-fit mx-auto">
          <img src={setup.qr_code} alt="OTP QR code" className="w-40 h-40" />
        </div>
      )}
      {setup.otp_secret && (
        <div>
          <p className="text-text-muted text-[10px] mb-1.5">Manual entry:</p>
          <code className="block bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-xs font-mono break-all">{setup.otp_secret}</code>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1.5">Verification code</label>
        <input type="text" inputMode="numeric" value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirm()} placeholder="123456"
          className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-4 py-2.5 text-text-primary text-base focus:outline-none focus:border-accent/50 font-mono tracking-[0.5em] text-center"
        />
      </div>
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      <button onClick={confirm} disabled={confirming || !code}
        className="w-full py-2.5 rounded-xl bg-accent text-[var(--bg)] text-sm font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40">
        {confirming && <Loader2 size={14} className="animate-spin" />} Verify & enable
      </button>
    </div>
  )
}
