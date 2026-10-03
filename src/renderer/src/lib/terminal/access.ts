import { hasChatAccess } from '../chatAccess'
import { CHAT_COMMANDS, type ChatCommandInfo } from '../chatCommands'
import { useStore } from '../../store/useStore'
import type { TermCommand } from './types'

// Anyone can open the terminal. What it offers depends on the account: the
// Admin group is for platform administrators, and anything that acts on chat
// (rooms, DMs, the chat slash commands) needs chat, which only staff have.
// Hiding a command here is about not offering it - the API still refuses
// whatever an account isn't allowed to do.
export interface TermAccess { admin: boolean; chat: boolean }

export function termAccess(): TermAccess {
  const account = useStore.getState().account
  return { admin: !!account?.is_administrator, chat: hasChatAccess(account) }
}

export const canRun = (command: TermCommand, a: TermAccess = termAccess()): boolean =>
  (command.group !== 'Admin' || a.admin) && (!command.chat || a.chat)

// Chat commands that moderate rather than chat. The terminal is an admin tool,
// so only platform administrators are offered them (server moderators still
// have them in the chat itself); in help they read as Admin instead of sitting
// among `song`, `theme` and `np`.
const MODERATION_CHAT = new Set(['demote', 'role', 'allow', 'disallow', 'siteban', 'sitemute', 'siteunban', 'broadcast', 'promote', 'kick', 'ban', 'unban', 'bans', 'timeout', 'untimeout', 'purge'])

/** The chat slash commands this account can run from the terminal. */
export function chatCommandsFor(a: TermAccess = termAccess()): ChatCommandInfo[] {
  if (!a.chat) return []
  return a.admin ? CHAT_COMMANDS : CHAT_COMMANDS.filter((c) => !MODERATION_CHAT.has(c.name))
}

/** The name on the prompt - the same one chat uses. */
export function termUserName(): string {
  const account = useStore.getState().account
  return account ? account.discord_username || account.username || account.display_name || 'user' : 'guest'
}

/** The chat commands that are just chat (help's Chat row). */
export const plainChatCommandsFor = (a: TermAccess = termAccess()): ChatCommandInfo[] =>
  chatCommandsFor(a).filter((c) => !MODERATION_CHAT.has(c.name))

/** The moderation / admin chat commands this account can run. */
export const moderationChatCommandsFor = (a: TermAccess = termAccess()): ChatCommandInfo[] =>
  chatCommandsFor(a).filter((c) => MODERATION_CHAT.has(c.name))
