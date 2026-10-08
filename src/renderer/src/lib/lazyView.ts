import { createElement, lazy, Suspense, ComponentType, LazyExoticComponent } from 'react'
import { useIsMobile, isMobileViewport } from '../hooks/useIsMobile'

// Lazy views load their chunk by hashed filename baked into the running bundle.
// On the web that filename stops existing the moment the site redeploys, so a
// tab left open across a deploy throws "Failed to fetch dynamically imported
// module" the first time the user navigates to a lazy view. The chunk isn't
// coming back — only a reload gets the new index.html with the new hashes.
//
// So: retry once (covers a genuinely flaky network), then reload the page once.
// The sessionStorage stamp keeps a chunk that fails for any *other* reason
// (offline, blocked by an extension) from putting the app in a reload loop —
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
      } catch {/* still gone — fall through to the reload */}

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

/** lazyView for something opened on demand (a modal, a menu, a panel) rather
 *  than a routed view. It brings its own empty <Suspense>, so a call site can
 *  swap a static import for this without wrapping every render in a boundary,
 *  and the brief load on first open never bubbles up to a view-level skeleton
 *  (or, outside any boundary, suspends the whole root). */
export function lazyOverlay<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> }>,
): (props: P) => JSX.Element {
  const Lazy = lazyView(factory) as unknown as ComponentType<P>
  return (props: P) => createElement(Suspense, { fallback: null }, createElement(Lazy, props))
}

export type ResponsiveView<P> = ((props: P) => JSX.Element) & {
  /** Start loading the half the current viewport would render. */
  preload: () => Promise<unknown>
}

/** A view with one shell per breakpoint (X.desktop / X.mobile). Each half is
 *  its own chunk, so a visitor only downloads the one their viewport renders -
 *  importing both statically from a wrapper shipped every phone the whole
 *  desktop layout (and vice versa), roughly doubling each view's download.
 *  The returned wrapper is tiny and meant to be imported statically, so there
 *  is no wrapper-chunk -> half-chunk waterfall; the half suspends to the
 *  nearest <Suspense>. Crossing the breakpoint (resizing a desktop window)
 *  loads the other half on demand. */
export function responsiveView<P extends object>(
  desktop: () => Promise<{ default: ComponentType<P> }>,
  mobile: () => Promise<{ default: ComponentType<P> }>,
): ResponsiveView<P> {
  const Desktop = lazyView(desktop) as unknown as ComponentType<P>
  const Mobile = lazyView(mobile) as unknown as ComponentType<P>
  const View = (props: P): JSX.Element => createElement(useIsMobile() ? Mobile : Desktop, props)
  View.preload = (): Promise<unknown> => (isMobileViewport() ? mobile : desktop)()
  return View
}
