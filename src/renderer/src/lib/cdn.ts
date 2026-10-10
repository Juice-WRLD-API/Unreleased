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
import { routeUrl } from './juicewrldApi'
import { getToken } from './userApi'
import { downloadViaNode, CdnNodeError, NO_ICE_CANDIDATES, type CdnDownloadProgress, type CdnNodeDownloadResult } from './cdnWebrtc'
import { downloadViaTunnel } from './cdnTunnel'
import { blake2bHexFromBlob } from './cdnBlake2b'
import { triggerDownload } from './apiFilesShared'
import { embedForDownload, embedSafe } from './lyricsEmbed'

const CDN_BASE = routeUrl('/cdn')
const ENABLED_KEY = 'cdnEnabled'

// Set once a node attempt finds this browser gathers no ICE candidates
// (WebRTC blocked by a VPN/privacy setting). Browser-wide and won't change
// mid-session, so later downloads skip the CDN instead of repeating the
// ~4s gather every time.
let webrtcBlocked = false

export interface CdnResolveNode {
  node_id: string
  name: string
  region: string
  upload_speed_mbps: number
  score: number
  token: string
  transport: string
  serve_url?: string
}

export interface CdnResolveResponse {
  filepath: string
  expected_hash: string
  size: number
  is_donor: boolean
  /** ISO country from Cloudflare, '' when unknown. Nodes in the same country
   *  (x1.5) or continent (x1.2) are already boosted in `nodes` order. */
  client_country?: string
  transport: string
  node_count: number
  nodes: CdnResolveNode[]
  /** Server hint: no node is worth trying (none, or the best scores under
   *  5.0 - roughly a node under 5 Mbps). Go straight to the origin. */
  direct?: boolean
  /** Origin /files/download/ URL for this file, default channel only. */
  direct_url?: string
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

// Every tryDownload exit point logs why it did or didn't use a node, so the
// devtools console (Verbose level) shows which source served a download.
function debug(filepath: string, message: string, ...extra: unknown[]): void {
  console.debug(`[cdn] ${filepath}: ${message}`, ...extra)
}

function readEnabled(): boolean {
  try {
    const stored = localStorage.getItem(ENABLED_KEY)
    return stored === null ? false : stored === 'true'
  } catch {
    return false   // no localStorage (private mode, etc.) - default off, same as a fresh install
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

  /** Reported as the listener, so the server folds the measured speed into
   *  the node's observed_download_speed_mbps (median of the last 20 listener
   *  samples) - node-reported samples don't move that figure. */
  logDownload(nodeId: string, filepath: string, bytesServed: number, elapsedMs: number): void {
    fetch(`${CDN_BASE}/log-download/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: nodeId,
        filepath,
        bytes_served: bytesServed,
        ...(elapsedMs > 0 ? { elapsed_ms: elapsedMs } : {}),
        reported_by: 'listener',
      }),
    }).catch(() => {})
  }

  /** Walks the ranked node list for `filepath`, trying each over WebRTC
   *  until one verifies against the master hash table. Returns null if the
   *  CDN is disabled, no node hosts the file, the server flags the
   *  resolution `direct` (every candidate too slow to beat the origin), the file has no hash in the
   *  manifest yet, or every node fails - the caller's job is to fall back
   *  to the normal API download in that case.
   *
   *  A P2P node is an untrusted third party, unlike juicewrldapi.com itself
   *  - every file handed back here was compared byte-for-byte (via BLAKE2b)
   *  against the hash the API's own master list has on record for it.
   *  There is no code path that returns an un-verified CDN blob: a file
   *  with no `expected_hash` yet skips the CDN entirely rather than trust a
   *  node with nothing to check it against. */
  async tryDownload(
    filepath: string,
    onProgress?: (p: CdnDownloadProgress) => void
  ): Promise<CdnDownloadResult | null> {
    if (!this.enabled) { debug(filepath, 'CDN disabled in settings - using origin'); return null }

    const resolveStarted = performance.now()
    const resolution = await this.resolve(filepath)
    const resolveMs = Math.round(performance.now() - resolveStarted)
    if (!resolution) { debug(filepath, `resolve failed after ${resolveMs} ms - using origin`); return null }
    if (resolution.node_count === 0) { debug(filepath, 'no nodes host this file - using origin'); return null }
    if (resolution.direct) {   // server says the origin beats every candidate
      debug(filepath, 'server flagged direct (no node fast enough) - using origin', resolution.nodes)
      return null
    }
    if (!resolution.expected_hash) {   // nothing to verify against - don't trust a node blind
      debug(filepath, 'no expected hash in manifest - using origin')
      return null
    }

    const candidates = webrtcBlocked ? resolution.nodes.filter((n) => n.serve_url) : resolution.nodes
    if (candidates.length === 0) {
      debug(filepath, 'WebRTC blocked in this browser and no node has a tunnel - using origin')
      return null
    }

    debug(filepath, `resolved in ${resolveMs} ms, trying ${candidates.length} node(s)`, candidates.map((n) => `${n.name} (${n.node_id}, score ${n.score}, ${n.serve_url ? 'tunnel' : 'webrtc'})`))
    for (const node of candidates) {
      const attempts: Array<['tunnel' | 'webrtc', () => Promise<CdnNodeDownloadResult>]> = []
      if (node.serve_url) attempts.push(['tunnel', () => downloadViaTunnel(node, filepath, onProgress)])
      if (!webrtcBlocked) attempts.push(['webrtc', () => downloadViaNode(node, onProgress)])

      for (const [via, attempt] of attempts) {
        let result: CdnNodeDownloadResult
        try {
          result = await attempt()
        } catch (err) {
          if (err instanceof CdnNodeError && err.reason === NO_ICE_CANDIDATES) {
            webrtcBlocked = true
            debug(filepath, `WebRTC blocked - ${err.message} - only tunnel nodes from here on`)
          } else {
            debug(filepath, `node ${node.name} (${node.node_id}) ${via} failed - ${err instanceof Error ? err.message : String(err)}`)
          }
          continue
        }

        const hash = await blake2bHexFromBlob(result.blob)
        if (hash !== resolution.expected_hash) {
          debug(filepath, `hash mismatch from ${node.name} (${node.node_id}) via ${via} - reported, trying next node`, { expected: resolution.expected_hash, got: hash })
          this.reportViolation(node.node_id, filepath, hash)
          break
        }

        debug(filepath, `served by ${node.name} (${node.node_id}) via ${via}: ${result.bytesReceived} bytes in ${result.elapsedMs} ms, hash verified, ${Math.round(performance.now() - resolveStarted)} ms since resolve started`)
        this.logDownload(node.node_id, filepath, result.bytesReceived, result.elapsedMs)
        return { blob: result.blob, node, verified: true, isDonor: resolution.is_donor }
      }
    }

    debug(filepath, 'every node failed - using origin')
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
  onProgress?: (p: CdnDownloadProgress) => void,
  /** The song this file is, for the "embed lyrics on download" setting. */
  songId?: number | null
): Promise<boolean> {
  const embedPromise = embedForDownload(songId, path)
  const result = await cdnService.tryDownload(path, onProgress)
  const embed = await embedPromise
  let blob = result?.blob ?? null
  // The origin fallback is normally a plain browser download; embedding needs
  // the bytes, so fetch them here (and fall back to the browser on failure).
  if (!blob && embed) {
    try {
      const res = await fetch(streamUrl)
      if (res.ok) blob = await res.blob()
    } catch { /* plain download below */ }
  }
  if (!blob) {
    triggerDownload(streamUrl, filename)
    return false
  }
  if (embed) blob = await embedSafe(blob, embed)

  const objectUrl = URL.createObjectURL(blob)
  triggerDownload(objectUrl, filename)
  // Give the download a moment to actually start before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  return result?.isDonor ?? false
}
