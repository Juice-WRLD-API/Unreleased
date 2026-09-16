import { useState } from 'react'
import { MessagesSquare, ShieldCheck, SquarePen } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useOpenModal } from './modalHost'
import { ChannelList, DmList, ServerRail } from './Navigator'
import RoomHeader, { type SidePanel } from './RoomHeader'
import RoomPane from './RoomPane'
import { DmInfoPanel, MembersPanel, PinsPanel, ThreadPanel } from './SidePanels'

function EmptyMain(): JSX.Element {
  const activeServerId = useChatStore((s) => s.activeServerId)
  const openModal = useOpenModal()
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="relative mb-5">
        <span className="absolute inset-0 rounded-3xl bg-accent/20 blur-2xl" />
        <span className="relative w-20 h-20 rounded-3xl bg-surface-raised border border-[var(--border)] flex items-center justify-center text-accent">
          <MessagesSquare size={36} />
        </span>
      </div>
      <h2 className="text-xl font-bold text-text-primary">{activeServerId === null ? 'Your conversations' : 'Pick a channel'}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-text-muted leading-relaxed">
        {activeServerId === null
          ? 'Choose a conversation on the left, or start a new one with any staff member.'
          : 'Choose a channel on the left to jump into the conversation.'}
      </p>
      {activeServerId === null && (
        <>
          <button onClick={() => openModal({ kind: 'new-dm' })} className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-bold hover:brightness-110">
            <SquarePen size={15} />New message
          </button>
          <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-text-muted"><ShieldCheck size={13} className="text-accent" />Direct messages are end-to-end encrypted</p>
        </>
      )}
    </div>
  )
}

export default function ChatViewDesktop(): JSX.Element {
  const active = useChatStore((s) => s.active)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const threadRootId = useChatStore((s) => s.threadRootId)
  const openThread = useChatStore((s) => s.openThread)
  const openModal = useOpenModal()
  const [panel, setPanel] = useState<SidePanel>(null)

  const serverId = active?.kind === 'channel' ? activeServerId : null
  const showThread = !!active && threadRootId !== null

  return (
    <div className="flex-1 min-w-0 h-full flex bg-surface overflow-hidden" style={{ ['--chat-rail' as string]: 'var(--sidebar, var(--surface))' }}>
      <ServerRail />
      <div className="w-[264px] shrink-0 min-h-0 flex flex-col bg-surface-raised/30 border-r border-[var(--border)]">
        {activeServerId === null ? <DmList /> : <ChannelList serverId={activeServerId} />}
      </div>
      <main className="flex-1 min-w-0 min-h-0 flex">
        {active ? (
          <RoomPane
            key={`${active.kind}:${active.id}`}
            room={active}
            header={<RoomHeader room={active} panel={showThread ? null : panel} onPanel={(p) => { openThread(null); setPanel(p) }} />}
          />
        ) : (
          <EmptyMain />
        )}
        {active && showThread && <ThreadPanel room={active} rootId={threadRootId!} onClose={() => openThread(null)} />}
        {active && !showThread && panel === 'pins' && <PinsPanel room={active} onClose={() => setPanel(null)} />}
        {active && !showThread && panel === 'members' && serverId !== null && (
          <MembersPanel serverId={serverId} onClose={() => setPanel(null)} onAddMembers={() => openModal({ kind: 'add-members', serverId })} />
        )}
        {active?.kind === 'conversation' && !showThread && panel === 'info' && (
          <DmInfoPanel conversationId={active.id} onClose={() => setPanel(null)} onAddPeople={() => openModal({ kind: 'add-to-dm', conversationId: active.id })} />
        )}
      </main>
    </div>
  )
}
