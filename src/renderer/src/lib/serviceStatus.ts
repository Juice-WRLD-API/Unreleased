// Service status: is juicewrldapi.com up, and which parts of it answer.
//
// Two halves. checkServices() probes each part of the API once (health,
// catalogue, files, streaming, 999 FM) for the Status page and the
// `downtime` terminal command. The outage monitor runs in the main window
// only: apiClient reports every request to the API base here, a run of
// network failures or gateway errors is confirmed with /health/, and while
// that fails the app is "down" (banner, Status page) and /health/ is polled
// with backoff until it answers again.
//
// Outages are kept per device in localStorage. They are what this device saw
// while the app was open, not a server-side uptime record: when the API is
// down there is nobody to ask for one.
import { useSyncExternalStore } from 'react'
import { JWAPI_BASE, RADIO_API_BASE, routeUrl } from './apiServers'
import { showAppToast } from './appToast'

export type ServiceId = 'api' | 'catalogue' | 'files' | 'streaming' | 'radio'
export type ServiceState = 'up' | 'slow' | 'down'
export type Overall = 'unknown' | 'up' | 'degraded' | 'partial' | 'down' | 'offline'

export interface ServiceResult {
  id: ServiceId
  label: string
  description: string
  state: ServiceState
  /** Round trip in ms, null when it never answered. */
  ms: number | null
  /** Why it counts as down: an HTTP status or "timed out". */
  detail?: string
}

export interface Outage {
  start: number
  /** Last time this device saw it still down. */
  lastSeen: number
  /** null while ongoing. */
  end: number | null
  /** The app was closed when it ended, so `end` is the last time it was seen down. */
  endApprox?: boolean
}

export interface StatusSnapshot {
  overall: Overall
  /** When `overall` last changed. */
  since: number
  checkedAt: number | null
  checking: boolean
  services: ServiceResult[]
  /** Next /health/ poll while down, ms timestamp. */
  nextCheckAt: number | null
  outages: Outage[]
}

const SERVICES: { id: ServiceId; label: string; description: string }[] = [
  { id: 'api', label: 'API', description: 'juicewrldapi.com itself' },
  { id: 'catalogue', label: 'Catalogue', description: 'Songs, eras and the Tracker' },
  { id: 'files', label: 'Files', description: 'The file archive and comp channels' },
  { id: 'streaming', label: 'Streaming', description: 'Playing songs from the server' },
  { id: 'radio', label: '999 FM', description: 'The live radio' },
]

const TIMEOUT_MS = 10_000
const SLOW_MS = 3_000
// Failures within this window, with no success between, before /health/ is asked.
const FAILURE_RUN = 2
const FAILURE_WINDOW_MS = 60_000
const POLL_STEPS_MS = [15_000, 30_000, 60_000]
const OUTAGES_KEY = 'unreleased:outages'
const MAX_OUTAGES = 30
// A reopened app whose last outage was last seen longer ago than this can't
// say when it ended, only that it was over by the next check.
const RESUME_GAP_MS = 5 * 60_000

// Only the main window watches for outages (App starts it). Pop-outs and the
// Desktop pages share apiClient but must not keep a second outage log, poll
// /health/ or raise the banner.
let monitoring = false

const apiOrigin = ((): string => {
  try { return new URL(JWAPI_BASE).origin } catch { return '' }
})()

function loadOutages(): Outage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTAGES_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((o) => typeof o?.start === 'number') : []
  } catch {
    return []
  }
}

function saveOutages(list: Outage[]): void {
  try { localStorage.setItem(OUTAGES_KEY, JSON.stringify(list.slice(0, MAX_OUTAGES))) } catch {}
}

let snap: StatusSnapshot = {
  overall: 'unknown',
  since: Date.now(),
  checkedAt: null,
  checking: false,
  services: SERVICES.map((s) => ({ ...s, state: 'up', ms: null })),
  nextCheckAt: null,
  outages: [],
}
const listeners = new Set<() => void>()

function publish(patch: Partial<StatusSnapshot>): void {
  const next = { ...snap, ...patch }
  if (patch.overall && patch.overall !== snap.overall) next.since = Date.now()
  snap = next
  listeners.forEach((l) => l())
}

export function getStatus(): StatusSnapshot { return snap }

