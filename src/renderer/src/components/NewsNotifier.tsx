import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { NEWS_ENABLED, type NewsItem } from '../lib/newsApi'
import {
  checkForNewPosts, fireNewsNotification, mergeSubscriptionsFromProfile,
} from '../lib/newsNotifications'

// How often to poll for new posts in subscribed channels. The feed is small and
// this only runs in the main window, so a few minutes is plenty; a focus-driven
// check covers the "alt-tabbed back after a while" case between ticks.
const POLL_MS = 5 * 60 * 1000

// Alt-tabbing back and forth shouldn't refire the focus-driven check on every
// switch - only bother if it's actually been a while since the last run.
const FOCUS_POLL_MIN_INTERVAL_MS = 60 * 1000

// Headless - mounted once in the main window (App), next to LastfmScrobbler.
// Watches for new posts in the channels the user follows and raises an OS
// notification for each. Inert until the news backend exists (NEWS_ENABLED).
export default function NewsNotifier(): JSX.Element | null {
  const account = useStore((s) => s.account)
  const setActiveView = useStore((s) => s.setActiveView)

  // Avoid overlapping polls (a slow request straddling a tick / focus event).
  const runningRef = useRef(false)

  // Fold the profile's saved subscriptions into the local set once the account
  // (and its blob) is available.
  useEffect(() => {
    mergeSubscriptionsFromProfile(account?.news_subscriptions)
  }, [account])

  useEffect(() => {
    if (!NEWS_ENABLED) return

    const openPost = (item: NewsItem): void => {
      setActiveView('news')
      // NewsView reads this on mount to jump straight to the clicked post.
      try {
        sessionStorage.setItem('news:openPostId', String(item.id))
      } catch {}
      window.dispatchEvent(new CustomEvent('news:open', { detail: item.id }))
    }

    const run = async (): Promise<void> => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const fresh = await checkForNewPosts()
        for (const item of fresh) fireNewsNotification(item, openPost)
      } finally {
        runningRef.current = false
      }
    }

    run()
    let lastFocusRun = Date.now()
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocusRun < FOCUS_POLL_MIN_INTERVAL_MS) return
      lastFocusRun = now
      run()
    }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(run, POLL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [setActiveView])

  return null
}
