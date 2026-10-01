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
type CommitFreshness = 'checking' | 'latest' | 'refresh-needed' | 'outdated' | 'error' | 'unknown'

// Module-level memo so every Settings mount (desktop/mobile, closing and
// reopening the About tab) doesn't re-hit the GitHub API - it's a plain
// unauthenticated fetch subject to GitHub's 60/hr rate limit.
let cached: { freshness: CommitFreshness; ts: number } | undefined
const CACHE_MS = 5 * 60 * 1000

// The commit the site is serving right now, from the `version.json` the build
// emits (see emitVersionFile in vite.config.ts). null when it can't be read -
// dev server, Electron, offline, or a host that answers unknown paths with
// index.html - in which case the caller falls back to GitHub alone.
async function fetchDeployedCommit(): Promise<string | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { commit?: unknown }
    return typeof data.commit === 'string' && data.commit ? data.commit : null
  } catch {
    return null
  }
}

export interface BranchTip {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

async function fetchBranchTipCommit(): Promise<BranchTip> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BUILD_BRANCH}`, {
    headers: { Accept: 'application/vnd.github+json' },
    // Our own `cached` module var already governs staleness (see CACHE_MS
    // above) - the browser's HTTP cache doing the same thing underneath it
    // is what makes refresh() look like a no-op, since a plain GET here is
    // otherwise a normal cacheable request the browser is free to reuse.
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(String(res.status))
  const data = (await res.json()) as {
    sha?: string
    html_url?: string
    commit?: { message?: string; author?: { name?: string; date?: string }; committer?: { date?: string } }
  }
  if (!data.sha) throw new Error('no sha')
  return {
    sha: data.sha,
    message: data.commit?.message ?? '',
    author: data.commit?.author?.name ?? 'unknown',
    date: data.commit?.committer?.date ?? data.commit?.author?.date ?? '',
    url: data.html_url ?? `https://github.com/${REPO}/commit/${data.sha}`,
  }
}

async function fetchBranchTip(): Promise<string> {
  return (await fetchBranchTipCommit()).sha
}

// 'live'      the site is serving the branch's latest commit
// 'building'  the site is still serving an older commit (not built/deployed yet)
// 'unknown'   the site's version.json couldn't be read (dev server, Electron,
//             offline), so the best we can say is whether *this* build matches
export interface ChangelogStatus {
  branch: string
  tip: BranchTip
  deployed: string | null
  running: string
  built: 'live' | 'building' | 'unknown'
  // This tab booted from an older build than the one now live - a reload runs it.
  needsReload: boolean
}

// Backs /changelog: the newest commit on this build's branch, and whether the
// deployed site has caught up to it - same two sources (`version.json`, the
// GitHub branch tip) as the About page's freshness bulb above.
export async function fetchChangelogStatus(): Promise<ChangelogStatus> {
  if (BUILD_BRANCH === 'unknown') throw new Error("This build doesn't know which branch it came from")
  const [tip, deployed] = await Promise.all([fetchBranchTipCommit(), fetchDeployedCommit()])
  const built = deployed === null ? 'unknown' : tip.sha.startsWith(deployed) ? 'live' : 'building'
  const needsReload = built === 'live' && COMMIT_HASH !== 'dev' && COMMIT_HASH !== 'unknown' && !tip.sha.startsWith(COMMIT_HASH)
  return { branch: BUILD_BRANCH, tip, deployed, running: COMMIT_HASH, built, needsReload }
}

// Works out whether this build is up to date, in order of what a reload can fix:
//  1. the site is serving a different commit than this tab booted with ->
//     'refresh-needed' (a reload gets it; no need to ask GitHub)
//  2. otherwise this tab matches the site, so compare against the branch tip on
//     GitHub: a newer commit there means it isn't live yet -> 'outdated'
// `refresh()` forces a re-check, bypassing the cache TTL - used when the bulb
// is clicked.
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
    const check = async (): Promise<CommitFreshness> => {
      const deployed = await fetchDeployedCommit()
      if (deployed && deployed !== COMMIT_HASH) return 'refresh-needed'
      const tip = await fetchBranchTip()
      return tip.startsWith(COMMIT_HASH) ? 'latest' : 'outdated'
    }
    check()
      .then((result) => {
        if (cancelled) return
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

// Combines the deployed-site/GitHub check with the service-worker signal
// above into the single status the About bulb renders:
//  - 'outdated'      (red)    GitHub has a newer commit than this build, and
//                              the site isn't serving it yet - a reload won't help
//  - 'refresh-needed' (yellow) the site is already serving a newer build (or a
//                              new service worker took over underneath this
//                              tab) - reload to actually run it
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
