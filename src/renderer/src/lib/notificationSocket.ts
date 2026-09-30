import { CHAT_API_BASE } from './apiServers'

// Server-push channel for non-chat notifications (news today; anything the
// server broadcasts via broadcast_notification later). No auth. One shared
// socket, fanned out to listeners by frame `type`.

export interface NotificationFrame {
  type: string
  action?: string
  [key: string]: unknown
}

type Listener = (frame: NotificationFrame) => void

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const PING_MS = 25_000

// Same pairing as the other sockets: which route the proxy upgrades depends on
// deployment, so rotate through both on handshake failure.
const WS_PATHS = ['/juicewrld/ws/notifications/', '/ws/notifications/']

function wsUrl(path: string): string {
  const env = import.meta.env.VITE_JWAPI_WS as string | undefined
  const origin = env
    ? env.replace(/\/$/, '')
    : CHAT_API_BASE.replace(/\/juicewrld\/?$/, '').replace(/^http/, 'ws')
  return `${origin}${path}`
}

const listeners = new Set<Listener>()
const openListeners = new Set<() => void>()
let ws: WebSocket | null = null
let attempt = 0
let pathIndex = 0
let retryTimer: number | null = null
let pingTimer: number | null = null

function stopPing(): void {
  if (pingTimer !== null) window.clearInterval(pingTimer)
  pingTimer = null
}

function open(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) return
  const socket = new WebSocket(wsUrl(WS_PATHS[pathIndex]))
  ws = socket
  let opened = false
  socket.onopen = () => {
    if (ws !== socket) return
    opened = true
    attempt = 0
    stopPing()
    pingTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping')
    }, PING_MS)
    openListeners.forEach((fn) => fn())
  }
  socket.onmessage = (ev) => {
    if (ws !== socket) return
    try {
      const frame = JSON.parse(ev.data as string) as NotificationFrame
      listeners.forEach((fn) => fn(frame))
    } catch {
      // the keepalive reply is the bare text "pong", not JSON - ignore
    }
  }
  socket.onerror = () => {}
  socket.onclose = () => {
    if (ws !== socket) return
    ws = null
    stopPing()
    if (listeners.size === 0 && openListeners.size === 0) return
    let delay: number
    if (!opened && (pathIndex + 1) % WS_PATHS.length !== 0) {
      pathIndex++
      delay = 250
    } else {
      if (!opened) pathIndex = 0
      delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
      attempt++
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      open()
    }, delay)
  }
}

function close(): void {
  if (retryTimer !== null) window.clearTimeout(retryTimer)
  retryTimer = null
  stopPing()
  const socket = ws
  ws = null
  if (socket) try { socket.close() } catch {}
}

/** Subscribe to server notifications. The socket opens with the first
 *  subscriber and closes with the last. `onOpen` fires on every (re)connect -
 *  use it to catch up on anything missed while disconnected. */
export function subscribeNotifications(onFrame: Listener, onOpen?: () => void): () => void {
  listeners.add(onFrame)
  if (onOpen) openListeners.add(onOpen)
  open()
  return () => {
    listeners.delete(onFrame)
    if (onOpen) openListeners.delete(onOpen)
    if (listeners.size === 0 && openListeners.size === 0) close()
  }
}
