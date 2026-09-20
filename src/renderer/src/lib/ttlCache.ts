/** A TTL-cached loader. Callable to fetch (or reuse) the value; `peek` reads
 *  the live entry without starting a fetch. */
export interface TtlCache<T> {
  (): Promise<T>
  /** The in-flight or cached promise if one is live within the TTL, else
   *  null. Never starts a fetch - callers use it to reuse work someone else
   *  already paid for, and fall back to their own cheaper path when cold. */
  peek(): Promise<T> | null
}

export function createTtlCache<T>(ttlMs: number, fetcher: () => Promise<T>): TtlCache<T> {
  let cache: { promise: Promise<T>; ts: number } | null = null
  const fresh = (): boolean => cache != null && Date.now() - cache.ts <= ttlMs
  const load = function load(): Promise<T> {
    if (!fresh()) {
      cache = { promise: fetcher(), ts: Date.now() }
    }
    const entry = cache!
    entry.promise.catch(() => { if (cache === entry) cache = null })
    return entry.promise
  } as TtlCache<T>
  load.peek = (): Promise<T> | null => (fresh() ? cache!.promise : null)
  return load
}
