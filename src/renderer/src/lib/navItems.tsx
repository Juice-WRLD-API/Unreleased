import { SearchCode, HardDrive, ListMusic, Heart, BookOpen, Newspaper, Gamepad2, BarChart3, House, User, Download, Upload, Info, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import logo from '../assets/logo.png'
import type { ViewType } from '../types'
import ChatNavIcon from '../components/chat/ChatNavIcon'

// The primary nav destinations available to the desktop side menu (Sidebar).
// `view` doubles as the stable id persisted in the saved order/visibility -
// don't rename these. `electronOnly` items are hidden on the web build.
// `defaultHidden` items ship off - they're the extras the user can add to the
// menu from Settings. The mobile BottomNav uses its own curated set and is
// unaffected.
export interface NavItemDef {
  view: ViewType
  label: string
  icon: ReactNode
  electronOnly?: boolean
  /** Always lands in the mobile "More" sheet rather than a direct bar slot,
   *  regardless of how much room the bar has - for destinations Home already
   *  gives a shortcut to (or, for News, doesn't need one), so a bar slot
   *  would just crowd out more frequently used tabs. No effect on desktop. */
  mobileOverflow?: boolean
  defaultHidden?: boolean
  /** Can't be toggled off from Settings - always occupies a bar slot. */
  alwaysVisible?: boolean
  /** Only exists for managers/administrators - dropped from every list otherwise. */
  staffOnly?: boolean
}

export const NAV_ITEMS: NavItemDef[] = [
  // Desktop-only - mobile reaches WRLD through the mini player, not this
  // list (see MOBILE_HIDDEN_VIEWS in useMobileNavTabs), same as it always
  // has.
  { view: 'wrld', label: 'WRLD', icon: <img src={logo} alt="WRLD" className="w-[24px] h-[24px] object-contain" /> },
  // The landing page on both shells, so it's pinned rather than optional -
  // hiding it would leave the app with no way back to where it opened.
  { view: 'home', label: 'Home', icon: <House size={18} />, alwaysVisible: true },
  { view: 'api-tracker', label: 'Tracker', icon: <SearchCode size={18} /> },
  { view: 'api-files', label: 'Files', icon: <HardDrive size={18} /> },
  // `view` stays 'heardle' - it's the persisted id (and the /heardle route);
  // only the label is Games, so the tab can hold more than one game later.
  // Excluded from the mobile bar/More entirely (see useMobileNavTabs'
  // MOBILE_HIDDEN_VIEWS) - Home's Games section already covers it directly.
  { view: 'heardle', label: 'Games', icon: <Gamepad2 size={18} />, defaultHidden: true },
  // Same as Games: hidden from mobile entirely, since Home's own Playlists
  // section is the real mobile entry point now.
  { view: 'playlists', label: 'Playlists', icon: <ListMusic size={18} /> },
  { view: 'chat', label: 'Chat', icon: <ChatNavIcon size={18} />, staffOnly: true },
  // Off by default, addable from Settings → Menu items - same as Liked/Docs
  // below. (No mobileOverflow: that flag forces a tab into the "More" sheet
  // even once the user has explicitly turned it on, which reads as "I
  // enabled this and it still isn't in the bar." Once shown, these behave
  // like any other optional tab - a direct bar slot, subject to the cap.)
  { view: 'stats', label: 'Wrapped', icon: <BarChart3 size={18} />, defaultHidden: true },
  { view: 'news', label: 'News', icon: <Newspaper size={18} />, defaultHidden: true },
  // Extras - off by default, addable from Settings → Appearance → Menu items.
  { view: 'liked', label: 'Liked Songs', icon: <Heart size={18} />, defaultHidden: true },
  { view: 'docs', label: 'API Docs', icon: <BookOpen size={18} />, defaultHidden: true },
]

export const DEFAULT_NAV_ORDER: ViewType[] = NAV_ITEMS.map((i) => i.view)

// Views that live inside another tab rather than owning one. The Games tab is
// entered as 'heardle' but holds a view per game, so the menu has to highlight
// it for all of them - a nav item that goes dark the moment you switch game
// reads as having navigated out of the tab.
const TAB_OF: Partial<Record<ViewType, ViewType>> = {
  wordle: 'heardle',
  tierlist: 'heardle',
}

/** The nav tab `view` belongs to - itself, unless it's a sub-view. */
export function navTabFor(view: ViewType): ViewType {
  return TAB_OF[view] ?? view
}

const LS_LAST_GAME = 'unreleased:games:last'

/** The view a tab click actually lands on. Games reopens on the game last
 *  played: with a round in progress in one of them, coming back to the tab and
 *  landing on the other reads as having lost it. */
const GAME_VIEWS: ViewType[] = ['heardle', 'wordle', 'tierlist']

export function tabEntryView(view: ViewType): ViewType {
  if (view !== 'heardle') return view
  try {
    const last = localStorage.getItem(LS_LAST_GAME) as ViewType | null
    return last && GAME_VIEWS.includes(last) ? last : 'heardle'
  } catch {
    return 'heardle'
  }
}

/** Remember `view` as where its tab reopens. Called by whichever game is on
 *  screen, so a /wordle link counts the same as the switcher does. */
export function rememberTabView(view: ViewType): void {
  if (navTabFor(view) !== 'heardle') return
  try {
    localStorage.setItem(LS_LAST_GAME, view)
  } catch {}
}

// Default visibility per item, keyed by view. Persisted overrides are merged
// onto this (see the store), so an item added in a newer version picks up its
// own default automatically instead of a stale saved map deciding for it.
export const DEFAULT_NAV_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  NAV_ITEMS.map((i) => [i.view, !i.defaultHidden]),
)

