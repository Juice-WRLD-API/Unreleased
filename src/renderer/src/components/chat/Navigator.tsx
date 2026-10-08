import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, BellRing, ChevronDown, Compass, FolderPlus, Lock, MessagesSquare, Pencil, Pin, PinOff, Plus, Settings, ShieldCheck, SquarePen, Trash2, UserPlus, WifiOff } from 'lucide-react'
import * as api from '../../lib/chatApi'
import type { ChatChannel, ChatServer, Conversation } from '../../lib/chatApi'
import { splitForwardRef } from '../../lib/chatForwardRef'
import { splitReplyRef } from '../../lib/chatReplyRef'
import { conversationTitle, displayName, roomKey, useChatStore, useNowPlayingByIds } from '../../store/chatStore'
import { shortcodesToGlyphs } from './emoji'
import { useStorePick } from '../../store/useStore'
import type { NowPlayingState } from '../../lib/userApi'
import { useOpenModal } from './modalHost'
import { ChannelIcon, ChatAvatar, CountBadge, errorText, ServerGlyph, shortStamp, useChatToast, useDismiss } from './ui'
import { UserCardBody } from './UserCard'
import { MenuItem } from './SidePanels'
import { ConfirmDialog } from './MessageItem'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

interface RoomMenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}

// Cursor-positioned menu for pin/mute/delete actions, used from a right-click
// on a server rail icon or a DM row. Mirrors PlaylistContextMenu's portal +
// fixed-position + clamp-on-mount approach at a much smaller scale.
function RoomMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: RoomMenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEscapeToClose(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 w-[190px] overflow-hidden"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose() }}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-surface-overlay ${item.danger ? 'text-red-400' : 'text-text-primary'}`}
          >
            <span className={item.danger ? 'text-red-400' : 'text-text-muted'}>{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}

function RailButton({ label, active, unread, mentions, pinned, onClick, onContextMenu, children }: {
  label: string
  active: boolean
  unread?: boolean
  mentions?: number
  pinned?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="group relative flex justify-center w-full">
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-text-primary transition-[height,width] duration-200 ${
          active ? 'h-10' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5'
        }`}
      />
      <button onClick={onClick} onContextMenu={onContextMenu} title={label} aria-label={label} className="relative">
        {children}
        {pinned && (
          <span className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-surface-raised ring-[3px] ring-[var(--chat-rail)] flex items-center justify-center text-text-secondary">
            <Pin size={8} />
          </span>
        )}
        {!!mentions && (
          <span className="absolute -bottom-1 -right-1 ring-[3px] ring-[var(--chat-rail)] rounded-full">
            <CountBadge count={mentions} mention />
          </span>
        )}
      </button>
    </div>
  )
}

function deleteConversation(id: number, toast: (msg: string) => void): void {
  api.deleteConversation(id)
    .then(() => {
      useChatStore.setState((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        active: s.active?.kind === 'conversation' && s.active.id === id ? null : s.active,
      }))
    })
    .catch((err) => toast(errorText(err, 'Could not delete chat')))
}

const RECENT_DM_LIMIT = 3

function RecentDmButton({ conv, active, onClick, onContextMenu }: {
  conv: Conversation
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const meId = useChatStore((s) => s.meId)
  const count = useChatStore((s) => s.unread[`d:${conv.id}`] ?? 0)
  const mention = useChatStore((s) => s.mentions[`d:${conv.id}`] ?? 0)
  const others = conv.participants.filter((p) => p.user.id !== meId)
  const title = conversationTitle(conv, meId)
  return (
    <RailButton label={title} active={active} unread={count > 0} mentions={mention} onClick={onClick} onContextMenu={onContextMenu}>
      {others[0] ? (
        <ChatAvatar user={others[0].user} size={44} presence className={`transition-[border-radius] duration-200 ${active ? 'rounded-[14px]' : 'rounded-[22px] group-hover:rounded-[14px]'}`} />
      ) : (
        <span className={`w-11 h-11 flex items-center justify-center bg-surface-raised text-text-secondary transition-[border-radius,background-color,color] duration-200 ${active ? 'rounded-[14px]' : 'rounded-[22px] group-hover:rounded-[14px]'}`}>
          <MessagesSquare size={18} />
        </span>
      )}
    </RailButton>
  )
}

// One draggable server icon. Memoised, and fed only primitives plus handlers
// that stay referentially stable for the life of the rail, so sweeping the
// cursor across the rail mid-drag re-renders the two icons whose highlight
// actually changed instead of every icon (and every recent-DM avatar) on the
// rail. The transitions are listed explicitly rather than `transition-all`:
// the drag only changes opacity and the drop ring, and `all` also animates
// the inherited registered colour custom properties declared in index.css.
const ServerRailRow = memo(function ServerRailRow({
  server, active, hasUnread, mentionCount, pinned, isDragging, isDropTarget,
  onSelect, onMenu, onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  server: ChatServer
  active: boolean
  hasUnread: boolean
  mentionCount: number
  pinned: boolean
  isDragging: boolean
  isDropTarget: boolean
  onSelect: (id: number) => void
  onMenu: (id: number, e: React.MouseEvent) => void
  onDragStart: (id: number, e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (id: number, e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}): JSX.Element {
  return (
    <div
      className={`w-full flex justify-center rounded-2xl transition-[opacity,box-shadow] duration-150 ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-accent' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(server.id, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(server.id, e)}
      onDrop={onDrop}
    >
      <RailButton
        label={server.name}
        active={active}
        unread={hasUnread}
        mentions={mentionCount}
        pinned={pinned}
        onClick={() => onSelect(server.id)}
        onContextMenu={(e) => onMenu(server.id, e)}
      >
        <ServerGlyph server={server} active={active} />
      </RailButton>
    </div>
  )
})

