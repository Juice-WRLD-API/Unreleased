import { CSSProperties, ReactEventHandler, SyntheticEvent, useEffect, useState } from 'react'
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

export function ProgressiveCover(props: Props): JSX.Element | null {
  // Keyed per cover so a track change mounts a fresh element (and a fresh set
  // of failed attempts) instead of reusing one that would hold the last song's
  // art on screen until the placeholder decodes. The key is the cover, not
  // what's showing, so the placeholder→full swap within one song still reuses
  // the element.
  return <Progressive key={props.src ?? ''} {...props} />
}

function Progressive({ src: rawSrc, alt = '', className = '', onError }: Props): JSX.Element | null {
  // The full step goes through the size cap; the placeholder is derived from
  // the raw URL since `small` is a /files/download/ param.
  const src = fullCoverUrl(rawSrc)
  const placeholder = hasSmallCoverVariant(rawSrc) ? smallCoverUrl(rawSrc) : undefined
  const [fullLoaded, setFullLoaded] = useState(!!src && fullyLoadedSrcs.has(src))

  useEffect(() => {
    if (!src || !placeholder || fullyLoadedSrcs.has(src)) return
    // Preloading in an off-DOM Image (rather than swapping the <img> src and
    // waiting) keeps the placeholder painted until the full copy is decoded -
    // swapping src directly blanks the element while the new one loads.
    const img = new Image()
    let cancelled = false
    img.onload = () => {
      fullyLoadedSrcs.add(src)
      if (!cancelled) setFullLoaded(true)
    }
    // A failed full load is not an error state: the placeholder is a perfectly
    // good cover, so leave it up and let the caller's onError stay unfired.
    img.src = src
    return () => { cancelled = true; img.onload = null }
  }, [src, placeholder])

  if (!src) return null
  // The API's resize endpoints fail intermittently on covers that are fine, so
  // if what's showing errors, step through the other variants before giving up.
  return (
    <FallbackImg
      sources={fullLoaded ? [src, placeholder] : [placeholder, src]}
      alt={alt}
      className={className}
      onError={onError}
    />
  )
}

/** An <img> that, when a source fails to load, moves on to the next one and
 *  only reports onError once every source has failed. Callers that hide the
 *  cover on error otherwise lose it for the whole track to one flaky 500.
 *
 *  A raw /files/download/ image is never one of the tries: it goes through the
 *  1024px cap (fullCoverUrl) like every other full-size cover, since a custom
 *  cover's original can be a 20MB+ PNG - falling back to that whenever
 *  `small=1` flaked turned a ~5KB request into the whole file. */
export function FallbackImg({ sources, alt = '', className, style, onError }: {
  sources: (string | null | undefined)[]
  alt?: string
  className?: string
  style?: CSSProperties
  onError?: ReactEventHandler<HTMLImageElement>
}): JSX.Element | null {
  const [failed, setFailed] = useState<string[]>([])
  const remaining = [...new Set(sources.map(fullCoverUrl).filter((s): s is string => !!s && !failed.includes(s)))]
  const showing = remaining[0]
  if (!showing) return null
  return (
    <img
      src={showing}
      alt={alt}
      className={className}
      style={style}
      decoding="async"
      onError={(e: SyntheticEvent<HTMLImageElement>) => {
        if (remaining.length <= 1) onError?.(e)
        setFailed((f) => [...f, showing])
      }}
    />
  )
}
