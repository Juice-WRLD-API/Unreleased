import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

// Sits at the end of a scrolling list and calls `onVisible` once it comes
// within `margin` of the scroll container's edge, so the next page is already
// in by the time the user gets there. `loading` swaps in a spinner; with
// nothing more to load it renders nothing.
export function LoadMoreSentinel({ hasMore, loading, onVisible, margin = 400 }: {
  hasMore: boolean
  loading: boolean
  onVisible: () => void
  margin?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  // Re-observed when `loading` flips back off, so a sentinel that stays on
  // screen (a short page) keeps pulling pages instead of stalling.
  useEffect(() => {
    const el = ref.current
    if (!el || !hasMore || loading) return
    // rootMargin only grows the root it is given, and an implicit root can't
    // see past the scroll container's clip, so observe against that container.
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) onVisibleRef.current() },
      { root: scrollParent(el), rootMargin: `0px 0px ${margin}px 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, margin])

  if (!hasMore) return null
  return (
    <div ref={ref} className="flex justify-center py-3 min-h-8">
      {loading && <Loader2 size={14} className="animate-spin text-text-muted" />}
    </div>
  )
}
