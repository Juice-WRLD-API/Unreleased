import type { ImgHTMLAttributes } from 'react'
import { imageLoadAttrs, markImageLoaded } from '../lib/loadedImages'

/** A lazy-loading <img> that skips the lazy/async step for an image already
 *  loaded this session, so a view that remounts doesn't flash empty boxes
 *  before its cached images paint (see lib/loadedImages). */
export function LazyImg({ src, onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
  return (
    <img
      {...(src ? imageLoadAttrs(src, true) : { loading: 'lazy' as const, decoding: 'async' as const })}
      {...rest}
      src={src}
      onLoad={(e) => { if (src) markImageLoaded(src); onLoad?.(e) }}
    />
  )
}