export function ServerRail(): JSX.Element {
  const servers = useChatStore((s) => s.servers)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const active = useChatStore((s) => s.active)
  const selectServer = useChatStore((s) => s.selectServer)
  const openRoom = useChatStore((s) => s.openRoom)
  const unread = useChatStore((s) => s.unread)
  const mentions = useChatStore((s) => s.mentions)
  const conversations = useChatStore((s) => s.conversations)
  const lastMessage = useChatStore((s) => s.lastMessage)
  const pinnedServers = useChatStore((s) => s.pinnedServers)
  const pinnedConversations = useChatStore((s) => s.pinnedConversations)
  const togglePinServer = useChatStore((s) => s.togglePinServer)
  const togglePinConversation = useChatStore((s) => s.togglePinConversation)
  const mutedServers = useChatStore((s) => s.mutedServers)
  const mutedConversations = useChatStore((s) => s.mutedConversations)
  const toggleMuteServer = useChatStore((s) => s.toggleMuteServer)
  const toggleMuteConversation = useChatStore((s) => s.toggleMuteConversation)
  const serverOrder = useChatStore((s) => s.serverOrder)
  const setServerOrder = useChatStore((s) => s.setServerOrder)
  const openModal = useOpenModal()
  const toast = useChatToast()
  const [ctxMenu, setCtxMenu] = useState<{ kind: 'server' | 'conversation'; id: number; x: number; y: number } | null>(null)
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<number | null>(null)
  const [dragServerId, setDragServerId] = useState<number | null>(null)
  const [dropServerTarget, setDropServerTarget] = useState<number | null>(null)

  const dmUnread = conversations.reduce((n, c) => n + (unread[`d:${c.id}`] ?? 0), 0)
  const orderedServers = useMemo(() => {
    const orderIndex = new Map(serverOrder.map((id, i) => [id, i]))
    return [...servers].sort((a, b) => {
      const pinDiff = Number(pinnedServers.includes(b.id)) - Number(pinnedServers.includes(a.id))
      if (pinDiff !== 0) return pinDiff
      const ia = orderIndex.get(a.id)
      const ib = orderIndex.get(b.id)
      if (ia != null && ib != null) return ia - ib
      if (ia != null) return -1
      if (ib != null) return 1
      return 0
    })
  }, [servers, pinnedServers, serverOrder])

  // Mirrors of the values dropServer needs, so the drag handlers below can
  // stay referentially stable (and keep ServerRailRow's memo intact) instead
  // of being rebuilt every time a store slice or the hovered target changes.
  const dragStateRef = useRef({ id: null as number | null, target: null as number | null })
  const dropDepsRef = useRef({ orderedServers, pinnedServers, serverOrder })
  dropDepsRef.current = { orderedServers, pinnedServers, serverOrder }

  // Drag a server icon onto another to reorder it. Reordering only happens
  // within the same pinned/unpinned partition (pinned icons always sort
  // first); dropping inserts the dragged server just before the hovered one,
  // or at the end of its partition when dropped on the trailing gap.
  const dropServer = useCallback((): void => {
    const { id, target: targetId } = dragStateRef.current
    const { orderedServers, pinnedServers, serverOrder } = dropDepsRef.current
    dragStateRef.current = { id: null, target: null }
    setDragServerId(null)
    setDropServerTarget(null)
    if (id == null || id === targetId) return
    const draggedPinned = pinnedServers.includes(id)
    const partition = orderedServers.filter((s) => pinnedServers.includes(s.id) === draggedPinned)
    const dragged = partition.find((s) => s.id === id)
    if (!dragged) return
    const withoutDragged = partition.filter((s) => s.id !== id)
    const hoverIdx = targetId != null ? withoutDragged.findIndex((s) => s.id === targetId) : -1
    const index = hoverIdx === -1 ? withoutDragged.length : hoverIdx
    const nextPartition = [...withoutDragged.slice(0, index), dragged, ...withoutDragged.slice(index)]
    if (nextPartition.every((s, i) => s.id === partition[i]?.id)) return
    const otherIds = serverOrder.filter((oid) => !partition.some((s) => s.id === oid))
    setServerOrder([...otherIds, ...nextPartition.map((s) => s.id)])
  }, [setServerOrder])

  const startServerDrag = useCallback((id: number, e: React.DragEvent): void => {
    e.dataTransfer.effectAllowed = 'move'
    dragStateRef.current = { id, target: null }
    setDragServerId(id)
  }, [])
  const endServerDrag = useCallback((): void => {
    dragStateRef.current = { id: null, target: null }
    setDragServerId(null)
    setDropServerTarget(null)
  }, [])
  // Chrome fires dragover continuously while the pointer sits still, so only
  // touch state when the hovered target actually changes.
  const setDropTargetTo = useCallback((target: number | null): void => {
    if (dragStateRef.current.target === target) return
    dragStateRef.current.target = target
    setDropServerTarget(target)
  }, [])
  const overServer = useCallback((id: number, e: React.DragEvent): void => {
    const dragged = dragStateRef.current.id
    if (dragged == null || dragged === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetTo(id)
  }, [setDropTargetTo])
  const onServerDrop = useCallback((e: React.DragEvent): void => {
    if (dragStateRef.current.id == null) return
    e.preventDefault()
    dropServer()
  }, [dropServer])
  const selectServerById = useCallback((id: number) => selectServer(id), [selectServer])
  const openServerMenu = useCallback((id: number, e: React.MouseEvent): void => {
    e.preventDefault()
    setCtxMenu({ kind: 'server', id, x: e.clientX, y: e.clientY })
  }, [])
  // Like Discord's DM rail: quick access to your most recently active
  // conversations right alongside the servers, without needing to switch
  // into the DM space first.
  const recentDms = useMemo(
    () => [...conversations]
      .sort((a, b) => {
        const la = lastMessage[`d:${a.id}`]?.created_at ?? a.updated_at
        const lb = lastMessage[`d:${b.id}`]?.created_at ?? b.updated_at
        return lb.localeCompare(la)
      })
      .slice(0, RECENT_DM_LIMIT),
    [conversations, lastMessage],
  )

  return (
    <nav className="w-[72px] shrink-0 flex flex-col items-center gap-2 py-3 bg-[var(--chat-rail)] border-r border-[var(--border)] overflow-y-auto no-scrollbar" style={{ ['--chat-ring' as string]: 'var(--chat-rail)' }}>
      <RailButton label="Direct messages" active={activeServerId === null} mentions={dmUnread} onClick={() => selectServer(null)}>
        <span className={`w-11 h-11 flex items-center justify-center transition-[border-radius,background-color,color] duration-200 ${
          activeServerId === null ? 'rounded-[14px] bg-accent text-white' : 'rounded-[22px] bg-surface-raised text-text-secondary group-hover:rounded-[14px] group-hover:bg-accent group-hover:text-white'
        }`}>
          <MessagesSquare size={20} />
        </span>
      </RailButton>
      {recentDms.map((conv) => (
        <RecentDmButton
          key={conv.id}
          conv={conv}
          active={active?.kind === 'conversation' && active.id === conv.id}
          onClick={() => openRoom({ kind: 'conversation', id: conv.id })}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ kind: 'conversation', id: conv.id, x: e.clientX, y: e.clientY }) }}
        />
      ))}
      <span className="w-8 h-px bg-[var(--border)] my-0.5" />
      {orderedServers.map((server) => {
        const keys = server.channels.map((c) => `c:${c.id}`)
        const hasUnread = keys.some((k) => (unread[k] ?? 0) > 0)
        const mentionCount = keys.reduce((n, k) => n + (mentions[k] ?? 0), 0)
        return (
          <ServerRailRow
            key={server.id}
            server={server}
            active={activeServerId === server.id}
            hasUnread={hasUnread}
            mentionCount={mentionCount}
            pinned={pinnedServers.includes(server.id)}
            isDragging={dragServerId === server.id}
            isDropTarget={dragServerId != null && dragServerId !== server.id && dropServerTarget === server.id}
            onSelect={selectServerById}
            onMenu={openServerMenu}
            onDragStart={startServerDrag}
            onDragEnd={endServerDrag}
            onDragOver={overServer}
            onDrop={onServerDrop}
          />
        )
      })}
      {dragServerId != null && (
        <div
          className="w-8 h-3 -my-1.5"
          onDragOver={(e) => { e.preventDefault(); setDropTargetTo(null) }}
          onDrop={(e) => { e.preventDefault(); dropServer() }}
        />
      )}
      <RailButton label="Create a server" active={false} onClick={() => openModal({ kind: 'create-server' })}>
        <span className="w-11 h-11 rounded-[22px] group-hover:rounded-[14px] bg-surface-raised text-accent group-hover:bg-accent group-hover:text-white flex items-center justify-center transition-[border-radius,background-color,color] duration-200">
          <Plus size={22} />
        </span>
      </RailButton>
      <RailButton label="Discover servers" active={false} onClick={() => openModal({ kind: 'discover-servers' })}>
        <span className="w-11 h-11 rounded-[22px] group-hover:rounded-[14px] bg-surface-raised text-text-secondary group-hover:bg-accent group-hover:text-white flex items-center justify-center transition-[border-radius,background-color,color] duration-200">
          <Compass size={20} />
        </span>
      </RailButton>
      {ctxMenu && (() => {
        const isServer = ctxMenu.kind === 'server'
        const pinned = isServer ? pinnedServers.includes(ctxMenu.id) : pinnedConversations.includes(ctxMenu.id)
        const muted = isServer ? mutedServers.includes(ctxMenu.id) : mutedConversations.includes(ctxMenu.id)
        const label = isServer ? 'server' : 'chat'
        const items: RoomMenuItem[] = [
          {
            label: pinned ? `Unpin ${label}` : `Pin ${label}`,
            icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => (isServer ? togglePinServer(ctxMenu.id) : togglePinConversation(ctxMenu.id)),
          },
          {
            label: muted ? `Unmute ${label}` : `Mute ${label}`,
            icon: muted ? <BellRing size={14} /> : <BellOff size={14} />,
            onClick: () => (isServer ? toggleMuteServer(ctxMenu.id) : toggleMuteConversation(ctxMenu.id)),
          },
        ]
        if (!isServer) {
          items.push({
            label: 'Delete chat',
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => setConfirmDeleteConvId(ctxMenu.id),
          })
        }
        return <RoomMenu x={ctxMenu.x} y={ctxMenu.y} items={items} onClose={() => setCtxMenu(null)} />
      })()}
      {confirmDeleteConvId !== null && (
        <ConfirmDialog
          title="Delete this chat?"
          body="The conversation and its messages will be removed for everyone. This can't be undone."
          confirmLabel="Delete chat"
          onCancel={() => setConfirmDeleteConvId(null)}
          onConfirm={() => {
            const id = confirmDeleteConvId
            setConfirmDeleteConvId(null)
            deleteConversation(id, toast)
          }}
        />
      )}
    </nav>
  )
}

