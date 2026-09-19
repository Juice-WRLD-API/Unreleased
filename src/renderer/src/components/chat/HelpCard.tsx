import { X } from 'lucide-react'
import { CHAT_COMMANDS } from '../../lib/chatCommands'
import { useChatStore, type RoomRef } from '../../store/chatStore'

// Rendered for /help's local notice (see chatStore's postLocalNotice) - this
// card only ever exists in the requester's own client, never on the server,
// so no one else in the room can see it.
export default function HelpCard({ room, messageId }: { room: RoomRef; messageId: number }): JSX.Element {
  const dismiss = useChatStore((s) => s.dismissLocalNotice)
  const commands = CHAT_COMMANDS.filter((c) => c.name !== 'help')

  return (
    <div className="relative w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5">
      <button
        onClick={() => dismiss(room, messageId)}
        title="Dismiss"
        className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
      >
        <X size={14} />
      </button>
      <p className="text-sm font-semibold text-text-primary pr-6">Commands</p>
      <p className="text-xs text-text-muted mt-0.5">Only visible to you</p>
      <dl className="mt-2 space-y-1.5">
        {commands.map((c) => (
          <div key={c.name} className="flex gap-2 text-xs">
            <dt className="shrink-0 font-mono text-accent">{c.usage}</dt>
            <dd className="text-text-secondary min-w-0">{c.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
