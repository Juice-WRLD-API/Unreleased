import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Settings, LogIn, LogOut, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Download, ArrowLeft, Info, Check, EyeOff } from 'lucide-react'
import logo from '../assets/logo.png'
import { useStore, useStorePick } from '../store/useStore'
import { ViewType } from '../types'
import { showStaffProfile, staffProfileView, getToken } from '../lib/userApi'
import { hasChatAccess } from '../lib/chatAccess'
import { orderedNavItems, isNavItemVisible, orderedNavControls, isNavControlVisible, navTabFor, tabEntryView, type NavControlId } from '../lib/navItems'
import AppMenu from './AppMenu'
import PlaylistContextMenu, { PlaylistContextMenuState } from './PlaylistContextMenu'

const LS_COLLAPSED = 'sidebar:collapsed'
const LS_PLAYLISTS_EXPANDED = 'sidebar:playlistsExpanded'

export default function Sidebar(): JSX.Element {
  const { activeView, setActiveView, openProfile, openSettings, setShowDiagnostics, developerMode, account, logoutAccount, setShowUserAuth, playlists, setPendingPlaylistId, sidebarPosition, navOrder, setNavOrder, navVisibility, setNavItemVisible, navControlOrder, navControlVisibility, appMenuPosition, offlinePlaylists } = useStorePick('activeView', 'setActiveView', 'openProfile', 'openSettings', 'setShowDiagnostics', 'developerMode', 'account', 'logoutAccount', 'setShowUserAuth', 'playlists', 'setPendingPlaylistId', 'sidebarPosition', 'navOrder', 'setNavOrder', 'navVisibility', 'setNavItemVisible', 'navControlOrder', 'navControlVisibility', 'appMenuPosition', 'offlinePlaylists')
  const isElectron = navigator.userAgent.includes('Electron')

  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(LS_COLLAPSED) === 'true'
  )
  // showExpanded trails collapsed: hides immediately on collapse, appears
  // after ~120ms on expand so content doesn't pop in before the sidebar widens.
  const [showExpanded, setShowExpanded] = useState<boolean>(!collapsed)

  useEffect(() => {
    if (collapsed) {
      setShowExpanded(false)
    } else {
      const t = setTimeout(() => setShowExpanded(true), 120)
      return () => clearTimeout(t)
    }
  }, [collapsed])

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(LS_COLLAPSED, String(next))
  }

  const [playlistsExpanded, setPlaylistsExpanded] = useState<boolean>(
    () => localStorage.getItem(LS_PLAYLISTS_EXPANDED) === 'true'
  )
  const togglePlaylistsExpanded = (): void => {
    const next = !playlistsExpanded
    setPlaylistsExpanded(next)
    localStorage.setItem(LS_PLAYLISTS_EXPANDED, String(next))
  }

  const openPlaylist = (id: number): void => {
    setPendingPlaylistId(id)
    setActiveView('playlists')
  }

  const [playlistMenu, setPlaylistMenu] = useState<PlaylistContextMenuState | null>(null)

  // Drag-to-reorder state for the nav tabs themselves (as opposed to the
  // Settings → Appearance list, which reorders the same navOrder from a
  // dedicated menu). Index is into the currently visible `items` array.
  const [navDragIdx, setNavDragIdx] = useState<number | null>(null)
  const [navOverIdx, setNavOverIdx] = useState<number | null>(null)
  // Move a visible row to sit adjacent to a target row. Reordering happens on
  // the FULL saved order (including any hidden items) so their relative spots
  // are preserved — same approach as Settings' moveNavItem.
  const moveNavItem = (fromRow: number, toRow: number): void => {
    if (fromRow === toRow) return
    const full = orderedNavItems(navOrder, true, true).map((i) => i.view)
    const dragView = items[fromRow].view
    const targetView = items[toRow].view
    const from = full.indexOf(dragView)
    const next = [...full]
    next.splice(from, 1)
    const targetIdx = next.indexOf(targetView)
    next.splice(toRow > fromRow ? targetIdx + 1 : targetIdx, 0, dragView)
    setNavOrder(next)
  }

  // Right-click on a nav tab pops a single "Hide" action — a faster path to
  // the same navVisibility toggle Settings → Appearance → Menu items exposes.
  const [navMenu, setNavMenu] = useState<{ view: ViewType; label: string; x: number; y: number } | null>(null)
  const openNavMenu = (view: ViewType, label: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setNavMenu({ view, label, x: e.clientX, y: e.clientY })
  }
  const navContextMenu = navMenu && createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={() => setNavMenu(null)} onContextMenu={(e) => { e.preventDefault(); setNavMenu(null) }} />
      <div
        className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 min-w-[170px]"
        style={{
          left: Math.max(8, Math.min(navMenu.x, window.innerWidth - 178)),
          top: Math.max(8, Math.min(navMenu.y, window.innerHeight - 48)),
        }}
      >
        <button
          onClick={() => { setNavItemVisible(navMenu.view, false); setNavMenu(null) }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <EyeOff size={14} className="text-text-muted" />
          <span className="flex-1 text-left">Hide "{navMenu.label}"</span>
        </button>
      </div>
    </>,
    document.body
  )

  const [tokenCopied, setTokenCopied] = useState(false)
  const copyAuthToken = (e: React.MouseEvent): void => {
    e.preventDefault()
    const t = getToken()
    if (!t) return
    navigator.clipboard.writeText(t)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1500)
  }

  // Order + which tabs appear both come from Settings → Appearance → Menu
  // items. orderedNavItems sanitizes the saved order; isNavItemVisible drops
  // web-only tabs on web and anything the user has toggled off.
  const items = orderedNavItems(navOrder, hasChatAccess(account), showStaffProfile(account)).filter((i) => isNavItemVisible(i, navVisibility, isElectron))
  // Which tab reads as current — not always activeView, since some views are
  // sub-views of a tab (the games inside Games). See navTabFor.
  const activeTab = navTabFor(activeView)

  const navClick = (view: ViewType): void => {
    if (activeView === view && view === 'playlists') {
      window.dispatchEvent(new CustomEvent('playlists:back'))
    } else if (view === 'editor-profile') {
      // The Staff tab - which profile page that is depends on the account's roles.
      openProfile()
    } else {
      // Not always `view` itself — a tab holding several views reopens on the
      // one last used. See tabEntryView.
      setActiveView(tabEntryView(view))
    }
  }

  // Foot-of-menu controls (Profile, Log out, Diagnostics, Settings) —
  // ordered and filtered to what's both available and toggled on in Settings.
  // Log in and the collapse toggle are rendered separately (never hideable).
  const controlCtx = { account: !!account, isElectron, developerMode }
  const controls = orderedNavControls(navControlOrder).filter((c) => isNavControlVisible(c, navControlVisibility, controlCtx))

  const rowCls = 'flex items-center w-full py-2 rounded text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors gap-3 px-3'
  const iconWrap = 'w-6 h-6 flex items-center justify-center shrink-0'
  const labelCls = `truncate transition-opacity duration-200 ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`

  const returnToApiVertical = !isElectron ? (
    <a
      key="return-api"
      href="https://juicewrldapi.com"
      target="_blank"
      rel="noopener noreferrer"
      title={collapsed ? 'Return to API' : undefined}
      className={rowCls}
    >
      <span className={iconWrap}><ArrowLeft size={18} /></span>
      <span aria-hidden={collapsed} className={labelCls}>Return to API</span>
    </a>
  ) : null

  const returnToApiHorizontal = !isElectron ? (
    <a
      key="return-api"
      href="https://juicewrldapi.com"
      target="_blank"
      rel="noopener noreferrer"
      title="Return to API"
      className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded text-sm font-medium whitespace-nowrap text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
    >
      <span className="w-6 h-6 shrink-0 flex items-center justify-center"><ArrowLeft size={18} /></span>
      <span>Return to API</span>
    </a>
  ) : null

  // Full-width control row for the vertical (left/right) side menu.
  const profileView = staffProfileView(account)

  const renderControl = (id: NavControlId): JSX.Element | null => {
    switch (id) {
      case 'profile':
        if (!account || !showStaffProfile(account)) return null
        return (
          <button key="profile" onClick={openProfile} onContextMenu={copyAuthToken} title={collapsed ? (account.display_name || account.discord_username) : undefined} className={rowCls}>
            <span className={`${iconWrap} relative`}>
              {account.discord_avatar
                ? <img src={account.discord_avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                : <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold">{(account.display_name || account.discord_username || '?').charAt(0).toUpperCase()}</div>}
              {tokenCopied && <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center"><Check size={12} className="text-emerald-400" /></span>}
            </span>
            <span aria-hidden={collapsed} className={labelCls}>{tokenCopied ? 'Token copied!' : (account.display_name || account.discord_username)}</span>
          </button>
        )
      case 'logout':
        if (!account) return null
        return (
          <button key="logout" onClick={() => logoutAccount()} title={collapsed ? 'Log out' : undefined} className={rowCls}>
            <span className={iconWrap}><LogOut size={18} /></span>
            <span aria-hidden={collapsed} className={labelCls}>Log out</span>
          </button>
        )
      case 'diagnostics':
        return (
          <button key="diagnostics" onClick={() => setShowDiagnostics(true)} title={collapsed ? 'Diagnostics' : undefined} className={rowCls}>
            <span className={iconWrap}><Info size={18} /></span>
            <span aria-hidden={collapsed} className={labelCls}>Diagnostics</span>
          </button>
        )
      case 'settings':
        return (
          <button key="settings" onClick={() => openSettings()} title={collapsed ? 'Settings' : undefined} className={rowCls}>
            <span className={iconWrap}><Settings size={18} /></span>
            <span aria-hidden={collapsed} className={labelCls}>Settings</span>
          </button>
        )
    }
  }

  // Icon-only control button for the horizontal (top/bottom) bar cluster.
  const barIconBtn = 'flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors shrink-0'
  const renderControlIcon = (id: NavControlId): JSX.Element | null => {
    switch (id) {
      case 'profile':
        if (!account || !showStaffProfile(account)) return null
        return (
          <button key="profile" onClick={openProfile} onContextMenu={copyAuthToken} title={tokenCopied ? 'Token copied!' : (account.display_name || account.discord_username)} className={`${barIconBtn} hover:bg-transparent hover:opacity-80 relative`}>
            {account.discord_avatar
              ? <img src={account.discord_avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
              : <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold">{(account.display_name || account.discord_username || '?').charAt(0).toUpperCase()}</div>}
            {tokenCopied && <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center"><Check size={12} className="text-emerald-400" /></span>}
          </button>
        )
      case 'logout':
        if (!account) return null
        return <button key="logout" onClick={() => logoutAccount()} title="Log out" className={barIconBtn}><LogOut size={16} /></button>
      case 'diagnostics':
        return <button key="diagnostics" onClick={() => setShowDiagnostics(true)} title="Diagnostics" className={barIconBtn}><Info size={18} /></button>
      case 'settings':
        return <button key="settings" onClick={() => openSettings()} title="Settings" className={barIconBtn}><Settings size={18} /></button>
    }
  }

  // ── Horizontal bar (Settings → Appearance → Navigation position: top/bottom).
  // Nav items keep icon+label; the account/admin/settings cluster goes
  // icon-only, and the collapse toggle + inline playlist tree don't apply.
  if (sidebarPosition === 'top' || sidebarPosition === 'bottom') {
    const iconBtn = 'flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors shrink-0'
    return (
      <aside className={`app-sidebar hidden md:flex flex-col w-full bg-sidebar shrink-0 border-[var(--border)] ${sidebarPosition === 'top' ? 'border-b' : 'border-t'}`}>
        {/* Bar touches the frameless window's top edge, so it carries the
            drag strip that main's overlay provides in the other layouts.
            mr-[188px] keeps the strip clear of the min/max/close buttons
            (132px) plus the fixed downloads trigger next to them (right:
            144px + 36px wide — see DownloadManager) — a drag rect under
            them would win the draggable-region ordering and swallow their
            clicks (see WindowControls in App.tsx). */}
        {isElectron && sidebarPosition === 'top' && appMenuPosition !== 'title-bar' && (
          <div className="shrink-0 h-7 mr-[188px] select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        )}
        <div className="flex items-center gap-1 px-3 py-1.5 min-w-0">
          {isElectron && appMenuPosition === 'sidebar' && (
            <div className="shrink-0 mr-0.5"><AppMenu variant="sidebar-icon" /></div>
          )}
          <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {returnToApiHorizontal}
            {items.map(({ icon, label, view }, idx) => (
              <button
                key={view}
                draggable
                onDragStart={(e) => { setNavDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setNavOverIdx(idx) }}
                onDrop={(e) => { e.preventDefault(); if (navDragIdx !== null) moveNavItem(navDragIdx, idx); setNavDragIdx(null); setNavOverIdx(null) }}
                onDragEnd={() => { setNavDragIdx(null); setNavOverIdx(null) }}
                onClick={() => navClick(view)}
                onContextMenu={openNavMenu(view, label)}
                className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors cursor-grab active:cursor-grabbing ${
                  navDragIdx === idx ? 'opacity-40' : ''
                } ${
                  navOverIdx === idx && navDragIdx !== null && navDragIdx !== idx ? 'ring-1 ring-accent' : ''
                } ${
                  activeTab === view
                    ? 'bg-surface-raised text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
                }`}
              >
                <span className="w-6 h-6 shrink-0 flex items-center justify-center">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1 shrink-0">
            {/* Log in stays pinned (never hideable) so signing in is always
                reachable; the rest are user-ordered/hideable controls. */}
            {!account && (
              <button onClick={() => setShowUserAuth(true)} title="Log in" className={iconBtn}>
                <LogIn size={18} />
              </button>
            )}
            {controls.map((c) => renderControlIcon(c.id))}
          </div>
        </div>
        {navContextMenu}
      </aside>
    )
  }

  return (
    <aside
      className={`app-sidebar hidden md:flex flex-col h-full bg-sidebar shrink-0 ${sidebarPosition === 'right' ? 'border-l' : 'border-r'} border-[var(--border)] transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
    >
      {/* On the right, the sidebar's top edge sits under the window buttons
          (132px) and the fixed downloads trigger next to them (right: 144px
          + 36px wide — see DownloadManager) — keep the drag strip out of
          their 188px corner (same ordering pitfall as the top-bar strip
          above), and give the first nav item real clearance below them so
          it doesn't visually run into the buttons when the sidebar is wide
          enough to sit under them (expanded width, or any width once
          collapsed still tucks under the min/max/close cluster). */}
      {isElectron && appMenuPosition !== 'title-bar' && (
        <div
          className={`shrink-0 select-none ${sidebarPosition === 'right' ? 'h-9 mr-[188px]' : 'h-7'}`}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      {/* Logo — collapses to zero height (redundant with the WRLD tab icon) */}
      <div
        className="flex flex-col items-center gap-1 shrink-0 px-5 overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out"
        style={{ maxHeight: collapsed ? '0px' : '200px', opacity: collapsed ? 0 : 1 }}
      >
        <div className="pt-5 pb-4 flex flex-col items-center gap-1">
          <img src={logo} alt="unreleased" className="object-contain h-32 w-auto" />
          <span
            className="text-text-primary text-sm uppercase select-none whitespace-nowrap"
            style={{ fontFamily: "'Josefin Sans', sans-serif", fontWeight: 300, letterSpacing: '0.35em' }}
          >
            unreleased
          </span>
        </div>
      </div>

      {/* App menu (File/Edit/View…) parked in the side menu, above the tabs —
          only when the user chose the 'sidebar' spot over the title-bar pill. */}
      {isElectron && appMenuPosition === 'sidebar' && (
        <div className="px-3 pb-1 shrink-0">
          <AppMenu variant="sidebar" collapsed={collapsed} />
        </div>
      )}

      {/* Nav items */}
      <nav className="space-y-1 flex-1 min-h-0 overflow-y-auto px-3">
        {returnToApiVertical}
        {items.map(({ icon, label, view }, idx) => (
          <div
            key={view}
            draggable
            onDragStart={(e) => { setNavDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setNavOverIdx(idx) }}
            onDrop={(e) => { e.preventDefault(); if (navDragIdx !== null) moveNavItem(navDragIdx, idx); setNavDragIdx(null); setNavOverIdx(null) }}
            onDragEnd={() => { setNavDragIdx(null); setNavOverIdx(null) }}
            onContextMenu={openNavMenu(view, label)}
            className={`cursor-grab active:cursor-grabbing ${navDragIdx === idx ? 'opacity-40' : ''}`}
          >
            <div
              className={`flex items-center w-full rounded text-sm font-medium transition-colors ${
                navOverIdx === idx && navDragIdx !== null && navDragIdx !== idx ? 'ring-1 ring-accent' : ''
              } ${
                activeTab === view
                  ? 'bg-surface-raised text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
              }`}
            >
              <button
                onClick={() => navClick(view)}
                title={collapsed ? label : undefined}
                className="flex items-center flex-1 min-w-0 py-2 pl-2 gap-3"
              >
                <span className="w-6 h-6 shrink-0 flex items-center justify-center">{icon}</span>
                <span
                  aria-hidden={collapsed}
                  className={`text-left truncate transition-opacity duration-200 ${collapsed ? 'w-0 flex-none opacity-0 pointer-events-none' : 'flex-1 opacity-100'}`}
                >
                  {label}
                </span>
              </button>
              {view === 'playlists' && showExpanded && playlists.length > 0 && (
                <button
                  onClick={togglePlaylistsExpanded}
                  title={playlistsExpanded ? 'Hide playlists' : 'Show playlists'}
                  className="p-2 pr-3 text-text-muted hover:text-text-primary transition-colors shrink-0"
                >
                  {playlistsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
            </div>

            {view === 'playlists' && showExpanded && playlistsExpanded && playlists.length > 0 && (
              <div className="mt-0.5 ml-[26px] space-y-0.5 border-l border-[var(--border)] pl-2 max-h-64 overflow-y-auto">
                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => openPlaylist(pl.id)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPlaylistMenu({ playlist: pl, x: e.clientX, y: e.clientY }) }}
                    title={pl.name}
                    className="flex items-center w-full py-1.5 px-2 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors truncate"
                  >
                    <span className="truncate">{pl.name}</span>
                    {offlinePlaylists[`api-${pl.id}`] && (
                      <Download size={10} className="ml-1.5 shrink-0 text-emerald-400" aria-label="Downloaded for offline playback" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Bottom section — Log in stays pinned (never hideable); the rest are
          user-ordered/hideable controls (Settings → Appearance → Menu controls). */}
      <div className="pb-4 space-y-1 px-2">
        {!account && (
          <button
            onClick={() => setShowUserAuth(true)}
            title={collapsed ? 'Log in' : undefined}
            className={rowCls}
          >
            <span className={iconWrap}><LogIn size={18} /></span>
            <span aria-hidden={collapsed} className={labelCls}>Log in</span>
          </button>
        )}
        {controls.map((c) => renderControl(c.id))}

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center w-full py-2 rounded text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors gap-3 px-3"
        >
          {/* Chevron points where the edge will move — mirrored when the
              sidebar sits on the right. */}
          <span className="w-6 h-6 flex items-center justify-center shrink-0">
            {collapsed !== (sidebarPosition === 'right') ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </span>
          <span aria-hidden={collapsed} className={`truncate transition-opacity duration-200 ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>Collapse</span>
        </button>
      </div>

      {playlistMenu && (
        <PlaylistContextMenu state={playlistMenu} onClose={() => setPlaylistMenu(null)} />
      )}
      {navContextMenu}
    </aside>
  )
}
