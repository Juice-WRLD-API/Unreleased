import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search, Star } from 'lucide-react'
import { ClampedMenu } from '../ClampedMenu'
import { useStore } from '../../store/useStore'
import { errorText, useDismiss } from './ui'
import { searchGifs, trendingGifs, type GifResult } from '../../lib/gifApi'

export default function GifPicker({ x, y, onPick, onClose }: {
  x: number
  y: number
  onPick: (gif: GifResult) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const favoriteGifs = useStore((s) => s.favoriteGifs)
  const toggleFavoriteGif = useStore((s) => s.toggleFavoriteGif)
  const [tab, setTab] = useState<'browse' | 'favorites'>('browse')
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
    if (tab !== 'browse') return
    let cancelled = false
    setLoading(true)
    setError(null)
    const run = debounced ? searchGifs(debounced) : trendingGifs()
    run
      .then((r) => { if (!cancelled) setResults(r) })
      .catch((err) => { if (!cancelled) setError(errorText(err, 'Could not load GIFs')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced, tab])

  const shown = useMemo(() => {
    if (tab === 'browse') return results
    const q = debounced.toLowerCase()
    return q ? favoriteGifs.filter((g) => g.title.toLowerCase().includes(q)) : favoriteGifs
  }, [tab, results, favoriteGifs, debounced])

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
          placeholder={tab === 'browse' ? 'Search GIFs' : 'Search favorites'}
          className="w-full bg-transparent px-1 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setTab((t) => (t === 'browse' ? 'favorites' : 'browse'))}
          title={tab === 'browse' ? 'Show favorites' : 'Back to browsing'}
          className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
            tab === 'favorites' ? 'text-yellow-400 bg-surface-overlay' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
          }`}
        >
          <Star size={15} className={tab === 'favorites' ? 'fill-yellow-400' : ''} />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto chat-scroll p-2">
        {tab === 'browse' && loading ? (
          <div className="py-10 flex items-center justify-center text-text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : tab === 'browse' && error ? (
          <p className="py-6 text-center text-xs text-text-muted">{error}</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">
            {tab === 'favorites'
              ? (debounced ? `No favorites match "${debounced}"` : 'No favorites yet - hover a GIF and tap the star')
              : (debounced ? `No GIFs match "${debounced}"` : 'No trending GIFs right now')}
          </p>
        ) : (
          // Masonry, not a fixed-row grid: GIFs come in wildly different aspect
          // ratios, and a grid's row height is set by its tallest cell, which
          // leaves the shorter cell in that row padded with dead space. CSS
          // columns instead stack each tile at its own natural height, so
          // they sit flush against each other.
          <div className="columns-2 gap-1.5">
            {shown.map((gif) => {
              const favorited = favoriteGifs.some((g) => g.id === gif.id)
              return (
                <div key={gif.id} className="relative mb-1.5 [break-inside:avoid] group">
                  <button
                    onClick={() => pick(gif)}
                    title={gif.title}
                    className="block w-full rounded-lg overflow-hidden bg-surface-raised hover:brightness-110 transition"
                  >
                    <img
                      src={gif.previewUrl}
                      alt={gif.title}
                      loading="lazy"
                      className="block w-full h-auto"
                      style={{ aspectRatio: gif.width && gif.height ? `${gif.width} / ${gif.height}` : undefined }}
                    />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavoriteGif(gif) }}
                    title={favorited ? 'Remove from favorites' : 'Add to favorites'}
                    className={`absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white transition-opacity ${
                      favorited ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Star size={13} className={favorited ? 'fill-yellow-400 text-yellow-400' : ''} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ClampedMenu>,
    document.body,
  )
}
