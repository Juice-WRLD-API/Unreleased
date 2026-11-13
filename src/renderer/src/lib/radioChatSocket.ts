import { RADIO_API_BASE } from './apiServers'
import { RADIO_CHAT_LINK_MODES, fetchRadioChatTicket } from './radioChatApi'
import type { RadioChatLinks, RadioChatMessage } from './radioChatApi'
import { radioClientId } from './radioSocketService'
import { getToken } from './userApi'
import { mergeLines, useRadioChatStore } from '../store/radioChatStore'
import { useStore } from '../store/useStore'

// The 999 FM chat socket (/ws/radio/chat/). Opened while a chat panel is on
// screen (acquireRadioChat), shared by every panel in the window, and closed a
// few seconds after the last one goes so switching tabs doesn't reconnect.
// Signed in, it trades a ticket so lines show as the account (verified).

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const PING_MS = 25_000
const CLOSE_AFTER_MS = 5_000
const REPLY_TIMEOUT_MS = 8_000
const FALLBACK_RETRY_MS = 2_000

type Frame = { type?: string; [key: string]: unknown }
type SendResult = { ok: true; message: RadioChatMessage } | { ok: false; error: string }
type QueuedLine = { id: string; payload: string; timeoutMs: number; resolve: (result: SendResult) => void }

let ws: WebSocket | null = null
let users = 0
let attempt = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeAccount: (() => void) | null = null
const outbox: QueuedLine[] = []
let sendTimer: ReturnType<typeof setTimeout> | null = null

