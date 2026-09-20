import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Hash, Loader2, MessagesSquare, Search, X } from 'lucide-react'
import type { ChatChannel, ChatServer } from '../../lib/chatApi'
import { encodeNewsShare } from '../../lib/chatShare'
import type { NewsItem } from '../../lib/newsApi'
import { conversationTitle, roomKey, useChatStore, type RoomRef } from '../../store/chatStore'
import { ChatAvatar, ServerGlyph } from './ui'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

interface Props {
  item: NewsItem
  onClose: () => void
}

function Row({ icon, label, sub, sent, onClick }: {
  icon: React.ReactNode
  label: string
  sub?: string
  sent: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={sent}
      className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-raised/70 transition-colors disabled:opacity-70"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-text-primary truncate">{label}</span>
        {sub && <span className="block text-xs text-text-muted truncate">{sub}</span>}
      </span>
      {sent && (
        <span className="flex items-center gap-1 text-xs font-semibold text-accent shrink-0">
          <Check size={14} /> Sent
        </span>
      )}
    </button>
  )
}

export default function ShareNewsModal({ item, onClose }: Props): JSX.Element {
  const initialized = useChatStore((s) => s.initialized)
  const servers = useChatStore((s) => s.servers)
  const conversations = useChatStore((s) => s.conversations)
  const meId = useChatStore((s) => s.meId)
  const send = useChatStore((s) => s.send)
  const [query, setQuery] = useState('')
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEscapeToClose(onClose)

  const q = query.trim().toLowerCase()
  const channelMatches = (server: ChatServer, channel: ChatChannel): boolean =>
    !q || server.name.toLowerCase().includes(q) || channel.name.toLowerCase().includes(q)
  const filteredServers = useMemo(
    () => servers.map((s) => ({ server: s, channels: s.channels.filter((c) => channelMatches(s, c)) })).filter((g) => g.channels.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servers, q],
  )
  const filteredConversations = useMemo(
    () => conversations.filter((c) => !q || conversationTitle(c, meId).toLowerCase().includes(q)),
    [conversations, meId, q],
  )

  const share = async (room: RoomRef): Promise<void> => {
    const key = roomKey(room)
    setBusy(key)
    setError(null)
    try {
      await send(room, { text: encodeNewsShare(item), files: [] })
      setSentTo((prev) => new Set(prev).add(key))
    } catch (err) {
      setError((err as Error).message || 'Could not send')
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-end md:items-center justify-center md:p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="chat-sheet relative w-full max-w-md max-h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl border border-[var(--border)] bg-surface shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-text-primary">Share post</h2>
            <p className="text-sm text-text-muted mt-0.5 truncate">{item.title}</p>
          </div>
          <button onClick={onClose} title="Close" className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay"><X size={18} /></button>
        </header>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a server or DM..."
              className="w-full rounded-xl bg-surface-raised border border-[var(--border)] pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
            />
          </div>
        </div>

        <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-4">
          {!initialized ? (
            <div className="flex items-center justify-center py-10 text-text-muted"><Loader2 size={20} className="animate-spin" /></div>
          ) : (
            <>
              {filteredConversations.length > 0 && (
                <div>
                  <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Direct messages</p>
                  {filteredConversations.map((conv) => {
                    const room: RoomRef = { kind: 'conversation', id: conv.id }
                    const key = roomKey(room)
                    const others = conv.participants.filter((p) => p.user.id !== meId)
                    return (
                      <Row
                        key={key}
                        icon={others[0]
                          ? <ChatAvatar user={others[0].user} size={32} />
                          : <span className="w-8 h-8 rounded-full bg-surface-raised text-text-secondary flex items-center justify-center"><MessagesSquare size={15} /></span>}
                        label={conversationTitle(conv, meId)}
                        sent={sentTo.has(key)}
                        onClick={() => void share(room)}
                      />
                    )
                  })}
                </div>
              )}
              {filteredServers.map(({ server, channels }) => (
                <div key={server.id}>
                  <p className="flex items-center gap-2 px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    <ServerGlyph server={server} size={16} /> {server.name}
                  </p>
                  {channels.map((channel) => {
                    const room: RoomRef = { kind: 'channel', id: channel.id }
                    const key = roomKey(room)
                    return (
                      <Row
                        key={key}
                        icon={<Hash size={16} className="text-text-muted" />}
                        label={channel.name}
                        sub={busy === key ? 'Sending...' : undefined}
                        sent={sentTo.has(key)}
                        onClick={() => void share(room)}
                      />
                    )
                  })}
                </div>
              ))}
              {filteredServers.length === 0 && filteredConversations.length === 0 && (
                <p className="px-2 py-6 text-sm text-text-muted text-center">Nothing matches "{query}".</p>
              )}
            </>
          )}
          {error && <p className="px-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
