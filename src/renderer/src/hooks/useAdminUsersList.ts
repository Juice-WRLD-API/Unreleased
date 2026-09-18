// Shared filter/search/mutation logic for AdminPage's UsersTab (desktop +
// mobile). Desktop shows a master/detail split, mobile an accordion - which
// row is "selected" differs by shape, so that state stays in each view.
import { useMemo, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { AdminUser } from '../lib/userApi'
import { buildHaystack, matchesHaystack } from '../components/adminShared'

export type UsersFilter = 'all' | 'admins' | 'editors' | 'contributors' | 'managers' | 'applicants'

export function useAdminUsersList(users: AdminUser[], currentUserId: number | undefined, onChanged: () => void): {
  actionId: number | null
  filter: UsersFilter
  setFilter: (f: UsersFilter) => void
  search: string
  setSearch: (v: string) => void
  filters: { id: UsersFilter; label: string; count: number }[]
  visible: AdminUser[]
  doUpdate: (uid: number, payload: Parameters<typeof userApi.adminUpdateUser>[1]) => Promise<void>
  canAct: (u: AdminUser) => boolean
} {
  const [actionId, setActionId] = useState<number | null>(null)
  const [filter, setFilter] = useState<UsersFilter>('all')
  const [search, setSearch] = useState('')

  const doUpdate = async (uid: number, payload: Parameters<typeof userApi.adminUpdateUser>[1]): Promise<void> => {
    setActionId(uid)
    try { await userApi.adminUpdateUser(uid, payload); onChanged() }
    catch {} finally { setActionId(null) }
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

  return { actionId, filter, setFilter, search, setSearch, filters, visible, doUpdate, canAct }
}