function wsUrl(): string {
  const url = new URL(RADIO_API_BASE.replace(/\/$/, ''))
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${url.host}${url.pathname}/ws/radio/chat/`
}

const patch = useRadioChatStore.setState

function clearSendTimer(): void {
  if (sendTimer !== null) clearTimeout(sendTimer)
  sendTimer = null
}

function sendNext(): void {
  const line = outbox[0]
  if (!line || sendTimer !== null) return
  if (ws?.readyState !== WebSocket.OPEN) {
    failOutbox('Disconnected before sending.')
    return
  }
  try {
    ws.send(line.payload)
    sendTimer = setTimeout(() => finishSend({ ok: false, error: 'No reply from the chat.' }), line.timeoutMs)
  } catch {
    failOutbox('Not sent.')
  }
}

function finishSend(result: SendResult): void {
  clearSendTimer()
  const line = outbox.shift()
  if (!line) return
  const s = useRadioChatStore.getState()
  patch(result.ok
    ? { pending: s.pending.filter((p) => p.nonce !== line.id), messages: mergeLines(s.messages, [result.message]) }
    : { pending: s.pending.map((p) => p.nonce === line.id ? { ...p, error: result.error } : p) })
  line.resolve(result)
  sendNext()
  scheduleIdleClose()
}

function failOutbox(error: string): void {
  clearSendTimer()
  const failed = outbox.splice(0)
  const ids = new Set(failed.map((line) => line.id))
  if (ids.size) patch({ pending: useRadioChatStore.getState().pending.map((p) => ids.has(p.nonce) ? { ...p, error } : p) })
  for (const line of failed) line.resolve({ ok: false, error })
  scheduleIdleClose()
}

function scheduleIdleClose(): void {
  if (users || outbox.length || closeTimer !== null) return
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (!users && !outbox.length) shutdown()
  }, CLOSE_AFTER_MS)
}

function clearTimers(): void {
  if (retryTimer) clearTimeout(retryTimer)
  if (pingTimer) clearInterval(pingTimer)
  retryTimer = null
  pingTimer = null
}

async function authenticate(socket: WebSocket): Promise<void> {
  if (!useStore.getState().account || !getToken()) return
  patch({ authPending: true })
  try {
    const ticket = await fetchRadioChatTicket()
    if (ws === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'auth', ticket }))
    else patch({ authPending: false })
  } catch {
    // Offline or signed out: lines go out as a guest until the next connect.
    patch({ authPending: false })
  }
}

/** The server's links setting; older servers send none and act as 'signed_in'. */
export function linksMode(value: unknown): RadioChatLinks {
  return RADIO_CHAT_LINK_MODES.some((m) => m.mode === value) ? (value as RadioChatLinks) : 'signed_in'
}

function onFrame(frame: Frame): void {
  const s = useRadioChatStore.getState()
  switch (frame.type) {
    case 'hello':
      patch({
        enabled: !!frame.enabled,
        guestsEnabled: frame.guests_enabled !== false,
        reason: String(frame.reason ?? ''),
        links: linksMode(frame.links),
        // A reconnect replaces the list: lines hidden while we were away must go.
        messages: mergeLines([], (frame.messages as RadioChatMessage[]) ?? []),
      })
      break
    case 'message':
      patch({ messages: mergeLines(s.messages, [frame.message as RadioChatMessage]) })
      break
    case 'sent':
      if (outbox[0]?.id === frame.nonce) finishSend({ ok: true, message: frame.message as RadioChatMessage })
      else patch({
        pending: s.pending.filter((p) => p.nonce !== frame.nonce),
        messages: mergeLines(s.messages, [frame.message as RadioChatMessage]),
      })
      break
    case 'error':
      if (frame.code === 'disabled') patch({ enabled: false, reason: String(frame.detail ?? '') })
      if (frame.code === 'guests_disabled') patch({ guestsEnabled: false })
      if (!outbox.length || outbox[0].id !== frame.nonce) break
      if (frame.code === 'slow_down') {
        clearSendTimer()
        // The server rounds the seconds to one decimal place.
        const seconds = frame.retry_after
        const delay = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
          ? seconds * 1000 + 100
          : FALLBACK_RETRY_MS
        sendTimer = setTimeout(() => { sendTimer = null; sendNext() }, delay)
      } else finishSend({ ok: false, error: String(frame.detail ?? 'Not sent.') })
      break
    case 'state':
      patch({ enabled: !!frame.enabled, guestsEnabled: frame.guests_enabled !== false, reason: String(frame.reason ?? ''), links: linksMode(frame.links) })
      break
    case 'deleted': {
      const ids = new Set((frame.ids as number[]) ?? [])
      patch({ messages: s.messages.filter((m) => !ids.has(m.id)) })
      break
    }
    case 'cleared':
      patch({ messages: [] })
      break
    case 'authenticated':
      patch({ authPending: false, me: { name: String(frame.name ?? ''), role: (frame.role as 'admin' | 'mod' | 'member') ?? 'member' } })
      break
    case 'auth.failed':
      patch({ authPending: false, me: null })
      break
  }
}

function open(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) return
  clearTimers()
  patch({ status: 'connecting' })
  let socket: WebSocket
  try {
    socket = new WebSocket(wsUrl())
  } catch {
    scheduleReconnect()
    return
  }
  ws = socket
  socket.onopen = () => {
    if (ws !== socket) return
    attempt = 0
    patch({ status: 'open', me: null })
    pingTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping') }, PING_MS)
    void authenticate(socket)
  }
  socket.onmessage = (event) => {
    if (ws !== socket || typeof event.data !== 'string' || event.data === 'pong') return
    try { onFrame(JSON.parse(event.data) as Frame) } catch {}
  }
  socket.onclose = () => {
    if (ws !== socket) return
    ws = null
    clearTimers()
    patch({ status: 'closed', me: null, authPending: false })
    failOutbox('Chat disconnected.')
    scheduleReconnect()
  }
  socket.onerror = () => {}
}

function scheduleReconnect(): void {
  if (users === 0 || retryTimer) return
  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
  attempt += 1
  retryTimer = setTimeout(() => { retryTimer = null; open() }, delay)
}

function shutdown(): void {
  clearTimers()
  unsubscribeAccount?.()
  unsubscribeAccount = null
  const socket = ws
  ws = null
  try { socket?.close() } catch {}
  patch({ status: 'idle', me: null, authPending: false, pending: [] })
}

/** Keep the socket open while the caller is on screen. Returns the release. */
export function acquireRadioChat(): () => void {
  users += 1
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  if (!unsubscribeAccount) {
    // Signing in or out mid-chat reconnects, so lines switch identity at once.
    unsubscribeAccount = useStore.subscribe((s, prev) => {
      if (s.account?.id === prev.account?.id) return
      failOutbox('Chat account changed.')
      const socket = ws
      if (socket?.readyState === WebSocket.OPEN) {
        if (s.account) void authenticate(socket)
        else { ws = null; socket.close(); patch({ me: null }); open() }
      }
    })
  }
  open()
  let released = false
  return () => {
    if (released) return
    released = true
    users = Math.max(0, users - 1)
    scheduleIdleClose()
  }
}

function nonce(): string {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64)
}

function enqueueLine(text: string, timeoutMs: number): { id: string; result: Promise<SendResult> } | null {
  const body = text.trim()
  if (!body || ws?.readyState !== WebSocket.OPEN) return null
  const s = useRadioChatStore.getState()
  const id = nonce()
  const name = s.me?.name || s.name.trim()
  const payload = JSON.stringify({ type: 'send', name: s.name.trim() || undefined, text: body, client_id: radioClientId() || undefined, nonce: id })
  const result = new Promise<SendResult>((resolve) => { outbox.push({ id, payload, timeoutMs, resolve }) })
  patch({ pending: [...s.pending, { nonce: id, name: name || 'you', text: body }] })
  sendNext()
  return { id, result }
}

/** Accept a line into the outbox while the chat is connected. */
export function sendRadioChat(text: string): boolean {
  return enqueueLine(text, REPLY_TIMEOUT_MS) !== null
}

export function dismissRadioChatPending(id: string): void {
  patch({ pending: useRadioChatStore.getState().pending.filter((p) => p.nonce !== id) })
}

/** Apply an admin's own switch flip before the socket echoes it. */
export function applyRadioChatState(enabled: boolean, reason = ''): void {
  patch({ enabled, reason: enabled ? '' : reason })
}

export function applyRadioChatGuests(guestsEnabled: boolean): void {
  patch({ guestsEnabled })
}

export function applyRadioChatLinks(links: RadioChatLinks): void {
  patch({ links })
}

export function dropRadioChatLines(ids: number[]): void {
  const gone = new Set(ids)
  patch({ messages: useRadioChatStore.getState().messages.filter((m) => !gone.has(m.id)) })
}

/** Run a command line's worth of chat: open, wait for the socket, post, close. */
export async function sayOnceRadioChat(text: string, timeoutMs = REPLY_TIMEOUT_MS): Promise<SendResult> {
  const release = acquireRadioChat()
  try {
    const started = Date.now()
    while (ws?.readyState !== WebSocket.OPEN) {
      if (Date.now() - started > timeoutMs) return { ok: false, error: 'couldn’t reach the chat' }
      await new Promise((r) => setTimeout(r, 100))
    }
    // Give a signed-in socket a moment to trade its ticket first.
    if (useStore.getState().account && getToken()) {
      const authStarted = Date.now()
      while (!useRadioChatStore.getState().me && Date.now() - authStarted < 2000) await new Promise((r) => setTimeout(r, 100))
    }
    const mine = enqueueLine(text, timeoutMs)
    if (!mine) return { ok: false, error: 'couldn’t send' }
    const result = await mine.result
    if (!result.ok) dismissRadioChatPending(mine.id)
    return result
  } finally {
    release()
  }
}
