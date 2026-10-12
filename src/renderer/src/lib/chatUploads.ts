// Chat/server attachment uploads, mirrored as rows in the Transfers panel so
// a big file isn't a silent "sending…" bubble. Unlike comp/donor uploads these
// aren't queued here - the send flow in chatStore drives them - so this only
// owns the row and the cancel handle. Cancelling fails the message's send,
// which leaves it with the usual retry.
import { useStore } from '../store/useStore'
import { errorMessage } from './format'
import type { ChatUploadOptions } from './chatApi'

const aborts = new Map<string, AbortController>()

export function isChatUploadId(id: string): boolean {
  return id.startsWith('chat-upload-')
}

export function cancelChatUpload(id: string): void {
  aborts.get(id)?.abort()
}

export function cancelAllChatUploads(): void {
  for (const ctrl of aborts.values()) ctrl.abort()
}

/** Runs `upload` with a Transfers row showing its progress and speed. */
export async function trackChatUpload<T>(filename: string, size: number, upload: (opts: ChatUploadOptions) => Promise<T>): Promise<T> {
  const id = `chat-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ctrl = new AbortController()
  aborts.set(id, ctrl)
  const { addUpload, updateUpload } = useStore.getState()
  addUpload({ id, filename, type: 'upload', state: 'downloading', percent: 0, received: 0, total: size })
  let sample = { bytes: 0, time: Date.now() }
  const onProgress = (sent: number, total: number): void => {
    const now = Date.now()
    let speedBps: number | undefined
    const dt = (now - sample.time) / 1000
    if (dt >= 0.4) {
      speedBps = Math.max(0, (sent - sample.bytes) / dt)
      sample = { bytes: sent, time: now }
    }
    useStore.getState().updateUpload(id, {
      percent: total ? Math.round((sent / total) * 100) : 0,
      received: sent, total, bytesReceived: sent,
      ...(speedBps !== undefined ? { speedBps } : {}),
    })
  }
  try {
    const res = await upload({ onProgress, signal: ctrl.signal })
    updateUpload(id, { state: 'done', percent: 100, received: size, speedBps: undefined })
    return res
  } catch (e) {
    updateUpload(id, ctrl.signal.aborted
      ? { state: 'cancelled', speedBps: undefined }
      : { state: 'error', error: errorMessage(e, 'Upload failed'), speedBps: undefined })
    throw e
  } finally {
    aborts.delete(id)
  }
}
