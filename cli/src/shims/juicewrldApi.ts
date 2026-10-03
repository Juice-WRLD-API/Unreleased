import { apiFetch as cliFetch, baseFor } from '../api'

// Stands in for the site's lib/juicewrldApi.ts inside the site modules the CLI
// compiles in (listeningStats, heardle, versionsApi), which only need these
// helpers - the real module pulls in the app's stores. parseDuration and
// CATEGORY_LABELS are copied as they are; keep them in step with the originals.

export function parseDuration(length: string | null | undefined): number {
  if (!length) return 0
  const parts = length.split(':').map(Number)
  if (parts.length === 2) {
    const [m, s] = parts
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s
  }
  if (parts.length === 3) {
    const [h, m, s] = parts
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s
  }
  return 0
}

export const CATEGORY_LABELS: Record<string, string> = {
  released: 'Released',
  unreleased: 'Unreleased',
  unsurfaced: 'Unsurfaced',
  recording_session: 'Session',
}

/** The saved route rules apply, as on the site. */
export const routeUrl = (path: string): string => `${baseFor(path)}${path}`

/** Cover art isn't shown in a terminal; the value is only carried along. */
export const buildImageUrl = (raw: string | null | undefined): string | undefined => raw || undefined

export const apiFetch = <T>(path: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> => cliFetch<T>(path, params)
