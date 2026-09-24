// A signed-in user's own CDN nodes - the ones they linked to their account
// from the node app (jwa-cdn-node, Setup > Account, by pasting their auth
// token there). Linking itself happens in the node app, since claiming needs
// the node's API key and the app never shows it.
//
// Routes confirmed live (401 unauthenticated vs 404 for unknown routes, and
// their Allow headers): GET accounts/nodes/, GET/PATCH/DELETE
// accounts/nodes/{node_id}/. The response bodies aren't documented anywhere
// yet, so the list is unwrapped defensively and every stat field is optional.
import { routeUrl } from './juicewrldApi'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'
import type { CdnNodeStatus } from './cdnAdminApi'

const NODES_BASE = routeUrl('/accounts/nodes')

export interface CdnOwnedNode {
  node_id: string
  name: string
  region?: string
  status?: CdnNodeStatus
  is_public?: boolean
  is_active?: boolean
  is_approved?: boolean
  online?: boolean
  file_count?: number
  current_storage_bytes?: number
  max_storage_bytes?: number
  upload_speed_mbps?: number
  /** Median of the last 20 listener-reported transfer speeds. */
  observed_download_speed_mbps?: number | null
  total_bytes_served?: number
  total_requests?: number
  trust_score?: number
  hash_violations?: number
  last_heartbeat?: string | null
  created_at?: string
  /** Newest master manifest on the server. Bumps whenever approved
   *  proposals change the library and the hash list is regenerated. */
  manifest_version?: number
  /** Manifest version the node last finished syncing, from its heartbeat.
   *  Null for a node that hasn't completed a sync yet. */
  synced_manifest_version?: number | null
}

function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  return authedRequest<T>(url, options, getToken())
}

type ListShape = CdnOwnedNode[] | { nodes?: CdnOwnedNode[]; results?: CdnOwnedNode[] }

export async function fetchMyNodes(): Promise<CdnOwnedNode[]> {
  const data = await request<ListShape>(`${NODES_BASE}/`, { method: 'GET' })
  if (Array.isArray(data)) return data
  return data?.nodes ?? data?.results ?? []
}

/** Removes the node from this account only - it keeps running and can be
 *  re-claimed with its API key. Needs `unlink=1`: a bare DELETE now deletes. */
export async function unlinkMyNode(nodeId: string): Promise<void> {
  await request(`${NODES_BASE}/${encodeURIComponent(nodeId)}/?unlink=1`, { method: 'DELETE' })
}

/** Permanently deletes the node server-side: its file list, speed samples,
 *  violations and download logs go with it and its API key stops working. */
export async function deleteMyNode(nodeId: string): Promise<void> {
  await request(`${NODES_BASE}/${encodeURIComponent(nodeId)}/`, { method: 'DELETE' })
}

/** `online` if the server sent it, else the same 300 s heartbeat rule the
 *  server applies, else the (lagging) status field. */
export function isNodeOnline(n: CdnOwnedNode): boolean {
  if (typeof n.online === 'boolean') return n.online
  if (n.last_heartbeat) return Date.now() - new Date(n.last_heartbeat).getTime() <= 300_000
  return n.status === 'online'
}

export type NodeSyncState = 'current' | 'behind' | 'never'

/** Null when the server doesn't send the fields (older backend) or has no
 *  manifest yet - there's nothing to compare, so show nothing. `latest`
 *  overrides the node's own manifest_version (the admin stats carry it). */
export function nodeSyncState(n: CdnOwnedNode, latest = n.manifest_version): NodeSyncState | null {
  if (n.synced_manifest_version === undefined || !latest) return null
  if (n.synced_manifest_version === null) return 'never'
  return n.synced_manifest_version >= latest ? 'current' : 'behind'
}
