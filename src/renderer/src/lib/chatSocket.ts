import { CHAT_API_BASE } from './apiServers'
import { getToken } from './userApi'
import type { NowPlayingState } from './userApi'
import type { ChannelOverride, ChatChannel, ChatMember, ChatMessage, ChatServer, Conversation, ServerBan, ServerRoleDef } from './chatApi'

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
  | { type: 'now_playing.updated'; user_id: number; now_playing: NowPlayingState | null }
  | { type: 'member.joined' | 'member.updated'; server: number; member: ChatMember }
  | { type: 'member.left'; server: number; user_id: number }
  | { type: 'member.timeout'; server: number; member: ChatMember }
  | { type: 'member.banned'; server: number; ban: ServerBan }
  | { type: 'member.unbanned'; server: number; user_id: number }
  // Pushed to a user whose access changed (moderation, override edits) - the
  // client re-fetches its server list and memberships. Distinct from
  // 'resynced', which is only the ack for a client-sent resync.
  | { type: 'resync' }
  | { type: 'server.updated'; server: ChatServer }
  | { type: 'channel.created' | 'channel.updated'; server: number; channel: ChatChannel }
  | { type: 'channel.deleted'; server: number; channel_id: number }
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'key.rotated'; conversation: number; key_version: number }
  | { type: 'device.added'; conversation: number; user_id: number }
  | { type: 'envelope.available'; conversation: number; key_version: number }
  | { type: 'role.created' | 'role.updated'; server: number; role: ServerRoleDef }
  | { type: 'role.deleted'; server: number; role_id: number }
  | { type: 'channel.override.updated'; server: number; channel: number; override: ChannelOverride }
  | { type: 'channel.override.deleted'; server: number; channel: number; override_id: number }

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unauthorized'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const PING_MS = 25_000
const PONG_TIMEOUT_MS = 10_000
const UNAUTHORIZED = 4401

// The API documents both routes; which one the proxy actually upgrades depends
// on deployment (the prefixed one has been answering 502), so rotate through
// them on handshake failure and stick with whichever opens.
const WS_PATHS = ['/juicewrld/ws/chat/', '/ws/chat/']

function wsUrl(token: string, path: string): string {
  const env = import.meta.env.VITE_JWAPI_WS as string | undefined
  const origin = env
    ? env.replace(/\/$/, '')
    : CHAT_API_BASE.replace(/\/juicewrld\/?$/, '').replace(/^http/, 'ws')
  return `${origin}${path}?token=${encodeURIComponent(token)}`
}

export class ChatSocket {
  private ws: WebSocket | null = null
  private attempt = 0
  private retryTimer: number | null = null
  private pingTimer: number | null = null
  private pongTimer: number | null = null
  private pongSeen = false
  private pathIndex = 0
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
    const ws = new WebSocket(wsUrl(token, WS_PATHS[this.pathIndex]))
    this.ws = ws
    let opened = false
    ws.onopen = () => {
      if (this.ws !== ws || this.disposed) return
      opened = true
      this.attempt = 0
      this.onStatus('open')
      this.startPing()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      if (this.pongTimer !== null) {
        window.clearTimeout(this.pongTimer)
        this.pongTimer = null
      }
      try {
        const parsed = JSON.parse(ev.data as string) as ChatEvent
        if (parsed.type === 'pong') this.pongSeen = true
        this.onEvent(parsed)
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
      let delay: number
      if (!opened && (this.pathIndex + 1) % WS_PATHS.length !== 0) {
        // Handshake failed on this route but another is still untried this
        // round - move on to it right away instead of backing off.
        this.pathIndex++
        delay = 250
      } else {
        if (!opened) this.pathIndex = 0
        delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]
        this.attempt++
      }
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null
        this.open()
      }, delay)
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = window.setInterval(() => {
      if (!this.send({ type: 'ping' })) return
      // A dead-but-not-closed TCP connection (sleep/wake, network switch, an
      // idle-killing proxy) leaves readyState stuck at OPEN forever - no
      // close/error event ever fires. An unanswered ping is the only signal,
      // but only trust it once the server has shown it answers pings at all,
      // otherwise a quiet healthy socket would be torn down every cycle.
      if (!this.pongSeen) return
      if (this.pongTimer !== null) window.clearTimeout(this.pongTimer)
      this.pongTimer = window.setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS)
    }, PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.pongTimer !== null) {
      window.clearTimeout(this.pongTimer)
      this.pongTimer = null
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
