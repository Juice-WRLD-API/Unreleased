import { useEffect } from 'react'
import { useChatStore, type RoomRef } from '../store/chatStore'
import { useStore } from '../store/useStore'
import { hasChatAccess } from '../lib/chatAccess'
import Composer from './chat/Composer'
import { useRoomPeople } from './chat/people'
import TerminalPanel from './chat/TerminalPanel'
import { getTermFullscreen, setTermFullscreen, syncBrowserFullscreen, useTermFullscreen } from '../lib/terminal/fullscreenStore'

// Stands in when no chat room exists yet: everything that doesn't need a room
// (playback, settings, files, the review queues...) still works.
const NO_ROOM: RoomRef = { kind: 'channel', id: 0 }

// The terminal as a page of its own (/terminal), reachable from anywhere -
// the side menu, Ctrl+` or the button in a chat's header - and not tied to the
// Chat tab. The chat commands it runs live in the composer, so a hidden one is
// mounted for the room the terminal is attached to (`cd` moves it); if you have
// never opened a room it picks the first one so those commands have somewhere to act.
// Anyone can open it; without chat (staff-only) there is no room or composer,
// and the panel offers only what works without one.
export default function TerminalPage(): JSX.Element {
  const hasChat = useStore((s) => hasChatAccess(s.account))
  const me = useChatStore((s) => s.me)
  const active = useChatStore((s) => s.active)
  // Primitive selectors: returning a new object here would never compare equal
  // between renders and loop forever (React error #185).
  const firstChannelId = useChatStore((s) => s.servers.flatMap((x) => x.channels)[0]?.id ?? null)
  const firstConvId = useChatStore((s) => s.conversations[0]?.id ?? null)
  const people = useRoomPeople(active)
  const full = useTermFullscreen()

  // Closing the terminal leaves fullscreen so the rest of the site isn't stuck
  // in it; the flag stays set, so reopening re-enters it (the hotkey that
  // reopens the page is the gesture the browser needs).
  useEffect(() => {
    if (getTermFullscreen()) syncBrowserFullscreen(true)
    return () => syncBrowserFullscreen(false)
  }, [])
  // Esc (or F11) leaving browser fullscreen should drop the in-page one too.
  useEffect(() => {
    const onChange = (): void => { if (!document.fullscreenElement) setTermFullscreen(false) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!hasChat || active) return
    if (firstChannelId !== null) useChatStore.getState().openRoom({ kind: 'channel', id: firstChannelId })
    else if (firstConvId !== null) useChatStore.getState().openRoom({ kind: 'conversation', id: firstConvId })
  }, [hasChat, active, firstChannelId, firstConvId])

  const leave = (): void => {
    const s = useStore.getState()
    s.setActiveView(s.previousView && s.previousView !== 'terminal' ? s.previousView : 'home')
  }

  if (hasChat && !me) {
    return <div className="flex-1 min-w-0 h-full bg-black flex items-center justify-center font-mono text-xs text-[#8a8a8a]">starting…</div>
  }

  return (
    // Same element either way (a class swap, not a portal) so toggling keeps the
    // panel mounted and the scrollback intact.
    <div className={full ? 'fixed inset-0 z-[300] bg-black overflow-hidden' : 'relative flex-1 min-w-0 h-full bg-black overflow-hidden'}>
      <TerminalPanel room={hasChat ? active ?? NO_ROOM : NO_ROOM} onClose={leave} />
      {hasChat && active && (
        <div hidden aria-hidden>
          <Composer room={active} people={people} placeholder="" />
        </div>
      )}
    </div>
  )
}
