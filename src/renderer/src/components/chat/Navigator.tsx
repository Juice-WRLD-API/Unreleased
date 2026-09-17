import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Lock, MessagesSquare, Pencil, Pin, PinOff, Plus, Settings, ShieldCheck, SquarePen, UserPlus, WifiOff } from 'lucide-react'
import type { ChatChannel, Conversation } from '../../lib/chatApi'
import { conversationTitle, displayName, roomKey, useChatStore } from '../../store/chatStore'
import { useOpenModal } from './modalHost'
import { ChannelIcon, ChatAvatar, CountBadge, ServerGlyph, shortStamp, useDismiss } from './ui'
import { MenuItem } from './SidePanels'

// Minimal cursor-positioned menu for the single pin/unpin action, used from a
// right-click on a server rail icon or a DM row. Mirrors PlaylistContextMenu's
// portal + fixed-position + clamp-on-mount approach at a much smaller scale.
function PinMenu({ x, y, pinned, label, onToggle, onClose }: {
  x: number
  y: number
  pinned: boolean
  label: string
  onToggle: () => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 w-[180px] overflow-hidden"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => { onToggle(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary hover:bg-surface-overlay transition-colors"
        >
          {pinned ? <PinOff size={14} className="text-text-muted" /> : <Pin size={14} className="text-text-muted" />}
          <span className="flex-1 text-left">{pinned ? `Unpin ${label}` : `Pin ${label}`}</span>
        </button>
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
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-text-primary transition-all duration-200 ${
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

export function ServerRail(): JSX.Element {
  const servers = useChatStore((s) => s.servers)
  const activeServerId = useChatStore((s) => s.activeServerId)
  const selectServer = useChatStore((s) => s.selectServer)
  const unread = useChatStore((s) => s.unread)
  const mentions = useChatStore((s) => s.mentions)
  const conversations = useChatStore((s) => s.conversations)
  const pinnedServers = useChatStore((s) => s.pinnedServers)
  const togglePinServer = useChatStore((s) => s.togglePinServer)
  const openModal = useOpenModal()
  const [ctxMenu, setCtxMenu] = useState<{ serverId: number; x: number; y: number } | null>(null)

  const dmUnread = conversations.reduce((n, c) => n + (unread[`d:${c.id}`] ?? 0), 0)
  const orderedServers = useMemo(
    () => [...servers].sort((a, b) => Number(pinnedServers.includes(b.id)) - Number(pinnedServers.includes(a.id))),
    [servers, pinnedServers],
  )

  return (
    <nav className="w-[72px] shrink-0 flex flex-col items-center gap-2 py-3 bg-[var(--chat-rail)] border-r border-[var(--border)] overflow-y-auto no-scrollbar" style={{ ['--chat-ring' as string]: 'var(--chat-rail)' }}>
      <RailButton label="Direct messages" active={activeServerId === null} mentions={dmUnread} onClick={() => selectServer(null)}>
        <span className={`w-11 h-11 flex items-center justify-center transition-all duration-200 ${
          activeServerId === null ? 'rounded-[14px] bg-accent text-white' : 'rounded-[22px] bg-surface-raised text-text-secondary group-hover:rounded-[14px] group-hover:bg-accent group-hover:text-white'
        }`}>
          <MessagesSquare size={20} />
        </span>
      </RailButton>
      <span className="w-8 h-px bg-[var(--border)] my-0.5" />
      {orderedServers.map((server) => {
        const keys = server.channels.map((c) => `c:${c.id}`)
        const hasUnread = keys.some((k) => (unread[k] ?? 0) > 0)
        const mentionCount = keys.reduce((n, k) => n + (mentions[k] ?? 0), 0)
        return (
          <RailButton
            key={server.id}
            label={server.name}
            active={activeServerId === server.id}
            unread={hasUnread}
            mentions={mentionCount}
            pinned={pinnedServers.includes(server.id)}
            onClick={() => selectServer(server.id)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ serverId: server.id, x: e.clientX, y: e.clientY }) }}
          >
            <ServerGlyph server={server} active={activeServerId === server.id} />
          </RailButton>
        )
      })}
      <RailButton label="Create a server" active={false} onClick={() => openModal({ kind: 'create-server' })}>
        <span className="w-11 h-11 rounded-[22px] group-hover:rounded-[14px] bg-surface-raised text-accent group-hover:bg-accent group-hover:text-white flex items-center justify-center transition-all duration-200">
          <Plus size={22} />
        </span>
      </RailButton>
      {ctxMenu && (
        <PinMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          pinned={pinnedServers.includes(ctxMenu.serverId)}
          label="server"
          onToggle={() => togglePinServer(ctxMenu.serverId)}
          onClose={() => setCtxMenu(null)}
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

function MeFooter(): JSX.Element | null {
  const me = useChatStore((s) => s.me)
  if (!me) return null
  return (
    <div className="shrink-0 border-t border-[var(--border)] px-2 py-2 flex items-center gap-2.5 bg-[var(--chat-rail)]/40">
      <ChatAvatar user={me} size={32} presence />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{displayName(me)}</p>
        <p className="text-[11px] text-text-muted truncate">{me.role === 'administrator' ? 'Administrator' : 'Manager'}</p>
      </div>
    </div>
  )
}

export function ChannelList({ serverId, onPicked, showFooter = true }: { serverId: number; onPicked?: () => void; showFooter?: boolean }): JSX.Element | null {
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const active = useChatStore((s) => s.active)
  const unread = useChatStore((s) => s.unread)
  const mentions = useChatStore((s) => s.mentions)
  const openRoom = useChatStore((s) => s.openRoom)
  const me = useChatStore((s) => s.me)
  const openModal = useOpenModal()
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menu, () => setMenu(false), menuRef)

  const groups = useMemo(() => {
    const map = new Map<string, ChatChannel[]>()
    for (const c of [...(server?.channels ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      const k = c.category || ''
      map.set(k, [...(map.get(k) ?? []), c])
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [server])

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
            {canManage && <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'server-settings', serverId }) }}><span className="inline-flex items-center gap-2"><Settings size={14} />Server settings</span></MenuItem>}
            {!canManage && <p className="px-3 py-2 text-xs text-text-muted">Only owners and admins can manage this server.</p>}
          </div>
        )}
      </div>

      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-3">
        {server.description && <p className="px-2 text-xs text-text-muted leading-relaxed">{server.description}</p>}
        {groups.map(([category, channels]) => (
          <div key={category || '_'}>
            {category && (
              <div className="group flex items-center pr-1">
                <button onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))} className="flex-1 flex items-center gap-1 px-1 py-1 text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-secondary text-left">
                  <ChevronDown size={12} className={`transition-transform ${collapsed[category] ? '-rotate-90' : ''}`} />
                  <span className="truncate">{category}</span>
                </button>
                {canManage && (
                  <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                    <button onClick={() => openModal({ kind: 'rename-category', serverId, category })} title="Rename category" className="p-1 text-text-muted hover:text-text-primary">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => openModal({ kind: 'channel', serverId })} title="Create channel" className="p-1 text-text-muted hover:text-text-primary">
                      <Plus size={14} />
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="space-y-px">
              {channels.map((c) => {
                const key = roomKey({ kind: 'channel', id: c.id })
                const isActive = active?.kind === 'channel' && active.id === c.id
                const count = unread[key] ?? 0
                const mention = mentions[key] ?? 0
                if (collapsed[category] && !isActive && count === 0) return null
                return (
                  <div key={c.id} className="group relative">
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
                )
              })}
            </div>
          </div>
        ))}
        {server.channels.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-text-secondary">No channels you can see yet.</p>
            {canManage && <button onClick={() => openModal({ kind: 'channel', serverId })} className="mt-2 text-xs font-semibold text-accent hover:underline">Create the first one</button>}
          </div>
        )}
      </div>
      <StatusBar />
      {showFooter && <MeFooter />}
    </div>
  )
}

