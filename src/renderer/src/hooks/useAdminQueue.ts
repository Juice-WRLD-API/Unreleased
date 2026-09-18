// Extracts AdminPage's load() effect, tab state, per-tab refresh keys/data,
// and the pendingApps/pendingProps/pendingReports/fullNav/nav derivation -
// the highest-leverage extraction in the rewrite given the near-total
// hook-name overlap already observed between AdminPage.desktop.tsx and
// .mobile.tsx.
//
// Desktop and mobile differ in two real ways that this hook preserves via
// its options rather than papering over:
//   1. The top-level load() gate. Desktop allows managers in (canLoad =
//      isFullAdmin || isManager) so they can load the Song edits queue too;
//      mobile only allows load() to run for full admins (canLoad = isAdmin),
//      because mobile forces managers onto the Comp files tab exclusively
//      (see forceTab below) and that tab fetches its own data independently
//      inside CompProposalsTab.mobile - it was never fed by this hook.
//   2. Which tabs a manager's nav shows: desktop gives managers both
//      "Song edits" and "Comp files" (managerNavIds), mobile gives managers
//      only "Comp files". Both are deliberate, pre-existing differences -
//      not something to unify here.
import { useCallback, useEffect, useRef, useState } from 'react'
import * as userApi from '../lib/userApi'
import { CONTRIBUTOR_ENABLED } from '../lib/userApi'
import type { AdminUser, EditorApplication, ProposalStatus, SongEditProposal } from '../lib/userApi'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'
import { errorMessage } from '../lib/format'

export type AdminTab = 'proposals' | 'comp-proposals' | 'applications' | 'reports' | 'users' | 'stats' | 'security' | 'channels' | 'eras'

// Deep-link paths for the standalone (non-embedded) admin console - each
// section its own top-level URL instead of one flat "/admin" for every tab.
// 'proposals' keeps the existing "/admin" as its path (that's the section
// that's been there since before per-tab deep links existed); 'stats' is
// left unmapped since nothing in the UI links to it anymore (falls back to
// "/admin" like an unrecognized tab would).
export const ADMIN_TAB_PATHS: Partial<Record<AdminTab, string>> = {
  proposals: '/admin',
  'comp-proposals': '/comp-files',
  applications: '/applications',
  reports: '/reports',
  users: '/users',
  channels: '/channels',
  eras: '/eras',
  security: '/security',
}

// Reverse of the above, for turning a URL back into a tab on load/back-forward.
export const ADMIN_PATH_TABS: Partial<Record<string, AdminTab>> = Object.fromEntries(
  Object.entries(ADMIN_TAB_PATHS).map(([tab, path]) => [path, tab as AdminTab]),
)

export interface AdminNavItem {
  id: AdminTab
  label: string
  iconKey: 'proposals' | 'comp-proposals' | 'applications' | 'reports' | 'users' | 'stats' | 'channels' | 'eras' | 'security'
  badge?: number
}

export interface UseAdminQueueOptions {
  /** Overall gate for load() - desktop: isFullAdmin || isManager. mobile: isAdmin only. */
  canLoad: boolean
  isFullAdmin: boolean
  /** Desktop gates applications/reports/users/stats fetches on `isFullAdmin &&`
   *  (managers can reach the proposals tab, but not those). Mobile has no such
   *  gate in the body - canLoad already restricted the whole function to
   *  full admins, so pass false here to fetch unconditionally once inside. */
  gateNonProposalTabs: boolean
  activeChannel: string
  initialTab: AdminTab
  /** Mobile-only: forces the tab to a fixed value while `when` is true (handles
   *  account loading in after mount and flipping managerOnly from false to
   *  true). Omit on desktop, which has no equivalent re-forcing effect. */
  forceTab?: { when: boolean; tab: AdminTab }
  /** Tab ids visible to a non-full-admin (manager) in the nav, filtered out of
   *  fullNav. Desktop: ['proposals', 'comp-proposals']. Mobile: ['comp-proposals']. */
  managerNavIds: AdminTab[]
}

