// Admin broadcast - one message pushed to every client currently connected to
// the notifications socket. The send is REST (admin + 2FA only, anyone else
// gets 403); delivery is the socket's `broadcast` frame, handled by
// BroadcastNotifier. Best effort and live-only: nobody offline sees it later.
import { routeUrl } from './juicewrldApi'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'

export const BROADCAST_LEVELS = ['info', 'success', 'warning', 'error'] as const
export type BroadcastLevel = (typeof BROADCAST_LEVELS)[number]

// Server limits (juicewrld/notifications.py).
export const BROADCAST_MAX_MESSAGE = 500
export const BROADCAST_MAX_TITLE = 100

export interface BroadcastFrame {
  type: 'broadcast'
  action: 'message'
  title: string
  message: string
  level: BroadcastLevel
  sender: string
  sent_at: string
}

export async function sendBroadcast(payload: { message: string; title?: string; level?: BroadcastLevel }): Promise<void> {
  await authedRequest<{ sent: boolean }>(routeUrl('/notifications/broadcast/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, getToken())
}
