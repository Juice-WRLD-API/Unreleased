import { useCallback, useEffect } from 'react'
import { Maximize2, MessagesSquare, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useRadioChatStore } from '../store/radioChatStore'
import { useEscapeToClose } from '../hooks/useEscapeToClose'
import { useBackToClose } from '../hooks/useBackToClose'
import { PopLayer } from './PopLayer'
import RadioChatPanel from './RadioChatPanel'

// The 999 FM chat as a pop-up over any page, opened from the side menu's
// 999 FM chat control (Sidebar). Same panel as WRLD's FM tab, on a dark
// glass card since that panel is styled for WRLD's dark backdrop. It stays
// open while you browse (closing on outside clicks would also close it from
// its own emoji picker and menus, which portal out): X, Escape or the
// button again close it. Anchored top-right like Notifications and Transfers,
// and opening either of those closes it.

const IN_ELECTRON = navigator.userAgent.includes('Electron')
const TOP = `calc(env(safe-area-inset-top, 0px) + ${IN_ELECTRON ? '2.25rem' : '0.5rem'})`

export default function FmChatPopup(): JSX.Element {
  const close = useCallback(() => useRadioChatStore.getState().setPopupOpen(false), [])
  useEscapeToClose(close)
  useBackToClose(close)
  const status = useRadioChatStore((s) => s.status)
  const enabled = useRadioChatStore((s) => s.enabled)
  const setActiveView = useStore((s) => s.setActiveView)

  // The other top-right panels take the corner.
  useEffect(() => useStore.subscribe((s, prev) => {
    if ((s.showNotifications && !prev.showNotifications) || (s.showDownloadManager && !prev.showDownloadManager)) close()
  }), [close])

  const live = status === 'open' && enabled !== false

  return (
    <PopLayer
      role="dialog"
      aria-label="999 FM chat"
      style={{
        top: TOP,
        height: `min(580px, calc(100svh - ${TOP} - var(--player-dock, 0px) - 0.75rem))`,
        background: 'rgba(14, 14, 18, 0.86)',
      }}
      className="animate-menu-pop fixed right-3 z-[9990] w-[380px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-2xl backdrop-blur-2xl glass-specular border border-white/10 shadow-2xl shadow-black/50 overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
        <MessagesSquare size={14} className="text-white/70 shrink-0" />
        <span className="text-white/90 text-sm font-semibold">999 FM chat</span>
        <span className={`flex items-center gap-1.5 text-[11px] ${live ? 'text-green-400/80' : 'text-white/35'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-green-400' : 'bg-white/30'}`} />
          {enabled === false ? 'Off' : live ? 'Live' : 'Connecting'}
        </span>
        <button
          onClick={() => { close(); setActiveView('wrld') }}
          title="Open in WRLD"
          aria-label="Open in WRLD"
          className="ml-auto p-1.5 rounded-lg text-white/45 hover:text-white/85 hover:bg-white/10 transition-colors"
        >
          <Maximize2 size={13} />
        </button>
        <button onClick={close} aria-label="Close" title="Close" className="p-1.5 rounded-lg text-white/45 hover:text-white/85 hover:bg-white/10 transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-3">
        <RadioChatPanel />
      </div>
    </PopLayer>
  )
}
