import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { runBackHandlers } from '../lib/backHandlers'
import { IS_NATIVE_APP } from '../lib/platform'
import type { ViewType } from '../types'

// Android's hardware/gesture back, wired to the same thing it means everywhere
// else: undo the last step. Registering a backButton listener replaces the
// WebView's own handling, so without this back would either do nothing or
// close the app from anywhere, even with a modal open and music playing.
//
// Resolution order, first match wins:
//   1. a locally-registered handler (useBackToClose / backHandlers)
//   2. the topmost open overlay, innermost first
//   3. the previous view - setActiveView pushes a real history entry per
//      view, and App's popstate listener maps the URL back to a view, so
//      this is just history.back()
//   4. a non-home view with no history behind it (the app was cold-started
//      onto a deep link) → Home
//   5. nothing left → minimize rather than exit, so playback survives
//
// Desktop/web are untouched: the listener only attaches on a native platform.
const HOME_VIEW: ViewType = 'home'

export function useAndroidBackButton(): void {
  useEffect(() => {
    if (!IS_NATIVE_APP) return

    const goBack = (canGoBack: boolean): void => {
      if (runBackHandlers()) return

      // Innermost first: transient modals sit above the panels, which sit
      // above the page. Each closer is a no-op when that layer isn't open.
      const s = useStore.getState()
      if (s.reportModal)       { s.closeReport(); return }
      if (s.bulkEdit)          { s.closeBulkEditor(); return }
      if (s.infoSongId != null) { s.setInfoSongId(null); return }
      if (s.showUserAuth)      { s.setShowUserAuth(false); return }
      if (s.showUploadManager) { s.setShowUploadManager(false); return }
      if (s.showMoreNav)       { s.setShowMoreNav(false); return }
      if (s.showEqPanel)       { s.setShowEqPanel(false); return }
      if (s.showDiagnostics)   { s.setShowDiagnostics(false); return }
      if (s.showQueue)         { s.setShowQueue(false); return }

      if (canGoBack) { window.history.back(); return }
      if (s.activeView !== HOME_VIEW) { s.setActiveView(HOME_VIEW); return }
      // Nothing left to undo. Minimize instead of exitApp(): this is a music
      // player, and killing the process would stop playback outright.
      void import('@capacitor/app').then(({ App }) => App.minimizeApp())
    }

    let detach: (() => void) | null = null
    let disposed = false
    void import('@capacitor/app').then(async ({ App }) => {
      const handle = await App.addListener('backButton', ({ canGoBack }) => goBack(canGoBack))
      if (disposed) void handle.remove()
      else detach = () => { void handle.remove() }
    })

    return () => {
      disposed = true
      detach?.()
    }
  }, [])
}
