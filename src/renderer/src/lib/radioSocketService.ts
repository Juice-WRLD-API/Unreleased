import { JWAPI_BASE } from './juicewrldApi'
import { resumeEffectsContext } from './audioEffects'
import { getToken } from './userApi'
import type { RadioLiveState } from './radioLive'

const CLIENT_ID_KEY = 'radioClientId'

// A durable id for this browser profile. Without it the server can only identify
// a listener by socket, so every reload looks like a new voter and every extra
// tab like another one - which quietly inflates the vote threshold.
function radioClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 64)
    localStorage.setItem(CLIENT_ID_KEY, id)
    return id
  } catch {
    return ''
  }
}

const RECONNECT_MS = 3000
const RECONNECT_MAX_MS = 30000
const LIVE_LAG_SEC = 6
const TRIM_KEEP_SEC = 30
const TRIM_FORCE_SEC = 2

const mseSupported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.MediaSource !== 'undefined' &&
  window.MediaSource.isTypeSupported('audio/mpeg')

export interface RadioStreamClientOptions {
  onMeta?: (data: RadioLiveState) => void
  onOpen?: () => void
  onClose?: () => void
  onListening?: (active: boolean) => void
}

export class RadioStreamClient {
  private onMeta: (data: RadioLiveState) => void
  private onOpen: () => void
  private onClose: () => void
  private onListening: (active: boolean) => void
  private ws: WebSocket | null = null
  private shouldReconnect = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = RECONNECT_MS
  private audioEl: HTMLAudioElement | null = null
  private mediaSource: MediaSource | null = null
  private sourceBuffer: SourceBuffer | null = null
  private queue: Uint8Array[] = []
  private listening = false
  private objectUrl: string | null = null
  private supportsMse = mseSupported()

  constructor({ onMeta, onOpen, onClose, onListening }: RadioStreamClientOptions = {}) {
    this.onMeta = onMeta ?? (() => {})
    this.onOpen = onOpen ?? (() => {})
    this.onClose = onClose ?? (() => {})
    this.onListening = onListening ?? (() => {})
  }

