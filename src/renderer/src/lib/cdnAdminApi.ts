// Admin side of the distributed CDN - the node roster, approvals and
// CDN-wide stats under /cdn/admin/. The download side lives in cdn.ts.
//
// Nodes register anonymously from the node app (jwa-cdn-node) and serve
// nothing until an admin approves them here. Disabling (is_active false)
// takes a node out but keeps its history; deleting wipes it.
import { JWAPI_BASE } from './juicewrldApi'
import { authedRequest, apiRequest, authHeaders } from './apiClient'
import { getToken } from './userApi'

const CDN_ADMIN_BASE = `${JWAPI_BASE}/cdn/admin`

export type CdnNodeStatus = 'pending' | 'online' | 'offline' | 'disabled'

export interface CdnAdminNode {
  id: number
  node_id: string
  name: string
  owner: number | null
  owner_username: string
  region: string
  is_public: boolean
  is_active: boolean
  is_approved: boolean
  status: CdnNodeStatus
  /** Recomputed from heartbeat age (300 s) on every read, unlike `status`,
   *  which only flips to offline on a 120 s beat task - trust this one. */
  online: boolean
  file_count: number
  current_storage_bytes: number
  max_storage_bytes: number
  upload_speed_mbps: number
  download_speed_mbps: number
  /** Median of the last 20 listener-reported transfer speeds; absent or null
   *  until listeners have reported any. */
  observed_download_speed_mbps?: number | null
  trust_score: number
  hash_violations: number
  total_bytes_served: number
  total_requests: number
  ip_address: string | null
  port: number
  public_base_url: string
  last_heartbeat: string | null
  created_at: string
  /** See CdnOwnedNode - both absent until the backend sends them. */
  manifest_version?: number
  synced_manifest_version?: number | null
  city?: string
  country_code?: string
  latitude?: number | null
  longitude?: number | null
  /** Cloudflare tunnel the node serves files through; listeners get its
   *  serve_url from /cdn/resolve/. serve_ready is false until it connects. */
  tunnel_hostname?: string
  serve_port?: number
  serve_ready?: boolean
  tunnel_id?: string
}

export interface CdnAdminStats {
  total_nodes: number
  online_nodes: number
  /** Every node with is_approved false - includes ones auto-disabled for
   *  violations, not just fresh registrations. */
  pending_nodes: number
  total_bytes_served: number
  total_requests: number
  manifest_version: number
  master_files: number
  master_bytes: number
}

export type CdnNodePatch = Partial<Pick<CdnAdminNode, 'is_approved' | 'is_active' | 'trust_score' | 'hash_violations'>>

/** Score a fresh node starts with on the server. */
export const DEFAULT_TRUST_SCORE = 100

/** The server auto-disables a node at trust <= 0 or this many violations. */
export const VIOLATION_LIMIT = 5

function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, options, getToken())
}

export async function fetchCdnNodes(): Promise<CdnAdminNode[]> {
  const data = await request<{ nodes: CdnAdminNode[] }>(`${CDN_ADMIN_BASE}/nodes/`, { method: 'GET' })
  return data?.nodes ?? []
}

export async function fetchCdnStats(): Promise<CdnAdminStats> {
  return request(`${CDN_ADMIN_BASE}/stats/`, { method: 'GET' })
}

export async function updateCdnNode(nodeId: string, patch: CdnNodePatch): Promise<CdnAdminNode> {
  return request(`${CDN_ADMIN_BASE}/nodes/${encodeURIComponent(nodeId)}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** Permanently deletes the node. Cascades to its file list, throughput
 *  samples, peer speed tests, violations and download logs, and its API key
 *  stops working immediately. */
export async function deleteCdnNode(nodeId: string): Promise<void> {
  await request(`${CDN_ADMIN_BASE}/nodes/${encodeURIComponent(nodeId)}/`, { method: 'DELETE' })
}

/** True when the server pulled the node for hash violations rather than an
 *  admin switching it off - restoring it then also needs the score/counter
 *  reset, or the next accepted report disables it again. */
export function wasAutoDisabled(n: CdnAdminNode): boolean {
  return n.trust_score <= 0 || n.hash_violations >= VIOLATION_LIMIT
}

export type PropagationState = 'propagated' | 'propagating' | 'offline'

export interface PropagationServer {
  host: string
  online: boolean
  manifest_version: number
}

export interface PropagationNode {
  node_id: string
  name: string
  region: string
  city: string
  country_code: string
  continent: string
  latitude: number | null
  longitude: number | null
  online: boolean
  state: PropagationState
}

export interface ProposalPropagation {
  server: PropagationServer
  proposal: {
    id: number
    status: string
    change_type: string
    file_path: string
  }
  nodes: PropagationNode[]
}

export async function fetchProposalPropagation(proposalId: number): Promise<ProposalPropagation> {
  return request(`${CDN_ADMIN_BASE}/proposals/${proposalId}/propagation/`, { method: 'GET' })
}

// Node binary distribution under /cdn/binary/ - the jwa-cdn-node builds
// volunteers download. Listing is public; uploading needs an admin token.
const CDN_BINARY_BASE = `${JWAPI_BASE}/cdn/binary`

export const CDN_BINARY_PLATFORMS = [
  'windows/amd64', 'linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64',
] as const

export interface CdnNodeBinary {
  id: number
  platform: string
  version: string
  sha256: string
  /** Server's signature over the sha256 hex digest, made on upload. Empty for
   *  binaries uploaded before signing existed. */
  signature?: string
  size: number
  download_url: string
  created_at: string
}

export async function fetchCdnBinaries(): Promise<CdnNodeBinary[]> {
  const data = await apiRequest<{ binaries: CdnNodeBinary[] }>(`${CDN_BINARY_BASE}/`, { method: 'GET' })
  return data?.binaries ?? []
}

/** Multipart upload; the server hashes and signs the file. 409 when
 *  platform+version already exists. XHR rather than fetch because fetch can't
 *  report upload progress. No Content-Type header - the browser sets the
 *  multipart boundary. */
export function uploadCdnBinary(
  platform: string,
  version: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CdnNodeBinary> {
  const body = new FormData()
  body.append('platform', platform)
  body.append('version', version)
  body.append('file', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${CDN_BINARY_BASE}/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.onload = () => {
      let data: any
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined } catch { /* non-JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as CdnNodeBinary); return }
      const msg = data?.error ?? data?.detail
      reject(new Error(msg ? String(msg) : `Request failed (${xhr.status})`))
    }
    xhr.send(body)
  })
}
