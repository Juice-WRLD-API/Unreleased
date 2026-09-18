// Shared Appearance-tab logic for Settings - skins, accent color, menu-item
// reorder/reset, home-section reset, notification sound, sleep timer minutes,
// and audio-output device enumeration. Identical on desktop and mobile aside
// from the nav-item filter (mobile hides a couple of views with no mobile
// nav slot) and an optional post-create hook (mobile also closes its picker
// sheet after creating a skin).
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { hasChatAccess } from '../store/chatStore'
import { getSkin, createCustomSkin, parseSkinFile, type Skin } from '../lib/skins'
import {
  orderedNavItems, DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY, type NavItemDef,
} from '../lib/navItems'
import { HOME_SECTIONS, DEFAULT_HOME_SECTION_VISIBILITY, isHomeSectionVisible } from '../lib/homeSections'
import { getNotificationSoundId, setNotificationSoundId, playNotificationSound } from '../lib/notifications'

export function useSettingsAppearance(opts?: {
  filterNavRows?: (item: NavItemDef) => boolean
  onSkinCreated?: () => void
}): {
  customAccent: string
  setCustomAccent: (v: string) => void
  setAccentDebounced: (color: string) => void
  editingSkinId: string | null
  setEditingSkinId: (v: string | null) => void
  skinImportRef: React.RefObject<HTMLInputElement>
  skinImportError: string | null
  createSkin: () => void
  importSkinFile: (file: File) => Promise<void>
  navRows: ReturnType<typeof orderedNavItems>
  navIsDefault: boolean
  resetNav: () => void
  homeIsDefault: boolean
  resetHome: () => void
  moveNavItem: (fromRow: number, toRow: number) => void
  notificationSound: string
  chooseNotificationSound: (id: string) => void
  sleepMinutes: number
  setSleepMinutes: (v: number) => void
  devices: MediaDeviceInfo[]
} {
  const account = useStore((s) => s.account)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const saveCustomSkin = useStore((s) => s.saveCustomSkin)
  const setAccentColor = useStore((s) => s.setAccentColor)
  const accentColor = useStore((s) => s.accentColor)
  const navOrder = useStore((s) => s.navOrder)
  const setNavOrder = useStore((s) => s.setNavOrder)
  const navVisibility = useStore((s) => s.navVisibility)
  const setNavItemVisible = useStore((s) => s.setNavItemVisible)
  const homeSectionVisibility = useStore((s) => s.homeSectionVisibility)
  const setHomeSectionVisible = useStore((s) => s.setHomeSectionVisible)

  const [customAccent, setCustomAccent] = useState(accentColor)
  const accentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setAccentDebounced = (color: string): void => {
    if (accentDebounceRef.current) clearTimeout(accentDebounceRef.current)
    accentDebounceRef.current = setTimeout(() => setAccentColor(color), 80)
  }

  // Custom skins - which one the editor modal is open on (null = closed), the
  // hidden file input for Import, and a transient "that file wasn't a skin"
  // message shown under the section.
  const [editingSkinId, setEditingSkinId] = useState<string | null>(null)
  const skinImportRef = useRef<HTMLInputElement>(null)
  const [skinImportError, setSkinImportError] = useState<string | null>(null)

  // Clone the current look into a new editable skin, make it active (so the
  // editor previews live), and open the editor on it.
  const createSkin = (): void => {
    const skin = createCustomSkin(getSkin(theme), 'My skin')
    saveCustomSkin(skin)
    setTheme(skin.id)
    if (skin.accent) setCustomAccent(skin.accent)
    setEditingSkinId(skin.id)
    opts?.onSkinCreated?.()
  }

  const importSkinFile = async (file: File): Promise<void> => {
    setSkinImportError(null)
    const skin: Skin | null = parseSkinFile(await file.text())
    if (!skin) { setSkinImportError('That file isn’t a valid skin.'); return }
    saveCustomSkin(skin)
    setTheme(skin.id)
    if (skin.accent) { setAccentColor(skin.accent); setCustomAccent(skin.accent) }
    setEditingSkinId(skin.id)
  }

  // ── Menu items (Appearance) ──────────────────────────────────────────────
  // Every nav item in saved order - visible ones and the toggled-off extras
  // alike - so the list is where you both reorder and show/hide. Pinned items
  // (alwaysVisible) are listed too - they reorder like any other row - but
  // render without an eye on the calling side, since isNavItemVisible
  // short-circuits on them.
  const allNavRows = orderedNavItems(navOrder, hasChatAccess(account))
  const navRows = opts?.filterNavRows ? allNavRows.filter(opts.filterNavRows) : allNavRows
  const navOrderIsDefault = navOrder.length === DEFAULT_NAV_ORDER.length && navOrder.every((v, i) => v === DEFAULT_NAV_ORDER[i])
  const navVisIsDefault = navRows.every((i) => (navVisibility[i.view] ?? true) === (DEFAULT_NAV_VISIBILITY[i.view] ?? true))
  const navIsDefault = navOrderIsDefault && navVisIsDefault
  const resetNav = (): void => {
    setNavOrder(DEFAULT_NAV_ORDER)
    for (const item of navRows) {
      const def = DEFAULT_NAV_VISIBILITY[item.view] ?? true
      if ((navVisibility[item.view] ?? true) !== def) setNavItemVisible(item.view, def)
    }
  }
  const homeIsDefault = HOME_SECTIONS.every((s) => isHomeSectionVisible(s.id, homeSectionVisibility) === (DEFAULT_HOME_SECTION_VISIBILITY[s.id] ?? true))
  const resetHome = (): void => {
    for (const s of HOME_SECTIONS) {
      const def = DEFAULT_HOME_SECTION_VISIBILITY[s.id] ?? true
      if (isHomeSectionVisible(s.id, homeSectionVisibility) !== def) setHomeSectionVisible(s.id, def)
    }
  }
  // Move a row to sit adjacent to a target row. Reordering happens on the FULL
  // order (including any web-hidden items) so their relative spots are preserved
  // even when a web user rearranges the visible ones.
  const moveNavItem = (fromRow: number, toRow: number): void => {
    if (fromRow === toRow) return
    const full = orderedNavItems(navOrder, true).map((i) => i.view)
    const dragView = navRows[fromRow].view
    const targetView = navRows[toRow].view
    const from = full.indexOf(dragView)
    const next = [...full]
    next.splice(from, 1)
    const targetIdx = next.indexOf(targetView)
    next.splice(toRow > fromRow ? targetIdx + 1 : targetIdx, 0, dragView)
    setNavOrder(next)
  }

  const [notificationSound, setNotificationSoundState] = useState(getNotificationSoundId())
  const chooseNotificationSound = (id: string): void => {
    setNotificationSoundId(id)
    setNotificationSoundState(id)
    playNotificationSound(id)
  }

  const [sleepMinutes, setSleepMinutes] = useState(30)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      setDevices(devs.filter((d) => d.kind === 'audiooutput'))
    }).catch(() => {})
  }, [])

  return {
    customAccent, setCustomAccent, setAccentDebounced,
    editingSkinId, setEditingSkinId, skinImportRef, skinImportError, createSkin, importSkinFile,
    navRows, navIsDefault, resetNav, homeIsDefault, resetHome, moveNavItem,
    notificationSound, chooseNotificationSound,
    sleepMinutes, setSleepMinutes,
    devices,
  }
}
