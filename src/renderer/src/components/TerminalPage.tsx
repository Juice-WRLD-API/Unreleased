import { useEffect } from 'react'
import { Terminal } from 'lucide-react'
import { useChatStore, type RoomRef } from '../store/chatStore'
import { useStore } from '../store/useStore'
import Composer from './chat/Composer'
import { useRoomPeople } from './chat/people'
import TerminalPanel from './chat/TerminalPanel'
import { getTermFullscreen, setTermFullscreen, syncBrowserFullscreen, useTermFullscreen } from '../lib/terminal/fullscreenStore'

// Stands in when no chat room exists yet: everything that doesn't need a room
// (playback, settings, files, the review queues...) still works.
const NO_ROOM: RoomRef = { kind: 'channel', id: 0 }

// The admin terminal as a page of its own (/terminal), reachable from anywhere -
// the side menu, Ctrl+` or the button in a chat's header - and not tied to the
// Chat tab. The chat commands it runs live in the composer, so a hidden one is
// mounted for the room the terminal is attached to (`cd` moves it); if you have
// never opened a room it picks the first one so those commands have somewhere to act.
export default function TerminalPage(): JSX.Element {
  const isAdmin = useStore((s) => !!s.account?.is_administrator)
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
    if (!isAdmin || active) return
    if (firstChannelId !== null) useChatStore.getState().openRoom({ kind: 'channel', id: firstChannelId })
    else if (firstConvId !== null) useChatStore.getState().openRoom({ kind: 'conversation', id: firstConvId })
  }, [isAdmin, active, firstChannelId, firstConvId])

  const leave = (): void => {
    const s = useStore.getState()
    s.setActiveView(s.previousView && s.previousView !== 'terminal' ? s.previousView : 'home')
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-center gap-2 text-center px-8">
        <Terminal size={28} className="text-text-muted" />
        <p className="text-sm font-semibold text-text-primary">The terminal is for administrators</p>
        <button onClick={leave} className="text-xs text-accent hover:underline">Go back</button>
      </div>
    )
  }
  if (!me) {
    return <div className="flex-1 min-w-0 h-full bg-black flex items-center justify-center font-mono text-xs text-[#8a8a8a]">starting…</div>
  }

  return (
    // Same element either way (a class swap, not a portal) so toggling keeps the
    // panel mounted and the scrollback intact.
    <div className={full ? 'fixed inset-0 z-[300] bg-black overflow-hidden' : 'relative flex-1 min-w-0 h-full bg-black overflow-hidden'}>
      <TerminalPanel room={active ?? NO_ROOM} onClose={leave} />
      {active && (
        <div hidden aria-hidden>
          <Composer room={active} people={people} placeholder="" />
        </div>
      )}
    </div>
  )
}
