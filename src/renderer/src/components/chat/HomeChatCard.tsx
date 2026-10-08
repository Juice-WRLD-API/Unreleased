import { useMemo } from 'react'
import { ChevronRight, Hash, Lock, MessagesSquare } from 'lucide-react'
import { splitForwardRef } from '../../lib/chatForwardRef'
import { splitReplyRef } from '../../lib/chatReplyRef'
import { useStorePick } from '../../store/useStore'
import { conversationTitle, displayName, parseRoomKey, useChatStore } from '../../store/chatStore'
import { shortcodesToGlyphs } from './emoji'
import { ChatAvatar, CountBadge, shortStamp } from './ui'

interface Row {
  key: string
  title: string
  kind: 'channel' | 'conversation'
  isPrivate: boolean
  serverName?: string
  at: string
  unread: number
  mention: boolean
  preview: string
  avatarUser: { id: number; avatar: string; display_name: string; username: string } | null
}

function useRows(limit: number): { rows: Row[]; totalUnread: number; ready: boolean } {
  const servers = useChatStore((s) => s.servers)
  const conversations = useChatStore((s) => s.conversations)
  const lastMessage = useChatStore((s) => s.lastMessage)
  const unread = useChatStore((s) => s.unread)
  const mentions = useChatStore((s) => s.mentions)
  const plain = useChatStore((s) => s.plain)
  const meId = useChatStore((s) => s.meId)
  const ready = useChatStore((s) => s.initialized && !s.loadError)

  return useMemo(() => {
    const rows: Row[] = []
    for (const server of servers) {
      for (const c of server.channels) {
        const key = `c:${c.id}`
        const last = lastMessage[key]
        if (!last) continue
        rows.push({
          key, title: c.name, kind: 'channel', isPrivate: c.is_private, serverName: server.name,
          at: last.created_at, unread: unread[key] ?? 0, mention: (mentions[key] ?? 0) > 0,
          preview: last.deleted_at ? 'Message deleted' : `${last.author.id === meId ? 'You' : displayName(last.author)}: ${shortcodesToGlyphs(splitForwardRef(splitReplyRef(last.content).body).body || (last.attachments.length ? 'sent an attachment' : ''))}`,
          avatarUser: last.author,
        })
      }
    }
    for (const conv of conversations) {
      const key = `d:${conv.id}`
      const last = lastMessage[key]
      const p = last ? plain[last.id] : undefined
      const text = p && 'text' in p ? shortcodesToGlyphs(splitForwardRef(splitReplyRef(p.text).body).body || p.text) : last?.attachments.length ? 'sent an attachment' : 'Encrypted message'
      const other = conv.participants.find((x) => x.user.id !== meId)?.user ?? null
      rows.push({
        key, title: conversationTitle(conv, meId), kind: 'conversation', isPrivate: true,
        at: last?.created_at ?? conv.updated_at, unread: unread[key] ?? 0, mention: false,
        preview: last ? (last.deleted_at ? 'Message deleted' : `${last.author.id === meId ? 'You: ' : ''}${text}`) : 'No messages yet',
        avatarUser: conv.is_group ? null : other,
      })
    }
    rows.sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.at.localeCompare(a.at))
    const totalUnread = rows.reduce((n, r) => n + r.unread, 0)
    return { rows: rows.slice(0, limit), totalUnread, ready }
  }, [servers, conversations, lastMessage, unread, mentions, plain, meId, ready, limit])
}

function RowIcon({ row, size }: { row: Row; size: number }): JSX.Element {
  if (row.kind === 'conversation' && row.avatarUser) return <ChatAvatar user={row.avatarUser} size={size} presence />
  return (
    <span className="rounded-xl bg-surface-raised text-text-muted flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      {row.kind === 'channel' ? (row.isPrivate ? <Lock size={size * 0.42} /> : <Hash size={size * 0.45} />) : <MessagesSquare size={size * 0.42} />}
    </span>
  )
}

