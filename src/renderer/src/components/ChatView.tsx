import { useEffect, useRef, useState } from 'react'
import { Loader2, MessagesSquare, RefreshCw, ShieldAlert, ShieldCheck, SquarePen } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { hasChatAccess, useChatStore, type RoomRef } from '../store/chatStore'
import { ChannelList, DmList, ServerRail } from './chat/Navigator'
import RoomHeader, { type SidePanel } from './chat/RoomHeader'
import RoomPane from './chat/RoomPane'
import { DmInfoPanel, MembersPanel, PinsPanel, ThreadPanel } from './chat/SidePanels'
import { ModalHost } from './chat/modalHost'
import { useOpenModal } from './chat/modalHost'
import { ToastHost } from './chat/ui'
import './chat/chat.css'

function roomFromPath(pathname: string): RoomRef | null {
  const m = /^\/chat\/(c|dm)\/(\d+)\/?$/.exec(pathname)
  if (!m) return null
  return { kind: m[1] === 'c' ? 'channel' : 'conversation', id: Number(m[2]) }
}

function pathForRoom(room: RoomRef | null): string {
  if (!room) return '/chat'
  return room.kind === 'channel' ? `/chat/c/${room.id}` : `/chat/dm/${room.id}`
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex-1 h-full flex flex-col items-center justify-center text-center px-8 bg-surface">{children}</div>
}

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

// Below this, the fixed-width rail + channel list + a pushed-in side panel
// would leave the message pane with too little room, so the panel floats
// over the messages instead of squeezing them.
const COMPACT_PANEL_QUERY = '(max-width: 1100px)'

function useCompactPanel(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_PANEL_QUERY).matches
  )
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_PANEL_QUERY)
    const onChange = (): void => setCompact(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return compact
}

function ChatViewMain(): JSX.Element {
  const active = useChatStore((s) => s.active)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const threadRootId = useChatStore((s) => s.threadRootId)
  const openThread = useChatStore((s) => s.openThread)
  const openModal = useOpenModal()
  const [panel, setPanel] = useState<SidePanel>(null)
  const compact = useCompactPanel()

  const serverId = active?.kind === 'channel' ? activeServerId : null
  const showThread = !!active && threadRootId !== null
  const sideOpen = showThread || panel !== null
  const sideClassName = compact
    ? 'flex h-full absolute inset-y-0 right-0 z-30 shadow-2xl'
    : 'flex h-full'

  return (
    <div className="relative flex-1 min-w-0 h-full flex bg-surface overflow-hidden" style={{ ['--chat-rail' as string]: 'var(--sidebar, var(--surface))' }}>
      <ServerRail />
      <div className="w-[264px] shrink-0 min-h-0 flex flex-col bg-surface-raised/30 border-r border-[var(--border)]">
        {activeServerId === null ? <DmList /> : <ChannelList serverId={activeServerId} />}
      </div>
      <main className="relative flex-1 min-w-0 min-h-0 flex">
        {active ? (
          <RoomPane
            key={`${active.kind}:${active.id}`}
            room={active}
            header={<RoomHeader room={active} panel={showThread ? null : panel} onPanel={(p) => { openThread(null); setPanel(p) }} />}
          />
        ) : (
          <EmptyMain />
        )}
        {sideOpen && (
          <div className={sideClassName}>
            {active && showThread && <ThreadPanel room={active} rootId={threadRootId!} onClose={() => openThread(null)} />}
            {active && !showThread && panel === 'pins' && <PinsPanel room={active} onClose={() => setPanel(null)} />}
            {active && !showThread && panel === 'members' && serverId !== null && (
              <MembersPanel serverId={serverId} onClose={() => setPanel(null)} onAddMembers={() => openModal({ kind: 'add-members', serverId })} />
            )}
            {active?.kind === 'conversation' && !showThread && panel === 'info' && (
              <DmInfoPanel conversationId={active.id} onClose={() => setPanel(null)} onAddPeople={() => openModal({ kind: 'add-to-dm', conversationId: active.id })} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default function ChatView(): JSX.Element {
  const { account, setActiveView } = useStorePick('account', 'setActiveView')
  const initialized = useChatStore((s) => s.initialized)
  const loadError = useChatStore((s) => s.loadError)
  const active = useChatStore((s) => s.active)
  const init = useChatStore((s) => s.init)
  const allowed = hasChatAccess(account)
  const deepLinked = useRef(false)

  useEffect(() => {
    if (account && allowed) void init(account)
  }, [account, allowed, init])

  useEffect(() => {
    if (!initialized || deepLinked.current) return
    deepLinked.current = true
    const target = roomFromPath(window.location.pathname)
    const store = useChatStore.getState()
    if (target) store.openRoom(target)
    else if (!store.active) {
      const first = store.servers[0]
      if (store.conversations.length === 0 && first) store.selectServer(first.id)
    }
  }, [initialized])

  useEffect(() => {
    if (!deepLinked.current || !window.location.pathname.startsWith('/chat')) return
    const path = pathForRoom(active)
    if (window.location.pathname !== path) window.history.replaceState({ view: 'chat' }, '', path)
  }, [active])

  if (!account) {
    return (
      <Centered>
        <MessagesSquare size={36} className="text-text-muted mb-3" />
        <p className="text-sm font-semibold text-text-primary">Sign in to use staff chat</p>
      </Centered>
    )
  }

  if (!allowed) {
    return (
      <Centered>
        <span className="w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center text-text-muted mb-3"><ShieldAlert size={26} /></span>
        <p className="text-base font-bold text-text-primary">Staff only</p>
        <p className="mt-1 text-sm text-text-muted max-w-xs">Chat is available to managers and administrators.</p>
        <button onClick={() => setActiveView('api-tracker')} className="mt-4 px-4 py-2 rounded-xl bg-surface-raised text-sm font-semibold text-text-primary hover:bg-surface-overlay">Back home</button>
      </Centered>
    )
  }

  if (!initialized) {
    return (
      <Centered>
        <Loader2 size={26} className="animate-spin text-accent mb-3" />
        <p className="text-sm text-text-muted">Connecting to chat…</p>
      </Centered>
    )
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-base font-bold text-text-primary">Chat couldn&apos;t load</p>
        <p className="mt-1 text-sm text-text-muted max-w-sm">{loadError}</p>
        <button
          onClick={() => { useChatStore.getState().teardown(); void init(account) }}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-bold hover:brightness-110"
        >
          <RefreshCw size={14} />Try again
        </button>
      </Centered>
    )
  }

  return (
    <ToastHost>
      <ModalHost>
        <ChatViewMain />
      </ModalHost>
    </ToastHost>
  )
}
