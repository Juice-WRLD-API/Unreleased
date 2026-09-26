import { MessagesSquare } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'

export default function ChatNavIcon({ size = 18 }: { size?: number }): JSX.Element {
  const total = useChatStore((s) => Object.values(s.unread).reduce((a, b) => a + b, 0))
  const mentions = useChatStore((s) => Object.values(s.mentions).reduce((a, b) => a + b, 0))
  return (
    <span className="relative inline-flex">
      <MessagesSquare size={size} />
      {total > 0 && (
        <span
          className={`absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center tabular-nums ring-2 ring-[var(--surface)] ${
            mentions > 0 ? 'bg-red-500 text-white' : 'bg-accent text-white'
          }`}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </span>
  )
}