  private get wsUrl(): string {
    const base = JWAPI_BASE.replace(/\/$/, '')
    const url = new URL(base)
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${url.host}${url.pathname}/ws/radio/`
  }

  private get httpStreamUrl(): string {
    return `${JWAPI_BASE.replace(/\/$/, '')}/radio/stream.mp3`
  }

  attach(audioEl: HTMLAudioElement): void {
    this.audioEl = audioEl
  }

  isListening(): boolean {
    return this.listening
  }

  connect(): void {
    this.shouldReconnect = true
    this.open()
  }

  private open(): void {
    // A socket that is still CONNECTING or OPEN must never be replaced: the
    // orphan keeps delivering metadata and the server counts it as a second
    // listener, inflating the denominator the quarter vote threshold uses.
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return
    this.clearReconnectTimer()
    try {
      const ws = new WebSocket(this.wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        if (this.ws !== ws) return
        this.clearReconnectTimer()
        this.reconnectDelay = RECONNECT_MS
        this.onOpen()
        if (this.listening) this.sendListening(true)
      }
      ws.onmessage = (event) => {
        if (this.ws !== ws) return
        this.onMessage(event)
      }
      ws.onclose = () => this.onCloseHandler(ws)
      ws.onerror = () => {}
      this.ws = ws
    } catch (error) {
      console.warn('[radio] websocket open failed', error)
      this.scheduleReconnect()
    }
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
      try {
        this.onMeta(JSON.parse(event.data) as RadioLiveState)
      } catch (error) {
        console.warn('[radio] bad metadata frame', error)
      }
      return
    }
    if (this.listening && this.supportsMse) {
      this.enqueue(event.data as ArrayBuffer)
    }
  }

  private onCloseHandler(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.ws = null
    this.onClose()
    this.scheduleReconnect()
  }

  private sendListening(value: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify({
        type: 'listening',
        value,
        audio: this.supportsMse ? 'ws' : 'http',
        // Identity for vote de-duplication. The token wins when signed in, so
        // the same person on the site and in Discord counts once.
        token: getToken() ?? undefined,
        client_id: radioClientId() || undefined,
      }))
    } catch (error) {
      console.warn('[radio] listening update failed', error)
    }
  }

  private send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  // The server drops propose_skip/propose_queue/vote unless it has seen
  // listening:true on this socket, so sending while not listening looks like it
  // worked but never reaches the DJ.
  canVote(): boolean {
    return this.listening && !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  proposeSkip(): boolean {
    if (!this.canVote()) return false
    return this.send({ type: 'propose_skip' })
  }

  // `track_id` is the only field the relay forwards, and it must be the id from
  // GET /radio/library/ - the DJ resolves it against a path hash, so a numeric
  // /songs/ id can never match.
  proposeQueue(trackId: string): boolean {
    if (!this.canVote()) return false
    const id = String(trackId).trim()
    if (!id) return false
    return this.send({ type: 'propose_queue', track_id: id })
  }

  castVote(value: 'yes' | 'no'): boolean {
    if (!this.canVote()) return false
    return this.send({ type: 'vote', value })
  }

  // Recovery nudge for mobile background tabs - browsers can silently close
  // the websocket and/or pause the audio element while hidden, without firing
  // the events this class normally reacts to. Safe to call repeatedly: it's a
  // no-op when the connection/audio are already healthy.
  checkHealth(): void {
    if (!this.shouldReconnect) return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.open()
    }
    if (this.listening && this.audioEl?.paused) {
      resumeEffectsContext()
      this.audioEl.play().catch(() => {})
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    this.clearReconnectTimer()
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.reconnectDelay = RECONNECT_MS
    this.stopListening()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }

  async startListening(): Promise<void> {
    if (!this.audioEl) return
    if (this.listening) {
      resumeEffectsContext()
      await this.audioEl.play().catch(() => {})
      return
    }
    this.listening = true
    this.onListening(true)
    this.sendListening(true)
    if (!this.supportsMse) {
      this.audioEl.src = `${this.httpStreamUrl}?_=${Date.now()}`
      resumeEffectsContext()
      await this.audioEl.play()
      return
    }
    this.queue = []
    this.mediaSource = new window.MediaSource()
    this.objectUrl = URL.createObjectURL(this.mediaSource)
    this.audioEl.src = this.objectUrl
    this.mediaSource.addEventListener(
      'sourceopen',
      () => {
        try {
          this.sourceBuffer = this.mediaSource!.addSourceBuffer('audio/mpeg')
          this.sourceBuffer.mode = 'sequence'
          this.sourceBuffer.addEventListener('updateend', () => this.afterAppend())
          this.pump()
        } catch {}
      },
      { once: true }
    )
  }

  stopListening(): void {
    this.sendListening(false)
    this.listening = false
    this.onListening(false)
    this.queue = []
    if (this.audioEl) {
      try {
        this.audioEl.pause()
      } catch {}
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream()
      } catch {}
    }
    this.sourceBuffer = null
    this.mediaSource = null
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    if (this.audioEl) {
      try {
        this.audioEl.removeAttribute('src')
        this.audioEl.load()
      } catch {}
    }
  }

  private enqueue(arrayBuffer: ArrayBuffer): void {
    this.queue.push(new Uint8Array(arrayBuffer))
    this.pump()
  }

  private pump(): void {
    const sb = this.sourceBuffer
    if (!sb || sb.updating || !this.queue.length) return
    const chunk = this.queue.shift()!
    const copy = new Uint8Array(chunk.length)
    copy.set(chunk)
    try {
      sb.appendBuffer(copy)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.queue.unshift(chunk)
        this.trim(true)
      }
    }
  }

  private afterAppend(): void {
    this.seekToLive()
    this.trim(false)
    this.pump()
    if (this.audioEl && this.audioEl.paused && this.listening) {
      resumeEffectsContext()
      this.audioEl.play().catch(() => {})
    }
  }

  private seekToLive(): void {
    const el = this.audioEl
    const sb = this.sourceBuffer
    if (!el || !sb || !sb.buffered.length) return
    const end = sb.buffered.end(sb.buffered.length - 1)
    if (end - el.currentTime > LIVE_LAG_SEC) {
      try {
        el.currentTime = end - 1
      } catch {}
    }
  }

  private trim(force: boolean): void {
    const sb = this.sourceBuffer
    const el = this.audioEl
    if (!sb || sb.updating || !sb.buffered.length || !el) return
    const start = sb.buffered.start(0)
    const keepFrom = el.currentTime - (force ? TRIM_FORCE_SEC : TRIM_KEEP_SEC)
    if (keepFrom > start + 1) {
      try {
        sb.remove(start, keepFrom)
      } catch {}
    }
  }
}

// Module-level singleton so non-React code can call client methods
let _activeRadioClient: RadioStreamClient | null = null
export function getActiveRadioClient(): RadioStreamClient | null { return _activeRadioClient }
export function setActiveRadioClient(c: RadioStreamClient | null): void { _activeRadioClient = c }
