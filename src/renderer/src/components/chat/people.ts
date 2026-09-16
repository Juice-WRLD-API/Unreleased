import { useMemo } from 'react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { useChatStore, type RoomRef } from '../../store/chatStore'

const EMPTY: ChatUserBrief[] = []

export function useRoomPeople(room: RoomRef | null): ChatUserBrief[] {
  const servers = useChatStore((s) => s.servers)
  const members = useChatStore((s) => s.members)
  const conversations = useChatStore((s) => s.conversations)
  return useMemo(() => {
    if (!room) return EMPTY
    if (room.kind === 'conversation') {
      return conversations.find((c) => c.id === room.id)?.participants.map((p) => p.user) ?? EMPTY
    }
    const server = servers.find((s) => s.channels.some((c) => c.id === room.id))
    const channel = server?.channels.find((c) => c.id === room.id)
    const list = server ? members[server.id]?.map((m) => m.user) ?? EMPTY : EMPTY
    if (channel?.is_private && channel.allowed_members?.length) {
      const allowed = new Set(channel.allowed_members)
      return list.filter((u) => allowed.has(u.id) || server?.owner === u.id)
    }
    return list
  }, [room, servers, members, conversations])
}

export function useStaffDirectory(): ChatUserBrief[] {
  const members = useChatStore((s) => s.members)
  const conversations = useChatStore((s) => s.conversations)
  const meId = useChatStore((s) => s.meId)
  return useMemo(() => {
    const byId = new Map<number, ChatUserBrief>()
    for (const list of Object.values(members)) for (const m of list) byId.set(m.user.id, m.user)
    for (const c of conversations) for (const p of c.participants) byId.set(p.user.id, p.user)
    if (meId) byId.delete(meId)
    return [...byId.values()].sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username))
  }, [members, conversations, meId])
}

const MENTION_RE = /(^|[\s(])@([A-Za-z0-9_.-]{2,32})/g

export function mentionIdsIn(text: string, people: ChatUserBrief[]): number[] {
  const ids = new Set<number>()
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[2].toLowerCase()
    const user = people.find((p) => p.username.toLowerCase() === handle)
    if (user) ids.add(user.id)
  }
  return [...ids]
}

export function linkMentions(text: string, people: ChatUserBrief[]): string {
  if (!people.length || !text.includes('@')) return text
  return text.replace(MENTION_RE, (whole, lead: string, handle: string) => {
    const user = people.find((p) => p.username.toLowerCase() === handle.toLowerCase())
    return user ? `${lead}[@${user.display_name || user.username}](mention:${user.id})` : whole
  })
}
