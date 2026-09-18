import { JWAPI_BASE } from './juicewrldApi'
import { apiRequest } from './apiClient'
import { getToken } from './userApi'

export const CHAT_BASE = `${JWAPI_BASE}/chat`
export const MAX_CHAT_UPLOAD_BYTES = 25 * 1024 * 1024

export type StaffRole = 'administrator' | 'manager' | string

export interface ChatUserBrief {
  id: number
  username: string
  display_name: string
  avatar: string
  role: StaffRole
}

export interface ChatChannel {
  id: number
  server: number
  name: string
  slug: string
  topic: string
  category: string
  position: number
  is_private: boolean
  allowed_members?: number[]
  created_at: string
}

export type ServerRole = 'owner' | 'admin' | 'member'

// Bitmask permission constants for the roles/permissions system. Mirrors
// GET /permissions/, the canonical source of truth - this const exists so
// callers don't need a round trip just to reference e.g. manage_roles.
export const CHAT_PERMISSIONS = {
  view_channels: 1,
  send_messages: 2,
  manage_messages: 4,
  manage_channels: 8,
  manage_server: 16,
  manage_roles: 32,
  kick_members: 64,
  ban_members: 128,
  mention_everyone: 256,
  attach_files: 512,
  add_reactions: 1024,
  manage_threads: 2048,
  administrator: 4096,
} as const

export type ChatPermissionName = keyof typeof CHAT_PERMISSIONS

export const hasPermission = (mask: number, bit: number): boolean =>
  (mask & CHAT_PERMISSIONS.administrator) !== 0 || (mask & bit) !== 0

// A named, colored role with a permission bitmask - distinct from the
// ServerRole string union above (owner/admin/member), which is the legacy
// per-member flag kept for backward compatibility.
export interface ServerRoleDef {
  id: number
  server: number
  name: string
  color: string
  position: number
  permissions: number
  permission_names: ChatPermissionName[]
  is_default: boolean
  created_at: string
}

export interface MemberRoleRef {
  id: number
  name: string
  color: string
  position: number
}

export interface ChannelOverride {
  id: number
  channel: number
  role: number | null
  member: number | null
  allow: number
  deny: number
}

export interface PublicServerSummary {
  id: number
  name: string
  slug: string
  description: string
  icon_url: string | null
  member_count: number
  is_member: boolean
  created_at: string
}

export interface ChatServer {
  id: number
  name: string
  slug: string
  description: string
  icon_url: string | null
  is_public: boolean
  owner: number
  member_count: number
  my_role: ServerRole
  my_permissions: number
  roles: ServerRoleDef[]
  channels: ChatChannel[]
  created_at: string
}

export interface ChatMember {
  id: number
  user: ChatUserBrief
  server_role: ServerRole
  roles: MemberRoleRef[]
  muted: boolean
  joined_at: string
}

export interface ChatAttachment {
  id: number
  name: string
  url: string
  mime: string
  size: number
  encrypted_name: string
  nonce: string
  key_version: number | null
}

export interface ChatReaction {
  emoji: string
  count: number
  user_ids: number[]
  me: boolean
}

