import { useEffect } from 'react'

// React 18 StrictMode double-invokes every effect once in dev (mount →
// cleanup → mount) to surface missing cleanup logic. For a plain data-fetch
// effect, that disposable first invocation still fires a real network
// request - every fetch-on-mount hook was quietly double-hitting its
// endpoint in dev until this. Deferring the body by one microtask lets the
// guaranteed-synchronous cleanup of that first pass cancel it before it ever
// runs, leaving only the second (real) invocation's request outbound. Same
// idea already used ad hoc in Player.tsx, EditorProfileView, and
// useAdminQueue - this is just the shared version so future hooks don't
// reinvent it.
//
// `effect` receives an `isCancelled()` check to call before committing any
// async result (setState etc.) - same shape as an inline `cancelled` flag.
export function useStrictModeSafeEffect(
  effect: (isCancelled: () => boolean) => void,
  deps: React.DependencyList,
): void {
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) effect(() => cancelled) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
