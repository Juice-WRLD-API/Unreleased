import { useEffect, useMemo, useState } from 'react'
import { loadAllSongsAbortable, type JWApiSong } from './juicewrldApi'
import { searchLyrics } from './lyricSearch'

const PAGE = 50

/** The Lyrics tab's search: all matches computed locally from the cached catalogue,
 *  shown a page at a time. `fuzzy` defaults on. */
export function useLyricSearch(query: string, fuzzy = true): {
  results: JWApiSong[]; count: number; hasMore: boolean; loading: boolean; error: string | null; loadMore: () => void
} {
  const [matches, setMatches] = useState<JWApiSong[]>([])
  const [shown, setShown] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!query.trim()) { setMatches([]); setError(null); setLoading(false); return }
    const ctl = new AbortController()
    setLoading(true); setError(null)
    loadAllSongsAbortable(ctl.signal)
      .then((songs) => { setMatches(searchLyrics(songs, query, fuzzy)); setShown(PAGE) })
      .catch((err) => { if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    return () => ctl.abort()
  }, [query, fuzzy])

  const results = useMemo(() => matches.slice(0, shown), [matches, shown])
  return { results, count: matches.length, hasMore: shown < matches.length, loading, error, loadMore: () => setShown((n) => n + PAGE) }
}
