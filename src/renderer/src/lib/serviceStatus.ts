// Live outage detection: can this device reach juicewrldapi.com right now?
//
// Runs in the main window only (App calls startOutageMonitor). apiClient
// reports every request to the API origin here; a run of network failures or
// gateway errors is confirmed with /health/, and while that fails the app is
// "down" (ServiceDownBanner, the Status page's banner) and /health/ is polled
// with backoff until it answers again.
//
// History lives on the server (lib/statusApi, the backend's status monitor).
// This only knows what is true now, which the server can't say while it's down.
import { useSyncExternalStore } from 'react'
import { JWAPI_BASE, routeUrl } from './apiServers'
import { showAppToast } from './appToast'

export type LiveState = 'unknown' | 'up' | 'down' | 'offline'

export interface LiveStatus {
  state: LiveState
  /** When this device first found it down, ms timestamp. */
  downSince: number | null
  checking: boolean
  /** Next /health/ poll while down, ms timestamp. */
  nextCheckAt: number | null
}

const TIMEOUT_MS = 10_000
// Failures within this window, with no success between, before /health/ is asked.
const FAILURE_RUN = 2
const FAILURE_WINDOW_MS = 60_000
const POLL_STEPS_MS = [15_000, 30_000, 60_000]
/** Gateway errors mean the server behind the proxy isn't answering. */
const OUTAGE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524])

const apiOrigin = ((): string => {
  try { return new URL(JWAPI_BASE).origin } catch { return '' }
})()

// Pop-outs and the Desktop pages share apiClient but must not poll or raise
// the banner; only the window that called startOutageMonitor does.
let monitoring = false
let snap: LiveStatus = { state: 'unknown', downSince: null, checking: false, nextCheckAt: null }
const listeners = new Set<() => void>()

function publish(patch: Partial<LiveStatus>): void {
  snap = { ...snap, ...patch }
  listeners.forEach((l) => l())
}

export function getStatus(): LiveStatus { return snap }

export function subscribeStatus(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useServiceStatus(): LiveStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

async function checkHealth(): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(routeUrl('/health/'), { cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) return false
    return (await res.json().catch(() => null))?.status === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const deviceOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false

let failures: number[] = []
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollStep = 0
let rechecking: Promise<boolean> | null = null

function clearPoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(): void {
  clearPoll()
  if (!monitoring) return
  const delay = POLL_STEPS_MS[Math.min(pollStep, POLL_STEPS_MS.length - 1)]
  pollStep++
  publish({ nextCheckAt: Date.now() + delay })
  pollTimer = setTimeout(() => { void recheck() }, delay)
}

function goDown(): void {
  publish({ state: 'down', downSince: snap.downSince ?? Date.now() })
  schedulePoll()
}

function goOffline(): void {
  // The device lost its connection: not the server's outage.
  clearPoll()
  publish({ state: 'offline', nextCheckAt: null })
}

function goUp(): void {
  clearPoll()
  pollStep = 0
  failures = []
  const wasDown = snap.state === 'down'
  publish({ state: 'up', downSince: null, nextCheckAt: null })
  if (wasDown && monitoring) showAppToast('juicewrldapi.com is back up', { tone: 'info' })
}

/** Asks /health/ now. Overlapping calls share one request. */
export function recheck(): Promise<boolean> {
  rechecking ??= (async () => {
    clearPoll()
    publish({ checking: true })
    const ok = await checkHealth().finally(() => publish({ checking: false }))
    if (ok) goUp()
    else if (deviceOffline()) goOffline()
    else goDown()
    return ok
  })().finally(() => { rechecking = null })
  return rechecking
}

/** Called by apiClient for every request it sends. `status` is null for a
 *  network failure (no response at all); aborted requests are not reported. */
export function noteApiResult(url: string, status: number | null): void {
  if (!monitoring || !apiOrigin || !url.startsWith(apiOrigin)) return
  const failed = status === null || OUTAGE_STATUSES.has(status)
  if (!failed) {
    failures = []
    if (snap.state === 'down' || snap.state === 'offline') void recheck()
    else if (snap.state === 'unknown') publish({ state: 'up' })
    return
  }
  if (snap.state === 'down') return
  const now = Date.now()
  failures = [...failures.filter((t) => now - t < FAILURE_WINDOW_MS), now]
  if (failures.length >= FAILURE_RUN) void recheck()
}

/** Starts the outage monitor. Main window only (App). Returns a stop. */
export function startOutageMonitor(): () => void {
  if (monitoring) return () => {}
  monitoring = true
  const onOnline = (): void => { if (snap.state === 'offline' || snap.state === 'down') void recheck() }
  const onOffline = (): void => { if (snap.state !== 'down') goOffline() }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    monitoring = false
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    clearPoll()
  }
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}
