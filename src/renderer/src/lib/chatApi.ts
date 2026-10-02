import { CHAT_API_BASE } from './apiServers'
import { apiRequest, authedRequest, authHeaders } from './apiClient'
import { getToken } from './userApi'

export const CHAT_BASE = `${CHAT_API_BASE}/chat`
export const CHAT_CHUNK_THRESHOLD = 25 * 1024 * 1024
// Matches the server's CHAT_CHUNK_UPLOAD_MAX_SIZE.
export const MAX_CHAT_UPLOAD_BYTES = 1024 * 1024 * 1024

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
  // ISO-8601 while the member is timed out, null otherwise. The server lets
  // them post again the moment it passes - no call is needed to clear it.
  timeout_until: string | null
  joined_at: string
}

export const isTimedOut = (member: Pick<ChatMember, 'timeout_until'>): boolean =>
  !!member.timeout_until && new Date(member.timeout_until).getTime() > Date.now()

export interface ServerBan {
  id: number
  server: number
  user: ChatUserBrief
  reason: string
  banned_by: ChatUserBrief | null
  created_at: string
}

export type SiteModerationAction = 'ban' | 'mute' | 'timeout'

export interface SiteModeration {
  id: number
  user: ChatUserBrief
  action: SiteModerationAction
  reason: string
  moderator: ChatUserBrief | null
  expires_at: string | null
  is_active: boolean
  created_at: string
}

// Server timeouts cap at 28 days, site-wide ones at a year (both in minutes) -
// the API rejects anything outside these with a 400 naming the same numbers.
export const MAX_SERVER_TIMEOUT_MINUTES = 40320
export const MAX_SITE_TIMEOUT_MINUTES = 525600

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

// What the server puts in a message's `card`. Songs travel as ids and are looked
// up for display, so a card never carries a title someone could have chosen.
export type ServerCard =
  | { kind: 'help' }
  | { kind: 'npNow'; user: ChatUserBrief; song: number; updated_at: string }
  | { kind: 'npHistory'; user: ChatUserBrief | null; items: { song: number; played_at: string }[]; total: number; capped: boolean }
  | { kind: 'broadcastHistory'; items: { id: number; title: string; message: string; level: string; sender: string; sent_at: string }[]; total: number }
  | { kind: 'themeList' }
  | { kind: 'changelog'; branch: string; commits: { sha: string; message: string; author: string; date: string; url: string }[] }
  | { kind: 'result'; title: string; text: string }

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
  // E2E v2 (format 2): see lib/chatE2E. Absent on older servers.
  format?: number
  client_id?: string
  sender_device?: string
  edit_seq?: number
  signature?: string
  // Server-built command card (see createChannelCard); null on ordinary
  // messages, absent on older servers. The only place a card is read from -
  // never from `content`.
  card?: ServerCard | null
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
  sign_pub?: string
  format?: number
  algorithm: string
  label: string
  // The server sends a user brief here; older code treated it as an id.
  owner: number | ChatUserBrief
  created_at?: string
}

export const deviceOwnerId = (d: ChatDevice): number => (typeof d.owner === 'number' ? d.owner : d.owner.id)

export interface Envelope {
  id?: number
  recipient_device: number
  recipient_device_id?: string
  key_version: number
  encrypted_key: string
  format?: number
  sender_device?: string
  sender_device_id?: string | null
  signature?: string
  created_by?: number
}

export interface ListDeviceEntry {
  device_id: string
  enc_pub: string
  sign_pub: string
}

export interface ServerDeviceRow {
  id: number
  device_id: string
  public_key: string
  sign_pub: string
  format: number
  revoked: boolean
}

export interface UserKeysInfo {
  user_id: number
  msk_pub: string
  list_version: number
  devices: ListDeviceEntry[]
  list_sig: string
  server_devices: ServerDeviceRow[]
  backup_pub?: string
  backup_sig?: string
}

export interface KeyCommitmentInfo {
  conversation: number
  key_version: number
  key_commitment: string
  creator_user: number
  creator_device: string
  commit_sig: string
  created_at: string
}

export interface ConversationKeys {
  current_key_version: number
  results: ChatDevice[]
  key_version?: number
  commitment?: KeyCommitmentInfo | null
  message_count?: number
  members?: { user_id: number; list_version: number }[]
}

