import { useEffect, useRef } from 'react'
import { Loader2, MessagesSquare, RefreshCw, ShieldAlert } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useStorePick } from '../store/useStore'
import { hasChatAccess, useChatStore, type RoomRef } from '../store/chatStore'
import ChatViewDesktop from './chat/ChatView.desktop'
import ChatViewMobile from './chat/ChatView.mobile'
import { ModalHost } from './chat/modalHost'
import { UserCardHost } from './chat/UserCard'
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

export default function ChatView(): JSX.Element {
  const isMobile = useIsMobile()
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
    else if (!store.active && !isMobile) {
      const first = store.servers[0]
      if (store.conversations.length === 0 && first) store.selectServer(first.id)
    }
  }, [initialized, isMobile])

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
        <button onClick={() => setActiveView('home')} className="mt-4 px-4 py-2 rounded-xl bg-surface-raised text-sm font-semibold text-text-primary hover:bg-surface-overlay">Back home</button>
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
        <UserCardHost>
          {isMobile ? <ChatViewMobile /> : <ChatViewDesktop />}
        </UserCardHost>
      </ModalHost>
    </ToastHost>
  )
}
