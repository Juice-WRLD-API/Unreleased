// Network layer for in-app reports (feedback + song issue reports). See
// lib/reports.ts for the data shapes and the store's report outbox for the
// queue/flush logic.
//
// Live endpoints (both unauthenticated, throttled at 10/min):
//   POST /juicewrld/feedback/  { message, contact?, automated? }
//   GET  /juicewrld/feedback/  (?automated=true|false, editor token)
//   POST /juicewrld/reports/   { song_id | public_id, message, contact? }
// `automated` flags a feedback report ErrorBoundary sent on its own (see
// autoReportErrors) rather than one a person actually wrote, so the API can
// tell them apart on the review side.
// Neither takes structured category/issue fields, so the form's category and
// issue checkboxes are folded into the message text, with the app version on
// the last line - that context is what makes a bug report actionable.
//
// There is no idempotency key server-side, so the store only flushes the
// outbox from the MAIN window (pop-outs share localStorage and would
// double-send every queued report otherwise).
import { JWAPI_BASE } from './juicewrldApi'
import { getToken } from './userApi'
import { apiRequest, authHeaders } from './apiClient'
import { FEEDBACK_CATEGORY_LABELS, SONG_ISSUE_LABELS } from './reports'
import type { PendingFeedback, PendingSongReport } from './reports'

/** Live since /feedback/ and /reports/ shipped (2026-07-17). */
export const reportsApiEnabled = true

const FEEDBACK_URL = `${JWAPI_BASE}/feedback/`
const SONG_REPORTS_URL = `${JWAPI_BASE}/reports/`

async function post(url: string, body: unknown): Promise<void> {
  // No cacheKey: a report is a mutation, so it must hit the network and fail
  // loudly (staying queued) rather than resolve against a cached response.
  await apiRequest<unknown>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface FeedbackRow {
  id: number
  message: string
  contact?: string | null
  automated: boolean
  created_at?: string | null
}

export async function submitFeedback(r: PendingFeedback, contact?: string | null): Promise<void> {
  const message = `[${FEEDBACK_CATEGORY_LABELS[r.category]}] ${r.message}\n\n - Unreleased v${r.appVersion}`
  await post(FEEDBACK_URL, { message, ...(contact ? { contact } : {}), ...(r.automated ? { automated: true } : {}) })
}

export async function listFeedback(automated?: boolean): Promise<FeedbackRow[]> {
  const url = new URL(FEEDBACK_URL)
  if (automated !== undefined) url.searchParams.set('automated', automated ? 'true' : 'false')
  const data = await apiRequest<FeedbackRow[] | { results?: FeedbackRow[] }>(url.toString(), {
    method: 'GET',
    headers: authHeaders(getToken()),
  })
  return Array.isArray(data) ? data : (data?.results ?? [])
}

// ── Editor review ─────────────────────────────────────────────────────────────
// GET /juicewrld/reports/ (?status=pending|resolved) lists submitted song
// reports; PATCH /juicewrld/reports/<id>/ sets status/review_notes and the
// server records the reviewer + time. Both require an editor/admin token.

export type SongReportStatus = 'pending' | 'resolved'

/** A submitted song report as the editor endpoints return it. Only the fields
 *  the API doc names are certain (status, review_notes, reviewer + times);
 *  the rest mirror what the submit endpoint accepts and are read defensively
 *  in the UI, so a differently-named field degrades to a fallback label
 *  rather than a crash. */
export interface SongReportRow {
  id: number
  song?: number | null
  song_id?: number | null
  public_id?: number | null
  song_name?: string | null
  message: string
  contact?: string | null
  status: SongReportStatus
  review_notes?: string | null
  reviewer_username?: string | null
  created_at?: string | null
  reviewed_at?: string | null
}

/** The numeric song id on a report row, wherever the serializer put it. */
export function reportSongId(r: SongReportRow): number | null {
  return r.song ?? r.song_id ?? null
}

export async function listSongReports(status?: SongReportStatus): Promise<SongReportRow[]> {
  const url = new URL(SONG_REPORTS_URL)
  if (status) url.searchParams.set('status', status)
  const data = await apiRequest<SongReportRow[] | { results?: SongReportRow[] }>(url.toString(), {
    method: 'GET',
    headers: authHeaders(getToken()),
  })
  // Tolerate either a bare array or DRF-style pagination.
  return Array.isArray(data) ? data : (data?.results ?? [])
}

export async function reviewSongReport(
  id: number,
  patch: { status?: SongReportStatus; review_notes?: string },
): Promise<void> {
  await apiRequest<unknown>(`${SONG_REPORTS_URL}${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(patch),
  })
}

export async function submitSongReport(r: PendingSongReport, contact?: string | null): Promise<void> {
  const issues = r.issues.map((i) => SONG_ISSUE_LABELS[i]).join(', ')
  // The server resolves the song from song_id; the name is repeated in the
  // text anyway so the webhook/man-server view is readable without a lookup.
  const message = [
    issues ? `Issues: ${issues}` : null,
    `Song: ${r.songName}`,
    r.message || null,
    ` - Unreleased v${r.appVersion}`,
  ].filter(Boolean).join('\n\n')
  await post(SONG_REPORTS_URL, { song_id: r.songId, message, ...(contact ? { contact } : {}) })
}
