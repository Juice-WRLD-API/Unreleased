import { useLayoutEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { ViewType } from '../types'
import { navTabFor, tabEntryView } from '../lib/navItems'
import { useMobileNavSplit } from '../hooks/useMobileNavTabs'
import { preloadView } from '../lib/lazyViews'
import { useChatUiStore } from '../store/chatUiStore'

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

// The mini player's capsule (56px) plus the 8px gaps above and below it -
// the room it takes between the nav bar and the page. Keep in step with the
// mobile bar in Player.tsx.
const MINI_PLAYER_SLOT = 72

export default function BottomNav(): JSX.Element {
  const { activeView, setActiveView, setShowSettings } =
    useStorePick('activeView', 'setActiveView', 'setShowSettings')
  const showSettings = activeView === 'settings'
  const { tabs } = useMobileNavSplit()
  const mobileRoomOpen = useChatUiStore((s) => s.mobileRoomOpen)
  // WRLD and an open chat room are both full-screen overlays drawn over this
  // bar (see App.tsx and ChatView.mobile). It stays laid out underneath them
  // rather than being hidden: dragging either one away then reveals the page
  // with its nav bar already in place, instead of the bar popping back in
  // (and the page reflowing around it) only once the overlay has unmounted.
  const covered = activeView === 'wrld' || (activeView === 'chat' && mobileRoomOpen)

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

  // Every slot in the capsule is the same width (flex-1), so the selection
  // pill only ever needs to move, never resize: transform-only, like iOS's
  // tab lens sliding between items.
  const slots = tabs.length + 1
  const activeIndex = showSettings ? tabs.length : tabs.findIndex((t) => navTabFor(activeView) === t.view)

  const tabCls = (active: boolean): string =>
    `relative z-[1] flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
      active ? 'text-accent' : 'text-text-primary'
    }`
  const labelCls = 'text-caption2 font-semibold w-full text-center truncate px-0.5'

  // Published as CSS vars for everything that has to clear the floating dock:
  // - --bottom-nav-height: the bar's height, but zero while an overlay covers
  //   it. The chat room sizes itself off this to reach the bottom edge, and
  //   toasts and the like sit over the overlay then, where there's no nav bar
  //   to clear.
  // - --nav-h: the real height, never zeroed. The mini player parks itself
  //   above this, so it doesn't jump while WRLD's curtain drag reveals it.
  // - --dock-h: the bar plus the mini player above it - what a scroller pads
  //   its end by (.pb-dock) so the last rows can scroll clear of the glass.
  //   Also never zeroed, so the page under a dragged WRLD doesn't reflow.
  // All zero on desktop, where this is display:none. Measured rather than
  // hardcoded since it varies with the safe-area inset. A layout effect so the
  // values are in place before an overlay's first paint.
  const navRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = navRef.current
    if (!el) return
    const root = document.documentElement.style
    const publish = (): void => {
      const h = el.offsetHeight
      root.setProperty('--bottom-nav-height', `${covered ? 0 : h}px`)
      root.setProperty('--nav-h', `${h}px`)
      root.setProperty('--dock-h', `${h > 0 ? h + MINI_PLAYER_SLOT : 0}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      for (const v of ['--bottom-nav-height', '--nav-h', '--dock-h']) root.setProperty(v, '0px')
    }
  }, [covered])

  return (
    <nav
      ref={navRef}
      // A floating glass capsule over the page rather than a slab under it:
      // the page runs to the bottom edge and scrolls beneath, so the bar
      // takes no layout space. pointer-events only on the capsule itself, so
      // the transparent margin around it doesn't swallow taps on the page.
      className="md:hidden fixed inset-x-0 bottom-0 z-20 px-4 pointer-events-none"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
    >
      <div className="glass pointer-events-auto relative flex items-stretch h-[62px] p-1 rounded-full">
        <span
          aria-hidden
          className="absolute top-1 bottom-1 left-1 rounded-full bg-[var(--fill)] control-motion"
          style={{
            width: `calc((100% - 0.5rem) / ${slots})`,
            transform: `translateX(${Math.max(0, activeIndex) * 100}%)`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
        />
        {tabs.map((tab) => {
          const active = navTabFor(activeView) === tab.view
          return (
            // Touch has no hover, so warm the chunk on pointerdown - still lands
            // ~80-150ms before the click that needs it.
            <button key={tab.view} onPointerDown={() => preloadView(tab.view)} onClick={() => navigateTo(tab.view)} className={tabCls(active)} aria-current={active ? 'page' : undefined}>
              {/* NAV_ITEMS icons are sized for the 18px side menu; scale them up
                  to a touch-appropriate 24 without forking the definitions. */}
              <span className="[&_svg]:w-6 [&_svg]:h-6 [&_img]:w-7 [&_img]:h-7 flex items-center justify-center">{tab.icon}</span>
              <span className={labelCls}>{tab.label}</span>
            </button>
          )
        })}

        {/* Never hideable or counted against the cap: on mobile this is the
            only route into Settings. Behaves like the other tabs - re-tapping
            while open is a no-op (setShowSettings(true) is "always open"),
            not a toggle; Settings' own back control closes it. */}
        <button onPointerDown={() => preloadView('settings')} onClick={() => setShowSettings(true)} className={tabCls(showSettings)} aria-current={showSettings ? 'page' : undefined}>
          <Settings size={24} />
          <span className={labelCls}>Settings</span>
        </button>
      </div>
    </nav>
  )
}
