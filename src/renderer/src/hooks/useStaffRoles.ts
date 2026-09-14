import { isPrimaryChannelSlug } from './useChannelRoles'
import { isChannelContributor, isChannelEditor, isChannelManager } from '../lib/userApi'
import type { AccountUser } from '../lib/userApi'
import type { JWApiChannel } from '../lib/juicewrldApi'

export interface StaffRoles {
  isPrimary: boolean
  isContributor: boolean
  isEditor: boolean
  isManager: boolean
  isAdmin: boolean
  canReviewReports: boolean
  canReviewStaff: boolean
}

// Wraps userApi's per-channel role helpers so the same
// isPrimaryChannelSlug + isChannelContributor/Manager + canReviewReports/
// canReviewStaff pattern isn't hand-rolled in EditorProfileView.desktop.tsx,
// EditorProfileView.mobile.tsx, and AdminPage.desktop.tsx/.mobile.tsx.
//
// canReviewReports intentionally reads the raw account flags (not scoped to
// activeChannel) - it mirrors EditorProfileView's original
// `!!(account?.is_editor || account?.is_administrator)`, which was never
// channel-scoped to begin with. Don't "fix" that here; it's a preserved
// behavior, not an oversight.
export function useStaffRoles(
  account: AccountUser | null,
  activeChannel: string | null | undefined,
  channels: JWApiChannel[],
): StaffRoles {
  const isPrimary = isPrimaryChannelSlug(channels, activeChannel)
  const isContributor = isChannelContributor(account, activeChannel, isPrimary)
  const isEditor = isChannelEditor(account, activeChannel, isPrimary)
  const isManager = isChannelManager(account, activeChannel, isPrimary)
  const isAdmin = !!account?.is_administrator
  const canReviewReports = !!(account?.is_editor || account?.is_administrator)
  const canReviewStaff = isAdmin || isManager

  return { isPrimary, isContributor, isEditor, isManager, isAdmin, canReviewReports, canReviewStaff }
}