export function subscribeStatus(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useServiceStatus(): StatusSnapshot {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

// ── Probes ──────────────────────────────────────────────────────────────────

interface Probe { ok: boolean; ms: number; status?: number; body?: unknown; detail?: string }

async function probe(url: string, init: RequestInit = {}, readJson = false): Promise<Probe> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const t0 = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, signal: ctrl.signal })
    const body = readJson && res.ok ? await res.json().catch(() => undefined) : undefined
    if (!readJson) res.body?.cancel().catch(() => {})
    const ms = Math.round(performance.now() - t0)
    return { ok: res.ok, ms, status: res.status, body, detail: res.ok ? undefined : `HTTP ${res.status}` }
  } catch {
    const ms = Math.round(performance.now() - t0)
    return { ok: false, ms, detail: ctrl.signal.aborted ? 'timed out' : 'no answer' }
  } finally {
    clearTimeout(timer)
  }
}

function toResult(id: ServiceId, p: Probe): ServiceResult {
  const def = SERVICES.find((s) => s.id === id)!
  return { ...def, state: !p.ok ? 'down' : p.ms >= SLOW_MS ? 'slow' : 'up', ms: p.ok ? p.ms : null, detail: p.detail }
}

const healthUrl = (): string => routeUrl('/health/')

async function checkHealth(): Promise<boolean> {
  const p = await probe(healthUrl(), {}, true)
  return p.ok && (p.body as { status?: string } | undefined)?.status === 'ok'
}

let checkRun: Promise<ServiceResult[]> | null = null

/** Probes every service once and updates the snapshot. Overlapping calls share a run. */
export function checkServices(): Promise<ServiceResult[]> {
  if (checkRun) return checkRun
  publish({ checking: true })
  checkRun = (async () => {
    const [api, catalogue, files, radio] = await Promise.all([
      probe(healthUrl(), {}, true),
      probe(routeUrl('/songs/?page_size=20&omit=lyrics,synced_lyrics,groupbuy_info'), {}, true),
      probe(routeUrl('/files/channels/')),
      probe(`${RADIO_API_BASE}/radio/live/`),
    ])
    if (api.ok && (api.body as { status?: string } | undefined)?.status !== 'ok') {
      api.ok = false
      api.detail = 'unexpected answer'
    }
    // Streams come from their own server process, so ask for two bytes of a
    // real song: the first catalogue song on the page that has a file.
    const first = (catalogue.body as { results?: { path?: string | null }[] } | undefined)?.results?.find((s) => s.path)
    const streaming: Probe = first?.path
      ? await probe(routeUrl(`/files/download/?path=${encodeURIComponent(first.path)}`), { headers: { Range: 'bytes=0-1' } })
      : { ok: false, ms: 0, detail: catalogue.ok ? 'no song to try' : 'needs the catalogue' }
    const results = [
      toResult('api', api), toResult('catalogue', catalogue), toResult('files', files),
      toResult('streaming', streaming), toResult('radio', radio),
    ]
    publish({ services: results, checkedAt: Date.now() })
    applyOverall(results)
    return results
  })().finally(() => {
    checkRun = null
    publish({ checking: false })
  })
  return checkRun
}

function deviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function applyOverall(results: ServiceResult[]): void {
  const api = results.find((r) => r.id === 'api')
  if (deviceOffline()) { goOffline(); return }
  if (api?.state === 'down') { goDown(); return }
  const overall: Overall = results.some((r) => r.state === 'down') ? 'partial' : results.some((r) => r.state === 'slow') ? 'degraded' : 'up'
  goUp(overall)
}

// ── Outage monitor ──────────────────────────────────────────────────────────

let failures: number[] = []
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollStep = 0
let confirming = false

function clearPoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(): void {
  clearPoll()
  const delay = POLL_STEPS_MS[Math.min(pollStep, POLL_STEPS_MS.length - 1)]
  pollStep++
  publish({ nextCheckAt: Date.now() + delay })
  pollTimer = setTimeout(() => { void recheck() }, delay)
}

let rechecking: Promise<boolean> | null = null

/** Asks /health/ now (the page's "Check now" while down, `downtime retry`).
 *  Overlapping calls share one request. */
export function recheck(): Promise<boolean> {
  rechecking ??= runRecheck().finally(() => { rechecking = null })
  return rechecking
}

