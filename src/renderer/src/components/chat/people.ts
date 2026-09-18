import { useMemo } from 'react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { displayName, useChatStore, type RoomRef } from '../../store/chatStore'

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
    return [...byId.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)))
  }, [members, conversations, meId])
}

// A fixed [A-Za-z0-9_.-] charset silently failed to re-match usernames that
// contain anything outside it (accented letters, apostrophes, etc.) - those
// people could be picked from the @ autocomplete but the inserted text never
// turned into a real mention. Match against the *actual* known usernames
// instead, so any username works regardless of what characters it contains.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "everyone" isn't a real username - there's no backend "mention everyone"
// primitive to hook into, so it rides the same @-mention plumbing as a real
// user: matched by the same regex, and resolved to every current room
// member's id so the normal per-user mention/notification path (mentions[]
// sent to the server, badge-incremented per recipient) fires for each of them.
export const EVERYONE_HANDLE = 'everyone'

function mentionRegex(people: ChatUserBrief[]): RegExp | null {
  const usernames = [...new Set(people.map((p) => p.username).filter(Boolean)), EVERYONE_HANDLE]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (!usernames.length) return null
  return new RegExp(`(^|[\\s(])@(${usernames.join('|')})(?=[^\\w]|$)`, 'gi')
}

export function mentionIdsIn(text: string, people: ChatUserBrief[]): number[] {
  const re = mentionRegex(people)
  if (!re) return []
  const ids = new Set<number>()
  for (const match of text.matchAll(re)) {
    const handle = match[2].toLowerCase()
    if (handle === EVERYONE_HANDLE) {
      for (const p of people) ids.add(p.id)
      continue
    }
    const user = people.find((p) => p.username.toLowerCase() === handle)
    if (user) ids.add(user.id)
  }
  return [...ids]
}

export function linkMentions(text: string, people: ChatUserBrief[]): string {
  const re = mentionRegex(people)
  if (!re || !text.includes('@')) return text
  return text.replace(re, (whole, lead: string, handle: string) => {
    if (handle.toLowerCase() === EVERYONE_HANDLE) return `${lead}[@everyone](mention:everyone)`
    const user = people.find((p) => p.username.toLowerCase() === handle.toLowerCase())
    return user ? `${lead}[@${displayName(user)}](mention:${user.id})` : whole
  })
}
