// Suspense fallback for the main view slot. Deliberately generic - a header
// block and a few rows, matching the inline skeleton idiom already used across
// the app (see DownloadAppView) - since one boundary covers every view and
// guessing at a specific layout would be wrong more often than right.
//
// It fades in only after a delay (see .view-skeleton in index.css), so a chunk
// that resolves quickly - which, with the nav prefetching in lib/lazyViews,
// is the normal case - shows nothing at all rather than a flash.
export default function ViewSkeleton(): JSX.Element {
  return (
    <div className="view-skeleton flex-1 min-h-0 overflow-hidden px-5 pt-5" aria-hidden>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-20 h-20 rounded-2xl bg-surface-raised animate-pulse shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-6 w-48 max-w-[60%] rounded-md bg-surface-raised animate-pulse" />
          <div className="h-3.5 w-24 rounded-md bg-surface-raised animate-pulse" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-12 rounded-xl border border-[var(--border)] bg-surface-raised animate-pulse"
            // Stagger so the rows read as a list settling in rather than one
            // solid block pulsing in lockstep.
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