async function runRecheck(): Promise<boolean> {
  clearPoll()
  publish({ checking: true })
  const ok = await checkHealth().finally(() => publish({ checking: false }))
  if (ok) {
    // Fill in the rest of the page now that it answers again.
    const cur = snap.overall
    goUp(cur === 'degraded' || cur === 'partial' ? cur : 'up')
    void checkServices()
  } else if (deviceOffline()) {
    goOffline()
  } else {
    goDown()
  }
  return ok
}

function goDown(): void {
  if (!monitoring) { publish({ overall: 'down' }); return }
  const now = Date.now()
  const outages = [...snap.outages]
  const open = outages[0]?.end === null ? outages[0] : null
  if (open && now - open.lastSeen <= RESUME_GAP_MS) {
    outages[0] = { ...open, lastSeen: now }
  } else {
    // One left open by a closed app, last seen long ago, is its own outage.
    if (open) outages[0] = { ...open, end: open.lastSeen, endApprox: true }
    outages.unshift({ start: now, lastSeen: now, end: null })
  }
  saveOutages(outages)
  publish({ overall: 'down', outages })
  schedulePoll()
}

function goOffline(): void {
  // The device lost its connection: not the server's outage, so nothing is logged.
  clearPoll()
  publish({ overall: 'offline', nextCheckAt: null })
}

function goUp(overall: Exclude<Overall, 'down' | 'offline' | 'unknown'>): void {
  clearPoll()
  pollStep = 0
  failures = []
  const wasDown = snap.overall === 'down'
  const open = snap.outages[0]
  if (monitoring && open && open.end === null) {
    const now = Date.now()
    const gap = now - open.lastSeen
    const closed: Outage = gap > RESUME_GAP_MS ? { ...open, end: open.lastSeen, endApprox: true } : { ...open, end: now }
    const outages = [closed, ...snap.outages.slice(1)]
    saveOutages(outages)
    publish({ overall, outages, nextCheckAt: null })
  } else {
    publish({ overall, nextCheckAt: null })
  }
  if (wasDown && monitoring) showAppToast('juicewrldapi.com is back up', { tone: 'info' })
}

async function confirmOutage(): Promise<void> {
  if (confirming || snap.overall === 'down') return
  confirming = true
  try {
    const ok = await checkHealth()
    if (ok) { failures = []; return }
    if (deviceOffline()) goOffline()
    else goDown()
  } finally {
    confirming = false
  }
}

/** Gateway errors mean the server behind the proxy isn't answering. */
const OUTAGE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524])

/** Called by apiClient for every request it sends. `status` is null for a
 *  network failure (no response at all); aborted requests are not reported. */
export function noteApiResult(url: string, status: number | null): void {
  if (!monitoring || !apiOrigin || !url.startsWith(apiOrigin)) return
  const failed = status === null || OUTAGE_STATUSES.has(status)
  if (!failed) {
    failures = []
    // A real answer while marked down or offline: it's back.
    if (snap.overall === 'down' || snap.overall === 'offline') void recheck()
    return
  }
  if (snap.overall === 'down') return
  const now = Date.now()
  failures = [...failures.filter((t) => now - t < FAILURE_WINDOW_MS), now]
  if (failures.length >= FAILURE_RUN) void confirmOutage()
}

/** Forgets this device's outage log (an ongoing outage stays). */
export function clearOutages(): void {
  const outages = snap.outages.filter((o) => o.end === null)
  saveOutages(outages)
  publish({ outages })
}

/** Starts the outage monitor. Main window only (App). Returns a stop. */
export function startOutageMonitor(): () => void {
  if (monitoring) return () => {}
  monitoring = true
  publish({ outages: loadOutages() })
  const onOnline = (): void => { if (snap.overall === 'offline' || snap.overall === 'down') void recheck() }
  const onOffline = (): void => { if (snap.overall !== 'down') goOffline() }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  // An outage left open by a closed app: find out how it ended.
  const resume = snap.outages[0]?.end === null ? setTimeout(() => { void recheck() }, 3_000) : null
  return () => {
    monitoring = false
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (resume) clearTimeout(resume)
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

export const OVERALL_TEXT: Record<Overall, string> = {
  unknown: 'Checking…',
  up: 'Everything is working',
  degraded: 'Everything works, but slowly',
  partial: 'Some services are down',
  down: 'juicewrldapi.com is down',
  offline: 'You’re offline',
}