export function useAdminQueue(opts: UseAdminQueueOptions) {
  const { canLoad, isFullAdmin, gateNonProposalTabs, activeChannel, initialTab, forceTab, managerNavIds } = opts

  const [tab, setTab] = useState<AdminTab>(initialTab)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-tab, not a single shared counter: bumping it only invalidates the tab
  // that was actually asked to refresh, so pressing refresh on Reports doesn't
  // also force Users (already loaded, filters unchanged) to refetch the next
  // time it's visited.
  const [refreshKeys, setRefreshKeys] = useState<Partial<Record<AdminTab, number>>>({})
  const [applications, setApplications] = useState<EditorApplication[]>([])
  const [propStatus, setPropStatus] = useState<ProposalStatus | ''>('pending')
  const [proposals, setProposals] = useState<SongEditProposal[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [reportStatus, setReportStatus] = useState<SongReportStatus | ''>('pending')
  const [reports, setReports] = useState<SongReportRow[]>([])

  // Only 'proposals' and 'stats' actually query by channel. activeChannel is
  // corrected asynchronously right after mount (it starts from a possibly
  // stale localStorage value until loadChannels() confirms/fixes it), which
  // would otherwise re-run `load` - and refetch tabs like 'users' a second
  // time - for a value change those tabs never used in the first place.
  // Collapsing it to a channel-independent constant for every other tab
  // keeps `load`'s identity stable across that correction.
  const channelDep = (tab === 'proposals' || tab === 'stats') ? activeChannel : ''

  // Identifies "the data this tab should currently be showing" - the status
  // filter it queries by, the channel (only for the two tabs that are
  // channel-scoped), and its own refresh counter. As long as a tab's sig is
  // unchanged from the last time it actually fetched, switching to it (via
  // the nav tab row, a deep link, browser back/forward, etc.) reuses what's
  // already in state instead of refetching - that's what stopped e.g. Users
  // from re-querying every single time it was reselected. A tab's sig only
  // changes when something that should genuinely invalidate its data changes
  // (its own filter, its channel, or its own refresh button), never merely
  // because some other tab became active in between.
  const tabRefreshKey = refreshKeys[tab] ?? 0
  // Only the params the active tab's own query actually reads - e.g. Reports
  // switching status filters must not also mark Users' already-cached sig
  // stale, and vice versa.
  const sig = tab === 'proposals' ? `${propStatus}|${channelDep}|${tabRefreshKey}`
    : tab === 'reports' ? `${reportStatus}|${tabRefreshKey}`
    : tab === 'stats' ? `${channelDep}|${tabRefreshKey}`
    : `${tabRefreshKey}`
  const loadedSigRef = useRef<Partial<Record<AdminTab, string>>>({})

  const load = useCallback(async () => {
    if (!canLoad) return
    setLoading(true); setError(null)
    try {
      if (tab === 'proposals') {
        setProposals(await userApi.adminListProposals(propStatus || undefined, activeChannel))
      } else if ((!gateNonProposalTabs || isFullAdmin) && tab === 'applications') {
        setApplications(await userApi.adminListApplications())
      } else if ((!gateNonProposalTabs || isFullAdmin) && tab === 'reports') {
        setReports(await reportsApi.listSongReports(reportStatus || undefined))
      } else if ((!gateNonProposalTabs || isFullAdmin) && (tab === 'users' || tab === 'stats')) {
        setUsers(await userApi.adminListUsers())
        if (tab === 'stats') {
          setApplications(await userApi.adminListApplications())
          setProposals(await userApi.adminListProposals(undefined, activeChannel))
        }
      }
    } catch (e) {
      setError(errorMessage(e, 'Failed to load'))
      // Don't leave the previous channel's/tab's data on screen underneath the
      // error - it's stale and its action buttons (approve/reject etc.) would
      // still be live against the wrong channel context.
      if (tab === 'proposals') setProposals([])
      else if (tab === 'applications') setApplications([])
      else if (tab === 'reports') setReports([])
      else if (tab === 'users' || tab === 'stats') setUsers([])
    }
    finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channelDep stands in for activeChannel; see comment above
  }, [tab, canLoad, isFullAdmin, gateNonProposalTabs, propStatus, reportStatus, channelDep])

  useStrictModeSafeEffect(() => {
    if (!canLoad) return
    if (loadedSigRef.current[tab] === sig) return
    loadedSigRef.current[tab] = sig
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig already encodes every input `load` reads for the active tab (see comment above); `load` itself would fire this on every render otherwise.
  }, [tab, sig, canLoad])

  // Mobile-only re-forcing effect: account can still be loading when the page
  // first mounts (deep link, page refresh) - managerOnly flips from false to
  // true once it lands, and the tab set at mount time would otherwise strand
  // a manager on a tab their nav bar no longer offers a button for.
  useEffect(() => {
    if (forceTab?.when && tab !== forceTab.tab) setTab(forceTab.tab)
  }, [forceTab?.when, forceTab?.tab, tab])

  const pendingApps    = applications.filter(a => a.status === 'pending').length
  const pendingProps   = tab !== 'proposals' ? proposals.filter(p => p.status === 'pending').length : 0
  const pendingReports = tab !== 'reports' ? reports.filter(r => r.status === 'pending').length : 0

  const fullNav: AdminNavItem[] = [
    { id: 'proposals',    label: 'Song edits',   iconKey: 'proposals',   badge: pendingProps || undefined },
    ...(CONTRIBUTOR_ENABLED ? [{ id: 'comp-proposals' as const, label: 'Comp files', iconKey: 'comp-proposals' as const }] : []),
    { id: 'applications', label: 'Applications', iconKey: 'applications', badge: pendingApps || undefined },
    { id: 'reports',      label: 'Reports',      iconKey: 'reports',      badge: pendingReports || undefined },
    { id: 'users',        label: 'Users',        iconKey: 'users' },
    { id: 'stats',        label: 'Stats',        iconKey: 'stats' },
    { id: 'channels',     label: 'Channels',     iconKey: 'channels' },
    { id: 'eras',         label: 'Eras',         iconKey: 'eras' },
    { id: 'security',     label: 'Security',     iconKey: 'security' },
  ]
  const nav = isFullAdmin ? fullNav : fullNav.filter(n => managerNavIds.includes(n.id))

  return {
    tab, setTab,
    loading,
    error,
    // Scoped to whichever tab is active when called - see the sig comment above.
    refresh: () => setRefreshKeys(k => ({ ...k, [tab]: (k[tab] ?? 0) + 1 })),
    applications, setApplications,
    propStatus, setPropStatus,
    proposals, setProposals,
    users, setUsers,
    reportStatus, setReportStatus,
    reports, setReports,
    pendingApps, pendingProps, pendingReports,
    fullNav, nav,
  }
}