function StatusBar(): JSX.Element | null {
  const status = useChatStore((s) => s.status)
  if (status === 'open' || status === 'idle' || status === 'connecting') return null
  return (
    <div className={`mx-2 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ${status === 'unauthorized' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>
      <WifiOff size={13} />
      {status === 'unauthorized' ? 'Live updates unavailable for this account' : 'Reconnecting…'}
    </div>
  )
}

// Own-profile popout, in the same spirit as Discord's account panel: click your
// avatar/name in the footer and a small card floats above it with your avatar,
// name and role, plus a way into the full profile editor in Settings.
function MyProfileCard({ onEditProfile, onClose }: { onEditProfile: () => void; onClose: () => void }): JSX.Element | null {
  const me = useChatStore((s) => s.me)
  const { account } = useStorePick('account')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, onClose, ref)
  if (!me) return null
  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div
        ref={ref}
        className="chat-pop absolute left-2 bottom-[60px] w-[280px] rounded-2xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden"
      >
        <div className="h-14 bg-gradient-to-br from-accent/40 to-accent/10" />
        <UserCardBody user={me} bio={account?.bio}>
          <button
            onClick={() => { onEditProfile(); onClose() }}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-surface-raised hover:bg-surface-overlay px-3 py-2 text-sm font-semibold text-text-primary transition-colors"
          >
            <Pencil size={13} />Edit Profile
          </button>
        </UserCardBody>
      </div>
    </div>,
    document.body,
  )
}

function MeFooter(): JSX.Element | null {
  const me = useChatStore((s) => s.me)
  const { setActiveView, setSettingsTab } = useStorePick('setActiveView', 'setSettingsTab')
  const [open, setOpen] = useState(false)
  if (!me) return null
  return (
    <div className="relative shrink-0 border-t border-[var(--border)] bg-[var(--chat-rail)]/40">
      <button
        onClick={() => setOpen(true)}
        className="w-full px-2 py-2 flex items-center gap-2.5 text-left hover:bg-surface-overlay/50 transition-colors"
      >
        <ChatAvatar user={me} size={32} presence />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{displayName(me)}</p>
          <p className="text-[11px] text-text-muted truncate">{me.role === 'administrator' ? 'Administrator' : 'Manager'}</p>
        </div>
      </button>
      {open && <MyProfileCard onEditProfile={() => { setSettingsTab('account'); setActiveView('settings') }} onClose={() => setOpen(false)} />}
    </div>
  )
}

const EMPTY_CATEGORIES: string[] = []

export function ChannelList({ serverId, onPicked, showFooter = true }: { serverId: number; onPicked?: () => void; showFooter?: boolean }): JSX.Element | null {
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const active = useChatStore((s) => s.active)
  const unread = useChatStore((s) => s.unread)
  const mentions = useChatStore((s) => s.mentions)
  const openRoom = useChatStore((s) => s.openRoom)
  const me = useChatStore((s) => s.me)
  const openModal = useOpenModal()
  const localCategories = useChatStore((s) => s.localCategories[serverId] ?? EMPTY_CATEGORIES)
  const removeLocalCategory = useChatStore((s) => s.removeLocalCategory)
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ category: string; index: number } | null>(null)
  const [chanMenu, setChanMenu] = useState<{ channel: ChatChannel; x: number; y: number } | null>(null)
  const [catMenu, setCatMenu] = useState<{ category: string; x: number; y: number } | null>(null)
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<ChatChannel | null>(null)
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<{ category: string; count: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const toast = useChatToast()
  useDismiss(menu, () => setMenu(false), menuRef)

  const groups = useMemo(() => {
    const map = new Map<string, ChatChannel[]>()
    for (const c of [...(server?.channels ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      const k = c.category || ''
      map.set(k, [...(map.get(k) ?? []), c])
    }
    for (const cat of localCategories) {
      if (!map.has(cat)) map.set(cat, [])
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [server, localCategories])

  // Drag a channel row onto another row (or the empty space below a group)
  // to reorder it within a category, or into a different category entirely.
  // Renumbers the whole destination list (0..n-1) rather than computing a
  // fractional position, mirroring RenameCategoryModal's bulk-PATCH-then-
  // merge approach so a failed request can be rolled back wholesale.
  const dropChannel = async (targetCategory: string, targetIndex: number): Promise<void> => {
    const id = dragId
    setDragId(null)
    setDropTarget(null)
    if (id == null || !server) return
    const dragged = server.channels.find((c) => c.id === id)
    if (!dragged) return
    const currentList = groups.find(([cat]) => cat === targetCategory)?.[1] ?? []
    const withoutDragged = currentList.filter((c) => c.id !== id)
    const index = Math.max(0, Math.min(targetIndex, withoutDragged.length))
    const nextList = [...withoutDragged.slice(0, index), dragged, ...withoutDragged.slice(index)]
    if (dragged.category === targetCategory && nextList.every((c, i) => c.id === currentList[i]?.id)) return

    const positions = new Map(nextList.map((c, i) => [c.id, i]))
    const prevServers = useChatStore.getState().servers
    useChatStore.setState((s) => ({
      servers: s.servers.map((x) => x.id !== serverId ? x : {
        ...x,
        channels: x.channels.map((c) => {
          const position = positions.get(c.id)
          if (position === undefined) return c
          return { ...c, position, category: c.id === id ? targetCategory : c.category }
        }),
      }),
    }))
    try {
      const results = await Promise.all(nextList.map((c) =>
        api.updateChannel(c.id, c.id === id ? { position: positions.get(c.id), category: targetCategory } : { position: positions.get(c.id) }),
      ))
      useChatStore.setState((s) => ({
        servers: s.servers.map((x) => x.id !== serverId ? x : {
          ...x,
          channels: x.channels.map((c) => results.find((r) => r.id === c.id) ?? c),
        }),
      }))
      if (targetCategory) removeLocalCategory(serverId, targetCategory)
    } catch (err) {
      useChatStore.setState({ servers: prevServers })
      toast(errorText(err, 'Could not reorder channels'))
    }
  }

  if (!server) return null
  const canManage = me?.role === 'administrator' || server.my_role === 'owner' || server.my_role === 'admin'

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ ['--chat-ring' as string]: 'var(--surface)' }}>
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenu((v) => !v)}
          className="w-full h-14 flex items-center gap-2 px-4 border-b border-[var(--border)] text-left hover:bg-surface-raised/50 transition-colors"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-bold text-text-primary truncate">{server.name}</span>
            <span className="block text-[11px] text-text-muted truncate">{server.member_count} {server.member_count === 1 ? 'member' : 'members'}</span>
          </span>
          <ChevronDown size={16} className={`text-text-muted transition-transform ${menu ? 'rotate-180' : ''}`} />
        </button>
        {menu && (
          <div className="chat-pop absolute left-2 right-2 top-full mt-1 z-30 rounded-xl border border-[var(--border)] bg-surface shadow-2xl py-1">
            {canManage && <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'add-members', serverId }) }}><span className="inline-flex items-center gap-2"><UserPlus size={14} />Add members</span></MenuItem>}
            {canManage && <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'channel', serverId }) }}><span className="inline-flex items-center gap-2"><Plus size={14} />Create channel</span></MenuItem>}
            {canManage && <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'create-category', serverId }) }}><span className="inline-flex items-center gap-2"><FolderPlus size={14} />Create category</span></MenuItem>}
            {canManage && <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'server-settings', serverId }) }}><span className="inline-flex items-center gap-2"><Settings size={14} />Server settings</span></MenuItem>}
            {!canManage && <p className="px-3 py-2 text-xs text-text-muted">Only owners and admins can manage this server.</p>}
          </div>
        )}
      </div>

      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-3">
        {server.description && <p className="px-2 text-xs text-text-muted leading-relaxed">{server.description}</p>}
        {groups.map(([category, channels]) => (
          <div
            key={category || '_'}
            onDragOver={(e) => { if (dragId == null) return; e.preventDefault(); setDropTarget({ category, index: channels.length }) }}
            onDrop={(e) => { if (dragId == null) return; e.preventDefault(); void dropChannel(category, channels.length) }}
          >
            {category && (
              <div
                className="group flex items-center pr-1"
                onContextMenu={(e) => {
                  if (!canManage) return
                  e.preventDefault()
                  e.stopPropagation()
                  setCatMenu({ category, x: e.clientX, y: e.clientY })
                }}
              >
                <button onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))} className="flex-1 flex items-center gap-1 px-1 py-1 text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-secondary text-left">
                  <ChevronDown size={12} className={`transition-transform ${collapsed[category] ? '-rotate-90' : ''}`} />
                  <span className="truncate">{category}</span>
                </button>
                {canManage && (
                  <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                    <button onClick={() => openModal({ kind: 'rename-category', serverId, category })} title="Rename category" className="p-1 text-text-muted hover:text-text-primary">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => openModal({ kind: 'channel', serverId, defaultCategory: category })} title="Create channel" className="p-1 text-text-muted hover:text-text-primary">
                      <Plus size={14} />
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="space-y-px">
              {channels.map((c, idx) => {
                const key = roomKey({ kind: 'channel', id: c.id })
                const isActive = active?.kind === 'channel' && active.id === c.id
                const count = unread[key] ?? 0
                const mention = mentions[key] ?? 0
                const showDropBefore = dragId != null && dragId !== c.id && dropTarget?.category === category && dropTarget.index === idx
                if (collapsed[category] && !isActive && count === 0) return null
                return (
                  <div key={c.id}>
                    {showDropBefore && <div className="h-0.5 mx-2 my-0.5 rounded-full bg-accent" />}
                    <div
                      className={`group relative ${dragId === c.id ? 'opacity-40' : ''}`}
                      draggable={canManage}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(c.id) }}
                      onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                      onDragOver={(e) => {
                        if (dragId == null) return
                        e.preventDefault()
                        e.stopPropagation()
                        const rect = e.currentTarget.getBoundingClientRect()
                        const before = e.clientY < rect.top + rect.height / 2
                        setDropTarget({ category, index: before ? idx : idx + 1 })
                      }}
                      onDrop={(e) => {
                        if (dragId == null) return
                        e.preventDefault()
                        e.stopPropagation()
                        void dropChannel(category, dropTarget?.category === category ? dropTarget.index : idx)
                      }}
                      onContextMenu={(e) => {
                        if (!canManage) return
                        e.preventDefault()
                        e.stopPropagation()
                        setChanMenu({ channel: c, x: e.clientX, y: e.clientY })
                      }}
                    >
                      <button
                        onClick={() => { openRoom({ kind: 'channel', id: c.id }); onPicked?.() }}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                          isActive ? 'bg-surface-highest text-text-primary' : count > 0 ? 'text-text-primary hover:bg-surface-raised/70' : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised/70'
                        }`}
                      >
                        <ChannelIcon isPrivate={c.is_private} className="shrink-0 opacity-80" />
                        <span className={`flex-1 min-w-0 truncate text-[15px] md:text-sm ${count > 0 ? 'font-semibold' : 'font-medium'}`}>{c.name}</span>
                        {mention > 0 ? <CountBadge count={mention} mention /> : count > 0 && !isActive ? <span className="w-2 h-2 rounded-full bg-text-primary" /> : null}
                      </button>
                      {canManage && (
                        <button
                          onClick={() => openModal({ kind: 'channel', serverId, channel: c })}
                          title="Edit channel"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md hidden md:group-hover:flex items-center justify-center text-text-muted hover:text-text-primary bg-surface-highest"
                        >
                          <Settings size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {dragId != null && dropTarget?.category === category && dropTarget.index === channels.length && channels.length > 0 && (
                <div className="h-0.5 mx-2 my-0.5 rounded-full bg-accent" />
              )}
            </div>
          </div>
        ))}
        {server.channels.length === 0 && groups.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-text-secondary">No channels you can see yet.</p>
            {canManage && <button onClick={() => openModal({ kind: 'channel', serverId })} className="mt-2 text-xs font-semibold text-accent hover:underline">Create the first one</button>}
          </div>
        )}
      </div>
      <StatusBar />
      {showFooter && <MeFooter />}
      {chanMenu && (
        <RoomMenu
          x={chanMenu.x}
          y={chanMenu.y}
          onClose={() => setChanMenu(null)}
          items={[
            { label: 'Edit channel', icon: <Settings size={14} />, onClick: () => openModal({ kind: 'channel', serverId, channel: chanMenu.channel }) },
            { label: 'Delete channel', icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirmDeleteChannel(chanMenu.channel) },
          ]}
        />
      )}
      {catMenu && (
        <RoomMenu
          x={catMenu.x}
          y={catMenu.y}
          onClose={() => setCatMenu(null)}
          items={[
            { label: 'Create channel', icon: <Plus size={14} />, onClick: () => openModal({ kind: 'channel', serverId, defaultCategory: catMenu.category }) },
            { label: 'Rename category', icon: <Pencil size={14} />, onClick: () => openModal({ kind: 'rename-category', serverId, category: catMenu.category }) },
            { label: 'Delete category', icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirmDeleteCategory({ category: catMenu.category, count: groups.find(([cat]) => cat === catMenu.category)?.[1].length ?? 0 }) },
          ]}
        />
      )}
      {confirmDeleteChannel && (
        <ConfirmDialog
          title={`Delete #${confirmDeleteChannel.name}?`}
          body="Every message in this channel will be removed. This can't be undone."
          confirmLabel="Delete channel"
          onCancel={() => setConfirmDeleteChannel(null)}
          onConfirm={() => {
            const channel = confirmDeleteChannel
            setConfirmDeleteChannel(null)
            api.deleteChannel(channel.id)
              .then(() => {
                useChatStore.setState((s) => ({
                  servers: s.servers.map((x) => x.id !== serverId ? x : { ...x, channels: x.channels.filter((c) => c.id !== channel.id) }),
                  active: s.active?.kind === 'channel' && s.active.id === channel.id ? null : s.active,
                }))
              })
              .catch((err) => toast(errorText(err, 'Could not delete channel')))
          }}
        />
      )}
      {confirmDeleteCategory && (
        <ConfirmDialog
          title={`Delete "${confirmDeleteCategory.category}"?`}
          body={confirmDeleteCategory.count > 0 ? `${confirmDeleteCategory.count} channel${confirmDeleteCategory.count === 1 ? '' : 's'} will be moved out of this category.` : 'This category has no channels.'}
          confirmLabel="Delete category"
          onCancel={() => setConfirmDeleteCategory(null)}
          onConfirm={() => {
            const { category, count } = confirmDeleteCategory
            setConfirmDeleteCategory(null)
            if (count === 0) {
              removeLocalCategory(serverId, category)
              return
            }
            const channels = server.channels.filter((c) => c.category === category)
            Promise.all(channels.map((c) => api.updateChannel(c.id, { category: '' })))
              .then((updated) => {
                useChatStore.setState((s) => ({
                  servers: s.servers.map((x) => x.id !== serverId ? x : {
                    ...x,
                    channels: x.channels.map((c) => updated.find((u) => u.id === c.id) ?? c),
                  }),
                }))
              })
              .catch((err) => toast(errorText(err, 'Could not delete category')))
          }}
        />
      )}
    </div>
  )
}

