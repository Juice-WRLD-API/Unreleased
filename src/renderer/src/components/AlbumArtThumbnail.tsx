import { Music2 } from 'lucide-react'
import { useState } from 'react'
import { Track } from '../types'
import { fullCoverUrl, smallCoverUrl, sizedCoverUrl } from '../lib/juicewrldApi'

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
  // Pixel resolution to request when the art is drawn as a card rather than a
  // row thumbnail - the default 128px degraded cover goes soft stretched
  // across a grid tile. Only affects covers the API can resize.
  res?: number
}

// Web-only version - API tracks always have imageUrl, no IPC needed.
// `size` is a px design value, but the box is rendered in rem so covers scale
// with the app text-size setting (which drives the root font-size) instead of
// staying pinned while the surrounding rem-based text grows/shrinks around them.
export function AlbumArtThumbnail(props: Props): JSX.Element {
  // Reset failed attempts when the cover or requested resolution changes.
  return <Thumbnail key={JSON.stringify([props.track.imageUrl, props.res])} {...props} />
}

function Thumbnail({ track, size = 40, className = '', fill = false, eager = false, res }: Props): JSX.Element {
  const [attempt, setAttempt] = useState(0)
  // A resize can fail even when the underlying cover is available. Try the
  // small variant and then the 1024px capped copy, once each, before showing
  // the icon - never the raw original, which for a custom cover can be a
  // 20MB+ PNG pulled down for a 40px row.
  const sources = [...new Set([
    res ? sizedCoverUrl(track.imageUrl, res) : smallCoverUrl(track.imageUrl),
    smallCoverUrl(track.imageUrl),
    fullCoverUrl(track.imageUrl),
  ].filter((src): src is string => !!src))]
  const src = sources[attempt]
  const rem = `${size / 16}rem`
  // Inline width/height would outrank a `w-full`/`h-full` className, so in fill
  // mode we drop the inline size and let the class size the box to its parent.
  const sizeStyle = fill ? undefined : { width: rem, height: rem }
  if (src) {
    return (
      <img
        // Each fallback gets a fresh image element and loading lifecycle.
        key={src}
        // Row thumbnails draw at 56px or less, so the API's degraded 128px
        // cover is more than enough resolution even on a 2x display - and it's
        // ~300x smaller than the original, which is what makes a long list of
        // API tracks paint its art at all quickly. Card-sized callers pass
        // `res` for a sharper one.
        src={src}
        alt={track.title}
        style={sizeStyle}
        className={`object-cover shrink-0 ${className}`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setAttempt(attempt + 1)}
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
