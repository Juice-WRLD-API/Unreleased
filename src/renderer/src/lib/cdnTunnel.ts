import type { CdnResolveNode } from './cdn'
import type { CdnDownloadProgress, CdnNodeDownloadResult } from './cdnWebrtc'

const CONNECT_TIMEOUT_MS = 10_000
const STALL_TIMEOUT_MS = 30_000

export class CdnTunnelError extends Error {
  constructor(readonly reason: string, detail?: string) {
    super(`tunnel: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'CdnTunnelError'
  }
}

export function tunnelFileUrl(node: CdnResolveNode, filepath: string): string {
  const base = (node.serve_url ?? '').replace(/\/$/, '')
  return `${base}/file?path=${encodeURIComponent(filepath)}&token=${encodeURIComponent(node.token)}`
}

export async function downloadViaTunnel(
  node: CdnResolveNode,
  filepath: string,
  onProgress?: (p: CdnDownloadProgress) => void
): Promise<CdnNodeDownloadResult> {
  if (!node.serve_url) throw new CdnTunnelError('no serve_url')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort('connect'), CONNECT_TIMEOUT_MS)
  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort('stall'), STALL_TIMEOUT_MS)
  }

  try {
    const started = performance.now()
    let res: Response
    try {
      res = await fetch(tunnelFileUrl(node, filepath), { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
    } catch (err) {
      throw new CdnTunnelError(controller.signal.aborted ? 'connect timeout' : 'network error', err instanceof Error ? err.message : undefined)
    }
    if (!res.ok) {
      let reason = `http ${res.status}`
      try {
        const body = await res.json()
        if (body && typeof body.error === 'string') reason = `${reason} ${body.error}`
      } catch {}
      throw new CdnTunnelError(reason)
    }
    if (!res.body) throw new CdnTunnelError('empty response body')

    const total = Number(res.headers.get('content-length') || 0)
    const reader = res.body.getReader()
    const chunks: BlobPart[] = []
    let received = 0
    arm()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        arm()
        chunks.push(value)
        received += value.byteLength
        if (onProgress && total > 0) {
          onProgress({ loaded: received, total, progress: Math.min(100, Math.round((received / total) * 100)) })
        }
      }
    } catch (err) {
      const why = controller.signal.aborted ? `stalled for ${STALL_TIMEOUT_MS / 1000}s` : 'read failed'
      throw new CdnTunnelError(why, `${received} bytes so far${err instanceof Error ? `, ${err.message}` : ''}`)
    }
    if (total > 0 && received !== total) {
      throw new CdnTunnelError('truncated', `${received} of ${total} bytes`)
    }
    return { blob: new Blob(chunks), bytesReceived: received, elapsedMs: Math.round(performance.now() - started) }
  } finally {
    clearTimeout(timer)
  }
}
