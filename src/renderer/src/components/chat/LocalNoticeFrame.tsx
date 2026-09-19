import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useChatStore, type RoomRef } from '../../store/chatStore'

// Shared chrome for every /help, /theme and /feedback local notice card (see
// chatStore's postLocalNotice) - dismiss button plus the "only you" caption,
// so each card just supplies its own title/body.
export default function LocalNoticeFrame({ room, messageId, title, caption = 'Only visible to you', children }: {
  room: RoomRef
  messageId: number
  title: string
  caption?: string
  children: ReactNode
}): JSX.Element {
  const dismiss = useChatStore((s) => s.dismissLocalNotice)
  return (
    <div className="relative w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5">
      <button
        onClick={() => dismiss(room, messageId)}
        title="Dismiss"
        className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
      >
        <X size={14} />
      </button>
      <p className="text-sm font-semibold text-text-primary pr-6">{title}</p>
      <p className="text-xs text-text-muted mt-0.5">{caption}</p>
      {children}
    </div>
  )
}
