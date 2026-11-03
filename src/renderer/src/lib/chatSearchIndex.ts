import * as api from './chatApi'
import type { ChatMessage, ChatUserBrief } from './chatApi'
import { buildFacts, type Facts } from './chatSearch'
import { conversationTitle, roomKey, useChatStore, type RoomRef } from '../store/chatStore'

// Loads, decrypts and caches message history for the chat search panel.
//
// It deliberately does not go through the store's loadOlder(): that marks a
// room read the first time it loads, and searching a server must not clear
// the unread badges of every channel in it. Pages are fetched straight from
// the API into a private cache; the store's own rooms are overlaid at read
// time so live edits, deletions and new messages always win.

export type Scope = 'room' | 'space' | 'all'

export interface ScopeRoom {
  room: RoomRef
  key: string
  // What `in:` matches against, and what a result is tagged with.
  names: string[]
  label: string
  context: string
}

const PAGE = 50
const PER_ROOM_CAP = 3000
const CACHE_TTL_MS = 5 * 60 * 1000
const ATT_META_TIMEOUT_MS = 5000

interface RoomCache {
  msgs: Map<number, ChatMessage>
  hasMore: boolean
  oldest: number | null
  fetchedAt: number
  error: string | null
  capped: boolean
  fetching: boolean
}

let owner: number | null = null
const rooms = new Map<string, RoomCache>()
const texts = new Map<number, { sig: string; text: string | null }>()
const attMeta = new Map<number, { name: string; mime: string } | null>()

function ownedBy(meId: number | null): void {
  if (owner === meId) return
  owner = meId
  rooms.clear()
  texts.clear()
  attMeta.clear()
}

export function clearSearchCache(): void {
  owner = null
  rooms.clear()
  texts.clear()
  attMeta.clear()
}

// ------------------------------------------------------------------ scope

export function scopeRooms(scope: Scope, active: RoomRef | null): ScopeRoom[] {
  const s = useChatStore.getState()
  const channelRoom = (serverId: number): ScopeRoom[] => {
    const server = s.servers.find((x) => x.id === serverId)
    return (server?.channels ?? []).map((c) => ({
      room: { kind: 'channel' as const, id: c.id },
      key: `c:${c.id}`,
      names: [c.name, c.slug].filter(Boolean),
      label: `#${c.name}`,
      context: server?.name ?? '',
    }))
  }
  const dmRooms = (): ScopeRoom[] => s.conversations.map((c) => ({
    room: { kind: 'conversation' as const, id: c.id },
    key: `d:${c.id}`,
    names: [conversationTitle(c, s.meId), ...c.participants.flatMap((p) => [p.user.username, p.user.display_name])].filter(Boolean),
    label: conversationTitle(c, s.meId),
    context: 'Direct message',
  }))

  const everything = (): ScopeRoom[] => [...s.servers.flatMap((x) => channelRoom(x.id)), ...dmRooms()]
  if (!active) return scope === 'all' ? everything() : []
  if (scope === 'room') return everything().filter((r) => r.key === roomKey(active))
  if (scope === 'space') {
    if (active.kind === 'conversation') return dmRooms()
    const server = s.servers.find((x) => x.channels.some((c) => c.id === active.id))
    return server ? channelRoom(server.id) : []
  }
  return everything()
}

export function allRoomNames(): string[] {
  const s = useChatStore.getState()
  return [
    ...s.servers.flatMap((x) => x.channels.map((c) => c.name)),
    ...s.conversations.flatMap((c) => (c.is_group && c.name ? [c.name] : c.participants.filter((p) => p.user.id !== s.meId).map((p) => p.user.username))),
  ].filter(Boolean)
}

export function allKnownUsers(extra: ChatUserBrief[] = []): ChatUserBrief[] {
  const s = useChatStore.getState()
  const byId = new Map<number, ChatUserBrief>()
  for (const u of extra) byId.set(u.id, u)
  for (const list of Object.values(s.members)) for (const m of list) byId.set(m.user.id, m.user)
  for (const c of s.conversations) for (const p of c.participants) byId.set(p.user.id, p.user)
  if (s.me) byId.set(s.me.id, s.me)
  return [...byId.values()]
}

// ---------------------------------------------------------------- loading

export interface Progress {
  rooms: number
  done: number
  fetched: number
  capped: number
  failed: number
  running: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, stopped: () => boolean): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length && !stopped()) await fn(items[i++])
  }))
}