export interface ChatMessage {
  id: number
  channel: number | null
  conversation: number | null
  author: ChatUserBrief
  content: string
  is_encrypted: boolean
  ciphertext: string
  nonce: string
  key_version: number | null
  parent: number | null
  mentions: number[]
  attachments: ChatAttachment[]
  reactions: ChatReaction[]
  reply_count: number
  pinned: boolean
  pinned_by: number | null
  pinned_at: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export interface ConversationParticipant {
  id: number
  user: ChatUserBrief
  muted: boolean
  joined_at: string
}

export interface Conversation {
  id: number
  is_group: boolean
  name: string
  created_by: number
  current_key_version: number
  participants: ConversationParticipant[]
  created_at: string
  updated_at: string
}

export interface ChatDevice {
  id: number
  device_id: string
  public_key: string
  algorithm: string
  label: string
  owner: number
  created_at?: string
}

export interface Envelope {
  id?: number
  recipient_device: number
  key_version: number
  encrypted_key: string
}

export interface UploadedFile {
  name: string
  url: string
  mime: string
  size: number
}

export interface AttachmentInput extends UploadedFile {
  encrypted_name?: string
  nonce?: string
  key_version?: number
}

export interface MessagePage {
  results: ChatMessage[]
  has_more: boolean
}

interface Results<T> { results: T[] }

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(`${CHAT_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  })
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

function pageQuery(opts: { limit?: number; before?: number; after?: number }): string {
  const qs = new URLSearchParams()
  if (opts.limit) qs.set('limit', String(opts.limit))
  if (opts.before) qs.set('before', String(opts.before))
  if (opts.after) qs.set('after', String(opts.after))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// Servers
export const listServers = () => request<Results<ChatServer>>('/servers/').then((r) => r.results)
export const getServer = (id: number) => request<ChatServer>(`/servers/${id}/`)
export const createServer = (body: { name: string; description?: string; icon?: string }) =>
  request<ChatServer>('/servers/', json('POST', body))
export const updateServer = (id: number, body: { name?: string; description?: string; icon?: string }) =>
  request<ChatServer>(`/servers/${id}/`, json('PATCH', body))
export const deleteServer = (id: number) => request<void>(`/servers/${id}/`, json('DELETE'))

export const listMembers = (serverId: number) =>
  request<Results<ChatMember>>(`/servers/${serverId}/members/`).then((r) => r.results)
export const addMember = (serverId: number, userId: number, serverRole: 'admin' | 'member' = 'member') =>
  request<ChatMember>(`/servers/${serverId}/members/`, json('POST', { user_id: userId, server_role: serverRole }))
export const updateMember = (serverId: number, userId: number, body: { server_role?: 'admin' | 'member'; muted?: boolean }) =>
  request<ChatMember>(`/servers/${serverId}/members/${userId}/`, json('PATCH', body))
export const removeMember = (serverId: number, userId: number) =>
  request<void>(`/servers/${serverId}/members/${userId}/`, json('DELETE'))

// Public servers
export const discoverServers = () =>
  request<Results<PublicServerSummary>>('/servers/discover/').then((r) => r.results)
export const joinServer = (id: number) => request<ChatServer>(`/servers/${id}/join/`, json('POST'))
export const leaveServer = (id: number) => request<void>(`/servers/${id}/join/`, json('DELETE'))

// Roles & permissions
export const fetchPermissionMap = () =>
  request<{ permissions: Record<ChatPermissionName, number> }>('/permissions/').then((r) => r.permissions)
export const listRoles = (serverId: number) =>
  request<Results<ServerRoleDef>>(`/servers/${serverId}/roles/`).then((r) => r.results)
export interface RoleInput { name: string; color: string; position: number; permissions: number }
export const createRole = (serverId: number, body: RoleInput) =>
  request<ServerRoleDef>(`/servers/${serverId}/roles/`, json('POST', body))
export const updateRole = (serverId: number, roleId: number, body: Partial<RoleInput>) =>
  request<ServerRoleDef>(`/servers/${serverId}/roles/${roleId}/`, json('PATCH', body))
export const deleteRole = (serverId: number, roleId: number) =>
  request<void>(`/servers/${serverId}/roles/${roleId}/`, json('DELETE'))
export const setMemberRoles = (serverId: number, userId: number, roleIds: number[]) =>
  request<ChatMember>(`/servers/${serverId}/members/${userId}/roles/`, json('PUT', { role_ids: roleIds }))

// Channel permission overrides
export const listOverrides = (channelId: number) =>
  request<Results<ChannelOverride>>(`/channels/${channelId}/overrides/`).then((r) => r.results)
export const upsertOverride = (channelId: number, body: { role?: number; member?: number; allow: number; deny: number }) =>
  request<ChannelOverride>(`/channels/${channelId}/overrides/`, json('PUT', body))
export const deleteOverride = (channelId: number, overrideId: number) =>
  request<void>(`/channels/${channelId}/overrides/${overrideId}/`, json('DELETE'))

// Channels
export interface ChannelInput {
  name: string
  topic?: string
  category?: string
  position?: number
  is_private?: boolean
  allowed_members?: number[]
}
export const createChannel = (serverId: number, body: ChannelInput) =>
  request<ChatChannel>(`/servers/${serverId}/channels/`, json('POST', body))
export const getChannel = (id: number) => request<ChatChannel>(`/channels/${id}/`)
export const updateChannel = (id: number, body: Partial<ChannelInput>) =>
  request<ChatChannel>(`/channels/${id}/`, json('PATCH', body))
export const deleteChannel = (id: number) => request<void>(`/channels/${id}/`, json('DELETE'))

export const listChannelMessages = (id: number, opts: { limit?: number; before?: number; after?: number } = {}) =>
  request<MessagePage>(`/channels/${id}/messages/${pageQuery(opts)}`)
export const createChannelMessage = (id: number, body: {
  content: string
  parent?: number | null
  mentions?: number[]
  attachments?: AttachmentInput[]
}) => request<ChatMessage>(`/channels/${id}/messages/`, json('POST', body))
export const markChannelRead = (id: number, messageId?: number) =>
  request<void>(`/channels/${id}/read/`, json('POST', messageId ? { message_id: messageId } : {}))

// DMs
export const listConversations = () => request<Results<Conversation>>('/dms/').then((r) => r.results)
export const createConversation = (body: { participant_ids: number[]; is_group?: boolean; name?: string }) =>
  request<Conversation>('/dms/', json('POST', body))
export const getConversation = (id: number) => request<Conversation>(`/dms/${id}/`)
export const updateConversation = (id: number, body: {
  name?: string
  add_participant_ids?: number[]
  remove_participant_ids?: number[]
}) => request<Conversation>(`/dms/${id}/`, json('PATCH', body))
export const deleteConversation = (id: number) => request<void>(`/dms/${id}/`, json('DELETE'))

export const listDmMessages = (id: number, opts: { limit?: number; before?: number; after?: number } = {}) =>
  request<MessagePage>(`/dms/${id}/messages/${pageQuery(opts)}`)
export const createDmMessage = (id: number, body: {
  ciphertext?: string
  nonce?: string
  key_version: number
  parent?: number | null
  mentions?: number[]
  attachments?: AttachmentInput[]
}) => request<ChatMessage>(`/dms/${id}/messages/`, json('POST', body))
export const markDmRead = (id: number, messageId?: number) =>
  request<void>(`/dms/${id}/read/`, json('POST', messageId ? { message_id: messageId } : {}))

// Message actions
export const getMessage = (id: number) => request<ChatMessage>(`/messages/${id}/`)
export const editMessage = (id: number, body: { content: string } | { ciphertext: string; nonce: string; key_version: number }) =>
  request<ChatMessage>(`/messages/${id}/`, json('PATCH', body))
export const deleteMessage = (id: number) => request<void>(`/messages/${id}/`, json('DELETE'))
export const pinMessage = (id: number) => request<ChatMessage>(`/messages/${id}/pin/`, json('POST'))
export const unpinMessage = (id: number) => request<ChatMessage>(`/messages/${id}/pin/`, json('DELETE'))
export const addReaction = (id: number, emoji: string) =>
  request<ChatMessage>(`/messages/${id}/reactions/`, json('POST', { emoji }))
export const removeReaction = (id: number, emoji: string) =>
  request<ChatMessage | void>(`/messages/${id}/reactions/?emoji=${encodeURIComponent(emoji)}`, json('DELETE', { emoji }))
export const listThread = (id: number) =>
  request<Results<ChatMessage>>(`/messages/${id}/thread/`).then((r) => r.results)

// Presence
export const getPresence = () => request<{ online: number[] }>('/presence/').then((r) => r.online)

// Keys
export const listMyDevices = () => request<Results<ChatDevice>>('/keys/devices/').then((r) => r.results)
export const registerDevice = (body: { device_id: string; public_key: string; algorithm: 'x25519'; label: string }) =>
  request<ChatDevice>('/keys/devices/', json('POST', body))
export const revokeDevice = (deviceId: string) =>
  request<void>(`/keys/devices/${encodeURIComponent(deviceId)}/`, json('DELETE'))
export const listConversationDevices = (id: number) =>
  request<{ current_key_version: number; results: ChatDevice[] }>(`/dms/${id}/keys/`)
export const postEnvelopes = (id: number, envelopes: Envelope[]) =>
  request<unknown>(`/dms/${id}/envelopes/`, json('POST', { envelopes }))
export const listEnvelopes = (id: number, keyVersion?: number) =>
  request<Results<Envelope>>(`/dms/${id}/envelopes/${keyVersion ? `?key_version=${keyVersion}` : ''}`)
    .then((r) => r.results)

// Uploads
export async function uploadChatFile(file: Blob, name: string): Promise<UploadedFile> {
  if (file.size > MAX_CHAT_UPLOAD_BYTES) {
    throw new Error(`"${name}" is larger than 25 MB`)
  }
  const token = getToken()
  const form = new FormData()
  form.append('file', file, name)
  return apiRequest<UploadedFile>(`${CHAT_BASE}/uploads/`, {
    method: 'POST',
    headers: token ? { Authorization: `Token ${token}` } : undefined,
    body: form,
  })
}

export function chatAttachmentUrl(id: number, opts: { download?: boolean } = {}): string {
  const qs = new URLSearchParams()
  const token = getToken()
  if (token) qs.set('token', token)
  if (opts.download) qs.set('download', '1')
  return `${CHAT_BASE}/attachments/${id}/stream/?${qs.toString()}`
}

export async function fetchAttachmentBytes(id: number): Promise<Uint8Array> {
  const token = getToken()
  const res = await fetch(`${CHAT_BASE}/attachments/${id}/stream/`, {
    headers: token ? { Authorization: `Token ${token}` } : undefined,
  })
  if (!res.ok) throw new Error(`Attachment failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
