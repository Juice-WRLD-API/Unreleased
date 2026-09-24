import { getToken } from './userApi'
import { baseFor, routeUrl } from './juicewrldApi'
import { apiRequest, authHeaders } from './apiClient'
import type { Guess, GameStatus, HeardleSong } from './heardle'
import { absoluteClipUrl, type PuzzleResponse } from './heardleApi'

const MATCH_QUEUE_URL = routeUrl('/heardle/match/queue/')

export interface MatchEndReveal {
  id: number
  name: string
  titles?: string[]
  era?: string | null
  category?: string
  imageUrl?: string
  length?: string
}

/** No 'matched' step: the server hands over the first round together with the
 *  pairing, so being matched *is* being in play. A separate state was never
 *  set by anything and had no UI behind it. */
export type MatchPhase = 'idle' | 'queue' | 'playing' | 'ended'

export interface MatchEndPayload {
  type: 'match_end'
  winner_id?: number | null
  drawn?: boolean
  reason?: string
  user_id?: number
  my_guess_count?: number
  opponent_guess_count?: number
  reveal?: MatchEndReveal | null
}

function wsOrigin(): string {
  const env = import.meta.env.VITE_JWAPI_WS as string | undefined
  if (env) return env.replace(/\/$/, '')
  const apiRoot = baseFor('/heardle').replace(/\/juicewrld\/?$/, '')
  return apiRoot.replace(/^http/, 'ws')
}

export interface OpponentProgress {
  user_id: number
  guess_count: number
  status: GameStatus
}

export interface HeardleMatchCallbacks {
  onConnected?: () => void
  onQueueWaiting?: () => void
  onQueueError?: (message: string) => void
  onGuessError?: (message: string) => void
  onMatched: (matchId: string, round?: PuzzleResponse) => void
  onRound: (round: PuzzleResponse) => void
  onOpponent: (progress: OpponentProgress) => void
  onEnd: (payload: MatchEndPayload) => void
  onError: (message: string) => void
  /** The socket dropped. Fired on every unexpected close, not on teardown -
   *  the UI has to say so, because a match can't be played without it. */
  onDisconnected?: () => void
  /** Back up after a drop, with the match re-bound. */
  onReconnected?: () => void
}

let socket: WebSocket | null = null
let pendingQueueJoin = false
let pendingMatchAck: string | null = null
// Survives a drop so a reconnect can re-bind to the match in progress -
// unlike pendingMatchAck, which is consumed the moment it's delivered.
let lastMatchId: string | null = null

// Backoff for an unexpected drop. Capped rather than unbounded: a match is
// live, so giving up on it is worse than a slow retry.
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000]

