import { useCallback, useEffect, useState } from 'react'

// The app version, read from the `__APP_VERSION__` build-time define in
// vite.config.ts.
//
// Always import this instead of referencing `__APP_VERSION__` directly. A bare
// identifier is a hard ReferenceError in any context where the define hasn't
// been applied (a dev server started from a checkout with an older vite config,
// a bundler that doesn't share our `define`, tests), and because it's evaluated
// during render that error takes down whatever component touched it - which is
// how Settings → About whited out the whole window.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

// The short git commit hash the running build was compiled from, read from
// the `__COMMIT_HASH__` build-time define in vite.config.ts. Same
// undefined-guard as APP_VERSION above, for the same reason.
export const COMMIT_HASH = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'

// The branch this build was actually made from, read from the
// `__BRANCH_NAME__` build-time define in vite.config.ts - what "latest"
// means for the commit-freshness check below. A hardcoded branch here would
// be wrong for anyone not building from that exact branch (a `web-dev`
// build, say, has no reason to ever match `web`'s tip), which is what made
// the freshness bulb read permanently red regardless of actual freshness.
const BUILD_BRANCH = typeof __BRANCH_NAME__ !== 'undefined' ? __BRANCH_NAME__ : 'unknown'
const REPO = 'Juice-WRLD-API/Unreleased'

// 'error' covers both a rate-limited response (403/429 - GitHub's
// unauthenticated API allows only 60 req/hr per IP) and any other fetch
// failure (offline, DNS, 5xx); we can't reliably tell those apart from the
// network layer alone (a 403 also fires for a private/missing repo), and
// "couldn't check" is the honest signal to show either way.
type CommitFreshness = 'checking' | 'latest' | 'outdated' | 'error' | 'unknown'

// Module-level memo so every Settings mount (desktop/mobile, closing and
// reopening the About tab) doesn't re-hit the GitHub API - it's a plain
// unauthenticated fetch subject to GitHub's 60/hr rate limit.
let cached: { freshness: CommitFreshness; ts: number } | undefined
const CACHE_MS = 5 * 60 * 1000

// Compares the running build's COMMIT_HASH against the latest commit on
// DEPLOY_BRANCH to tell whether this build is up to date. `refresh()` forces
// a re-check, bypassing the cache TTL - used when the bulb is clicked.
function useCommitFreshness(): [CommitFreshness, () => void] {
  const [freshness, setFreshness] = useState<CommitFreshness>(cached?.ts && Date.now() - cached.ts < CACHE_MS ? cached.freshness : 'checking')
  // Bumped by refresh() to force the effect below to re-run and skip the
  // cache, even when the cache is still within CACHE_MS.
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (COMMIT_HASH === 'dev' || COMMIT_HASH === 'unknown' || BUILD_BRANCH === 'unknown') {
      setFreshness('unknown')
      return
    }
    if (nonce === 0 && cached && Date.now() - cached.ts < CACHE_MS) {
      setFreshness(cached.freshness)
      return
    }
    setFreshness('checking')
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/commits/${BUILD_BRANCH}`, {
      headers: { Accept: 'application/vnd.github+json' },
      // Our own `cached` module var already governs staleness (see CACHE_MS
      // above) - the browser's HTTP cache doing the same thing underneath it
      // is what makes refresh() look like a no-op, since a plain GET here is
      // otherwise a normal cacheable request the browser is free to reuse.
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { sha?: string }) => {
        if (cancelled) return
        const result: CommitFreshness = data.sha?.startsWith(COMMIT_HASH) ? 'latest' : 'outdated'
        cached = { freshness: result, ts: Date.now() }
        setFreshness(result)
      })
      .catch(() => {
        // Not cached - a rate limit or blip shouldn't stick for CACHE_MS,
        // it should just get retried on the next mount or refresh.
        if (!cancelled) setFreshness('error')
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  return [freshness, refresh]
}

// True once a *different* service worker has taken control of this page than
// the one that was controlling it on load. Because sw.js calls skipWaiting()
// + clients.claim() (see src/renderer/public/sw.js), a new deploy activates
// in the background the moment its worker installs - it doesn't wait for
// this tab to close. 'controllerchange' is the browser's signal that just
// happened: the tab is still running the JS it booted with, but a reload
// will now fetch the new build.
function useServiceWorkerUpdated(): boolean {
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onControllerChange = (): void => setUpdated(true)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [])

  return updated
}

export type CommitStatus = 'checking' | 'latest' | 'refresh-needed' | 'outdated' | 'error' | 'unknown'

// Combines the GitHub-vs-COMMIT_HASH check with the service-worker signal
// above into the single status the About bulb renders:
//  - 'outdated'      (red)    a newer commit has been deployed - reload to get it
//  - 'refresh-needed' (yellow) this build IS the latest commit, but a new
//                              service worker already took over underneath
//                              this tab - reload to actually run it
//  - 'latest'        (green)  this build is current, nothing pending
//  - 'error'         (blue)   couldn't check (rate-limited or offline)
//  - 'checking'      (gray)   a check (initial or user-triggered) is in flight
// The returned `refresh()` re-runs the GitHub check on demand, e.g. from a
// click on the bulb.
export function useCommitStatus(): [CommitStatus, () => void] {
  const [freshness, refresh] = useCommitFreshness()
  const swUpdated = useServiceWorkerUpdated()
  const status: CommitStatus = freshness === 'latest' && swUpdated ? 'refresh-needed' : freshness
  return [status, refresh]
}
