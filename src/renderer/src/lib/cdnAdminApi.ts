// Admin side of the distributed CDN - the node roster, approvals and
// CDN-wide stats under /cdn/admin/. The download side lives in cdn.ts.
//
// Nodes register anonymously from the node app (jwa-cdn-node) and serve
// nothing until an admin approves them here. There's no delete endpoint:
// disabling (is_active false) is how a node gets taken out.
import { JWAPI_BASE } from './juicewrldApi'
import { authedRequest } from './apiClient'
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
  trust_score: number
  hash_violations: number
  total_bytes_served: number
  total_requests: number
  ip_address: string | null
  port: number
  public_base_url: string
  last_heartbeat: string | null
  created_at: string
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

/** True when the server pulled the node for hash violations rather than an
 *  admin switching it off - restoring it then also needs the score/counter
 *  reset, or the next accepted report disables it again. */
export function wasAutoDisabled(n: CdnAdminNode): boolean {
  return n.trust_score <= 0 || n.hash_violations >= VIOLATION_LIMIT
}
