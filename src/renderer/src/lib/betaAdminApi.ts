// Admin side of beta gating under /beta/admin/ - the access codes people
// enter in the installer or Settings, and the builds /beta/versions lists.
// The code-holder side (unlock/versions/download) lives in electron/main.js
// and build/fetch-releases.ps1.
//
// A code works while is_valid (active and not expired). A version only shows
// up (and downloads) while is_active is true. Administrator + 2FA only.
import { JWAPI_BASE } from './juicewrldApi'
import { authedRequest, apiRequest, authHeaders } from './apiClient'
import { getToken } from './userApi'

const BETA_ADMIN_BASE = `${JWAPI_BASE.replace(/\/juicewrld$/, '')}/beta/admin`

export interface BetaCode {
  id: number
  code: string
  label: string
  is_active: boolean
  /** Server-computed: active and not expired. */
  is_valid: boolean
  expires_at: string | null
  created_at: string
}

export interface BetaVersion {
  id: number
  /** Bare version string, no "v" - what /beta/download?version= takes. */
  version: string
  notes: string
  /** Relative to the server's BETA_BUILDS_DIR. */
  file_path: string
  is_active: boolean
  published_at: string | null
  created_at: string
}

export type BetaCodeInput = Partial<Pick<BetaCode, 'code' | 'label' | 'is_active' | 'expires_at'>>
export type BetaVersionInput = Partial<Pick<BetaVersion, 'version' | 'notes' | 'is_active' | 'published_at'>>

function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, options, getToken())
}

export async function fetchBetaCodes(): Promise<BetaCode[]> {
  const data = await request<{ codes: BetaCode[] }>(`${BETA_ADMIN_BASE}/codes/`, { method: 'GET' })
  return data?.codes ?? []
}

export async function createBetaCode(input: BetaCodeInput): Promise<BetaCode> {
  return request(`${BETA_ADMIN_BASE}/codes/`, { method: 'POST', body: JSON.stringify(input) })
}

export async function updateBetaCode(id: number, patch: BetaCodeInput): Promise<BetaCode> {
  return request(`${BETA_ADMIN_BASE}/codes/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function deleteBetaCode(id: number): Promise<void> {
  await request(`${BETA_ADMIN_BASE}/codes/${id}/`, { method: 'DELETE' })
}

export async function fetchBetaVersions(): Promise<BetaVersion[]> {
  const data = await request<{ versions: BetaVersion[] }>(`${BETA_ADMIN_BASE}/versions/`, { method: 'GET' })
  return data?.versions ?? []
}

function versionForm(input: BetaVersionInput, file?: File | null): FormData {
  const body = new FormData()
  if (input.version !== undefined) body.append('version', input.version)
  if (input.notes !== undefined) body.append('notes', input.notes)
  if (input.is_active !== undefined) body.append('is_active', String(input.is_active))
  if (input.published_at !== undefined) body.append('published_at', input.published_at ?? '')
  if (file) body.append('file', file)
  return body
}

/** Multipart publish of a new build (the server saves it under its beta
 *  builds folder). 409 when the version already exists. XHR rather than fetch
 *  because fetch can't report upload progress. No Content-Type header - the
 *  browser sets the multipart boundary. */
export function createBetaVersion(
  input: BetaVersionInput,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<BetaVersion> {
  const body = versionForm(input, file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BETA_ADMIN_BASE}/versions/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.onload = () => {
      let data: any
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined } catch { /* non-JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as BetaVersion); return }
      const msg = data?.detail ?? data?.error
      reject(new Error(msg ? String(msg) : `Request failed (${xhr.status})`))
    }
    xhr.send(body)
  })
}

/** Multipart PATCH; pass `file` to replace the build binary. */
export async function updateBetaVersion(id: number, patch: BetaVersionInput, file?: File | null): Promise<BetaVersion> {
  return apiRequest(`${BETA_ADMIN_BASE}/versions/${id}/`, {
    method: 'PATCH',
    body: versionForm(patch, file),
    headers: authHeaders(getToken()),
  })
}

export async function deleteBetaVersion(id: number): Promise<void> {
  await request(`${BETA_ADMIN_BASE}/versions/${id}/`, { method: 'DELETE' })
}
