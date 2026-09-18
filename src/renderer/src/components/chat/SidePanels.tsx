import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown, Gavel, Loader2, MessageSquare, MicOff, MoreHorizontal, Pin, Shield, ShieldBan, Timer, UserCog, UserMinus, X } from 'lucide-react'
import * as api from '../../lib/chatApi'
import type { ChatMember, ChatMessage } from '../../lib/chatApi'
import { isTimedOut } from '../../lib/chatApi'
import { displayName, roomKey, useChatStore, useExpiryTick, useMyPostingRestriction, useNowPlayingByIds, type RoomRef } from '../../store/chatStore'
import { useChatPermissions } from '../../hooks/useChatPermissions'
import Composer from './Composer'
import MessageBody from './MessageBody'
import MessageItem, { ConfirmDialog } from './MessageItem'
import { useOpenModal } from './modalHost'
import { TimeoutBadge } from './Moderation'
import { useRoomPeople } from './people'
import { relativeTime } from '../adminShared'
import { useRoomInfo } from './RoomPane'
import { ChatAvatar, IconButton, errorText, shortStamp, useChatToast, useDismiss } from './ui'
import { useOpenUserCard } from './UserCard'

function PanelShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <aside className="w-full md:w-[340px] shrink-0 min-h-0 flex flex-col border-l border-[var(--border)] bg-surface">
      <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--border)]">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-text-muted truncate">{subtitle}</p>}
        </div>
        <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
      </header>
      {children}
    </aside>
  )
}

export function ThreadPanel({ room, rootId, onClose }: { room: RoomRef; rootId: number; onClose: () => void }): JSX.Element {
  const root = useChatStore((s) => s.rooms[roomKey(room)]?.items.find((m) => m.id === rootId))
  const thread = useChatStore((s) => s.threads[rootId])
  const people = useRoomPeople(room)
  const info = useRoomInfo(room)
  const restriction = useMyPostingRestriction(room)
  const [editingId, setEditingId] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const count = thread?.items.length ?? 0

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: count > 0 ? 'smooth' : 'auto' })
  }, [count])

  return (
    <PanelShell title="Thread" subtitle={room.kind === 'channel' ? `#${info.title}` : info.title} onClose={onClose}>
      <div ref={scroller} className="chat-scroll flex-1 min-h-0 overflow-y-auto pb-3">
        {root ? (
          <div className="pb-2 border-b border-[var(--border)]">
            <MessageItem message={root} grouped={false} people={people} canModerate={info.canModerate} inThread editing={editingId === root.id} onStartEdit={setEditingId} />
          </div>
        ) : (
          <p className="px-5 py-4 text-xs text-text-muted">The original message isn&apos;t loaded.</p>
        )}
        <div className="flex items-center gap-3 px-5 py-2">
          <span className="text-[11px] font-semibold text-text-muted">{count} {count === 1 ? 'reply' : 'replies'}</span>
          <span className="flex-1 h-px bg-[var(--border)]" />
        </div>
        {thread?.loading && count === 0 ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
        ) : (
          thread?.items.map((m, i) => {
            const prev = thread.items[i - 1]
            const grouped = !!prev && prev.author.id === m.author.id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 300_000
            return (
              <div key={m.localId ?? m.id} className={m.sendState ? 'chat-in' : undefined}>
                <MessageItem message={m} grouped={grouped} people={people} canModerate={info.canModerate} inThread editing={editingId === m.id} onStartEdit={setEditingId} />
              </div>
            )
          })
        )}
      </div>
      <Composer room={room} people={people} parent={rootId} placeholder="Reply to thread" compact encrypted={info.encrypted} disabledReason={restriction} />
    </PanelShell>
  )
}

