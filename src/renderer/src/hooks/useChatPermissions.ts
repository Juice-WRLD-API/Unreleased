import { CHAT_PERMISSIONS, hasPermission } from '../lib/chatApi'
import { useChatStore } from '../store/chatStore'

export interface ChatPermissions {
  bitmask: number
  has: (bit: number) => boolean
  isAdministrator: boolean
  canManageServer: boolean
  canManageRoles: boolean
  canManageChannels: boolean
  canManageMessages: boolean
  canKickMembers: boolean
  canBanMembers: boolean
}

// Resolves a server's my_permissions bitmask (from ChatServer, already
// server-side resolved per docs/content.tsx's Permission Resolution steps
// 1-4) into named booleans, mirroring useStaffRoles.ts's shape for the
// platform-wide staff roles. Channel-level overrides aren't folded in here -
// none of the current UI needs anything finer than server-level gating yet.
export function useChatPermissions(serverId: number | null | undefined): ChatPermissions {
  const bitmask = useChatStore((s) => (serverId != null ? s.servers.find((x) => x.id === serverId)?.my_permissions : undefined)) ?? 0
  const has = (bit: number): boolean => hasPermission(bitmask, bit)
  return {
    bitmask,
    has,
    isAdministrator: (bitmask & CHAT_PERMISSIONS.administrator) !== 0,
    canManageServer: has(CHAT_PERMISSIONS.manage_server),
    canManageRoles: has(CHAT_PERMISSIONS.manage_roles),
    canManageChannels: has(CHAT_PERMISSIONS.manage_channels),
    canManageMessages: has(CHAT_PERMISSIONS.manage_messages),
    canKickMembers: has(CHAT_PERMISSIONS.kick_members),
    canBanMembers: has(CHAT_PERMISSIONS.ban_members),
  }
}
