import { useEffect } from 'react'
import { Info, Lock, Pin, Search, Terminal, Users } from 'lucide-react'
import { useChatStore, type RoomRef } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { useRoomInfo } from './RoomPane'
import { IconButton } from './ui'
import { BackButton } from '../mobile/NavBar'

export type SidePanel = 'members' | 'pins' | 'info' | 'search' | null

export default function RoomHeader({ room, panel, onPanel, onBack }: {
  room: RoomRef
  panel: SidePanel
  onPanel: (panel: SidePanel) => void
  onBack?: () => void
}): JSX.Element {
  const info = useRoomInfo(room)
  const pinCount = useChatStore((s) => s.rooms[`${room.kind === 'channel' ? 'c' : 'd'}:${room.id}`]?.items.filter((m) => m.pinned && !m.deleted_at).length ?? 0)
  const toggle = (p: SidePanel): void => onPanel(panel === p ? null : p)
  // Round 40px targets on phones, the desktop's compact squares above that.
  const touch = 'max-md:w-10 max-md:h-10 max-md:rounded-full max-md:text-text-primary'

  // Ctrl/Cmd+F opens chat search instead of the browser's find-in-page, which
  // can't see messages that aren't scrolled into the DOM yet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      onPanel('search')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPanel])

  return (
    <header className="h-14 shrink-0 flex items-center gap-1.5 md:gap-2 px-2 md:px-4 border-b border-[var(--separator)] bg-surface/80 backdrop-blur" style={{ ['--chat-ring' as string]: 'var(--surface)' }}>
      {/* Only the phone layout passes onBack (the room is a pushed screen there). */}
      {onBack && <BackButton onClick={onBack} />}
      <span className="text-text-muted shrink-0 flex items-center">{info.icon}</span>
      <div className="flex-1 min-w-0 flex items-baseline gap-3">
        <h1 className="text-headline md:text-[15px] md:font-bold md:tracking-normal text-text-primary truncate shrink-0 max-w-full md:max-w-[60%]">{info.title}</h1>
        {info.subtitle && (
          <>
            <span className="hidden md:block w-px h-4 bg-[var(--border)] self-center" />
            <p className="text-xs text-text-muted truncate min-w-0 hidden md:block">{info.subtitle}</p>
          </>
        )}
      </div>
      {info.encrypted && (
        <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent" title="End-to-end encrypted">
          <Lock size={10} />Encrypted
        </span>
      )}
      <IconButton label="Open terminal" className={touch} onClick={() => useStore.getState().setActiveView('terminal')}><Terminal size={17} /></IconButton>
      <IconButton label="Search messages" className={touch} active={panel === 'search'} onClick={() => toggle('search')}><Search size={17} /></IconButton>
      <div className="relative">
        <IconButton label="Pinned messages" className={touch} active={panel === 'pins'} onClick={() => toggle('pins')}><Pin size={17} /></IconButton>
        {pinCount > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 pointer-events-none" />}
      </div>
      {room.kind === 'channel' ? (
        <IconButton label="Members" className={touch} active={panel === 'members'} onClick={() => toggle('members')}><Users size={18} /></IconButton>
      ) : (
        <IconButton label="Conversation details" className={touch} active={panel === 'info'} onClick={() => toggle('info')}><Info size={18} /></IconButton>
      )}
    </header>
  )
}
