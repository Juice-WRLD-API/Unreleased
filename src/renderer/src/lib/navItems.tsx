import { Home, SearchCode, SquareTerminal, HardDrive, Library, ListMusic, Heart, BookOpen, Newspaper, Gamepad2, BarChart3, Shield, User, LogOut, Info, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import logo from '../assets/logo.png'
import type { ViewType } from '../types'

// The primary nav destinations available to the desktop side menu (Sidebar).
// `view` doubles as the stable id persisted in the saved order/visibility —
// don't rename these. `electronOnly` items (Library) are hidden on the web
// build. `defaultHidden` items ship off — they're the extras the user can add
// to the menu from Settings. The mobile BottomNav uses its own curated set and
// is unaffected.
export interface NavItemDef {
  view: ViewType
  label: string
  icon: ReactNode
  electronOnly?: boolean
  defaultHidden?: boolean
  /** Can't be toggled off from Settings - always occupies a bar slot. */
  alwaysVisible?: boolean
  /** Only exists for managers/administrators - dropped from every list otherwise. */
  staffOnly?: boolean
  /** Only exists for accounts with a staff profile (showStaffProfile) - the
   *  personal Admin/Editor/Manager/Contributor page. Dropped otherwise. */
  staffProfile?: boolean
}

export const NAV_ITEMS: NavItemDef[] = [
  { view: 'home', label: 'Home', icon: <Home size={18} /> },
  { view: 'wrld', label: 'WRLD', icon: <img src={logo} alt="WRLD" className="w-[24px] h-[24px] object-contain" /> },
  { view: 'api-tracker', label: 'Tracker', icon: <SearchCode size={18} /> },
  { view: 'api-files', label: 'Files', icon: <HardDrive size={18} /> },
  { view: 'library', label: 'Library', icon: <Library size={18} />, electronOnly: true },
  { view: 'playlists', label: 'Playlists', icon: <ListMusic size={18} /> },
  // `view` stays 'heardle' — it's the persisted id (and the /heardle route);
  // only the label is Games, so the tab can hold more than one game later.
  { view: 'heardle', label: 'Games', icon: <Gamepad2 size={18} /> },
  { view: 'stats', label: 'Wrapped', icon: <BarChart3 size={18} /> },
  { view: 'news', label: 'News', icon: <Newspaper size={18} /> },
  // Extras — off by default, addable from Settings → Appearance → Menu items.
  { view: 'liked', label: 'Liked Songs', icon: <Heart size={18} />, defaultHidden: true },
  { view: 'docs', label: 'API Docs', icon: <BookOpen size={18} />, defaultHidden: true },
  // The staff page (the sidebar's profile entry, see openProfile). Off by
  // default, addable from Settings → Menu items; desktop only (mobile's bottom
  // bar already carries the profile button).
  { view: 'editor-profile', label: 'Staff', icon: <Shield size={18} />, defaultHidden: true, staffProfile: true },
  // Off by default, addable from Settings → Menu items.
  { view: 'terminal', label: 'Terminal', icon: <SquareTerminal size={18} />, defaultHidden: true },
]

export const DEFAULT_NAV_ORDER: ViewType[] = NAV_ITEMS.map((i) => i.view)

// Views that live inside another tab rather than owning one. The Games tab is
// entered as 'heardle' but holds a view per game, so the menu has to highlight
// it for all of them — a nav item that goes dark the moment you switch game
// reads as having navigated out of the tab.
const TAB_OF: Partial<Record<ViewType, ViewType>> = {
  wordle: 'heardle',
  tierlist: 'heardle',
  // openProfile lands contributor-only accounts here instead.
  'contributor-profile': 'editor-profile',
}

/** The nav tab `view` belongs to — itself, unless it's a sub-view. */
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
export function orderedNavItems(order: ViewType[], includeStaff = false, includeStaffProfile = false): NavItemDef[] {
  const byView = new Map(NAV_ITEMS.map((i) => [i.view, i]))
  const seen = new Set<ViewType>()
  const out: NavItemDef[] = []
  for (const view of order) {
    const item = byView.get(view)
    if (item && !seen.has(view)) { out.push(item); seen.add(view) }
  }
  for (const item of NAV_ITEMS) if (!seen.has(item.view)) out.push(item)
  return out.filter((i) => (includeStaff || !i.staffOnly) && (includeStaffProfile || !i.staffProfile))
}

// True when an item should render in the side menu: platform-eligible and not
// toggled off. `visibility` is the merged map (defaults + user overrides).
export function isNavItemVisible(item: NavItemDef, visibility: Record<string, boolean>, isElectron: boolean): boolean {
  if (item.electronOnly && !isElectron) return false
  return visibility[item.view] ?? !item.defaultHidden
}

// ─── Bottom-section controls ─────────────────────────────────────────────────
// The account/utility buttons at the foot of the side menu — reorderable and
// hideable just like the nav tabs, but they're actions rather than views, so
// the Sidebar owns their behavior and renders each by id. `login` and the
// collapse toggle are deliberately NOT here: they stay pinned so the user can
// never hide the only ways to sign in or re-expand a collapsed menu.
export type NavControlId = 'profile' | 'logout' | 'diagnostics' | 'settings'

export interface NavControlDef {
  id: NavControlId
  label: string
  icon: ReactNode
  defaultHidden?: boolean
}

export const NAV_CONTROLS: NavControlDef[] = [
  { id: 'profile', label: 'Profile', icon: <User size={18} /> },
  { id: 'logout', label: 'Log out', icon: <LogOut size={18} /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Info size={18} /> },
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

export interface NavControlCtx { account: boolean; isElectron: boolean; developerMode: boolean }

// Whether a control applies to the current session at all (regardless of the
// user's show/hide choice): profile/logout need an account, diagnostics needs
// developer mode, settings is always available.
export function isNavControlAvailable(id: NavControlId, ctx: NavControlCtx): boolean {
  switch (id) {
    case 'profile':
    case 'logout': return ctx.account
    case 'diagnostics': return ctx.developerMode
    case 'settings': return true
  }
}

export function isNavControlVisible(def: NavControlDef, visibility: Record<string, boolean>, ctx: NavControlCtx): boolean {
  return isNavControlAvailable(def.id, ctx) && (visibility[def.id] ?? !def.defaultHidden)
}