export interface E2EFeatures {
  send: boolean
  identity: boolean
  linking: boolean
  backup: boolean
}

export interface ToDeviceOut {
  recipient_device: number
  type: string
  payload: string
  signature: string
}

export interface ToDeviceIn extends Omit<ToDeviceOut, 'recipient_device'> {
  id: number
  sender_device: string
  sender_user: number
  created_at: string
}

export interface LinkSessionInfo {
  session_id: string
  device_id: string
  enc_pub: string
  sign_pub: string
  label: string
  expires_at: string
  claimed: boolean
  // The existing device that signed this one in; null until claimed.
  claimed_by: { device_id: string; sign_pub: string } | null
}

export interface BackupEntryIn {
  id: number
  conversation: number
  key_version: number
  sealed: string
}

export interface V2MessageFields {
  format: 2
  client_id: string
  sender_device: string
  edit_seq: number
  signature: string
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
  return authedRequest<T>(`${CHAT_BASE}${path}`, options, getToken())
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

// For the v2 compare-and-set endpoints, where a 409 is an expected answer
// whose body the caller needs (the winning commitment, the current version).
export interface Outcome<T> { ok: boolean; status: number; data: T }

async function requestOutcome<T>(path: string, init: RequestInit = {}, headers: Record<string, string> = {}): Promise<Outcome<T>> {
  const res = await fetch(`${CHAT_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()), ...headers },
  })
  let data: unknown = null
  try { data = await res.json() } catch {}
  if (!res.ok && res.status !== 409) {
    const detail = (data as { detail?: string } | null)?.detail
    throw Object.assign(new Error(detail || `Request failed (${res.status})`), { status: res.status })
  }
  return { ok: res.ok, status: res.status, data: data as T }
}

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
// is_public is only honoured for platform admins (same rule as the PATCH), and
// older deployments ignore it on create entirely - createServerWithVisibility
// in Modals.tsx falls back to a follow-up PATCH when that happens.
export const createServer = (body: { name: string; description?: string; icon?: string; is_public?: boolean }) =>
  request<ChatServer>('/servers/', json('POST', body))
export const updateServer = (id: number, body: { name?: string; description?: string; icon?: string; is_public?: boolean }) =>
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

// Moderation. Mute is the `muted` flag on updateMember above; the rest live
// here. Timeout/kick need kick_members (or manage_server), bans need
// ban_members (or manage_server) - see useChatPermissions.
export const timeoutMember = (serverId: number, userId: number, minutes: number) =>
  request<ChatMember>(`/servers/${serverId}/members/${userId}/timeout/`, json('POST', { duration: minutes }))
export const clearMemberTimeout = (serverId: number, userId: number) =>
  request<void>(`/servers/${serverId}/members/${userId}/timeout/`, json('DELETE'))

export const listBans = (serverId: number) =>
  request<Results<ServerBan>>(`/servers/${serverId}/bans/`).then((r) => r.results)
export const banUser = (serverId: number, userId: number, reason?: string) =>
  request<ServerBan>(`/servers/${serverId}/bans/`, json('POST', { user_id: userId, ...(reason ? { reason } : {}) }))
export const unbanUser = (serverId: number, userId: number) =>
  request<void>(`/servers/${serverId}/bans/${userId}/`, json('DELETE'))

// Site-wide moderation - platform administrators only, applies across every
// server and DM. `active=true` filters out revoked/expired records.
export const listSiteModeration = (opts: { activeOnly?: boolean } = {}) =>
  request<Results<SiteModeration>>(`/site-moderation/${opts.activeOnly ? '?active=true' : ''}`).then((r) => r.results)
export const applySiteModeration = (body: {
  user_id: number
  action: SiteModerationAction
  reason?: string
  duration?: number
}) => request<SiteModeration>('/site-moderation/', json('POST', body))
export const revokeSiteModeration = (id: number) =>
  request<void>(`/site-moderation/${id}/`, json('DELETE'))

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

// Posts a command's answer to a channel as a card. The client only names the
// command; the server builds the card from its own data and the poster's
// standing, which is what makes a card something no one can forge with text.
export type CardCommand =
  | { name: 'help' }
  | { name: 'np'; user_id?: number }
  | { name: 'np_history'; user_id?: number; count?: number }
  | { name: 'broadcast_history'; count?: number }
  | { name: 'theme_list' }
  | { name: 'changelog'; branch: string; count?: number }
  | { name: 'result'; title: string; text: string }
export const createChannelCard = (id: number, command: CardCommand) =>
  request<ChatMessage>(`/channels/${id}/messages/`, json('POST', { command }))
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
} & Partial<V2MessageFields>) => request<ChatMessage>(`/dms/${id}/messages/`, json('POST', body))
export const markDmRead = (id: number, messageId?: number) =>
  request<void>(`/dms/${id}/read/`, json('POST', messageId ? { message_id: messageId } : {}))

// Message actions
export const getMessage = (id: number) => request<ChatMessage>(`/messages/${id}/`)
export const editMessage = (id: number, body: { content: string } | ({ ciphertext: string; nonce: string; key_version: number; mentions?: number[] } & Partial<V2MessageFields>)) =>
  request<ChatMessage>(`/messages/${id}/`, json('PATCH', body))
/** `purge` hard-deletes the row (no "deleted" placeholder in history) instead of soft-deleting it. */
export const deleteMessage = (id: number, purge = false) => request<void>(`/messages/${id}/${purge ? '?purge=1' : ''}`, json('DELETE'))
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
export const registerDevice = (body: { device_id: string; public_key: string; sign_pub?: string; algorithm: 'x25519'; label: string }) =>
  request<ChatDevice>('/keys/devices/', json('POST', body))
export const revokeDevice = (deviceId: string) =>
  request<void>(`/keys/devices/${encodeURIComponent(deviceId)}/`, json('DELETE'))
export const listConversationDevices = (id: number, keyVersion?: number) =>
  request<ConversationKeys>(`/dms/${id}/keys/${keyVersion ? `?key_version=${keyVersion}` : ''}`)
export const postEnvelopes = (id: number, envelopes: Envelope[]) =>
  request<unknown>(`/dms/${id}/envelopes/`, json('POST', { envelopes }))
export const listEnvelopes = (id: number, keyVersion?: number) =>
  request<Results<Envelope>>(`/dms/${id}/envelopes/${keyVersion ? `?key_version=${keyVersion}` : ''}`)
    .then((r) => r.results)

// E2E v2 keys. The server stores and orders these; it never checks a
// signature - lib/chatIdentity and lib/chatE2E do.
export const getE2EFeatures = () => request<E2EFeatures>('/keys/features/')
export const getUserKeys = (userId: number) => request<UserKeysInfo>(`/keys/users/${userId}/`)
export const getUsersKeys = (ids: number[]) =>
  request<Results<UserKeysInfo>>(`/keys/users/?ids=${ids.join(',')}`).then((r) => r.results)
export const putIdentity = (body: { msk_pub: string; reset?: boolean }, deviceId?: string) =>
  requestOutcome<UserKeysInfo & { detail?: string }>('/keys/identity/', json('PUT', body), deviceId ? { 'X-Device-Id': deviceId } : {})
// deviceId: the publishing device, which the server records as the claimer
// of any link session the new list completes.
export const putDeviceList = (body: { list_version: number; devices: ListDeviceEntry[]; list_sig: string }, deviceId?: string) =>
  requestOutcome<UserKeysInfo & { detail?: string }>('/keys/devices/list/', json('PUT', body), deviceId ? { 'X-Device-Id': deviceId } : {})
export const establishKey = (id: number, body: { key_version: number; key_commitment: string; creator_device: string; commit_sig: string }) =>
  requestOutcome<KeyCommitmentInfo & { commitment?: KeyCommitmentInfo; current_key_version?: number }>(`/dms/${id}/keys/establish/`, json('POST', body))
export const rotateKey = (id: number, expectedVersion: number) =>
  requestOutcome<{ current_key_version: number }>(`/dms/${id}/keys/rotate/`, json('POST', { expected_version: expectedVersion }))
export const createLinkSession = (body: { device_id: string; enc_pub: string; sign_pub: string; label: string }) =>
  request<{ session_id: string; expires_at: string }>('/keys/link-sessions/', json('POST', body))
export const getLinkSession = (sessionId: string) =>
  request<LinkSessionInfo>(`/keys/link-sessions/${encodeURIComponent(sessionId)}/`)
export const sendToDevice = (deviceId: string, messages: ToDeviceOut[]) =>
  request<{ sent: number }>('/keys/to-device/', { ...json('POST', { messages }), headers: { 'X-Device-Id': deviceId } })
export const fetchToDevice = (deviceId: string) =>
  request<Results<ToDeviceIn>>('/keys/to-device/', { headers: { 'X-Device-Id': deviceId } }).then((r) => r.results)
export const ackToDevice = (ids: number[]) => request<{ deleted: number }>('/keys/to-device/ack/', json('POST', { ids }))
export const getBackup = () => requestOutcome<{ backup_pub: string; backup_sig: string; sealed_msk: string }>('/keys/backup/')
  .then((o) => o.data)
  .catch((err: { status?: number }) => { if (err.status === 404) return null; throw err })
export const putBackup = (body: {
  backup_pub: string
  backup_sig: string
  sealed_msk: string
  expected_backup_pub?: string
  entries?: { conversation: number; key_version: number; sealed: string }[]
}) => requestOutcome<{ backup_pub: string; detail?: string }>('/keys/backup/', json('PUT', body))
export const postBackupEntries = (backupPub: string, entries: { conversation: number; key_version: number; sealed: string }[]) =>
  requestOutcome<{ accepted?: number; detail?: string }>('/keys/backup/entries/', json('POST', { backup_pub: backupPub, entries }))
export const listBackupEntries = (after?: number) =>
  request<{ results: BackupEntryIn[]; next: number | null }>(`/keys/backup/entries/${after ? `?after=${after}` : ''}`)

// Uploads
// Files up to the threshold go in one request; anything larger is sent as
// chunks, each retried on its own so a flaky connection doesn't restart it.
export async function uploadChatFile(file: Blob, name: string): Promise<UploadedFile> {
  if (file.size > MAX_CHAT_UPLOAD_BYTES) {
    throw new Error(`"${name}" is larger than ${MAX_CHAT_UPLOAD_BYTES / (1024 * 1024)} MB`)
  }
  if (file.size > CHAT_CHUNK_THRESHOLD) return uploadChatFileChunked(file, name)
  const form = new FormData()
  form.append('file', file, name)
  return apiRequest<UploadedFile>(`${CHAT_BASE}/uploads/`, {
    method: 'POST',
    headers: authHeaders(getToken()),
    body: form,
  })
}

const CHUNK_RETRIES = 3

async function withChunkRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      // A thrown Error from apiRequest is an HTTP rejection (bad chunk, expired
      // upload) and won't improve on retry; only a network-level TypeError will.
      if (!(err instanceof TypeError) || attempt >= CHUNK_RETRIES) throw err
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
    }
  }
}

export async function uploadChatFileChunked(file: Blob, name: string): Promise<UploadedFile> {
  const init = await withChunkRetry(() => apiRequest<{ upload_id: string; chunk_size: number; total_chunks: number }>(
    `${CHAT_BASE}/uploads/chunked/init/`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
      body: JSON.stringify({ filename: name, total_size: file.size, mime: file.type }) },
  ))
  const chunkSize = init.chunk_size
  for (let i = 0; i < init.total_chunks; i++) {
    await withChunkRetry(() => {
      const form = new FormData()
      form.append('upload_id', init.upload_id)
      form.append('chunk_index', String(i))
      form.append('chunk', file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize)), `${name}.part.${i}`)
      return apiRequest(`${CHAT_BASE}/uploads/chunked/chunk/`, {
        method: 'POST', headers: authHeaders(getToken()), body: form,
      })
    })
  }
  return withChunkRetry(() => apiRequest<UploadedFile>(`${CHAT_BASE}/uploads/chunked/complete/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ upload_id: init.upload_id }),
  }))
}

export function chatAttachmentUrl(id: number, opts: { download?: boolean } = {}): string {
  const qs = new URLSearchParams()
  const token = getToken()
  if (token) qs.set('token', token)
  if (opts.download) qs.set('download', '1')
  return `${CHAT_BASE}/attachments/${id}/stream/?${qs.toString()}`
}

export async function fetchAttachmentBytes(id: number): Promise<Uint8Array> {
  const res = await fetch(`${CHAT_BASE}/attachments/${id}/stream/`, {
    headers: authHeaders(getToken()),
  })
  if (!res.ok) throw new Error(`Attachment failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
