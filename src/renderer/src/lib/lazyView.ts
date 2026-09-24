import { lazy, ComponentType, LazyExoticComponent } from 'react'

// Lazy views load their chunk by hashed filename baked into the running bundle.
// On the web that filename stops existing the moment the site redeploys, so a
// tab left open across a deploy throws "Failed to fetch dynamically imported
// module" the first time the user navigates to a lazy view. The chunk isn't
// coming back - only a reload gets the new index.html with the new hashes.
//
// So: retry once (covers a genuinely flaky network), then reload the page once.
// The sessionStorage stamp keeps a chunk that fails for any *other* reason
// (offline, blocked by an extension) from putting the app in a reload loop -
// after one attempt the error falls through to the ErrorBoundary as before.
const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_COOLDOWN_MS = 15_000

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(msg)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyView<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      if (!isChunkLoadError(err)) throw err
      try {
        return await factory()
      } catch {/* still gone - fall through to the reload */}

      let last = 0
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) } catch {/* private mode */}
      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch {/* ignore */}
        window.location.reload()
        // The page is going away; never resolve so React doesn't render the
        // Suspense fallback (or the error card) during the teardown.
        return await new Promise<never>(() => {})
      }
      throw err
    }
  })
}
