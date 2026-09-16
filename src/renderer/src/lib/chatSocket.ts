import { JWAPI_BASE } from './juicewrldApi'
import { getToken } from './userApi'
import type { ChatChannel, ChatMember, ChatMessage, ChatServer, Conversation } from './chatApi'

export type RoomKind = 'channel' | 'conversation'

export type ChatEvent =
  | { type: 'connected'; user_id: number }
  | { type: 'presence.snapshot'; online: number[] }
  | { type: 'pong' }
  | { type: 'resynced' }
  | { type: 'message.created' | 'message.updated' | 'message.pinned' | 'message.unpinned'; message: ChatMessage }
  | { type: 'message.deleted'; message_id: number; channel: number | null; conversation: number | null }
  | { type: 'reaction.added' | 'reaction.removed'; message_id: number; emoji: string; user_id: number; channel: number | null; conversation: number | null }
  | { type: 'read.receipt'; user_id: number; last_read_message_id: number | null; channel?: number; conversation?: number }
  | { type: 'typing'; user_id: number; active: boolean; kind: RoomKind; id: number }
  | { type: 'presence.update'; user_id: number; online: boolean }
  | { type: 'member.joined' | 'member.updated'; server: number; member: ChatMember }
  | { type: 'member.left'; server: number; user_id: number }
  | { type: 'server.updated'; server: ChatServer }
  | { type: 'channel.created' | 'channel.updated'; server: number; channel: ChatChannel }
  | { type: 'channel.deleted'; server: number; channel_id: number }
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'key.rotated'; conversation: number; key_version: number }
  | { type: 'device.added'; conversation: number; user_id: number }
  | { type: 'envelope.available'; conversation: number; key_version: number }

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unauthorized'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const PING_MS = 25_000
const UNAUTHORIZED = 4401

function wsUrl(token: string): string {
  const env = import.meta.env.VITE_JWAPI_WS as string | undefined
  const origin = env
    ? env.replace(/\/$/, '')
    : JWAPI_BASE.replace(/\/juicewrld\/?$/, '').replace(/^http/, 'ws')
  return `${origin}/juicewrld/ws/chat/?token=${encodeURIComponent(token)}`
}

export class ChatSocket {
  private ws: WebSocket | null = null
  private attempt = 0
  private retryTimer: number | null = null
  private pingTimer: number | null = null
  private disposed = true
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.checkHealth()
  }

  constructor(
    private readonly onEvent: (event: ChatEvent) => void,
    private readonly onStatus: (status: SocketStatus) => void,
  ) {}

  connect(): void {
    if (!this.disposed) return
    this.disposed = false
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('online', this.onVisible)
    this.open()
  }

  dispose(): void {
    this.disposed = true
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('online', this.onVisible)
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    if (ws) try { ws.close() } catch {}
    this.onStatus('idle')
  }

  send(payload: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  checkHealth(): void {
    if (this.disposed) return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      if (this.retryTimer !== null) {
        window.clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      this.open()
    }
  }

  private open(): void {
    if (this.disposed) return
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return
    const token = getToken()
    if (!token) {
      this.onStatus('unauthorized')
      return
    }
    this.onStatus(this.attempt > 0 ? 'reconnecting' : 'connecting')
    const ws = new WebSocket(wsUrl(token))
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws || this.disposed) return
      this.attempt = 0
      this.onStatus('open')
      this.startPing()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      try {
        this.onEvent(JSON.parse(ev.data as string) as ChatEvent)
      } catch (err) {
        console.warn('[chat] bad frame', err)
      }
    }
    ws.onerror = () => {}
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopPing()
      if (this.disposed) return
      if (ev.code === UNAUTHORIZED) {
        this.onStatus('unauthorized')
        return
      }
      this.onStatus('reconnecting')
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]
      this.attempt++
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null
        this.open()
      }, delay)
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private clearTimers(): void {
    this.stopPing()
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }
}
