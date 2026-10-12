// Era abbreviation → full display name (e.g. "WOD" → "WRLD On Drugs").
//
// The API's era objects carry the abbreviation in `name`; the human-readable
// full name only exists inside `description`, usually suffixed with an "era"
// qualifier and a time frame - "WRLD On Drugs era (August 2018-December 2018)".
// This module fetches /eras/ once (paginated, 34 across 2 pages), derives the
// clean full names, and exposes a synchronous lookup for display code
// (currently Discord RPC).

import { apiFetch, apiPeek, JWApiEra } from './juicewrldApi'

type ErasResponse = JWApiEra[] | { count: number; next: string | null; results: JWApiEra[] }

// Hard cap on pages followed, in case the API's pagination ever misbehaves.
const MAX_PAGES = 10

const names: Record<string, string> = {}
// Every era seen so far, in API order - dedup'd by name since ingest() runs
// both from the synchronous offline-cache seed and the async fetch below and
// would otherwise double up entries.
const eraOrder: string[] = []
const eraByName: Record<string, JWApiEra> = {}
let loadPromise: Promise<void> | null = null

// Overrides for eras whose real full name isn't derivable from the API's own
// description at all - e.g. "HIH 999"'s description is just "HIH 999 era
// (March 2017-May 2017)", which strips down to "HIH 999" again with no
// expansion anywhere in the API's data. Checked before the generic
// description-based derivation below.
const MANUAL_FULL_NAMES: Record<string, string> = {
  'HIH 999': 'Heartbroken In Hollywood 999',
  'UNS: JW': 'Unsurfaced Live Recordings',
}

function fullName(era: JWApiEra): string | undefined {
  if (era.name in MANUAL_FULL_NAMES) return MANUAL_FULL_NAMES[era.name]
  const desc = era.description?.trim()
  if (!desc) return undefined
  const stripped = desc
    // A trailing "(...)" containing a year is a time frame - drop it. This
    // keeps meaningful parentheticals like "The Pre Party (Extended)".
    .replace(/\s*\([^)]*\d{4}[^)]*\)$/, '')
    .replace(/\s+era$/i, '')
    // Purely administrative buckets ("Mainstream releases grouping",
    // "SoundCloud releases grouping") aren't a stylistic era with a real
    // full name - same treatment as no description at all.
    .replace(/\s+releases grouping$/i, '')
    .replace(/\s+(project|collection)$/i, '')
    .trim()
  // Stripping produced the abbreviation right back (e.g. "KILL'S WRLD era"
  // → "KILL'S WRLD") - nothing was actually expanded, so there's no real
  // full name to show.
  if (!stripped || stripped === era.name) return undefined
  return stripped
}

function pageParams(page: number): Record<string, number> {
  // Page 1 is plain "/eras/" so the cache key matches what the views that
  // fetch the era list already write/read.
  return page === 1 ? {} : { page }
}

/** True when this page says another follows (flat arrays never do). */
function ingest(data: ErasResponse | undefined): boolean {
  if (!data) return false
  const results = Array.isArray(data) ? data : data.results ?? []
  for (const era of results) {
    const full = fullName(era)
    if (full) names[era.name] = full
    if (!eraByName[era.name]) eraOrder.push(era.name)
    eraByName[era.name] = era
  }
  return !Array.isArray(data) && !!data.next
}

// Seed synchronously from the offline cache so lookups can succeed before
// (or without) the network fetch below.
for (let page = 1; page <= MAX_PAGES; page++) {
  if (!ingest(apiPeek<ErasResponse>('/eras/', pageParams(page)))) break
}

// Concurrent callers within this window share one walk (a modal opening
// alongside the Tracker shouldn't refetch both pages), but a later mount does
// refresh - callers that render the era *list* used to refetch per mount, and
// without a TTL a new era added server-side would never appear until restart.
const ERAS_TTL = 5 * 60_000
let loadedAt = 0

/** Fetches all era pages and fills the lookup, at most once per TTL. Safe to
 *  call repeatedly - the fetch is shared; a failed one is forgotten so a later
 *  call retries. Rejects only after ingesting whatever pages did succeed, so
 *  listEras() still returns a partial list when a later page fails. */
export function loadEraFullNames(): Promise<void> {
  if (!loadPromise || Date.now() - loadedAt > ERAS_TTL) {
    loadedAt = Date.now()
    loadPromise = (async () => {
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (!ingest(await apiFetch<ErasResponse>('/eras/', pageParams(page)))) break
      }
    })()
    loadPromise.catch(() => { loadPromise = null })
  }
  return loadPromise
}

/** Full era name for an abbreviation, if known. Synchronous - returns
 *  undefined until loadEraFullNames (or the offline cache) has run. */
export function eraFullName(abbrev: string | null | undefined): string | undefined {
  return abbrev ? names[abbrev] : undefined
}

/** `abbrev` as-is, or its full name when `full` is true and one's known yet
 *  (falls back to `abbrev` before loadEraFullNames resolves). The single
 *  place display code should apply the "full era names" preference, so the
 *  fallback behavior stays consistent everywhere it's used. */
export function eraLabel(abbrev: string, full: boolean): string {
  return full ? (eraFullName(abbrev) ?? abbrev) : abbrev
}

/** Every era seen so far, in API order. Populated by the same offline-cache
 *  seed and loadEraFullNames fetch as the name lookup above - call
 *  loadEraFullNames first (or accept whatever the offline cache seeded) if
 *  the caller needs the full set. */
export function listEras(): JWApiEra[] {
  return eraOrder.map((name) => eraByName[name])
}
