// The status page's data: 90 days of per-service history and incidents,
// recorded on the server by its status monitor (backend docs/24-status-page.md).
// The last copy is kept in the offline cache, so the page still has its
// history while the server is down.
import { routeUrl } from './apiServers'
import { apiRequest, authedRequest } from './apiClient'
import { cacheGet, cacheSet } from './apiCache'
import { getToken } from './userApi'

export type ServiceId = 'api' | 'catalogue' | 'files' | 'streaming' | 'radio'
export type ServiceState = 'up' | 'degraded' | 'down' | 'unknown'
export type StatusOverall = 'up' | 'degraded' | 'partial' | 'down' | 'unknown'
export type IncidentImpact = 'minor' | 'major' | 'maintenance'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export const SERVICE_IDS: ServiceId[] = ['api', 'catalogue', 'files', 'streaming', 'radio']
export const INCIDENT_IMPACTS: IncidentImpact[] = ['minor', 'major', 'maintenance']
export const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved']

/** Seconds a service spent in each state on one UTC day. */
export interface StatusDay { date: string; up: number; degraded: number; down: number }

export interface StatusServiceInfo {
  id: ServiceId
  label: string
  description: string
  state: ServiceState
  latency_ms: number | null
  detail: string
  checked_at: string | null
  since: string | null
  /** Percent over the window, null without data. */
  uptime: number | null
  /** Days with data only, oldest first. */
  history: StatusDay[]
}

export interface IncidentUpdate { id: number; status: IncidentStatus; message: string; author: string; created_at: string }

export interface Incident {
  id: number
  title: string
  impact: IncidentImpact
  /** Empty means the whole site. */
  services: ServiceId[]
  started_at: string
  resolved_at: string | null
  /** Opened by the monitor. */
  auto: boolean
  /** Newest first. */
  updates: IncidentUpdate[]
}

export interface StatusPage {
  generated_at: string
  days: number
  interval_seconds: number
  monitor: { last_check: string | null; stale: boolean }
  overall: StatusOverall
  services: StatusServiceInfo[]
  active_incidents: Incident[]
  recent_incidents: Incident[]
}

const STATUS_URL = routeUrl('/status/')
const INCIDENTS_URL = routeUrl('/status/incidents/')
const incidentUrl = (id: number): string => `${INCIDENTS_URL}${id}/`

export interface StatusPageResult {
  page: StatusPage
  /** True when this is the saved copy because the server didn't answer. */
  cached: boolean
}

/** The status page. While the server is down (no answer or a 5xx) the last
 *  copy this device saved comes back instead, marked `cached`. */
export async function fetchStatusPage(signal?: AbortSignal): Promise<StatusPageResult> {
  try {
    // No cacheKey on the request: its fallback would hand back the saved
    // copy as if it were fresh, and only for network errors, not a 502.
    const page = await apiRequest<StatusPage>(STATUS_URL, { signal })
    cacheSet(STATUS_URL, page)
    return { page, cached: false }
  } catch (err) {
    if (signal?.aborted) throw err
    const saved = cacheGet<StatusPage>(STATUS_URL)
    if (saved) return { page: saved, cached: true }
    throw err
  }
}

export async function fetchIncidents(limit = 20, offset = 0, signal?: AbortSignal): Promise<{ count: number; results: Incident[] }> {
  return apiRequest(`${INCIDENTS_URL}?limit=${limit}&offset=${offset}`, { signal })
}

export interface IncidentInput {
  title: string
  message: string
  impact?: IncidentImpact
  status?: IncidentStatus
  services?: ServiceId[]
  started_at?: string
}

/** Administrators: open an incident with its first update. */
export async function createIncident(input: IncidentInput): Promise<Incident> {
  return authedRequest<Incident>(INCIDENTS_URL, { method: 'POST', body: JSON.stringify(input) }, getToken())
}

/** Administrators: change an incident's title, impact, services or start. */
export async function updateIncident(id: number, patch: Partial<Pick<IncidentInput, 'title' | 'impact' | 'services' | 'started_at'>>): Promise<Incident> {
  return authedRequest<Incident>(incidentUrl(id), { method: 'PATCH', body: JSON.stringify(patch) }, getToken())
}

/** Administrators: post an update. `resolved` closes it, any other status reopens it. */
export async function postIncidentUpdate(id: number, status: IncidentStatus, message: string): Promise<Incident> {
  return authedRequest<Incident>(`${incidentUrl(id)}updates/`, { method: 'POST', body: JSON.stringify({ status, message }) }, getToken())
}

/** Administrators: remove an incident. */
export async function deleteIncident(id: number): Promise<void> {
  await authedRequest<void>(incidentUrl(id), { method: 'DELETE' }, getToken())
}
