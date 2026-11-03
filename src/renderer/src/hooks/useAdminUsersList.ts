// Shared filter/search/mutation logic for AdminPage's UsersTab (desktop +
// mobile). Desktop shows a master/detail split, mobile an accordion - which
// row is "selected" differs by shape, so that state stays in each view.
import { useMemo, useRef, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { AdminUser } from '../lib/userApi'
import { buildHaystack, matchesHaystack } from '../components/adminShared'
import { showAppToast } from '../lib/appToast'
import { errorMessage } from '../lib/format'

export type UsersFilter = 'all' | 'admins' | 'editors' | 'contributors' | 'managers' | 'applicants'

type UserPatch = Parameters<typeof userApi.adminUpdateUser>[1]

// The row fields a patch changes, including the server's knock-on resets (an
// applicant loses auto-approve, a non-contributor loses comp auto-approve).
function patchedFields(payload: UserPatch): Partial<AdminUser> {
  const out: Partial<AdminUser> = { ...payload }
  if (payload.role === 'applicant') out.auto_approve_proposals = false
  if (payload.contributor_enabled === false) out.auto_approve_comp_proposals = false
  return out
}

export function useAdminUsersList(users: AdminUser[], setUsers: React.Dispatch<React.SetStateAction<AdminUser[]>>, currentUserId: number | undefined): {
  filter: UsersFilter
  setFilter: (f: UsersFilter) => void
  search: string
  setSearch: (v: string) => void
  filters: { id: UsersFilter; label: string; count: number }[]
  visible: AdminUser[]
  doUpdate: (uid: number, payload: UserPatch) => Promise<void>
  canAct: (u: AdminUser) => boolean
} {
  const [filter, setFilter] = useState<UsersFilter>('all')
  const [search, setSearch] = useState('')
  // Requests in flight per user, so an earlier response doesn't overwrite a
  // toggle made after it was sent.
  const inFlight = useRef(new Map<number, number>())

  // Optimistic: the switch flips at once and the PATCH runs behind it; the
  // server's row (same shape as the list's) replaces ours once nothing else
  // is pending for that user. On failure only the touched fields roll back.
  const doUpdate = async (uid: number, payload: UserPatch): Promise<void> => {
    const before = users.find(u => u.user_id === uid)
    if (!before) return
    const patch = patchedFields(payload)
    const undo = Object.fromEntries(Object.keys(patch).map(k => [k, before[k as keyof AdminUser]])) as Partial<AdminUser>
    setUsers(list => list.map(u => (u.user_id === uid ? { ...u, ...patch } : u)))
    inFlight.current.set(uid, (inFlight.current.get(uid) ?? 0) + 1)
    try {
      const row = await userApi.adminUpdateUser(uid, payload)
      if (inFlight.current.get(uid) === 1) setUsers(list => list.map(u => (u.user_id === uid ? { ...u, ...row } : u)))
    } catch (e) {
      setUsers(list => list.map(u => (u.user_id === uid ? { ...u, ...undo } : u)))
      showAppToast(errorMessage(e, "Couldn't update the user"))
    } finally {
      const left = (inFlight.current.get(uid) ?? 1) - 1
      if (left > 0) inFlight.current.set(uid, left); else inFlight.current.delete(uid)
    }
  }

  const filters: { id: UsersFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: users.length },
    { id: 'admins', label: 'Admins', count: users.filter(u => u.role === 'administrator').length },
    { id: 'editors', label: 'Editors', count: users.filter(u => u.role === 'editor').length },
    // Contributors cuts across the role buckets rather than being one of them
    // - contributor_enabled is a flag on top of a role, so a contributor is
    // still counted under whichever of Admins/Editors/Applicants they are.
    { id: 'contributors', label: 'Contributors', count: users.filter(u => u.contributor_enabled).length },
    { id: 'managers', label: 'Managers', count: users.filter(u => !!u.manager_enabled).length },
    { id: 'applicants', label: 'Applicants', count: users.filter(u => u.role === 'applicant').length },
  ]

  // One haystack per user, built once per users-array change rather than
  // per keystroke (see buildHaystack's own doc comment) - also widens search
  // to match role/contributor/manager keywords, not just the display name
  // like the old plain substring match did.
  const haystack = useMemo(() => new Map(users.map(u => [u.user_id,
    buildHaystack(u.discord_username, u.username, u.role,
      u.contributor_enabled ? 'contributor' : undefined,
      u.manager_enabled ? 'manager' : undefined),
  ])), [users])

  const visible = useMemo(() => users.filter(u => {
    const ok = filter === 'all'
      ? true
      : filter === 'admins'
        ? u.role === 'administrator'
        : filter === 'editors'
          ? u.role === 'editor'
          : filter === 'contributors'
            ? u.contributor_enabled
            : filter === 'managers'
              ? !!u.manager_enabled
              : u.role === 'applicant'
    return ok && matchesHaystack(search, haystack.get(u.user_id))
  }), [users, filter, search, haystack])

  const canAct = (u: AdminUser): boolean => u.user_id !== currentUserId && u.role !== 'administrator'

  return { filter, setFilter, search, setSearch, filters, visible, doUpdate, canAct }
}
