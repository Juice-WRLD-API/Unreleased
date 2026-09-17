import { create } from 'zustand'
import * as api from '../lib/chatApi'
import type { AttachmentInput, ChatMember, ChatMessage, ChatServer, ChatUserBrief, Conversation } from '../lib/chatApi'
import { ChatSocket, type ChatEvent, type RoomKind, type SocketStatus } from '../lib/chatSocket'
import type { AccountUser } from '../lib/userApi'

export interface RoomRef { kind: RoomKind; id: number }

export const roomKey = (r: RoomRef): string => `${r.kind === 'channel' ? 'c' : 'd'}:${r.id}`
export const parseRoomKey = (key: string): RoomRef => ({
  kind: key.startsWith('c:') ? 'channel' : 'conversation',
  id: Number(key.slice(2)),
})
const messageRoom = (m: { channel: number | null; conversation: number | null }): string | null =>
  m.channel != null ? `c:${m.channel}` : m.conversation != null ? `d:${m.conversation}` : null

export type SendState = 'sending' | 'failed'

export interface UiMessage extends ChatMessage {
  localId?: string
  sendState?: SendState
  retry?: () => void
}

export interface RoomMessages {
  items: UiMessage[]
  hasMore: boolean
  loading: boolean
  loaded: boolean
  error: string | null
}

export type KeyState = 'unknown' | 'resolving' | 'ready' | 'waiting' | 'error'
export type Decrypted = { text: string } | { error: 'missing-key' | 'failed' }

const PAGE = 40
const TYPING_TTL_MS = 6000

function emptyRoom(): RoomMessages {
  return { items: [], hasMore: true, loading: false, loaded: false, error: null }
}

function upsert(items: UiMessage[], msg: UiMessage): UiMessage[] {
  const idx = items.findIndex((m) => m.id === msg.id)
  if (idx >= 0) {
    const next = items.slice()
    next[idx] = { ...items[idx], ...msg, sendState: undefined, localId: items[idx].localId }
    return next
  }
  const next = items.concat(msg)
  // Temp messages carry negative ids and always belong at the end.
  next.sort((a, b) => (a.id < 0 ? Infinity : a.id) - (b.id < 0 ? Infinity : b.id))
  return next
}

function loadLastRead(userId: number): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(`unreleased:chat:lastRead:${userId}`) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function saveLastRead(userId: number, map: Record<string, number>): void {
  try { localStorage.setItem(`unreleased:chat:lastRead:${userId}`, JSON.stringify(map)) } catch {}
}

interface PinnedIds { servers: number[]; conversations: number[] }

function loadPinned(userId: number): PinnedIds {
  try {
    const raw = JSON.parse(localStorage.getItem(`unreleased:chat:pinned:${userId}`) ?? '{}') as Partial<PinnedIds>
    return { servers: raw.servers ?? [], conversations: raw.conversations ?? [] }
  } catch {
    return { servers: [], conversations: [] }
  }
}

function savePinned(userId: number, pinned: PinnedIds): void {
  try { localStorage.setItem(`unreleased:chat:pinned:${userId}`, JSON.stringify(pinned)) } catch {}
}

interface OrderIds { servers: number[]; conversations: number[] }

function loadOrder(userId: number): OrderIds {
  try {
    const raw = JSON.parse(localStorage.getItem(`unreleased:chat:order:${userId}`) ?? '{}') as Partial<OrderIds>
    return { servers: raw.servers ?? [], conversations: raw.conversations ?? [] }
  } catch {
    return { servers: [], conversations: [] }
  }
}

function saveOrder(userId: number, order: OrderIds): void {
  try { localStorage.setItem(`unreleased:chat:order:${userId}`, JSON.stringify(order)) } catch {}
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item).catch(() => undefined)
    }
  })
  await Promise.all(workers)
}

const e2e = () => import('../lib/chatE2E')

export function hasChatAccess(account: AccountUser | null): boolean {
  if (!account) return false
  const su = (account as AccountUser & { is_superuser?: boolean }).is_superuser
  return !!(account.is_administrator || account.is_manager || su)
}

interface ChatState {
  status: SocketStatus
  me: ChatUserBrief | null
  meId: number | null
  initialized: boolean
  loadError: string | null

  servers: ChatServer[]
  members: Record<number, ChatMember[]>
  conversations: Conversation[]
  pinnedServers: number[]
  pinnedConversations: number[]
  serverOrder: number[]
  conversationOrder: number[]

  activeServerId: number | null
  active: RoomRef | null
  threadRootId: number | null
  threads: Record<number, { items: UiMessage[]; loading: boolean }>
  panel: 'members' | 'pins' | null

  rooms: Record<string, RoomMessages>
  lastMessage: Record<string, ChatMessage>
  lastRead: Record<string, number>
  unread: Record<string, number>
  mentions: Record<string, number>
  receipts: Record<string, Record<number, number>>
  typing: Record<string, Record<number, number>>
  online: Record<number, true>