export function PinsPanel({ room, onClose }: { room: RoomRef; onClose: () => void }): JSX.Element {
  const items = useChatStore((s) => s.rooms[roomKey(room)]?.items)
  const hasMore = useChatStore((s) => s.rooms[roomKey(room)]?.hasMore)
  const people = useRoomPeople(room)
  const pinned = useMemo(() => (items ?? []).filter((m) => m.pinned && !m.deleted_at).reverse(), [items])
  return (
    <PanelShell title="Pinned messages" subtitle={`${pinned.length} pinned`} onClose={onClose}>
      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {pinned.length === 0 && (
          <div className="flex flex-col items-center text-center py-10 px-4">
            <span className="w-12 h-12 rounded-2xl bg-amber-400/15 text-amber-400 flex items-center justify-center mb-3"><Pin size={22} /></span>
            <p className="text-sm font-semibold text-text-primary">Nothing pinned yet</p>
            <p className="text-xs text-text-muted mt-1">Hover a message and use the pin button to keep it handy here.</p>
          </div>
        )}
        {pinned.map((m: ChatMessage) => (
          <button
            key={m.id}
            onClick={() => window.dispatchEvent(new CustomEvent('chat:jump', { detail: m.id }))}
            className="w-full text-left rounded-xl border border-[var(--border)] bg-surface-raised/50 p-3 hover:border-amber-400/40 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <ChatAvatar user={m.author} size={20} />
              <span className="text-xs font-semibold text-text-primary truncate">{displayName(m.author)}</span>
              <span className="text-[10px] text-text-muted ml-auto shrink-0">{shortStamp(m.created_at)}</span>
            </div>
            <div className="line-clamp-4 pointer-events-none"><MessageBody message={m} people={people} /></div>
            {m.attachments.length > 0 && <p className="mt-1 text-[11px] text-text-muted">{m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</p>}
          </button>
        ))}
        {hasMore && pinned.length > 0 && (
          <p className="text-center text-[11px] text-text-muted pt-2">Scroll further back in the channel to find older pins.</p>
        )}
      </div>
    </PanelShell>
  )
}

function MemberRow({ member, serverId, canManage, canManageRoles, canKick, canBan, ownerId, onMessage, listening }: {
  member: ChatMember
  serverId: number
  canManage: boolean
  canManageRoles: boolean
  canKick: boolean
  canBan: boolean
  ownerId: number
  onMessage: (userId: number) => void
  listening?: boolean
}): JSX.Element {
  const meId = useChatStore((s) => s.meId)
  const loadMembers = useChatStore((s) => s.loadMembers)
  const openUserCard = useOpenUserCard()
  const openModal = useOpenModal()
  const toast = useChatToast()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(menu, () => setMenu(false), ref)
  const isOwner = member.user.id === ownerId
  const isMe = member.user.id === meId
  // The API refuses every moderation action against the owner and against
  // platform administrators, so those rows only ever get the roles entry.
  const isProtected = isOwner || member.user.role === 'administrator'
  const hasMenu = canManageRoles || canManage || ((canKick || canBan) && !isProtected)
  // Keeps the row's timeout chip and its menu entry ("Remove timeout" vs
  // "Time out") in step with the clock while a timeout runs out.
  useExpiryTick(member.timeout_until)
  const timedOut = isTimedOut(member)
  const openProfile = (e: React.MouseEvent): void => openUserCard(member.user, e)

  const act = (fn: () => Promise<unknown>, ok: string): void => {
    setMenu(false)
    fn().then(() => { toast(ok, 'ok'); return loadMembers(serverId, true) }).catch((err) => toast(errorText(err)))
  }

  return (
    <div ref={ref} className="group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-raised/60">
      <ChatAvatar user={member.user} size={32} presence listening={listening} onClick={openProfile} />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={openProfile}>
        <p className={`text-sm truncate flex items-center gap-1 hover:underline ${member.muted ? 'text-text-muted line-through' : 'text-text-primary'}`}>
          {displayName(member.user)}
          {isOwner && <Crown size={12} className="text-amber-400 shrink-0" />}
          {!isOwner && member.server_role === 'admin' && <Shield size={12} className="text-sky-400 shrink-0" />}
          {member.muted && <MicOff size={12} className="text-text-muted shrink-0" aria-label="Muted" />}
          {timedOut && member.timeout_until && <TimeoutBadge until={member.timeout_until} />}
        </p>
        <p className="text-[11px] text-text-muted truncate flex items-center gap-1">
          <span>@{member.user.username}</span>
          {member.roles.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color || '#8a8f98' }} />
              {r.name}
            </span>
          ))}
        </p>
      </div>
      {!isMe && (
        <button onClick={() => onMessage(member.user.id)} title="Message" className="w-7 h-7 rounded-lg hidden group-hover:flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay">
          <MessageSquare size={14} />
        </button>
      )}
      {hasMenu && !isOwner && (
        <button onClick={() => setMenu((v) => !v)} title="Manage" className="w-7 h-7 rounded-lg flex md:hidden md:group-hover:flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay">
          <MoreHorizontal size={15} />
        </button>
      )}
      {!hasMenu && isMe && !isOwner && (
        <button onClick={() => setConfirm(true)} title="Leave server" className="w-7 h-7 rounded-lg hidden group-hover:flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-500/10">
          <UserMinus size={14} />
        </button>
      )}
      {menu && (
        <div className="chat-pop absolute right-2 top-full z-20 mt-1 w-48 rounded-xl border border-[var(--border)] bg-surface shadow-2xl py-1">
          {canManageRoles && (
            <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'member-roles', serverId, member }) }}>
              <span className="inline-flex items-center gap-2"><UserCog size={14} />Manage roles</span>
            </MenuItem>
          )}
          {canManage && (
            <MenuItem onClick={() => act(() => api.updateMember(serverId, member.user.id, { server_role: member.server_role === 'admin' ? 'member' : 'admin' }), 'Role updated')}>
              {member.server_role === 'admin' ? 'Remove admin' : 'Make admin'}
            </MenuItem>
          )}
          {canManage && !isProtected && (
            <MenuItem onClick={() => act(() => api.updateMember(serverId, member.user.id, { muted: !member.muted }), member.muted ? 'Unmuted' : 'Muted')}>
              {member.muted ? 'Unmute' : 'Mute'}
            </MenuItem>
          )}
          {canKick && !isProtected && !isMe && (
            timedOut
              ? (
                <MenuItem onClick={() => act(() => api.clearMemberTimeout(serverId, member.user.id), 'Timeout removed')}>
                  <span className="inline-flex items-center gap-2"><Timer size={14} />Remove timeout</span>
                </MenuItem>
              )
              : (
                <MenuItem onClick={() => { setMenu(false); openModal({ kind: 'timeout-member', serverId, member }) }}>
                  <span className="inline-flex items-center gap-2"><Timer size={14} />Time out…</span>
                </MenuItem>
              )
          )}
          {(canManage || canKick) && (isMe || !isProtected) && (
            <MenuItem danger onClick={() => { setMenu(false); setConfirm(true) }}>{isMe ? 'Leave server' : 'Kick from server'}</MenuItem>
          )}
          {canBan && !isProtected && !isMe && (
            <MenuItem danger onClick={() => { setMenu(false); openModal({ kind: 'ban-member', serverId, user: member.user }) }}>
              <span className="inline-flex items-center gap-2"><Gavel size={14} />Ban…</span>
            </MenuItem>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={isMe ? 'Leave this server?' : `Kick ${displayName(member.user)}?`}
          body={isMe
            ? 'You’ll need an owner or admin to add you back.'
            : 'They lose access to every channel here, but can rejoin if the server is public. Ban them instead to keep them out.'}
          confirmLabel={isMe ? 'Leave' : 'Kick'}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            if (isMe) act(() => api.leaveServer(serverId), 'Left server')
            else act(() => api.removeMember(serverId, member.user.id), 'Member kicked')
          }}
        />
      )}
    </div>
  )
}