// Reorder NAV_ITEMS by a saved list of view ids. Ids in `order` that no longer
// exist are skipped; items missing from `order` (e.g. a destination added in a
// newer version than the saved order) keep their canonical position, appended
// after the saved ones - so a stale persisted order never hides a new tab.
export function orderedNavItems(order: ViewType[], includeStaff = false): NavItemDef[] {
  const byView = new Map(NAV_ITEMS.map((i) => [i.view, i]))
  const seen = new Set<ViewType>()
  const out: NavItemDef[] = []
  for (const view of order) {
    const item = byView.get(view)
    if (item && !seen.has(view)) { out.push(item); seen.add(view) }
  }
  for (const item of NAV_ITEMS) if (!seen.has(item.view)) out.push(item)
  return includeStaff ? out : out.filter((i) => !i.staffOnly)
}

// Hard cap on the mobile bottom nav's direct buttons, Settings included - a
// phone-width row scrolling to reach an 8th or 9th enabled item (the original
// behavior) is worse than just not offering that many at once. Above the cap,
// the tail overflows into the "More" sheet, opened from a button on Home
// rather than the bar itself - so unlike the old in-bar "More" tab, a direct
// slot never has to be reserved for the trigger; the cap here is exactly the
// bar's real capacity minus the pinned Settings slot.
export const MAX_MOBILE_TABS = 6

/** Split an already-filtered, already-ordered list of mobile nav items into
 *  the ones the bottom bar shows directly and the tail that overflows into
 *  the "More" sheet. Pure - callers supply the visible, ordered list (see
 *  BottomNav, HomeView, MoreNavSheet) so this has no store dependency.
 *  `mobileOverflow` items are pulled out regardless of how much room is
 *  left - they don't compete for the cap at all - so freeing up bar space
 *  elsewhere (as removing Playlists/Games did) can't pull them back in. */
export function splitMobileNavTabs(items: NavItemDef[]): { tabs: NavItemDef[]; moreTabs: NavItemDef[] } {
  const tabs: NavItemDef[] = []
  const moreTabs: NavItemDef[] = []
  for (const item of items) {
    if (!item.mobileOverflow && tabs.length < MAX_MOBILE_TABS - 1) tabs.push(item)
    else moreTabs.push(item)
  }
  return { tabs, moreTabs }
}

// True when an item should render in the side menu: platform-eligible and not
// toggled off. `visibility` is the merged map (defaults + user overrides).
export function isNavItemVisible(item: NavItemDef, visibility: Record<string, boolean>, isElectron: boolean): boolean {
  if (item.electronOnly && !isElectron) return false
  if (item.alwaysVisible) return true
  return visibility[item.view] ?? !item.defaultHidden
}

// ─── Bottom-section controls ─────────────────────────────────────────────────
// The account/utility buttons at the foot of the side menu - reorderable and
// hideable just like the nav tabs, but they're actions rather than views, so
// the Sidebar owns their behavior and renders each by id. `login` and the
// collapse toggle are deliberately NOT here: they stay pinned so the user can
// never hide the only ways to sign in or re-expand a collapsed menu.
export type NavControlId = 'profile' | 'uploads' | 'diagnostics' | 'download' | 'settings'

export interface NavControlDef {
  id: NavControlId
  label: string
  icon: ReactNode
  defaultHidden?: boolean
}

export const NAV_CONTROLS: NavControlDef[] = [
  { id: 'profile', label: 'Profile', icon: <User size={18} /> },
  { id: 'uploads', label: 'Uploads', icon: <Upload size={18} /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Info size={18} /> },
  { id: 'download', label: 'Download app', icon: <Download size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
]

export const DEFAULT_NAV_CONTROL_ORDER: NavControlId[] = NAV_CONTROLS.map((c) => c.id)

export const DEFAULT_NAV_CONTROL_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  NAV_CONTROLS.map((c) => [c.id, !c.defaultHidden]),
)

export function orderedNavControls(order: string[]): NavControlDef[] {
  const byId = new Map(NAV_CONTROLS.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: NavControlDef[] = []
  for (const id of order) {
    const c = byId.get(id as NavControlId)
    if (c && !seen.has(id)) { out.push(c); seen.add(id) }
  }
  for (const c of NAV_CONTROLS) if (!seen.has(c.id)) out.push(c)
  return out
}

export interface NavControlCtx { account: boolean; isElectron: boolean; developerMode: boolean; hasUploads: boolean }

// Whether a control applies to the current session at all (regardless of the
// user's show/hide choice): profile needs an account, download is web only,
// diagnostics needs developer mode, uploads needs something to show (an
// active transfer or this session's history) - otherwise it's a button that
// opens an empty panel - settings is always available.
export function isNavControlAvailable(id: NavControlId, ctx: NavControlCtx): boolean {
  switch (id) {
    case 'profile': return ctx.account
    case 'download': return !ctx.isElectron
    case 'diagnostics': return ctx.developerMode
    case 'uploads': return ctx.hasUploads
    case 'settings': return true
  }
}

export function isNavControlVisible(def: NavControlDef, visibility: Record<string, boolean>, ctx: NavControlCtx): boolean {
  return isNavControlAvailable(def.id, ctx) && (visibility[def.id] ?? !def.defaultHidden)
}
