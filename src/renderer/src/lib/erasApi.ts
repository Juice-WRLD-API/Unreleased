import { JWAPI_BASE } from './juicewrldApi'
import { apiRequest } from './apiClient'
import { getToken } from './userApi'

const ACCOUNT_BASE = `${JWAPI_BASE}/accounts`

export interface Era {
  id: number
  name: string
  description: string
  time_frame: string
  play_count: number
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

export async function fetchEraList(): Promise<Era[]> {
  return request(`${ACCOUNT_BASE}/admin/eras/`, { method: 'GET' })
}

export async function adminCreateEra(payload: {
  name: string
  description?: string
  time_frame?: string
  play_count?: number
}): Promise<Era> {
  return request(`${ACCOUNT_BASE}/admin/eras/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminUpdateEra(id: number, payload: Partial<{
  name: string
  description: string
  time_frame: string
  play_count: number
}>): Promise<Era> {
  return request(`${ACCOUNT_BASE}/admin/eras/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function adminDeleteEra(id: number): Promise<void> {
  await request(`${ACCOUNT_BASE}/admin/eras/${id}/`, { method: 'DELETE' })
}