  keyState: Record<number, KeyState>
  plain: Record<number, Decrypted>

  init: (account: AccountUser) => Promise<void>
  teardown: () => void
  refreshLists: () => Promise<void>

  selectServer: (id: number | null) => void
  togglePinServer: (id: number) => void
  togglePinConversation: (id: number) => void
  setServerOrder: (ids: number[]) => void
  setConversationOrder: (ids: number[]) => void
  openRoom: (room: RoomRef) => void
  loadOlder: (room: RoomRef) => Promise<void>
  setPanel: (panel: 'members' | 'pins' | null) => void
  openThread: (rootId: number | null) => void

  send: (room: RoomRef, input: { text: string; files: File[]; parent?: number | null; mentions?: number[] }) => Promise<void>
  edit: (message: ChatMessage, text: string) => Promise<void>
  remove: (message: ChatMessage) => Promise<void>
  togglePin: (message: ChatMessage) => Promise<void>
  toggleReaction: (message: ChatMessage, emoji: string) => Promise<void>
  markRead: (room: RoomRef) => void
  sendTyping: (room: RoomRef, active: boolean) => void

  loadMembers: (serverId: number, force?: boolean) => Promise<ChatMember[]>
  startDm: (userIds: number[], name?: string) => Promise<Conversation>
  resolveKey: (conversationId: number) => Promise<void>
  decryptRoom: (conversationId: number) => Promise<void>

  totalUnread: () => number
}

let socket: ChatSocket | null = null
let typingTimer: number | null = null
let initPromise: Promise<void> | null = null
const rerunResolve = new Set<number>()
// Last room open per server (-1 for DMs), so switching back lands where you were.
const lastRoomBySpace = new Map<number, RoomRef>()