export function MenuItem({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }): JSX.Element {
  return (
    <button onClick={onClick} className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay ${danger ? 'text-red-400' : 'text-text-primary'}`}>
      {children}
    </button>
  )
}

export function MembersPanel({ serverId, onClose, onAddMembers }: { serverId: number; onClose: () => void; onAddMembers: () => void }): JSX.Element {
  const openModal = useOpenModal()
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const members = useChatStore((s) => s.members[serverId])
  const online = useChatStore((s) => s.online)
  const loadMembers = useChatStore((s) => s.loadMembers)
  const startDm = useChatStore((s) => s.startDm)
  const me = useChatStore((s) => s.me)
  const toast = useChatToast()
  const [query, setQuery] = useState('')

  useEffect(() => { void loadMembers(serverId) }, [serverId, loadMembers])

  const canManage = me?.role === 'administrator' || server?.my_role === 'owner' || server?.my_role === 'admin'
  const perms = useChatPermissions(serverId)
  const canManageRoles = perms.canManageRoles
  const canKick = canManage || perms.canKickOrTimeout
  const canBan = canManage || perms.canBanOrUnban
  const q = query.trim().toLowerCase()
  const filtered = (members ?? []).filter((m) => !q || m.user.username.toLowerCase().includes(q) || m.user.display_name.toLowerCase().includes(q))
  const onlineList = filtered.filter((m) => online[m.user.id])
  const offlineList = filtered.filter((m) => !online[m.user.id])
  const byName = (a: ChatMember, b: ChatMember) => displayName(a.user).localeCompare(displayName(b.user))
  // Offline members can't have a live now_playing (see docs/content.tsx's
  // 5-minute staleness window), so only the online section is worth polling.
  const nowPlaying = useNowPlayingByIds(onlineList.map((m) => m.user.id))

  const message = (userId: number): void => {
    startDm([userId]).catch((err) => toast(errorText(err, 'Could not open conversation')))
  }

  return (
    <PanelShell title="Members" subtitle={members ? `${members.length} in ${server?.name ?? 'server'}` : undefined} onClose={onClose}>
      <div className="p-3 pb-1 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members"
          className="flex-1 min-w-0 rounded-lg bg-surface-raised border border-[var(--border)] px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
        {canManage && (
          <button onClick={onAddMembers} className="shrink-0 px-3 rounded-lg bg-accent text-white text-xs font-bold hover:brightness-110">Add</button>
        )}
      </div>
      {(canBan || me?.role === 'administrator') && (
        <div className="px-3 pt-2 flex gap-2">
          {canBan && (
            <button
              onClick={() => openModal({ kind: 'server-bans', serverId })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-raised/60"
            >
              <ShieldBan size={13} />Banned users
            </button>
          )}
          {me?.role === 'administrator' && (
            <button
              onClick={() => openModal({ kind: 'site-moderation' })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-raised/60"
            >
              <Gavel size={13} />Site-wide
            </button>
          )}
        </div>
      )}
      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {!members ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
        ) : (
          <>
            {onlineList.length > 0 && <p className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Online — {onlineList.length}</p>}
            {onlineList.sort(byName).map((m) => (
              <MemberRow key={m.id} member={m} serverId={serverId} canManage={canManage} canManageRoles={canManageRoles} canKick={canKick} canBan={canBan} ownerId={server?.owner ?? -1} onMessage={message} listening={!!nowPlaying[m.user.id]} />
            ))}
            {offlineList.length > 0 && <p className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Offline — {offlineList.length}</p>}
            <div className="opacity-60">
              {offlineList.sort(byName).map((m) => (
                <MemberRow key={m.id} member={m} serverId={serverId} canManage={canManage} canManageRoles={canManageRoles} canKick={canKick} canBan={canBan} ownerId={server?.owner ?? -1} onMessage={message} />
              ))}
            </div>
          </>
        )}
      </div>
    </PanelShell>
  )
}

export function DmInfoPanel({ conversationId, onClose, onAddPeople }: { conversationId: number; onClose: () => void; onAddPeople: () => void }): JSX.Element {
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === conversationId))
  const meId = useChatStore((s) => s.meId)
  const openUserCard = useOpenUserCard()
  const toast = useChatToast()
  const [confirm, setConfirm] = useState<number | null>(null)
  const nowPlaying = useNowPlayingByIds(conv?.participants.map((p) => p.user.id) ?? [])
  if (!conv) return <PanelShell title="Details" onClose={onClose}><div /></PanelShell>
  return (
    <PanelShell title={conv.is_group ? 'Group members' : 'Details'} subtitle={`${conv.participants.length} people · encrypted`} onClose={onClose}>
      <div className="chat-scroll flex-1 min-h-0 overflow-y-auto p-2">
        {conv.participants.map((p) => (
          <div key={p.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-raised/60">
            <ChatAvatar user={p.user} size={32} presence listening={!!nowPlaying[p.user.id]} onClick={(e) => openUserCard(p.user, e)} />
            <div className="flex-1 min-w-0 cursor-pointer" onClick={(e) => openUserCard(p.user, e)}>
              <p className="text-sm text-text-primary truncate hover:underline">{displayName(p.user)}{p.user.id === meId && <span className="text-text-muted"> (you)</span>}</p>
              <p className="text-[11px] text-text-muted truncate">Joined {relativeTime(p.joined_at)}</p>
            </div>
            {conv.is_group && p.user.id !== meId && (
              <button onClick={() => setConfirm(p.user.id)} title="Remove" className="w-7 h-7 rounded-lg hidden group-hover:flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-500/10">
                <UserMinus size={14} />
              </button>
            )}
          </div>
        ))}
        {conv.is_group && (
          <button onClick={onAddPeople} className="mt-2 w-full rounded-lg border border-dashed border-[var(--border)] py-2 text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted">
            Add people
          </button>
        )}
      </div>
      {confirm !== null && (
        <ConfirmDialog
          title="Remove from group?"
          body="They'll stop receiving new messages. The conversation key is rotated so they can't read anything sent afterwards."
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm
            setConfirm(null)
            api.updateConversation(conversationId, { remove_participant_ids: [id] })
              .then((updated) => {
                useChatStore.setState((s) => ({ conversations: s.conversations.map((c) => c.id === updated.id ? updated : c) }))
                return useChatStore.getState().resolveKey(conversationId)
              })
              .catch((err) => toast(errorText(err)))
          }}
        />
      )}
    </PanelShell>
  )
}