const sigOf = (m: ChatMessage): string => `${m.edited_at ?? ''}|${m.edit_seq ?? ''}|${m.key_version ?? ''}|${m.deleted_at ?? ''}`

async function ensureKey(conversationId: number): Promise<boolean> {
  const st = useChatStore.getState()
  if (st.keyState[conversationId] !== 'ready') await st.resolveKey(conversationId)
  return useChatStore.getState().keyState[conversationId] === 'ready'
}

async function decryptInto(m: ChatMessage, keyReady: boolean): Promise<void> {
  if (!m.is_encrypted || m.conversation == null || m.deleted_at) return
  const sig = sigOf(m)
  if (texts.get(m.id)?.sig === sig && texts.get(m.id)?.text !== null) return
  const meId = useChatStore.getState().meId
  const live = useChatStore.getState().plain[m.id]
  if (live && 'text' in live) { texts.set(m.id, { sig, text: live.text }); return }
  if (!meId || !keyReady) { texts.set(m.id, { sig, text: null }); return }
  try {
    const { decryptMessageFull } = await import('./chatE2E')
    texts.set(m.id, { sig, text: (await decryptMessageFull(meId, m)).text })
  } catch {
    texts.set(m.id, { sig, text: null })
  }
}

async function resolveAttachmentNames(m: ChatMessage): Promise<void> {
  const meId = useChatStore.getState().meId
  if (!meId || !m.is_encrypted || m.conversation == null || !m.attachments.length) return
  const { decryptAttachmentMeta } = await import('./chatE2E')
  for (const a of m.attachments) {
    if (attMeta.get(a.id)) continue
    try {
      const meta = await Promise.race([
        decryptAttachmentMeta(meId, m.conversation, a),
        sleep(ATT_META_TIMEOUT_MS).then(() => { throw new Error('timeout') }),
      ])
      attMeta.set(a.id, meta)
    } catch {
      attMeta.set(a.id, null)
    }
  }
}

async function loadRoom(sr: ScopeRoom, stopped: () => boolean, tick: () => void): Promise<RoomCache> {
  let cache = rooms.get(sr.key)
  if (cache && Date.now() - cache.fetchedAt > CACHE_TTL_MS && !cache.fetching) { rooms.delete(sr.key); cache = undefined }
  if (!cache) {
    cache = { msgs: new Map(), hasMore: true, oldest: null, fetchedAt: Date.now(), error: null, capped: false, fetching: false }
    rooms.set(sr.key, cache)
  }
  // Another panel instance is already pulling this room - let it finish.
  if (cache.fetching) {
    while (cache.fetching && !stopped()) await sleep(150)
    return cache
  }
  const keyReady = sr.room.kind === 'conversation' ? await ensureKey(sr.room.id) : true
  cache.fetching = true
  try {
    // Messages already cached still need decrypting on a later session.
    for (const m of cache.msgs.values()) await decryptInto(m, keyReady)
    while (cache.hasMore && !cache.capped && !stopped()) {
      const opts = { limit: PAGE, before: cache.oldest ?? undefined }
      const page = sr.room.kind === 'channel'
        ? await api.listChannelMessages(sr.room.id, opts)
        : await api.listDmMessages(sr.room.id, opts)
      for (const m of page.results) {
        cache.msgs.set(m.id, m)
        if (cache.oldest === null || m.id < cache.oldest) cache.oldest = m.id
      }
      cache.hasMore = page.has_more && page.results.length > 0
      cache.error = null
      if (cache.msgs.size >= PER_ROOM_CAP && cache.hasMore) cache.capped = true
      await pool(page.results, 6, (m) => decryptInto(m, keyReady), stopped)
      if (sr.room.kind === 'conversation') await pool(page.results, 3, resolveAttachmentNames, stopped)
      tick()
    }
    if (!cache.hasMore) cache.fetchedAt = Date.now()
  } catch (err) {
    cache.error = (err as Error).message || 'Failed to load'
  } finally {
    cache.fetching = false
  }
  return cache
}

export function startIndexing(targets: ScopeRoom[], onUpdate: (p: Progress) => void): () => void {
  let stop = false
  const stopped = (): boolean => stop
  const meId = useChatStore.getState().meId
  ownedBy(meId)
  const progress: Progress = { rooms: targets.length, done: 0, fetched: 0, capped: 0, failed: 0, running: true }
  let last = 0
  const emit = (force = false): void => {
    if (stop) return
    const now = Date.now()
    if (!force && now - last < 160) return
    last = now
    let fetched = 0
    for (const t of targets) fetched += rooms.get(t.key)?.msgs.size ?? 0
    onUpdate({ ...progress, fetched })
  }
  // Newest-activity rooms first would be ideal; the list order is good enough
  // and keeps the active room (usually first in scope) quick.
  void pool(targets, 3, async (t) => {
    const cache = await loadRoom(t, stopped, () => emit())
    progress.done++
    if (cache.capped) progress.capped++
    if (cache.error) progress.failed++
    emit(true)
  }, stopped).then(() => {
    progress.running = false
    emit(true)
  })
  return () => { stop = true }
}