export const useChatStore = create<ChatState>((set, get) => {
  const patchRoom = (key: string, fn: (r: RoomMessages) => Partial<RoomMessages>): void => {
    set((s) => {
      const cur = s.rooms[key] ?? emptyRoom()
      return { rooms: { ...s.rooms, [key]: { ...cur, ...fn(cur) } } }
    })
  }

  const setPlain = (id: number, value: Decrypted): void => {
    set((s) => ({ plain: { ...s.plain, [id]: value } }))
  }

  const decryptOne = async (msg: ChatMessage): Promise<void> => {
    const meId = get().meId
    if (!meId || !msg.is_encrypted || msg.id < 0) return
    const existing = get().plain[msg.id]
    if (existing && 'text' in existing && !msg.edited_at) return
    try {
      const { decryptMessage } = await e2e()
      setPlain(msg.id, { text: await decryptMessage(meId, msg) })
    } catch (err) {
      setPlain(msg.id, { error: String((err as Error)?.message) === 'missing-key' ? 'missing-key' : 'failed' })
    }
  }

  const isViewing = (key: string): boolean => {
    const a = get().active
    return !!a && roomKey(a) === key && document.visibilityState === 'visible'
  }

  const bumpUnread = (msg: ChatMessage): void => {
    const key = messageRoom(msg)
    const meId = get().meId
    if (!key || msg.author.id === meId || msg.parent) return
    if (isViewing(key)) {
      get().markRead(parseRoomKey(key))
      return
    }
    set((s) => ({
      unread: { ...s.unread, [key]: (s.unread[key] ?? 0) + 1 },
      mentions: meId && msg.mentions.includes(meId)
        ? { ...s.mentions, [key]: (s.mentions[key] ?? 0) + 1 }
        : s.mentions,
    }))
  }

  // Our own message echoed back by the socket while its REST call is still in
  // flight: the send() completion swaps the temp row for it, so inserting here
  // too would flash a duplicate.
  const ownEchoPending = (msg: ChatMessage, key: string): boolean => {
    if (msg.author.id !== get().meId) return false
    const list = msg.parent ? get().threads[msg.parent]?.items : get().rooms[key]?.items
    return !!list?.some((m) => m.sendState === 'sending' && m.parent === msg.parent) && !list.some((m) => m.id === msg.id)
  }

  const applyMessage = (msg: ChatMessage, isNew: boolean): void => {
    const key = messageRoom(msg)
    if (!key) return
    if (isNew && ownEchoPending(msg, key)) {
      // reply_count for our own pending reply was already bumped optimistically
      // when the temp message was placed (see send()); nothing more to do here.
      if (!msg.parent) set((s) => ({ lastMessage: { ...s.lastMessage, [key]: msg } }))
      return
    }
    if (msg.parent) {
      set((s) => {
        const thread = s.threads[msg.parent!]
        // Already counted (via the optimistic bump in send(), or a prior event
        // for this same message) if this id is already sitting in the thread.
        const alreadyCounted = thread?.items.some((m) => m.id === msg.id) ?? false
        const threads = thread ? { ...s.threads, [msg.parent!]: { ...thread, items: upsert(thread.items, msg) } } : s.threads
        const room = s.rooms[key]
        const rooms = room && isNew && !alreadyCounted
          ? { ...s.rooms, [key]: { ...room, items: room.items.map((m) => m.id === msg.parent ? { ...m, reply_count: m.reply_count + 1 } : m) } }
          : s.rooms
        return { threads, rooms }
      })
    } else {
      patchRoom(key, (r) => r.loaded ? { items: upsert(r.items, msg) } : {})
      set((s) => {
        const prev = s.lastMessage[key]
        return !prev || prev.id <= msg.id ? { lastMessage: { ...s.lastMessage, [key]: msg } } : {}
      })
    }
    if (msg.is_encrypted) void decryptOne(msg)
    if (isNew) bumpUnread(msg)
  }

  const mapMessage = (messageId: number, fn: (m: UiMessage) => UiMessage): void => {
    set((s) => {
      const rooms: Record<string, RoomMessages> = {}
      for (const [k, r] of Object.entries(s.rooms)) {
        if (r.items.some((m) => m.id === messageId)) rooms[k] = { ...r, items: r.items.map((m) => m.id === messageId ? fn(m) : m) }
      }
      const threads: ChatState['threads'] = {}
      for (const [k, t] of Object.entries(s.threads)) {
        if (t.items.some((m) => m.id === messageId)) threads[Number(k)] = { ...t, items: t.items.map((m) => m.id === messageId ? fn(m) : m) }
      }
      return { rooms: { ...s.rooms, ...rooms }, threads: { ...s.threads, ...threads } }
    })
  }

  const handleEvent = (ev: ChatEvent): void => {
    const s = get()
    switch (ev.type) {
      case 'presence.snapshot':
        set({ online: Object.fromEntries(ev.online.map((id) => [id, true as const])) })
        return
      case 'presence.update':
        set((st) => {
          const online = { ...st.online }
          if (ev.online) online[ev.user_id] = true
          else delete online[ev.user_id]
          return { online }
        })
        return
      case 'message.created':
        applyMessage(ev.message, true)
        return
      case 'message.updated':
      case 'message.pinned':
      case 'message.unpinned':
        mapMessage(ev.message.id, (m) => ({ ...m, ...ev.message }))
        if (ev.message.is_encrypted && ev.type === 'message.updated') {
          set((st) => {
            const plain = { ...st.plain }
            delete plain[ev.message.id]
            return { plain }
          })
          void decryptOne(ev.message)
        }
        return
      case 'message.deleted':
        mapMessage(ev.message_id, (m) => ({ ...m, content: '', ciphertext: '', nonce: '', attachments: [], deleted_at: new Date().toISOString() }))
        return
      case 'reaction.added':
      case 'reaction.removed': {
        const added = ev.type === 'reaction.added'
        mapMessage(ev.message_id, (m) => {
          const mine = ev.user_id === s.meId
          const reactions = m.reactions.map((r) => ({ ...r, user_ids: [...r.user_ids] }))
          let r = reactions.find((x) => x.emoji === ev.emoji)
          if (added) {
            if (r?.user_ids.includes(ev.user_id)) return m
            if (!r) { r = { emoji: ev.emoji, count: 0, user_ids: [], me: false }; reactions.push(r) }
            r.user_ids.push(ev.user_id)
            r.count = r.user_ids.length
            if (mine) r.me = true
          } else if (r) {
            if (!r.user_ids.includes(ev.user_id)) return m
            r.user_ids = r.user_ids.filter((id) => id !== ev.user_id)
            r.count = r.user_ids.length
            if (mine) r.me = false
          }
          return { ...m, reactions: reactions.filter((x) => x.count > 0) }
        })
        return
      }
      case 'read.receipt': {
        const key = ev.channel != null ? `c:${ev.channel}` : ev.conversation != null ? `d:${ev.conversation}` : null
        if (!key || ev.last_read_message_id == null) return
        if (ev.user_id === s.meId) {
          set((st) => {
            const lastRead = { ...st.lastRead, [key]: Math.max(st.lastRead[key] ?? 0, ev.last_read_message_id!) }
            if (st.meId) saveLastRead(st.meId, lastRead)
            const latest = st.lastMessage[key]?.id ?? 0
            return latest <= ev.last_read_message_id!
              ? { lastRead, unread: { ...st.unread, [key]: 0 }, mentions: { ...st.mentions, [key]: 0 } }
              : { lastRead }
          })
        } else {
          set((st) => ({ receipts: { ...st.receipts, [key]: { ...st.receipts[key], [ev.user_id]: ev.last_read_message_id! } } }))
        }
        return
      }
      case 'typing': {
        if (ev.user_id === s.meId) return
        const key = `${ev.kind === 'channel' ? 'c' : 'd'}:${ev.id}`
        set((st) => {
          const room = { ...st.typing[key] }
          if (ev.active) room[ev.user_id] = Date.now() + TYPING_TTL_MS
          else delete room[ev.user_id]
          return { typing: { ...st.typing, [key]: room } }
        })
        return
      }
      case 'member.joined':
      case 'member.updated':
        set((st) => {
          const list = st.members[ev.server]
          if (!list) return {}
          const others = list.filter((m) => m.user.id !== ev.member.user.id)
          return { members: { ...st.members, [ev.server]: [...others, ev.member] } }
        })
        if (ev.type === 'member.joined' && ev.member.user.id === s.meId) void get().refreshLists()
        return
      case 'member.left':
        if (ev.user_id === s.meId) {
          set((st) => ({
            servers: st.servers.filter((x) => x.id !== ev.server),
            activeServerId: st.activeServerId === ev.server ? null : st.activeServerId,
            active: st.activeServerId === ev.server ? null : st.active,
          }))
          return
        }
        set((st) => st.members[ev.server]
          ? { members: { ...st.members, [ev.server]: st.members[ev.server].filter((m) => m.user.id !== ev.user_id) } }
          : {})
        return
      case 'server.updated':
        set((st) => ({ servers: st.servers.map((x) => x.id === ev.server.id ? { ...x, ...ev.server } : x) }))
        return
      case 'channel.created':
      case 'channel.updated':
        set((st) => ({
          servers: st.servers.map((x) => x.id !== ev.server ? x : {
            ...x,
            channels: [...x.channels.filter((c) => c.id !== ev.channel.id), ev.channel],
          }),
        }))
        return
      case 'channel.deleted':
        set((st) => ({
          servers: st.servers.map((x) => x.id !== ev.server ? x : { ...x, channels: x.channels.filter((c) => c.id !== ev.channel_id) }),
          active: st.active?.kind === 'channel' && st.active.id === ev.channel_id ? null : st.active,
        }))
        return
      case 'conversation.updated': {
        const stillIn = ev.conversation.participants.some((p) => p.user.id === s.meId)
        set((st) => ({
          conversations: stillIn
            ? [ev.conversation, ...st.conversations.filter((c) => c.id !== ev.conversation.id)]
            : st.conversations.filter((c) => c.id !== ev.conversation.id),
          active: !stillIn && st.active?.kind === 'conversation' && st.active.id === ev.conversation.id ? null : st.active,
        }))
        return
      }
      case 'key.rotated':
        set((st) => ({
          conversations: st.conversations.map((c) => c.id === ev.conversation ? { ...c, current_key_version: Math.max(c.current_key_version, ev.key_version) } : c),
        }))
        void get().resolveKey(ev.conversation)
        return
      case 'envelope.available':
        void get().resolveKey(ev.conversation).then(() => get().decryptRoom(ev.conversation))
        return
      case 'device.added': {
        const conv = s.conversations.find((c) => c.id === ev.conversation)
        if (conv && s.meId && ev.user_id !== undefined) {
          void e2e().then((m) => m.shareKeyWithUser(s.meId!, conv, ev.user_id)).catch(() => undefined)
        }
        return
      }
      default:
        return
    }
  }

  const catchUp = async (): Promise<void> => {
    const active = get().active
    if (!active) return
    const key = roomKey(active)
    const room = get().rooms[key]
    const newest = room?.items.filter((m) => m.id > 0).slice(-1)[0]
    if (!room?.loaded || !newest) return
    const page = active.kind === 'channel'
      ? await api.listChannelMessages(active.id, { after: newest.id, limit: 100 })
      : await api.listDmMessages(active.id, { after: newest.id, limit: 100 })
    for (const m of page.results) applyMessage(m, false)
  }

  const primeRoom = async (key: string): Promise<void> => {
    const ref = parseRoomKey(key)
    const meId = get().meId
    const page = ref.kind === 'channel'
      ? await api.listChannelMessages(ref.id, { limit: 1 })
      : await api.listDmMessages(ref.id, { limit: 1 })
    const latest = page.results.slice(-1)[0]
    if (!latest) return
    set((s) => ({ lastMessage: { ...s.lastMessage, [key]: latest } }))
    if (latest.is_encrypted) void decryptOne(latest)
    const read = get().lastRead[key]
    if (read == null) {
      set((s) => {
        const lastRead = { ...s.lastRead, [key]: latest.id }
        if (meId) saveLastRead(meId, lastRead)
        return { lastRead }
      })
      return
    }
    if (latest.id <= read) return
    const after = ref.kind === 'channel'
      ? await api.listChannelMessages(ref.id, { after: read, limit: 100 })
      : await api.listDmMessages(ref.id, { after: read, limit: 100 })
    const fresh = after.results.filter((m) => m.author.id !== meId && !m.parent && !m.deleted_at)
    set((s) => ({
      unread: { ...s.unread, [key]: fresh.length },
      mentions: { ...s.mentions, [key]: fresh.filter((m) => meId && m.mentions.includes(meId)).length },
    }))
  }

  return {
    status: 'idle',
    me: null,
    meId: null,
    initialized: false,
    loadError: null,
    servers: [],
    members: {},
    conversations: [],
    pinnedServers: [],
    pinnedConversations: [],
    serverOrder: [],
    conversationOrder: [],
    activeServerId: null,
    active: null,
    threadRootId: null,
    threads: {},
    panel: 'members',
    rooms: {},
    lastMessage: {},
    lastRead: {},
    unread: {},
    mentions: {},
    receipts: {},
    typing: {},
    online: {},
    keyState: {},
    plain: {},

    init: (account) => {
      if (get().meId === account.id && initPromise) return initPromise
      get().teardown()
      set({
        meId: account.id,
        me: { id: account.id, username: account.discord_username, display_name: account.display_name, avatar: account.avatar ?? account.discord_avatar, role: account.is_administrator ? 'administrator' : 'manager' },
        lastRead: loadLastRead(account.id),
      })
      const pinned = loadPinned(account.id)
      const order = loadOrder(account.id)
      set({ pinnedServers: pinned.servers, pinnedConversations: pinned.conversations, serverOrder: order.servers, conversationOrder: order.conversations })
      socket = new ChatSocket(
        (ev) => {
          if (ev.type === 'connected') set({ meId: ev.user_id })
          handleEvent(ev)
        },
        (status) => {
          const prev = get().status
          set({ status })
          if (status === 'open' && prev === 'reconnecting') void catchUp().catch(() => undefined)
        },
      )
      socket.connect()
      typingTimer = window.setInterval(() => {
        const now = Date.now()
        const typing = get().typing
        let changed = false
        const next: ChatState['typing'] = {}
        for (const [k, users] of Object.entries(typing)) {
          const live = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now))
          if (Object.keys(live).length !== Object.keys(users).length) changed = true
          next[k] = live
        }
        if (changed) set({ typing: next })
      }, 1500)

      initPromise = (async () => {
        try {
          await get().refreshLists()
          set({ initialized: true, loadError: null })
          const keys = [
            ...get().servers.flatMap((sv) => sv.channels.map((c) => `c:${c.id}`)),
            ...get().conversations.map((c) => `d:${c.id}`),
          ]
          void pool(keys, 6, primeRoom)
          void e2e().then((m) => m.ensureDevice(account.id)).catch((err) => console.warn('[chat] device setup failed', err))
        } catch (err) {
          set({ initialized: true, loadError: (err as Error).message || 'Could not load chat' })
          initPromise = null
        }
      })()
      return initPromise
    },

    teardown: () => {
      if (socket) {
        socket.dispose()
        socket = null
        void e2e().then((m) => m.resetDevice())
      }
      if (typingTimer !== null) window.clearInterval(typingTimer)
      typingTimer = null
      initPromise = null
      rerunResolve.clear()
      lastRoomBySpace.clear()
      set({
        status: 'idle', me: null, meId: null, initialized: false, loadError: null,
        servers: [], members: {}, conversations: [], pinnedServers: [], pinnedConversations: [], serverOrder: [], conversationOrder: [], activeServerId: null, active: null,
        threadRootId: null, threads: {}, rooms: {}, lastMessage: {}, lastRead: {}, unread: {},
        mentions: {}, receipts: {}, typing: {}, online: {}, keyState: {}, plain: {},
      })
    },

    refreshLists: async () => {
      const [servers, conversations, online] = await Promise.all([
        api.listServers(),
        api.listConversations(),
        api.getPresence().catch(() => null),
      ])
      conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      set((s) => ({
        servers,
        conversations,
        online: online ? Object.fromEntries(online.map((id) => [id, true as const])) : s.online,
      }))
    },

    selectServer: (id) => {
      const current = get().active
      if (current) lastRoomBySpace.set(current.kind === 'channel' ? get().activeServerId ?? -1 : -1, current)
      set({ activeServerId: id, threadRootId: null })
      const remembered = lastRoomBySpace.get(id ?? -1)
      if (id == null) {
        if (remembered?.kind === 'conversation' && get().conversations.some((c) => c.id === remembered.id)) get().openRoom(remembered)
        else set({ active: null })
        return
      }
      const server = get().servers.find((s) => s.id === id)
      if (current?.kind === 'channel' && server?.channels.some((c) => c.id === current.id)) return
      const target = remembered?.kind === 'channel' && server?.channels.some((c) => c.id === remembered.id)
        ? remembered.id
        : server?.channels.slice().sort((a, b) => a.position - b.position)[0]?.id
      if (target != null) get().openRoom({ kind: 'channel', id: target })
      else set({ active: null })
      void get().loadMembers(id)
    },

    togglePinServer: (id) => {
      const meId = get().meId
      if (!meId) return
      set((s) => {
        const pinnedServers = s.pinnedServers.includes(id) ? s.pinnedServers.filter((x) => x !== id) : [...s.pinnedServers, id]
        savePinned(meId, { servers: pinnedServers, conversations: s.pinnedConversations })
        return { pinnedServers }
      })
    },

    togglePinConversation: (id) => {
      const meId = get().meId
      if (!meId) return
      set((s) => {
        const pinnedConversations = s.pinnedConversations.includes(id) ? s.pinnedConversations.filter((x) => x !== id) : [...s.pinnedConversations, id]
        savePinned(meId, { servers: s.pinnedServers, conversations: pinnedConversations })
        return { pinnedConversations }
      })
    },

    setServerOrder: (ids) => {
      const meId = get().meId
      if (!meId) return
      set((s) => {
        saveOrder(meId, { servers: ids, conversations: s.conversationOrder })
        return { serverOrder: ids }
      })
    },

    setConversationOrder: (ids) => {
      const meId = get().meId
      if (!meId) return
      set((s) => {
        saveOrder(meId, { servers: s.serverOrder, conversations: ids })
        return { conversationOrder: ids }
      })
    },

    openRoom: (room) => {
      const key = roomKey(room)
      if (room.kind === 'channel') {
        const server = get().servers.find((s) => s.channels.some((c) => c.id === room.id))
        set({ activeServerId: server?.id ?? get().activeServerId })
        if (server) void get().loadMembers(server.id)
      } else {
        set({ activeServerId: null })
        void get().resolveKey(room.id)
      }
      set({ active: room, threadRootId: null })
      const existing = get().rooms[key]
      if (!existing?.loaded && !existing?.loading) void get().loadOlder(room)
      else get().markRead(room)
    },

    loadOlder: async (room) => {
      const key = roomKey(room)
      const cur = get().rooms[key] ?? emptyRoom()
      if (cur.loading || (cur.loaded && !cur.hasMore)) return
      patchRoom(key, () => ({ loading: true, error: null }))
      const oldest = cur.items.find((m) => m.id > 0)
      try {
        const opts = { limit: PAGE, before: cur.loaded ? oldest?.id : undefined }
        const page = room.kind === 'channel'
          ? await api.listChannelMessages(room.id, opts)
          : await api.listDmMessages(room.id, opts)
        const top = page.results.filter((m) => !m.parent)
        patchRoom(key, (r) => {
          let items = r.items
          for (const m of top) items = upsert(items, m)
          return { items, hasMore: page.has_more, loading: false, loaded: true }
        })
        const newest = page.results.slice(-1)[0]
        if (!cur.loaded && newest) {
          set((s) => {
            const prev = s.lastMessage[key]
            return !prev || prev.id <= newest.id ? { lastMessage: { ...s.lastMessage, [key]: newest } } : {}
          })
          get().markRead(room)
        }
        if (room.kind === 'conversation') {
          for (const m of top) void decryptOne(m)
        }
      } catch (err) {
        patchRoom(key, () => ({ loading: false, error: (err as Error).message || 'Failed to load messages' }))
      }
    },

    setPanel: (panel) => set({ panel }),

    openThread: (rootId) => {
      set({ threadRootId: rootId })
      if (rootId == null) return
      set((s) => ({ threads: { ...s.threads, [rootId]: { items: s.threads[rootId]?.items ?? [], loading: true } } }))
      api.listThread(rootId)
        .then((items) => {
          set((s) => ({ threads: { ...s.threads, [rootId]: { items, loading: false } } }))
          for (const m of items) if (m.is_encrypted) void decryptOne(m)
        })
        .catch(() => set((s) => ({ threads: { ...s.threads, [rootId]: { items: s.threads[rootId]?.items ?? [], loading: false } } })))
    },

    send: async (room, input) => {
      const key = roomKey(room)
      const meId = get().meId
      const me = get().me
      if (!meId || !me) return
      const text = input.text.trim()
      if (!text && input.files.length === 0) return

      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const tempId = -Date.now() - Math.floor(Math.random() * 1000)
      const now = new Date().toISOString()
      const temp: UiMessage = {
        id: tempId, localId, sendState: 'sending',
        channel: room.kind === 'channel' ? room.id : null,
        conversation: room.kind === 'conversation' ? room.id : null,
        author: me, content: room.kind === 'channel' ? text : '', is_encrypted: room.kind === 'conversation',
        ciphertext: '', nonce: '', key_version: null, parent: input.parent ?? null, mentions: input.mentions ?? [],
        attachments: input.files.map((f, i) => ({ id: -(i + 1), name: f.name, url: '', mime: f.type, size: f.size, encrypted_name: '', nonce: '', key_version: null })),
        reactions: [], reply_count: 0, pinned: false, pinned_by: null, pinned_at: null, edited_at: null, deleted_at: null, created_at: now,
      }
      if (room.kind === 'conversation') setPlain(tempId, { text })

      const place = (fn: (items: UiMessage[]) => UiMessage[]): void => {
        if (temp.parent) {
          set((s) => {
            const t = s.threads[temp.parent!]
            return t ? { threads: { ...s.threads, [temp.parent!]: { ...t, items: fn(t.items) } } } : {}
          })
        } else {
          patchRoom(key, (r) => ({ items: fn(r.items) }))
        }
      }
      place((items) => items.concat(temp))
      if (temp.parent) {
        patchRoom(key, (r) => ({ items: r.items.map((m) => m.id === temp.parent ? { ...m, reply_count: m.reply_count + 1 } : m) }))
      }

      const attempt = async (): Promise<void> => {
        place((items) => items.map((m) => m.id === tempId ? { ...m, sendState: 'sending' } : m))
        try {
          let created: ChatMessage
          if (room.kind === 'channel') {
            const attachments: AttachmentInput[] = []
            for (const f of input.files) attachments.push(await api.uploadChatFile(f, f.name))
            created = await api.createChannelMessage(room.id, { content: text, parent: input.parent ?? null, mentions: input.mentions, attachments })
          } else {
            const m = await e2e()
            const conv = get().conversations.find((c) => c.id === room.id)
            if (!conv) throw new Error('Conversation not found')
            const hasMessages = (get().rooms[key]?.items ?? []).some((x) => x.id > 0 && x.key_version === conv.current_key_version)
            const res = await m.resolveRoomKey(meId, conv, hasMessages)
            if (res.state !== 'ready') throw new Error('Waiting for an encryption key')
            set((s) => ({ keyState: { ...s.keyState, [room.id]: 'ready' } }))
            const attachments: AttachmentInput[] = []
            for (const f of input.files) attachments.push(await m.uploadEncryptedFile(f, res.key, res.version))
            const sealed = text ? await m.encryptForSend(text, res.key) : null
            created = await api.createDmMessage(room.id, {
              ciphertext: sealed?.ciphertext, nonce: sealed?.nonce, key_version: res.version,
              parent: input.parent ?? null, mentions: input.mentions, attachments,
            })
            setPlain(created.id, { text })
          }
          // Replace in place rather than re-sorting by id: if two messages are
          // sent in quick succession, whichever request's response lands first
          // must not jump ahead of one sent earlier but still in flight.
          place((items) => items.map((m) => m.id === tempId ? { ...created, localId } : m))
          if (!created.parent) {
            set((s) => ({ lastMessage: { ...s.lastMessage, [key]: created } }))
            get().markRead(room)
          }
        } catch (err) {
          console.warn('[chat] send failed', err)
          place((items) => items.map((m) => m.id === tempId ? { ...m, sendState: 'failed', retry: () => void attempt() } : m))
        }
      }
      await attempt()
    },

    edit: async (message, text) => {
      const meId = get().meId
      if (!meId) return
      if (message.is_encrypted && message.conversation) {
        const m = await e2e()
        const conv = get().conversations.find((c) => c.id === message.conversation)
        if (!conv) return
        const res = await m.resolveRoomKey(meId, conv, true)
        if (res.state !== 'ready') throw new Error('Waiting for an encryption key')
        const sealed = await m.encryptForSend(text, res.key)
        const updated = await api.editMessage(message.id, { ...sealed, key_version: res.version })
        setPlain(updated.id, { text })
        mapMessage(updated.id, (x) => ({ ...x, ...updated }))
      } else {
        const updated = await api.editMessage(message.id, { content: text })
        mapMessage(updated.id, (x) => ({ ...x, ...updated }))
      }
    },

    remove: async (message) => {
      if (message.id < 0) {
        set((s) => {
          const rooms: Record<string, RoomMessages> = {}
          for (const [k, r] of Object.entries(s.rooms)) rooms[k] = { ...r, items: r.items.filter((m) => m.id !== message.id) }
          const threads = { ...s.threads }
          if (message.parent != null && threads[message.parent]) {
            threads[message.parent] = { ...threads[message.parent], items: threads[message.parent].items.filter((m) => m.id !== message.id) }
            const key = messageRoom(message)
            const room = key ? rooms[key] ?? s.rooms[key] : undefined
            if (key && room) rooms[key] = { ...room, items: room.items.map((m) => m.id === message.parent ? { ...m, reply_count: Math.max(0, m.reply_count - 1) } : m) }
          }
          return { rooms, threads }
        })
        return
      }
      await api.deleteMessage(message.id)
      mapMessage(message.id, (m) => ({ ...m, content: '', ciphertext: '', nonce: '', attachments: [], deleted_at: new Date().toISOString() }))
    },

    togglePin: async (message) => {
      const updated = message.pinned ? await api.unpinMessage(message.id) : await api.pinMessage(message.id)
      mapMessage(message.id, (m) => ({ ...m, ...updated }))
    },

    toggleReaction: async (message, emoji) => {
      const meId = get().meId
      if (!meId) return
      const had = message.reactions.some((r) => r.emoji === emoji && r.me)
      handleEvent({ type: had ? 'reaction.removed' : 'reaction.added', message_id: message.id, emoji, user_id: meId, channel: message.channel, conversation: message.conversation })
      try {
        if (had) await api.removeReaction(message.id, emoji)
        else await api.addReaction(message.id, emoji)
      } catch (err) {
        handleEvent({ type: had ? 'reaction.added' : 'reaction.removed', message_id: message.id, emoji, user_id: meId, channel: message.channel, conversation: message.conversation })
        throw err
      }
    },

    markRead: (room) => {
      const key = roomKey(room)
      const s = get()
      const latest = s.rooms[key]?.items.filter((m) => m.id > 0).slice(-1)[0]?.id ?? s.lastMessage[key]?.id
      if (!latest || !s.meId) return
      const had = (s.unread[key] ?? 0) > 0 || (s.mentions[key] ?? 0) > 0
      if (!had && (s.lastRead[key] ?? 0) >= latest) return
      const lastRead = { ...s.lastRead, [key]: latest }
      saveLastRead(s.meId, lastRead)
      set({ lastRead, unread: { ...s.unread, [key]: 0 }, mentions: { ...s.mentions, [key]: 0 } })
      const call = room.kind === 'channel' ? api.markChannelRead(room.id, latest) : api.markDmRead(room.id, latest)
      call.catch(() => undefined)
    },

    sendTyping: (room, active) => {
      socket?.send({ type: active ? 'typing.start' : 'typing.stop', target: { kind: room.kind, id: room.id } })
    },

    loadMembers: async (serverId, force = false) => {
      const cached = get().members[serverId]
      if (cached && !force) return cached
      const list = await api.listMembers(serverId)
      set((s) => ({ members: { ...s.members, [serverId]: list } }))
      return list
    },

    startDm: async (userIds, name) => {
      const conv = await api.createConversation({
        participant_ids: userIds,
        is_group: userIds.length > 1,
        name: userIds.length > 1 ? name ?? '' : '',
      })
      set((s) => ({ conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)] }))
      get().openRoom({ kind: 'conversation', id: conv.id })
      return conv
    },

    resolveKey: async (conversationId) => {
      const meId = get().meId
      if (!meId) return
      if (get().keyState[conversationId] === 'resolving') {
        rerunResolve.add(conversationId)
        return
      }
      set((s) => ({ keyState: { ...s.keyState, [conversationId]: 'resolving' } }))
      try {
        let conv = get().conversations.find((c) => c.id === conversationId)
        if (!conv) {
          conv = await api.getConversation(conversationId)
          set((s) => ({ conversations: [conv!, ...s.conversations] }))
        }
        const m = await e2e()
        const key = `d:${conversationId}`
        let room = get().rooms[key]
        if (!room?.loaded) {
          const page = await api.listDmMessages(conversationId, { limit: 1 })
          room = { ...emptyRoom(), items: page.results }
        }
        const hasMessages = room.items.some((x) => x.id > 0 && x.key_version === conv!.current_key_version)
          || get().lastMessage[key]?.key_version === conv.current_key_version
        const res = await m.resolveRoomKey(meId, conv, hasMessages)
        set((s) => ({ keyState: { ...s.keyState, [conversationId]: res.state } }))
        if (res.state === 'ready') void get().decryptRoom(conversationId)
      } catch (err) {
        console.warn('[chat] key resolution failed', err)
        set((s) => ({ keyState: { ...s.keyState, [conversationId]: 'error' } }))
      }
      if (rerunResolve.delete(conversationId)) void get().resolveKey(conversationId)
    },

    decryptRoom: async (conversationId) => {
      const key = `d:${conversationId}`
      const plain = get().plain
      const targets = [
        ...(get().rooms[key]?.items ?? []),
        ...Object.values(get().threads).flatMap((t) => t.items.filter((x) => x.conversation === conversationId)),
        ...(get().lastMessage[key] ? [get().lastMessage[key]] : []),
      ].filter((msg) => msg.id > 0 && msg.is_encrypted && !(plain[msg.id] && 'text' in plain[msg.id]))
      await pool(targets, 8, decryptOne)
    },

    totalUnread: () => Object.values(get().unread).reduce((a, b) => a + b, 0),
  }
})

export function displayName(user: Pick<ChatUserBrief, 'display_name' | 'username'>): string {
  return user.display_name || user.username || 'Unknown'
}

export function conversationTitle(conv: Conversation, meId: number | null): string {
  if (conv.name) return conv.name
  const others = conv.participants.filter((p) => p.user.id !== meId)
  if (others.length === 0) return 'Just you'
  return others.map((p) => displayName(p.user)).join(', ')
}