function DmRow({ conv, pinned, onPicked, onContextMenu }: {
  conv: Conversation
  pinned: boolean
  onPicked?: () => void
  onContextMenu: (e: React.MouseEvent) => void
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
    if (p && 'text' in p && p.text) return p.text
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
      className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${isActive ? 'bg-surface-highest' : 'hover:bg-surface-raised/70'}`}
    >
      {conv.is_group || others.length !== 1 ? (
        <span className="relative w-10 h-10 shrink-0">
          {others.slice(0, 2).map((p, i) => (
            <ChatAvatar key={p.id} user={p.user} size={28} className={`absolute ${i === 0 ? 'top-0 left-0' : 'bottom-0 right-0 ring-2 ring-[var(--surface)] rounded-full'}`} />
          ))}
        </span>
      ) : (
        <ChatAvatar user={others[0].user} size={40} presence />
      )}
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          {pinned && <Pin size={11} className="shrink-0 text-text-muted" />}
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
  const openModal = useOpenModal()
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ convId: number; x: number; y: number } | null>(null)

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations
      .filter((c) => !q || conversationTitle(c, meId).toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        const pinDiff = Number(pinnedConversations.includes(b.id)) - Number(pinnedConversations.includes(a.id))
        if (pinDiff !== 0) return pinDiff
        const la = lastMessage[`d:${a.id}`]?.created_at ?? a.updated_at
        const lb = lastMessage[`d:${b.id}`]?.created_at ?? b.updated_at
        return lb.localeCompare(la)
      })
  }, [conversations, lastMessage, query, meId, pinnedConversations])
  const pinnedCount = sorted.filter((c) => pinnedConversations.includes(c.id)).length

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
              <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">All chats</div>
            )}
            <DmRow
              conv={c}
              pinned={pinnedConversations.includes(c.id)}
              onPicked={onPicked}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ convId: c.id, x: e.clientX, y: e.clientY }) }}
            />
          </div>
        ))}
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
    </div>
  )
}
