import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Loader2, RefreshCw } from 'lucide-react'
import { roomKey, useChatStore, type RoomRef, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import type { ChatUserBrief } from '../../lib/chatApi'
import MessageItem from './MessageItem'
import { ChatAvatar, Skeleton, dayKey, dayLabel } from './ui'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const STICK_PX = 120

const EMPTY_ITEMS: UiMessage[] = []

function DayDivider({ iso }: { iso: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-1 select-none" role="separator">
      <span className="flex-1 h-px bg-[var(--border)]" />
      <span className="text-[11px] font-semibold text-text-muted">{dayLabel(iso)}</span>
      <span className="flex-1 h-px bg-[var(--border)]" />
    </div>
  )
}

function NewDivider(): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-5 pt-3 pb-1 select-none" role="separator">
      <span className="flex-1 h-px bg-red-500/60" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">New</span>
    </div>
  )
}

function SeenBy({ users }: { users: ChatUserBrief[] }): JSX.Element {
  // Every message row (avatar + name + body) is left-aligned, not bubble-
  // style per-sender, so this indents to line up under the message text
  // instead of floating on the opposite side of the room.
  return (
    <div className="flex gap-3 px-4 md:px-5 pt-1" title={`Seen by ${users.map((u) => u.display_name || u.username).join(', ')}`}>
      <span className="w-9 shrink-0" />
      <div className="flex items-center gap-1">
        {users.slice(0, 5).map((u) => <ChatAvatar key={u.id} user={u} size={14} />)}
        {users.length > 5 && <span className="text-[10px] text-text-muted">+{users.length - 5}</span>}
      </div>
    </div>
  )
}