export default function HomeChatCard({ variant }: { variant: 'desktop' | 'mobile' }): JSX.Element | null {
  const { setActiveView } = useStorePick('setActiveView')
  const openRoom = useChatStore((s) => s.openRoom)
  const { rows, totalUnread, ready } = useRows(variant === 'desktop' ? 4 : 5)

  const open = (key?: string): void => {
    if (key) openRoom(parseRoomKey(key))
    setActiveView('chat')
  }

  if (variant === 'mobile') {
    return (
      <section className="mb-6">
        <div className="flex items-center gap-2 px-4 mb-2.5">
          <span className="text-text-muted"><MessagesSquare size={15} /></span>
          <h2 className="text-text-primary text-[15px] font-bold flex-1 min-w-0 truncate">Staff chat</h2>
          {totalUnread > 0 && <CountBadge count={totalUnread} />}
          <button onClick={() => open()} className="flex items-center gap-0.5 text-text-muted text-xs font-medium active:text-text-primary shrink-0">
            Open<ChevronRight size={14} />
          </button>
        </div>
        <div className="mx-4 rounded-2xl bg-[var(--surface-overlay)] divide-y divide-[var(--border)] overflow-hidden" style={{ ['--chat-ring' as string]: 'var(--surface-overlay)' }}>
          {!ready && <p className="px-4 py-3 text-xs text-text-muted">Connecting…</p>}
          {ready && rows.length === 0 && (
            <button onClick={() => open()} className="w-full px-4 py-3.5 text-left text-xs text-text-muted active:bg-surface-highest">No conversations yet — tap to start one.</button>
          )}
          {rows.map((row) => (
            <button key={row.key} onClick={() => open(row.key)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-surface-highest transition-colors">
              <RowIcon row={row} size={38} />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className={`flex-1 min-w-0 truncate text-sm ${row.unread ? 'font-bold text-text-primary' : 'font-medium text-text-primary'}`}>
                    {row.kind === 'channel' ? `#${row.title}` : row.title}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">{shortStamp(row.at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`flex-1 min-w-0 truncate text-xs ${row.unread ? 'text-text-secondary' : 'text-text-muted'}`}>{row.preview}</span>
                  <CountBadge count={row.unread} mention={row.mention} />
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="w-full shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] overflow-hidden" style={{ ['--chat-ring' as string]: 'var(--surface-overlay)' }}>
      <button onClick={() => open()} className="group w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-highest transition-colors">
        <span className="relative w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
          <MessagesSquare size={18} className="text-accent" />
          {totalUnread > 0 && <span className="absolute -top-1.5 -right-1.5"><CountBadge count={totalUnread} /></span>}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-text-primary text-sm font-semibold">Staff chat</span>
          <span className="block text-text-muted text-xs truncate mt-0.5">
            {!ready ? 'Connecting…' : totalUnread > 0 ? `${totalUnread} unread` : 'You’re all caught up'}
          </span>
        </span>
        <ChevronRight size={15} className="text-text-muted shrink-0 group-hover:text-text-primary transition-colors" />
      </button>
      {rows.length > 0 && (
        <div className="border-t border-[var(--border)] p-1">
          {rows.map((row) => (
            <button key={row.key} onClick={() => open(row.key)} className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-highest transition-colors">
              <RowIcon row={row} size={28} />
              <span className="flex-1 min-w-0">
                <span className={`block truncate text-xs ${row.unread ? 'font-bold text-text-primary' : 'text-text-primary'}`}>
                  {row.kind === 'channel' ? `#${row.title}` : row.title}
                  {row.serverName && <span className="font-normal text-text-muted"> · {row.serverName}</span>}
                </span>
                <span className="block truncate text-[11px] text-text-muted">{row.preview}</span>
              </span>
              {row.unread > 0 ? <CountBadge count={row.unread} mention={row.mention} /> : <span className="text-[10px] text-text-muted shrink-0">{shortStamp(row.at)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
