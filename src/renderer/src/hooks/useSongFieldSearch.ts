import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadAllSongs } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { parseSearchQuery, matchesFieldFilters, songsById } from '../lib/trackerSearch'

// The Tracker's field:"value" syntax (trackerSearch.ts) for lists whose rows
// only carry a song's title/artist - playlists, the queue, the tier list.
// Plain words stay with each list's own text match; field tokens are checked
// against the full /songs/ catalogue by song id, which has every field.

export interface SongFieldSearch {
  /** Lowercased query with field tokens stripped - for the list's own text match. */
  freeText: string
  hasFilters: boolean
  /** Whether the song with this /songs/ id passes the query's field filters.
   *  Always true without any; false for a song with no id (a local file) or
   *  while the catalogue is still loading. */
  matchesFields: (songId: number | null | undefined) => boolean
}

export function useSongFieldSearch(query: string): SongFieldSearch {
  const { freeText, filters } = useMemo(() => parseSearchQuery(query), [query])
  const hasFilters = filters.length > 0
  const [byId, setById] = useState<Map<number, JWApiSong> | null>(null)

  useEffect(() => {
    if (!hasFilters || byId) return
    let cancelled = false
    loadAllSongs()
      .then((list) => { if (!cancelled) setById(songsById(list)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [hasFilters, byId])

  const matchesFields = useCallback((songId: number | null | undefined): boolean => {
    if (!hasFilters) return true
    const song = songId != null ? byId?.get(songId) : undefined
    return !!song && matchesFieldFilters(song, filters)
  }, [hasFilters, filters, byId])

  return useMemo(
    () => ({ freeText: freeText.toLowerCase(), hasFilters, matchesFields }),
    [freeText, hasFilters, matchesFields],
  )
}
