// Client for the peer-to-peer distributed CDN (see the "Distributed CDN" tab
// in docs/content.tsx for the full protocol). Resolves a library file to a
// ranked list of volunteer nodes, downloads over WebRTC, and verifies the
// result with BLAKE2b before handing back a Blob. Falls through to null on
// any failure so callers can drop straight back to the ordinary
// /files/download/ path - see downloadFileSmart below, the one entry point
// the rest of the app should use.
//
// As of writing, production has zero registered CDN nodes and no generated
// manifest, so /cdn/resolve/ always answers with an empty node list and
// tryDownload() below returns null immediately. That's expected, not a bug -
// this module activates on its own the moment nodes come online, with no
// further wiring needed at the call sites.
import { JWAPI_BASE } from './juicewrldApi'
import { getToken } from './userApi'
import { downloadViaNode, type CdnDownloadProgress } from './cdnWebrtc'
import { blake2bHexFromBlob } from './cdnBlake2b'
import { triggerDownload } from './apiFilesShared'

const CDN_BASE = `${JWAPI_BASE}/cdn`
const ENABLED_KEY = 'cdnEnabled'

export interface CdnResolveNode {
  node_id: string
  name: string
  region: string
  upload_speed_mbps: number
  score: number
  token: string
  transport: string
}

export interface CdnResolveResponse {
  filepath: string
  expected_hash: string
  size: number
  is_donor: boolean
  transport: string
  node_count: number
  nodes: CdnResolveNode[]
}

export interface CdnDownloadResult {
  blob: Blob
  node: CdnResolveNode
  verified: boolean
  // Whether the 1.5x donor score multiplier applied to this resolution (see
  // docs/content.tsx "Donor Priority API") - lets a caller confirm the boost
  // actually took effect rather than just trusting the account flag.
  isDonor: boolean
}

function readEnabled(): boolean {
  try {
    const stored = localStorage.getItem(ENABLED_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true   // no localStorage (private mode, etc.) - default on, same as a fresh install
  }
}

class CdnService {
  enabled = readEnabled()

  setEnabled(value: boolean): void {
    this.enabled = value
    try { localStorage.setItem(ENABLED_KEY, String(value)) } catch {}
  }

  async resolve(filepath: string): Promise<CdnResolveResponse | null> {
    try {
      const token = getToken()
      const res = await fetch(`${CDN_BASE}/resolve/?filepath=${encodeURIComponent(filepath)}`, {
        headers: token ? { Authorization: `Token ${token}` } : {},
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  reportViolation(nodeId: string, filepath: string, reportedHash?: string): void {
    // Fire-and-forget - a failed report shouldn't block falling through to
    // the next node or to the API download.
    fetch(`${CDN_BASE}/report-violation/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, filepath, reported_hash: reportedHash }),
    }).catch(() => {})
  }

  logDownload(nodeId: string, filepath: string, bytesServed: number): void {
    fetch(`${CDN_BASE}/log-download/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, filepath, bytes_served: bytesServed }),
    }).catch(() => {})
  }

  /** Walks the ranked node list for `filepath`, trying each over WebRTC
   *  until one verifies. Returns null if the CDN is disabled, no node hosts
   *  the file, or every node fails - the caller's job is to fall back to
   *  the normal API download in that case. */
  async tryDownload(
    filepath: string,
    onProgress?: (p: CdnDownloadProgress) => void
  ): Promise<CdnDownloadResult | null> {
    if (!this.enabled) return null

    const resolution = await this.resolve(filepath)
    if (!resolution || resolution.node_count === 0) return null

    for (const node of resolution.nodes) {
      try {
        const { blob, bytesReceived } = await downloadViaNode(node, onProgress)

        let verified = false
        if (resolution.expected_hash) {
          const hash = await blake2bHexFromBlob(blob)
          if (hash !== resolution.expected_hash) {
            this.reportViolation(node.node_id, filepath, hash)
            continue   // try the next node
          }
          verified = true
        }

        this.logDownload(node.node_id, filepath, bytesReceived)
        return { blob, node, verified, isDonor: resolution.is_donor }
      } catch {
        continue   // this node failed (timeout, NAT, offline, ...) - next one
      }
    }

    return null
  }
}

const cdnService = new CdnService()
export default cdnService

/** Drop-in replacement for `triggerDownload(buildStreamUrl(path), filename)`
 *  at the app's download call sites: tries the CDN first, verifies the
 *  hash, and only falls back to the direct API stream URL if the CDN can't
 *  serve it (currently: always, since no public nodes are registered yet).
 *  Resolves to whether the donor score boost actually applied to this
 *  download, so a caller can confirm it rather than just trusting the
 *  account's `is_donor` flag - `false` for a non-donor, a CDN fallback, or a
 *  plain API download. */
export async function downloadFileSmart(
  path: string,
  filename: string,
  streamUrl: string,
  onProgress?: (p: CdnDownloadProgress) => void
): Promise<boolean> {
  const result = await cdnService.tryDownload(path, onProgress)
  if (!result) {
    triggerDownload(streamUrl, filename)
    return false
  }

  const objectUrl = URL.createObjectURL(result.blob)
  triggerDownload(objectUrl, filename)
  // Give the download a moment to actually start before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  return result.isDonor
}
