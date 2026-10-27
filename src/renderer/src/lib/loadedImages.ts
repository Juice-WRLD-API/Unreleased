// Image URLs that have already loaded once this session. Views that remount on
// every visit (Home is a route, so it does) would otherwise put their covers
// back through lazy loading and async decoding, which paints empty tiles for a
// beat even though the browser has the bytes cached and the art "reloads".
// A cover seen before loads eagerly and decodes in the same frame instead.
const loaded = new Set<string>()

export function markImageLoaded(src: string): void {
  loaded.add(src)
}

/** `loading`/`decoding` for an <img>: the caller's lazy/async defaults on a
 *  first load, eager and in-frame once `src` has loaded before. */
export function imageLoadAttrs(src: string, lazy: boolean): { loading: 'eager' | 'lazy'; decoding: 'sync' | 'async' } {
  const seen = loaded.has(src)
  return { loading: lazy && !seen ? 'lazy' : 'eager', decoding: seen ? 'sync' : 'async' }
}
