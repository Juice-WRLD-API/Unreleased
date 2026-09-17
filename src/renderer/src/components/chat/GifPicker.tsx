import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search } from 'lucide-react'
import { ClampedMenu } from '../ClampedMenu'
import { errorText, useDismiss } from './ui'
import { searchGifs, trendingGifs, type GifResult } from '../../lib/gifApi'

export default function GifPicker({ x, y, onPick, onClose }: {
  x: number
  y: number
  onPick: (gif: GifResult) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useDismiss(true, onClose, ref)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const run = debounced ? searchGifs(debounced) : trendingGifs()
    run
      .then((r) => { if (!cancelled) setResults(r) })
      .catch((err) => { if (!cancelled) setError(errorText(err, 'Could not load GIFs')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced])

  const pick = (gif: GifResult): void => {
    onPick(gif)
    onClose()
  }

  return createPortal(
    <ClampedMenu ref={ref} x={x} y={y} className="chat-pop w-[320px] !py-0 z-[120]">
      <div className="p-2 border-b border-[var(--border)] flex items-center gap-1.5">
        <Search size={14} className="shrink-0 text-text-muted ml-1" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs"
          className="w-full bg-transparent px-1 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto chat-scroll p-2">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="py-6 text-center text-xs text-text-muted">{error}</p>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">
            {debounced ? `No GIFs match "${debounced}"` : 'No trending GIFs right now'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {results.map((gif) => (
              <button
                key={gif.id}
                onClick={() => pick(gif)}
                title={gif.title}
                className="rounded-lg overflow-hidden bg-surface-raised hover:brightness-110 transition"
                style={{ aspectRatio: gif.width && gif.height ? `${gif.width} / ${gif.height}` : '1 / 1' }}
              >
                <img src={gif.previewUrl} alt={gif.title} loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </ClampedMenu>,
    document.body,
  )
}
