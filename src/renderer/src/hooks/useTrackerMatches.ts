// Resolves (and caches) whether an API file has a matching Tracker song, so
// ApiFilesView's context menu / actions sheet can hide Tracker-only actions
// for a file with no match - identical logic in the desktop and mobile views.
import { useState } from 'react'
import { apiFetch, JWApiFileEntry, JWApiPaginatedResponse } from '../lib/juicewrldApi'
import { getMediaType } from '../lib/fileTypes'

export function useTrackerMatches(): {
  trackerMatches: Map<string, number | null>
  resolveTrackerMatch: (entry: JWApiFileEntry) => void
} {
  const [trackerMatches, setTrackerMatches] = useState<Map<string, number | null>>(new Map())

  const resolveTrackerMatch = (entry: JWApiFileEntry): void => {
    if (getMediaType(entry.name) !== 'audio' || trackerMatches.has(entry.path)) return
    const title = entry.name.replace(/\.[^.]+$/, '')
    apiFetch<JWApiPaginatedResponse>('/songs/', { search: title, page_size: 1 })
      .then((data) => {
        const id = data.results[0]?.id ?? null
        setTrackerMatches((prev) => new Map(prev).set(entry.path, id))
      })
      .catch(() => setTrackerMatches((prev) => new Map(prev).set(entry.path, null)))
  }

  return { trackerMatches, resolveTrackerMatch }
}