function wsUrl(): string {
  const token = getToken()
  const base = `${wsOrigin()}/juicewrld/ws/heardle/match/`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

function flushPending(): void {
  if (socket?.readyState !== WebSocket.OPEN) return
  // Re-ack the live match on every open, so a reconnect lands back in it
  // rather than leaving the player staring at a match the server no longer
  // associates with this socket.
  const ack = pendingMatchAck ?? lastMatchId
  if (ack) {
    socket.send(JSON.stringify({ type: 'match_ack', match_id: ack }))
    pendingMatchAck = null
  }
  if (pendingQueueJoin) {
    pendingQueueJoin = false
    socket.send(JSON.stringify({ type: 'queue_join' }))
  }
}

export function connectMatchSocket(callbacks: HeardleMatchCallbacks, userId?: number): () => void {
  if (socket) {
    try { socket.close() } catch {}
    socket = null
  }
  // A fresh connect is a fresh session - nothing queued against the previous
  // socket should be replayed onto this one.
  pendingQueueJoin = false
  pendingMatchAck = null
  lastMatchId = null
  let disposed = false
  let attempt = 0
  let retryTimer: number | null = null

  const open = (): void => {
    if (disposed) return
    const ws = new WebSocket(wsUrl())
    socket = ws
    ws.onopen = () => {
      // A disposer that fired while this socket was still connecting.
      if (disposed) { try { ws.close() } catch {} ; return }
      const recovered = attempt > 0
      attempt = 0
      callbacks.onConnected?.()
      flushPending()
      if (recovered) callbacks.onReconnected?.()
    }
    ws.onmessage = handleMessage
    ws.onerror = () => callbacks.onError('Connection error')
    ws.onclose = () => {
      if (socket === ws) socket = null
      if (disposed) return
      callbacks.onDisconnected?.()
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
      attempt++
      retryTimer = window.setTimeout(open, delay)
    }
  }

  const handleMessage = (ev: MessageEvent): void => {
    try {
      const data = JSON.parse(ev.data as string) as Record<string, unknown>
      const type = data.type as string
      if (type === 'connected') return
      if (type === 'queue_waiting') {
        callbacks.onQueueWaiting?.()
        return
      }
      if (type === 'queue_error') {
        callbacks.onQueueError?.(String(data.message ?? 'Queue failed'))
        return
      }
      if (type === 'guess_error') {
        callbacks.onGuessError?.(String(data.message ?? 'Guess failed'))
        return
      }
      if (type === 'matched') {
        callbacks.onMatched(String(data.match_id), data.round as PuzzleResponse | undefined)
        return
      }
      if (type === 'guess_update') {
        const progress = {
          user_id: Number(data.user_id),
          guess_count: Number(data.guess_count),
          status: data.status as GameStatus,
        }
        if (userId && progress.user_id === userId) {
          // The round is how your own guess list advances - there's no other
          // message carrying it, so a self update without one leaves the board
          // frozen. The server is expected to always attach it here.
          if (data.round) callbacks.onRound(data.round as PuzzleResponse)
        } else {
          callbacks.onOpponent(progress)
        }
        return
      }
      if (type === 'match_end') {
        // The match is over - a later reconnect must not re-ack it.
        lastMatchId = null
        callbacks.onEnd(data as unknown as MatchEndPayload)
        return
      }
    } catch {
      callbacks.onError('Invalid match message')
    }
  }

  open()

  return () => {
    disposed = true
    pendingQueueJoin = false
    pendingMatchAck = null
    lastMatchId = null
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    if (socket) {
      try { socket.close() } catch {}
      socket = null
    }
  }
}

/** Whether a message can actually be delivered right now. The REST queue is
 *  a fallback for exactly the times this is false. */
export function isMatchSocketOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

export function sendQueueJoin(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'queue_join' }))
  } else {
    pendingQueueJoin = true
  }
}

export function sendQueueLeave(): void {
  pendingQueueJoin = false
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'queue_leave' }))
  }
}

export function sendLeaveMatch(): void {
  pendingMatchAck = null
  lastMatchId = null
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'leave_match' }))
  }
}

/** Returns false when the socket wasn't open, so the caller can tell the
 *  player their guess didn't go anywhere instead of clearing the input and
 *  leaving them to think it was accepted. */
export function sendMatchGuess(songId: number | null, skip = false, matchId?: string | null): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  const payload: Record<string, unknown> = { type: 'guess', song_id: songId, skip }
  if (matchId) payload.match_id = matchId
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function ackMatchSocket(matchId: string): void {
  lastMatchId = matchId
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'match_ack', match_id: matchId }))
    pendingMatchAck = null
  } else {
    pendingMatchAck = matchId
  }
}

export interface MatchQueuePollResult {
  queued: boolean
  matchId?: string
  round?: PuzzleResponse
}

export async function pollMatchQueue(): Promise<MatchQueuePollResult> {
  const token = getToken()
  if (!token) return { queued: true }
  const data = await apiRequest<{ queued: boolean; match_id?: string; round?: PuzzleResponse }>(
    MATCH_QUEUE_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    },
  )
  return {
    queued: Boolean(data.queued),
    matchId: data.match_id,
    round: data.round,
  }
}

/** Drops the REST-side queue entry. Idempotent and best-effort: it runs on
 *  every cancel because pollMatchQueue may have enqueued the player over HTTP
 *  while the socket was down, and an entry nobody is watching can still be
 *  matched into a match that then forfeits. */
export async function leaveMatchQueueRest(): Promise<void> {
  const token = getToken()
  if (!token) return
  try {
    await apiRequest(MATCH_QUEUE_URL, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
  } catch {
    // A queue entry that was never created 404s; nothing to recover from.
  }
}

export function puzzleFromMatchRound(round: PuzzleResponse): {
  roundToken: string
  clipUrl: string
  clipStart: number
  guesses: Guess[]
  status: GameStatus
  reveal: HeardleSong | null
  ladder: number[]
} {
  return {
    roundToken: round.round_token,
    clipUrl: absoluteClipUrl(round.clip_url),
    clipStart: round.clip_start,
    guesses: round.guesses ?? [],
    status: round.status,
    reveal: round.reveal ?? null,
    ladder: round.ladder ?? [],
  }
}
