// Admin broadcast - one message pushed to every client currently connected to
// the notifications socket. The send is REST (admin + 2FA only, anyone else
// gets 403); delivery is the socket's `broadcast` frame, handled by
// BroadcastNotifier. The live push only reaches connected sockets, so clients
// also fetch the public catch-up list on start/reconnect (dedupe by `id`).
import { routeUrl } from './juicewrldApi'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'

export const BROADCAST_LEVELS = ['info', 'success', 'warning', 'error'] as const
export type BroadcastLevel = (typeof BROADCAST_LEVELS)[number]

// Server limits (juicewrld/notifications.py).
export const BROADCAST_MAX_MESSAGE = 500
export const BROADCAST_MAX_TITLE = 100

export interface BroadcastMessage {
  id: number
  title: string
  message: string
  level: BroadcastLevel
  sender: string
  sent_at: string
}

/** The socket frame: a stored message plus the envelope. `id` is absent on
 *  servers that predate saved broadcasts. */
export type BroadcastFrame = Omit<BroadcastMessage, 'id'> & {
  type: 'broadcast'
  action: 'message'
  id?: number
}

export async function sendBroadcast(payload: { message: string; title?: string; level?: BroadcastLevel }): Promise<{ sent: boolean; id?: number }> {
  return authedRequest<{ sent: boolean; id?: number }>(routeUrl('/notifications/broadcast/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, getToken())
}

/** Public, no auth: broadcasts from the last 24h, oldest first (newest 20 at
 *  most). Pass the highest id already seen to get only newer ones. */
export async function fetchRecentBroadcasts(afterId?: number): Promise<BroadcastMessage[]> {
  const url = new URL(routeUrl('/notifications/broadcasts/recent/'))
  if (afterId != null) url.searchParams.set('after_id', String(afterId))
  const res = await authedRequest<{ results: BroadcastMessage[] }>(url.toString(), { method: 'GET' }, null)
  return res?.results ?? []
}

/** Admin: every past broadcast, newest first. */
export async function fetchBroadcastHistory(limit = 20, offset = 0): Promise<{ count: number; results: BroadcastMessage[] }> {
  const url = new URL(routeUrl('/notifications/broadcast/'))
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  const res = await authedRequest<{ count: number; results: BroadcastMessage[] }>(url.toString(), { method: 'GET' }, getToken())
  return { count: res?.count ?? 0, results: res?.results ?? [] }
}
