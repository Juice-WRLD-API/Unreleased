import { useStorePick } from '../store/useStore'
import { orderedNavItems, isNavItemVisible, splitMobileNavTabs, type NavItemDef } from '../lib/navItems'
import type { ViewType } from '../types'

// Games ('heardle' - see NAV_ITEMS) and Playlists: Home's own sections cover
// both directly, so a tab here would just be a second, less complete route
// to the same destination. WRLD: mobile already reaches it through the mini
// player/now-playing bar, its one real entry point on that surface - a nav
// tab would be a second, redundant route to the same full-screen view.
const MOBILE_HIDDEN_VIEWS: ViewType[] = ['heardle', 'playlists', 'wrld']

// Every mobile-eligible item, ordered - pulled out so BottomNav, HomeView
// (the "More" trigger), and MoreNavSheet (its contents) all agree on what's
// direct vs. overflowed vs. hidden.
function useMobileEligibleItems(): NavItemDef[] {
  const { navOrder } = useStorePick('navOrder')
  return orderedNavItems(navOrder).filter((i) => !MOBILE_HIDDEN_VIEWS.includes(i.view))
}

// The bar's direct slots come only from items the user has toggled on; the
// "More" sheet is the catch-all for everything else reachable on mobile -
// both the tail that overflows the bar's cap and items switched off in
// Settings - so every destination stays one tap from Home even if it never
// earned (or lost) a spot in the bar itself.
export function useMobileNavSplit(): { tabs: NavItemDef[]; moreTabs: NavItemDef[] } {
  const { navVisibility } = useStorePick('navVisibility')
  const eligible = useMobileEligibleItems()
  const visible = eligible.filter((i) => isNavItemVisible(i, navVisibility, false))
  const hidden = eligible.filter((i) => !isNavItemVisible(i, navVisibility, false))
  const { tabs, moreTabs } = splitMobileNavTabs(visible)
  return { tabs, moreTabs: [...moreTabs, ...hidden] }
}
