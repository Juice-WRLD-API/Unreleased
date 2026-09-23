import { useState, memo, useEffect, useMemo } from 'react'
import {
  ChevronLeft, Users, Clock, CheckCircle, XCircle, ShieldCheck, BarChart2,
  Loader2, RefreshCw, FileEdit, KeyRound, Check, AlertCircle, RotateCcw,
  ChevronDown, ChevronUp, Shield, MessageSquare, Calendar,
  Hash, Plus, UserCheck, FileCheck, Activity, Pencil, X as XIcon, ChevronDown as ChevronDownIcon,
  History, Play,
} from 'lucide-react'
import { apiFetch, songToTrack } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { useStore, useStorePick } from '../store/useStore'
import { displayName } from '../store/chatStore'
import { discordHandle } from '../lib/format'
import * as userApi from '../lib/userApi'
import type { EditorApplication, SongEditProposal, AdminUser, ProposalStatus } from '../lib/userApi'
import { relativeTime, shortDate, STATUS_STYLE, StatusChip, Avatar, Empty, AppSection, QueueSearch, ProposalDiff } from './adminShared'
import ReportsTab from './ReportsTab'
import CompProposalsTab from './CompProposalsTab'
import ChannelsTab from './ChannelsTab'
import EraTab from './EraTab'
import CdnNodesTab from './CdnNodesTab'
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
  /** Which section to show - used by EditorProfileView's managerOnly mobile
   *  landing (the only remaining embedded caller). Standalone falls back to
   *  the URL-derived tab below instead. */
  initialTab?: AdminTab
  /** Embedded-only: lets the host (EditorProfileView) close this panel and
   *  return to its own page. */
  onExit?: () => void
}): JSX.Element {
  const { account, loadAccount, setActiveView, setActiveAdminTab, activeChannel, channels, activeAdminTab } = useStorePick('account', 'loadAccount', 'setActiveView', 'setActiveAdminTab', 'activeChannel', 'channels', 'activeAdminTab')
  const go = setActiveView
  // Falls back to the standalone console's own deep link (see
  // ADMIN_TAB_PATHS) when nobody passed an explicit initialTab - only
  // relevant when not embedded, since the embedded panel has no URL of its
  // own and always arrives with an explicit initialTab from its host
  // (e.g. EditorProfileView's Admin tile) instead.
  const effectiveInitialTab = initialTab ?? (embedded ? undefined : activeAdminTab ?? undefined)
  // Scoped to the active channel, not "any channel" - a manager grant on one
  // channel shouldn't leave this nav/content visible (and then erroring) on
  // a channel they don't actually manage. See useChannelRoles for the same
  // pattern used elsewhere.
  const { isAdmin: isFullAdmin, canReviewStaff: canAccessStaff } = useStaffRoles(account, activeChannel, channels)
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
    canLoad: canAccessStaff,
    isFullAdmin,
    gateNonProposalTabs: true,
    activeChannel,
    initialTab: effectiveInitialTab ?? 'proposals',
    // No Security tab for managers: it renders a flat "2FA is enabled", which
    // the OTP gate below guarantees for admins and can't guarantee for them.
    managerNavIds: ['proposals', 'comp-proposals'],
  })

  // No more overview grid - every section already has its own deep link
  // (see ADMIN_TAB_PATHS) and its own entry point on the profile page's
  // Admin tile, so a second, in-page "pick a section" screen was a
  // redundant extra hop rather than a real navigation aid. AdminPage now
  // just shows whichever single section it was asked for, directly, but
  // still offers a compact in-page tab row below to move between sections
  // without leaving the page (embedded mode only ever switches local state;
  // standalone also updates the URL so the switch is a real deep link).
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

  if (!canAccessStaff) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
      <Shield size={28} className="text-text-muted" />
      <p className="text-text-primary font-semibold text-sm">Staff access required</p>
      <button onClick={() => go('api-tracker')} className="text-xs text-accent hover:underline">Go back</button>
    </div>
  )

  // Admins only, deliberately. A manager approving proposals is making the same
  // kind of irreversible change, so gating them on 2FA as well would be the
  // right call - but they can't satisfy it: GET accounts/otp/setup/ answers
  // "Administrator access required.", so a manager with otp_enabled false would
  // be parked in front of a panel whose first request 403s, with no way through
  // to the review queues. Enforcing this is the API's job; don't tighten it here
  // until that endpoint accepts a manager token.
  if (isFullAdmin && !otpEnabled) return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <OtpSetupPanel onEnabled={async () => { await loadAccount() }} />
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`shrink-0 flex items-center gap-3 pb-0 border-b border-[var(--border)] ${embedded ? 'px-4' : 'px-6'}`}
        style={{ paddingTop: embedded ? 4 : 16 }}>
        {embedded && onExit ? (
          <button onClick={onExit}
            className="flex items-center gap-1.5 p-1.5 -ml-1.5 rounded-lg hover:bg-surface-overlay transition-colors text-text-muted hover:text-text-primary mb-3 text-xs font-semibold">
            <ChevronLeft size={16} /> Dashboard
          </button>
        ) : !embedded ? (
          <button onClick={() => go('api-tracker')}
            className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors text-text-muted hover:text-text-primary mb-3">
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div className="mb-3 min-w-0 flex-1">
          <span className="text-text-primary font-bold text-sm">{activeNavItem?.label ?? (isFullAdmin ? 'Admin' : 'Manager')}</span>
          {!embedded && account?.discord_username && (
            <span className="text-text-muted text-xs ml-2">{account.discord_username}</span>
          )}
        </div>
      </div>

      {nav.length > 1 && (
        <div className={`shrink-0 flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] scrollbar-none ${embedded ? 'px-4' : 'px-6'}`}>
          {nav.map(item => (
            <button key={item.id} onClick={() => switchTab(item.id)}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 my-1 rounded-lg text-[11px] font-semibold transition-colors ${
                tab === item.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
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
      {tab !== 'comp-proposals' && tab !== 'channels' && tab !== 'eras' && tab !== 'cdn-nodes' && tab !== 'security' && (
        <div className={`shrink-0 flex items-center justify-end border-b border-[var(--border)] ${embedded ? 'px-4' : 'px-6'} py-1.5`}>
          <button onClick={() => refresh()} disabled={loading} title="Refresh"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:text-accent/80 transition-colors disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
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
            <ProposalsTab
              proposals={proposals}
              status={propStatus}
              setStatus={setPropStatus}
              onChanged={() => refresh()}
              onReviewed={(updated) => setProposals(prev => {
                const next = prev.map(p => p.id === updated.id ? updated : p)
                return propStatus && updated.status !== propStatus ? next.filter(p => p.id !== updated.id) : next
              })}
              channel={activeChannel}
            />
          </div>
        )}
        {visited.has('comp-proposals') && (
          <div className={tab === 'comp-proposals' ? 'h-full' : 'hidden'}>
            <CompProposalsTab embedded onChanged={() => refresh()} />
          </div>
        )}
        {visited.has('applications') && (
          <div className={tab === 'applications' ? 'h-full' : 'hidden'}>
            <ApplicationsTab
              applications={applications}
              onChanged={() => refresh()}
              onReviewed={(updated) => setApplications(prev => prev.map(a => a.id === updated.id ? updated : a))}
            />
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
        {visited.has('cdn-nodes') && (
          <div className={tab === 'cdn-nodes' ? 'h-full' : 'hidden'}>
            <CdnNodesTab />
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
    <div className="flex-1 flex flex-col h-full overflow-hidden border-l-2 border-accent/30 bg-[var(--surface)]">
      {/* Panel header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-raised)]">
        <Pencil size={13} className="text-accent" />
        <span className="text-text-primary text-xs font-semibold flex-1">Revise proposal</span>
        <button onClick={onClose} title="Close" className="p-1 rounded text-text-muted hover:text-text-primary transition-colors">
          <XIcon size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Field editors */}
        {Object.entries(fields).map(([key, val]) => (
          <div key={key} className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
              <span className="font-mono text-[10px] text-text-muted flex-1">{key.replace(/_/g, ' ')}</span>
              <button onClick={() => removeField(key)} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
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
              className="px-3 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs font-semibold disabled:opacity-40 transition-colors"
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
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-raised)]">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || Object.keys(fields).length === 0}
          className="flex-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/90 text-[var(--bg)] text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save revision
        </button>
      </div>
    </div>
  )
}

// ── Proposals (master-detail) ─────────────────────────────────────────────────

// Memoized because the list isn't windowed: with the status filter on "All"
// it holds the whole proposal archive, and without this every keystroke in the
// search box re-rendered every row that survived the filter. `onSelect` is
// setSelected straight from useState, so its identity is stable and the memo
// actually holds.
const ProposalRow = memo(function ProposalRow({ item, active, showUserHeader, pendingCount, accepting, onSelect, onAcceptAll, onRejectAll }: {
  item: SongEditProposal
  active: boolean
  showUserHeader: boolean
  /** Pending proposals by this user, across the whole (unfiltered-by-search)
   *  list - drives whether the group header offers "Accept all". */
  pendingCount: number
  accepting: boolean
  onSelect: (p: SongEditProposal) => void
  onAcceptAll: (editorId: number) => void
  onRejectAll: (editorId: number) => void
}): JSX.Element {
  const ss = STATUS_STYLE[item.status] ?? { border: 'border-l-transparent', text: 'text-text-muted', bg: '', dot: '' }
  return (
    <div>
      {showUserHeader && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-overlay border-b border-[var(--border)] sticky top-0 z-[1]">
          <span className="flex-1 min-w-0 truncate text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {item.editor_username}
          </span>
          {pendingCount > 1 && (
            <>
            <button onClick={(e) => { e.stopPropagation(); onAcceptAll(item.editor_id) }} disabled={accepting}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-40">
              {accepting ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
              Accept all ({pendingCount})
            </button>
            <button onClick={(e) => { e.stopPropagation(); onRejectAll(item.editor_id) }} disabled={accepting}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40">
              <XCircle size={10} />
              Deny all ({pendingCount})
            </button>
            </>
          )}
        </div>
      )}
      <button onClick={() => onSelect(item)}
        className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${ss.border} transition-colors ${
          active ? 'bg-accent/10' : 'hover:bg-surface-raised'
        }`}>
        <div className="flex items-center gap-1.5 mb-1">
          <StatusChip status={item.status} />
          <span className="text-[9px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded font-medium">
            {item.change_type}
          </span>
          {item.song_public_id != null && (
            <span className="text-[9px] text-text-muted ml-auto flex items-center gap-0.5">
              <Hash size={8} />{item.song_public_id}
            </span>
          )}
        </div>
        <p className="text-[12px] font-semibold truncate leading-snug mb-0.5 text-text-primary">
          {item.title || `Proposal #${item.id}`}
        </p>
        <p className="text-[10px] text-text-muted truncate">
          {item.editor_username} · {relativeTime(item.created_at)}
        </p>
      </button>
    </div>
  )
})

function ProposalsTab({ proposals, status, setStatus, onChanged, onReviewed, channel }: {
  proposals: SongEditProposal[]
  status: ProposalStatus | ''
  setStatus: (s: ProposalStatus | '') => void
  onChanged: () => void
  onReviewed: (updated: SongEditProposal) => void
  channel?: string
}): JSX.Element {
  const [actionId,    setActionId]    = useState<number | null>(null)
  const [notes,       setNotes]       = useState<Record<number, string>>({})
  const [selected,    setSelected]    = useState<SongEditProposal | null>(null)
  const [revising,    setRevising]    = useState(false)
  const [acceptingAllUser, setAcceptingAllUser] = useState<number | null>(null)

  const {
    sortBy, setSortBy, query, setQuery, sortedProposals, pageOf, remaining, setShown,
    dropCache, setArchive, archive, archiveLoading, archiveError,
    historyOpen, openHistory, expandedPast, setExpandedPast,
    history, pastCount, loadingSongId, setLoadingSongId, playError, setPlayError,
  } = useProposalsTabData(proposals, channel, selected)
  const { playTrack } = useStorePick('playTrack')

  // Plays the song a proposal targets, so a reviewer can hear what they're
  // approving without leaving the queue. Fetched per click rather than per
  // selection - flipping through the list would otherwise fire a request for
  // every row passed over.
  const playProposalSong = async (songId: number): Promise<void> => {
    setPlayError(null)
    setLoadingSongId(songId)
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
      const track = songToTrack(song)
      // An unsurfaced song is a real catalog entry with no file behind it -
      // the proposal is still reviewable, there's just nothing to play.
      if (!track.path) { setPlayError('No file on this song to play'); return }
      playTrack(track, [track])
    } catch {
      setPlayError('Could not load this song')
    } finally {
      setLoadingSongId(null)
    }
  }

  // Auto-select first item, and keep the selection inside the visible list -
  // searching can otherwise filter out the proposal the detail pane's
  // Approve/Reject buttons are pointed at.
  useEffect(() => {
    setSelected(prev => {
      if (prev && sortedProposals.some(p => p.id === prev.id)) return prev
      return sortedProposals[0] ?? null
    })
  }, [sortedProposals])

  // A refetch replaces the rows wholesale, so a half-written revision no
  // longer lines up with what's on screen. Typing in the search box must not
  // trip this - that's why it keys off the raw list, not the filtered one.
  useEffect(() => { setRevising(false) }, [proposals])

  const doReview = async (id: number, action: 'approve' | 'reject') => {
    setActionId(id)
    try {
      const updated = await userApi.adminReviewProposal(id, { action, review_notes: notes[id] || '', channel })
      dropCache(id); setArchive(null)
      // The endpoint hands back the updated row - apply it immediately rather
      // than waiting on onChanged()'s full refetch, so the row leaves the
      // pending list (or updates its status badge) right away instead of
      // sitting there looking unactioned until the round-trip finishes.
      onReviewed(updated)
      onChanged()
    }
    catch {} finally { setActionId(null) }
  }

  const doReverse = async (id: number) => {
    if (!confirm('Reverse this approval?')) return
    setActionId(id)
    try {
      const updated = await userApi.adminReverseProposal(id, channel)
      dropCache(id); setArchive(null)
      onReviewed(updated)
      onChanged()
    }
    catch {} finally { setActionId(null) }
  }

  // Keyed off the full (unfiltered-by-search) list so the group header's
  // count and the "Accept all" button reflect what's actually pending, not
  // just what the search box happens to be showing.
  const pendingByUser = useMemo(() => {
    const m = new Map<number, number>()
    for (const x of proposals) {
      if (x.status === 'pending') m.set(x.editor_id, (m.get(x.editor_id) ?? 0) + 1)
    }
    return m
  }, [proposals])

  // Approves every pending proposal from one editor in sequence (not
  // parallel - these mutate the same song's data, and later ones may build
  // on fields an earlier one just touched). Each success is applied via
  // onReviewed as it lands, same as a single Approve; a per-item failure is
  // swallowed so one bad row doesn't stop the rest of the batch.
  const doReviewAllForUser = async (editorId: number, action: 'approve' | 'reject') => {
    const pending = proposals.filter(x => x.editor_id === editorId && x.status === 'pending')
    if (pending.length === 0) return
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Deny'} all ${pending.length} pending proposal${pending.length !== 1 ? 's' : ''} from ${pending[0].editor_username} (#${editorId})?`)) return
    setAcceptingAllUser(editorId)
    try {
      for (const item of pending) {
        try {
          const updated = await userApi.adminReviewProposal(item.id, { action, channel })
          dropCache(item.id); setArchive(null)
          onReviewed(updated)
        } catch {}
      }
      onChanged()
    } finally {
      setAcceptingAllUser(null)
    }
  }

  const FILTERS = PROPOSAL_FILTERS
  const SORTS = PROPOSAL_SORTS

  const p = selected

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: list */}
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        {/* Filter bar */}
        <div className="shrink-0 px-3 py-2.5 border-b border-[var(--border)] bg-surface-raised">
          <div className="flex gap-1 flex-wrap items-center">
            {FILTERS.map(f => (
              <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  status === f.id
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                }`}>{f.label}
              </button>
            ))}
            <div className="ml-auto flex gap-1 shrink-0">
              {SORTS.map(s => (
                <button key={s.id} onClick={() => setSortBy(s.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    sortBy === s.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                  }`}>{s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2">
            <QueueSearch value={query} onChange={setQuery} placeholder="Search title, editor, #id…"
              matches={sortedProposals.length} total={proposals.length} />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {proposals.length === 0 && <Empty label="No proposals" />}
          {proposals.length > 0 && sortedProposals.length === 0 && <Empty label="No matches" />}
          {pageOf.map((item, idx) => (
            <ProposalRow
              key={item.id}
              item={item}
              active={selected?.id === item.id}
              showUserHeader={sortBy === 'user' && (idx === 0 || pageOf[idx - 1].editor_id !== item.editor_id)}
              pendingCount={pendingByUser.get(item.editor_id) ?? 0}
              accepting={acceptingAllUser === item.editor_id}
              onSelect={setSelected}
              onAcceptAll={(id) => doReviewAllForUser(id, 'approve')}
              onRejectAll={(id) => doReviewAllForUser(id, 'reject')}
            />
          ))}
          {remaining > 0 && (
            <button onClick={() => setShown(s => s + PROPOSAL_PAGE)}
              className="w-full px-3 py-3 text-[11px] font-semibold text-accent hover:bg-surface-raised transition-colors">
              Show {Math.min(remaining, PROPOSAL_PAGE)} more · {remaining} left
            </button>
          )}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 flex overflow-hidden">
        {!p ? (
          <Empty label="Select a proposal" />
        ) : revising ? (
          <RevisePanel
            proposal={p}
            onClose={() => setRevising(false)}
            onDone={() => { setRevising(false); onChanged() }}
            channel={channel}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Detail header */}
            <div className="shrink-0 px-6 py-4 border-b border-[var(--border)] bg-surface-raised">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusChip status={p.status} />
                    <span className="text-[10px] text-text-muted bg-surface-raised px-2 py-0.5 rounded font-medium">{p.change_type}</span>
                    {p.song_public_id != null && (
                      <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                        <Hash size={9} />{p.song_public_id}
                      </span>
                    )}
                  </div>
                  <h2 className="text-text-primary font-bold text-base leading-snug">{p.title || `Proposal #${p.id}`}</h2>
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-text-muted flex-wrap">
                    <span>by <span className="text-text-muted font-medium">{p.editor_username}</span></span>
                    <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(p.created_at)}</span>
                    {p.reviewer_username && <span>reviewed by <span className="text-text-muted">{p.reviewer_username}</span></span>}
                    {p.edit_count > 0 && <span>{p.edit_count} edit{p.edit_count !== 1 ? 's' : ''}</span>}
                    {p.song != null && (
                      <button onClick={openHistory}
                        className={`flex items-center gap-1 transition-colors ${historyOpen ? 'text-accent' : 'hover:text-text-primary'}`}>
                        <History size={10} />
                        {/* The count is unknown until the archive loads, so the
                            label stays generic rather than promising a number
                            it might have to take back. */}
                        {archive ? (pastCount === 0 ? 'no earlier proposals' : `${pastCount} earlier proposal${pastCount === 1 ? '' : 's'}`) : 'history'}
                        {historyOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Play - outside the pending-only block below: hearing the
                    song is just as useful when auditing something already
                    approved or reversed. */}
                {p.song != null && (
                  <button onClick={() => playProposalSong(p.song as number)} disabled={loadingSongId != null}
                    title="Play this song"
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] text-text-secondary text-xs font-semibold transition-colors flex items-center gap-1.5 border border-[var(--border)] disabled:opacity-40">
                    {loadingSongId === p.song
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Play size={13} />}
                    Play
                  </button>
                )}

                {/* Actions */}
                {p.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    {actionId === p.id ? <Loader2 size={14} className="animate-spin text-text-muted" /> : (
                      <>
                        <button onClick={() => setRevising(true)}
                          className="px-3 py-1.5 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] text-text-secondary text-xs font-semibold transition-colors flex items-center gap-1.5 border border-[var(--border)]">
                          <Pencil size={13} /> Revise
                        </button>
                        <button onClick={() => doReview(p.id, 'reject')}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                          <XCircle size={13} /> Reject
                        </button>
                        <button onClick={() => doReview(p.id, 'approve')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                          <CheckCircle size={13} /> Approve
                        </button>
                      </>
                    )}
                  </div>
                )}
                {p.status === 'approved' && (
                  <button onClick={() => doReverse(p.id)} disabled={actionId === p.id}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-40">
                    {actionId === p.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Reverse
                  </button>
                )}
              </div>

              {playError && (
                <p className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-400">
                  <AlertCircle size={11} /> {playError}
                </p>
              )}

              {/* Notes */}
              {(p.editor_notes || p.review_notes) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {p.editor_notes && (
                    <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)] max-w-sm">
                      <MessageSquare size={11} className="text-text-muted shrink-0 mt-0.5" />
                      {p.editor_notes}
                    </div>
                  )}
                  {p.review_notes && (
                    <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)] max-w-sm">
                      <Check size={11} className="text-text-muted shrink-0 mt-0.5" />
                      {p.review_notes}
                    </div>
                  )}
                </div>
              )}

              {/* Review notes input for pending */}
              {p.status === 'pending' && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={notes[p.id] || ''}
                    onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))}
                    placeholder="Add review note (optional)…"
                    className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-accent/40"
                  />
                </div>
              )}
            </div>

            {/* Song history - every proposal ever filed against this song, so a
                reviewer can see whether a field has been fought over before,
                or whether this editor is re-submitting something already
                rejected. Read-only: expanding a row shows its diff in place
                rather than moving the selection, which would fight the status
                filter (a rejected proposal isn't in a Pending list). */}
            {historyOpen && p.song != null && (
              <div className="shrink-0 max-h-64 overflow-y-auto border-b border-[var(--border)] bg-[var(--surface)]">
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
                        className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${isViewing ? 'bg-accent/5' : 'hover:bg-surface-raised'}`}>
                        <StatusChip status={row.status} />
                        <span className="text-[11px] text-text-primary truncate flex-1 min-w-0">
                          {row.title || `Proposal #${row.id}`}
                        </span>
                        {isViewing && <span className="text-[9px] text-accent font-semibold shrink-0">viewing</span>}
                        <span className="text-[10px] text-text-muted shrink-0">{row.editor_username}</span>
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
                          <ProposalDiff proposal={row} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Diff body */}
            <div className="flex-1 overflow-y-auto">
              <ProposalDiff proposal={p} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Applications (master-detail) ──────────────────────────────────────────────

function ApplicationsTab({ applications, onChanged, onReviewed }: { applications: EditorApplication[]; onChanged: () => void; onReviewed: (updated: EditorApplication) => void }): JSX.Element {
  const [actionId, setActionId] = useState<number | null>(null)
  const [notes,    setNotes]    = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<EditorApplication | null>(null)

  useEffect(() => { setSelected(applications[0] ?? null) }, [applications])

  const doReview = async (id: number, action: 'approve' | 'reject') => {
    setActionId(id)
    try {
      const updated = await userApi.adminReviewApplication(id, { action, review_notes: notes[id] || '' })
      // Apply the returned row immediately - same reasoning as ProposalsTab's
      // doReview - instead of leaving it looking pending until onChanged()'s
      // refetch lands.
      onReviewed(updated)
      onChanged()
    }
    catch {} finally { setActionId(null) }
  }

  const pending  = applications.filter(a => a.status === 'pending')
  const reviewed = applications.filter(a => a.status !== 'pending')
  const a = selected

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left list */}
      <div className="w-72 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        {pending.length > 0 && (
          <div className="shrink-0 px-3 pt-3 pb-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted">Pending · {pending.length}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {applications.length === 0 && <Empty label="No applications" />}
          {pending.map(item => (
            <button key={item.id} onClick={() => setSelected(item)}
              className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 border-l-amber-500/60 transition-colors text-text-primary ${selected?.id === item.id ? 'bg-accent/10' : 'hover:bg-surface-raised'}`}>
              <div className="flex items-center gap-2.5">
                <Avatar src={item.discord_avatar} name={displayName(item)} size={8} />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-xs font-semibold truncate">{displayName(item)}</p>
                  <p className="text-text-muted text-[10px] truncate">{item.application_type} · {item.discord_username} · {relativeTime(item.created_at)}</p>
                </div>
              </div>
            </button>
          ))}

          {reviewed.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted">Reviewed</p>
            </div>
          )}
          {reviewed.map(item => (
            <button key={item.id} onClick={() => setSelected(item)}
              className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${STATUS_STYLE[item.status]?.border ?? 'border-l-transparent'} transition-colors text-text-primary opacity-60 ${selected?.id === item.id ? 'bg-accent/10 opacity-100' : 'hover:bg-surface-raised'}`}>
              <div className="flex items-center gap-2.5">
                <Avatar src={item.discord_avatar} name={displayName(item)} size={7} />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-xs font-medium truncate">{displayName(item)}</p>
                  <p className="text-text-muted text-[10px]">{item.status} · {shortDate(item.reviewed_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!a ? <Empty label="Select an application" /> : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* User info */}
            <div className="flex items-start gap-4">
              <Avatar src={a.discord_avatar} name={displayName(a)} size={14} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h2 className="text-text-primary text-lg font-bold">{displayName(a)}</h2>
                  <StatusChip status={a.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap">
                  {a.discord_username && <span>{a.discord_username}</span>}
                  {a.contact && <span>{a.contact}</span>}
                  <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(a.created_at)}</span>
                  {a.reviewer_username && <span>Reviewed by {a.reviewer_username}</span>}
                </div>
              </div>

              {a.status === 'pending' && (
                <div className="flex items-center gap-2 shrink-0">
                  {actionId === a.id ? <Loader2 size={14} className="animate-spin text-text-muted" /> : (
                    <>
                      <button onClick={() => doReview(a.id, 'reject')}
                        className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                        <XCircle size={13} /> Reject
                      </button>
                      <button onClick={() => doReview(a.id, 'approve')}
                        className="px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                        <CheckCircle size={13} /> Approve
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <hr className="border-[var(--border)]" />

            {/* Application fields */}
            <div className="space-y-4">
              {a.areas && <AppSection label="Areas of interest" value={a.areas} />}
              {a.experience && <AppSection label="Experience" value={a.experience} />}
              {a.motivation && <AppSection label="Motivation" value={a.motivation} />}
            </div>

            {/* Review notes */}
            {a.status === 'pending' && (
              <label className="space-y-2 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Review note</span>
                <textarea
                  value={notes[a.id] || ''}
                  onChange={e => setNotes(n => ({ ...n, [a.id]: e.target.value }))}
                  placeholder="Optional note for the applicant…"
                  rows={3}
                  className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-sm resize-none focus:outline-none focus:border-accent/40"
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab({ users, onChanged, currentUserId }: { users: AdminUser[]; onChanged: () => void; currentUserId?: number }): JSX.Element {
  const { actionId, filter, setFilter, search, setSearch, filters: FILTERS, visible, doUpdate, canAct } = useAdminUsersList(users, currentUserId, onChanged)
  // Master/detail instead of one wide row per user - a click on the roster
  // rail (left) drives which user's full stat/badge/action surface shows on
  // the right, rather than every user's actions competing for space in a
  // single dense line.
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Keep a valid selection as filter/search narrows the roster - falls back
  // to the first visible row, or nothing once the list is empty.
  useEffect(() => {
    if (selectedId != null && visible.some(u => u.user_id === selectedId)) return
    setSelectedId(visible[0]?.user_id ?? null)
  }, [visible, selectedId])

  const selected = visible.find(u => u.user_id === selectedId) ?? null

  return (
    <div className="h-full flex overflow-hidden">
      {/* Roster rail */}
      <div className="w-[300px] shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="shrink-0 flex flex-col gap-2 p-3 border-b border-[var(--border)]">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                }`}>
                {f.label}
                <span className={`text-[9px] px-1 rounded-full ${filter === f.id ? 'bg-accent/20' : 'bg-surface-raised'}`}>{f.count}</span>
              </button>
            ))}
          </div>
          <QueueSearch value={search} onChange={setSearch} placeholder="Search users…" matches={visible.length} total={users.length} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 && <Empty label="No users" />}
          {visible.map(u => (
            <button key={u.user_id} onClick={() => setSelectedId(u.user_id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-[var(--border)] text-left transition-colors ${
                selectedId === u.user_id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              }`}>
              <Avatar src={u.discord_avatar} name={discordHandle(u)} size={8} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
                  {discordHandle(u)}
                  {!u.is_active && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                </p>
                <div className="flex gap-1 flex-wrap mt-0.5">
                  <RoleBadges isAdmin={u.role === 'administrator'} isManager={!!u.manager_enabled}
                    isEditor={u.role === 'editor'} isContributor={u.contributor_enabled} />
                  {u.role === 'applicant' && !u.contributor_enabled && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-text-muted bg-surface-raised">Applicant</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? <Empty label="Select a user" /> : (
          <div className="max-w-2xl space-y-5">
            <div className="flex items-center gap-4">
              <Avatar src={selected.discord_avatar} name={discordHandle(selected)} size={16} />
              <div className="min-w-0">
                <h2 className="text-text-primary text-lg font-bold truncate flex items-center gap-2">
                  {discordHandle(selected)}
                  {!selected.is_active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-red-400 bg-red-500/15">disabled</span>}
                  {selected.user_id === currentUserId && <span className="text-xs text-text-muted italic font-normal">you</span>}
                </h2>
                <p className="text-text-muted text-xs mt-0.5">
                  Joined {shortDate(selected.date_joined)} · Last seen {relativeTime(selected.last_login)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <RoleBadges isAdmin={selected.role === 'administrator'} isManager={!!selected.manager_enabled}
                isEditor={selected.role === 'editor'} isContributor={selected.contributor_enabled} />
              {selected.role === 'applicant' && !selected.contributor_enabled && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-text-muted bg-surface-raised">Applicant</span>
              )}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              <span><span className="text-text-primary font-bold">{selected.approved_count}</span> <span className="text-text-muted">approved</span></span>
              <span><span className="text-text-primary font-bold">{selected.proposal_count}</span> <span className="text-text-muted">proposals</span></span>
              {selected.contributor_enabled && (
                <>
                  <span><span className="text-text-primary font-bold">{selected.comp_approved_count}</span> <span className="text-text-muted">comp approved</span></span>
                  <span><span className="text-text-primary font-bold">{selected.comp_proposal_count}</span> <span className="text-text-muted">comp proposals</span></span>
                </>
              )}
            </div>

            {selected.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.badges.map(b => (
                  <span key={b.slug} title={b.description}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-overlay text-[11px] text-text-secondary">
                    <span>{b.icon}</span>{b.name}
                  </span>
                ))}
              </div>
            )}

            {actionId === selected.user_id ? (
              <div className="flex items-center gap-2 text-text-muted text-sm"><Loader2 size={14} className="animate-spin" /> Updating…</div>
            ) : canAct(selected) ? (
              <div className="space-y-4">
                {(selected.role === 'editor' || selected.contributor_enabled) && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Auto-approve</p>
                    {selected.role === 'editor' && (
                      <label className="flex items-center justify-between gap-2 text-sm text-text-secondary cursor-pointer">
                        Song edit proposals
                        <input type="checkbox" checked={selected.auto_approve_proposals}
                          onChange={e => doUpdate(selected.user_id, { auto_approve_proposals: e.target.checked })}
                          className="w-4 h-4 accent-[var(--accent)]" />
                      </label>
                    )}
                    {selected.contributor_enabled && (
                      <label className="flex items-center justify-between gap-2 text-sm text-text-secondary cursor-pointer">
                        Comp file proposals
                        <input type="checkbox" checked={selected.auto_approve_comp_proposals}
                          onChange={e => doUpdate(selected.user_id, { auto_approve_comp_proposals: e.target.checked })}
                          className="w-4 h-4 accent-[var(--accent)]" />
                      </label>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Role & status</p>
                  <div className="grid grid-cols-2 gap-2">
                    {selected.role === 'editor' ? (
                      <button onClick={() => doUpdate(selected.user_id, { role: 'applicant' })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">−Editor</button>
                    ) : (
                      <button onClick={() => doUpdate(selected.user_id, { role: 'editor' })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors">+Editor</button>
                    )}
                    {selected.contributor_enabled ? (
                      <button onClick={() => doUpdate(selected.user_id, { contributor_enabled: false })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">−Contrib</button>
                    ) : (
                      <button onClick={() => doUpdate(selected.user_id, { contributor_enabled: true })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors">+Contrib</button>
                    )}
                    {selected.manager_enabled ? (
                      <button onClick={() => doUpdate(selected.user_id, { manager_enabled: false })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">−Manager</button>
                    ) : (
                      <button onClick={() => doUpdate(selected.user_id, { manager_enabled: true })}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors">+Manager</button>
                    )}
                    <button onClick={() => doUpdate(selected.user_id, { is_active: !selected.is_active })}
                      className="col-span-2 px-3 py-2 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised transition-colors">
                      {selected.is_active ? 'Disable account' : 'Enable account'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-text-muted text-xs italic">
                {selected.user_id === currentUserId ? "You can't modify your own account here." : 'Administrators can only be modified elsewhere.'}
              </p>
            )}
          </div>
        )}
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
    <div className="h-full overflow-y-auto p-6">
      <div className="grid grid-cols-4 gap-3 mb-6">
        {metrics.map(m => (
          <div key={m.label} className="bg-surface-overlay border border-[var(--border)] rounded-xl p-4">
            <div className={`mb-2 ${m.color}`}>{m.icon}</div>
            <p className={`text-3xl font-black leading-none ${m.color}`}>{m.value}</p>
            <p className="text-text-muted text-[11px] mt-2">{m.label}</p>
          </div>
        ))}
      </div>

      {topEditors.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">Top editors by approvals</p>
          <div className="grid grid-cols-2 gap-2">
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
    <div className="p-6 max-w-md">
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
      <label className="block">
        <span className="block text-xs font-semibold text-text-muted mb-1.5">Verification code</span>
        <input type="text" inputMode="numeric" value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirm()} placeholder="123456"
          className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-4 py-2.5 text-text-primary text-base focus:outline-none focus:border-accent/50 font-mono tracking-[0.5em] text-center"
        />
      </label>
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
