import type { AccountUser } from './userApi'

// Lives apart from store/chatStore so the nav, Home and the context menus can
// gate their chat entry points without importing the chat client itself -
// that store (plus its API, socket and share codecs) only loads for staff.
export function hasChatAccess(account: AccountUser | null): boolean {
  if (!account) return false
  const su = (account as AccountUser & { is_superuser?: boolean }).is_superuser
  return !!(account.is_administrator || account.is_manager || su)
}
