import { useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { ViewType } from '../types'
import { navTabFor, tabEntryView } from '../lib/navItems'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { preloadView } from '../lib/lazyViews'
import { useChatStore } from '../store/chatStore'

// The mobile nav bar - the counterpart to the desktop Sidebar, which it now
// shares its destination list with. It used to hardcode its own four tabs,
// which meant Settings → Appearance → "Menu items" (order + show/hide) silently
// did nothing on a phone; the same maps drive both surfaces here.
//
// Always bottom-anchored - unlike the desktop Sidebar (left/right/top/bottom,
// via `sidebarPosition`), mobile no longer offers a way to move this bar; a
// vertical rail never fit a phone anyway, and top placement wasn't worth the
// two-way UI it required. Deliberately not reading `sidebarPosition` at all:
// that field is desktop's, and a value of 'top' saved there (or synced from a
// desktop session) must never flip this bar - see App.tsx's `isMobile` guard
// on the matching top-inset padding.
//
// Hard-capped (see MAX_MOBILE_TABS in lib/navItems), Settings always last -
// a phone-width row scrolling to reach an 8th or 9th enabled item (the
// original behavior) is worse than not offering that many at once. Anything
// past the cap doesn't get a button here at all any more: it lives in the
// "More" sheet (MoreNavSheet.tsx), opened from a button on Home rather than a
// tab in this bar - see useMobileNavSplit for the shared tabs/moreTabs split.

export default function BottomNav(): JSX.Element {
  const { activeView, setActiveView, toggleSettings } =
    useStorePick('activeView', 'setActiveView', 'toggleSettings')
  const showSettings = activeView === 'settings'
  const { tabs } = useMobileNavSplit()
  const mobileRoomOpen = useChatStore((s) => s.mobileRoomOpen)
  // Same full-immersion treatment as WRLD below: once a chat room is open,
  // its own overlay covers the space this bar would have used, and the
  // back gesture/header already gets you out - a nav bar peeking behind it
  // is just visual noise.
  const hidden = activeView === 'wrld' || (activeView === 'chat' && mobileRoomOpen)

  const navigateTo = (view: ViewType): void => {
    // Re-tapping the already-active Playlists tab dispatches a back event
    // instead of going through setActiveView (it's a no-op there - same view).
    if (activeView === view && view === 'playlists') {
      window.dispatchEvent(new CustomEvent('playlists:back'))
    } else {
      // A tab holding several views (Games: Heardle/Wordle) reopens on
      // whichever one was last played.
      setActiveView(tabEntryView(view))
    }
  }

  const tabCls = (active: boolean): string =>
    `flex-1 min-w-0 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors relative overflow-hidden ${
      active ? 'text-accent' : 'text-text-muted'
    }`
  const labelCls = 'text-[10px] font-semibold leading-none w-full text-center truncate px-0.5'
  const marker = (active: boolean): JSX.Element | null => active ? (
    <span
      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
      style={{ background: 'var(--accent)' }}
    />
  ) : null

  // Published as a CSS var so other full-screen overlays (mobile Settings)
  // can carve out exactly this much space instead of covering the nav bar -
  // measured rather than hardcoded since it varies with the safe-area inset.
  // Zero on desktop, where this is display:none and the rule is a no-op.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const publish = (): void => {
      document.documentElement.style.setProperty('--bottom-nav-height', `${el.offsetHeight}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => { ro.disconnect(); document.documentElement.style.setProperty('--bottom-nav-height', '0px') }
  }, [])

  return (
    <nav
      ref={navRef}
      // Hidden on WRLD (mobile) and while a chat room is open - both want
      // full-screen immersion, and their own layouts already reclaim the
      // freed space (see --bottom-nav-height, published below and read
      // there).
      // bg-surface, not bg-sidebar: on the dark skin --sidebar is pure black,
      // noticeably blacker than the app's own --surface - stacked with the
      // safe-area-inset-bottom padding below the icons, that read as a stark,
      // "dead" slab distinct from the rest of the app instead of part of it.
      className={`md:hidden ${hidden ? 'hidden' : 'flex'} items-stretch bg-surface shrink-0`}
      style={{ borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((tab) => {
        const active = navTabFor(activeView) === tab.view
        return (
          // Touch has no hover, so warm the chunk on pointerdown - still lands
          // ~80-150ms before the click that needs it.
          <button key={tab.view} onPointerDown={() => preloadView(tab.view)} onClick={() => navigateTo(tab.view)} className={tabCls(active)}>
            {marker(active)}
            {/* NAV_ITEMS icons are sized for the 18px side menu; scale them up
                to a touch-appropriate 24 without forking the definitions. */}
            <span className="[&_svg]:w-6 [&_svg]:h-6 [&_img]:w-7 [&_img]:h-7 flex items-center justify-center">{tab.icon}</span>
            <span className={labelCls}>{tab.label}</span>
          </button>
        )
      })}

      {/* Never hideable or counted against the cap: on mobile this is the
          only route into Settings. */}
      <button onPointerDown={() => preloadView('settings')} onClick={() => toggleSettings()} className={tabCls(showSettings)}>
        {marker(showSettings)}
        <Settings size={24} />
        <span className={labelCls}>Settings</span>
      </button>
    </nav>
  )
}
