import { createElement, lazy, Suspense, ComponentType, LazyExoticComponent } from 'react'
import { useIsMobile, isMobileViewport } from '../hooks/useIsMobile'

// Lazy views load their chunk by hashed filename baked into the running bundle.
// On the web that filename stops existing the moment the site redeploys, so a
// tab left open across a deploy throws "Failed to fetch dynamically imported
// module" the first time the user navigates to a lazy view. The chunk isn't
// coming back — only a reload gets the new index.html with the new hashes.
//
// The same error also fires on a plain network blip — iOS throws "Importing a
// module script failed" when a tab resumes from the background before the
// radio is back. So: retry with a short backoff, waiting out an offline spell
// first, then reload the page once. WebKit keeps a failed module in its module
// map for the life of the document, so there only the reload can recover, and
// reloading while still offline just boots the cached shell into the same
// failure — hence waiting for the network before reloading too.
// The sessionStorage stamp keeps a chunk that fails for any *other* reason
// (blocked by an extension, a broken deploy) from putting the app in a reload
// loop — after one attempt the error falls through to the ErrorBoundary.
const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_COOLDOWN_MS = 15_000
const RETRY_DELAYS_MS = [500, 2000]
const ONLINE_WAIT_MS = 15_000

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(msg)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Resolve once the browser reports a connection (or after `maxMs`, since
 *  navigator.onLine can stick at false on some platforms). */
function waitForOnline(maxMs: number): Promise<void> {
  if (navigator.onLine !== false) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener('online', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, maxMs)
    window.addEventListener('online', done)
  })
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
      for (const delay of RETRY_DELAYS_MS) {
        await sleep(delay)
        await waitForOnline(ONLINE_WAIT_MS)
        try {
          return await factory()
        } catch {/* still failing — back off, then fall through to the reload */}
      }

      let last = 0
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) } catch {/* private mode */}
      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch {/* ignore */}
        // index.html ships without Cache-Control, so the browser may answer
        // the reload from its heuristic HTTP cache — the old build, whose
        // chunks are gone. Revalidating the entry first makes the reload
        // boot whatever is actually deployed.
        try {
          await Promise.race([fetch(window.location.href, { cache: 'reload' }), sleep(5000)])
        } catch {/* offline or blocked — reload anyway */}
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
