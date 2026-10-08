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
async function fetchDeployedCommit(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store', signal })
    if (!res.ok) return null
    const data = (await res.json()) as { commit?: unknown }
    return typeof data.commit === 'string' && data.commit ? data.commit : null
  } catch (err) {
    if (signal?.aborted) throw err
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

// A commit's page on GitHub, built from its sha alone. Anything that renders a
// commit it didn't fetch itself (a card pasted into chat) links this, never a
// URL carried in the payload.
export const commitUrl = (sha: string): string => `https://github.com/${REPO}/commit/${sha}`

interface GithubCommit {
  sha?: string
  html_url?: string
  commit?: { message?: string; author?: { name?: string; date?: string }; committer?: { date?: string } }
}

function toBranchTip(data: GithubCommit): BranchTip {
  if (!data.sha) throw new Error('no sha')
  return {
    sha: data.sha,
    message: data.commit?.message ?? '',
    author: data.commit?.author?.name ?? 'unknown',
    date: data.commit?.committer?.date ?? data.commit?.author?.date ?? '',
    url: commitUrl(data.sha),
  }
}

// Our own `cached` module var already governs staleness (see CACHE_MS above) -
// the browser's HTTP cache doing the same thing underneath it is what makes
// refresh() look like a no-op, since a plain GET here is otherwise a normal
// cacheable request the browser is free to reuse.
async function githubGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    signal,
  })
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as T
}

async function fetchBranchTipCommit(signal?: AbortSignal): Promise<BranchTip> {
  return toBranchTip(await githubGet<GithubCommit>(`commits/${BUILD_BRANCH}`, signal))
}

// Newest first, so [0] is the branch tip.
async function fetchBranchCommits(count: number, signal?: AbortSignal): Promise<BranchTip[]> {
  const list = await githubGet<GithubCommit[]>(`commits?sha=${encodeURIComponent(BUILD_BRANCH)}&per_page=${count}`, signal)
  if (!Array.isArray(list) || list.length === 0) throw new Error('no commits')
  return list.map(toBranchTip)
}

/** The commit this build was compiled from (message, author, date), by sha. */
export async function fetchRunningCommit(signal?: AbortSignal): Promise<BranchTip> {
  return toBranchTip(await githubGet<GithubCommit>(`commits/${encodeURIComponent(COMMIT_HASH)}`, signal))
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
  // `/changelog <count>` only: the commits before the tip, newest first.
  history?: BranchTip[]
}

export const CHANGELOG_MAX = 15

// Backs /changelog: the newest commit on this build's branch, and whether the
// deployed site has caught up to it - same two sources (`version.json`, the
// GitHub branch tip) as the About page's freshness bulb above. With a `count`
// above 1 the commits before it ride along as `history` (capped at
// CHANGELOG_MAX), from the same single GitHub request.
export async function fetchChangelogStatus(count = 1, signal?: AbortSignal): Promise<ChangelogStatus> {
  if (BUILD_BRANCH === 'unknown') throw new Error("This build doesn't know which branch it came from")
  const n = Math.min(Math.max(Math.floor(count), 1), CHANGELOG_MAX)
  const [commits, deployed] = await Promise.all([
    n > 1 ? fetchBranchCommits(n, signal) : fetchBranchTipCommit(signal).then((t) => [t]),
    fetchDeployedCommit(signal),
  ])
  return changelogStatusFrom(BUILD_BRANCH, commits, deployed)
}

// The branch this build came from, for naming it when asking the server for a
// changelog card.
export const buildBranch = (): string => BUILD_BRANCH

export function changelogStatusFrom(branch: string, commits: BranchTip[], deployed: string | null): ChangelogStatus {
  const [tip, ...history] = commits
  const built = deployed === null ? 'unknown' : tip.sha.startsWith(deployed) ? 'live' : 'building'
  const needsReload = built === 'live' && COMMIT_HASH !== 'dev' && COMMIT_HASH !== 'unknown' && !tip.sha.startsWith(COMMIT_HASH)
  return { branch, tip, deployed, running: COMMIT_HASH, built, needsReload, ...(history.length ? { history } : {}) }
}

// A changelog card posted to a room carries only the commits (the server read
// them from GitHub). Whether the newest is live is this viewer's own question -
// they're the one running, or not running, the deployed build - so it's worked
// out here, when the card is shown.
export async function changelogStatusForCommits(branch: string, commits: BranchTip[]): Promise<ChangelogStatus> {
  return changelogStatusFrom(branch, commits, await fetchDeployedCommit())
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