export default function MessageList({ room, people, canModerate, editingId, onStartEdit, onReply, intro }: {
  room: RoomRef
  people: ChatUserBrief[]
  canModerate: boolean
  editingId: number | null
  onStartEdit: (id: number | null) => void
  onReply?: (message: UiMessage) => void
  intro: ReactNode
}): JSX.Element {
  const key = roomKey(room)
  const state = useChatStore((s) => s.rooms[key])
  const loadOlder = useChatStore((s) => s.loadOlder)
  const openThread = useChatStore((s) => s.openThread)
  const threadRootId = useChatStore((s) => s.threadRootId)
  const markRead = useChatStore((s) => s.markRead)
  const receipts = useChatStore((s) => s.receipts[key])
  const meId = useChatStore((s) => s.meId)
  const lastReadNow = useChatStore((s) => s.lastRead[key])

  const items = state?.items ?? EMPTY_ITEMS
  const mutedUserIds = useStore((s) => s.mutedUserIds)
  // Muting a person hides their messages in shared channels/servers - a DM is
  // something you'd mute (silences notifications) or just not open instead,
  // so a muted person's own DM to you still shows normally here.
  // Day dividers/grouping/read-receipt logic below all run against this
  // filtered list too, so a muted user's messages don't leave gaps or affect
  // grouping. Own messages never filter out even if self-muting were
  // somehow possible.
  const visibleItems = useMemo(() => (
    room.kind === 'conversation' || mutedUserIds.length === 0
      ? items
      : items.filter((m) => m.author.id === meId || !mutedUserIds.includes(m.author.id))
  ), [items, mutedUserIds, meId, room.kind])
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [flashId, setFlashId] = useState<number | null>(null)

  // The divider marks where you left off when the room opened; it stays put
  // while you read instead of chasing the live read pointer.
  const dividerAfter = useRef<number | null>(null)
  const openedKey = useRef<string | null>(null)
  if (openedKey.current !== key) {
    openedKey.current = key
    dividerAfter.current = lastReadNow ?? null
  }

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottom.current = true
    setShowJump(false)
    setUnseen(0)
  }, [])

  const requestOlder = useCallback(() => {
    const el = scroller.current
    if (!el || !state?.hasMore || state.loading || !state.loaded) return
    anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    void loadOlder(room)
  }, [state?.hasMore, state?.loading, state?.loaded, loadOlder, room])

  useEffect(() => {
    const el = sentinel.current
    const root = scroller.current
    if (!el || !root) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) requestOlder()
    }, { root, rootMargin: '400px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [requestOlder])

  const firstId = items[0]?.id
  const lastId = items[items.length - 1]?.id
  const prevLast = useRef<number | undefined>(undefined)
  const initialScrollDone = useRef<string | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
      anchor.current = null
    }
  }, [firstId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !state?.loaded) return
    if (initialScrollDone.current !== key) {
      initialScrollDone.current = key
      prevLast.current = lastId
      scrollToBottom()
      return
    }
    if (lastId !== prevLast.current) {
      const newest = items[items.length - 1]
      prevLast.current = lastId
      if (!newest) return
      if (atBottom.current || newest.author.id === meId) {
        scrollToBottom(true)
      } else {
        setUnseen((n) => n + 1)
        setShowJump(true)
      }
    }
  }, [key, state?.loaded, lastId, items, meId, scrollToBottom])

  // Images and embeds settle after first paint; keep the view pinned while
  // they grow rather than letting new height push the latest message off-screen.
  useEffect(() => {
    const el = content.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const bottom = distance < STICK_PX
    if (bottom !== atBottom.current) {
      atBottom.current = bottom
      setShowJump(!bottom)
      if (bottom) {
        setUnseen(0)
        markRead(room)
      }
    }
  }

  useEffect(() => {
    const onFocus = (): void => { if (atBottom.current) markRead(room) }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [markRead, room])

  const seenByMessage = useMemo(() => {
    const out = new Map<number, ChatUserBrief[]>()
    if (!receipts || room.kind !== 'conversation') return out
    const ids = items.filter((m) => m.id > 0).map((m) => m.id)
    for (const [uid, readId] of Object.entries(receipts)) {
      const userId = Number(uid)
      if (userId === meId) continue
      const user = people.find((p) => p.id === userId)
      if (!user) continue
      let target: number | undefined
      for (const id of ids) if (id <= readId) target = id
      if (target === undefined) continue
      out.set(target, [...(out.get(target) ?? []), user])
    }
    return out
  }, [receipts, items, people, meId, room.kind])

  const jumpToMessage = useCallback((id: number) => {
    const el = scroller.current?.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(id)
    window.setTimeout(() => setFlashId(null), 1700)
  }, [])

  useEffect(() => {
    const handler = (e: Event): void => jumpToMessage((e as CustomEvent<number>).detail)
    window.addEventListener('chat:jump', handler)
    return () => window.removeEventListener('chat:jump', handler)
  }, [jumpToMessage])

  if (!state || (!state.loaded && state.loading)) {
    return <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-end"><Skeleton rows={7} /></div>
  }

  if (state.error && !state.loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-text-secondary">{state.error}</p>
        <button onClick={() => void loadOlder(room)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised text-sm text-text-primary hover:bg-surface-overlay">
          <RefreshCw size={14} />Try again
        </button>
      </div>
    )
  }

  let divided = false
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scroller} onScroll={onScroll} className="chat-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none]">
        <div ref={content} className="min-h-full flex flex-col justify-end pb-4">
          <div ref={sentinel} />
          {state.hasMore ? (
            <div className="flex justify-center py-4 text-text-muted">
              {state.loading ? <Loader2 size={18} className="animate-spin" /> : <span className="h-5" />}
            </div>
          ) : (
            intro
          )}
          {visibleItems.map((m, i) => {
            const prev = visibleItems[i - 1]
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
            const showNew = !divided && dividerAfter.current != null && m.id > dividerAfter.current && m.author.id !== meId && !!prev
            if (showNew) divided = true
            const grouped = !!prev && !newDay && !showNew
              && prev.author.id === m.author.id
              && !prev.deleted_at
              && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS
            const seen = seenByMessage.get(m.id)
            return (
              <Fragment key={m.localId ?? m.id}>
                {newDay && <DayDivider iso={m.created_at} />}
                {showNew && <div data-new-divider><NewDivider /></div>}
                <div className={m.localId && m.sendState ? 'chat-in' : undefined}>
                  <MessageItem
                    message={m}
                    grouped={grouped}
                    people={people}
                    canModerate={canModerate}
                    editing={editingId === m.id}
                    onStartEdit={onStartEdit}
                    onOpenThread={openThread}
                    onReply={onReply}
                    activeThread={threadRootId === m.id}
                    highlight={flashId === m.id}
                  />
                </div>
                {seen && <SeenBy users={seen} />}
              </Fragment>
            )
          })}
        </div>
      </div>

      {showJump && (
        <button
          onClick={() => scrollToBottom(true)}
          className="chat-pop absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full bg-surface border border-[var(--border)] shadow-xl text-xs font-semibold text-text-primary hover:border-accent/60 transition-colors"
        >
          <ArrowDown size={14} className="text-accent" />
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Jump to latest'}
        </button>
      )}
    </div>
  )
}
