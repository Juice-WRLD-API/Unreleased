import { Music2 } from 'lucide-react'
import { Track } from '../types'
import { smallCoverUrl } from '../lib/juicewrldApi'

interface Props {
  track: Track
  size?: number
  className?: string
  shimmer?: boolean
  rootMargin?: string
  // Fill the parent instead of taking a fixed size - for callers that wrap the
  // thumbnail in their own sized box (mini player, queue, WRLD tab). Those
  // wrappers are rem-based already, so filling them scales just the same.
  fill?: boolean
  // Load immediately instead of lazily. Set by callers whose list is already
  // virtualized (only ~visible rows ever mount), where lazy loading is not just
  // redundant but harmful: it defers each cover's load until it intersects the
  // viewport, so even a fully-cached cover paints blank-then-pops as you scroll.
  // Loading eagerly lets the off-screen overscan rows decode from cache before
  // they scroll into view. Leave off for non-virtualized lists (e.g. Liked
  // Songs), where lazy still avoids fetching hundreds of covers at once.
  eager?: boolean
}

// Web-only version - API tracks always have imageUrl, no IPC needed.
// `size` is a px design value, but the box is rendered in rem so covers scale
// with the app text-size setting (which drives the root font-size) instead of
// staying pinned while the surrounding rem-based text grows/shrinks around them.
export function AlbumArtThumbnail({ track, size = 40, className = '', fill = false, eager = false }: Props): JSX.Element {
  const rem = `${size / 16}rem`
  // Inline width/height would outrank a `w-full`/`h-full` className, so in fill
  // mode we drop the inline size and let the class size the box to its parent.
  const sizeStyle = fill ? undefined : { width: rem, height: rem }
  if (track.imageUrl) {
    return (
      <img
        // Remount per cover. In a list each row has its own element so this is
        // a no-op, but the callers that keep one thumbnail across track changes
        // (mini player, WRLD tab) were reusing the element - which meant the
        // previous song's art stayed painted until the new one decoded, and a
        // single 404 left `display:none` stuck on for every later track.
        key={track.imageUrl}
        // Every caller draws this at 56px or less, so the API's degraded 128px
        // cover is more than enough resolution even on a 2x display - and it's
        // ~300x smaller than the original, which is what makes a long list of
        // API tracks paint its art at all quickly.
        src={smallCoverUrl(track.imageUrl)}
        alt={track.title}
        style={sizeStyle}
        className={`object-cover shrink-0 ${className}`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div
      className={`flex items-center justify-center bg-surface-overlay text-text-muted shrink-0 ${className}`}
      style={sizeStyle}
    >
      <Music2 size={fill ? '40%' : `${(size * 0.4) / 16}rem`} />
    </div>
  )
}
