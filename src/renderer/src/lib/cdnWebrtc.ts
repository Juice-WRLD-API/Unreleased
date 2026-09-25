// WebRTC signaling + DataChannel receiver for one CDN node attempt. See the
// "Distributed CDN" tab in docs/content.tsx for the full protocol writeup -
// this is the client half of that spec. One call here is one node; the
// caller (cdn.ts) walks the ranked node list and retries on any failure.
import type { CdnResolveNode } from './cdn'
import { baseFor } from './apiServers'

// Signaling must hit the same server that answered /cdn/resolve/ - it issued
// the node token and is the one the node's own socket is registered with.
// Hardcoding production here made every node look `node_offline` whenever a
// server override or `/cdn` route rule pointed resolve somewhere else.
const WS_BASE = (() => {
  const url = new URL(baseFor('/cdn'))
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${url.host}${url.pathname.replace(/\/$/, '')}`
})()

const SIGNAL_CONNECT_TIMEOUT_MS = 15_000
const ICE_GATHER_TIMEOUT_MS = 4_000
const DATA_STALL_TIMEOUT_MS = 30_000
// Offer sent -> answer. The node can take 5-6s just to answer (it gathers on
// every network adapter) and gives up itself at 30s.
const ANSWER_TIMEOUT_MS = 20_000
// Answer applied -> data channel open. Timed separately so a slow answer
// doesn't eat into the time ICE gets to connect.
const ICE_CONNECT_TIMEOUT_MS = 15_000

/** Reason code for a browser that gathered zero ICE candidates - WebRTC IP
 *  leak protection (VPN app/extension, Brave's WebRTC policy, Firefox
 *  proxy_only). Browser-wide, so the caller stops trying nodes entirely. */
export const NO_ICE_CANDIDATES = 'no_ice_candidates'

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

// Signaling-server reason codes we know how to explain. Anything else is
// logged as the raw code.
const REASON_TEXT: Record<string, string> = {
  node_offline: "node isn't connected to the signaling server (its app is closed or lost its connection)",
  [NO_ICE_CANDIDATES]: "this browser isn't allowed to make WebRTC connections (VPN or privacy setting blocking WebRTC)",
  connect_timeout: 'node saw no connection within 30s',
  connect_failed: "node's ICE/connection failed",
  bad_offer: "node couldn't parse the offer",
  transfer_failed: 'node hit an error mid-transfer',
  invalid_token: "token didn't verify, or wasn't for this node/file",
  not_hosted: "node doesn't have the file",
  private: 'node is private',
  busy: 'node is at its upload connection limit',
}

/** Which step of the attempt failed - signaling (WebSocket to the API),
 *  negotiation (SDP/ICE), or transfer (the DataChannel itself). */
export type CdnFailStage = 'signaling' | 'negotiation' | 'transfer'

export class CdnNodeError extends Error {
  constructor(readonly stage: CdnFailStage, readonly reason: string, detail?: string) {
    super(`${stage}: ${REASON_TEXT[reason] ?? reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'CdnNodeError'
  }
}

function asNodeError(stage: CdnFailStage, err: unknown, fallback: string): CdnNodeError {
  if (err instanceof CdnNodeError) return err
  return new CdnNodeError(stage, err instanceof Error ? `${err.name}: ${err.message}` : fallback)
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
    let negotiationTimer: ReturnType<typeof setTimeout> | null = null
    let gatherTimer: ReturnType<typeof setTimeout> | null = null
    let channelOpen = false
    let answerApplied = false
    let localCandidateCount = 0
    const localCandidateTypes: Record<string, number> = {}
    // Candidates the node trickles before its answer is applied. addIceCandidate
    // throws without a remote description, and the catch below would silently
    // drop them - which can leave ICE with nothing that connects.
    const pendingIce: RTCIceCandidateInit[] = []
    let remoteIceCount = 0
    let sessionId = ''

    const ws = new WebSocket(`${WS_BASE}/ws/cdn/signal/?role=client&token=${encodeURIComponent(node.token)}`)

    let iceServers: RTCIceServer[] = []
    const chunks: BlobPart[] = []
    let received = 0
    let expectedSize = 0
    let transferStart = 0

    function cleanup(): void {
      if (connectTimer) clearTimeout(connectTimer)
      if (dataStallTimer) clearTimeout(dataStallTimer)
      if (negotiationTimer) clearTimeout(negotiationTimer)
      if (gatherTimer) clearTimeout(gatherTimer)
      try { ws.close() } catch {}
      try { pc?.close() } catch {}
    }

    function localSummary(): string {
      const parts = Object.entries(localCandidateTypes).map(([type, n]) => `${type}:${n}`)
      return parts.length ? parts.join(' ') : 'none'
    }

    function fail(err: Error): void {
      if (settled) return
      settled = true
      console.debug(
        `[cdn] session ${sessionId || '?'} failing: ${err instanceof Error ? err.message : String(err)}`
          + ` (bytes ${received}, ice ${pc?.iceConnectionState ?? '?'}, conn ${pc?.connectionState ?? '?'},`
          + ` local ${localSummary()}, ${remoteIceCount} remote candidates)`
      )
      cleanup()
      reject(err)
    }

    function succeed(result: CdnNodeDownloadResult): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    function armNegotiationTimer(ms: number, message: string): void {
      if (negotiationTimer) clearTimeout(negotiationTimer)
      negotiationTimer = setTimeout(
        () => fail(new CdnNodeError(
          'negotiation',
          message,
          // How far it got: no answer points at the node, an answer with
          // ICE stuck at checking/failed points at NAT/firewall/TURN.
          `answer ${answerApplied ? 'received' : 'never received'}, ice ${pc?.iceConnectionState ?? '?'}, `
            + `connection ${pc?.connectionState ?? '?'}, local candidates ${localSummary()}, `
            + `${remoteIceCount} remote candidates, ${iceServers.length} ice servers`
        )),
        ms
      )
    }

    function bumpStallTimer(): void {
      if (dataStallTimer) clearTimeout(dataStallTimer)
      dataStallTimer = setTimeout(
        () => fail(new CdnNodeError('transfer', `data channel stalled - nothing received for ${DATA_STALL_TIMEOUT_MS / 1000}s`, `${received} bytes so far`)),
        DATA_STALL_TIMEOUT_MS
      )
    }

    connectTimer = setTimeout(() => fail(new CdnNodeError('signaling', `no 'ready' from the signaling server within ${SIGNAL_CONNECT_TIMEOUT_MS / 1000}s`)), SIGNAL_CONNECT_TIMEOUT_MS)

    ws.onerror = () => fail(new CdnNodeError('signaling', 'WebSocket error connecting to the signaling server'))
    ws.onclose = (e) => {
      // A close before we resolved/rejected another way is itself a failure
      // (4000/4003/4004 per the signaling spec, or a plain network drop).
      if (!settled) fail(new CdnNodeError('signaling', `signaling socket closed with code ${e.code}`, e.reason || undefined))
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
        sessionId = typeof msg.session_id === 'string' ? msg.session_id : ''
        try {
          iceServers = Array.isArray(msg.ice_servers) ? (msg.ice_servers as RTCIceServer[]) : []
          pc = new RTCPeerConnection({ iceServers })
          const channel = pc.createDataChannel('file', { ordered: true })
          channel.binaryType = 'arraybuffer'

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              localCandidateCount++
              const type = e.candidate.type || 'unknown'
              localCandidateTypes[type] = (localCandidateTypes[type] || 0) + 1
              try { ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate.toJSON() })) } catch {}
            } else {
              console.debug(`[cdn] gathered candidates: ${localSummary()}`)
              if (localCandidateCount === 0) {
                fail(new CdnNodeError('negotiation', NO_ICE_CANDIDATES))
              }
            }
          }

          channel.onopen = () => {
            channelOpen = true
            if (negotiationTimer) { clearTimeout(negotiationTimer); negotiationTimer = null }
            bumpStallTimer()
          }
          pc.onconnectionstatechange = () => {
            if (pc?.connectionState !== 'failed') return
            if (channelOpen && received > 0) {
              console.debug(`[cdn] session ${sessionId || '?'} connection failed with ${received} bytes in; letting the stall timer decide`)
              return
            }
            fail(new CdnNodeError(channelOpen ? 'transfer' : 'negotiation', 'peer connection failed'))
          }
          channel.onmessage = (ev: MessageEvent) => {
            bumpStallTimer()
            if (typeof ev.data === 'string') {
              let ctrl: Record<string, unknown>
              try { ctrl = JSON.parse(ev.data) } catch { return }
              if (ctrl.t === 'meta') {
                expectedSize = typeof ctrl.size === 'number' ? ctrl.size : 0
                transferStart = performance.now()
              } else if (ctrl.t === 'error') {
                fail(new CdnNodeError('transfer', 'node reported an error', typeof ctrl.reason === 'string' ? ctrl.reason : typeof ctrl.message === 'string' ? ctrl.message : undefined))
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
          if (settled) return
          ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' }))
          gatherTimer = setTimeout(() => {
            if (!settled && localCandidateCount === 0) {
              fail(new CdnNodeError('negotiation', NO_ICE_CANDIDATES))
            }
          }, ICE_GATHER_TIMEOUT_MS)
          armNegotiationTimer(ANSWER_TIMEOUT_MS, `no answer from the node within ${ANSWER_TIMEOUT_MS / 1000}s`)
        } catch (err) {
          fail(asNodeError('negotiation', err, 'offer negotiation failed'))
        }
        return
      }

      if (msg.type === 'answer' && pc) {
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp as string })
          answerApplied = true
          if (!channelOpen) {
            armNegotiationTimer(ICE_CONNECT_TIMEOUT_MS, `no data channel within ${ICE_CONNECT_TIMEOUT_MS / 1000}s of the answer`)
          }
          for (const c of pendingIce.splice(0)) {
            try { await pc.addIceCandidate(c) } catch {}
          }
        } catch (err) {
          fail(asNodeError('negotiation', err, 'failed to apply answer'))
        }
        return
      }

      if (msg.type === 'ice' && pc && msg.candidate) {
        remoteIceCount++
        const candidate = msg.candidate as RTCIceCandidateInit
        if (!answerApplied) { pendingIce.push(candidate); return }
        try { await pc.addIceCandidate(candidate) } catch {}
        return
      }

      if (msg.type === 'error' || msg.type === 'session_error') {
        fail(new CdnNodeError(pc ? 'negotiation' : 'signaling', String(msg.reason ?? msg.type), typeof msg.detail === 'string' ? msg.detail : undefined))
        return
      }

      if (msg.type === 'teardown') {
        fail(new CdnNodeError(pc ? 'transfer' : 'signaling', 'session torn down by the signaling server', typeof msg.reason === 'string' ? msg.reason : undefined))
      }
    }
  })
}
