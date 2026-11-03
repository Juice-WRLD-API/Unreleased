import { Upload } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { navTabFor, tabEntryView } from '../lib/navItems'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { preloadView } from '../lib/lazyViews'
import { Sheet, SheetDivider, SheetItem } from './mobile/Sheet'

// The bottom sheet for nav items that don't fit the bar directly - opened
// from a button on Home rather than a tab of its own; see BottomNav's
// removal of the in-bar "More" button for why. Built on the shared Sheet, so
// it drags, animates and answers the back button like every other sheet.
export default function MoreNavSheet(): JSX.Element | null {
  const { activeView, setActiveView, showMoreNav, setShowMoreNav, setShowUploadManager, uploads } =
    useStorePick('activeView', 'setActiveView', 'showMoreNav', 'setShowMoreNav', 'setShowUploadManager', 'uploads')
  const { moreTabs } = useMobileNavSplit()

  if (!showMoreNav) return null

  const pendingCount = uploads.filter((u) => u.state === 'downloading').length

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

  return (
    <Sheet title="More" onClose={() => setShowMoreNav(false)}>
      {moreTabs.map((tab) => (
        <SheetItem
          key={tab.view}
          glyph={tab.icon}
          label={tab.label}
          active={navTabFor(activeView) === tab.view}
          onPointerDown={() => preloadView(tab.view)}
          onClick={() => navigateTo(tab.view)}
        />
      ))}
      {moreTabs.length > 0 && <SheetDivider />}
      {/* Not a view - opens the Transfers panel (UploadManager), which on
          desktop hangs off the Sidebar. Staged proposals live there. */}
      <SheetItem
        icon={Upload}
        label="Transfers"
        onClick={() => { setShowMoreNav(false); setShowUploadManager(true) }}
        trailing={pendingCount > 0 ? (
          <span className="min-w-[20px] h-5 rounded-full bg-accent text-white text-caption2 font-bold flex items-center justify-center px-1.5">
            {pendingCount}
          </span>
        ) : undefined}
      />
    </Sheet>
  )
}
