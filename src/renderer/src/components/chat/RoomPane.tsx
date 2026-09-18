import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AtSign, Hash, KeyRound, Loader2, Lock, MicOff, ShieldCheck, Upload } from 'lucide-react'
import { conversationTitle, displayName, roomKey, useChatStore, useMyPostingRestriction, type RoomRef, type UiMessage } from '../../store/chatStore'
import Composer, { type ComposerHandle } from './Composer'
import MessageList from './MessageList'
import { useRoomPeople } from './people'
import { ChatAvatar } from './ui'

function TypingIndicator({ room }: { room: RoomRef }): JSX.Element {
  const typing = useChatStore((s) => s.typing[roomKey(room)])
  const people = useRoomPeople(room)
  const names = Object.keys(typing ?? {})
    .map((id) => people.find((p) => p.id === Number(id)))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => displayName(p))
  const label = names.length === 0 ? ''
    : names.length === 1 ? `${names[0]} is typing`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
    : 'Several people are typing'
  return (
    <div className={`px-5 flex items-center gap-2 text-[11px] text-text-muted transition-[height,opacity] overflow-hidden ${label ? 'h-5 opacity-100' : 'h-0 opacity-0'}`} aria-live="polite">
      {label && (
        <>
          <span className="flex gap-0.5">
            <span className="chat-dot w-1 h-1 rounded-full bg-text-muted" />
            <span className="chat-dot w-1 h-1 rounded-full bg-text-muted" />
            <span className="chat-dot w-1 h-1 rounded-full bg-text-muted" />
          </span>
          <span className="truncate"><span className="font-semibold text-text-secondary">{label.replace(/ (is|are) typing$/, '')}</span>{label.match(/ (is|are) typing$/)?.[0]}…</span>
        </>
      )}
    </div>
  )
}

export function useRoomInfo(room: RoomRef | null): {
  title: string
  subtitle: string
  icon: ReactNode
  canModerate: boolean
  encrypted: boolean
} {
  const servers = useChatStore((s) => s.servers)
  const conversations = useChatStore((s) => s.conversations)
  const meId = useChatStore((s) => s.meId)
  const me = useChatStore((s) => s.me)
  const online = useChatStore((s) => s.online)
  return useMemo(() => {
    const platformAdmin = me?.role === 'administrator'
    if (!room) return { title: '', subtitle: '', icon: null, canModerate: false, encrypted: false }
    if (room.kind === 'channel') {
      const server = servers.find((s) => s.channels.some((c) => c.id === room.id))
      const channel = server?.channels.find((c) => c.id === room.id)
      return {
        title: channel?.name ?? 'channel',
        subtitle: channel?.topic ?? '',
        icon: channel?.is_private ? <Lock size={18} /> : <Hash size={19} />,
        canModerate: platformAdmin || server?.my_role === 'owner' || server?.my_role === 'admin',
        encrypted: false,
      }
    }
    const conv = conversations.find((c) => c.id === room.id)
    const others = conv?.participants.filter((p) => p.user.id !== meId) ?? []
    const subtitle = conv?.is_group
      ? `${conv.participants.length} members`
      : others[0] ? (online[others[0].user.id] ? 'Online' : 'Offline') : ''
    return {
      title: conv ? conversationTitle(conv, meId) : 'Direct message',
      subtitle,
      icon: others.length === 1 && !conv?.is_group
        ? <ChatAvatar user={others[0].user} size={26} presence />
        : <AtSign size={18} />,
      canModerate: platformAdmin,
      encrypted: true,
    }
  }, [room, servers, conversations, meId, me, online])
}

function ChannelIntro({ room, title }: { room: RoomRef; title: string }): JSX.Element {
  const servers = useChatStore((s) => s.servers)
  const conversations = useChatStore((s) => s.conversations)
  const meId = useChatStore((s) => s.meId)
  if (room.kind === 'channel') {
    const channel = servers.flatMap((s) => s.channels).find((c) => c.id === room.id)
    return (
      <div className="px-5 pt-10 pb-4">
        <div className="w-14 h-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center mb-3">
          {channel?.is_private ? <Lock size={26} /> : <Hash size={28} />}
        </div>
        <h2 className="text-2xl font-bold text-text-primary">Welcome to #{title}</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {channel?.topic || 'This is the very beginning of the channel.'}
          {channel?.is_private && ' Only invited members can see it.'}
        </p>
      </div>
    )
  }
  const conv = conversations.find((c) => c.id === room.id)
  const others = conv?.participants.filter((p) => p.user.id !== meId) ?? []
  return (
    <div className="px-5 pt-10 pb-4">
      <div className="flex -space-x-3 mb-3">
        {others.slice(0, 4).map((p) => <ChatAvatar key={p.id} user={p.user} size={56} className="ring-4 ring-[var(--surface)] rounded-full" />)}
      </div>
      <h2 className="text-2xl font-bold text-text-primary">{conv ? conversationTitle(conv, meId) : title}</h2>
      <p className="mt-1 text-sm text-text-secondary">
        {conv?.is_group ? 'This is the start of your group conversation.' : 'This is the start of your direct messages.'}
      </p>
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs text-accent">
        <ShieldCheck size={14} />
        Messages and files here are end-to-end encrypted. Not even the server can read them.
      </p>
    </div>
  )
}

