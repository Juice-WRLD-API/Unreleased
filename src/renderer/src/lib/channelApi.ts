import { routeUrl } from './juicewrldApi'
import { apiRequest } from './apiClient'
import { getToken } from './userApi'

const ACCOUNT_BASE = routeUrl('/accounts')

export interface Channel {
  id: number
  slug: string
  name: string
  description?: string
  is_primary: boolean
  is_active: boolean
  sort_order: number
}

export interface ChannelMembershipRow {
  id: number
  user_id: number
  username: string
  channel_slug: string
  channel_name: string
  editor_enabled: boolean
  contributor_enabled: boolean
  manager_enabled: boolean
  auto_approve_proposals: boolean
  auto_approve_comp_proposals: boolean
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  return apiRequest<T>(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  })
}

export async function fetchChannelList(): Promise<Channel[]> {
  return request(`${ACCOUNT_BASE}/admin/channels/`, { method: 'GET' })
}

export async function adminCreateChannel(payload: {
  name: string
  slug?: string
  description?: string
  sort_order?: number
}): Promise<Channel> {
  return request(`${ACCOUNT_BASE}/admin/channels/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminUpdateChannel(id: number, payload: {
  name?: string
  description?: string
  sort_order?: number
  is_active?: boolean
}): Promise<Channel> {
  return request(`${ACCOUNT_BASE}/admin/channels/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function adminDeactivateChannel(id: number): Promise<void> {
  await request(`${ACCOUNT_BASE}/admin/channels/${id}/`, { method: 'DELETE' })
}

export async function adminListChannelMembers(id: number): Promise<ChannelMembershipRow[]> {
  return request(`${ACCOUNT_BASE}/admin/channels/${id}/members/`, { method: 'GET' })
}

export async function adminSetChannelMember(id: number, payload: {
  user_id: number
  editor_enabled?: boolean
  contributor_enabled?: boolean
  manager_enabled?: boolean
  auto_approve_proposals?: boolean
  auto_approve_comp_proposals?: boolean
}): Promise<ChannelMembershipRow> {
  return request(`${ACCOUNT_BASE}/admin/channels/${id}/members/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
