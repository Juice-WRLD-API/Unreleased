// In-app reporting: general feedback, and per-song issue reports (wrong /
// missing info or lyrics). Data shapes + a local outbox only - the network
// calls live in reportsApi.ts and the queue/flush logic in the store.
//
// Like lib/songPrefs, this module imports nothing so it can be pulled in
// anywhere without risking an import cycle. It runs local-first: a report is
// written to a persisted outbox immediately and delivered when the endpoints
// exist and the network is reachable (see reportsApiEnabled), so a user who
// reports something today doesn't lose it just because the backend isn't live.

export type FeedbackCategory = 'bug' | 'suggestion' | 'praise' | 'other'

// A song report can flag several problems at once (e.g. wrong info AND missing
// lyrics), so these are checkboxes, not a single choice.
export type SongIssueType = 'wrong_info' | 'missing_info' | 'wrong_lyrics' | 'missing_lyrics' | 'other'

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  praise: 'Praise',
  other: 'Other',
}

export const SONG_ISSUE_LABELS: Record<SongIssueType, string> = {
  wrong_info: 'Wrong info',
  missing_info: 'Missing info',
  wrong_lyrics: 'Wrong lyrics',
  missing_lyrics: 'Missing lyrics',
  other: 'Something else',
}

// Fixed display order for the checkboxes/pills (Record key order isn't a
// contract to rely on).
export const FEEDBACK_CATEGORIES: FeedbackCategory[] = ['bug', 'suggestion', 'praise', 'other']
export const SONG_ISSUE_TYPES: SongIssueType[] = ['wrong_info', 'missing_info', 'wrong_lyrics', 'missing_lyrics', 'other']

interface BaseReport {
  /** Client-generated id - dedupes retries and lets the outbox drop one by id. */
  id: string
  message: string
  /** App version at submit time - the single most useful context for a bug. */
  appVersion: string
  createdAt: number
  /** Delivery attempts so far; lets the flusher back off a permanently-failing
   *  report instead of hammering it every boot. */
  attempts: number
  /** Optional way to reach the reporter - sent as the endpoints' `contact`
   *  field. When empty, the account's Discord username fills in at send time. */
  contact?: string
}

export interface PendingFeedback extends BaseReport {
  kind: 'feedback'
  category: FeedbackCategory
  /** True for a crash report ErrorBoundary sent on its own (see
   *  autoReportErrors) rather than something the user actually wrote -
   *  the API's `automated` field, so these can be told apart from real
   *  user feedback on the review side. */
  automated?: boolean
}

export interface PendingSongReport extends BaseReport {
  kind: 'song'
  songId: number
  /** Song title captured at report time - for the local outbox list and as
   *  server context, so a later rename/relink doesn't obscure what was meant. */
  songName: string
  issues: SongIssueType[]
}

export type PendingReport = PendingFeedback | PendingSongReport

/** What the report modal was opened for. The song variant carries just enough
 *  to render the form and label the report without a re-fetch. */
export type ReportTarget =
  | { kind: 'feedback' }
  | { kind: 'song'; songId: number; songName: string }

/** After this many failed deliveries, stop retrying automatically - the report
 *  stays in the outbox (nothing is silently dropped) but no longer runs on
 *  every flush, so one malformed/rejected report can't wedge the queue. */
export const MAX_REPORT_ATTEMPTS = 6

export function newReportId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** A report still worth auto-retrying (under the attempt cap). */
export function isDeliverable(r: PendingReport): boolean {
  return r.attempts < MAX_REPORT_ATTEMPTS
}
