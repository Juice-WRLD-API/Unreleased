// WebRTC signaling + DataChannel receiver for one CDN node attempt. See the
// "Distributed CDN" tab in docs/content.tsx for the full protocol writeup -
// this is the client half of that spec. One call here is one node; the
// caller (cdn.ts) walks the ranked node list and retries on any failure.
import type { CdnResolveNode } from './cdn'

const WS_BASE = 'wss://juicewrldapi.com/juicewrld'

const SIGNAL_CONNECT_TIMEOUT_MS = 15_000
const ICE_GATHER_TIMEOUT_MS = 4_000
const DATA_STALL_TIMEOUT_MS = 30_000

export interface CdnDownloadProgress {
  loaded: number
  total: number
  progress: number   // 0-100
}

export interface CdnNodeDownloadResult {
  blob: Blob
  bytesReceived: number
  /** Wall-clock ms from the node's meta frame to its done frame - the data
   *  transfer alone, without signaling or ICE setup. */
  elapsedMs: number
}

class CdnNodeError extends Error {}

function waitIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()   // send the offer anyway - it may still connect
    }, ICE_GATHER_TIMEOUT_MS)
    function onChange(): void {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer)
        pc.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/** Downloads one file from one CDN node over WebRTC. Rejects on any
 *  failure - the caller is expected to catch and move to the next node. */
export function downloadViaNode(
  node: CdnResolveNode,
  onProgress?: (p: CdnDownloadProgress) => void
): Promise<CdnNodeDownloadResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let pc: RTCPeerConnection | null = null
    let dataStallTimer: ReturnType<typeof setTimeout> | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null

    const ws = new WebSocket(`${WS_BASE}/ws/cdn/signal/?role=client&token=${encodeURIComponent(node.token)}`)

    const chunks: BlobPart[] = []
    let received = 0
    let expectedSize = 0
    let transferStart = 0

    function cleanup(): void {
      if (connectTimer) clearTimeout(connectTimer)
      if (dataStallTimer) clearTimeout(dataStallTimer)
      try { ws.close() } catch {}
      try { pc?.close() } catch {}
    }

    function fail(err: Error): void {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    function succeed(result: CdnNodeDownloadResult): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    function bumpStallTimer(): void {
      if (dataStallTimer) clearTimeout(dataStallTimer)
      dataStallTimer = setTimeout(
        () => fail(new CdnNodeError('data channel stalled')),
        DATA_STALL_TIMEOUT_MS
      )
    }

    connectTimer = setTimeout(() => fail(new CdnNodeError('signaling connect timeout')), SIGNAL_CONNECT_TIMEOUT_MS)

    ws.onerror = () => fail(new CdnNodeError('signaling socket error'))
    ws.onclose = (e) => {
      // A close before we resolved/rejected another way is itself a failure
      // (4000/4003/4004 per the signaling spec, or a plain network drop).
      if (!settled) fail(new CdnNodeError(`signaling closed (${e.code})`))
    }

    ws.onmessage = async (event) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      if (msg.type === 'ready') {
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
        try {
          const iceServers = Array.isArray(msg.ice_servers) ? (msg.ice_servers as RTCIceServer[]) : []
          pc = new RTCPeerConnection({ iceServers })
          const channel = pc.createDataChannel('file', { ordered: true })
          channel.binaryType = 'arraybuffer'

          channel.onopen = () => bumpStallTimer()
          channel.onmessage = (ev: MessageEvent) => {
            bumpStallTimer()
            if (typeof ev.data === 'string') {
              let ctrl: Record<string, unknown>
              try { ctrl = JSON.parse(ev.data) } catch { return }
              if (ctrl.t === 'meta') {
                expectedSize = typeof ctrl.size === 'number' ? ctrl.size : 0
                transferStart = performance.now()
              } else if (ctrl.t === 'error') {
                fail(new CdnNodeError('node reported an error'))
              } else if (ctrl.t === 'done') {
                const elapsedMs = transferStart ? Math.round(performance.now() - transferStart) : 0
                succeed({ blob: new Blob(chunks), bytesReceived: received, elapsedMs })
              }
              return
            }
            chunks.push(ev.data as ArrayBuffer)
            received += (ev.data as ArrayBuffer).byteLength
            if (onProgress && expectedSize > 0) {
              onProgress({
                loaded: received,
                total: expectedSize,
                progress: Math.min(100, Math.round((received / expectedSize) * 100)),
              })
            }
          }

          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          await waitIceGatheringComplete(pc)
          if (settled) return
          ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription?.sdp }))
        } catch (err) {
          fail(err instanceof Error ? err : new CdnNodeError('offer negotiation failed'))
        }
        return
      }

      if (msg.type === 'answer' && pc) {
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp as string })
        } catch (err) {
          fail(err instanceof Error ? err : new CdnNodeError('failed to apply answer'))
        }
        return
      }

      if (msg.type === 'ice' && pc && msg.candidate) {
        try { await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit) } catch {}
        return
      }

      if (msg.type === 'error' || msg.type === 'session_error') {
        fail(new CdnNodeError(String(msg.reason ?? msg.type)))
        return
      }

      if (msg.type === 'teardown') {
        fail(new CdnNodeError('session torn down'))
      }
    }
  })
}