export default function RoomPane({ room, header, enterSends = true }: {
  room: RoomRef
  header: ReactNode
  enterSends?: boolean
}): JSX.Element {
  const info = useRoomInfo(room)
  const people = useRoomPeople(room)
  const keyState = useChatStore((s) => (room.kind === 'conversation' ? s.keyState[room.id] : undefined))
  const resolveKey = useChatStore((s) => s.resolveKey)
  const meId = useChatStore((s) => s.meId)
  // Server-side mute/timeout on our own membership - the API would 403 the
  // send anyway, so lock the composer instead of letting it fail.
  const restriction = useMyPostingRestriction(room)
  const composer = useRef<ComposerHandle>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [replyTo, setReplyTo] = useState<UiMessage | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const editLast = useCallback(() => {
    const items = useChatStore.getState().rooms[roomKey(room)]?.items ?? []
    const mine = [...items].reverse().find((m) => m.author.id === meId && m.id > 0 && !m.deleted_at)
    if (mine) setEditingId(mine.id)
  }, [room, meId])

  // Composer's own onKeyDown only catches ArrowUp while its textarea is
  // focused. If focus is elsewhere (or nowhere - e.g. right after opening a
  // room), the browser's default behavior scrolls the page instead. Mirror
  // that everywhere else so ArrowUp reliably edits the last message unless
  // some other editable field is legitimately focused.
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' || e.metaKey || e.ctrlKey || e.altKey || editingId !== null) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      editLast()
      composer.current?.focus()
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [editLast, editingId])

  const onEditingChange = useCallback((id: number | null) => {
    setEditingId(id)
    if (id === null) composer.current?.focus()
  }, [])

  const onReply = useCallback((message: UiMessage) => {
    setReplyTo(message)
    composer.current?.focus()
  }, [])

  const disabledReason = restriction ?? (room.kind === 'conversation' && keyState === 'waiting'
    ? 'Waiting for a participant to share the encryption key…'
    : null)

  return (
    <div
      className="relative flex-1 min-w-0 min-h-0 flex flex-col"
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => { if (dragging) e.preventDefault() }}
      onDrop={(e) => {
        if (!dragging) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        composer.current?.addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {header}

      {restriction && (
        <div className="mx-4 md:mx-5 mt-3 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
          <MicOff size={16} className="shrink-0 text-red-400" />
          <span className="flex-1">{restriction}. You can still read this channel.</span>
        </div>
      )}
      {room.kind === 'conversation' && (keyState === 'waiting' || keyState === 'error') && (
        <div className="mx-4 md:mx-5 mt-3 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          <KeyRound size={16} className="shrink-0 text-amber-400" />
          <span className="flex-1">
            {keyState === 'waiting'
              ? 'This device doesn’t have the key for this conversation yet. It will unlock as soon as another participant is online.'
              : 'Couldn’t set up encryption for this conversation.'}
          </span>
          <button onClick={() => void resolveKey(room.id)} className="shrink-0 font-semibold text-amber-300 hover:underline">Retry</button>
        </div>
      )}
      {room.kind === 'conversation' && keyState === 'resolving' && (
        <div className="absolute top-16 right-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-surface border border-[var(--border)] px-2.5 py-1 text-[11px] text-text-muted shadow">
          <Loader2 size={11} className="animate-spin" />Securing
        </div>
      )}

      <MessageList
        room={room}
        people={people}
        canModerate={info.canModerate}
        editingId={editingId}
        onStartEdit={onEditingChange}
        onReply={onReply}
        intro={<ChannelIntro room={room} title={info.title} />}
      />

      <TypingIndicator room={room} />
      <Composer
        ref={composer}
        room={room}
        people={people}
        placeholder={replyTo ? `Reply to ${displayName(replyTo.author)}` : room.kind === 'channel' ? `Message #${info.title}` : `Message ${info.title}`}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        disabledReason={disabledReason}
        encrypted={info.encrypted}
        onEditLast={editLast}
        enterSends={enterSends}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-accent/70 bg-surface/85 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
          <span className="w-14 h-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center"><Upload size={26} /></span>
          <p className="text-base font-semibold text-text-primary">Drop to upload</p>
          <p className="text-xs text-text-muted">
            {room.kind === 'conversation' ? 'Files are encrypted before they leave this device' : `Sends to #${info.title}`}
          </p>
        </div>
      )}
    </div>
  )
}
