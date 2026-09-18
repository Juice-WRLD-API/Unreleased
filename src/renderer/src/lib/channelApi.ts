import { JWAPI_BASE } from './juicewrldApi'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'

const ACCOUNT_BASE = `${JWAPI_BASE}/accounts`

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

function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, options, getToken())
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
