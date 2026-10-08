import { useEffect, useState } from 'react'
import { Loader2, Search, Copy } from 'lucide-react'
import { apiFetch, JWApiSong } from '../lib/juicewrldApi'

// Most new AddSongModal entries are another version of a song that already
// exists, so the fast path is "start from that one and change what
// differs" rather than retyping every credit and date. Extracted verbatim
// from EditorProfileView.desktop.tsx's inline CopyFromSong - the mobile copy
// was identical except for touch-vs-hover states and slightly taller result
// rows, both handled here via `variant` instead of forking the file.
export interface CopyFromSongProps {
  onCopy: (song: JWApiSong) => void
  copiedFrom: string | null
  onClear: () => void
  /** 'mobile' uses active: states (no hover) and taller result rows,
   *  matching AddSongModal.mobile's original touch targets. 'desktop' (the
   *  default) uses hover: states, matching AddSongModal.desktop's original. */
  variant?: 'desktop' | 'mobile'
}

export default function CopyFromSong({ onCopy, copiedFrom, onClear, variant = 'desktop' }: CopyFromSongProps): JSX.Element {
  const isMobile = variant === 'mobile'
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (debounced.length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    apiFetch<{ results: JWApiSong[] }>('/songs/', { search: debounced, page_size: 8 })
      .then(d => { if (!cancelled) setResults(d.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced])

  // The list endpoint returns trimmed rows (no lyrics/credits), so the pick
  // has to be re-fetched in full before its fields can be copied across.
  const pick = async (row: JWApiSong): Promise<void> => {
    setLoadingId(row.id)
    try { onCopy(await apiFetch<JWApiSong>(`/songs/${row.id}/`)) }
    catch { onCopy(row) }
    finally { setLoadingId(null); setQuery(''); setDebounced(''); setResults([]) }
  }

  if (copiedFrom) return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
      <Copy size={12} className="text-accent shrink-0" />
      <span className="text-[11px] text-accent font-medium flex-1 min-w-0 truncate">Copied from "{copiedFrom}"</span>
      <button
        onClick={onClear}
        className={`text-accent opacity-60 text-[11px] transition-opacity shrink-0 ${isMobile ? 'active:opacity-100' : 'hover:opacity-100'}`}
      >
        Clear
      </button>
    </div>
  )

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-[9px] text-text-muted pointer-events-none" />
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Copy fields from an existing song…"
        className="w-full bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg pl-8 pr-8 py-1.5 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-40 focus:outline-none focus:border-accent/40 transition-colors"
      />
      {loading && <Loader2 size={12} className="absolute right-2.5 top-2.5 animate-spin text-text-muted" />}
      {results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-2xl py-1">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => pick(r)}
              className={`w-full flex items-center gap-2 text-left px-2.5 text-xs text-text-secondary transition-colors ${
                isMobile
                  ? 'py-2 active:bg-[var(--surface-overlay)] active:text-text-primary'
                  : 'py-1.5 hover:bg-[var(--surface-overlay)] hover:text-text-primary'
              }`}
            >
              <span className="flex-1 min-w-0 truncate">{r.name}</span>
              {r.era?.name && <span className="text-[10px] text-text-muted opacity-60 shrink-0">{r.era.name}</span>}
              {loadingId === r.id && <Loader2 size={11} className="animate-spin shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
