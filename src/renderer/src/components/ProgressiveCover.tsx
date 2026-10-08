import { ReactEventHandler, useEffect, useState } from 'react'
import { fullCoverUrl, hasSmallCoverVariant, smallCoverUrl } from '../lib/juicewrldApi'

interface Props {
  src: string | null | undefined
  alt?: string
  className?: string
  onError?: ReactEventHandler<HTMLImageElement>
}

// A cover drawn large enough to need the full-size image, but loaded in two
// steps: the API's degraded 128x128 variant paints almost immediately (~3KB),
// then the full ~1MB original replaces it once it arrives. The user sees art on
// the first frame after a track change instead of an empty box for as long as
// the big PNG takes.
//
// For URLs with no degraded variant (site assets, local files, data URLs) this
// is just an <img> - one load, no placeholder step.
//
// Module-level (not component state) so it survives the component unmounting
// and remounting - e.g. leaving and reentering the WRLD tab, which tears down
// this component entirely. Without it, a cover that already loaded full-res
// once would replay the low-res placeholder every time WRLD remounts, even
// though the browser already has the full image cached.
const fullyLoadedSrcs = new Set<string>()

export function ProgressiveCover({ src: rawSrc, alt = '', className = '', onError }: Props): JSX.Element | null {
  // The full step goes through the size cap; the placeholder is derived from
  // the raw URL since `small` is a /files/download/ param.
  const src = fullCoverUrl(rawSrc)
  const placeholder = hasSmallCoverVariant(rawSrc) ? smallCoverUrl(rawSrc) : undefined
  // Stored as the src it belongs to rather than a bare boolean: a boolean is
  // only reset inside the effect, which runs *after* the first render with the
  // new src - so that render still saw `true` from the previous track and
  // pointed the <img> straight at the new full-size original, skipping the
  // placeholder step entirely. Since an <img> keeps painting its old frame
  // until the new src decodes, a track change sat on the previous song's cover
  // for however long the ~1MB PNG took. Deriving it from `src` can't go stale.
  const [fullLoadedSrc, setFullLoadedSrc] = useState<string | null>(
    src && fullyLoadedSrcs.has(src) ? src : null
  )
  const fullLoaded = !!src && (fullLoadedSrc === src || fullyLoadedSrcs.has(src))

  useEffect(() => {
    if (!src || !placeholder || fullyLoadedSrcs.has(src)) return
    // Preloading in an off-DOM Image (rather than swapping the <img> src and
    // waiting) keeps the placeholder painted until the full copy is decoded -
    // swapping src directly blanks the element while the new one loads.
    const img = new Image()
    let cancelled = false
    img.onload = () => {
      fullyLoadedSrcs.add(src)
      if (!cancelled) setFullLoadedSrc(src)
    }
    // A failed full load is not an error state: the placeholder is a perfectly
    // good cover, so leave it up and let the caller's onError stay unfired.
    img.src = src
    return () => { cancelled = true; img.onload = null }
  }, [src, placeholder])

  if (!src) return null
  const showing = placeholder && !fullLoaded ? placeholder : src
  return (
    <img
      // Keyed per cover so a track change mounts a fresh element instead of
      // reusing one that would hold the last song's art on screen until the
      // placeholder decodes. The key is the cover, not `showing`, so the
      // placeholder→full swap within one song still reuses the element.
      key={src}
      src={showing}
      alt={alt}
      className={className}
      decoding="async"
      onError={onError}
    />
  )
}
