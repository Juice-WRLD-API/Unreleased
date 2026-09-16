import { ChevronLeft, Info, Lock, Pin, Users } from 'lucide-react'
import { useChatStore, type RoomRef } from '../../store/chatStore'
import { useRoomInfo } from './RoomPane'
import { IconButton } from './ui'

export type SidePanel = 'members' | 'pins' | 'info' | null

export default function RoomHeader({ room, panel, onPanel, onBack }: {
  room: RoomRef
  panel: SidePanel
  onPanel: (panel: SidePanel) => void
  onBack?: () => void
}): JSX.Element {
  const info = useRoomInfo(room)
  const pinCount = useChatStore((s) => s.rooms[`${room.kind === 'channel' ? 'c' : 'd'}:${room.id}`]?.items.filter((m) => m.pinned && !m.deleted_at).length ?? 0)
  const toggle = (p: SidePanel): void => onPanel(panel === p ? null : p)

  return (
    <header className="h-14 shrink-0 flex items-center gap-2 px-2 md:px-4 border-b border-[var(--border)] bg-surface/80 backdrop-blur" style={{ ['--chat-ring' as string]: 'var(--surface)' }}>
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-text-secondary active:bg-surface-overlay">
          <ChevronLeft size={22} />
        </button>
      )}
      <span className="text-text-muted shrink-0 flex items-center">{info.icon}</span>
      <div className="flex-1 min-w-0 flex items-baseline gap-3">
        <h1 className="text-[15px] font-bold text-text-primary truncate shrink-0 max-w-[60%]">{info.title}</h1>
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
      <div className="relative">
        <IconButton label="Pinned messages" active={panel === 'pins'} onClick={() => toggle('pins')}><Pin size={17} /></IconButton>
        {pinCount > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 pointer-events-none" />}
      </div>
      {room.kind === 'channel' ? (
        <IconButton label="Members" active={panel === 'members'} onClick={() => toggle('members')}><Users size={18} /></IconButton>
      ) : (
        <IconButton label="Conversation details" active={panel === 'info'} onClick={() => toggle('info')}><Info size={18} /></IconButton>
      )}
    </header>
  )
}
