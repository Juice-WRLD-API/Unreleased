import { useEffect, useState } from 'react'

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

// The branch the web player is deployed from - what "latest" means for the
// commit-freshness check below.
const DEPLOY_BRANCH = 'web'
const REPO = 'Juice-WRLD-API/Unreleased'

export type CommitFreshness = 'checking' | 'latest' | 'outdated' | 'unknown'

// Module-level memo so every Settings mount (desktop/mobile, closing and
// reopening the About tab) doesn't re-hit the GitHub API - it's a plain
// unauthenticated fetch subject to GitHub's 60/hr rate limit.
let cached: { freshness: CommitFreshness; ts: number } | undefined
const CACHE_MS = 5 * 60 * 1000

// Compares the running build's COMMIT_HASH against the latest commit on
// DEPLOY_BRANCH to tell whether this build is up to date.
export function useCommitFreshness(): CommitFreshness {
  const [freshness, setFreshness] = useState<CommitFreshness>(cached?.ts && Date.now() - cached.ts < CACHE_MS ? cached.freshness : 'checking')

  useEffect(() => {
    if (COMMIT_HASH === 'dev' || COMMIT_HASH === 'unknown') {
      setFreshness('unknown')
      return
    }
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      setFreshness(cached.freshness)
      return
    }
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/commits/${DEPLOY_BRANCH}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { sha?: string }) => {
        if (cancelled) return
        const result: CommitFreshness = data.sha?.startsWith(COMMIT_HASH) ? 'latest' : 'outdated'
        cached = { freshness: result, ts: Date.now() }
        setFreshness(result)
      })
      .catch(() => {
        if (!cancelled) setFreshness('unknown')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return freshness
}
