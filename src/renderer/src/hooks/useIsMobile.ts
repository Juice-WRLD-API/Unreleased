import { useState, useEffect } from 'react'

// Matches Tailwind's default `md` breakpoint - the same cutoff Sidebar/
// BottomNav already switch on via `hidden md:flex` / `md:hidden`, so a view
// that branches on this hook agrees with the shell chrome around it.
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

/** One-shot read of the same breakpoint, for code that runs before React
 *  does (the URL-to-view router in App.tsx) and can't hold a subscription. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

/** True below the `md` breakpoint. Viewport-based (not user-agent based -
 *  see IS_MOBILE in lib/platform.ts for device detection), so it also
 *  reflects a resized desktop browser window, consistent with the rest of
 *  the app's responsive chrome. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (): void => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
