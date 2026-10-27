import { createPortal } from 'react-dom'
import { useStorePick } from '../store/useStore'
import { navTabFor, tabEntryView } from '../lib/navItems'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { useBackToClose } from '../hooks/useBackToClose'
import { preloadView } from '../lib/lazyViews'

// The bottom sheet for nav items that don't fit the bar directly - opened
// from a button on Home rather than a tab of its own; see BottomNav's
// removal of the in-bar "More" button for why.
export default function MoreNavSheet(): JSX.Element | null {
  const { activeView, setActiveView, showMoreNav, setShowMoreNav } =
    useStorePick('activeView', 'setActiveView', 'showMoreNav', 'setShowMoreNav')
  const { moreTabs } = useMobileNavSplit()
  useBackToClose(() => setShowMoreNav(false), showMoreNav)

  if (!showMoreNav) return null

  const navigateTo = (view: (typeof moreTabs)[number]['view']): void => {
    // Re-tapping the already-active Playlists row dispatches a back event
    // instead of going through setActiveView (it's a no-op there - same view).
    if (activeView === view && view === 'playlists') {
      window.dispatchEvent(new CustomEvent('playlists:back'))
    } else {
      setActiveView(tabEntryView(view))
    }
    setShowMoreNav(false)
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setShowMoreNav(false)} />
      <div
        className="fixed z-[61] left-0 right-0 bottom-0 rounded-t-2xl bg-surface border border-[var(--border)] border-b-0 shadow-2xl max-h-[75svh] overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-text-primary font-bold text-base">More</h3>
        </div>
        <div className="pb-2">
          {moreTabs.map((tab) => {
            const active = navTabFor(activeView) === tab.view
            return (
              <button
                key={tab.view}
                onPointerDown={() => preloadView(tab.view)}
                onClick={() => navigateTo(tab.view)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                  active ? 'text-accent bg-accent/10' : 'text-text-primary hover:bg-[var(--surface-overlay)] active:bg-[var(--surface-overlay)]'
                }`}
              >
                <span className="[&_svg]:w-6 [&_svg]:h-6 [&_img]:w-7 [&_img]:h-7 flex items-center justify-center">{tab.icon}</span>
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}