function DmRow({ conv, pinned, muted, onPicked, onContextMenu, draggable, isDragging, isDropTarget, onDragStart, onDragEnd, onDragOver, onDrop, nowPlaying }: {
  conv: Conversation
  pinned: boolean
  muted: boolean
  onPicked?: () => void
  onContextMenu: (e: React.MouseEvent) => void
  draggable?: boolean
  isDragging?: boolean
  isDropTarget?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  // Only meaningful for 1:1 DMs - see DmList's useNowPlayingByIds call.
  nowPlaying?: Record<number, NowPlayingState | null>
}): JSX.Element {
  const meId = useChatStore((s) => s.meId)
  const active = useChatStore((s) => s.active)
  const openRoom = useChatStore((s) => s.openRoom)
  const key = `d:${conv.id}`
  const count = useChatStore((s) => s.unread[key] ?? 0)
  const last = useChatStore((s) => s.lastMessage[key])
  const preview = useChatStore((s) => {
    if (!last) return null
    if (last.deleted_at) return 'Message deleted'
    const p = s.plain[last.id]
    if (p && 'text' in p && p.text) return shortcodesToGlyphs(splitForwardRef(splitReplyRef(p.text).body).body || p.text)
    if (last.attachments.length) return `Sent ${last.attachments.length === 1 ? 'an attachment' : `${last.attachments.length} attachments`}`
    return p && 'error' in p ? 'Encrypted message' : '…'
  })
  const typing = useChatStore((s) => Object.keys(s.typing[key] ?? {}).length > 0)
  const others = conv.participants.filter((p) => p.user.id !== meId)
  const isActive = active?.kind === 'conversation' && active.id === conv.id
  const author = last && last.author.id === meId ? 'You: ' : last && conv.is_group ? `${displayName(last.author)}: ` : ''

  return (
    <button
      onClick={() => { openRoom({ kind: 'conversation', id: conv.id }); onPicked?.() }}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${isActive ? 'bg-surface-highest' : 'hover:bg-surface-raised/70'} ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-accent' : ''}`}
    >
      {conv.is_group || others.length !== 1 ? (
        <span className="relative w-10 h-10 shrink-0">
          {others.slice(0, 2).map((p, i) => (
            // Position the wrapper, not ChatAvatar itself - ChatAvatar's own
            // base classes always include `relative`, which in Tailwind's
            // generated stylesheet beats an `absolute` passed via className
            // (position utilities are emitted static/fixed/absolute/relative/
            // sticky, so the later `relative` rule wins no matter the order
            // in the class string) and the avatars overflow their box.
            <span key={p.id} className={`absolute ${i === 0 ? 'top-0 left-0' : 'bottom-0 right-0'}`}>
              <ChatAvatar user={p.user} size={28} className={i === 1 ? 'ring-2 ring-[var(--surface)]' : ''} />
            </span>
          ))}
        </span>
      ) : (
        <ChatAvatar user={others[0].user} size={40} presence listening={!!nowPlaying?.[others[0].user.id]} />
      )}
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          {pinned && <Pin size={11} className="shrink-0 text-text-muted" />}
          {muted && <BellOff size={11} className="shrink-0 text-text-muted" />}
          <span className={`flex-1 min-w-0 truncate text-[15px] md:text-sm ${count > 0 ? 'font-bold text-text-primary' : 'font-medium text-text-primary'}`}>{conversationTitle(conv, meId)}</span>
          {last && <span className="text-[10px] text-text-muted shrink-0">{shortStamp(last.created_at)}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 truncate text-xs ${typing ? 'text-accent' : count > 0 ? 'text-text-secondary' : 'text-text-muted'}`}>
            {typing ? 'typing…' : preview ? `${author}${preview}` : <span className="inline-flex items-center gap-1"><Lock size={10} />Encrypted conversation</span>}
          </span>
          <CountBadge count={count} />
        </span>
      </span>
    </button>
  )
}

export function DmList({ onPicked, showFooter = true }: { onPicked?: () => void; showFooter?: boolean }): JSX.Element {
  const conversations = useChatStore((s) => s.conversations)
  const lastMessage = useChatStore((s) => s.lastMessage)
  const meId = useChatStore((s) => s.meId)
  const pinnedConversations = useChatStore((s) => s.pinnedConversations)
  const togglePinConversation = useChatStore((s) => s.togglePinConversation)
  const mutedConversations = useChatStore((s) => s.mutedConversations)
  const toggleMuteConversation = useChatStore((s) => s.toggleMuteConversation)
  const conversationOrder = useChatStore((s) => s.conversationOrder)
  const setConversationOrder = useChatStore((s) => s.setConversationOrder)
  const openModal = useOpenModal()
  const toast = useChatToast()
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ convId: number; x: number; y: number } | null>(null)
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<number | null>(null)
  const [dragConvId, setDragConvId] = useState<number | null>(null)
  const [dropConvTarget, setDropConvTarget] = useState<number | null>(null)

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const orderIndex = new Map(conversationOrder.map((id, i) => [id, i]))
    return conversations
      .filter((c) => !q || conversationTitle(c, meId).toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        const pinDiff = Number(pinnedConversations.includes(b.id)) - Number(pinnedConversations.includes(a.id))
        if (pinDiff !== 0) return pinDiff
        const ia = orderIndex.get(a.id)
        const ib = orderIndex.get(b.id)
        if (ia != null && ib != null) return ia - ib
        if (ia != null) return -1
        if (ib != null) return 1
        const la = lastMessage[`d:${a.id}`]?.created_at ?? a.updated_at
        const lb = lastMessage[`d:${b.id}`]?.created_at ?? b.updated_at
        return lb.localeCompare(la)
      })
  }, [conversations, lastMessage, query, meId, pinnedConversations, conversationOrder])
  const pinnedCount = sorted.filter((c) => pinnedConversations.includes(c.id)).length

  // Only 1:1 conversations get a listening badge - a group's stacked-avatar
  // pair has no single spot for it, and would need one id per member anyway.
  const oneToOneOtherIds = useMemo(() => sorted.reduce<number[]>((acc, c) => {
    if (c.is_group) return acc
    const others = c.participants.filter((p) => p.user.id !== meId)
    if (others.length === 1) acc.push(others[0].user.id)
    return acc
  }, []), [sorted, meId])
  const nowPlaying = useNowPlayingByIds(oneToOneOtherIds)

  // Mirrors ServerRail's dropServer: reorder within the same pinned/unpinned
  // partition only, inserting the dragged chat just before the hovered one
  // (or at the end of its partition when target is null).
  const dropConversation = (): void => {
    const id = dragConvId
    const targetId = dropConvTarget
    setDragConvId(null)
    setDropConvTarget(null)
    if (id == null || id === targetId) return
    const draggedPinned = pinnedConversations.includes(id)
    const partition = sorted.filter((c) => pinnedConversations.includes(c.id) === draggedPinned)
    const dragged = partition.find((c) => c.id === id)
    if (!dragged) return
    const withoutDragged = partition.filter((c) => c.id !== id)
    const hoverIdx = targetId != null ? withoutDragged.findIndex((c) => c.id === targetId) : -1
    const index = hoverIdx === -1 ? withoutDragged.length : hoverIdx
    const nextPartition = [...withoutDragged.slice(0, index), dragged, ...withoutDragged.slice(index)]
    if (nextPartition.every((c, i) => c.id === partition[i]?.id)) return
    const otherIds = conversationOrder.filter((oid) => !partition.some((c) => c.id === oid))
    setConversationOrder([...otherIds, ...nextPartition.map((c) => c.id)])
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ ['--chat-ring' as string]: 'var(--surface)' }}>
      <div className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--border)]">
        <h2 className="flex-1 text-[15px] font-bold text-text-primary">Direct messages</h2>
        <button onClick={() => openModal({ kind: 'new-dm' })} title="New message" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay">
          <SquarePen size={17} />
        </button>
      </div>
      <div className="px-3 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a conversation"
          className="w-full rounded-lg bg-surface-raised border border-[var(--border)] px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
      </div>
      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
        {pinnedCount > 0 && (
          <div className="px-2 pt-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Pinned</div>
        )}
        {sorted.map((c, i) => (
          <div key={c.id}>
            {i === pinnedCount && pinnedCount > 0 && (
              <>
                {dragConvId != null && pinnedConversations.includes(dragConvId) && (
                  <div
                    className="h-2 -my-1"
                    onDragOver={(e) => { e.preventDefault(); setDropConvTarget(null) }}
                    onDrop={(e) => { e.preventDefault(); dropConversation() }}
                  />
                )}
                <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">All chats</div>
              </>
            )}
            <DmRow
              conv={c}
              pinned={pinnedConversations.includes(c.id)}
              muted={mutedConversations.includes(c.id)}
              onPicked={onPicked}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ convId: c.id, x: e.clientX, y: e.clientY }) }}
              draggable={!query.trim()}
              isDragging={dragConvId === c.id}
              isDropTarget={dragConvId != null && dragConvId !== c.id && dropConvTarget === c.id}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragConvId(c.id) }}
              onDragEnd={() => { setDragConvId(null); setDropConvTarget(null) }}
              onDragOver={(e) => { if (dragConvId == null || dragConvId === c.id) return; e.preventDefault(); setDropConvTarget(c.id) }}
              onDrop={(e) => { if (dragConvId == null) return; e.preventDefault(); dropConversation() }}
              nowPlaying={nowPlaying}
            />
          </div>
        ))}
        {dragConvId != null && !pinnedConversations.includes(dragConvId) && (
          <div
            className="h-3 -my-1.5"
            onDragOver={(e) => { e.preventDefault(); setDropConvTarget(null) }}
            onDrop={(e) => { e.preventDefault(); dropConversation() }}
          />
        )}
        {conversations.length === 0 && (
          <div className="px-4 py-10 text-center">
            <span className="mx-auto w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center mb-3"><ShieldCheck size={22} /></span>
            <p className="text-sm font-semibold text-text-primary">Private, encrypted DMs</p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">Message any staff member one-on-one or in a group. Only participants can read them.</p>
            <button onClick={() => openModal({ kind: 'new-dm' })} className="mt-3 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold hover:brightness-110">Start a conversation</button>
          </div>
        )}
      </div>
      <StatusBar />
      {showFooter && <MeFooter />}
      {ctxMenu && (() => {
        const pinned = pinnedConversations.includes(ctxMenu.convId)
        const muted = mutedConversations.includes(ctxMenu.convId)
        const items: RoomMenuItem[] = [
          {
            label: pinned ? 'Unpin chat' : 'Pin chat',
            icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => togglePinConversation(ctxMenu.convId),
          },
          {
            label: muted ? 'Unmute chat' : 'Mute chat',
            icon: muted ? <BellRing size={14} /> : <BellOff size={14} />,
            onClick: () => toggleMuteConversation(ctxMenu.convId),
          },
          {
            label: 'Delete chat',
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => setConfirmDeleteConvId(ctxMenu.convId),
          },
        ]
        return <RoomMenu x={ctxMenu.x} y={ctxMenu.y} items={items} onClose={() => setCtxMenu(null)} />
      })()}
      {confirmDeleteConvId !== null && (
        <ConfirmDialog
          title="Delete this chat?"
          body="The conversation and its messages will be removed for everyone. This can't be undone."
          confirmLabel="Delete chat"
          onCancel={() => setConfirmDeleteConvId(null)}
          onConfirm={() => {
            const id = confirmDeleteConvId
            setConfirmDeleteConvId(null)
            deleteConversation(id, toast)
          }}
        />
      )}
    </div>
  )
}