// ----------------------------------------------------------------- reading

export interface Corpus {
  facts: Facts[]
  total: number
  locked: number
  pendingAttachments: number
  byRoom: Map<number, ScopeRoom>
}

// The panel rebuilds its corpus on every indexing tick and every store change,
// and buildFacts is the costly part. A message's facts are reused until its
// text, its room names or what's known of its attachment names changes; store
// edits replace the message object, which drops it from here.
const factsCache = new WeakMap<ChatMessage, { raw: string | null; names: string[]; metaSig: string; facts: Facts }>()

const metaSigOf = (m: ChatMessage): string => (m.is_encrypted ? m.attachments.map((a) => (attMeta.get(a.id) ? '1' : '0')).join('') : '')

export function collectFacts(targets: ScopeRoom[], mutedUserIds: number[]): Corpus {
  const s = useChatStore.getState()
  const facts: Facts[] = []
  let total = 0
  let locked = 0
  let pendingAttachments = 0
  const byRoom = new Map<number, ScopeRoom>()
  const meta = (id: number): { name: string; mime: string } | null => attMeta.get(id) ?? null

  for (const t of targets) {
    const merged = new Map<number, ChatMessage>(rooms.get(t.key)?.msgs ?? [])
    for (const m of s.rooms[t.key]?.items ?? []) if (m.id > 0 && !m.local && !m.localId) merged.set(m.id, m)
    for (const th of Object.values(s.threads)) {
      for (const m of th.items) {
        if (m.id > 0 && !m.localId && (t.room.kind === 'channel' ? m.channel === t.room.id : m.conversation === t.room.id)) merged.set(m.id, m)
      }
    }
    for (const m of merged.values()) {
      if (m.deleted_at) continue
      if (t.room.kind === 'channel' && m.author.id !== s.meId && mutedUserIds.includes(m.author.id)) continue
      total++
      let raw: string | null
      if (!m.is_encrypted) raw = m.content
      else {
        const live = s.plain[m.id]
        raw = live && 'text' in live ? live.text : texts.get(m.id)?.text ?? null
        if (raw === null) locked++
      }
      const metaSig = metaSigOf(m)
      const hit = factsCache.get(m)
      let f: Facts
      if (hit && hit.raw === raw && hit.names === t.names && hit.metaSig === metaSig) f = hit.facts
      else {
        f = buildFacts(m, raw, t.names, meta)
        factsCache.set(m, { raw, names: t.names, metaSig, facts: f })
      }
      if (f.atts.some((a) => a.unresolved)) pendingAttachments++
      facts.push(f)
      byRoom.set(m.id, t)
    }
  }
  return { facts, total, locked, pendingAttachments, byRoom }
}

// ------------------------------------------------------------------ jumping

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

// Opens the message's room, pages back until it is loaded, then scrolls to it.
// A thread reply lives in the thread panel, so its root is scrolled to and the
// thread opened beside it.
export async function jumpToMessage(m: ChatMessage): Promise<void> {
  const room: RoomRef = m.channel != null ? { kind: 'channel', id: m.channel } : { kind: 'conversation', id: m.conversation! }
  const key = roomKey(room)
  const target = m.parent ?? m.id
  const st = useChatStore.getState()
  if (!st.active || roomKey(st.active) !== key) st.openRoom(room)

  for (let i = 0; i < 120; i++) {
    const cur = useChatStore.getState().rooms[key]
    if (cur?.loaded && (cur.items.some((x) => x.id <= target) || !cur.hasMore)) break
    if (!cur || cur.loading) { await sleep(80); continue }
    await useChatStore.getState().loadOlder(room)
  }
  for (let i = 0; i < 40; i++) {
    await nextFrame()
    if (document.querySelector(`[data-message-id="${target}"]`)) break
    await sleep(50)
  }
  window.dispatchEvent(new CustomEvent('chat:jump', { detail: target }))
  if (m.parent) useChatStore.getState().openThread(m.parent)
}
