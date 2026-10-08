// Shared metric computation for AdminPage's StatsTab (desktop + mobile) -
// the grid layout differs, the numbers don't.
import type { EditorApplication, SongEditProposal, AdminUser } from '../lib/userApi'

export function useAdminStats(applications: EditorApplication[], proposals: SongEditProposal[], users: AdminUser[]): {
  approved: number
  reviewed: number
  approvalPct: number
  editors: AdminUser[]
  managers: AdminUser[]
  topEditors: AdminUser[]
  pendingProposals: number
  pendingApplications: number
  applicants: number
} {
  const approved = proposals.filter(p => p.status === 'approved').length
  const reviewed = proposals.filter(p => p.status !== 'pending').length
  const approvalPct = reviewed > 0 ? Math.round(approved / reviewed * 100) : 0
  const editors = users.filter(u => u.role === 'editor')
  const managers = users.filter(u => !!u.manager_enabled)
  const topEditors = [...editors].sort((a, b) => b.approved_count - a.approved_count).slice(0, 8)

  return {
    approved, reviewed, approvalPct, editors, managers, topEditors,
    pendingProposals: proposals.filter(p => p.status === 'pending').length,
    pendingApplications: applications.filter(a => a.status === 'pending').length,
    applicants: users.filter(u => u.role === 'applicant').length,
  }
}
