import { useEffect, useState } from 'react'
import { MessagesSquare, Plus } from 'lucide-react'
import { roomKey, useChatStore } from '../../store/chatStore'
import { useOpenModal } from './modalHost'
import { ChannelList, DmList } from './Navigator'
import RoomHeader, { type SidePanel } from './RoomHeader'
import RoomPane from './RoomPane'
import { DmInfoPanel, MembersPanel, PinsPanel, ThreadPanel } from './SidePanels'
import { CountBadge, ServerGlyph } from './ui'

function ServerStrip(): JSX.Element {
  const servers = useChatStore((s) => s.servers)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const selectServer = useChatStore((s) => s.selectServer)
  const unread = useChatStore((s) => s.unread)
  const conversations = useChatStore((s) => s.conversations)
  const openModal = useOpenModal()
  const dmUnread = conversations.reduce((n, c) => n + (unread[`d:${c.id}`] ?? 0), 0)

  const chip = (active: boolean): string =>
    `relative shrink-0 flex flex-col items-center gap-1 w-16 pt-1 transition-opacity ${active ? 'opacity-100' : 'opacity-60'}`

  return (
    <div className="shrink-0 flex gap-1 overflow-x-auto no-scrollbar px-2 pt-3 pb-2 border-b border-[var(--border)]">
      <button onClick={() => selectServer(null)} className={chip(activeServerId === null)}>
        <span className={`w-12 h-12 flex items-center justify-center rounded-2xl ${activeServerId === null ? 'bg-accent text-white' : 'bg-surface-raised text-text-secondary'}`}>
          <MessagesSquare size={22} />
        </span>
        <span className="text-[10px] font-semibold text-text-primary truncate max-w-full">Messages</span>
        {dmUnread > 0 && <span className="absolute top-0 right-1"><CountBadge count={dmUnread} mention /></span>}
      </button>
      {servers.map((s) => {
        const hasUnread = s.channels.some((c) => (unread[`c:${c.id}`] ?? 0) > 0)
        return (
          <button key={s.id} onClick={() => selectServer(s.id)} className={chip(activeServerId === s.id)}>
            <ServerGlyph server={s} size={48} active={activeServerId === s.id} />
            <span className="text-[10px] font-semibold text-text-primary truncate max-w-full">{s.name}</span>
            {hasUnread && <span className="absolute top-1 right-3 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-[var(--surface)]" />}
          </button>
        )
      })}
      <button onClick={() => openModal({ kind: 'create-server' })} className={chip(false)}>
        <span className="w-12 h-12 flex items-center justify-center rounded-2xl border border-dashed border-[var(--border)] text-accent">
          <Plus size={22} />
        </span>
        <span className="text-[10px] font-semibold text-text-muted">New</span>
      </button>
    </div>
  )
}

export default function ChatViewMobile(): JSX.Element {
  const active = useChatStore((s) => s.active)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const threadRootId = useChatStore((s) => s.threadRootId)
  const openThread = useChatStore((s) => s.openThread)
  const openModal = useOpenModal()
  const [roomOpen, setRoomOpen] = useState(!!active)
  const [panel, setPanel] = useState<SidePanel>(null)

  useEffect(() => { if (!active) setRoomOpen(false) }, [active])

  const closeRoom = (): void => {
    setPanel(null)
    openThread(null)
    setRoomOpen(false)
  }

  const serverId = active?.kind === 'channel' ? activeServerId : null
  const overlay = 'fixed inset-x-0 z-40 flex flex-col bg-surface chat-sheet'
  const overlayStyle = { top: 'var(--top-inset, 0px)', bottom: 'var(--bottom-nav-height, 0px)' }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-surface overflow-hidden relative">
      <ServerStrip />
      {activeServerId === null
        ? <DmList onPicked={() => setRoomOpen(true)} showFooter={false} />
        : <ChannelList serverId={activeServerId} onPicked={() => setRoomOpen(true)} showFooter={false} />}

      {active && roomOpen && (
        <div className={overlay} style={overlayStyle}>
          <RoomPane
            key={roomKey(active)}
            room={active}
            enterSends={false}
            header={<RoomHeader room={active} panel={panel} onPanel={setPanel} onBack={closeRoom} />}
          />
        </div>
      )}

      {active && roomOpen && threadRootId !== null && (
        <div className={overlay} style={overlayStyle}>
          <ThreadPanel room={active} rootId={threadRootId} onClose={() => openThread(null)} />
        </div>
      )}
      {active && roomOpen && threadRootId === null && panel === 'pins' && (
        <div className={overlay} style={overlayStyle}><PinsPanel room={active} onClose={() => setPanel(null)} /></div>
      )}
      {active && roomOpen && threadRootId === null && panel === 'members' && serverId !== null && (
        <div className={overlay} style={overlayStyle}>
          <MembersPanel serverId={serverId} onClose={() => setPanel(null)} onAddMembers={() => openModal({ kind: 'add-members', serverId })} />
        </div>
      )}
      {active?.kind === 'conversation' && roomOpen && threadRootId === null && panel === 'info' && (
        <div className={overlay} style={overlayStyle}>
          <DmInfoPanel conversationId={active.id} onClose={() => setPanel(null)} onAddPeople={() => openModal({ kind: 'add-to-dm', conversationId: active.id })} />
        </div>
      )}
    </div>
  )
}
